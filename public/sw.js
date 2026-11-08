const CACHE_NAME = "giera-v4";

const BOOT_ASSETS = [
  "/assets/textures/atlas.webp",
  "/assets/textures/atlas-normal.webp",
  "/assets/textures/atlas-orm.webp",
  "/assets/textures/water-normal.jpg",
  "/assets/sky/kloofendal_48d_partly_cloudy_1k.hdr",
  "/assets/sky/clouds.png",
  "/assets/sky/skybox_sideClouds.png",
  "/assets/fonts/pixelify-sans.css",
  "/assets/fonts/pixelify-sans-0.ttf",
  "/assets/fonts/pixelify-sans-1.ttf",
  "/assets/fonts/pixelify-sans-3.ttf",
  "/assets/models/kaykit/mage.glb",
  "/assets/models/kaykit/ranger.glb",
  "/assets/models/kaykit/anims/Rig_Medium_MovementBasic.glb",
  "/assets/models/kaykit/anims/Rig_Medium_General.glb",
  "/assets/audio/music/sigma_protocol.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        BOOT_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: "no-cache" })).catch(() => undefined)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  const network = fetch(event.request)
    .then((response) => {
      if (response.ok) void cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const fresh = await network;
  return fresh ?? new Response("", { status: 504, statusText: "Offline" });
}

async function networkFirstNavigation(event) {
  try {
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      void cache.put("/", response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match("/");
    if (cached) return cached;
    throw new Error("offline and no cached shell");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/ws") || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(staleWhileRevalidate(event));
  }
});