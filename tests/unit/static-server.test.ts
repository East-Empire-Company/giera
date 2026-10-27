import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gunzipSync } from "zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveStatic } from "../../server/static";

let dist = "";
const big = "console.log('giera');\n".repeat(400);

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "giera-dist-"));
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><html>" + "x".repeat(2000) + "</html>");
  writeFileSync(join(dist, "assets", "index-AbCdEf12.js"), big);
  writeFileSync(join(dist, "assets", "photo.png"), Buffer.alloc(4000, 7));
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const get = (path: string, headers: Record<string, string> = {}) => serveStatic(new Request(`http://x${path}`, { headers }), dist);

describe("serveStatic", () => {
  it("gzips compressible files and the body round-trips", async () => {
    const res = await get("/assets/index-AbCdEf12.js", { "accept-encoding": "gzip" });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(big);
    expect(Number(res.headers.get("content-length"))).toBeLessThan(big.length / 4);
  });

  it("serves hashed bundles as immutable, images revalidatable for a day, and html never cached", async () => {
    expect((await get("/assets/index-AbCdEf12.js")).headers.get("cache-control")).toContain("immutable");
    expect((await get("/assets/photo.png")).headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await get("/")).headers.get("cache-control")).toBe("no-cache");
  });

  it("does not compress already-compressed images", async () => {
    const res = await get("/assets/photo.png", { "accept-encoding": "br, gzip" });
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("answers 304 when the etag matches", async () => {
    const first = await get("/assets/index-AbCdEf12.js");
    const res = await get("/assets/index-AbCdEf12.js", { "if-none-match": first.headers.get("etag")! });
    expect(res.status).toBe(304);
  });

  it("falls back to index.html for unknown paths and never escapes the dist folder", async () => {
    expect((await get("/some/route")).headers.get("content-type")).toContain("text/html");
    const escaped = await get("/..%2f..%2fetc/passwd");
    expect(escaped.headers.get("content-type")).toContain("text/html");
  });
});
