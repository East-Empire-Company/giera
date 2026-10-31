import { extname, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "../platform/xbox-uwp-probe/Assets");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

Bun.serve({
  hostname: "127.0.0.1",
  port: 4174,
  async fetch(request) {
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(new URL(request.url).pathname.slice(1)) || "probe.html";
    } catch {
      return new Response("Bad path", { status: 400 });
    }

    const path = resolve(root, relativePath);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(path);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    return new Response(file, {
      headers: { "content-type": contentTypes[extname(path)] ?? "application/octet-stream" },
    });
  },
});
