// Cotas do esboço: medição do valor atual e desenho (linha de cota, linhas de chamada, setas).
// Tudo em mm no plano do esboço; o tamanho das setas vem da escala da tela (mm por pixel).

import type { CotaEsboco, FeatureEsboco, GeoEsboco } from "../model";
import {
  angulo, dist, distPontoSegmento, EIXO_H, EIXO_V, esc2, mapaPontos, mult, norm, polar, soma, sub,
  type MapaPontos, type P2,
} from "./geometria";

type Reta = { a: P2; b: P2 };

function retaDe(id: string, geos: Map<string, GeoEsboco>, pts: MapaPontos): Reta | null {
  if (id === EIXO_H) return { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
  if (id === EIXO_V) return { a: { x: 0, y: 0 }, b: { x: 0, y: 1 } };
  const g = geos.get(id);
  return g && g.tipo === "linha" ? { a: pts.get(g.p1)!, b: pts.get(g.p2)! } : null;
}

/** Ponto representado por um id: o próprio ponto, ou o centro de círculo/arco. */
function pontoDe(id: string, geos: Map<string, GeoEsboco>, pts: MapaPontos): P2 | null {
  const g = geos.get(id);
  if (g && (g.tipo === "circulo" || g.tipo === "arco")) return pts.get(g.c)!;
  return pts.get(id) ?? null;
}

function raioDe(g: GeoEsboco, pts: MapaPontos): number {
  return g.tipo === "circulo" ? g.r : g.tipo === "arco" ? dist(pts.get(g.c)!, pts.get(g.ini)!) : 0;
}

/** Pé da perpendicular de p sobre a reta (infinita). */
function pe(p: P2, r: Reta): P2 {
  const u = sub(r.b, r.a);
  return soma(r.a, mult(u, esc2(sub(p, r.a), u) / (esc2(u, u) || 1)));
}

/** Os dois pontos medidos por uma cota linear (null se não se aplica). */
function extremosLineares(c: CotaEsboco, esb: FeatureEsboco): [P2, P2] | null {
  const pts = mapaPontos(esb);
  const geos = new Map(esb.geos.map((g) => [g.id, g]));
  if (c.tipo === "distancia" && !c.b) {
    const r = retaDe(c.a, geos, pts);
    return r ? [r.a, r.b] : null;
  }
  if (c.tipo !== "distancia" && c.tipo !== "distanciaH" && c.tipo !== "distanciaV") return null;
  const b = c.b!;
  const pa = pontoDe(c.a, geos, pts), pb = pontoDe(b, geos, pts);
  if (pa && pb) return [pa, pb];
  const ra = retaDe(c.a, geos, pts), rb = retaDe(b, geos, pts);
  if (pa && rb) return [pa, pe(pa, rb)];
  if (ra && pb) return [pe(pb, ra), pb];
  if (ra && rb) return [pe(rb.a, ra), rb.a];
  return null;
}

/** Valor medido agora na geometria (mm ou graus). */
export function medirCota(c: CotaEsboco, esb: FeatureEsboco): number {
  const pts = mapaPontos(esb);
  const geos = new Map(esb.geos.map((g) => [g.id, g]));
  switch (c.tipo) {
    case "raio":
    case "diametro": {
      const g = geos.get(c.a);
      const r = g ? raioDe(g, pts) : 0;
      return c.tipo === "raio" ? r : 2 * r;
    }
    case "angulo": {
      const ra = retaDe(c.a, geos, pts), rb = retaDe(c.b, geos, pts);
      if (!ra || !rb) return 0;
      const u = sub(ra.b, ra.a), v = sub(rb.b, rb.a);
      return Math.abs((Math.atan2(u.x * v.y - u.y * v.x, esc2(u, v)) * 180) / Math.PI);
    }
    default: {
      const e = extremosLineares(c, esb);
      if (!e) return 0;
      if (c.tipo === "distanciaH") return Math.abs(e[1].x - e[0].x);
      if (c.tipo === "distanciaV") return Math.abs(e[1].y - e[0].y);
      return dist(e[0], e[1]);
    }
  }
}

export function textoCota(c: CotaEsboco): string {
  const v = Number(c.valor.toFixed(c.tipo === "angulo" ? 2 : 3)).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const t = c.tipo === "diametro" ? `Ø${v}` : c.tipo === "raio" ? `R${v}` : c.tipo === "angulo" ? `${v}°` : v;
  return c.referencia ? `(${t})` : t;
}

export interface DesenhoCota {
  segmentos: P2[]; // pares de pontos
  texto: P2; // onde fica o número
}

function seta(ponta: P2, dir: P2, tam: number): P2[] {
  const l = Math.hypot(dir.x, dir.y) || 1;
  const u = { x: dir.x / l, y: dir.y / l };
  const a = 0.38;
  const r1 = { x: u.x * Math.cos(a) - u.y * Math.sin(a), y: u.x * Math.sin(a) + u.y * Math.cos(a) };
  const r2 = { x: u.x * Math.cos(-a) - u.y * Math.sin(-a), y: u.x * Math.sin(-a) + u.y * Math.cos(-a) };
  return [ponta, sub(ponta, mult(r1, tam)), ponta, sub(ponta, mult(r2, tam))];
}

/** Posição padrão do texto (quando a cota ainda não foi arrastada). */
export function textoPadrao(c: CotaEsboco, esb: FeatureEsboco, mmPx: number): P2 {
  const pts = mapaPontos(esb);
  const geos = new Map(esb.geos.map((g) => [g.id, g]));
  const afast = 28 * mmPx;
  if (c.tipo === "raio" || c.tipo === "diametro") {
    const g = geos.get(c.a);
    if (!g || (g.tipo !== "circulo" && g.tipo !== "arco")) return { x: 0, y: 0 };
    const ctr = pts.get(g.c)!;
    return polar(ctr, raioDe(g, pts) + afast, Math.PI / 4);
  }
  if (c.tipo === "angulo") {
    const ra = retaDe(c.a, geos, pts);
    return ra ? soma(ra.a, mult(sub(ra.b, ra.a), 0.3)) : { x: 0, y: 0 };
  }
  const e = extremosLineares(c, esb);
  if (!e) return { x: 0, y: 0 };
  const m = mult(soma(e[0], e[1]), 0.5);
  if (c.tipo === "distanciaH") return { x: m.x, y: Math.max(e[0].y, e[1].y) + afast };
  if (c.tipo === "distanciaV") return { x: Math.max(e[0].x, e[1].x) + afast, y: m.y };
  const u = sub(e[1], e[0]);
  const l = Math.hypot(u.x, u.y) || 1;
  return soma(m, { x: (-u.y / l) * afast, y: (u.x / l) * afast });
}

export function desenharCota(c: CotaEsboco, esb: FeatureEsboco, mmPx: number): DesenhoCota | null {
  const pts = mapaPontos(esb);
  const geos = new Map(esb.geos.map((g) => [g.id, g]));
  const T = c.texto ?? textoPadrao(c, esb, mmPx);
  const s = 9 * mmPx; // seta
  const folga = 4 * mmPx; // linha de chamada passa um pouco da linha de cota

  if (c.tipo === "raio" || c.tipo === "diametro") {
    const g = geos.get(c.a);
    if (!g || (g.tipo !== "circulo" && g.tipo !== "arco")) return null;
    const ctr = pts.get(g.c)!;
    const r = raioDe(g, pts);
    const th = angulo(ctr, T);
    const A = polar(ctr, r, th);
    const fora = dist(ctr, T) > r;
    const seg: P2[] = [];
    if (c.tipo === "raio") {
      seg.push(ctr, fora ? T : A, ...seta(A, sub(A, ctr), s));
    } else {
      const B = polar(ctr, r, th + Math.PI);
      seg.push(B, fora ? T : A, ...seta(A, sub(A, ctr), s), ...seta(B, sub(B, ctr), s));
    }
    return { segmentos: seg, texto: T };
  }

  if (c.tipo === "angulo") {
    const ra = retaDe(c.a, geos, pts), rb = retaDe(c.b, geos, pts);
    if (!ra || !rb) return null;
    const u = sub(ra.b, ra.a), v = sub(rb.b, rb.a);
    const den = u.x * v.y - u.y * v.x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((rb.a.x - ra.a.x) * v.y - (rb.a.y - ra.a.y) * v.x) / den;
    const O = soma(ra.a, mult(u, t));
    const rho = Math.max(dist(O, T), 6 * mmPx);
    // setor entre as semirretas (±u, ±v) que contém o texto
    const angs = [angulo({ x: 0, y: 0 }, u), angulo({ x: 0, y: 0 }, v)].flatMap((a) => [norm(a), norm(a + Math.PI)]).sort((p, q) => p - q);
    const at = norm(angulo(O, T));
    let a0 = angs[angs.length - 1] - 2 * Math.PI, a1 = angs[0];
    for (let i = 0; i + 1 < angs.length; i++) if (at >= angs[i] && at <= angs[i + 1]) [a0, a1] = [angs[i], angs[i + 1]];
    const seg: P2[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) seg.push(polar(O, rho, a0 + ((a1 - a0) * i) / n), polar(O, rho, a0 + ((a1 - a0) * (i + 1)) / n));
    return { segmentos: seg, texto: T };
  }

  const e = extremosLineares(c, esb);
  if (!e) return null;
  const [P, Q] = e;
  let A: P2, B: P2;
  if (c.tipo === "distanciaH") {
    A = { x: P.x, y: T.y };
    B = { x: Q.x, y: T.y };
  } else if (c.tipo === "distanciaV") {
    A = { x: T.x, y: P.y };
    B = { x: T.x, y: Q.y };
  } else {
    const u = sub(Q, P);
    const l = Math.hypot(u.x, u.y) || 1;
    const n = { x: -u.y / l, y: u.x / l };
    const off = esc2(sub(T, P), n);
    A = soma(P, mult(n, off));
    B = soma(Q, mult(n, off));
  }
  const seg: P2[] = [];
  const chamada = (de: P2, ate: P2) => {
    const d = sub(ate, de);
    const l = Math.hypot(d.x, d.y);
    if (l > 1e-9) seg.push(soma(de, mult(d, Math.min(1, 2 * mmPx / l))), soma(ate, mult(d, folga / l)));
  };
  chamada(P, A);
  chamada(Q, B);
  // linha de cota até o texto, se ele estiver fora do intervalo
  const AB = sub(B, A);
  const lab = Math.hypot(AB.x, AB.y);
  if (lab > 1e-9) {
    const t = distPontoSegmento(T, A, B).t;
    const tt = esc2(sub(T, A), AB) / (lab * lab);
    seg.push(A, B);
    if (tt < 0 || tt > 1) seg.push(t <= 0 ? A : B, soma(A, mult(AB, tt)));
    seg.push(...seta(A, sub(A, B), s), ...seta(B, sub(B, A), s));
  }
  return { segmentos: seg, texto: T };
}
