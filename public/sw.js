/* Newslang service worker: app-shell offline support + asset caching. */
const CACHE = "newslang-v1";

/** Fetched at install so the app opens (and navigations resolve) offline. */
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Cache entries one by one so a single failure cannot abort the install.
      await Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => undefined)));
      await precacheBuildAssets(cache);
      await self.skipWaiting();
    })(),
  );
});

/** Cache the content-hashed JS/CSS referenced by the shell so offline works
 *  after the first visit (the SW may activate after the page already fetched
 *  them on its own). */
async function precacheBuildAssets(cache) {
  try {
    const response = await fetch("/", { cache: "no-cache" });
    if (!response.ok) return;
    const html = await response.text();
    const urls = new Set();
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
      urls.add(match[1]);
    }
    await Promise.all([...urls].map((url) => cache.add(url).catch(() => undefined)));
  } catch {
    // Offline install is best-effort.
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/** Immutable, hash-named build output: serve from cache, fall back to network. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** Icons, manifest, etc.: answer fast, refresh in the background. */
async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  return response ?? Response.error();
}

/** HTML navigations: fresh when online, the cached app shell when offline. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put("/index.html", response.clone());
    return response;
  } catch {
    const direct = await cache.match(request, { ignoreSearch: true });
    if (direct) return direct;
    const shell = (await cache.match("/index.html")) ?? (await cache.match("/"));
    return shell ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Vocabulary and translations must always be live.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, request));
});

/* ---------- Web Push ---------- */

/** Show the notification payload sent by the Worker's daily reminder. */
self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();

  const title = data.title || "Newslang";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body,
      icon: data.icon || "/icon-192.png",
      badge: "/icon-96.png",
      tag: data.tag || "newslang",
      data: { url: data.url || "/" },
    }),
  );
});

/** Focus an open tab on the target path, or open a new one. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  const targetUrl = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (client.url === targetUrl && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
