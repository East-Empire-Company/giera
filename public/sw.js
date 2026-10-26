const CACHE_NAME = "giera-v2";

const ASSETS_TO_PRECACHE = [
  "/",
  "/index.html",
  "/src/main.ts",
  "/src/style.css",
  "/assets/textures/atlas.png",
  "/assets/textures/atlas-normal.png",
  "/assets/textures/atlas-orm.png",
  "/assets/sky/kloofendal_48d_partly_cloudy_2k.hdr",
  "/assets/fonts/pixelify-sans.css",
  "/assets/fonts/pixelify-sans-0.ttf",
  "/assets/models/kaykit/knight.glb",
  "/assets/models/kaykit/rogue.glb",
  "/assets/models/kaykit/mage.glb",
  "/assets/models/kaykit/ranger.glb",
  "/assets/models/kaykit/anims/Rig_Medium_MovementBasic.glb",
  "/assets/models/kaykit/anims/Rig_Medium_General.glb"
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
    event.request.method !== "GET" ||
    event.request.url.includes("/ws") ||
    event.request.url.includes("/api/")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const url = new URL(event.request.url);
        const cacheable = response.ok && (event.request.mode === "navigate" || url.pathname.startsWith("/assets/"));
        if (cacheable) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
