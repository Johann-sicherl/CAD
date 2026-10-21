// Web Worker do kernel: o OpenCascade roda fora da thread da interface,
// assim o tablet continua respondendo ao toque enquanto a peça regenera.

import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import type { Feature } from "../model";
import { exportar, regenerar } from "./regenerar";

export type PedidoKernel =
  | { tipo: "regenerar"; seq: number; features: Feature[] }
  | { tipo: "exportar"; seq: number; formato: "step" | "stl" };

export type RespostaKernel =
  | { tipo: "pronto" }
  | { tipo: "falha-inicial"; mensagem: string }
  | { tipo: "regenerado"; seq: number; resultado: ReturnType<typeof regenerar>; ms: number }
  | { tipo: "exportado"; seq: number; blob: Blob }
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
    if (p.tipo === "regenerar") {
      const t0 = performance.now();
      const resultado = regenerar(p.features);
      const ms = performance.now() - t0;
      const m = resultado.malha;
      enviar(
        { tipo: "regenerado", seq: p.seq, resultado, ms },
        m ? [m.vertices.buffer, m.normais.buffer, m.triangulos.buffer, m.arestas.buffer, m.faces.buffer] : [],
      );
    } else {
      enviar({ tipo: "exportado", seq: p.seq, blob: exportar(p.formato) });
    }
  } catch (e) {
    enviar({ tipo: "erro", seq: p.seq, mensagem: e instanceof Error ? e.message : String(e) });
  }
};
