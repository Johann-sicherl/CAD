// WJFlow: núcleo puro do método de Lattice-Boltzmann (D3Q19), testado em Node
// (scripts/teste-flow.ts). É a referência exata do shader da GPU (src/flow/gpu.ts): mesma
// ordem de direções, mesmas populações deslocadas, mesmo contorno e mesma colisão, para a
// autoverificação comparar os dois. Física e escopo: docs/global/wjflow.md.
//
// Convenções:
// - Unidades de rede: Δx = Δt = 1, cs² = 1/3, ν = cs²(τ − ½).
// - Populações guardadas deslocadas: f̃ᵢ = fᵢ − wᵢ (ar parado = 0). Isso preserva precisão em
//   FP32/FP16, porque o que importa é o desvio do repouso, não o valor absoluto.
// - Armazenamento SoA: f[i·n + célula], célula = x + nx·(y + ny·z).
// - Passo "pull": cada célula puxa fᵢ da vizinha x − cᵢ, colide e grava no outro buffer.
// - Paredes: bounce-back no meio do caminho (vizinha sólida → devolve a população oposta da
//   própria célula). Células "EQ" (borda do túnel) ficam presas no equilíbrio da corrente livre.
// - Colisão BGK com LES de Smagorinsky opcional (Hou et al., 1996) e força de corpo de Guo (2002).

/** Velocidades discretas D3Q19: repouso, 6 faces, 12 arestas; oposta de i é i±1 (pares). */
export const CX = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 0, 0, 1, -1, 1, -1, 0, 0] as const;
export const CY = [0, 0, 0, 1, -1, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 1, -1] as const;
export const CZ = [0, 0, 0, 0, 0, 1, -1, 0, 0, 1, -1, 1, -1, 0, 0, -1, 1, -1, 1] as const;
export const W = [1 / 3, ...Array(6).fill(1 / 18), ...Array(12).fill(1 / 36)] as readonly number[];
export const Q = 19;
export const opp = (i: number) => (i === 0 ? 0 : i % 2 ? i + 1 : i - 1);

/** Tipo de cada célula. */
export const FLUIDO = 0;
export const SOLIDO = 1;
/** Equilíbrio fixo com a velocidade da corrente livre (entrada, saída e laterais do túnel). */
export const EQ = 2;

/** 18√2·Cs²: constante do Smagorinsky em τ = ½(τ₀ + √(τ₀² + 18√2·Cs²·|Π|/ρ)). */
export const smagorinsky = (cs: number) => 18 * Math.SQRT2 * cs * cs;

export interface ParametrosLbm {
  nx: number;
  ny: number;
  nz: number;
  /** Tempo de relaxação molecular τ₀ = 3ν + ½. */
  tau: number;
  /** Constante de Smagorinsky Cs (0 = sem modelo de turbulência). */
  cs?: number;
  /** Velocidade da corrente livre (unidades de rede), usada nas células EQ e na partida. */
  u?: [number, number, number];
  /** Força de corpo por volume (unidades de rede), uniforme. */
  g?: [number, number, number];
}

/** f̃ᵉᵠ (deslocado) da direção i, com δρ = ρ − 1. */
export function equilibrio(i: number, dr: number, ux: number, uy: number, uz: number): number {
  const cu = CX[i] * ux + CY[i] * uy + CZ[i] * uz;
  const uu = ux * ux + uy * uy + uz * uz;
  return W[i] * (dr + (1 + dr) * (3 * cu + 4.5 * cu * cu - 1.5 * uu));
}

/** Solver de referência em CPU (Float32, como a GPU). Serve a testes, autoverificação e base de desempenho. */
export class LbmCpu {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly n: number;
  readonly tipo: Uint8Array;
  f: Float32Array;
  private g: Float32Array;
  tau: number;
  cs: number;
  u: [number, number, number];
  forca: [number, number, number];
  passos = 0;

  constructor(p: ParametrosLbm, tipo?: Uint8Array) {
    this.nx = p.nx;
    this.ny = p.ny;
    this.nz = p.nz;
    this.n = p.nx * p.ny * p.nz;
    this.tipo = tipo ?? new Uint8Array(this.n);
    this.tau = p.tau;
    this.cs = p.cs ?? 0;
    this.u = p.u ?? [0, 0, 0];
    this.forca = p.g ?? [0, 0, 0];
    this.f = new Float32Array(Q * this.n);
    this.g = new Float32Array(Q * this.n);
    this.iniciar();
  }

  /** Partida impulsiva: todo fluido em equilíbrio com a corrente livre; sólido zerado. */
  iniciar() {
    const [ux, uy, uz] = this.u;
    for (let c = 0; c < this.n; c++) {
      for (let i = 0; i < Q; i++) this.f[i * this.n + c] = this.tipo[c] === SOLIDO ? 0 : equilibrio(i, 0, ux, uy, uz);
    }
    this.passos = 0;
  }

  /** Define o estado de uma célula a partir de ρ e u (casos de teste com campo inicial). */
  definir(c: number, rho: number, ux: number, uy: number, uz: number) {
    for (let i = 0; i < Q; i++) this.f[i * this.n + c] = equilibrio(i, rho - 1, ux, uy, uz);
  }

  passo() {
    const { nx, ny, nz, n, tipo, f, g } = this;
    const [ux0, uy0, uz0] = this.u;
    const [gx, gy, gz] = this.forca;
    const comForca = gx !== 0 || gy !== 0 || gz !== 0;
    const k = smagorinsky(this.cs);
    const fi = new Float64Array(Q);
    const fe = new Float64Array(Q);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const c = x + nx * (y + ny * z);
          const t = tipo[c];
          if (t === SOLIDO) {
            for (let i = 0; i < Q; i++) g[i * n + c] = 0;
            continue;
          }
          if (t === EQ) {
            for (let i = 0; i < Q; i++) g[i * n + c] = equilibrio(i, 0, ux0, uy0, uz0);
            continue;
          }
          // streaming (pull) com bounce-back
          for (let i = 0; i < Q; i++) {
            const sx = (x - CX[i] + nx) % nx;
            const sy = (y - CY[i] + ny) % ny;
            const sz = (z - CZ[i] + nz) % nz;
            const s = sx + nx * (sy + ny * sz);
            fi[i] = tipo[s] === SOLIDO ? f[opp(i) * n + c] : f[i * n + s];
          }
          this.colidir(fi, fe, k, comForca, gx, gy, gz);
          for (let i = 0; i < Q; i++) g[i * n + c] = fi[i];
        }
      }
    }
    this.g = f;
    this.f = g;
    this.passos++;
  }

  private colidir(fi: Float64Array, fe: Float64Array, k: number, comForca: boolean, gx: number, gy: number, gz: number) {
    let dr = 0, jx = 0, jy = 0, jz = 0;
    for (let i = 0; i < Q; i++) {
      dr += fi[i];
      jx += CX[i] * fi[i];
      jy += CY[i] * fi[i];
      jz += CZ[i] * fi[i];
    }
    const rho = 1 + dr;
    // Guo: velocidade física inclui metade do impulso da força
    const ux = (jx + 0.5 * gx) / rho, uy = (jy + 0.5 * gy) / rho, uz = (jz + 0.5 * gz) / rho;
    for (let i = 0; i < Q; i++) fe[i] = equilibrio(i, dr, ux, uy, uz);
    let tau = this.tau;
    if (k > 0) {
      let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
      for (let i = 0; i < Q; i++) {
        const d = fi[i] - fe[i];
        xx += CX[i] * CX[i] * d;
        yy += CY[i] * CY[i] * d;
        zz += CZ[i] * CZ[i] * d;
        xy += CX[i] * CY[i] * d;
        xz += CX[i] * CZ[i] * d;
        yz += CY[i] * CZ[i] * d;
      }
      const pi = Math.sqrt(xx * xx + yy * yy + zz * zz + 2 * (xy * xy + xz * xz + yz * yz));
      tau = 0.5 * (tau + Math.sqrt(tau * tau + (k * pi) / rho));
    }
    const w = 1 / tau;
    for (let i = 0; i < Q; i++) {
      let s = fi[i] + w * (fe[i] - fi[i]);
      if (comForca) {
        const cu = CX[i] * ux + CY[i] * uy + CZ[i] * uz;
        s += (1 - 0.5 * w) * W[i] * (
          (3 * (CX[i] - ux) + 9 * cu * CX[i]) * gx +
          (3 * (CY[i] - uy) + 9 * cu * CY[i]) * gy +
          (3 * (CZ[i] - uz) + 9 * cu * CZ[i]) * gz);
      }
      fi[i] = s;
    }
  }

  /** ρ e u (com a correção de Guo) de uma célula. */
  macro(c: number): { rho: number; ux: number; uy: number; uz: number } {
    let dr = 0, jx = 0, jy = 0, jz = 0;
    for (let i = 0; i < Q; i++) {
      const v = this.f[i * this.n + c];
      dr += v;
      jx += CX[i] * v;
      jy += CY[i] * v;
      jz += CZ[i] * v;
    }
    const rho = 1 + dr;
    const [gx, gy, gz] = this.forca;
    return { rho, ux: (jx + 0.5 * gx) / rho, uy: (jy + 0.5 * gy) / rho, uz: (jz + 0.5 * gz) / rho };
  }

  /** Massa total do fluido (Σρ). */
  massa(): number {
    let m = 0;
    for (let c = 0; c < this.n; c++) {
      if (this.tipo[c] === SOLIDO) continue;
      m += 1;
      for (let i = 0; i < Q; i++) m += this.f[i * this.n + c];
    }
    return m;
  }
}

/** Túnel de teste: caixa com bordas EQ e uma esfera de diâmetro d centrada em (cx, ny/2, nz/2). */
export function tunelEsfera(nx: number, ny: number, nz: number, d: number, cx = Math.round(nx / 4)): Uint8Array {
  const t = new Uint8Array(nx * ny * nz);
  const r2 = (d / 2) ** 2;
  const cy = (ny - 1) / 2, cz = (nz - 1) / 2;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const c = x + nx * (y + ny * z);
        if (x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1) t[c] = EQ;
        else if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r2) t[c] = SOLIDO;
      }
    }
  }
  return t;
}

// ---------------------------------------------------------------------------------------------
// Física em unidades reais (SI) e conversão para a rede

/** Ar seco a 20 °C e 1 atm (101 325 Pa). */
export const AR = { rho: 1.204, mu: 1.825e-5, nu: 1.516e-5, som: 343.2 } as const;

export const reynolds = (u: number, l: number, nu: number = AR.nu) => (u * l) / nu;
export const mach = (u: number, som: number = AR.som) => u / som;
/** Pressão dinâmica q = ½ρU² (Pa). */
export const pressaoDinamica = (u: number, rho: number = AR.rho) => 0.5 * rho * u * u;

export interface Escala {
  /** tamanho da célula (m) */
  dx: number;
  /** passo de tempo (s) */
  dt: number;
  /** velocidade na rede (adimensional; ≤ 0,1 para erro de compressibilidade < 1 %) */
  uRede: number;
  nuRede: number;
  /** τ₀ = 3ν + ½ (só a viscosidade molecular) */
  tau: number;
  /** Reynolds do problema real */
  re: number;
  /** Reynolds da célula U·Δx/ν: ≫ 1 significa camada limite não resolvida (precisa de LES/lei de parede) */
  reCelula: number;
  /** passos para o ar atravessar um comprimento L */
  passosPorL: number;
}

/**
 * Converte um problema real (comprimento L em m, velocidade U em m/s) para a rede com N células em L.
 * A velocidade de rede fixa o Δt: dt = uRede·dx/U. O Reynolds é mantido (mesmo ν físico).
 */
export function escalar(l: number, u: number, celulasEmL: number, uRede = 0.05, nu: number = AR.nu): Escala {
  const dx = l / celulasEmL;
  const dt = (uRede * dx) / u;
  const nuRede = (nu * dt) / (dx * dx);
  return { dx, dt, uRede, nuRede, tau: 3 * nuRede + 0.5, re: reynolds(u, l, nu), reCelula: (u * dx) / nu, passosPorL: celulasEmL / uRede };
}

export type Precisao = "fp32" | "fp16";

/**
 * Escala das populações guardadas em FP16 (2¹⁴, exata). GPUs móveis podem zerar números FP16
 * subnormais (< 6,1·10⁻⁵; "flush-to-zero", permitido pelo WebGPU e medido na Adreno 613), e as
 * populações deslocadas vivem nessa faixa. Guardando f̃·2¹⁴, o menor normal vira 3,7·10⁻⁹ e o
 * maior valor guardável, 4 (fisicamente |f̃| < 0,5). A precisão relativa (11 bits) não muda.
 */
export const ESCALA_FP16 = 16384;

/**
 * Arredonda para FP16. Padrão: ao par mais próximo (IEEE). `zerarSubnormais` e `truncar` imitam
 * o que a Adreno 613 faz no pack2x16float (medido no tablet do Johann), para os testes.
 */
export function meia(v: number, zerarSubnormais = false, truncar = false): number {
  const a = Math.abs(v);
  if (a === 0 || !Number.isFinite(v)) return v;
  const sub = a < 2 ** -14;
  if (sub && zerarSubnormais) return 0;
  const q = sub ? 2 ** -24 : 2 ** (Math.floor(Math.log2(a)) - 10);
  const r = a / q;
  let k = Math.floor(r);
  if (!truncar && (r - k > 0.5 || (r - k === 0.5 && k % 2 === 1))) k++;
  return Math.sign(v) * k * q;
}

/**
 * f32 → bits FP16 só com operações inteiras, ao par mais próximo, zerando o que ficaria
 * subnormal e saturando no maior finito. Espelho exato da função `meiaBits` do shader
 * (src/flow/gpu.ts): a conversão do driver (pack2x16float) não é confiável em GPUs móveis.
 */
export function meiaBits(v: number): number {
  const u = new Uint32Array(new Float32Array([v]).buffer)[0];
  const s = (u >>> 16) & 0x8000;
  const e = ((u >>> 23) & 0xff) - 112; // −127 + 15
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7bff;
  const m = u & 0x7fffff;
  let h = (e << 10) | (m >>> 13);
  const resto = m & 0x1fff;
  if (resto > 0x1000 || (resto === 0x1000 && (h & 1) === 1)) h++;
  return s | Math.min(h, 0x7bff);
}

/** Bits FP16 → número. */
export function meiaParaFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** Bytes por célula: dois buffers de 19 populações + 4 bytes de tipo. */
export const bytesPorCelula = (p: Precisao) => 2 * Q * (p === "fp32" ? 4 : 2) + 4;
