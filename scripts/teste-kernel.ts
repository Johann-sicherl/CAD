// Teste rápido do kernel em Node: regenera a peça exemplo e confere volume.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { documentoExemplo, novaFeature } from "../src/model";
import { regenerar, exportar } from "../src/kernel/regenerar";

const require = createRequire(import.meta.url);
const wasm = require.resolve("replicad-opencascadejs/wasm");
const OC = await (opencascade as any)({ locateFile: () => wasm });
setOC(OC);

const doc = documentoExemplo();
let r = regenerar(doc.features);
const esperado = 80*50*12 + Math.PI*15*15*18 - Math.PI*7*7*30;
console.log("volume", r.volume?.toFixed(1), "esperado", esperado.toFixed(1), "erros", r.erros);
console.log("tri", r.malha!.triangulos.length/3, "seg", r.malha!.arestas.length/6);

const fil = novaFeature("filete", 1) as any; fil.raio = 2;
r = regenerar([...doc.features, fil]); console.log("filete", r.volume?.toFixed(1), r.erros);
const grande = { ...fil, raio: 40 };
r = regenerar([...doc.features, grande]); console.log("filete grande", r.erros);
const rev = novaFeature("revolucao", 1);
r = regenerar([rev]); console.log("revolucao", r.volume?.toFixed(1), "esperado", (Math.PI*(20*20-10*10)*20).toFixed(1), r.erros);
for (const p of ["XZ","YZ"] as const) { const e = novaFeature("extrusao",1) as any; e.plano=p; e.deslocamento=5; r=regenerar([e]); console.log(p, r.volume?.toFixed(0), r.erros.length); }
const step = exportar("step"); console.log("step bytes", step.size, (await step.text()).slice(0,14));
const stl = exportar("stl"); console.log("stl bytes", stl.size);
