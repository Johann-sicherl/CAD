// WJFlow: pós-processamento do campo 3D (puro, testado em Node: scripts/teste-flow.ts).
// O campo vem da GPU como vec4 por célula (ux, uy, uz, δρ), em unidades de rede, na ordem
// c = x + nx·(y + ny·z). Daqui saem: Cp na superfície da peça, linhas de corrente 3D (RK2 com
// interpolação trilinear) e a imagem do plano de corte para a vista 3D.

import { SOLIDO } from "./lbm";
import type { Malha, Vec3 } from "./geometria";

export interface Campo {
  nx: number;
  ny: number;
  nz: number;
  /** vec4 por célula: ux, uy, uz, δρ (unidades de rede) */
  dados: Float32Array;
  /** tipo de cada célula (bits 0–1: fluido/sólido/EQ/saída) */
  tipo: Uint8Array;
  /** velocidade do ar na rede (normaliza as cores) */
  u: number;
}

const solido = (k: Campo, c: number) => (k.tipo[c] & 3) === SOLIDO;

/** Cp = (p − p∞)/(½ρU²) com p = ρ/3 na rede: δρ/(1,5·U²). */
export const cpDe = (dr: number, u: number) => dr / (1.5 * u * u);

/** Velocidade interpolada (trilinear) na posição em células; null fora do túnel ou no sólido. */
export function velocidadeEm(k: Campo, x: number, y: number, z: number): Vec3 | null {
  if (x < 0 || y < 0 || z < 0 || x > k.nx - 1 || y > k.ny - 1 || z > k.nz - 1) return null;
  const x0 = Math.min(Math.floor(x), k.nx - 2), y0 = Math.min(Math.floor(y), k.ny - 2), z0 = Math.min(Math.floor(z), k.nz - 2);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  // célula mais próxima sólida: a linha bateu na peça
  if (solido(k, Math.round(x) + k.nx * (Math.round(y) + k.ny * Math.round(z)))) return null;
  const r: Vec3 = [0, 0, 0];
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        if (!w) continue;
        const c = 4 * (x0 + dx + k.nx * (y0 + dy + k.ny * (z0 + dz)));
        r[0] += w * k.dados[c];
        r[1] += w * k.dados[c + 1];
        r[2] += w * k.dados[c + 2];
      }
    }
  }
  return r;
}

export interface OpcoesLinha {
  /** passo em células (padrão 0,5) */
  passo?: number;
  /** comprimento máximo em células (padrão 3·nx) */
  maximo?: number;
}

/**
 * Linha de corrente a partir de uma semente (em células), integrada com Runge–Kutta de 2ª ordem
 * em passos de comprimento fixo. Devolve pontos (x, y, z) e a velocidade |u|/U em cada ponto.
 * Para no sólido, na saída do túnel, em regiões quase paradas ou no comprimento máximo.
 */
export function linhaDeCorrente(k: Campo, semente: Vec3, o: OpcoesLinha = {}): { pontos: number[]; rapidez: number[] } {
  const h = o.passo ?? 0.5, max = o.maximo ?? 3 * k.nx;
  const pontos: number[] = [], rapidez: number[] = [];
  let p = semente;
  const dir = (v: Vec3) => {
    const m = Math.hypot(v[0], v[1], v[2]);
    return m < 1e-4 * k.u ? null : ([v[0] / m, v[1] / m, v[2] / m] as Vec3);
  };
  for (let s = 0; s <= max; s += h) {
    const v1 = velocidadeEm(k, ...p);
    const d1 = v1 && dir(v1);
    if (!v1 || !d1) break;
    pontos.push(...p);
    rapidez.push(Math.hypot(...v1) / k.u);
    const meio: Vec3 = [p[0] + 0.5 * h * d1[0], p[1] + 0.5 * h * d1[1], p[2] + 0.5 * h * d1[2]];
    const v2 = velocidadeEm(k, ...meio);
    const d2 = v2 && dir(v2);
    if (!d2) break;
    p = [p[0] + h * d2[0], p[1] + h * d2[1], p[2] + h * d2[2]];
  }
  return { pontos, rapidez };
}

/** Sementes numa grade n × n no plano y-z, em x, cobrindo a caixa [y0, y1] × [z0, z1] (células). */
export function sementes(x: number, y0: number, y1: number, z0: number, z1: number, n: number): Vec3[] {
  const s: Vec3[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) s.push([x, y0 + ((y1 - y0) * (j + 0.5)) / n, z0 + ((z1 - z0) * (i + 0.5)) / n]);
  }
  return s;
}

/** Normais por vértice (média das faces, ponderada pela área). */
export function normaisDosVertices(m: Malha): Float32Array {
  const n = new Float32Array(m.vertices.length);
  const v = m.vertices, t = m.triangulos;
  for (let i = 0; i < t.length; i += 3) {
    const a = 3 * t[i], b = 3 * t[i + 1], c = 3 * t[i + 2];
    const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
    const e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const q of [a, b, c]) {
      n[q] += nx;
      n[q + 1] += ny;
      n[q + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const m2 = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= m2;
    n[i + 1] /= m2;
    n[i + 2] /= m2;
  }
  return n;
}

/**
 * Cp em cada vértice da peça: lê a primeira célula de fluido ao longo da normal (a ½, 1, 1½, 2 e
 * 3 células da superfície). `aCelula` leva o vértice para coordenadas de célula. NaN quando não acha
 * fluido (cavidade fechada menor que a célula).
 */
export function cpNaSuperficie(k: Campo, m: Malha, aCelula: (p: Vec3) => Vec3): Float32Array {
  const nor = normaisDosVertices(m);
  const cp = new Float32Array(m.vertices.length / 3).fill(NaN);
  for (let i = 0; i < cp.length; i++) {
    const g = aCelula([m.vertices[3 * i], m.vertices[3 * i + 1], m.vertices[3 * i + 2]]);
    // primeiro para fora (normal da regra do STL); malha com sentido trocado: tenta o outro lado
    procura: for (const sinal of [1, -1]) {
      for (const d of [0.5, 1, 1.5, 2, 3]) {
        const x = Math.round(g[0] + sinal * d * nor[3 * i]), y = Math.round(g[1] + sinal * d * nor[3 * i + 1]), z = Math.round(g[2] + sinal * d * nor[3 * i + 2]);
        if (x < 0 || y < 0 || z < 0 || x >= k.nx || y >= k.ny || z >= k.nz) break;
        const c = x + k.nx * (y + k.ny * z);
        if (solido(k, c)) continue;
        cp[i] = cpDe(k.dados[4 * c + 3], k.u);
        break procura;
      }
    }
  }
  return cp;
}

// ---------------------------------------------------------------------------------------------
// cores (as mesmas do corte 2D da GPU)

const SEQ: Vec3[] = [[0.18, 0.3, 0.75], [0.2, 0.7, 0.85], [0.4, 0.8, 0.35], [0.98, 0.82, 0.25], [0.85, 0.22, 0.18]];
/** Escala sequencial (t de 0 a 1). */
export function corSequencial(t: number): Vec3 {
  const s = Math.min(1, Math.max(0, t)) * 4;
  const i = Math.min(3, Math.floor(s)), f = s - i;
  const a = SEQ[i], b = SEQ[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
/** Escala divergente (t de −1 a 1): azul, branco, vermelho. */
export function corDivergente(t: number): Vec3 {
  const s = Math.min(1, Math.max(-1, t));
  const branco: Vec3 = [0.97, 0.97, 0.97];
  const fim: Vec3 = s < 0 ? [0.17, 0.33, 0.78] : [0.84, 0.19, 0.15];
  const f = Math.abs(s);
  return [branco[0] + (fim[0] - branco[0]) * f, branco[1] + (fim[1] - branco[1]) * f, branco[2] + (fim[2] - branco[2]) * f];
}

export type GrandezaCorte = "velocidade" | "ux" | "cp" | "vorticidade";

/**
 * Imagem RGBA do plano de corte (como no 2D): plano 0 = x-y em z = indice; plano 1 = x-z em
 * y = indice. Linha 0 da imagem = maior y (plano 0) ou z = 0 (plano 1), igual ao canvas 2D.
 */
export function imagemDoCorte(k: Campo, plano: 0 | 1, indice: number, g: GrandezaCorte, escalaVort: number): { largura: number; altura: number; rgba: Uint8Array } {
  const altura = plano === 0 ? k.ny : k.nz;
  const rgba = new Uint8Array(4 * k.nx * altura);
  const vel = (x: number, y: number, z: number, e: number) => {
    const c = x + k.nx * (y + k.ny * z);
    return solido(k, c) ? 0 : k.dados[4 * c + e];
  };
  for (let r = 0; r < altura; r++) {
    for (let x = 0; x < k.nx; x++) {
      const y = plano === 0 ? k.ny - 1 - r : indice;
      const z = plano === 0 ? indice : r;
      const c = x + k.nx * (y + k.ny * z);
      let cor: Vec3;
      if (solido(k, c)) cor = [0.54, 0.58, 0.62];
      else {
        const d = k.dados;
        if (g === "ux") cor = corDivergente(d[4 * c] / k.u / 1.5);
        else if (g === "cp") cor = corDivergente(cpDe(d[4 * c + 3], k.u) / 1.5);
        else if (g === "vorticidade") {
          const xa = Math.max(0, x - 1), xb = Math.min(k.nx - 1, x + 1);
          const w = plano === 0
            ? 0.5 * (vel(xb, y, z, 1) - vel(xa, y, z, 1)) - 0.5 * (vel(x, Math.min(k.ny - 1, y + 1), z, 0) - vel(x, Math.max(0, y - 1), z, 0))
            : 0.5 * (vel(x, y, Math.min(k.nz - 1, z + 1), 0) - vel(x, y, Math.max(0, z - 1), 0)) - 0.5 * (vel(xb, y, z, 2) - vel(xa, y, z, 2));
          cor = corDivergente(w * escalaVort);
        } else cor = corSequencial(Math.hypot(d[4 * c], d[4 * c + 1], d[4 * c + 2]) / k.u / 1.5);
      }
      const o = 4 * (r * k.nx + x);
      rgba[o] = cor[0] * 255;
      rgba[o + 1] = cor[1] * 255;
      rgba[o + 2] = cor[2] * 255;
      rgba[o + 3] = 255;
    }
  }
  return { largura: k.nx, altura, rgba };
}
