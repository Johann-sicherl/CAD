import { defineConfig } from "vite";

// base = nome do repositório, para funcionar no GitHub Pages (johann-sicherl.github.io/CAD/)
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/CAD/" : "/",
  worker: { format: "es" },
  optimizeDeps: { exclude: ["replicad-opencascadejs"] },
  server: { host: true }, // permite abrir no tablet pela rede local durante o desenvolvimento
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
}));
