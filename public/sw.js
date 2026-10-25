// Service worker do WJProMaster (página inicial + WJCAD), para funcionar sem internet.
// - Instalação: guarda as páginas e os arquivos pequenos (precache.json → `pequenos`).
// - O kernel do WJCAD (~23 MB, `grandes`) não é baixado na instalação: a página do WJCAD pede
//   para guardá-lo depois de carregar ({ tipo: "guardar" }), reaproveitando o cache HTTP do
//   download que ela mesma já fez (nada é baixado duas vezes).
// __VERSAO__ é trocado a cada build (vite.config.ts): versão nova → cache novo → app atualizado.
const CACHE = "jlscad-__VERSAO__";
const BASE = new URL("./", self.location.href);
const PAGINAS = ["./", "cad/", "planilha/", "documento/", "apresentacao/", "cronograma/"];

async function lista() {
  try {
    const l = await (await fetch(new URL("precache.json", BASE), { cache: "no-cache" })).json();
    return Array.isArray(l) ? { pequenos: l, grandes: [] } : l;
  } catch {
    return { pequenos: [], grandes: [] };
  }
}

/** Guarda as URLs que ainda não estão no cache (uma falha não impede as outras). */
async function guardar(urls, modo) {
  const cache = await caches.open(CACHE);
  let novos = 0;
  await Promise.all(urls.map(async (u) => {
    try {
      if (await cache.match(u)) return;
      const r = await fetch(u, { cache: modo });
      if (r.ok) {
        await cache.put(u, r);
        novos++;
      }
    } catch {
      /* tenta de novo no próximo acesso */
    }
  }));
  return novos;
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const { pequenos } = await lista();
    // páginas sempre conferidas na rede; arquivos com hash podem vir do cache HTTP
    await guardar(PAGINAS.map((f) => new URL(f, BASE).href), "no-cache");
    await guardar(["manifest.webmanifest", "icone.svg", "wjpromaster.svg", ...pequenos].map((f) => new URL(f, BASE).href), "default");
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k.startsWith("jlscad-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data?.tipo !== "guardar") return;
  e.waitUntil((async () => {
    const { grandes } = await lista();
    const novos = await guardar(grandes.map((f) => new URL(f, BASE).href), "default");
    if (novos && e.source) e.source.postMessage({ tipo: "offline-pronto" });
  })());
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  const ehPagina = e.request.mode === "navigate";
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // página: a própria (início ou WJCAD), sem ?parâmetros; "cad" sem barra vira "cad/"
    let chave = e.request;
    if (ehPagina) {
      const u = new URL(e.request.url);
      u.search = "";
      if (!u.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(u.pathname)) u.pathname += "/";
      chave = u.href.replace(/index\.html$/, "");
    }
    const emCache = await cache.match(chave, { ignoreSearch: true });
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
