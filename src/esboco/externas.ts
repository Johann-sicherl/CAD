// Referências do modelo 3D no esboço: arestas e vértices da peça projetados no plano do esboço
// viram geometria de construção fixa ("externa"), usável em relações, cotas e encaixes.
// A referência guarda a assinatura geométrica; ao abrir o esboço a projeção é atualizada
// com a entidade mais parecida da peça atual. Funções puras (testáveis em Node).

import type { AssinaturaAresta, FeatureEsboco, GeoEsboco, Referencia, Vec3 } from "../model";
import { angulo, dist, mapaPontos, norm, pontosDaGeo, type P2 } from "./geometria";
import * as op from "./operacoes";
import type { Referencial } from "./referencial";

export type ProjecaoExterna =
  | { tipo: "ponto"; p: P2 }
  | { tipo: "linha"; a: P2; b: P2 }
  | { tipo: "circulo"; c: P2; r: number }
  | { tipo: "arco"; c: P2; r: number; ini: P2; fim: P2 };

/** Topologia mínima da peça (a mesma que o viewport recebe do kernel). */
export interface TopologiaLeve {
  arestas: AssinaturaAresta[];
  vertices: Vec3[];
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const esc3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Ponto 3D → coordenadas (x, y) do plano do esboço. */
export function noPlano(r: Referencial, p: Vec3): P2 {
  const d = sub3(p, r.origem);
  return { x: esc3(d, r.x), y: esc3(d, r.y) };
}

/**
 * Projeção de uma aresta/vértice no plano do esboço. Linhas e vértices sempre projetam;
 * círculos e arcos só quando paralelos ao plano (senão viram elipse: não suportado → null).
 */
export function projetar(ref: Referencia, r: Referencial): ProjecaoExterna | null {
  if (ref.tipo === "vertice") return { tipo: "ponto", p: noPlano(r, ref.p) };
  if (ref.tipo !== "aresta") return null;
  const s = ref.ass;
  const a = noPlano(r, s.a), b = noPlano(r, s.b);
  if (s.geom === "linha") {
    // aresta perpendicular ao plano: aparece como um ponto
    return dist(a, b) < 1e-6 ? { tipo: "ponto", p: a } : { tipo: "linha", a, b };
  }
  if (s.geom !== "circulo" || !s.centro || !s.eixo || s.raio === undefined) return null;
  if (Math.abs(esc3(s.eixo, r.normal)) < 0.9999) return null;
  const c = noPlano(r, s.centro);
  const fechado = dist3(s.a, s.b) < 1e-6 && s.comprimento > Math.PI * s.raio;
  if (fechado) return { tipo: "circulo", c, r: s.raio };
  // arco anti-horário no plano do esboço: o que contém o ponto do meio da aresta
  const m = noPlano(r, s.meio);
  const aa = angulo(c, a), ab = angulo(c, b), am = angulo(c, m);
  const [ini, fim] = norm(am - aa) < norm(ab - aa) ? [a, b] : [b, a];
  return { tipo: "arco", c, r: s.raio, ini, fim };
}

/** Ponto da projeção mais próximo de `q` (encaixe "sobre a aresta do modelo"). */
export function pontoNaProjecao(proj: ProjecaoExterna, q: P2): P2 {
  if (proj.tipo === "ponto") return proj.p;
  if (proj.tipo === "linha") {
    const dx = proj.b.x - proj.a.x, dy = proj.b.y - proj.a.y;
    const l2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((q.x - proj.a.x) * dx + (q.y - proj.a.y) * dy) / l2));
    return { x: proj.a.x + dx * k, y: proj.a.y + dy * k };
  }
  const d = Math.hypot(q.x - proj.c.x, q.y - proj.c.y) || 1;
  return { x: proj.c.x + ((q.x - proj.c.x) / d) * proj.r, y: proj.c.y + ((q.y - proj.c.y) / d) * proj.r };
}

/** Entidade da peça atual mais parecida com a referência guardada (null se sumiu). */
export function acharNaTopologia(ref: Referencia, topo: TopologiaLeve): Referencia | null {
  if (ref.tipo === "vertice") {
    let melhor: Vec3 | null = null, dm = Infinity;
    for (const v of topo.vertices) {
      const d = dist3(v, ref.p);
      if (d < dm) { dm = d; melhor = v; }
    }
    return melhor && dm < 2 ? { tipo: "vertice", p: melhor } : null;
  }
  if (ref.tipo !== "aresta") return null;
  const s = ref.ass;
  let melhor: AssinaturaAresta | null = null, nota = Infinity;
  for (const a of topo.arestas) {
    if (a.geom !== s.geom) continue;
    const n = dist3(a.meio, s.meio) + Math.abs(a.comprimento - s.comprimento) * 0.5;
    if (n < nota) { nota = n; melhor = a; }
  }
  return melhor && nota <= Math.max(1, 0.3 * s.comprimento) ? { tipo: "aresta", ass: melhor } : null;
}

const iguais = (a: P2, b: P2) => dist(a, b) < 1e-6;

/** A geometria externa do esboço que já corresponde à projeção (para não duplicar). */
export function externaExistente(esb: FeatureEsboco, proj: ProjecaoExterna): GeoEsboco | null {
  const pts = mapaPontos(esb);
  for (const g of esb.geos) {
    if (!g.externa) continue;
    const P = (id: string) => pts.get(id)!;
    if (proj.tipo === "ponto" && g.tipo === "ponto" && iguais(P(g.p), proj.p)) return g;
    if (proj.tipo === "linha" && g.tipo === "linha") {
      const [a, b] = [P(g.p1), P(g.p2)];
      if ((iguais(a, proj.a) && iguais(b, proj.b)) || (iguais(a, proj.b) && iguais(b, proj.a))) return g;
    }
    if (proj.tipo === "circulo" && g.tipo === "circulo" && iguais(P(g.c), proj.c) && Math.abs(g.r - proj.r) < 1e-6) return g;
    if (proj.tipo === "arco" && g.tipo === "arco" && iguais(P(g.c), proj.c) && iguais(P(g.ini), proj.ini) && iguais(P(g.fim), proj.fim)) return g;
  }
  return null;
}

/** Cria a geometria de construção fixa que representa a referência do modelo. */
export function criarExterna(esb: FeatureEsboco, proj: ProjecaoExterna, ref: Referencia): GeoEsboco {
  const existente = externaExistente(esb, proj);
  if (existente) return existente;
  let g: GeoEsboco;
  if (proj.tipo === "ponto") g = op.pontoSolto(esb, op.ponto(esb, proj.p), true);
  else if (proj.tipo === "linha") g = op.linha(esb, op.ponto(esb, proj.a), op.ponto(esb, proj.b), true);
  else if (proj.tipo === "circulo") g = op.circulo(esb, op.ponto(esb, proj.c), proj.r, true);
  else {
    g = op.arco(esb, op.ponto(esb, proj.c), op.ponto(esb, proj.ini), op.ponto(esb, proj.fim), true);
    g.r = proj.r;
  }
  g.externa = ref;
  fixarExterna(esb, g);
  return g;
}

/** Restrições "fixo" que prendem a geometria externa onde ela está. */
function fixarExterna(esb: FeatureEsboco, g: GeoEsboco) {
  const pts = mapaPontos(esb);
  const ids = new Set([g.id, ...pontosDaGeo(g)]);
  esb.restricoes = esb.restricoes.filter((r) => !(r.tipo === "fixo" && ids.has(r.a)));
  if (g.tipo === "circulo" || g.tipo === "arco") {
    const c = pts.get(g.c)!;
    op.restringir(esb, { tipo: "fixo", a: g.id, x: c.x, y: c.y, r: g.r });
    if (g.tipo === "arco") for (const e of [g.ini, g.fim]) op.restringir(esb, { tipo: "fixo", a: e, ...pts.get(e)! });
  } else {
    for (const e of pontosDaGeo(g)) op.restringir(esb, { tipo: "fixo", a: e, ...pts.get(e)! });
  }
}

/**
 * Atualiza as referências do modelo com a peça atual. Devolve quantas mudaram e quantas
 * não foram encontradas (ficam onde estavam).
 */
export function atualizarExternas(esb: FeatureEsboco, topo: TopologiaLeve, r: Referencial): { mudaram: number; perdidas: number } {
  let mudaram = 0, perdidas = 0;
  for (const g of esb.geos) {
    if (!g.externa) continue;
    const nova = acharNaTopologia(g.externa, topo);
    const proj = nova && projetar(nova, r);
    if (!nova || !proj || (proj.tipo !== g.tipo && !(proj.tipo === "ponto" && g.tipo === "ponto"))) {
      perdidas++;
      continue;
    }
    const pts = new Map(esb.pontos.map((p) => [p.id, p]));
    const mover = (id: string, p: P2) => {
      const q = pts.get(id)!;
      if (!iguais(q, p)) { q.x = p.x; q.y = p.y; return true; }
      return false;
    };
    let m = false;
    if (proj.tipo === "ponto" && g.tipo === "ponto") m = mover(g.p, proj.p);
    else if (proj.tipo === "linha" && g.tipo === "linha") m = [mover(g.p1, proj.a), mover(g.p2, proj.b)].some(Boolean);
    else if (proj.tipo === "circulo" && g.tipo === "circulo") {
      m = mover(g.c, proj.c) || Math.abs(g.r - proj.r) > 1e-9;
      g.r = proj.r;
    } else if (proj.tipo === "arco" && g.tipo === "arco") {
      m = [mover(g.c, proj.c), mover(g.ini, proj.ini), mover(g.fim, proj.fim)].some(Boolean) || Math.abs(g.r - proj.r) > 1e-9;
      g.r = proj.r;
    }
    g.externa = nova;
    if (m) {
      fixarExterna(esb, g);
      mudaram++;
    }
  }
  return { mudaram, perdidas };
}

/** Ids (geometria e pontos) das referências do modelo. */
export function idsExternos(esb: FeatureEsboco): Set<string> {
  const out = new Set<string>();
  for (const g of esb.geos) if (g.externa) [g.id, ...pontosDaGeo(g)].forEach((id) => out.add(id));
  return out;
}

/**
 * Remove referências do modelo que ninguém usa (nenhuma relação, cota ou geometria
 * ligada a elas), exceto as indicadas em `manter`. Devolve true se removeu alguma.
 */
export function podarExternas(esb: FeatureEsboco, manter: Set<string>): boolean {
  const remover: string[] = [];
  for (const g of esb.geos) {
    // convertida em geometria real (não construção): o usuário quer usá-la no perfil
    if (!g.externa || !g.construcao || manter.has(g.id) || pontosDaGeo(g).some((p) => manter.has(p))) continue;
    const ids = new Set([g.id, ...pontosDaGeo(g)]);
    const usadaPorGeo = esb.geos.some((o) => o.id !== g.id && pontosDaGeo(o).some((p) => ids.has(p)));
    const usadaPorRestricao = esb.restricoes.some((r) => r.tipo !== "fixo" && op.referencias(r).some((x) => ids.has(x)));
    if (!usadaPorGeo && !usadaPorRestricao) remover.push(g.id);
  }
  if (remover.length) op.excluir(esb, remover);
  return remover.length > 0;
}
