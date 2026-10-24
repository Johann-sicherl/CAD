// Operações sobre o esboço: criação de entidades compostas (retângulo, rasgo, polígono…),
// aparar, offset, espelhar e exclusão. Funções puras sobre o modelo (testáveis em Node);
// depois de cada operação o editor chama o solver.

import type { ComandoTexto, FeatureEsboco, GeoEsboco, OpcoesTexto, RestricaoEsboco } from "../model";
import { novoId } from "../model";
import {
  angulo, angulosArco, areaAssinada, centroTresPontos, cruz2, dist, distPontoSegmento, EIXO_H, EIXO_V,
  elipseDe, esc2, extremidades, IDS_IMPLICITOS, parabolaDe, paramElipse, paramParabola, pontoElipse, pontoParabola, intersecoes, mapaPontos, mult, norm, ORIGEM, paramNoArco, polar,
  pontosDaGeo, soma, sub, type MapaPontos, type P2,
} from "./geometria";

type Geo<T extends GeoEsboco["tipo"]> = Extract<GeoEsboco, { tipo: T }>;
type SemId<T> = T extends unknown ? Omit<T, "id"> : never;
/** Restrição ainda sem id (o id é criado ao gravar). */
export type NovaRestricao = SemId<RestricaoEsboco>;

// ---------- primitivas ----------

/** Ponto novo; se `reusar` for um id existente, devolve ele (encaixe em ponto). */
export function ponto(esb: FeatureEsboco, p: P2, reusar?: string | null): string {
  if (reusar && (reusar === ORIGEM || esb.pontos.some((x) => x.id === reusar))) return reusar;
  const id = novoId();
  esb.pontos.push({ id, x: p.x, y: p.y });
  return id;
}

export function restringir(esb: FeatureEsboco, r: SemId<RestricaoEsboco>): string {
  const id = novoId();
  esb.restricoes.push({ ...r, id } as RestricaoEsboco);
  return id;
}

export function linha(esb: FeatureEsboco, p1: string, p2: string, construcao = false): Geo<"linha"> {
  const g: Geo<"linha"> = { id: novoId(), tipo: "linha", p1, p2, ...(construcao && { construcao }) };
  esb.geos.push(g);
  return g;
}

export function circulo(esb: FeatureEsboco, c: string, r: number, construcao = false): Geo<"circulo"> {
  const g: Geo<"circulo"> = { id: novoId(), tipo: "circulo", c, r, ...(construcao && { construcao }) };
  esb.geos.push(g);
  return g;
}

export function arco(esb: FeatureEsboco, c: string, ini: string, fim: string, construcao = false): Geo<"arco"> {
  const pts = mapaPontos(esb);
  const g: Geo<"arco"> = {
    id: novoId(), tipo: "arco", c, ini, fim, r: dist(pts.get(c)!, pts.get(ini)!), ...(construcao && { construcao }),
  };
  esb.geos.push(g);
  return g;
}

// ---------- entidades compostas ----------

/** Retângulo por cantos opostos: 4 linhas, 2 horizontais e 2 verticais. */
export function retangulo(esb: FeatureEsboco, a: string, c: string, construcao = false): GeoEsboco[] {
  const pts = mapaPontos(esb);
  const pa = pts.get(a)!, pc = pts.get(c)!;
  const b = ponto(esb, { x: pc.x, y: pa.y });
  const d = ponto(esb, { x: pa.x, y: pc.y });
  const ls = [linha(esb, a, b, construcao), linha(esb, b, c, construcao), linha(esb, c, d, construcao), linha(esb, d, a, construcao)];
  restringir(esb, { tipo: "horizontal", a: ls[0].id });
  restringir(esb, { tipo: "horizontal", a: ls[2].id });
  restringir(esb, { tipo: "vertical", a: ls[1].id });
  restringir(esb, { tipo: "vertical", a: ls[3].id });
  return ls;
}

/** Arco por três pontos: início, fim e um ponto por onde ele passa. */
export function arcoTresPontos(esb: FeatureEsboco, ini: string, fim: string, passagem: P2, construcao = false): Geo<"arco"> | null {
  const pts = mapaPontos(esb);
  const pi = pts.get(ini)!, pf = pts.get(fim)!;
  const c = centroTresPontos(pi, passagem, pf);
  if (!c) return null;
  const [a0, a1] = angulosArco(c, pi, pf);
  const anti = paramNoArco(angulo(c, passagem), a0, a1) !== null;
  const idc = ponto(esb, c);
  return anti ? arco(esb, idc, ini, fim, construcao) : arco(esb, idc, fim, ini, construcao);
}

/** Rasgo (oblongo) pelos centros das pontas e pela meia largura. */
export function rasgo(esb: FeatureEsboco, c1: string, c2: string, r: number, construcao = false): GeoEsboco[] {
  const pts = mapaPontos(esb);
  const p1 = pts.get(c1)!, p2 = pts.get(c2)!;
  const l = dist(p1, p2) || 1;
  const u = { x: (p2.x - p1.x) / l, y: (p2.y - p1.y) / l };
  const n = { x: -u.y, y: u.x };
  const a1 = ponto(esb, soma(p1, mult(n, r))), b1 = ponto(esb, soma(p1, mult(n, -r)));
  const a2 = ponto(esb, soma(p2, mult(n, r))), b2 = ponto(esb, soma(p2, mult(n, -r)));
  const topo = linha(esb, a2, a1, construcao);
  const base = linha(esb, b1, b2, construcao);
  const arco2 = arco(esb, c2, b2, a2, construcao); // passa pela ponta +u
  const arco1 = arco(esb, c1, a1, b1, construcao); // passa pela ponta −u
  for (const [li, ar] of [[topo, arco1], [topo, arco2], [base, arco1], [base, arco2]] as const) {
    restringir(esb, { tipo: "tangente", a: li.id, b: ar.id });
  }
  restringir(esb, { tipo: "igual", a: arco1.id, b: arco2.id });
  return [topo, arco2, base, arco1];
}

/** Polígono regular inscrito num círculo de construção. */
export function poligono(esb: FeatureEsboco, c: string, vertice: P2, lados: number, construcao = false): GeoEsboco[] {
  lados = Math.max(3, Math.min(64, Math.round(lados)));
  const pc = mapaPontos(esb).get(c)!;
  const r = dist(pc, vertice);
  const a0 = angulo(pc, vertice);
  const circ = circulo(esb, c, r, true);
  const vs = Array.from({ length: lados }, (_, i) => ponto(esb, polar(pc, r, a0 + (i * 2 * Math.PI) / lados)));
  const ls = vs.map((v, i) => linha(esb, v, vs[(i + 1) % lados], construcao));
  for (const v of vs) restringir(esb, { tipo: "coincidente", a: v, b: circ.id });
  for (let i = 1; i < lados; i++) restringir(esb, { tipo: "igual", a: ls[0].id, b: ls[i].id });
  return [circ, ...ls];
}

/** Ponto solto (posição de furo, referência). */
export function pontoSolto(esb: FeatureEsboco, p: string, construcao = false): Geo<"ponto"> {
  const g: Geo<"ponto"> = { id: novoId(), tipo: "ponto", p, ...(construcao && { construcao }) };
  esb.geos.push(g);
  return g;
}

export function spline(esb: FeatureEsboco, pontos: string[], construcao = false): Geo<"spline"> {
  const g: Geo<"spline"> = { id: novoId(), tipo: "spline", pontos, ...(construcao && { construcao }) };
  esb.geos.push(g);
  return g;
}

// ---------- exclusão e limpeza ----------

/** Ids citados por uma restrição. */
export function referencias(r: RestricaoEsboco): string[] {
  const out: string[] = [];
  for (const k of ["a", "b", "p", "g"] as const) {
    const v = (r as Record<string, unknown>)[k];
    if (typeof v === "string") out.push(v);
  }
  return out;
}

/** Remove geometrias/pontos/restrições pelos ids e limpa o que ficou órfão. */
export function excluir(esb: FeatureEsboco, ids: Iterable<string>) {
  const fora = new Set(ids);
  esb.geos = esb.geos.filter((g) => !fora.has(g.id));
  esb.restricoes = esb.restricoes.filter((r) => !fora.has(r.id));
  // ponto excluído explicitamente: leva junto as geometrias que dependem dele
  esb.geos = esb.geos.filter((g) => !pontosDaGeo(g).some((p) => fora.has(p)));
  limpar(esb);
}

/** Tira pontos que nenhuma geometria usa e restrições que citam algo inexistente. */
export function limpar(esb: FeatureEsboco) {
  const usados = new Set(esb.geos.flatMap(pontosDaGeo));
  esb.pontos = esb.pontos.filter((p) => usados.has(p.id));
  const existe = new Set([...usados, ...esb.geos.map((g) => g.id), ...IDS_IMPLICITOS]);
  esb.restricoes = esb.restricoes.filter((r) => referencias(r).every((x) => existe.has(x)));
}

// ---------- aparar ----------

interface Corte {
  p: P2;
  param: number; // 0..1 na linha / no arco; ângulo absoluto no círculo
  cortador: string; // geometria que cruza
}

function cortesNaGeo(esb: FeatureEsboco, g: GeoEsboco, pts: MapaPontos, cortadores?: string[]): Corte[] {
  const cortes: Corte[] = [];
  for (const o of esb.geos) {
    if (o.id === g.id || (cortadores && !cortadores.includes(o.id))) continue;
    for (const p of intersecoes(g, o, pts)) cortes.push({ p, param: 0, cortador: o.id });
  }
  if (g.tipo === "linha") {
    const a = pts.get(g.p1)!, b = pts.get(g.p2)!;
    for (const c of cortes) c.param = distPontoSegmento(c.p, a, b).t;
    return cortes.filter((c) => c.param > 1e-6 && c.param < 1 - 1e-6);
  }
  if (g.tipo === "arco") {
    const ctr = pts.get(g.c)!;
    const [a0, a1] = angulosArco(ctr, pts.get(g.ini)!, pts.get(g.fim)!);
    for (const c of cortes) c.param = paramNoArco(angulo(ctr, c.p), a0, a1) ?? -1;
    return cortes.filter((c) => c.param > 1e-6 && c.param < 1 - 1e-6);
  }
  if (g.tipo === "circulo") {
    const ctr = pts.get(g.c)!;
    for (const c of cortes) c.param = norm(angulo(ctr, c.p));
    return cortes;
  }
  return [];
}

/** Ponto no local do corte: reaproveita um ponto existente ali, senão cria e prende no cortador. */
function pontoDeCorte(esb: FeatureEsboco, c: Corte): string {
  const existente = esb.pontos.find((p) => dist(p, c.p) < 1e-6);
  if (existente) return existente.id;
  const id = ponto(esb, c.p);
  restringir(esb, { tipo: "coincidente", a: id, b: c.cortador });
  return id;
}

/** Opções do aparar. */
export interface OpcoesAparar {
  /** Manter o trecho aparado como geometria de construção (em vez de apagar). */
  construcao?: boolean;
  /** Só estas geometrias cortam (aparar dentro/fora). */
  cortadores?: string[];
}

/**
 * Apaga o trecho da geometria entre as interseções vizinhas ao ponto tocado.
 * Sem interseções, apaga a geometria inteira. Devolve false se não houve mudança.
 */
export function aparar(esb: FeatureEsboco, geoId: string, toque: P2, opc: OpcoesAparar = {}): boolean {
  const g = esb.geos.find((x) => x.id === geoId);
  if (!g) return false;
  const pts = mapaPontos(esb);
  const manter = !!opc.construcao && !g.construcao;
  const apagarInteira = () => {
    if (manter) g.construcao = true;
    else excluir(esb, [g.id]);
    return true;
  };
  // sem interseção analítica: a curva sai inteira
  if (g.tipo === "spline" || g.tipo === "ponto" || g.tipo === "elipse" || g.tipo === "arcoElipse" || g.tipo === "parabola" || g.tipo === "texto") return apagarInteira();
  const cortes = cortesNaGeo(esb, g, pts, opc.cortadores);

  if (g.tipo === "circulo") {
    if (cortes.length < 2) return opc.cortadores ? false : apagarInteira();
    const ctr = pts.get(g.c)!;
    const t = norm(angulo(ctr, toque));
    const ords = [...cortes].sort((a, b) => a.param - b.param);
    // vizinhos cíclicos do ângulo tocado
    const depois = ords.find((c) => c.param > t) ?? ords[0];
    const antes = [...ords].reverse().find((c) => c.param < t) ?? ords[ords.length - 1];
    if (depois === antes) return false;
    const ini = pontoDeCorte(esb, depois), fim = pontoDeCorte(esb, antes);
    const novo: Geo<"arco"> = { id: g.id, tipo: "arco", c: g.c, ini, fim, r: g.r, ...(g.construcao && { construcao: true }) };
    esb.geos[esb.geos.indexOf(g)] = novo;
    if (manter) arco(esb, g.c, fim, ini, true); // o trecho tirado vai de "antes" a "depois"
    limpar(esb);
    return true;
  }

  // linha ou arco: parâmetro 0..1
  let t: number;
  if (g.tipo === "linha") t = distPontoSegmento(toque, pts.get(g.p1)!, pts.get(g.p2)!).t;
  else {
    const ctr = pts.get(g.c)!;
    const [a0, a1] = angulosArco(ctr, pts.get(g.ini)!, pts.get(g.fim)!);
    t = paramNoArco(angulo(ctr, toque), a0, a1) ?? 0.5;
  }
  const antes = cortes.filter((c) => c.param < t).sort((a, b) => b.param - a.param)[0];
  const depois = cortes.filter((c) => c.param > t).sort((a, b) => a.param - b.param)[0];

  if (!antes && !depois) return opc.cortadores ? false : apagarInteira();
  const [chIni, chFim] = g.tipo === "linha" ? (["p1", "p2"] as const) : (["ini", "fim"] as const);
  const gg = g as unknown as Record<string, unknown>;
  // o trecho tirado, como construção, entre os pontos a e b
  const sobra = (a: string, b: string) => {
    if (!manter) return;
    if (g.tipo === "linha") linha(esb, a, b, true);
    else if (g.tipo === "arco") arco(esb, g.c, a, b, true);
  };
  if (!antes) {
    const velho = gg[chIni] as string;
    gg[chIni] = pontoDeCorte(esb, depois!);
    sobra(velho, gg[chIni] as string);
  } else if (!depois) {
    const velho = gg[chFim] as string;
    gg[chFim] = pontoDeCorte(esb, antes);
    sobra(gg[chFim] as string, velho);
  } else {
    // trecho do meio: a geometria vira duas
    const fimOriginal = gg[chFim] as string;
    const pa = pontoDeCorte(esb, antes), pd = pontoDeCorte(esb, depois);
    gg[chFim] = pa;
    if (g.tipo === "linha") {
      const nova = linha(esb, pd, fimOriginal, g.construcao);
      restringir(esb, { tipo: "colinear", a: g.id, b: nova.id });
    } else if (g.tipo === "arco") {
      const novo = arco(esb, g.c, pd, fimOriginal, g.construcao);
      restringir(esb, { tipo: "igual", a: g.id, b: novo.id });
    }
    sobra(pa, pd);
  }
  // cotas de comprimento da linha original deixam de valer
  esb.restricoes = esb.restricoes.filter((r) => !(r.tipo === "distancia" && r.a === g.id && !r.b));
  limpar(esb);
  return true;
}

/** Ponto no parâmetro 0..1 de uma linha ou arco. */
function pontoNoParametro(g: GeoEsboco, pts: MapaPontos, t: number): P2 | null {
  if (g.tipo === "linha") {
    const a = pts.get(g.p1)!, b = pts.get(g.p2)!;
    return soma(a, mult(sub(b, a), t));
  }
  if (g.tipo === "arco") {
    const c = pts.get(g.c)!, pi = pts.get(g.ini)!;
    const [a0, a1] = angulosArco(c, pi, pts.get(g.fim)!);
    return polar(c, dist(c, pi), a0 + (a1 - a0) * t);
  }
  return null;
}

/**
 * Aparar dentro / fora: com duas entidades de limite, tira o trecho entre elas (dentro) ou o que
 * passa delas (fora). A geometria precisa cruzar os dois limites.
 */
export function apararEntre(esb: FeatureEsboco, geoId: string, limites: [string, string], dentro: boolean, construcao = false): boolean {
  const g = esb.geos.find((x) => x.id === geoId);
  if (!g || (g.tipo !== "linha" && g.tipo !== "arco") || limites.includes(geoId)) return false;
  const pts = mapaPontos(esb);
  const cortes = cortesNaGeo(esb, g, pts, limites);
  const c1 = cortes.filter((c) => c.cortador === limites[0]), c2 = cortes.filter((c) => c.cortador === limites[1]);
  if (!c1.length || !c2.length) return false;
  const lo = Math.min(c1[0].param, c2[0].param), hi = Math.max(c1[0].param, c2[0].param);
  const opc = { cortadores: limites, construcao };
  if (dentro) return aparar(esb, geoId, pontoNoParametro(g, pts, (lo + hi) / 2)!, opc);
  const pFim = hi < 1 - 1e-6 ? pontoNoParametro(g, pts, (hi + 1) / 2) : null;
  const pIni = lo > 1e-6 ? pontoNoParametro(g, pts, lo / 2) : null;
  let mudou = false;
  if (pFim) mudou = aparar(esb, geoId, pFim, opc) || mudou;
  if (pIni) mudou = aparar(esb, geoId, pIni, opc) || mudou;
  return mudou;
}

/**
 * Canto: estende ou apara duas linhas até se encontrarem. Em cada linha fica a ponta do lado
 * tocado (a mais distante do canto); a outra vai para o canto, compartilhado pelas duas.
 */
export function canto(esb: FeatureEsboco, id1: string, toque1: P2, id2: string, toque2: P2): boolean {
  const l1 = esb.geos.find((x): x is Geo<"linha"> => x.id === id1 && x.tipo === "linha");
  const l2 = esb.geos.find((x): x is Geo<"linha"> => x.id === id2 && x.tipo === "linha");
  if (!l1 || !l2 || l1 === l2) return false;
  const pts = mapaPontos(esb);
  const a1 = pts.get(l1.p1)!, u1 = sub(pts.get(l1.p2)!, a1);
  const a2 = pts.get(l2.p1)!, u2 = sub(pts.get(l2.p2)!, a2);
  const den = cruz2(u1, u2);
  if (Math.abs(den) < 1e-12) return false; // paralelas
  const x = soma(a1, mult(u1, cruz2(sub(a2, a1), u2) / den));
  const idx = ponto(esb, x);
  for (const [l, toque] of [[l1, toque1], [l2, toque2]] as const) {
    const u = sub(pts.get(l.p2)!, pts.get(l.p1)!);
    const lado = (q: P2) => esc2(sub(q, x), u);
    const sToque = Math.sign(lado(toque));
    const ponta = (pid: string) => {
      const q = pts.get(pid)!;
      return { pid, mesmoLado: Math.sign(lado(q)) === sToque, d: dist(q, x) };
    };
    const [p1, p2] = [ponta(l.p1), ponta(l.p2)];
    // fica a ponta do lado tocado mais distante do canto
    const ficaP1 = p1.mesmoLado !== p2.mesmoLado ? p1.mesmoLado : p1.d >= p2.d;
    if (ficaP1) l.p2 = idx;
    else l.p1 = idx;
    esb.restricoes = esb.restricoes.filter((r) => !(r.tipo === "distancia" && r.a === l.id && !r.b));
  }
  limpar(esb);
  return true;
}

// ---------- offset ----------

interface Elo {
  g: GeoEsboco;
  invertido: boolean;
}

/** Ordena as geometrias selecionadas em cadeias ligadas pelas extremidades. */
function cadeias(geos: GeoEsboco[], pts: MapaPontos): { elos: Elo[]; fechada: boolean }[] {
  const resto = geos.filter((g) => g.tipo === "linha" || g.tipo === "arco");
  const out: { elos: Elo[]; fechada: boolean }[] = [];
  const pos = (id: string) => pts.get(id)!;
  const mesmo = (a: string, b: string) => a === b || dist(pos(a), pos(b)) < 1e-6;
  while (resto.length) {
    const primeiro = resto.shift()!;
    const elos: Elo[] = [{ g: primeiro, invertido: false }];
    const fimDe = (e: Elo) => { const x = extremidades(e.g)!; return e.invertido ? x[0] : x[1]; };
    const iniDe = (e: Elo) => { const x = extremidades(e.g)!; return e.invertido ? x[1] : x[0]; };
    let achou = true;
    while (achou) {
      achou = false;
      for (let i = 0; i < resto.length; i++) {
        const [a, b] = extremidades(resto[i])!;
        const f = fimDe(elos[elos.length - 1]), s = iniDe(elos[0]);
        if (mesmo(a, f) || mesmo(b, f)) {
          elos.push({ g: resto[i], invertido: !mesmo(a, f) });
        } else if (mesmo(b, s) || mesmo(a, s)) {
          elos.unshift({ g: resto[i], invertido: !mesmo(b, s) });
        } else continue;
        resto.splice(i, 1);
        achou = true;
        break;
      }
    }
    const fechada = elos.length > 1 && mesmo(fimDe(elos[elos.length - 1]), iniDe(elos[0]));
    out.push({ elos, fechada });
  }
  return out;
}

type Deslocada =
  | { tipo: "linha"; a: P2; b: P2 }
  | { tipo: "arco"; c: P2; r: number; a: P2; b: P2 }; // a→b no sentido do percurso

function deslocarElo(e: Elo, pts: MapaPontos, d: number): Deslocada {
  const g = e.g;
  if (g.tipo === "linha") {
    let a = pts.get(g.p1)!, b = pts.get(g.p2)!;
    if (e.invertido) [a, b] = [b, a];
    const l = dist(a, b) || 1;
    const n = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; // esquerda do percurso
    return { tipo: "linha", a: soma(a, mult(n, d)), b: soma(b, mult(n, d)) };
  }
  const arc = g as Geo<"arco">;
  const c = pts.get(arc.c)!;
  // percorrido no sentido anti-horário, a esquerda aponta para o centro
  const r = e.invertido ? arc.r + d : arc.r - d;
  let a = pts.get(arc.ini)!, b = pts.get(arc.fim)!;
  if (e.invertido) [a, b] = [b, a];
  return { tipo: "arco", c, r, a: polar(c, r, angulo(c, a)), b: polar(c, r, angulo(c, b)) };
}

/** Junção de duas curvas deslocadas: interseção das curvas estendidas mais perto do canto. */
function juntar(x: Deslocada, y: Deslocada): P2 {
  const ref = mult(soma(x.b, y.a), 0.5);
  if (dist(x.b, y.a) < 1e-6) return ref;
  const cand: P2[] = [];
  if (x.tipo === "linha" && y.tipo === "linha") {
    const r = sub(x.b, x.a), s = sub(y.b, y.a);
    const den = cruz2(r, s);
    if (Math.abs(den) > 1e-12) cand.push(soma(x.a, mult(r, cruz2(sub(y.a, x.a), s) / den)));
  } else {
    const lin = x.tipo === "linha" ? x : y.tipo === "linha" ? y : null;
    const arcs = [x, y].filter((k): k is Extract<Deslocada, { tipo: "arco" }> => k.tipo === "arco");
    if (lin) {
      const cc = arcs[0];
      const dd = sub(lin.b, lin.a), f = sub(lin.a, cc.c);
      const A = esc2(dd, dd), B = 2 * esc2(f, dd), C = esc2(f, f) - cc.r * cc.r;
      const disc = B * B - 4 * A * C;
      if (disc >= 0) for (const sg of [-1, 1]) cand.push(soma(lin.a, mult(dd, (-B + sg * Math.sqrt(disc)) / (2 * A))));
    } else {
      const [c1, c2] = arcs;
      const dd = dist(c1.c, c2.c);
      if (dd > 1e-12) {
        const a = (c1.r * c1.r - c2.r * c2.r + dd * dd) / (2 * dd);
        const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
        const m = soma(c1.c, mult(sub(c2.c, c1.c), a / dd));
        const o = { x: (-(c2.c.y - c1.c.y) * h) / dd, y: ((c2.c.x - c1.c.x) * h) / dd };
        cand.push(soma(m, o), sub(m, o));
      }
    }
  }
  return cand.sort((p, q) => dist(p, ref) - dist(q, ref))[0] ?? ref;
}

/** Opções do offset (painel "Offset de entidades"). */
export interface OpcoesOffset {
  /** Cotar a distância (uma cota por lado). */
  cotar?: boolean;
  /** Copiar para os dois lados. */
  bidirecional?: boolean;
  /** Fechar as pontas de cadeias abertas com arcos ou linhas. */
  tampar?: "nenhuma" | "arcos" | "linhas";
  /** Transformar as entidades de origem em geometria de construção. */
  baseConstrucao?: boolean;
  /** Criar as cópias como geometria de construção. */
  construcao?: boolean;
}

/** Direção da tangente que sai da cadeia na ponta (início: para trás; fim: para frente). */
function saidaDaCadeia(e: Elo, pts: MapaPontos, fim: boolean): P2 {
  const g = e.g;
  let t: P2;
  if (g.tipo === "linha") {
    const a = pts.get(g.p1)!, b = pts.get(g.p2)!;
    t = sub(b, a);
    if (e.invertido) t = mult(t, -1);
  } else {
    const arc = g as Geo<"arco">;
    const c = pts.get(arc.c)!;
    // ponta no sentido do percurso; tangente anti-horária, trocada se o elo está invertido
    const ponta = pts.get(fim !== e.invertido ? arc.fim : arc.ini)!;
    const r = sub(ponta, c);
    t = { x: -r.y, y: r.x };
    if (e.invertido) t = mult(t, -1);
  }
  const l = Math.hypot(t.x, t.y) || 1;
  return mult(t, (fim ? 1 : -1) / l);
}

/**
 * Cria cópias deslocadas das geometrias. Distância positiva = para fora em contornos fechados
 * (e para a esquerda em cadeias abertas); negativa inverte. Devolve os ids das novas geometrias.
 */
export function deslocar(esb: FeatureEsboco, geoIds: string[], d: number, opc: OpcoesOffset = {}): string[] {
  const pts = mapaPontos(esb);
  const geos = esb.geos.filter((g) => geoIds.includes(g.id));
  const novas: string[] = [];
  const cotar = opc.cotar ?? true;
  const lados = opc.bidirecional ? [d, -d] : [d];
  const constr = (g: GeoEsboco) => opc.construcao ?? g.construcao;

  for (const g of geos) {
    if (g.tipo !== "circulo") continue;
    for (const dd of lados) {
      if (g.r + dd <= 1e-3) continue;
      const nc = circulo(esb, g.c, g.r + dd, constr(g));
      restringir(esb, { tipo: "concentrico", a: g.id, b: nc.id });
      novas.push(nc.id);
    }
  }

  for (const { elos, fechada } of cadeias(geos, pts)) {
    const pontas: { ini: string; fim: string }[] = [];
    for (const lado of lados) {
      let dd = lado;
      if (fechada) {
        const pol = elos.map((e) => pts.get(e.invertido ? extremidades(e.g)![1] : extremidades(e.g)![0])!);
        if (areaAssinada(pol) > 0) dd = -lado; // anti-horário: a esquerda é o lado de dentro
      }
      const desl = elos.map((e) => deslocarElo(e, pts, dd));
      const n = desl.length;
      const juntas: string[] = [];
      for (let i = 0; i < n; i++) {
        const anterior = i === 0 ? (fechada ? desl[n - 1] : null) : desl[i - 1];
        juntas.push(ponto(esb, anterior ? juntar(anterior, desl[i]) : desl[i].a));
      }
      const fimAberto = fechada ? juntas[0] : ponto(esb, desl[n - 1].b);
      pontas.push({ ini: juntas[0], fim: fimAberto });
      let cotada = !cotar;
      desl.forEach((x, i) => {
        const a = juntas[i], b = i + 1 < n ? juntas[i + 1] : fimAberto;
        const orig = elos[i].g;
        if (x.tipo === "linha") {
          const nl = linha(esb, a, b, constr(orig));
          restringir(esb, { tipo: "paralelo", a: orig.id, b: nl.id });
          if (!cotada) {
            restringir(esb, { tipo: "distancia", a: nl.p1, b: orig.id, valor: Math.abs(d), texto: mult(soma(pts.get((orig as Geo<"linha">).p1)!, x.a), 0.5) });
            cotada = true;
          }
          novas.push(nl.id);
        } else {
          const ic = (orig as Geo<"arco">).c;
          // o arco novo segue o sentido anti-horário do original
          const na = elos[i].invertido ? arco(esb, ic, b, a, constr(orig)) : arco(esb, ic, a, b, constr(orig));
          novas.push(na.id);
        }
      });
    }

    // tampas nas pontas de cadeias abertas
    if (!fechada && opc.tampar && opc.tampar !== "nenhuma") {
      const primeiro = elos[0], ultimo = elos[elos.length - 1];
      const ex0 = extremidades(primeiro.g)!, ex1 = extremidades(ultimo.g)!;
      const origIni = primeiro.invertido ? ex0[1] : ex0[0];
      const origFim = ultimo.invertido ? ex1[0] : ex1[1];
      const cfg = [
        { dir: saidaDaCadeia(primeiro, pts, false), a: pontas[0].ini, b: opc.bidirecional ? pontas[1].ini : origIni },
        { dir: saidaDaCadeia(ultimo, pts, true), a: pontas[0].fim, b: opc.bidirecional ? pontas[1].fim : origFim },
      ];
      const cons = opc.construcao ?? !!primeiro.g.construcao;
      for (const k of cfg) {
        if (opc.tampar === "linhas") {
          novas.push(linha(esb, k.a, k.b, cons).id);
          continue;
        }
        const pm = esb.pontos.find((p) => p.id === k.a)!, pn = esb.pontos.find((p) => p.id === k.b)!;
        const meio = mult(soma(pm, pn), 0.5);
        const passagem = soma(meio, mult(k.dir, dist(pm, pn) / 2));
        const na = arcoTresPontos(esb, k.a, k.b, passagem, cons);
        if (na) novas.push(na.id);
      }
    }
  }

  if (opc.baseConstrucao) for (const g of geos) g.construcao = true;
  return novas;
}

// ---------- espelhar ----------

function refletir(p: P2, a: P2, b: P2): P2 {
  const u = sub(b, a);
  const l2 = esc2(u, u) || 1;
  const t = esc2(sub(p, a), u) / l2;
  const pe = soma(a, mult(u, t));
  return sub(mult(pe, 2), p);
}

/** Cópia espelhada em torno de uma linha (do esboço ou eixo H/V), com relações de simetria. */
export function espelhar(esb: FeatureEsboco, geoIds: string[], eixo: string): string[] {
  const pts = mapaPontos(esb);
  let a: P2, b: P2;
  if (eixo === EIXO_H) [a, b] = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  else if (eixo === EIXO_V) [a, b] = [{ x: 0, y: 0 }, { x: 0, y: 1 }];
  else {
    const g = esb.geos.find((x) => x.id === eixo);
    if (!g || g.tipo !== "linha") return [];
    [a, b] = [pts.get(g.p1)!, pts.get(g.p2)!];
  }
  const espelho = new Map<string, string>();
  const par = (id: string) => {
    let m = espelho.get(id);
    if (m) return m;
    const p = pts.get(id)!;
    if (distPontoSegmento(p, a, b).d < 1e-6 || Math.abs(cruz2(sub(b, a), sub(p, a))) < 1e-9) {
      m = id; // ponto sobre o eixo: é o próprio espelho
    } else {
      m = ponto(esb, refletir(p, a, b));
      restringir(esb, { tipo: "simetrico", a: id, b: m, g: eixo });
    }
    espelho.set(id, m);
    return m;
  };
  const novas: string[] = [];
  for (const g of esb.geos.filter((x) => geoIds.includes(x.id) && x.id !== eixo)) {
    let n: GeoEsboco;
    if (g.tipo === "linha") n = linha(esb, par(g.p1), par(g.p2), g.construcao);
    else if (g.tipo === "circulo") {
      n = circulo(esb, par(g.c), g.r, g.construcao);
      restringir(esb, { tipo: "igual", a: g.id, b: n.id });
    } else if (g.tipo === "arco") n = arco(esb, par(g.c), par(g.fim), par(g.ini), g.construcao); // espelho inverte o sentido
    else if (g.tipo === "ponto") n = pontoSolto(esb, par(g.p), g.construcao);
    else n = copiarCurva(esb, g, par, true, (v) => sub(refletir(v, a, b), refletir({ x: 0, y: 0 }, a, b)));
    novas.push(n.id);
  }
  return novas;
}

/**
 * Cópia de spline, elipse ou parábola com os pontos trocados por `m`. Espelhada, a orientação
 * se inverte: o eixo menor positivo passa a ser o outro lado e o arco troca início e fim.
 */
function copiarCurva(
  esb: FeatureEsboco,
  g: Geo<"spline" | "elipse" | "arcoElipse" | "parabola" | "texto">,
  m: (id: string) => string,
  espelhada: boolean,
  linear: (v: P2) => P2,
): GeoEsboco {
  const k = !!g.construcao;
  if (g.tipo === "spline") return spline(esb, g.pontos.map(m), k);
  const novo = (x: Record<string, unknown>) => {
    const n = { id: novoId(), ...x, ...(k && { construcao: true }) } as GeoEsboco;
    esb.geos.push(n);
    return n;
  };
  if (g.tipo === "texto") {
    // as letras vão junto: a matriz da cópia compõe a transformação (giro/espelho) com a atual
    const [a, b, c, d] = g.transf ?? [1, 0, 0, 1];
    const e1 = linear({ x: 1, y: 0 }), e2 = linear({ x: 0, y: 1 });
    const t: [number, number, number, number] = [e1.x * a + e2.x * c, e1.x * b + e2.x * d, e1.y * a + e2.y * c, e1.y * b + e2.y * d];
    return novo({ tipo: "texto", p: m(g.p), opc: { ...g.opc }, contornos: g.contornos, transf: t });
  }
  if (g.tipo === "parabola") {
    const [ini, fim] = espelhada ? [g.fim, g.ini] : [g.ini, g.fim];
    return novo({ tipo: "parabola", v: m(g.v), f: m(g.f), ini: m(ini), fim: m(fim) });
  }
  const [n1, n2] = espelhada ? [g.n2, g.n1] : [g.n1, g.n2];
  const eixos = { c: m(g.c), m1: m(g.m1), m2: m(g.m2), n1: m(n1), n2: m(n2) };
  if (g.tipo === "elipse") return novo({ tipo: "elipse", ...eixos });
  const [ini, fim] = espelhada ? [g.fim, g.ini] : [g.ini, g.fim];
  return novo({ tipo: "arcoElipse", ...eixos, ini: m(ini), fim: m(fim) });
}

// ---------- texto ----------

/** Texto ancorado no ponto `p` (contornos já gerados da fonte, relativos a `p`). */
export function texto(esb: FeatureEsboco, p: string, opc: OpcoesTexto, contornos: ComandoTexto[][], curva?: string, construcao = false): Geo<"texto"> {
  const g: Geo<"texto"> = { id: novoId(), tipo: "texto", p, opc: { ...opc }, contornos, ...(curva && { curva }), ...(construcao && { construcao }) };
  esb.geos.push(g);
  return g;
}

// ---------- elipse, elipse parcial e parábola ----------

/** Pontas dos eixos de uma elipse e as linhas de construção dos eixos (para cotar e girar). */
function eixosElipse(esb: FeatureEsboco, c: string, maior: P2, b: number) {
  const pc = mapaPontos(esb).get(c)!;
  const d = sub(maior, pc);
  const a = Math.hypot(d.x, d.y) || 1e-3;
  const u = mult(d, 1 / a), v = { x: -u.y, y: u.x };
  const m1 = ponto(esb, soma(pc, mult(u, a))), m2 = ponto(esb, soma(pc, mult(u, -a)));
  const n1 = ponto(esb, soma(pc, mult(v, b))), n2 = ponto(esb, soma(pc, mult(v, -b)));
  // eixos sempre de construção (servem para cotar os diâmetros e alinhar a elipse)
  const lm = linha(esb, m1, m2, true), ln = linha(esb, n1, n2, true);
  return { c, m1, m2, n1, n2, eixos: [lm, ln] };
}

/** Semieixo menor a partir de um ponto: distância do ponto à reta do eixo maior. */
export function semieixoMenor(c: P2, maior: P2, q: P2): number {
  const d = sub(maior, c);
  const l = Math.hypot(d.x, d.y) || 1;
  return Math.abs(cruz2(d, sub(q, c))) / l;
}

/** Elipse pelo centro, ponta do eixo maior e semieixo menor. Devolve a elipse e seus eixos. */
export function elipse(esb: FeatureEsboco, c: string, maior: P2, b: number, construcao = false): GeoEsboco[] {
  const e = eixosElipse(esb, c, maior, Math.max(1e-3, b));
  const g: Geo<"elipse"> = { id: novoId(), tipo: "elipse", c, m1: e.m1, m2: e.m2, n1: e.n1, n2: e.n2, ...(construcao && { construcao }) };
  esb.geos.push(g);
  return [g, ...e.eixos];
}

/** Elipse parcial: como a elipse, de `ini` a `fim` no sentido anti-horário (pontos projetados na curva). */
export function arcoElipse(esb: FeatureEsboco, c: string, maior: P2, b: number, ini: P2, fim: P2, construcao = false): GeoEsboco[] {
  const e = eixosElipse(esb, c, maior, Math.max(1e-3, b));
  const el = elipseDe(e, mapaPontos(esb));
  const pi = ponto(esb, pontoElipse(el, paramElipse(el, ini)));
  const pf = ponto(esb, pontoElipse(el, paramElipse(el, fim)));
  const g: Geo<"arcoElipse"> = {
    id: novoId(), tipo: "arcoElipse", c, m1: e.m1, m2: e.m2, n1: e.n1, n2: e.n2, ini: pi, fim: pf, ...(construcao && { construcao }),
  };
  esb.geos.push(g);
  return [g, ...e.eixos];
}

/** Parábola pelo foco e vértice; o arco vai de perto de `ini` a perto de `fim` (projetados). */
export function parabola(esb: FeatureEsboco, foco: string, vertice: P2, ini: P2, fim: P2, construcao = false): Geo<"parabola"> {
  const v = ponto(esb, vertice);
  const pb = parabolaDe({ v, f: foco }, mapaPontos(esb));
  let s0 = paramParabola(pb, ini), s1 = paramParabola(pb, fim);
  if (s0 > s1) [s0, s1] = [s1, s0];
  if (s1 - s0 < 1e-6) s1 = s0 + 1;
  const g: Geo<"parabola"> = {
    id: novoId(), tipo: "parabola", v, f: foco, ini: ponto(esb, pontoParabola(pb, s0)), fim: ponto(esb, pontoParabola(pb, s1)),
    ...(construcao && { construcao }),
  };
  esb.geos.push(g);
  return g;
}

// ---------- variantes de entidades (Fase 3) ----------

/** Retângulo pelo centro e um canto (com diagonais de construção presas ao centro). */
export function retanguloCentro(esb: FeatureEsboco, centro: string, canto: P2, construcao = false): GeoEsboco[] {
  const c = mapaPontos(esb).get(centro)!;
  const dx = canto.x - c.x, dy = canto.y - c.y;
  const a = ponto(esb, { x: c.x - dx, y: c.y - dy });
  const cc = ponto(esb, { x: c.x + dx, y: c.y + dy });
  const ls = retangulo(esb, a, cc, construcao);
  const b = ls[0].tipo === "linha" ? ls[0].p2 : a;
  const d = ls[2].tipo === "linha" ? ls[2].p2 : cc;
  const diag1 = linha(esb, a, cc, true);
  linha(esb, b, d, true);
  restringir(esb, { tipo: "pontoMedio", p: centro, g: diag1.id });
  return ls;
}

/** Retângulo por 3 pontos: dois cantos de um lado (qualquer ângulo) e a largura. */
export function retangulo3Pontos(esb: FeatureEsboco, p1: string, p2: string, p3: P2, construcao = false): GeoEsboco[] {
  const pts = mapaPontos(esb);
  const a = pts.get(p1)!, b = pts.get(p2)!;
  const u = sub(b, a);
  const l = Math.hypot(u.x, u.y) || 1;
  const n = { x: -u.y / l, y: u.x / l };
  const h = esc2(sub(p3, b), n);
  const c = ponto(esb, soma(b, mult(n, h)));
  const d = ponto(esb, soma(a, mult(n, h)));
  const ls = [linha(esb, p1, p2, construcao), linha(esb, p2, c, construcao), linha(esb, c, d, construcao), linha(esb, d, p1, construcao)];
  restringir(esb, { tipo: "perpendicular", a: ls[0].id, b: ls[1].id });
  restringir(esb, { tipo: "paralelo", a: ls[0].id, b: ls[2].id });
  restringir(esb, { tipo: "paralelo", a: ls[1].id, b: ls[3].id });
  return ls;
}

/** Círculo perimetral (pelos três pontos). */
export function circulo3Pontos(esb: FeatureEsboco, a: P2, b: P2, c: P2, construcao = false): Geo<"circulo"> | null {
  const ctr = centroTresPontos(a, b, c);
  if (!ctr) return null;
  return circulo(esb, ponto(esb, ctr), dist(ctr, a), construcao);
}

/** Arco pelo centro e as duas pontas (o fim é projetado no raio do início). */
export function arcoCentro(esb: FeatureEsboco, centro: string, ini: string, fim: P2, construcao = false): Geo<"arco"> {
  const pts = mapaPontos(esb);
  const c = pts.get(centro)!, pi = pts.get(ini)!;
  const r = dist(c, pi);
  const pf = polar(c, r, angulo(c, fim));
  const idf = ponto(esb, pf);
  // sentido: o menor arco entre as pontas
  return cruz2(sub(pi, c), sub(pf, c)) >= 0 ? arco(esb, centro, ini, idf, construcao) : arco(esb, centro, idf, ini, construcao);
}

/** Direção de saída de uma geometria numa extremidade (para continuar tangente). */
export function tangenteNaPonta(esb: FeatureEsboco, pontoId: string): { geo: GeoEsboco; dir: P2 } | null {
  const pts = mapaPontos(esb);
  for (const g of esb.geos) {
    if (g.construcao) continue;
    if (g.tipo === "linha" && (g.p1 === pontoId || g.p2 === pontoId)) {
      const [a, b] = g.p2 === pontoId ? [g.p1, g.p2] : [g.p2, g.p1];
      const d = sub(pts.get(b)!, pts.get(a)!);
      const l = Math.hypot(d.x, d.y) || 1;
      return { geo: g, dir: { x: d.x / l, y: d.y / l } };
    }
    if (g.tipo === "arco" && (g.ini === pontoId || g.fim === pontoId)) {
      const c = pts.get(g.c)!, p = pts.get(pontoId)!;
      const r = sub(p, c);
      const l = Math.hypot(r.x, r.y) || 1;
      // anti-horário: tangente = rot90(raio); no início o percurso chega no sentido oposto
      const t = { x: -r.y / l, y: r.x / l };
      return { geo: g, dir: g.fim === pontoId ? t : { x: -t.x, y: -t.y } };
    }
  }
  return null;
}

/** Arco tangente que começa numa ponta existente e termina em `fim`. */
export function arcoTangente(esb: FeatureEsboco, ini: string, fim: P2, construcao = false): Geo<"arco"> | null {
  const tg = tangenteNaPonta(esb, ini);
  if (!tg) return null;
  const s = mapaPontos(esb).get(ini)!;
  const n = { x: -tg.dir.y, y: tg.dir.x };
  const sp = sub(s, fim);
  const den = 2 * esc2(n, sp);
  if (Math.abs(den) < 1e-12) return null;
  const t = -esc2(sp, sp) / den;
  const c = soma(s, mult(n, t));
  const idc = ponto(esb, c);
  const idf = ponto(esb, fim);
  // t > 0: centro à esquerda → anti-horário de ini a fim
  const a = t > 0 ? arco(esb, idc, ini, idf, construcao) : arco(esb, idc, idf, ini, construcao);
  restringir(esb, { tipo: "tangente", a: tg.geo.id, b: a.id });
  return a;
}

/** Rasgo pelo centro: centro, ponta do eixo e largura. */
export function rasgoCentro(esb: FeatureEsboco, centro: string, ponta: P2, r: number, construcao = false): GeoEsboco[] {
  const c = mapaPontos(esb).get(centro)!;
  const c2 = ponto(esb, ponta);
  const c1 = ponto(esb, sub(mult(c, 2), ponta));
  const geos = rasgo(esb, c1, c2, r, construcao);
  const eixo = linha(esb, c1, c2, true);
  restringir(esb, { tipo: "pontoMedio", p: centro, g: eixo.id });
  return geos;
}

/** Polígono circunscrito: os lados tangenciam o círculo de construção. */
export function poligonoCircunscrito(esb: FeatureEsboco, c: string, meioLado: P2, lados: number, construcao = false): GeoEsboco[] {
  lados = Math.max(3, Math.min(64, Math.round(lados)));
  const pc = mapaPontos(esb).get(c)!;
  const ri = dist(pc, meioLado);
  const R = ri / Math.cos(Math.PI / lados);
  const a0 = angulo(pc, meioLado) + Math.PI / lados;
  const circ = circulo(esb, c, ri, true);
  const vs = Array.from({ length: lados }, (_, i) => ponto(esb, polar(pc, R, a0 + (i * 2 * Math.PI) / lados)));
  const ls = vs.map((v, i) => linha(esb, v, vs[(i + 1) % lados], construcao));
  for (const l of ls) restringir(esb, { tipo: "tangente", a: l.id, b: circ.id });
  for (let i = 1; i < lados; i++) restringir(esb, { tipo: "igual", a: ls[0].id, b: ls[i].id });
  return [circ, ...ls];
}

// ---------- filete e chanfro de esboço, estender ----------

/** Duas linhas que se encontram no ponto (canto). */
function linhasNoCanto(esb: FeatureEsboco, p: string): [Geo<"linha">, Geo<"linha">] | null {
  const ls = esb.geos.filter((g): g is Geo<"linha"> => g.tipo === "linha" && !g.construcao && (g.p1 === p || g.p2 === p));
  return ls.length === 2 ? [ls[0], ls[1]] : null;
}

function cantoInfo(esb: FeatureEsboco, p: string) {
  const ls = linhasNoCanto(esb, p);
  if (!ls) return null;
  const pts = mapaPontos(esb);
  const P = pts.get(p)!;
  const dirs = ls.map((l) => {
    const o = pts.get(l.p1 === p ? l.p2 : l.p1)!;
    const d = sub(o, P);
    const len = Math.hypot(d.x, d.y) || 1;
    return { u: { x: d.x / len, y: d.y / len }, len };
  });
  const cos = Math.max(-1, Math.min(1, esc2(dirs[0].u, dirs[1].u)));
  return { ls, P, dirs, theta: Math.acos(cos) };
}

/** Filete de esboço num canto entre duas linhas. Devolve o arco criado. */
export function fileteEsboco(esb: FeatureEsboco, p: string, raio: number, cotar = false): Geo<"arco"> | null {
  const ci = cantoInfo(esb, p);
  if (!ci || ci.theta < 1e-3 || ci.theta > Math.PI - 1e-3) return null;
  const d = raio / Math.tan(ci.theta / 2);
  if (d >= Math.min(ci.dirs[0].len, ci.dirs[1].len)) return null;
  const t1 = ponto(esb, soma(ci.P, mult(ci.dirs[0].u, d)));
  const t2 = ponto(esb, soma(ci.P, mult(ci.dirs[1].u, d)));
  const bis = soma(ci.dirs[0].u, ci.dirs[1].u);
  const lb = Math.hypot(bis.x, bis.y) || 1;
  const c = soma(ci.P, mult({ x: bis.x / lb, y: bis.y / lb }, raio / Math.sin(ci.theta / 2)));
  ci.ls.forEach((l, i) => {
    const novo = i === 0 ? t1 : t2;
    if (l.p1 === p) l.p1 = novo;
    else l.p2 = novo;
  });
  const idc = ponto(esb, c);
  const pts = mapaPontos(esb);
  const a = cruz2(sub(pts.get(t1)!, c), sub(pts.get(t2)!, c)) > 0 ? arco(esb, idc, t1, t2) : arco(esb, idc, t2, t1);
  restringir(esb, { tipo: "tangente", a: ci.ls[0].id, b: a.id });
  restringir(esb, { tipo: "tangente", a: ci.ls[1].id, b: a.id });
  if (cotar) restringir(esb, { tipo: "raio", a: a.id, valor: raio });
  limpar(esb);
  return a;
}

/** Chanfro de esboço (distâncias iguais ou d1/d2) num canto entre duas linhas. */
export function chanfroEsboco(esb: FeatureEsboco, p: string, d1: number, d2 = d1): Geo<"linha"> | null {
  const ci = cantoInfo(esb, p);
  if (!ci || d1 >= ci.dirs[0].len || d2 >= ci.dirs[1].len) return null;
  const t1 = ponto(esb, soma(ci.P, mult(ci.dirs[0].u, d1)));
  const t2 = ponto(esb, soma(ci.P, mult(ci.dirs[1].u, d2)));
  ci.ls.forEach((l, i) => {
    const novo = i === 0 ? t1 : t2;
    if (l.p1 === p) l.p1 = novo;
    else l.p2 = novo;
  });
  const l = linha(esb, t1, t2);
  limpar(esb);
  return l;
}

/** Estende a ponta da linha mais próxima do toque até a próxima interseção. */
export function estender(esb: FeatureEsboco, geoId: string, toque: P2): boolean {
  const g = esb.geos.find((x): x is Geo<"linha"> => x.id === geoId && x.tipo === "linha");
  if (!g) return false;
  const pts = mapaPontos(esb);
  const a = pts.get(g.p1)!, b = pts.get(g.p2)!;
  const pontaB = dist(toque, b) <= dist(toque, a);
  const [de, para] = pontaB ? [a, b] : [b, a];
  const u = sub(para, de);
  const L = 1e5;
  const longo: Geo<"linha"> = { id: "__ext", tipo: "linha", p1: "__a", p2: "__b" };
  const pts2 = new Map(pts);
  pts2.set("__a", para);
  pts2.set("__b", soma(para, mult(u, L / (Math.hypot(u.x, u.y) || 1))));
  let melhor: P2 | null = null, dm = Infinity;
  for (const o of esb.geos) {
    if (o.id === g.id) continue;
    for (const q of intersecoes(longo, o, pts2)) {
      const dd = dist(q, para);
      if (dd > 1e-6 && dd < dm) { dm = dd; melhor = q; }
    }
  }
  if (!melhor) return false;
  const pid = pontaB ? g.p2 : g.p1;
  const compartilhado = esb.geos.some((o) => o.id !== g.id && pontosDaGeo(o).includes(pid));
  if (compartilhado) {
    const novo = ponto(esb, melhor);
    if (pontaB) g.p2 = novo;
    else g.p1 = novo;
  } else {
    const pt = esb.pontos.find((x) => x.id === pid)!;
    pt.x = melhor.x;
    pt.y = melhor.y;
  }
  return true;
}

// ---------- mover, copiar, girar, padrões de esboço ----------

/** Copia (ou move) geometrias aplicando uma transformação nos pontos. Devolve ids novos. */
export function transformar(esb: FeatureEsboco, geoIds: string[], f: (p: P2) => P2, copiar: boolean): string[] {
  const geos = esb.geos.filter((g) => geoIds.includes(g.id));
  const pts = mapaPontos(esb);
  const idsPontos = [...new Set(geos.flatMap(pontosDaGeo))].filter((p) => p !== ORIGEM);
  if (!copiar) {
    for (const id of idsPontos) {
      const p = esb.pontos.find((x) => x.id === id)!;
      const q = f(p);
      p.x = q.x;
      p.y = q.y;
    }
    // texto girado/espelhado no lugar: as letras acompanham pela matriz
    for (const g of geos) {
      if (g.tipo !== "texto") continue;
      const e1 = sub(f({ x: 1, y: 0 }), f({ x: 0, y: 0 })), e2 = sub(f({ x: 0, y: 1 }), f({ x: 0, y: 0 }));
      const [a, b, c, d] = g.transf ?? [1, 0, 0, 1];
      g.transf = [e1.x * a + e2.x * c, e1.x * b + e2.x * d, e1.y * a + e2.y * c, e1.y * b + e2.y * d];
    }
    // relações que prendem os pontos movidos em lugares fixos deixam de valer
    esb.restricoes = esb.restricoes.filter((r) => !(r.tipo === "fixo" && idsPontos.includes(r.a)));
    return geoIds;
  }
  const mapa = new Map(idsPontos.map((id) => [id, ponto(esb, f(pts.get(id)!))]));
  const m = (id: string) => mapa.get(id) ?? id;
  const novas: string[] = [];
  for (const g of geos) {
    let n: GeoEsboco;
    if (g.tipo === "linha") n = linha(esb, m(g.p1), m(g.p2), g.construcao);
    else if (g.tipo === "circulo") n = circulo(esb, m(g.c), g.r, g.construcao);
    else if (g.tipo === "arco") n = arco(esb, m(g.c), m(g.ini), m(g.fim), g.construcao);
    else if (g.tipo === "ponto") n = pontoSolto(esb, m(g.p), g.construcao);
    else n = copiarCurva(esb, g, m, false, (v) => sub(f(v), f({ x: 0, y: 0 })));
    novas.push(n.id);
  }
  return novas;
}

export const transladar = (v: P2) => (p: P2): P2 => ({ x: p.x + v.x, y: p.y + v.y });
export const girar = (c: P2, graus: number) => (p: P2): P2 => {
  const a = (graus * Math.PI) / 180, co = Math.cos(a), s = Math.sin(a);
  const d = sub(p, c);
  return { x: c.x + d.x * co - d.y * s, y: c.y + d.x * s + d.y * co };
};

/** Opções do padrão linear de esboço (ângulos em graus; direção 2 só com n2 > 1). */
export interface OpcoesPadraoLinear {
  n1: number;
  esp1: number;
  ang1: number;
  n2?: number;
  esp2?: number;
  ang2?: number;
  /** Instâncias a pular, como (i, j) a partir de (1, 1) = a semente. */
  pular?: [number, number][];
  cotar1?: boolean;
  cotar2?: boolean;
}

/** Primeiro ponto (referência para as cotas do padrão) da primeira geometria da lista. */
function pontoReferencia(esb: FeatureEsboco, geoIds: string[]): string | null {
  const g = esb.geos.find((x) => geoIds.includes(x.id));
  return g ? pontosDaGeo(g)[0] ?? null : null;
}

/** Cota entre a semente e uma instância, horizontal/vertical quando a direção é de eixo. */
function cotarPasso(esb: FeatureEsboco, a: string | null, b: string | null, valor: number, angGraus: number) {
  if (!a || !b || a === b) return;
  const ang = ((angGraus % 180) + 180) % 180;
  if (Math.abs(ang) < 1e-9) restringir(esb, { tipo: "distanciaH", a, b, valor: Math.abs(valor) });
  else if (Math.abs(ang - 90) < 1e-9) restringir(esb, { tipo: "distanciaV", a, b, valor: Math.abs(valor) });
  else restringir(esb, { tipo: "distancia", a, b, valor: Math.abs(valor) });
}

/** Padrão linear de esboço em uma ou duas direções. */
export function padraoLinearEsboco(esb: FeatureEsboco, geoIds: string[], o: OpcoesPadraoLinear): string[] {
  const dir = (g: number) => ({ x: Math.cos((g * Math.PI) / 180), y: Math.sin((g * Math.PI) / 180) });
  const u = dir(o.ang1), v = dir(o.ang2 ?? 90);
  const n1 = Math.max(1, Math.round(o.n1)), n2 = Math.max(1, Math.round(o.n2 ?? 1));
  const pula = new Set((o.pular ?? []).map(([i, j]) => `${i}|${j}`));
  const ref = pontoReferencia(esb, geoIds);
  const out: string[] = [];
  for (let j = 1; j <= n2; j++) {
    for (let i = 1; i <= n1; i++) {
      if ((i === 1 && j === 1) || pula.has(`${i}|${j}`)) continue;
      const desl = soma(mult(u, o.esp1 * (i - 1)), mult(v, (o.esp2 ?? 0) * (j - 1)));
      const novas = transformar(esb, geoIds, transladar(desl), true);
      out.push(...novas);
      const refNova = pontoReferencia(esb, novas.slice(0, 1));
      if (o.cotar1 && i === 2 && j === 1) cotarPasso(esb, ref, refNova, o.esp1, o.ang1);
      if (o.cotar2 && i === 1 && j === 2) cotarPasso(esb, ref, refNova, o.esp2 ?? 0, o.ang2 ?? 90);
    }
  }
  return out;
}

/** Opções do padrão circular de esboço (ângulos em graus). */
export interface OpcoesPadraoCircular {
  centro: P2;
  n: number;
  /** Com espaçamento igual: ângulo total (360 = volta completa); sem: ângulo entre instâncias. */
  angulo: number;
  igual?: boolean;
  /** Instâncias a pular (1 = a semente). */
  pular?: number[];
  /** Ponto do esboço no centro (para cotar o raio). */
  centroId?: string | null;
  cotarRaio?: boolean;
}

/** Padrão circular de esboço em torno do centro. */
export function padraoCircularEsboco(esb: FeatureEsboco, geoIds: string[], o: OpcoesPadraoCircular): string[] {
  const k = Math.max(1, Math.round(o.n));
  const passo = o.igual === false ? o.angulo : Math.abs(o.angulo) >= 360 ? o.angulo / k : o.angulo / Math.max(1, k - 1);
  const pula = new Set(o.pular ?? []);
  const out: string[] = [];
  for (let i = 2; i <= k; i++) {
    if (pula.has(i)) continue;
    out.push(...transformar(esb, geoIds, girar(o.centro, passo * (i - 1)), true));
  }
  if (o.cotarRaio && o.centroId) {
    const ref = pontoReferencia(esb, geoIds);
    if (ref && ref !== o.centroId) restringir(esb, { tipo: "distancia", a: o.centroId, b: ref, valor: dist(mapaPontos(esb).get(ref)!, o.centro) });
  }
  return out;
}

// ---------- subfunções dos menus ▾ (linha de ponto médio, paralelogramo, rasgos em arco…) ----------

/** Linha de ponto médio: o ponto `meio` fica no meio; `ponta` é uma das extremidades. */
export function linhaPontoMedio(esb: FeatureEsboco, meio: string, ponta: P2, construcao = false): Geo<"linha"> {
  const m = mapaPontos(esb).get(meio)!;
  const a = ponto(esb, { x: 2 * m.x - ponta.x, y: 2 * m.y - ponta.y });
  const b = ponto(esb, ponta);
  const l = linha(esb, a, b, construcao);
  // o ponto do meio precisa de geometria própria para não ser limpo
  if (!esb.geos.some((g) => g.tipo === "ponto" && g.p === meio) && meio !== ORIGEM) pontoSolto(esb, meio, true);
  restringir(esb, { tipo: "pontoMedio", p: meio, g: l.id });
  return l;
}

/** Paralelogramo por três cantos (o quarto é calculado); lados opostos paralelos. */
export function paralelogramo(esb: FeatureEsboco, a: string, b: string, c: P2, construcao = false): GeoEsboco[] {
  const pts = mapaPontos(esb);
  const pa = pts.get(a)!, pb = pts.get(b)!;
  const pc = ponto(esb, c);
  const pd = ponto(esb, { x: pa.x + c.x - pb.x, y: pa.y + c.y - pb.y });
  const l1 = linha(esb, a, b, construcao), l2 = linha(esb, b, pc, construcao);
  const l3 = linha(esb, pc, pd, construcao), l4 = linha(esb, pd, a, construcao);
  restringir(esb, { tipo: "paralelo", a: l1.id, b: l3.id });
  restringir(esb, { tipo: "paralelo", a: l2.id, b: l4.id });
  return [l1, l2, l3, l4];
}

/**
 * Retângulo pelo centro por 3 pontos: centro, meio de um lado (dá a direção e meia largura)
 * e um canto (dá o meio comprimento). Diagonais de construção com o centro no meio.
 */
export function retanguloCentro3Pontos(esb: FeatureEsboco, centro: string, meioLado: P2, canto: P2, construcao = false): GeoEsboco[] {
  const c = mapaPontos(esb).get(centro)!;
  const d1 = sub(meioLado, c);
  const l = Math.hypot(d1.x, d1.y) || 1;
  const n = { x: -d1.y / l, y: d1.x / l };
  const h = Math.abs((canto.x - c.x) * n.x + (canto.y - c.y) * n.y) || l;
  const A = ponto(esb, soma(soma(c, d1), mult(n, -h)));
  const B = ponto(esb, soma(soma(c, d1), mult(n, h)));
  const ls = retangulo3Pontos(esb, A, B, sub(c, d1), construcao);
  // diagonal de construção com o centro no meio: o retângulo fica preso ao centro
  const C = ls[1]?.tipo === "linha" ? ls[1].p2 : null;
  if (C) {
    const diag = linha(esb, A, C, true);
    restringir(esb, { tipo: "pontoMedio", p: centro, g: diag.id });
  }
  return ls;
}

/**
 * Rasgo em arco: linha de centro em arco (centro, ângulos a0→a1 anti-horário, raio r) com
 * meia largura w. Dois arcos concêntricos + duas pontas semicirculares tangentes.
 */
export function rasgoArco(esb: FeatureEsboco, centro: string, r: number, a0: number, a1: number, w: number, construcao = false): GeoEsboco[] {
  const c = mapaPontos(esb).get(centro)!;
  if (!(r > w && w > 0)) return [];
  const P0 = ponto(esb, polar(c, r, a0)), P1 = ponto(esb, polar(c, r, a1));
  const O0 = ponto(esb, polar(c, r + w, a0)), O1 = ponto(esb, polar(c, r + w, a1));
  const I0 = ponto(esb, polar(c, r - w, a0)), I1 = ponto(esb, polar(c, r - w, a1));
  const fora = arco(esb, centro, O0, O1, construcao);
  const dentro = arco(esb, centro, I0, I1, construcao);
  const ponta1 = arco(esb, P1, O1, I1, construcao); // volta por fora da ponta final
  const ponta0 = arco(esb, P0, I0, O0, construcao); // volta por fora da ponta inicial
  const eixo = arco(esb, centro, P0, P1, true); // linha de centro do rasgo
  void eixo;
  for (const [x, y] of [[fora, ponta1], [ponta1, dentro], [dentro, ponta0], [ponta0, fora]] as const) {
    restringir(esb, { tipo: "tangente", a: x.id, b: y.id });
  }
  restringir(esb, { tipo: "igual", a: ponta0.id, b: ponta1.id });
  return [fora, ponta1, dentro, ponta0];
}
