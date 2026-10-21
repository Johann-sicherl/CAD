// Ponte entre a interface e o Web Worker do kernel.
// Só a regeneração mais recente importa: pedidos antigos que chegarem atrasados são descartados.

import type { Feature } from "../model";
import type { PedidoKernel, RespostaKernel } from "./worker";
import type { ResultadoRegeneracao } from "./regenerar";

export class ClienteKernel {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private seq = 0;
  private ultimaRegeneracao = 0;
  private pendentes = new Map<number, { ok: (v: never) => void; falha: (e: Error) => void }>();

  readonly pronto: Promise<void>;

  constructor(private aoRegenerar: (r: ResultadoRegeneracao, ms: number) => void) {
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
          case "exportado":
            this.pendentes.get(r.seq)?.ok(r.blob as never);
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

  regenerar(features: Feature[]) {
    this.ultimaRegeneracao = ++this.seq;
    this.enviar({ tipo: "regenerar", seq: this.seq, features });
  }

  exportar(formato: "step" | "stl"): Promise<Blob> {
    const seq = ++this.seq;
    return new Promise<Blob>((ok, falha) => {
      this.pendentes.set(seq, { ok: ok as (v: never) => void, falha });
      this.enviar({ tipo: "exportar", seq, formato });
    });
  }

  private enviar(p: PedidoKernel) {
    // structuredClone garante que objetos reativos/proxies da UI não vão para o worker
    this.worker.postMessage(JSON.parse(JSON.stringify(p)));
  }
}
