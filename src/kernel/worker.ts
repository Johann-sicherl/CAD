// Web Worker do kernel: o OpenCascade roda fora da thread da interface,
// assim o tablet continua respondendo ao toque enquanto a peça regenera.

import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import type { Feature, Referencia } from "../model";
import { exportar, exportarDxf, pecaAtual, regenerar } from "./regenerar";
import { massa, medir, verificar } from "./avaliar";

export type PedidoKernel =
  | { tipo: "regenerar"; seq: number; features: Feature[]; planificar?: boolean }
  | { tipo: "dxf"; seq: number; nome: string }
  | { tipo: "exportar"; seq: number; formato: "step" | "stl" }
  | { tipo: "medir"; seq: number; refs: Referencia[] }
  | { tipo: "massa"; seq: number }
  | { tipo: "verificar"; seq: number };

export type RespostaKernel =
  | { tipo: "pronto" }
  | { tipo: "falha-inicial"; mensagem: string }
  | { tipo: "regenerado"; seq: number; resultado: ReturnType<typeof regenerar>; ms: number }
  | { tipo: "resposta"; seq: number; dados: unknown }
  | { tipo: "erro"; seq: number; mensagem: string };

const enviar = (r: RespostaKernel, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(r, transfer);

const inicializado = (async () => {
  const OC = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => wasmUrl,
  });
  setOC(OC as never);
})();

inicializado
  .then(() => enviar({ tipo: "pronto" }))
  .catch((e) => enviar({ tipo: "falha-inicial", mensagem: String(e) }));

self.onmessage = async (ev: MessageEvent<PedidoKernel>) => {
  await inicializado;
  const p = ev.data;
  try {
    switch (p.tipo) {
      case "regenerar": {
        const t0 = performance.now();
        const resultado = regenerar(p.features, 0.05, { planificar: p.planificar });
        const ms = performance.now() - t0;
        const m = resultado.malha;
        enviar(
          { tipo: "regenerado", seq: p.seq, resultado, ms },
          m ? [m.vertices.buffer, m.normais.buffer, m.triangulos.buffer, m.arestas.buffer, m.faces.buffer, m.gruposArestas.buffer] : [],
        );
        break;
      }
      case "exportar":
        enviar({ tipo: "resposta", seq: p.seq, dados: exportar(p.formato) });
        break;
      case "dxf":
        enviar({ tipo: "resposta", seq: p.seq, dados: exportarDxf(p.nome) });
        break;
      case "medir":
        enviar({ tipo: "resposta", seq: p.seq, dados: medir(pecaAtual(), p.refs) });
        break;
      case "massa":
        enviar({ tipo: "resposta", seq: p.seq, dados: massa(pecaAtual()) });
        break;
      case "verificar":
        enviar({ tipo: "resposta", seq: p.seq, dados: verificar(pecaAtual()) });
        break;
    }
  } catch (e) {
    enviar({ tipo: "erro", seq: p.seq, mensagem: e instanceof Error ? e.message : String(e) });
  }
};
