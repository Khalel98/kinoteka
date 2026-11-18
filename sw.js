// Офлайн-оболочка Кинотеки. При любом изменении файлов увеличьте VERSION —
// телефон скачает обновление при следующем открытии с интернетом.
const VERSION = "kinoteka-v1";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "movies.js",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "posters/amelie.jpg",
  "posters/as-good-as-it-gets.jpg",
  "posters/atonement.jpg",
  "posters/back-to-the-future.jpg",
  "posters/calvary.jpg",
  "posters/drive.jpg",
  "posters/dune-2.jpg",
  "posters/dune.jpg",
  "posters/eternal-sunshine.jpg",
  "posters/goodfellas.jpg",
  "posters/hidden-figures.jpg",
  "posters/inception.jpg",
  "posters/kiss-kiss-bang-bang.jpg",
  "posters/lady-bird.jpg",
  "posters/lost-in-translation.jpg",
  "posters/moscow-does-not-believe-in-tears.jpg",
  "posters/night-on-earth.jpg",
  "posters/oldboy.jpg",
  "posters/pans-labyrinth.jpg",
  "posters/pulp-fiction.jpg",
  "posters/saving-private-ryan.jpg",
  "posters/stand-by-me.jpg",
  "posters/taxi-driver.jpg",
  "posters/the-big-lebowski.jpg",
  "posters/the-big-short.jpg",
  "posters/the-call.jpg",
  "posters/the-godfather.jpg",
  "posters/the-last-emperor.jpg",
  "posters/the-meyerowitz-stories.jpg",
  "posters/what-men-talk-about.jpg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() =>
        req.mode === "navigate" ? caches.match("index.html") : Response.error()
      );
    })
  );
});
