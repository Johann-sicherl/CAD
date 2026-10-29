// Ponte entre a interface e o Web Worker do kernel.
// Só a regeneração mais recente importa: pedidos antigos que chegarem atrasados são descartados.

import type { Feature, Referencia } from "../model";
import type { PedidoKernel, RespostaKernel } from "./worker";
import type { ResultadoRegeneracao } from "./regenerar";
import type { Projecao } from "./projecao";
import type { Camera, Orientacao } from "../desenho/modelo";
import type { ResumoPlanificado } from "./dxf";
import type { PropriedadesMassa, ResultadoMedida, ResultadoVerificacao } from "./avaliar";

type SemSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

/** Peça de um componente: malha, topologia (para selecionar e posicionar), volume e erros. */
export type ResultadoComponente = Pick<ResultadoRegeneracao, "malha" | "topologia" | "volume" | "erros">;

export class ClienteKernel {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private seq = 0;
  private ultimaRegeneracao = 0;
  private pendentes = new Map<number, { ok: (v: unknown) => void; falha: (e: Error) => void }>();

  readonly pronto: Promise<void>;

  constructor(private aoRegenerar: (r: ResultadoRegeneracao, ms: number) => void = () => {}) {
    this.pronto = new Promise((ok, falha) => {
      this.worker.onmessage = (ev: MessageEvent<RespostaKernel>) => {
        const r = ev.data;
        switch (r.tipo) {
          case "pronto":
            ok();
            break;
          case "falha-inicial":
            falha(new Error(r.mensagem));
            break;
          case "regenerado":
            if (r.seq === this.ultimaRegeneracao) this.aoRegenerar(r.resultado, r.ms);
            break;
          case "resposta":
            this.pendentes.get(r.seq)?.ok(r.dados);
            this.pendentes.delete(r.seq);
            break;
          case "erro":
            this.pendentes.get(r.seq)?.falha(new Error(r.mensagem));
            this.pendentes.delete(r.seq);
            break;
        }
      };
    });
  }

  /** `previa`: id do recurso em edição (o kernel devolve o material que ele tira). */
  regenerar(features: Feature[], planificar = false, previa?: string) {
    this.ultimaRegeneracao = ++this.seq;
    this.enviar({ tipo: "regenerar", seq: this.seq, features, planificar, previa });
  }

  /** DXF do planificado (da última regeneração) e o resumo da lista de corte. */
  dxf(nome: string) {
    return this.pedir<{ dxf: string; resumo: ResumoPlanificado }>({ tipo: "dxf", nome });
  }

  private pedir<T>(p: SemSeq<PedidoKernel>): Promise<T> {
    const seq = ++this.seq;
    return new Promise<T>((ok, falha) => {
      this.pendentes.set(seq, { ok: ok as (v: unknown) => void, falha });
      this.enviar({ ...p, seq } as PedidoKernel);
    });
  }

  exportar(formato: "step" | "stl") {
    return this.pedir<Blob>({ tipo: "exportar", formato });
  }
  medir(refs: Referencia[]) {
    return this.pedir<ResultadoMedida>({ tipo: "medir", refs });
  }
  massa() {
    return this.pedir<PropriedadesMassa>({ tipo: "massa" });
  }
  verificar() {
    return this.pedir<ResultadoVerificacao>({ tipo: "verificar" });
  }
  /** Vista de desenho: projeção dos sólidos (chaves de `componente`) em suas posições. */
  projetar(itens: { chave: string; t: { pos: [number, number, number]; rot: [number, number, number, number] } }[], orientacao: Orientacao | Camera, tol = 0.2) {
    return this.pedir<Projecao>({ tipo: "projetar", itens, orientacao, tol });
  }
  /** Regenera a peça de um componente (montagem/desenho); o sólido fica guardado no kernel pela chave. */
  componente(chave: string, features: Feature[]) {
    return this.pedir<ResultadoComponente>({ tipo: "componente", chave, features });
  }

  private enviar(p: PedidoKernel) {
    // cópia limpa: objetos da UI não vão para o worker
    this.worker.postMessage(JSON.parse(JSON.stringify(p)));
  }
}
