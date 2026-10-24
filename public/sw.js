const CACHE_NAME = "giera-v1";

const ASSETS_TO_PRECACHE = [
  "/",
  "/index.html",
  "/src/main.ts",
  "/src/style.css",
  "/assets/textures/atlas.png",
  "/assets/fonts/pixelify-sans.css",
  "/assets/fonts/pixelify-sans-0.ttf",
  "/assets/models/character-a.meshopt.glb",
  "/assets/models/character-b.meshopt.glb"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_PRECACHE).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.url.includes("/ws") ||
    event.request.url.includes("/api/") ||
    event.request.url.includes("localhost") ||
    event.request.url.includes("127.0.0.1")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
