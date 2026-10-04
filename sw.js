/* Doodle Alive service worker: opens fast and works once it has been loaded.
   Bump CACHE on every deploy so updates arrive (the old cache is deleted on activate).
   Served with Cache-Control: no-cache (see vercel.json). Not registered on localhost. */
const CACHE = "doodle-alive-v2";

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "src/styles.css",
  "src/app.js",
  "src/decor.js",
  "src/engine/util.js",
  "src/engine/decode.js",
  "src/engine/cleanup.js",
  "src/engine/trace.js",
  "src/engine/backgrounds.js",
  "src/engine/animate.js",
  "src/engine/compose.js",
  "src/engine/export.js",
  "src/engine/share.js",
  "src/engine/sample.js",
  "src/engine/vendor/mp4-muxer.js",
  "fonts/fredoka-600.woff2",
  "fonts/caveat-600.woff2",
  "fonts/pacifico-400.woff2",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // one by one, so a file that isn't there yet can't stop the rest
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.indexOf("doodle-alive-") === 0 && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/_vercel/") === 0) return;
  if (req.headers.has("range")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isNav = req.mode === "navigate";
    const key = isNav ? "index.html" : req;
    const cached = await cache.match(key);

    // cache first, refresh quietly in the background
    const network = fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const res = await network;
    if (res) return res;
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<body style='font-family:system-ui;text-align:center;padding:48px 24px;background:#FBF7EE;color:#24203A'>" +
      "<h1>You're offline</h1><p>Reconnect and give Doodle Alive another go.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  })());
});
