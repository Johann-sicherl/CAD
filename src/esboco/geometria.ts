// Geometria 2D do esboço: amostragem para desenho, distância para seleção, interseções
// e montagem dos contornos fechados que viram perfil. Sem dependências: roda no navegador,
// no worker do kernel e nos testes em Node.

import type { FeatureEsboco, GeoEsboco } from "../model";

export interface P2 {
  x: number;
  y: number;
}

/** Pontos fixos e eixos implícitos de todo esboço (podem ser usados em relações). */
export const ORIGEM = "origem";
export const EIXO_H = "eixoH";
export const EIXO_V = "eixoV";
export const IDS_IMPLICITOS = new Set([ORIGEM, EIXO_H, EIXO_V]);

export const TOL = 1e-6;
const DOIS_PI = Math.PI * 2;

export const dist = (a: P2, b: P2) => Math.hypot(b.x - a.x, b.y - a.y);
export const sub = (a: P2, b: P2): P2 => ({ x: a.x - b.x, y: a.y - b.y });
export const soma = (a: P2, b: P2): P2 => ({ x: a.x + b.x, y: a.y + b.y });
export const mult = (a: P2, k: number): P2 => ({ x: a.x * k, y: a.y * k });
export const cruz2 = (a: P2, b: P2) => a.x * b.y - a.y * b.x;
export const esc2 = (a: P2, b: P2) => a.x * b.x + a.y * b.y;
export const angulo = (c: P2, p: P2) => Math.atan2(p.y - c.y, p.x - c.x);
export const polar = (c: P2, r: number, a: number): P2 => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });

/** Normaliza um ângulo para [0, 2π). */
export function norm(a: number): number {
  a %= DOIS_PI;
  return a < 0 ? a + DOIS_PI : a;
}

/** Ângulos de início e fim de um arco anti-horário, com fim > início. */
export function angulosArco(c: P2, ini: P2, fim: P2): [number, number] {
  const a0 = angulo(c, ini);
  let a1 = angulo(c, fim);
  while (a1 <= a0 + TOL) a1 += DOIS_PI;
  return [a0, a1];
}

/** O ângulo `a` está dentro do arco [a0, a1] (anti-horário)? Devolve o parâmetro 0..1 ou null. */
export function paramNoArco(a: number, a0: number, a1: number, folga = 1e-9): number | null {
  const varredura = a1 - a0;
  const d = norm(a - a0);
  if (d <= varredura + folga) return d / varredura;
  if (d >= DOIS_PI - folga) return 0;
  return null;
}

/** Centro do círculo pelos três pontos (null se forem colineares). */
export function centroTresPontos(a: P2, b: P2, c: P2): P2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

// ---------- acesso ao esboço ----------

export type MapaPontos = Map<string, P2>;

export function mapaPontos(esb: Pick<FeatureEsboco, "pontos">): MapaPontos {
  const m: MapaPontos = new Map(esb.pontos.map((p) => [p.id, p]));
  m.set(ORIGEM, { x: 0, y: 0 });
  return m;
}

export function pontosDaGeo(g: GeoEsboco): string[] {
  switch (g.tipo) {
    case "linha":
      return [g.p1, g.p2];
    case "circulo":
      return [g.c];
    case "arco":
      return [g.c, g.ini, g.fim];
    case "spline":
      return g.pontos;
    case "ponto":
      return [g.p];
  }
}

/** Pontos das extremidades (onde a geometria se liga a outra). */
export function extremidades(g: GeoEsboco): [string, string] | null {
  switch (g.tipo) {
    case "linha":
      return [g.p1, g.p2];
    case "arco":
      return [g.ini, g.fim];
    case "spline":
      return g.pontos.length >= 2 ? [g.pontos[0], g.pontos[g.pontos.length - 1]] : null;
    case "circulo":
    case "ponto":
      return null;
  }
}

// ---------- spline (Catmull-Rom uniforme convertida em Béziers cúbicas) ----------

export type Bezier = [P2, P2, P2, P2];

export function splineBeziers(pts: P2[]): Bezier[] {
  const n = pts.length;
  if (n < 2) return [];
  const fechada = n > 3 && dist(pts[0], pts[n - 1]) < TOL;
  const q = fechada ? pts.slice(0, -1) : pts;
  const m = q.length;
  const pega = (i: number): P2 => {
    if (fechada) return q[(i + m) % m];
    if (i < 0) return soma(q[0], sub(q[0], q[1])); // reflete para tangente natural na ponta
    if (i >= m) return soma(q[m - 1], sub(q[m - 1], q[m - 2]));
    return q[i];
  };
  const res: Bezier[] = [];
  const segs = fechada ? m : m - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = pega(i - 1), p1 = pega(i), p2 = pega(i + 1), p3 = pega(i + 2);
    res.push([p1, soma(p1, mult(sub(p2, p0), 1 / 6)), sub(p2, mult(sub(p3, p1), 1 / 6)), p2]);
  }
  return res;
}

export function pontoBezier([a, b, c, d]: Bezier, t: number): P2 {
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return { x: k0 * a.x + k1 * b.x + k2 * c.x + k3 * d.x, y: k0 * a.y + k1 * b.y + k2 * c.y + k3 * d.y };
}

// ---------- amostragem (desenho na tela e testes de proximidade) ----------

/** Polilinha que representa a geometria. `passoAng` em radianos para círculos e arcos. */
export function amostrar(g: GeoEsboco, pts: MapaPontos, passoAng = Math.PI / 48): P2[] {
  switch (g.tipo) {
    case "linha":
      return [pts.get(g.p1)!, pts.get(g.p2)!];
    case "circulo": {
      const c = pts.get(g.c)!;
      const n = Math.max(24, Math.ceil(DOIS_PI / passoAng));
      return Array.from({ length: n + 1 }, (_, i) => polar(c, g.r, (i / n) * DOIS_PI));
    }
    case "arco": {
      const c = pts.get(g.c)!;
      const [a0, a1] = angulosArco(c, pts.get(g.ini)!, pts.get(g.fim)!);
      const r = dist(c, pts.get(g.ini)!);
      const n = Math.max(6, Math.ceil((a1 - a0) / passoAng));
      return Array.from({ length: n + 1 }, (_, i) => polar(c, r, a0 + ((a1 - a0) * i) / n));
    }
    case "ponto":
      return [pts.get(g.p)!];
    case "spline": {
      const bz = splineBeziers(g.pontos.map((id) => pts.get(id)!));
      const out: P2[] = [];
      bz.forEach((b, i) => {
        for (let k = i === 0 ? 0 : 1; k <= 16; k++) out.push(pontoBezier(b, k / 16));
      });
      return out;
    }
  }
}

export function distPontoSegmento(p: P2, a: P2, b: P2): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = esc2(ab, ab);
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, esc2(sub(p, a), ab) / l2));
  return { d: dist(p, soma(a, mult(ab, t))), t };
}

export function distanciaGeo(g: GeoEsboco, pts: MapaPontos, p: P2): number {
  switch (g.tipo) {
    case "ponto":
      return dist(pts.get(g.p)!, p);
    case "linha":
      return distPontoSegmento(p, pts.get(g.p1)!, pts.get(g.p2)!).d;
    case "circulo":
      return Math.abs(dist(pts.get(g.c)!, p) - g.r);
    case "arco": {
      const c = pts.get(g.c)!, ini = pts.get(g.ini)!, fim = pts.get(g.fim)!;
      const [a0, a1] = angulosArco(c, ini, fim);
      if (paramNoArco(angulo(c, p), a0, a1) !== null) return Math.abs(dist(c, p) - dist(c, ini));
      return Math.min(dist(p, ini), dist(p, fim));
    }
    case "spline": {
      const pl = amostrar(g, pts);
      let d = Infinity;
      for (let i = 0; i + 1 < pl.length; i++) d = Math.min(d, distPontoSegmento(p, pl[i], pl[i + 1]).d);
      return d;
    }
  }
}

/** Ponto da geometria mais próximo de `p` (para "ponto sobre curva"). */
export function projetarNaGeo(g: GeoEsboco, pts: MapaPontos, p: P2): P2 {
  switch (g.tipo) {
    case "ponto":
      return pts.get(g.p)!;
    case "linha": {
      const a = pts.get(g.p1)!, b = pts.get(g.p2)!;
      return soma(a, mult(sub(b, a), distPontoSegmento(p, a, b).t));
    }
    case "circulo":
    case "arco": {
      const c = pts.get(g.c)!;
      const r = g.tipo === "circulo" ? g.r : dist(c, pts.get(g.ini)!);
      return polar(c, r, angulo(c, p));
    }
    case "spline": {
      const pl = amostrar(g, pts);
      let melhor = pl[0], d = Infinity;
      for (let i = 0; i + 1 < pl.length; i++) {
        const r = distPontoSegmento(p, pl[i], pl[i + 1]);
        if (r.d < d) { d = r.d; melhor = soma(pl[i], mult(sub(pl[i + 1], pl[i]), r.t)); }
      }
      return melhor;
    }
  }
}

// ---------- interseções ----------

/** Curva analítica: segmento (com parâmetro 0..1) ou círculo/arco (parâmetro angular). */
type Curva =
  | { tipo: "seg"; a: P2; b: P2 }
  | { tipo: "circ"; c: P2; r: number; a0?: number; a1?: number };

function curvaDe(g: GeoEsboco, pts: MapaPontos): Curva | null {
  switch (g.tipo) {
    case "linha":
      return { tipo: "seg", a: pts.get(g.p1)!, b: pts.get(g.p2)! };
    case "circulo":
      return { tipo: "circ", c: pts.get(g.c)!, r: g.r };
    case "arco": {
      const c = pts.get(g.c)!;
      const [a0, a1] = angulosArco(c, pts.get(g.ini)!, pts.get(g.fim)!);
      return { tipo: "circ", c, r: dist(c, pts.get(g.ini)!), a0, a1 };
    }
    case "spline":
    case "ponto":
      return null;
  }
}

function linhaCirculo(a: P2, b: P2, c: P2, r: number): number[] {
  const d = sub(b, a), f = sub(a, c);
  const A = esc2(d, d), B = 2 * esc2(f, d), C = esc2(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-18 || disc < -1e-9) return [];
  const s = Math.sqrt(Math.max(0, disc));
  return disc < 1e-12 ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}

function circuloCirculo(c1: P2, r1: number, c2: P2, r2: number): P2[] {
  const d = dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = soma(c1, mult(sub(c2, c1), a / d));
  const o = { x: (-(c2.y - c1.y) * h) / d, y: ((c2.x - c1.x) * h) / d };
  return h < 1e-9 ? [m] : [soma(m, o), sub(m, o)];
}

function dentroDaCurva(cv: Curva, p: P2): boolean {
  if (cv.tipo === "seg") return distPontoSegmento(p, cv.a, cv.b).d < 1e-7;
  if (cv.a0 === undefined) return true;
  return paramNoArco(angulo(cv.c, p), cv.a0, cv.a1!, 1e-7) !== null;
}

/** Pontos onde as duas geometrias se cruzam (splines são ignoradas). */
export function intersecoes(g1: GeoEsboco, g2: GeoEsboco, pts: MapaPontos): P2[] {
  const c1 = curvaDe(g1, pts), c2 = curvaDe(g2, pts);
  if (!c1 || !c2) return [];
  let cand: P2[] = [];
  if (c1.tipo === "seg" && c2.tipo === "seg") {
    const r = sub(c1.b, c1.a), s = sub(c2.b, c2.a);
    const den = cruz2(r, s);
    if (Math.abs(den) < 1e-12) return [];
    const t = cruz2(sub(c2.a, c1.a), s) / den;
    cand = [soma(c1.a, mult(r, t))];
  } else if (c1.tipo === "seg" || c2.tipo === "seg") {
    const seg = (c1.tipo === "seg" ? c1 : c2) as Extract<Curva, { tipo: "seg" }>;
    const circ = (c1.tipo === "circ" ? c1 : c2) as Extract<Curva, { tipo: "circ" }>;
    cand = linhaCirculo(seg.a, seg.b, circ.c, circ.r).map((t) => soma(seg.a, mult(sub(seg.b, seg.a), t)));
  } else if (c1.tipo === "circ" && c2.tipo === "circ") {
    cand = circuloCirculo(c1.c, c1.r, c2.c, c2.r);
  }
  return cand.filter((p) => dentroDaCurva(c1, p) && dentroDaCurva(c2, p));
}

/** Parâmetro de um ponto sobre a geometria: 0..1 para linha; ângulo absoluto para círculo/arco. */
export function parametroNaGeo(g: GeoEsboco, pts: MapaPontos, p: P2): number {
  if (g.tipo === "linha") return distPontoSegmento(p, pts.get(g.p1)!, pts.get(g.p2)!).t;
  if (g.tipo === "circulo" || g.tipo === "arco") return angulo(pts.get(g.c)!, p);
  return 0;
}

// ---------- contornos fechados (perfil para extrusão/revolução) ----------

export type Trecho =
  | { tipo: "linha"; a: P2; b: P2 }
  | { tipo: "arco"; a: P2; meio: P2; b: P2 }
  | { tipo: "bezier"; a: P2; c1: P2; c2: P2; b: P2 };

export type Laco =
  | { tipo: "circulo"; c: P2; r: number; poligono: P2[] }
  | { tipo: "trechos"; trechos: Trecho[]; poligono: P2[] };

export class ErroPerfil extends Error {}

/** Trechos orientados de uma geometria, do ponto `de` ao outro extremo. */
function trechosDe(g: GeoEsboco, pts: MapaPontos, invertido: boolean): Trecho[] {
  let t: Trecho[];
  if (g.tipo === "linha") {
    t = [{ tipo: "linha", a: pts.get(g.p1)!, b: pts.get(g.p2)! }];
  } else if (g.tipo === "arco") {
    const c = pts.get(g.c)!;
    const ini = pts.get(g.ini)!, fim = pts.get(g.fim)!;
    const [a0, a1] = angulosArco(c, ini, fim);
    t = [{ tipo: "arco", a: ini, meio: polar(c, dist(c, ini), (a0 + a1) / 2), b: fim }];
  } else if (g.tipo === "spline") {
    t = splineBeziers(g.pontos.map((id) => pts.get(id)!)).map(([a, c1, c2, b]) => ({ tipo: "bezier", a, c1, c2, b }));
  } else {
    return [];
  }
  if (!invertido) return t;
  return t.reverse().map((x) =>
    x.tipo === "linha" ? { ...x, a: x.b, b: x.a }
    : x.tipo === "arco" ? { ...x, a: x.b, b: x.a }
    : { tipo: "bezier", a: x.b, c1: x.c2, c2: x.c1, b: x.a },
  );
}

function poligonoDeTrechos(ts: Trecho[]): P2[] {
  const out: P2[] = [];
  for (const t of ts) {
    if (t.tipo === "linha") out.push(t.a);
    else if (t.tipo === "arco") {
      const c = centroTresPontos(t.a, t.meio, t.b)!;
      const r = dist(c, t.a);
      const a0 = angulo(c, t.a);
      const ccw = norm(angulo(c, t.b) - a0);
      // varredura com sinal: o sentido é o que passa pelo ponto do meio
      const varr = norm(angulo(c, t.meio) - a0) < ccw ? ccw : ccw - DOIS_PI;
      const n = Math.max(4, Math.ceil(Math.abs(varr) / (Math.PI / 24)));
      for (let i = 0; i < n; i++) out.push(polar(c, r, a0 + (varr * i) / n));
    } else {
      for (let k = 0; k < 12; k++) out.push(pontoBezier([t.a, t.c1, t.c2, t.b], k / 12));
    }
  }
  return out;
}

export function areaAssinada(pol: P2[]): number {
  let a = 0;
  for (let i = 0; i < pol.length; i++) a += cruz2(pol[i], pol[(i + 1) % pol.length]);
  return a / 2;
}

export function pontoNoPoligono(p: P2, pol: P2[]): boolean {
  let dentro = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const a = pol[i], b = pol[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/**
 * Encontra os contornos fechados das geometrias que não são de construção.
 * Extremidades são ligadas por posição (pontos coincidentes contam como o mesmo nó).
 * Lança ErroPerfil com mensagem útil se houver contorno aberto ou ramificado.
 */
export function encontrarLacos(esb: Pick<FeatureEsboco, "pontos" | "geos">): Laco[] {
  const pts = mapaPontos(esb);
  const lacos: Laco[] = [];
  const geos = esb.geos.filter((g) => !g.construcao && g.tipo !== "ponto");

  for (const g of geos) {
    if (g.tipo === "circulo") {
      const c = pts.get(g.c)!;
      lacos.push({ tipo: "circulo", c, r: g.r, poligono: amostrar(g, pts).slice(0, -1) });
    }
  }

  // nós por posição
  const nos: P2[] = [];
  const noDe = (p: P2) => {
    const tol = 1e-4;
    let i = nos.findIndex((n) => dist(n, p) < tol);
    if (i < 0) { nos.push(p); i = nos.length - 1; }
    return i;
  };
  const arestas: { g: GeoEsboco; a: number; b: number }[] = [];
  for (const g of geos) {
    const e = extremidades(g);
    if (!e) continue;
    // uma spline fechada sozinha tem a === b e grau 2 no mesmo nó: vira um laço próprio
    arestas.push({ g, a: noDe(pts.get(e[0])!), b: noDe(pts.get(e[1])!) });
  }
  const grau = new Map<number, number>();
  for (const e of arestas) {
    grau.set(e.a, (grau.get(e.a) ?? 0) + 1);
    grau.set(e.b, (grau.get(e.b) ?? 0) + 1);
  }
  for (const [no, gr] of grau) {
    if (gr === 1) throw new ErroPerfil(`Contorno aberto perto de (${fmt(nos[no])}): feche o perfil.`);
    if (gr > 2) throw new ErroPerfil(`Contorno ramificado em (${fmt(nos[no])}): mais de duas curvas se encontram.`);
  }

  const usada = new Set<number>();
  for (let i = 0; i < arestas.length; i++) {
    if (usada.has(i)) continue;
    const trechos: Trecho[] = [];
    let atual = i, noAtual = arestas[i].a;
    while (!usada.has(atual)) {
      usada.add(atual);
      const e = arestas[atual];
      const invertido = e.a !== noAtual;
      trechos.push(...trechosDe(e.g, pts, invertido));
      noAtual = invertido ? e.a : e.b;
      atual = arestas.findIndex((x, k) => !usada.has(k) && (x.a === noAtual || x.b === noAtual));
      if (atual < 0) break;
    }
    lacos.push({ tipo: "trechos", trechos, poligono: poligonoDeTrechos(trechos) });
  }
  if (!lacos.length) throw new ErroPerfil("O esboço não tem nenhum contorno fechado.");
  return lacos;
}

/** Profundidade de aninhamento de cada laço (0 = externo, 1 = furo, 2 = ilha…). */
export function aninhamento(lacos: Laco[]): number[] {
  return lacos.map((l, i) => {
    const amostra = l.poligono[0];
    return lacos.filter((o, j) => j !== i && Math.abs(areaAssinada(o.poligono)) > Math.abs(areaAssinada(l.poligono)) && pontoNoPoligono(amostra, o.poligono)).length;
  });
}

const fmt = (p: P2) => `${p.x.toFixed(1)}; ${p.y.toFixed(1)}`;


/**
 * Cadeia aberta (nervura, recurso fino em perfil aberto): polilinha amostrada das geometrias
 * que não são de construção, da ponta solta até a outra. Null se não houver cadeia aberta única.
 */
export function cadeiaAberta(esb: Pick<FeatureEsboco, "pontos" | "geos">): P2[] | null {
  const pts = mapaPontos(esb);
  const geos = esb.geos.filter((g) => !g.construcao && extremidades(g));
  if (!geos.length) return null;
  const nos: P2[] = [];
  const noDe = (p: P2) => {
    let i = nos.findIndex((n) => dist(n, p) < 1e-4);
    if (i < 0) { nos.push(p); i = nos.length - 1; }
    return i;
  };
  const arestas = geos.map((g) => {
    const [a, b] = extremidades(g)!;
    return { g, a: noDe(pts.get(a)!), b: noDe(pts.get(b)!) };
  });
  const grau = new Map<number, number>();
  for (const e of arestas) for (const n of [e.a, e.b]) grau.set(n, (grau.get(n) ?? 0) + 1);
  const pontas = [...grau].filter(([, g]) => g === 1).map(([n]) => n);
  if (pontas.length !== 2 || [...grau.values()].some((g) => g > 2)) return null;
  const out: P2[] = [];
  const usadas = new Set<number>();
  let no = pontas[0];
  for (;;) {
    const i = arestas.findIndex((e, k) => !usadas.has(k) && (e.a === no || e.b === no));
    if (i < 0) break;
    usadas.add(i);
    const e = arestas[i];
    let pl = amostrar(e.g, pts);
    if (e.a !== no) pl = pl.slice().reverse();
    out.push(...(out.length ? pl.slice(1) : pl));
    no = e.a === no ? e.b : e.a;
  }
  return out;
}
