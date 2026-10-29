// Cena da montagem: junta as malhas dos componentes (cada uma na posição do componente) numa
// malha só, com a topologia junta, para o viewport mostrar, selecionar, destacar e cortar como faz
// com a peça. O mapa diz de qual componente veio cada face/aresta/vértice (e o índice dentro da
// peça), para os posicionamentos guardarem a referência na peça. Puro (testado em teste-montagem).

import type { MalhaPeca } from "../kernel/regenerar";
import type { Topologia } from "../kernel/topologia";
import type { AssinaturaAresta, AssinaturaFace, Referencia, Vec3 } from "../model";
import { aplicarDirecao, aplicarPonto, type Transformacao } from "./modelo";

export interface ItemCena {
  /** id do componente */
  comp: string;
  malha: MalhaPeca;
  topo: Topologia;
  t: Transformacao;
}

/** Faixas de índices de cada componente na cena junta (faces, arestas, vértices). */
export interface MapaCena {
  comps: string[];
  faces: number[]; // início de cada componente (a lista termina com o total)
  arestas: number[];
  vertices: number[];
}

export interface Cena {
  malha: MalhaPeca;
  topo: Topologia;
  mapa: MapaCena;
}

const transfFace = (t: Transformacao, f: AssinaturaFace): AssinaturaFace => ({
  ...f,
  centro: aplicarPonto(t, f.centro),
  ...(f.normal ? { normal: aplicarDirecao(t, f.normal) } : {}),
  ...(f.eixo ? { eixo: aplicarDirecao(t, f.eixo) } : {}),
  ...(f.pontoEixo ? { pontoEixo: aplicarPonto(t, f.pontoEixo) } : {}),
});
const transfAresta = (t: Transformacao, a: AssinaturaAresta): AssinaturaAresta => ({
  ...a,
  meio: aplicarPonto(t, a.meio),
  a: aplicarPonto(t, a.a),
  b: aplicarPonto(t, a.b),
  ...(a.centro ? { centro: aplicarPonto(t, a.centro) } : {}),
  ...(a.eixo ? { eixo: aplicarDirecao(t, a.eixo) } : {}),
});

/** Junta os componentes numa malha e numa topologia só (coordenadas da montagem). */
export function juntar(itens: ItemCena[]): Cena {
  let nV = 0, nT = 0, nA = 0, nG = 0, nF = 0;
  for (const it of itens) {
    nV += it.malha.vertices.length;
    nT += it.malha.triangulos.length;
    nA += it.malha.arestas.length;
    nG += it.malha.gruposArestas.length;
    nF += it.malha.faces.length;
  }
  const vertices = new Float32Array(nV), normais = new Float32Array(nV), triangulos = new Uint32Array(nT);
  const arestas = new Float32Array(nA), gruposArestas = new Uint32Array(nG), faces = new Uint32Array(nF);
  const topo: Topologia = { faces: [], arestas: [], vertices: [], arestasDaFace: [] };
  const mapa: MapaCena = { comps: [], faces: [], arestas: [], vertices: [] };
  let oV = 0, oT = 0, oA = 0, oG = 0, oF = 0;
  for (const it of itens) {
    const m = it.malha, t = it.t;
    const base = oV / 3; // vértices da malha antes deste componente
    // matriz da rotação (mais rápido que girar por quatérnio vértice a vértice)
    const [x, y, z, w] = t.rot;
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
    const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
    const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
    const [px, py, pz] = t.pos;
    const ponto = (src: Float32Array, dst: Float32Array, o: number) => {
      for (let i = 0; i < src.length; i += 3) {
        const a = src[i], b = src[i + 1], c = src[i + 2];
        dst[o + i] = r00 * a + r01 * b + r02 * c + px;
        dst[o + i + 1] = r10 * a + r11 * b + r12 * c + py;
        dst[o + i + 2] = r20 * a + r21 * b + r22 * c + pz;
      }
    };
    ponto(m.vertices, vertices, oV);
    for (let i = 0; i < m.normais.length; i += 3) {
      const a = m.normais[i], b = m.normais[i + 1], c = m.normais[i + 2];
      normais[oV + i] = r00 * a + r01 * b + r02 * c;
      normais[oV + i + 1] = r10 * a + r11 * b + r12 * c;
      normais[oV + i + 2] = r20 * a + r21 * b + r22 * c;
    }
    for (let i = 0; i < m.triangulos.length; i++) triangulos[oT + i] = m.triangulos[i] + base;
    ponto(m.arestas, arestas, oA);
    for (let i = 0; i < m.gruposArestas.length; i += 2) {
      gruposArestas[oG + i] = m.gruposArestas[i] + oA / 3;
      gruposArestas[oG + i + 1] = m.gruposArestas[i + 1];
    }
    const nFacesAntes = topo.faces.length;
    for (let i = 0; i < m.faces.length; i += 3) {
      faces[oF + i] = m.faces[i] + oT;
      faces[oF + i + 1] = m.faces[i + 1];
      faces[oF + i + 2] = m.faces[i + 2] + nFacesAntes;
    }
    mapa.comps.push(it.comp);
    mapa.faces.push(topo.faces.length);
    mapa.arestas.push(topo.arestas.length);
    mapa.vertices.push(topo.vertices.length);
    const nArestasAntes = topo.arestas.length;
    for (const f of it.topo.faces) topo.faces.push(transfFace(t, f));
    for (const a of it.topo.arestas) topo.arestas.push(transfAresta(t, a));
    for (const v of it.topo.vertices) topo.vertices.push(aplicarPonto(t, v));
    for (const l of it.topo.arestasDaFace ?? it.topo.faces.map(() => [])) topo.arestasDaFace!.push(l.map((k) => k + nArestasAntes));
    oV += m.vertices.length;
    oT += m.triangulos.length;
    oA += m.arestas.length;
    oG += m.gruposArestas.length;
    oF += m.faces.length;
  }
  mapa.faces.push(topo.faces.length);
  mapa.arestas.push(topo.arestas.length);
  mapa.vertices.push(topo.vertices.length);
  return { malha: { vertices, normais, triangulos, arestas, faces, gruposArestas }, topo, mapa };
}

export type TipoEnt = "face" | "aresta" | "vertice";
const lista = (m: MapaCena, tipo: TipoEnt) => (tipo === "face" ? m.faces : tipo === "aresta" ? m.arestas : m.vertices);

/** Entidade da cena → componente e índice dentro da peça (null se fora). */
export function localDaEntidade(m: MapaCena, tipo: TipoEnt, indice: number): { comp: string; indice: number } | null {
  const l = lista(m, tipo);
  for (let k = 0; k < m.comps.length; k++) if (indice >= l[k] && indice < l[k + 1]) return { comp: m.comps[k], indice: indice - l[k] };
  return null;
}

/** Índices (na cena) de todas as faces de um componente — destaque do componente selecionado. */
export function facesDoComponente(m: MapaCena, comp: string): number[] {
  const k = m.comps.indexOf(comp);
  if (k < 0) return [];
  return Array.from({ length: m.faces[k + 1] - m.faces[k] }, (_, i) => m.faces[k] + i);
}

/** Índice na cena de uma entidade local de um componente. */
export function globalDaEntidade(m: MapaCena, tipo: TipoEnt, comp: string, indice: number): number | null {
  const k = m.comps.indexOf(comp);
  if (k < 0) return null;
  const l = lista(m, tipo);
  const g = l[k] + indice;
  return g < l[k + 1] ? g : null;
}

/** Centro da caixa de um componente (pela topologia na cena): pivô para girar. */
export function centroDoComponente(c: Cena, comp: string): Vec3 | null {
  const k = c.mapa.comps.indexOf(comp);
  if (k < 0) return null;
  const vs = c.topo.vertices.slice(c.mapa.vertices[k], c.mapa.vertices[k + 1]);
  if (!vs.length) return null;
  const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of vs) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); }
  return [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Entidade da peça (topologia local) mais parecida com a referência guardada; null se não houver. */
export function indiceLocal(topo: Topologia, r: Referencia): { tipo: TipoEnt; indice: number } | null {
  let melhor = -1, dm = Infinity;
  if (r.tipo === "face") {
    topo.faces.forEach((f, i) => {
      if (f.geom !== r.ass.geom) return;
      const d = dist(f.centro, r.ass.centro) + Math.abs(f.area - r.ass.area) / Math.max(1, r.ass.area);
      if (d < dm) { dm = d; melhor = i; }
    });
    return melhor >= 0 ? { tipo: "face", indice: melhor } : null;
  }
  if (r.tipo === "aresta") {
    topo.arestas.forEach((a, i) => {
      if (a.geom !== r.ass.geom) return;
      const d = dist(a.meio, r.ass.meio) + Math.abs(a.comprimento - r.ass.comprimento);
      if (d < dm) { dm = d; melhor = i; }
    });
    return melhor >= 0 ? { tipo: "aresta", indice: melhor } : null;
  }
  if (r.tipo === "vertice") {
    topo.vertices.forEach((v, i) => {
      const d = dist(v, r.p);
      if (d < dm) { dm = d; melhor = i; }
    });
    return melhor >= 0 ? { tipo: "vertice", indice: melhor } : null;
  }
  return null;
}
