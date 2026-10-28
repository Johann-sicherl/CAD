// WJFlow: estudo de escoamento (puro, testado em Node). Arquivo .wjflow, preparação do túnel em
// unidades reais e conversão dos resultados (forças em N, coeficientes Cd/Cl/Cs).

import { montarDominio, paraTunel, propriedadesAr, type Direcao, type Dominio, type Malha, type PropriedadesAr } from "./geometria";
import { type Precisao } from "./lbm";

export type Modo = "rascunho" | "padrao" | "qualidade";
/** Malhas medidas no TCL Tab A1 Plus (docs/global/wjflow.md §13): ~2,5 / 5,5 / 13 min por resultado. */
export const MODOS: Record<Modo, { nome: string; celulas: number; precisao: Precisao }> = {
  rascunho: { nome: "Rascunho (~0,5 M células)", celulas: 500_000, precisao: "fp32" },
  padrao: { nome: "Padrão (~1 M células)", celulas: 1_000_000, precisao: "fp32" },
  qualidade: { nome: "Qualidade (~1,7 M células, FP16)", celulas: 1_700_000, precisao: "fp16" },
};
/** Tamanho do túnel: padrão (bloqueio 5 %) ou amplo (menos interferência das paredes, menos células na peça). */
export type Tunel = "padrao" | "amplo";
export const TUNEIS: Record<Tunel, { nome: string; montante: number; jusante: number; bloqueio: number }> = {
  padrao: { nome: "Padrão (bloqueio 5 %)", montante: 1.5, jusante: 4, bloqueio: 0.05 },
  amplo: { nome: "Amplo (bloqueio 2 %)", montante: 2, jusante: 3, bloqueio: 0.02 },
};
export type Unidade = "mm" | "cm" | "m" | "pol";
export const UNIDADES: Record<Unidade, number> = { mm: 1e-3, cm: 1e-2, m: 1, pol: 0.0254 };

/** Velocidade do ar na rede (Mach de rede ≈ 0,087: erro de compressibilidade < 1 %). */
export const U_REDE = 0.05;

export interface Resumo {
  cd: number;
  cl: number;
  cs: number;
  /** N (média) */
  forca: [number, number, number];
  /** m² */
  area: number;
  re: number;
  travessias: number;
  data: string;
  instavel?: boolean;
}

export interface Estudo {
  formato: "wjflow";
  versao: 1;
  nome: string;
  peca: { nome: string; origem: "wjcad" | "stl" | "validacao"; unidade: Unidade };
  direcao: Direcao;
  /** m/s */
  velocidade: number;
  /** °C */
  temperatura: number;
  /** m */
  altitude: number;
  modo: Modo;
  /** padrão quando ausente */
  tunel?: Tunel;
  travessias: number;
  /** m²; vazio = área frontal da peça voxelizada */
  areaReferencia?: number;
  /** caso de validação: Cd de referência da literatura */
  referencia?: { cd: number; fonte: string };
  resultado?: Resumo;
}

export function estudoNovo(): Estudo {
  return {
    formato: "wjflow", versao: 1, nome: "Estudo de escoamento",
    peca: { nome: "", origem: "wjcad", unidade: "mm" },
    direcao: "+x", velocidade: 20, temperatura: 20, altitude: 0, modo: "padrao", travessias: 3,
  };
}

/** Confere um .wjflow lido (campos que faltam voltam ao padrão). */
export function validarEstudo(x: unknown): Estudo {
  const e = x as Partial<Estudo> | null;
  if (!e || e.formato !== "wjflow") throw new Error("O arquivo não é um estudo do WJFlow (.wjflow).");
  const base = estudoNovo();
  return { ...base, ...e, peca: { ...base.peca, ...e.peca } } as Estudo;
}

export interface Preparo {
  dominio: Dominio;
  ar: PropriedadesAr;
  /** m */
  dx: number;
  /** s */
  dt: number;
  tau: number;
  re: number;
  mach: number;
  /** Reynolds da célula U·Δx/ν */
  reCelula: number;
  passosTotal: number;
  passosTravessia: number;
  /** início da média (passo) */
  inicioMedia: number;
  /** m² */
  areaRef: number;
  /** área de referência em células² (para os coeficientes) */
  areaRefCelulas: number;
  esponja: { x0: number; dtau: number; sigma: number; entrada: number };
  precisao: Precisao;
  /** comprimento da peça na direção do ar (m) */
  comprimento: number;
  /** a peça orientada e em metros, no sistema do túnel (vista 3D) */
  malhaTunel: Malha;
}

/** Orienta, escala para metros e monta o túnel do estudo. */
export function preparar(e: Estudo, malha: Malha): Preparo {
  const k = UNIDADES[e.peca.unidade];
  const orientada = paraTunel(malha, e.direcao);
  const v = new Float32Array(orientada.vertices.length);
  for (let i = 0; i < v.length; i++) v[i] = orientada.vertices[i] * k;
  const modo = MODOS[e.modo];
  const tunel = TUNEIS[e.tunel ?? "padrao"];
  const dominio = montarDominio({ vertices: v, triangulos: orientada.triangulos }, { celulas: modo.celulas, montante: tunel.montante, jusante: tunel.jusante, bloqueio: tunel.bloqueio });
  if (!dominio.celulasSolidas) throw new Error("A peça ficou menor que uma célula do túnel: confira a unidade da peça.");
  const ar = propriedadesAr(e.temperatura, e.altitude);
  const dx = dominio.dx;
  const dt = (U_REDE * dx) / e.velocidade;
  const nuRede = (ar.nu * dt) / (dx * dx);
  const passosTravessia = Math.round(dominio.nx / U_REDE);
  const passosTotal = Math.round(e.travessias * passosTravessia);
  const areaFrontal = dominio.areaFrontal * dx * dx;
  const areaRef = e.areaReferencia && e.areaReferencia > 0 ? e.areaReferencia : areaFrontal;
  const larguraEsponja = Math.max(6, Math.round(0.12 * dominio.nx));
  return {
    dominio, ar, dx, dt, tau: 3 * nuRede + 0.5,
    re: (e.velocidade * dominio.comprimento) / ar.nu,
    mach: e.velocidade / ar.som,
    reCelula: (e.velocidade * dx) / ar.nu,
    passosTravessia, passosTotal,
    inicioMedia: Math.max(0, passosTotal - passosTravessia),
    areaRef, areaRefCelulas: areaRef / (dx * dx),
    // zona esponja na saída e camadas absorventes nas duas pontas (ondas de pressão)
    esponja: { x0: dominio.nx - 1 - larguraEsponja, dtau: 0.5, sigma: 0.1, entrada: Math.max(4, Math.round(0.06 * dominio.nx)) },
    precisao: modo.precisao,
    comprimento: dominio.comprimento,
    malhaTunel: { vertices: v, triangulos: orientada.triangulos },
  };
}

/** Força da rede (por passo) → N. */
export function forcaReal(f: [number, number, number], p: Preparo): [number, number, number] {
  const k = (p.ar.rho * p.dx ** 4) / (p.dt * p.dt);
  return [f[0] * k, f[1] * k, f[2] * k];
}

/** Coeficientes C = F / (½ρU²A): na rede ρ = 1 e U = U_REDE. */
export function coeficientes(f: [number, number, number], p: Preparo): [number, number, number] {
  const q = 0.5 * U_REDE * U_REDE * p.areaRefCelulas;
  return [f[0] / q, f[1] / q, f[2] / q];
}

/** Média das amostras de força a partir de um passo (amostras de mesmo peso). */
export class Historico {
  passos: number[] = [];
  forcas: [number, number, number][] = [];
  adicionar(passo: number, f: [number, number, number]) {
    this.passos.push(passo);
    this.forcas.push(f);
  }
  media(desde: number): [number, number, number] | null {
    let n = 0;
    const s: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < this.passos.length; i++) {
      if (this.passos[i] < desde) continue;
      n++;
      for (let k = 0; k < 3; k++) s[k] += this.forcas[i][k];
    }
    return n ? [s[0] / n, s[1] / n, s[2] / n] : null;
  }
  /** CSV (passo; Fx; Fy; Fz na rede e em N; coeficientes). */
  csv(p: Preparo): string {
    const L = ["passo;tempo (s);Fx (N);Fy (N);Fz (N);Cd;Cl;Cs"];
    this.passos.forEach((ps, i) => {
      const fr = forcaReal(this.forcas[i], p), c = coeficientes(this.forcas[i], p);
      L.push([ps, (ps * p.dt).toExponential(4), ...fr.map((v) => v.toExponential(5)), ...c.map((v) => v.toFixed(5))].join(";").replace(/\./g, ","));
    });
    return L.join("\n");
  }
}

// ---------------------------------------------------------------------------------------------
// malha compacta no arquivo (.wjflow leva a peça junto para reabrir sozinho)

/** Junta vértices repetidos (STL repete cada vértice em cada triângulo). */
export function compactar(m: Malha): Malha {
  const mapa = new Map<string, number>();
  const v: number[] = [];
  const t = new Uint32Array(m.triangulos.length);
  for (let i = 0; i < m.triangulos.length; i++) {
    const a = 3 * m.triangulos[i];
    const chave = `${m.vertices[a]},${m.vertices[a + 1]},${m.vertices[a + 2]}`;
    let id = mapa.get(chave);
    if (id === undefined) {
      id = v.length / 3;
      mapa.set(chave, id);
      v.push(m.vertices[a], m.vertices[a + 1], m.vertices[a + 2]);
    }
    t[i] = id;
  }
  return { vertices: new Float32Array(v), triangulos: t };
}

const paraBase64 = (b: ArrayBufferLike) => {
  const u = new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const deBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

export interface ArquivoWjflow extends Estudo {
  malha?: { vertices: string; triangulos: string };
}

export function serializar(e: Estudo, m: Malha | null): string {
  const a: ArquivoWjflow = { ...e };
  if (m) {
    const c = compactar(m);
    a.malha = { vertices: paraBase64(c.vertices.buffer), triangulos: paraBase64(c.triangulos.buffer) };
  }
  return JSON.stringify(a);
}

export function desserializar(texto: string): { estudo: Estudo; malha: Malha | null } {
  const a = JSON.parse(texto) as ArquivoWjflow;
  const estudo = validarEstudo(a);
  delete (estudo as ArquivoWjflow).malha;
  const malha = a.malha ? { vertices: new Float32Array(deBase64(a.malha.vertices)), triangulos: new Uint32Array(deBase64(a.malha.triangulos)) } : null;
  return { estudo, malha };
}
