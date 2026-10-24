// Service worker: guarda o WJCAD inteiro em cache (inclusive o kernel .wasm de ~10 MB e o
// solver do esboço) já na instalação, para funcionar sem internet em qualquer aparelho.
// __VERSAO__ é trocado a cada build (vite.config.ts): versão nova → cache novo → app atualizado.
const CACHE = "jlscad-__VERSAO__";
const BASE = new URL("./", self.location.href);

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let lista = [];
    try {
      lista = await (await fetch(new URL("precache.json", BASE), { cache: "no-store" })).json();
    } catch {
      /* sem lista: o cache se forma conforme o uso */
    }
    const urls = ["./", "manifest.webmanifest", "icone.svg", ...lista].map((f) => new URL(f, BASE).href);
    // um a um: um arquivo que falhar não impede os outros
    await Promise.all(urls.map(async (u) => {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (r.ok) await cache.put(u, r);
      } catch {
        /* tenta de novo no próximo acesso */
      }
    }));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k.startsWith("jlscad-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    for (const c of await self.clients.matchAll()) c.postMessage({ tipo: "offline-pronto" });
  })());
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  const ehPagina = e.request.mode === "navigate";
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const emCache = await cache.match(ehPagina ? new URL("./", BASE).href : e.request, { ignoreSearch: true });
    // Página: rede primeiro (pega versão nova). Arquivos com hash: cache primeiro.
    if (emCache && !ehPagina) return emCache;
    try {
      const resp = await fetch(e.request);
      if (resp.ok && !ehPagina) cache.put(e.request, resp.clone());
      return resp;
    } catch (err) {
      if (emCache) return emCache;
      throw err;
    }
  })());
});
