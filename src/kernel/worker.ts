// Web Worker do kernel: o OpenCascade roda fora da thread da interface,
// assim o tablet continua respondendo ao toque enquanto a peça regenera.

import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { makeCompound, measureShapeVolumeProperties, setOC, type Shape3D } from "replicad";
import type { Feature, Referencia, Vec3 } from "../model";
import { posicionar, projetar } from "./projecao";
import type { Camera, Orientacao } from "../desenho/modelo";
import { ehFatal, exportar, exportarDxf, pecaAtual, regenerar, regenerarComRecuperacao } from "./regenerar";
import { massa, medir, verificar } from "./avaliar";

export type PedidoKernel =
  | { tipo: "regenerar"; seq: number; features: Feature[]; planificar?: boolean; previa?: string }
  | { tipo: "dxf"; seq: number; nome: string }
  | { tipo: "exportar"; seq: number; formato: "step" | "stl" }
  | { tipo: "medir"; seq: number; refs: Referencia[] }
  | { tipo: "massa"; seq: number }
  | { tipo: "verificar"; seq: number }
  /** Peça de um componente de montagem/desenho: regenera e guarda o sólido pela chave do conteúdo. */
  | { tipo: "componente"; seq: number; chave: string; features: Feature[] }
  /** Vista de desenho: projeção (linhas visíveis e ocultas) dos sólidos já guardados, posicionados. */
  /** Montagem: volumes de interferência entre componentes (pares com caixas que se cruzam). */
  | { tipo: "interferencia"; seq: number; itens: { comp: string; chave: string; t: { pos: Vec3; rot: [number, number, number, number] } }[] }
  /** Volume, área e centro de massa (coordenadas da peça) de cada sólido guardado. */
  | { tipo: "massaPecas"; seq: number; chaves: string[] }
  /** Medir na montagem: entidades em coordenadas da montagem nos componentes posicionados. */
  | { tipo: "medirMontagem"; seq: number; itens: { chave: string; t: { pos: Vec3; rot: [number, number, number, number] } }[]; refs: Referencia[] }
  | { tipo: "projetar"; seq: number; itens: { chave: string; t: { pos: Vec3; rot: [number, number, number, number] } }[]; orientacao: Orientacao | Camera; tol: number };

export type RespostaKernel =
  | { tipo: "pronto" }
  | { tipo: "falha-inicial"; mensagem: string }
  | { tipo: "regenerado"; seq: number; resultado: ReturnType<typeof regenerar>; ms: number }
  | { tipo: "resposta"; seq: number; dados: unknown }
  | { tipo: "erro"; seq: number; mensagem: string };

const enviar = (r: RespostaKernel, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(r, transfer);

/** Carrega (ou recarrega, depois de uma falha fatal) o OpenCascade. */
async function carregarKernel() {
  const OC = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => wasmUrl,
  });
  setOC(OC as never);
  // kernel recarregado: os sólidos guardados eram do OpenCascade antigo
  solidosComponentes.clear();
}

const inicializado = carregarKernel();

/** Sólidos das peças de montagens e desenhos, pela chave do conteúdo (interferência, vistas). */
export const solidosComponentes = new Map<string, Shape3D>();

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
        const resultado = await regenerarComRecuperacao(p.features, 0.05, { planificar: p.planificar, previa: p.previa }, carregarKernel);
        const ms = performance.now() - t0;
        const m = resultado.malha, pr = resultado.previaRemovido;
        enviar(
          { tipo: "regenerado", seq: p.seq, resultado, ms },
          [
            ...(m ? [m.vertices.buffer, m.normais.buffer, m.triangulos.buffer, m.arestas.buffer, m.faces.buffer, m.gruposArestas.buffer] : []),
            ...(pr ? [pr.vertices.buffer, pr.normais.buffer, pr.triangulos.buffer, pr.arestas.buffer] : []),
          ],
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
      case "projetar": {
        const solidos = p.itens.map((it) => {
          const s = solidosComponentes.get(it.chave);
          if (!s) throw new Error("Peça ainda não calculada no kernel.");
          return posicionar(s, it.t);
        });
        const r = projetar(solidos, p.orientacao, p.tol);
        for (const s of solidos) s.delete();
        enviar({ tipo: "resposta", seq: p.seq, dados: r });
        break;
      }
      case "interferencia": {
        const pos = p.itens.map((it) => {
          const s = solidosComponentes.get(it.chave);
          if (!s) throw new Error("Peça ainda não calculada no kernel.");
          const f = posicionar(s, it.t);
          return { comp: it.comp, f, caixa: f.boundingBox };
        });
        const achadas: { a: string; b: string; volume: number }[] = [];
        for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
          const A = pos[i], B = pos[j];
          if (A.caixa.isOut(B.caixa)) continue;
          try {
            const c = A.f.intersect(B.f);
            const v = measureShapeVolumeProperties(c).volume;
            c.delete();
            // faces encostadas dão volume ~0: não é interferência
            if (v > 1e-4) achadas.push({ a: A.comp, b: B.comp, volume: v });
          } catch {
            /* booleano falhou neste par: segue com os outros */
          }
        }
        for (const x of pos) {
          x.caixa.delete();
          x.f.delete();
        }
        enviar({ tipo: "resposta", seq: p.seq, dados: achadas });
        break;
      }
      case "massaPecas": {
        const out: Record<string, { volume: number; area: number; centro: Vec3 }> = {};
        for (const k of p.chaves) {
          const s = solidosComponentes.get(k);
          if (!s) continue;
          const m = massa(s);
          out[k] = { volume: m.volume, area: m.area, centro: m.centro };
        }
        enviar({ tipo: "resposta", seq: p.seq, dados: out });
        break;
      }
      case "medirMontagem": {
        const formas = p.itens.map((it) => {
          const s = solidosComponentes.get(it.chave);
          if (!s) throw new Error("Peça ainda não calculada no kernel.");
          return posicionar(s, it.t);
        });
        const junta = formas.length > 1 ? (makeCompound(formas) as unknown as Shape3D) : formas[0];
        try {
          enviar({ tipo: "resposta", seq: p.seq, dados: medir(junta, p.refs) });
        } finally {
          junta.delete(); // makeCompound já apagou as formas de entrada
        }
        break;
      }
      case "componente": {
        const r = await regenerarComRecuperacao(p.features, 0.05, {}, carregarKernel);
        const peca = pecaAtual();
        if (peca) solidosComponentes.set(p.chave, peca);
        const m = r.malha;
        enviar(
          { tipo: "resposta", seq: p.seq, dados: { malha: m, topologia: r.topologia, volume: r.volume, erros: r.erros } },
          m ? [m.vertices.buffer, m.normais.buffer, m.triangulos.buffer, m.arestas.buffer, m.faces.buffer, m.gruposArestas.buffer] : [],
        );
        break;
      }
    }
  } catch (e) {
    // exportar/medir/massa também podem derrubar o kernel: recarrega para a próxima vez
    if (ehFatal(e)) await carregarKernel().catch(() => {});
    enviar({ tipo: "erro", seq: p.seq, mensagem: ehFatal(e) ? "O kernel falhou nesta operação e foi reiniciado: tente de novo." : e instanceof Error ? e.message : String(e) });
  }
};
