// Varredura (ressalto/corte): perfil levado ao longo de uma trajetória.
// Sem curvas-guia: varredura exata do contorno (OpenCascade MakePipeShell, torção mínima,
// cantos vivos na trajetória). Com curvas-guia: seções do perfil ao longo da trajetória,
// escaladas para tocar as guias, ligadas por loft (como os CADs fazem por dentro).
// Campos e comportamento: docs/funcional/features.md §4.

import {
  assembleWire, drawCircle, genericSweep, loft, makeBezierCurve, makeBSplineApproximation, makeCircle, makeLine,
  makeThreePointArc, type Drawing, type Edge, type Face, type Shape3D, type Wire,
} from "replicad";
import type { FeatureEsboco, FeatureVarredura, Vec3 } from "../model";
import { mapaPontos, polar, splineBeziers, angulosArco } from "../esboco/geometria";
import { cruz, normalizar, paraMundo, type Referencial } from "../esboco/referencial";

// ---------- vetores ----------

const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const vec = (p: { x: number; y: number; z: number }): Vec3 => [p.x, p.y, p.z];

// ---------- trechos de curva (trajetória e guias) ----------

/** Trecho orientado de curva 3D; pode ser invertido antes de virar aresta. */
export type Trecho =
  | { tipo: "linha"; a: Vec3; b: Vec3 }
  | { tipo: "arco"; a: Vec3; m: Vec3; b: Vec3 }
  | { tipo: "circulo"; c: Vec3; r: number; n: Vec3; inicio: Vec3 }
  | { tipo: "bezier"; pts: Vec3[] }
  | { tipo: "pontos"; pts: Vec3[] };

const inicioDe = (t: Trecho): Vec3 =>
  t.tipo === "linha" || t.tipo === "arco" ? t.a : t.tipo === "circulo" ? t.inicio : t.pts[0];
const fimDe = (t: Trecho): Vec3 =>
  t.tipo === "linha" || t.tipo === "arco" ? t.b : t.tipo === "circulo" ? t.inicio : t.pts[t.pts.length - 1];

function inverter(t: Trecho): Trecho {
  if (t.tipo === "linha") return { tipo: "linha", a: t.b, b: t.a };
  if (t.tipo === "arco") return { tipo: "arco", a: t.b, m: t.m, b: t.a };
  if (t.tipo === "circulo") return { ...t, n: mul(t.n, -1) };
  return { ...t, pts: [...t.pts].reverse() };
}

function arestaDe(t: Trecho): Edge {
  switch (t.tipo) {
    case "linha": return makeLine(t.a, t.b);
    case "arco": return makeThreePointArc(t.a, t.m, t.b);
    case "circulo": return makeCircle(t.r, t.c, t.n);
    case "bezier": return makeBezierCurve(t.pts);
    case "pontos": return makeBSplineApproximation(t.pts);
  }
}

/** Trechos da geometria (não de construção) de um esboço, no espaço. */
export function trechosDoEsboco(esb: FeatureEsboco, r: Referencial): Trecho[] {
  const pts = mapaPontos(esb);
  const P = (id: string) => pts.get(id)!;
  const M = (p: { x: number; y: number }) => paraMundo(r, p.x, p.y);
  const out: Trecho[] = [];
  for (const g of esb.geos) {
    if (g.construcao) continue; // construção (inclusive referências do modelo) não é trajetória
    if (g.tipo === "linha") out.push({ tipo: "linha", a: M(P(g.p1)), b: M(P(g.p2)) });
    else if (g.tipo === "arco") {
      const c = P(g.c);
      const [a0, a1] = angulosArco(c, P(g.ini), P(g.fim));
      out.push({ tipo: "arco", a: M(P(g.ini)), m: M(polar(c, g.r, (a0 + a1) / 2)), b: M(P(g.fim)) });
    } else if (g.tipo === "circulo") {
      out.push({ tipo: "circulo", c: M(P(g.c)), r: g.r, n: r.normal, inicio: M(polar(P(g.c), g.r, 0)) });
    } else if (g.tipo === "spline") {
      for (const [a, c1, c2, b] of splineBeziers(g.pontos.map(P))) out.push({ tipo: "bezier", pts: [M(a), M(c1), M(c2), M(b)] });
    }
  }
  return out;
}

/** Trecho a partir de uma aresta do modelo (reta, arco/círculo ou curva amostrada). */
export function trechoDaAresta(e: Edge): Trecho {
  const a = vec(e.startPoint), b = vec(e.endPoint);
  if (e.geomType === "LINE") return { tipo: "linha", a, b };
  if (e.geomType === "CIRCLE" && dist(a, b) > 1e-7) return { tipo: "arco", a, m: vec(e.pointAt(0.5)), b };
  const pts: Vec3[] = [];
  for (let i = 0; i <= 24; i++) pts.push(vec(e.pointAt(i / 24)));
  if (dist(a, b) < 1e-7) pts[pts.length - 1] = pts[0];
  return { tipo: "pontos", pts };
}

/**
 * Encadeia os trechos numa sequência orientada. Começa na ponta livre mais próxima de
 * `perto` (o perfil). Erro se os trechos não formam uma cadeia única sem ramificações.
 */
export function encadear(trechos: Trecho[], perto: Vec3 | null): { trechos: Trecho[]; fechada: boolean } {
  if (!trechos.length) throw new Error("Escolha a trajetória (esboço ou arestas).");
  if (trechos.length === 1 && trechos[0].tipo === "circulo") return { trechos, fechada: true };
  const tol = 1e-4;
  const nos: Vec3[] = [];
  const no = (p: Vec3) => {
    let i = nos.findIndex((q) => dist(q, p) < tol);
    if (i < 0) i = nos.push(p) - 1;
    return i;
  };
  const arestas = trechos.map((t) => ({ t, a: no(inicioDe(t)), b: no(fimDe(t)), usado: false }));
  const grau = nos.map((_, i) => arestas.filter((e) => e.a === i).length + arestas.filter((e) => e.b === i).length);
  if (grau.some((g) => g > 2)) throw new Error("A trajetória ramifica: use uma cadeia única de linhas/arcos.");
  const pontas = grau.flatMap((g, i) => (g === 1 ? [i] : []));
  const fechada = pontas.length === 0;
  const candidatos = fechada ? nos.map((_, i) => i) : pontas;
  let atual = candidatos[0];
  if (perto) for (const i of candidatos) if (dist(nos[i], perto) < dist(nos[atual], perto)) atual = i;
  const out: Trecho[] = [];
  for (;;) {
    const e = arestas.find((x) => !x.usado && (x.a === atual || x.b === atual));
    if (!e) break;
    e.usado = true;
    out.push(e.a === atual ? e.t : inverter(e.t));
    atual = e.a === atual ? e.b : e.a;
  }
  if (arestas.some((e) => !e.usado)) throw new Error("A trajetória tem partes soltas: os trechos devem se ligar pelas pontas.");
  return { trechos: out, fechada };
}

export function fioDe(trechos: Trecho[]): Wire {
  return assembleWire(trechos.map(arestaDe));
}

// ---------- amostragem da trajetória e referenciais ao longo dela ----------

interface Estacao {
  p: Vec3;
  t: Vec3; // tangente
  n: Vec3; // normal do referencial que gira o mínimo
  trecho: number;
}

/** Pontos e tangentes ao longo da trajetória, com referencial que gira o mínimo (dupla reflexão). */
export function estacoes(trechos: Trecho[], porTrecho = 12): Estacao[] {
  const brutas: { p: Vec3; t: Vec3; trecho: number }[] = [];
  trechos.forEach((tr, k) => {
    const e = arestaDe(tr);
    const n = tr.tipo === "linha" ? 1 : porTrecho;
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      const u = i / n;
      brutas.push({ p: vec(e.pointAt(u)), t: normalizar(vec(e.tangentAt(u))), trecho: k });
    }
    // canto vivo: a próxima estação repete o ponto com a tangente do trecho seguinte
    if (k + 1 < trechos.length) {
      const prox = arestaDe(trechos[k + 1]);
      const t2 = normalizar(vec(prox.tangentAt(0)));
      if (esc(t2, brutas[brutas.length - 1].t) < 0.9999) brutas.push({ p: brutas[brutas.length - 1].p, t: t2, trecho: k + 1 });
    }
  });
  // normal inicial: qualquer perpendicular à tangente
  const t0 = brutas[0].t;
  const aux: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let n = normalizar(cruz(cruz(t0, aux), t0));
  const out: Estacao[] = [{ ...brutas[0], n }];
  for (let i = 1; i < brutas.length; i++) {
    const a = brutas[i - 1], b = brutas[i];
    // dupla reflexão (Wang et al.): transporta a normal sem torção
    const v1 = sub(b.p, a.p);
    const c1 = esc(v1, v1);
    let rL = n, tL = a.t;
    if (c1 > 1e-14) {
      rL = sub(n, mul(v1, (2 / c1) * esc(v1, n)));
      tL = sub(a.t, mul(v1, (2 / c1) * esc(v1, a.t)));
    }
    const v2 = sub(b.t, tL);
    const c2 = esc(v2, v2);
    n = c2 > 1e-14 ? sub(rL, mul(v2, (2 / c2) * esc(v2, rL))) : rL;
    n = normalizar(sub(n, mul(b.t, esc(n, b.t))));
    out.push({ ...b, n });
  }
  return out;
}

/** Rotação que leva o referencial (t0, n0) a (t1, n1): eixo e ângulo (graus). */
function rotacaoEntre(t0: Vec3, n0: Vec3, t1: Vec3, n1: Vec3): { eixo: Vec3; graus: number } | null {
  const b0 = cruz(t0, n0), b1 = cruz(t1, n1);
  // R = F1 · F0ᵀ, com F = [t n b] em colunas
  const F0 = [t0, n0, b0], F1 = [t1, n1, b1];
  const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => F1.reduce((s, c, k) => s + c[i] * F0[k][j], 0)));
  const tr = R[0][0] + R[1][1] + R[2][2];
  const cosA = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const ang = Math.acos(cosA);
  if (ang < 1e-9) return null;
  let eixo: Vec3 = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
  if (Math.hypot(...eixo) < 1e-9) {
    // 180°: eixo = coluna dominante de (R + I)
    const M = R.map((l, i) => l.map((v, j) => v + (i === j ? 1 : 0)));
    const k = [0, 1, 2].reduce((m, i) => (M[i][i] > M[m][m] ? i : m), 0);
    eixo = [M[0][k], M[1][k], M[2][k]];
  }
  return { eixo: normalizar(eixo), graus: (ang * 180) / Math.PI };
}

/** Pontos ao longo das curvas-guia (polilinha densa) para achar onde cada seção as cruza. */
export function amostrasDaGuia(trechos: Trecho[]): Vec3[] {
  const out: Vec3[] = [];
  for (const tr of trechos) {
    const e = arestaDe(tr);
    const n = tr.tipo === "linha" ? 1 : 48;
    for (let i = 0; i <= n; i++) out.push(vec(e.pointAt(i / n)));
  }
  return out;
}

/** Onde o plano da seção (ponto p, normal t) corta a guia — o corte mais próximo de p. */
function cortePlano(guia: Vec3[], p: Vec3, t: Vec3): Vec3 | null {
  let melhor: Vec3 | null = null;
  for (let i = 0; i + 1 < guia.length; i++) {
    const da = esc(sub(guia[i], p), t), db = esc(sub(guia[i + 1], p), t);
    if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
    const q = soma(guia[i], mul(sub(guia[i + 1], guia[i]), da / (da - db)));
    if (!melhor || dist(q, p) < dist(melhor, p)) melhor = q;
  }
  return melhor;
}

// ---------- a varredura ----------

export interface EntradaVarredura {
  f: FeatureVarredura;
  /** Perfil de esboço: desenho 2D + plano; perfil circular: calculado aqui. */
  perfil: { D: Drawing; r: Referencial } | null;
  trajetoria: Trecho[];
  guias: Trecho[][];
  /** Recurso fino: transforma o desenho do perfil numa faixa de espessura. */
  afinar: (D: Drawing) => Drawing;
  /** Coloca o desenho 2D no plano (faces). */
  faces: (D: Drawing, r: Referencial) => Face[];
}

export function varrer(ent: EntradaVarredura): Shape3D {
  const { f } = ent;
  // perfil: faces planas (com furos) e um ponto de referência para orientar a trajetória
  let faces: Face[];
  let ancora: Vec3;
  if (f.tipoPerfil === "circular") {
    if (!(f.diametro > 0)) throw new Error("O diâmetro do perfil circular deve ser positivo.");
    const { trechos } = encadear(ent.trajetoria, null);
    const ini = arestaDe(trechos[0]);
    const p0 = vec(ini.startPoint), t0 = normalizar(vec(ini.tangentAt(0)));
    const aux: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const x = normalizar(cruz(aux, t0));
    const r: Referencial = { origem: p0, x, y: cruz(t0, x), normal: t0 };
    let D: Drawing = drawCircle(f.diametro / 2);
    if (f.fino?.ativo) D = ent.afinar(D);
    faces = ent.faces(D, r);
    ancora = p0;
  } else {
    if (!ent.perfil) throw new Error("Escolha o perfil (esboço fechado).");
    let D = ent.perfil.D;
    if (f.fino?.ativo) D = ent.afinar(D);
    faces = ent.faces(D, ent.perfil.r);
    ancora = ent.perfil.r.origem;
    // âncora melhor: o ponto do perfil mais perto da trajetória
    const b = faces[0].boundingBox as unknown as { center: Vec3 };
    if (b?.center?.length === 3) ancora = b.center;
  }
  if (!faces.length) throw new Error("O perfil não tem região fechada (use Recurso fino para perfil aberto).");

  const { trechos } = encadear(ent.trajetoria, ancora);
  const contornos = faces.map((fa) => ({ fora: fa.clone().outerWire(), dentro: fa.clone().innerWires() }));

  const comGuias = ent.guias.length > 0;
  const solidoDo = comGuias ? secoesComGuias(ent, trechos) : (w: Wire) => genericSweep(w, fioDe(trechos), { frenet: false, transitionMode: "right" }) as Shape3D;

  let res: Shape3D | null = null;
  for (const c of contornos) {
    let s = solidoDo(c.fora);
    for (const w of c.dentro) s = s.cut(solidoDo(w));
    res = res ? res.fuse(s) : s;
  }
  if (!res) throw new Error("Não foi possível varrer o perfil.");
  return res;
}

/** Varredura com curvas-guia: seções escaladas ao longo da trajetória, ligadas por loft. */
function secoesComGuias(ent: EntradaVarredura, trechos: Trecho[]) {
  const { f } = ent;
  const est = estacoes(trechos);
  const guias = ent.guias.map((g) => amostrasDaGuia(encadear(g, est[0].p).trechos));
  // escala de cada estação: distância trajetória → guia, relativa à primeira (média das guias)
  const dist0 = guias.map((g) => {
    const q = cortePlano(g, est[0].p, est[0].t);
    if (!q) throw new Error("A curva-guia deve tocar o perfil no início da trajetória.");
    return dist(q, est[0].p);
  });
  if (dist0.some((d) => d < 1e-6)) throw new Error("A curva-guia passa pela trajetória: ela deve tocar o contorno do perfil.");
  let ultima = 1;
  const escalas = est.map((e) => {
    const r = guias.map((g, k) => {
      const q = cortePlano(g, e.p, e.t);
      return q ? dist(q, e.p) / dist0[k] : null;
    }).filter((x): x is number => x !== null);
    if (r.length) ultima = r.reduce((a, b) => a + b, 0) / r.length;
    return ultima;
  });
  // tangência com a trajetória no início/fim: a seção vizinha repete a escala da ponta
  if (f.tangenciaInicio === "trajetoria" && escalas.length > 2) escalas[1] = escalas[0];
  if (f.tangenciaFim === "trajetoria" && escalas.length > 2) escalas[escalas.length - 2] = escalas[escalas.length - 1];

  return (w: Wire): Shape3D => {
    const secao = (i: number): Wire => {
      const e = est[i];
      let s = w.clone().translate(mul(est[0].p, -1));
      const rot = rotacaoEntre(est[0].t, est[0].n, e.t, e.n);
      if (rot) s = s.rotate(rot.graus, [0, 0, 0], rot.eixo);
      if (Math.abs(escalas[i] - 1) > 1e-9) s = s.scale(escalas[i], [0, 0, 0]);
      return s.translate(e.p);
    };
    // estações repetidas (canto vivo) viram uma seção só
    const idx = est.map((_, i) => i).filter((i) => i === 0 || dist(est[i].p, est[i - 1].p) > 1e-9);
    if (f.mesclarFacesSuaves || trechos.length === 1) return loft(idx.map(secao), { ruled: false });
    // faces separadas: um loft por trecho da trajetória, unidos
    let res: Shape3D | null = null;
    for (let k = 0; k < trechos.length; k++) {
      const ids = est.map((_, i) => i).filter((i) => est[i].trecho === k || (est[i + 1]?.trecho === k && est[i].trecho === k - 1));
      const unicos = ids.filter((i, j) => j === 0 || dist(est[i].p, est[ids[j - 1]].p) > 1e-9);
      if (unicos.length < 2) continue;
      const parte = loft(unicos.map(secao), { ruled: false });
      res = res ? res.fuse(parte) : parte;
    }
    if (!res) throw new Error("Trajetória curta demais para a varredura.");
    return res;
  };
}
