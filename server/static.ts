import { existsSync, readFileSync, statSync } from "fs";
import { extname, resolve, sep } from "path";
import { brotliCompressSync, constants, gzipSync } from "zlib";

const COMPRESSIBLE = /\.(?:js|mjs|css|html|json|svg|webmanifest|hdr|glb|gltf|ttf|txt|map)$/i;
const HASHED = /-[A-Za-z0-9_-]{8}\.(?:js|css)$/;
const MIN_COMPRESS_BYTES = 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".hdr": "application/octet-stream",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

type Packed = { br?: Buffer; gz?: Buffer };
const packed = new Map<string, Packed>();

function cacheControl(pathname: string): string {
  if (HASHED.test(pathname)) return "public, max-age=31536000, immutable";
  if (pathname.startsWith("/assets/")) return "public, max-age=86400";
  return "no-cache";
}

function pack(file: string, etag: string, brotli: boolean): Buffer {
  const key = `${file}|${etag}`;
  let entry = packed.get(key);
  if (!entry) {
    entry = {};
    packed.set(key, entry);
  }
  const raw = readFileSync(file);
  if (brotli) {
    entry.br ??= brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    return entry.br;
  }
  entry.gz ??= gzipSync(raw, { level: 6 });
  return entry.gz;
}

export async function serveStatic(req: Request, distDir: string): Promise<Response> {
  const url = new URL(req.url);
  const root = resolve(distDir);
  let file: string;
  try {
    file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
  } catch {
    file = root;
  }
  let pathname = url.pathname;
  if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    file = resolve(root, "index.html");
    pathname = "/index.html";
  }
  if (!existsSync(file)) return new Response("Not found", { status: 404 });

  const stat = statSync(file);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = new Headers({
    "cache-control": cacheControl(pathname),
    etag,
    vary: "Accept-Encoding",
    "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
  });
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const accept = req.headers.get("accept-encoding") ?? "";
  const encoding = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : null;
  if (encoding && COMPRESSIBLE.test(file) && stat.size >= MIN_COMPRESS_BYTES) {
    const body = pack(file, etag, encoding === "br");
    headers.set("content-encoding", encoding);
    headers.set("content-length", String(body.byteLength));
    return new Response(body as unknown as BodyInit, { headers });
  }
  headers.set("content-length", String(stat.size));
  return new Response(readFileSync(file) as unknown as BodyInit, { headers });
}
