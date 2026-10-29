// Anotações do desenho: cotas (linear, alinhada, horizontal, vertical, diâmetro, ângulo) presas à
// geometria das vistas, balões com o nº do item, tabela de lista de materiais e DXF da folha.
// Puro: testado em scripts/teste-desenho.ts. Comportamento: docs/funcional/desenho.md §3 e §5.
//
// As entidades das cotas ficam no plano da vista em mm do modelo (o mesmo sistema da projeção):
// o valor é real (não depende da escala) e, ao recalcular a vista, cada ponto é reencontrado na
// geometria nova (associatividade); o que não for reencontrado fica "pendente".

type P = [number, number];

/** Entidade tocada numa vista. */
export type EntCota =
  | { tipo: "ponto"; p: P }
  | { tipo: "linha"; a: P; b: P }
  | { tipo: "circulo"; c: P; r: number };

export type ModoCota = "auto" | "h" | "v" | "alinhada";

export interface Cota {
  id: string;
  vista: string;
  e1: EntCota;
  e2?: EntCota;
  /** onde o texto ficou (plano da vista, mm do modelo) */
  pos: P;
  modo: ModoCota;
  /** texto antes/depois do valor (ex.: "4×") */
  prefixo?: string;
  sufixo?: string;
  casas?: number;
  /** tolerância simétrica ± (mm) */
  tol?: number;
}

export interface Balao {
  id: string;
  vista: string;
  /** componente (id na montagem) ou "peca" */
  comp: string;
  /** ponto de ancoragem (plano da vista, mm do modelo) e posição do círculo (folha, relativa à vista) */
  ancora: P;
  pos: P;
}

export interface TabelaLista {
  id: string;
  modelo: string;
}

// ---------- vetores ----------
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const soma = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const esc = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
const norma = (a: P) => Math.hypot(a[0], a[1]);
const unit = (a: P): P => mul(a, 1 / (norma(a) || 1));
const perp = (a: P): P => [-a[1], a[0]];

/** Medida da cota e o tipo de desenho que ela pede. */
export function medida(c: Cota): { tipo: "linear" | "diametro" | "angulo"; valor: number; a?: P; b?: P; dir?: P; centro?: P; r?: number; l1?: [P, P]; l2?: [P, P] } | null {
  const { e1, e2 } = c;
  if (e1.tipo === "circulo" && !e2) return { tipo: "diametro", valor: 2 * e1.r, centro: e1.c, r: e1.r };
  // duas linhas não paralelas: ângulo
  if (e1.tipo === "linha" && e2?.tipo === "linha") {
    const d1 = unit(sub(e1.b, e1.a)), d2 = unit(sub(e2.b, e2.a));
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cr) > 1e-6) {
      // interseção das retas
      const t = ((e2.a[0] - e1.a[0]) * d2[1] - (e2.a[1] - e1.a[1]) * d2[0]) / cr;
      const o = soma(e1.a, mul(d1, t));
      // cada reta no sentido do lado onde está o texto (o ângulo medido é o do quadrante tocado)
      const lado = (d: P): P => mul(d, esc(sub(c.pos, o), d) >= 0 ? 1 : -1);
      const u1 = lado(d1), u2 = lado(d2);
      const ang = (Math.acos(Math.max(-1, Math.min(1, esc(u1, u2)))) * 180) / Math.PI;
      return { tipo: "angulo", valor: ang, centro: o, l1: [o, soma(o, u1)], l2: [o, soma(o, u2)], r: norma(sub(c.pos, o)) };
    }
    // paralelas: distância entre elas
    const n = perp(d1);
    const a = e1.a, b = soma(e2.a, mul(d1, esc(sub(e1.a, e2.a), d1)));
    return { tipo: "linear", valor: Math.abs(esc(sub(e2.a, e1.a), n)), a, b, dir: unit(sub(b, a)) };
  }
  // pontos: linha isolada (pontas), ponto-ponto, ponto-linha (perpendicular), centro de círculo
  const pontoDe = (e: EntCota): P => (e.tipo === "ponto" ? e.p : e.tipo === "circulo" ? e.c : e.a);
  let a: P, b: P;
  if (e1.tipo === "linha" && !e2) {
    a = e1.a;
    b = e1.b;
  } else if (e2 && (e1.tipo === "linha" || e2.tipo === "linha")) {
    const l = (e1.tipo === "linha" ? e1 : e2) as Extract<EntCota, { tipo: "linha" }>;
    const p = pontoDe(e1.tipo === "linha" ? e2 : e1);
    const d = unit(sub(l.b, l.a));
    a = p;
    b = soma(l.a, mul(d, esc(sub(p, l.a), d)));
    return { tipo: "linear", valor: norma(sub(b, a)), a, b, dir: unit(sub(b, a)) };
  } else if (e2) {
    a = pontoDe(e1);
    b = pontoDe(e2);
  } else return null;
  // direção: horizontal, vertical ou alinhada (auto: pela posição do texto, como no esboço)
  const d = sub(b, a);
  let modo = c.modo;
  if (modo === "auto") {
    const m = mul(soma(a, b), 0.5);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    if (Math.abs(d[1]) < 1e-9) modo = "h";
    else if (Math.abs(d[0]) < 1e-9) modo = "v";
    else if (c.pos[0] > x0 && c.pos[0] < x1 && (c.pos[1] > y1 || c.pos[1] < y0)) modo = "h";
    else if (c.pos[1] > y0 && c.pos[1] < y1 && (c.pos[0] > x1 || c.pos[0] < x0)) modo = "v";
    else modo = Math.abs(esc(sub(c.pos, m), perp(unit(d)))) > 1e-9 ? "alinhada" : "h";
  }
  const dir: P = modo === "h" ? [1, 0] : modo === "v" ? [0, 1] : unit(d);
  return { tipo: "linear", valor: Math.abs(esc(d, dir)), a, b, dir };
}

/** Texto da cota (pt-BR): "25", "Ø14", "30°", com prefixo/sufixo e ±tolerância. */
export function textoCota(c: Cota, valor: number, tipo: "linear" | "diametro" | "angulo"): string {
  const casas = c.casas ?? 2;
  const v = Number(valor.toFixed(casas)).toLocaleString("pt-BR", { maximumFractionDigits: casas });
  const base = tipo === "diametro" ? `Ø${v}` : tipo === "angulo" ? `${v}°` : v;
  const tol = c.tol ? ` ±${Number(c.tol.toFixed(casas)).toLocaleString("pt-BR", { maximumFractionDigits: casas })}` : "";
  return `${c.prefixo ?? ""}${base}${tol}${c.sufixo ?? ""}`;
}

/** Geometria da cota na folha, relativa à origem da vista (mm, y para cima): linhas, setas, texto. */
export interface DesenhoCota {
  linhas: [P, P][];
  /** ponta da seta e direção para onde ela aponta */
  setas: { p: P; d: P }[];
  arcos: { c: P; r: number; a0: number; a1: number }[];
  texto: { p: P; ang: number; s: string };
}

export function desenhoCota(c: Cota, escala: number): DesenhoCota | null {
  const m = medida(c);
  if (!m) return null;
  const S = (p: P): P => mul(p, escala);
  const pos = S(c.pos);
  const s = textoCota(c, m.valor, m.tipo);
  const gap = 1, alem = 2; // folga da linha de chamada e quanto passa da linha de cota (mm)
  if (m.tipo === "diametro") {
    // linha de chamada pelo centro, do lado oposto até o texto
    const C = S(m.centro!), R = m.r! * escala;
    const u = unit(sub(pos, C));
    const p1 = soma(C, mul(u, R)), p0 = soma(C, mul(u, -R));
    const fora = norma(sub(pos, C)) > R;
    return { linhas: [[p0, fora ? pos : p1], ...(fora ? [] as [P, P][] : [[p1, pos] as [P, P]])], setas: [{ p: p1, d: u }, { p: p0, d: mul(u, -1) }], arcos: [], texto: { p: soma(pos, [0, 1]), ang: 0, s } };
  }
  if (m.tipo === "angulo") {
    const O = S(m.centro!), r = norma(sub(pos, O));
    const u1 = unit(sub(m.l1![1], m.l1![0])), u2 = unit(sub(m.l2![1], m.l2![0]));
    const a0 = Math.atan2(u1[1], u1[0]), a1 = Math.atan2(u2[1], u2[0]);
    let ini = a0, fim = a1;
    let varr = fim - ini;
    while (varr <= -Math.PI) varr += 2 * Math.PI;
    while (varr > Math.PI) varr -= 2 * Math.PI;
    if (varr < 0) [ini, fim] = [a1, a0];
    const q1 = soma(O, mul([Math.cos(ini), Math.sin(ini)], r)), q2 = soma(O, mul([Math.cos(fim), Math.sin(fim)], r));
    const t1: P = [-Math.sin(ini), Math.cos(ini)], t2: P = [Math.sin(fim), -Math.cos(fim)];
    return {
      linhas: [[soma(O, mul([Math.cos(ini), Math.sin(ini)], gap)), soma(q1, mul([Math.cos(ini), Math.sin(ini)], alem))], [soma(O, mul([Math.cos(fim), Math.sin(fim)], gap)), soma(q2, mul([Math.cos(fim), Math.sin(fim)], alem))]],
      setas: [{ p: q1, d: mul(t1, -1) }, { p: q2, d: mul(t2, -1) }],
      arcos: [{ c: O, r, a0: Math.min(ini, fim < ini ? fim + 2 * Math.PI : fim), a1: Math.max(ini, fim < ini ? fim + 2 * Math.PI : fim) }],
      texto: { p: soma(O, mul(unit(sub(pos, O)), r + 2)), ang: 0, s },
    };
  }
  // linear: linha de cota paralela a `dir`, passando pelo texto
  const A = S(m.a!), B = S(m.b!), dir = m.dir!;
  const n = perp(dir);
  const off = (p: P) => esc(sub(pos, p), n);
  const pa = soma(A, mul(n, off(A))), pb = soma(B, mul(n, off(B)));
  const ext = (p: P, q: P): [P, P] => {
    const v = sub(q, p), L = norma(v);
    if (L < 1e-9) return [p, q];
    const u = mul(v, 1 / L);
    return [soma(p, mul(u, Math.min(gap, L))), soma(q, mul(u, alem))];
  };
  const dAB = unit(sub(pb, pa));
  const L = norma(sub(pb, pa));
  // seta para dentro (cabe) ou para fora (cota pequena)
  const dentro = L > 8;
  let ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  // texto legível de baixo ou da direita (NBR 10126)
  if (ang > 90.001) ang -= 180;
  if (ang <= -90) ang += 180;
  const linhas: [P, P][] = [ext(A, pa), ext(B, pb), [pa, pb]];
  if (!dentro) linhas.push([pb, soma(pb, mul(dAB, 6))], [pa, soma(pa, mul(dAB, -6))]);
  const tp = esc(sub(pos, pa), dAB);
  const textoP = soma(soma(pa, mul(dAB, Math.min(Math.max(tp, -20), L + 20))), mul(perp([Math.cos((ang * Math.PI) / 180), Math.sin((ang * Math.PI) / 180)]), 1));
  return {
    linhas,
    setas: dentro ? [{ p: pa, d: mul(dAB, -1) }, { p: pb, d: dAB }] : [{ p: pa, d: dAB }, { p: pb, d: mul(dAB, -1) }],
    arcos: [],
    texto: { p: textoP, ang, s },
  };
}

// ---------- associatividade: reencontrar a geometria na vista recalculada ----------

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Pontos notáveis da vista: pontas das polilinhas (vértices) e centros de círculos. */
export function pontosDaVista(vis: P[][], circulos: { cx: number; cy: number; r: number }[]): P[] {
  const out: P[] = [];
  // pontas de polilinhas abertas (a emenda de um círculo/elipse fechado não é vértice)
  for (const l of vis) if (dist(l[0], l[l.length - 1]) > 1e-6) out.push(l[0], l[l.length - 1]);
  for (const c of circulos) out.push([c.cx, c.cy]);
  return out;
}

/** Reencontra a entidade na geometria atual (tolerância em mm do modelo); null = pendente. */
export function reencontrar(e: EntCota, vis: P[][], circulos: { cx: number; cy: number; r: number }[], tol: number): EntCota | null {
  if (e.tipo === "circulo") {
    let melhor: { cx: number; cy: number; r: number } | null = null, dm = Infinity;
    for (const c of circulos) {
      const d = dist([c.cx, c.cy], e.c) + Math.abs(c.r - e.r);
      if (d < dm) { dm = d; melhor = c; }
    }
    return melhor && dm <= tol ? { tipo: "circulo", c: [melhor.cx, melhor.cy], r: melhor.r } : null;
  }
  const pts = pontosDaVista(vis, circulos);
  const perto = (p: P) => {
    let m: P | null = null, dm = Infinity;
    for (const q of pts) {
      const d = dist(p, q);
      if (d < dm) { dm = d; m = q; }
    }
    return m && dm <= tol ? m : null;
  };
  if (e.tipo === "ponto") {
    const p = perto(e.p);
    return p ? { tipo: "ponto", p } : null;
  }
  const a = perto(e.a), b = perto(e.b);
  return a && b && dist(a, b) > 1e-9 ? { tipo: "linha", a, b } : null;
}

/**
 * Entidade sob o toque (plano da vista, mm do modelo): vértice perto (tolV), senão círculo pela
 * borda, senão segmento reto da polilinha mais perto (tolL).
 */
export function entidadeSob(p: P, vis: P[][], circulos: { cx: number; cy: number; r: number }[], tolV: number, tolL: number): EntCota | null {
  let melhorP: P | null = null, dp = Infinity;
  for (const q of pontosDaVista(vis, circulos)) {
    const d = dist(p, q);
    if (d < dp) { dp = d; melhorP = q; }
  }
  if (melhorP && dp <= tolV) return { tipo: "ponto", p: melhorP };
  let melhorC: { cx: number; cy: number; r: number } | null = null, dc = Infinity;
  for (const c of circulos) {
    const d = Math.abs(dist(p, [c.cx, c.cy]) - c.r);
    if (d < dc) { dc = d; melhorC = c; }
  }
  if (melhorC && dc <= tolL) return { tipo: "circulo", c: [melhorC.cx, melhorC.cy], r: melhorC.r };
  let melhorL: [P, P] | null = null, dl = Infinity;
  for (const l of vis) {
    // só polilinhas retas (2 pontos ou todos colineares)
    const a = l[0], b = l[l.length - 1];
    if (dist(a, b) < 1e-9) continue;
    const u = unit(sub(b, a));
    if (l.some((q) => Math.abs(esc(sub(q, a), perp(u))) > 1e-6)) continue;
    const t = Math.max(0, Math.min(dist(a, b), esc(sub(p, a), u)));
    const d = dist(p, soma(a, mul(u, t)));
    if (d < dl) { dl = d; melhorL = [a, b]; }
  }
  return melhorL && dl <= tolL ? { tipo: "linha", a: melhorL[0], b: melhorL[1] } : null;
}

// ---------- balões ----------

/** Posição dos balões em volta da caixa da vista (folha, relativa à vista): raio a partir do centro. */
export function posicionarBaloes(ancoras: P[], caixa: { x0: number; y0: number; x1: number; y1: number }, folga = 12): P[] {
  const c: P = [(caixa.x0 + caixa.x1) / 2, (caixa.y0 + caixa.y1) / 2];
  const hx = (caixa.x1 - caixa.x0) / 2 + folga, hy = (caixa.y1 - caixa.y0) / 2 + folga;
  // na borda da caixa aumentada, na direção do centro da vista para a peça
  const naBorda = (ang: number): P => {
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const t = Math.min(Math.abs(ux) > 1e-9 ? hx / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? hy / Math.abs(uy) : Infinity);
    return [c[0] + ux * t, c[1] + uy * t];
  };
  const usados: P[] = [];
  return ancoras.map((a) => {
    let ang = Math.atan2(a[1] - c[1], a[0] - c[0]);
    if (!Number.isFinite(ang) || (Math.abs(a[0] - c[0]) < 1e-9 && Math.abs(a[1] - c[1]) < 1e-9)) ang = Math.PI / 4;
    let p = naBorda(ang);
    // afasta de balões já colocados (diâmetro ~10 mm)
    for (let k = 0; k < 36 && usados.some((q) => dist(q, p) < 11); k++) {
      ang += 0.15;
      p = naBorda(ang);
    }
    usados.push(p);
    return p;
  });
}

// ---------- DXF da folha (R12, mm) ----------

export type EntDxf =
  | { tipo: "linha"; camada: string; a: P; b: P }
  | { tipo: "circulo"; camada: string; c: P; r: number }
  | { tipo: "arco"; camada: string; c: P; r: number; a0: number; a1: number }
  | { tipo: "texto"; camada: string; p: P; h: number; s: string; ang?: number };

const n6 = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6)));

/** Gera o DXF R12 com as camadas (cor por camada) e as entidades. */
export function gerarDxf(ents: EntDxf[], camadas: Record<string, number>): string {
  const L: (string | number)[] = [];
  const g = (c: number, v: string | number) => L.push(c, v);
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$INSUNITS"); g(70, 4); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES"); g(0, "TABLE"); g(2, "LAYER"); g(70, Object.keys(camadas).length);
  for (const [nome, cor] of Object.entries(camadas)) {
    g(0, "LAYER"); g(2, nome); g(70, 0); g(62, cor); g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  for (const e of ents) {
    if (e.tipo === "linha") {
      g(0, "LINE"); g(8, e.camada); g(10, n6(e.a[0])); g(20, n6(e.a[1])); g(30, 0); g(11, n6(e.b[0])); g(21, n6(e.b[1])); g(31, 0);
    } else if (e.tipo === "circulo") {
      g(0, "CIRCLE"); g(8, e.camada); g(10, n6(e.c[0])); g(20, n6(e.c[1])); g(30, 0); g(40, n6(e.r));
    } else if (e.tipo === "arco") {
      g(0, "ARC"); g(8, e.camada); g(10, n6(e.c[0])); g(20, n6(e.c[1])); g(30, 0); g(40, n6(e.r)); g(50, n6((e.a0 * 180) / Math.PI)); g(51, n6((e.a1 * 180) / Math.PI));
    } else {
      // DXF R12 em ASCII: acentos e Ø pela página de código; o texto vai como está (UTF-8 nos leitores atuais)
      g(0, "TEXT"); g(8, e.camada); g(10, n6(e.p[0])); g(20, n6(e.p[1])); g(30, 0); g(40, n6(e.h)); g(1, e.s.replace(/\n/g, " ")); if (e.ang) g(50, n6(e.ang));
    }
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return L.join("\n") + "\n";
}

/** Polilinha → segmentos de linha DXF. */
export const segmentos = (l: P[], camada: string): EntDxf[] => l.slice(1).map((b, i) => ({ tipo: "linha" as const, camada, a: l[i], b }));
