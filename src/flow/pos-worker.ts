// WJFlow: pós-processamento da vista 3D fora da thread da interface — Cp na superfície da peça,
// linhas de corrente e imagem do plano de corte, a partir do campo copiado da GPU.
import { corDivergente, corSequencial, cpNaSuperficie, imagemDoCorte, linhaDeCorrente, sementes, type Campo, type GrandezaCorte } from "./campo";
import type { Malha } from "./geometria";

export interface PedidoPos {
  campo: Campo;
  /** peça em coordenadas de célula */
  malha: Malha;
  linhas: number;
  corte: { plano: 0 | 1; indice: number; grandeza: GrandezaCorte; escalaVort: number };
}
export interface RespostaPos {
  /** RGB por vértice da peça (Cp) */
  coresPeca: Float32Array;
  cpMin: number;
  cpMax: number;
  /** segmentos (pares de pontos) e cores por ponto */
  linhas: Float32Array;
  coresLinhas: Float32Array;
  imagem: { largura: number; altura: number; rgba: Uint8Array };
}

self.onmessage = (e: MessageEvent<PedidoPos>) => {
  const { campo, malha, linhas, corte } = e.data;
  // Cp na superfície
  const cp = cpNaSuperficie(campo, malha, (p) => p);
  const coresPeca = new Float32Array(cp.length * 3);
  let cpMin = Infinity, cpMax = -Infinity;
  cp.forEach((v, i) => {
    // escala ±1: Cp = 1 é a estagnação (o máximo físico em escoamento incompressível)
    const c = Number.isFinite(v) ? corDivergente(v) : [0.6, 0.62, 0.66];
    if (Number.isFinite(v)) {
      cpMin = Math.min(cpMin, v);
      cpMax = Math.max(cpMax, v);
    }
    coresPeca.set(c, 3 * i);
  });
  // linhas de corrente: grade de sementes antes da peça, cobrindo a frente dela com folga
  const seg: number[] = [], cor: number[] = [];
  if (linhas > 0) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const v = malha.vertices;
    for (let i = 0; i < v.length; i += 3) {
      x0 = Math.min(x0, v[i]); x1 = Math.max(x1, v[i]);
      y0 = Math.min(y0, v[i + 1]); y1 = Math.max(y1, v[i + 1]);
      z0 = Math.min(z0, v[i + 2]); z1 = Math.max(z1, v[i + 2]);
    }
    const fy = 0.3 * (y1 - y0) + 2, fz = 0.3 * (z1 - z0) + 2;
    const xs = Math.max(1.5, x0 - 0.3 * (x1 - x0) - 2);
    const s = sementes(xs, Math.max(1.5, y0 - fy), Math.min(campo.ny - 2.5, y1 + fy), Math.max(1.5, z0 - fz), Math.min(campo.nz - 2.5, z1 + fz), linhas);
    for (const p of s) {
      const l = linhaDeCorrente(campo, p);
      for (let k = 0; k + 1 < l.rapidez.length; k++) {
        seg.push(l.pontos[3 * k], l.pontos[3 * k + 1], l.pontos[3 * k + 2], l.pontos[3 * k + 3], l.pontos[3 * k + 4], l.pontos[3 * k + 5]);
        // tons escurecidos para destacar sobre o plano de corte
        for (const r of [l.rapidez[k], l.rapidez[k + 1]]) cor.push(...corSequencial(r / 1.5).map((x) => 0.7 * x));
      }
    }
  }
  const imagem = imagemDoCorte(campo, corte.plano, corte.indice, corte.grandeza, corte.escalaVort);
  const r: RespostaPos = { coresPeca, cpMin, cpMax, linhas: new Float32Array(seg), coresLinhas: new Float32Array(cor), imagem };
  postMessage(r, { transfer: [r.coresPeca.buffer, r.linhas.buffer, r.coresLinhas.buffer, r.imagem.rgba.buffer] });
};
