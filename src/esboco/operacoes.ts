// Operações sobre o esboço: criação de entidades compostas (retângulo, rasgo, polígono…),
// aparar, offset, espelhar e exclusão. Funções puras sobre o modelo (testáveis em Node);
// depois de cada operação o editor chama o solver.

import type { FeatureEsboco, GeoEsboco, RestricaoEsboco } from "../model";
import { novoId } from "../model";
import {
  angulo, angulosArco, areaAssinada, centroTresPontos, cruz2, dist, distPontoSegmento, EIXO_H, EIXO_V,
  esc2, extremidades, IDS_IMPLICITOS, intersecoes, mapaPontos, mult, norm, ORIGEM, paramNoArco, polar,
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

function cortesNaGeo(esb: FeatureEsboco, g: GeoEsboco, pts: MapaPontos): Corte[] {
  const cortes: Corte[] = [];
  for (const o of esb.geos) {
    if (o.id === g.id) continue;
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

/**
 * Apaga o trecho da geometria entre as interseções vizinhas ao ponto tocado.
 * Sem interseções, apaga a geometria inteira. Devolve false se não houve mudança.
 */
export function aparar(esb: FeatureEsboco, geoId: string, toque: P2): boolean {
  const g = esb.geos.find((x) => x.id === geoId);
  if (!g) return false;
  const pts = mapaPontos(esb);
  if (g.tipo === "spline") {
    excluir(esb, [g.id]);
    return true;
  }
  const cortes = cortesNaGeo(esb, g, pts);

  if (g.tipo === "circulo") {
    if (cortes.length < 2) {
      excluir(esb, [g.id]);
      return true;
    }
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

  if (!antes && !depois) {
    excluir(esb, [g.id]);
    return true;
  }
  const [chIni, chFim] = g.tipo === "linha" ? (["p1", "p2"] as const) : (["ini", "fim"] as const);
  const gg = g as unknown as Record<string, unknown>;
  if (!antes) {
    gg[chIni] = pontoDeCorte(esb, depois!);
  } else if (!depois) {
    gg[chFim] = pontoDeCorte(esb, antes);
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
  }
  // cotas de comprimento da linha original deixam de valer
  esb.restricoes = esb.restricoes.filter((r) => !(r.tipo === "distancia" && r.a === g.id && !r.b));
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

/**
 * Cria cópias deslocadas das geometrias. Distância positiva = para fora em contornos fechados
 * (e para a esquerda em cadeias abertas); negativa inverte. Devolve os ids das novas geometrias.
 */
export function deslocar(esb: FeatureEsboco, geoIds: string[], d: number): string[] {
  const pts = mapaPontos(esb);
  const geos = esb.geos.filter((g) => geoIds.includes(g.id));
  const novas: string[] = [];
  let cotada = false;

  for (const g of geos) {
    if (g.tipo !== "circulo") continue;
    const nc = circulo(esb, g.c, Math.max(1e-3, g.r + d), g.construcao);
    restringir(esb, { tipo: "concentrico", a: g.id, b: nc.id });
    novas.push(nc.id);
  }

  for (const { elos, fechada } of cadeias(geos, pts)) {
    let dd = d;
    if (fechada) {
      const pol = elos.map((e) => pts.get(e.invertido ? extremidades(e.g)![1] : extremidades(e.g)![0])!);
      if (areaAssinada(pol) > 0) dd = -d; // anti-horário: a esquerda é o lado de dentro
    }
    const desl = elos.map((e) => deslocarElo(e, pts, dd));
    const n = desl.length;
    const juntas: string[] = [];
    for (let i = 0; i < n; i++) {
      const anterior = i === 0 ? (fechada ? desl[n - 1] : null) : desl[i - 1];
      juntas.push(ponto(esb, anterior ? juntar(anterior, desl[i]) : desl[i].a));
    }
    const fimAberto = fechada ? juntas[0] : ponto(esb, desl[n - 1].b);
    desl.forEach((x, i) => {
      const a = juntas[i], b = i + 1 < n ? juntas[i + 1] : fimAberto;
      const orig = elos[i].g;
      if (x.tipo === "linha") {
        const nl = linha(esb, a, b, orig.construcao);
        restringir(esb, { tipo: "paralelo", a: orig.id, b: nl.id });
        if (!cotada) {
          restringir(esb, { tipo: "distancia", a: nl.p1, b: orig.id, valor: Math.abs(d), texto: mult(soma(pts.get((orig as Geo<"linha">).p1)!, x.a), 0.5) });
          cotada = true;
        }
        novas.push(nl.id);
      } else {
        const ic = (orig as Geo<"arco">).c;
        // o arco novo segue o sentido anti-horário do original
        const na = elos[i].invertido ? arco(esb, ic, b, a, orig.construcao) : arco(esb, ic, a, b, orig.construcao);
        novas.push(na.id);
      }
    });
  }
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
    else n = spline(esb, g.pontos.map(par), g.construcao);
    novas.push(n.id);
  }
  return novas;
}
