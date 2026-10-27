import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { brotliDecompressSync, gunzipSync } from "zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveStatic } from "../../server/static";

let base = "";
let dist = "";
let emptyDist = "";
const big = "console.log('giera');\n".repeat(400);
const small = "console.log('tiny');\n";
const SECRET = "TOP-SECRET-OUTSIDE-DIST";
const INDEX = "<!doctype html><html>" + "x".repeat(2000) + "</html>";

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "giera-static-"));
  dist = join(base, "dist");
  emptyDist = join(base, "empty");
  mkdirSync(join(dist, "assets"), { recursive: true });
  mkdirSync(emptyDist);
  mkdirSync(join(base, "dist-evil"));
  writeFileSync(join(base, "secret.txt"), SECRET);
  writeFileSync(join(base, "dist-evil", "secret.txt"), SECRET);
  writeFileSync(join(dist, "index.html"), INDEX);
  writeFileSync(join(dist, "assets", "index-AbCdEf12.js"), big);
  writeFileSync(join(dist, "assets", "tiny.js"), small);
  writeFileSync(join(dist, "assets", "photo.png"), Buffer.alloc(4000, 7));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

const get = (path: string, headers: Record<string, string> = {}, root = dist) =>
  serveStatic(new Request(`http://x${path}`, { headers }), root);

describe("serveStatic compression", () => {
  it("gzips compressible files and the body round-trips", async () => {
    const res = await get("/assets/index-AbCdEf12.js", { "accept-encoding": "gzip" });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(big);
    expect(Number(res.headers.get("content-length"))).toBeLessThan(big.length / 4);
  });

  it("prefers brotli over gzip and the body round-trips", async () => {
    const res = await get("/assets/index-AbCdEf12.js", { "accept-encoding": "gzip, br" });
    expect(res.headers.get("content-encoding")).toBe("br");
    const body = Buffer.from(await res.arrayBuffer());
    expect(Number(res.headers.get("content-length"))).toBe(body.byteLength);
    expect(brotliDecompressSync(body).toString()).toBe(big);
  });

  it("sends identity bodies byte-for-byte when the client accepts no encoding", async () => {
    const res = await get("/assets/index-AbCdEf12.js");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe(big);
    expect(Number(res.headers.get("content-length"))).toBe(big.length);
  });

  it("does not compress already-compressed images", async () => {
    const res = await get("/assets/photo.png", { "accept-encoding": "br, gzip" });
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("does not compress compressible files below the size threshold", async () => {
    const res = await get("/assets/tiny.js", { "accept-encoding": "br, gzip" });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe(small);
  });

  it("always varies on Accept-Encoding", async () => {
    expect((await get("/assets/index-AbCdEf12.js")).headers.get("vary")).toBe("Accept-Encoding");
    expect((await get("/assets/photo.png", { "accept-encoding": "gzip" })).headers.get("vary")).toBe("Accept-Encoding");
  });
});

describe("serveStatic caching", () => {
  it("serves hashed bundles as immutable, images revalidatable for a day, and html never cached", async () => {
    expect((await get("/assets/index-AbCdEf12.js")).headers.get("cache-control")).toContain("immutable");
    expect((await get("/assets/photo.png")).headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await get("/")).headers.get("cache-control")).toBe("no-cache");
  });

  it("answers 304 when the etag matches", async () => {
    const first = await get("/assets/index-AbCdEf12.js");
    const res = await get("/assets/index-AbCdEf12.js", { "if-none-match": first.headers.get("etag")! });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("answers 200 with the full body when the etag does not match", async () => {
    const res = await get("/assets/index-AbCdEf12.js", { "if-none-match": 'W/"stale-0"' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(big);
  });
});

describe("serveStatic routing", () => {
  it("falls back to index.html for unknown paths", async () => {
    const res = await get("/some/route");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe(INDEX);
  });

  it("falls back to index.html for directories", async () => {
    expect(await (await get("/assets")).text()).toBe(INDEX);
  });

  it("answers 404 when dist has no index.html", async () => {
    const res = await get("/anything", {}, emptyDist);
    expect(res.status).toBe(404);
  });

  const escapes = [
    "/..%2fsecret.txt",
    "/..%2f..%2fsecret.txt",
    "/%2e%2e/secret.txt",
    "/%2e%2e%2fsecret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/..%2fdist-evil%2fsecret.txt",
    "/%00",
    "/assets/%00.js",
    "/%E0%A4%A",
  ];

  it.each(escapes)("never serves files outside dist for %s", async (path) => {
    const res = await get(path);
    const body = await res.text();
    expect(body).not.toContain(SECRET);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toBe(INDEX);
  });

  it("does not treat a sibling directory sharing the dist prefix as inside dist", async () => {
    const res = await get(`/..%2f${basename(dist)}-evil%2fsecret.txt`);
    expect(await res.text()).toBe(INDEX);
  });
});
