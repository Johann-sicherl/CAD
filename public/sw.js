// Service worker: guarda o app (inclusive o kernel .wasm de ~10 MB) em cache
// para abrir rápido e funcionar sem internet depois da primeira visita.
const CACHE = "cad-tablet-v6";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  const ehPagina = e.request.mode === "navigate";
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const emCache = await cache.match(e.request);
      // Página: rede primeiro (pega versão nova). Arquivos com hash: cache primeiro.
      if (emCache && !ehPagina) return emCache;
      try {
        const resp = await fetch(e.request);
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      } catch (err) {
        if (emCache) return emCache;
        throw err;
      }
    }),
  );
});
