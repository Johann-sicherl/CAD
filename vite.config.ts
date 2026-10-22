import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Uso offline: lista todos os arquivos do build em precache.json (o service worker baixa tudo
 * na instalação, inclusive o solver do esboço) e carimba no sw.js uma versão que muda a cada
 * build, para o app instalado se atualizar sozinho.
 */
function offline(): Plugin {
  let arquivos: string[] = [];
  let pasta = "dist";
  return {
    name: "jlscad-offline",
    apply: "build",
    configResolved(c) {
      pasta = c.build.outDir;
    },
    generateBundle(_, bundle) {
      arquivos = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      this.emitFile({ type: "asset", fileName: "precache.json", source: JSON.stringify(arquivos) });
    },
    closeBundle() {
      const sw = resolve(pasta, "sw.js");
      const versao = createHash("sha1").update(arquivos.sort().join("|")).digest("hex").slice(0, 10);
      writeFileSync(sw, readFileSync(sw, "utf8").replace('"jlscad-__VERSAO__"', `"jlscad-${versao}"`));
    },
  };
}

// base: "/" no Cloudflare Pages (site na raiz); o workflow do GitHub Pages passa BASE_PATH=/CAD/
// (johann-sicherl.github.io/CAD/).
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? process.env.BASE_PATH || "/" : "/",
  plugins: [offline()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["replicad-opencascadejs"] },
  server: { host: true }, // permite abrir no tablet pela rede local durante o desenvolvimento
  // mesmos cabeçalhos do public/_headers (Cloudflare): isolamento de origem → SharedArrayBuffer,
  // necessário para o kernel com várias threads
  preview: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
}));
