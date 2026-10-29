// Solver dos posicionamentos da montagem (mates): cada componente flutuante tem 6 graus de
// liberdade (3 translações + 3 rotações em torno do centro dele); cada posicionamento gera
// resíduos geométricos (planos, eixos, linhas, pontos em coordenadas da montagem). Mínimos
// quadrados (Levenberg–Marquardt, jacobiano numérico) a partir da posição atual: o que já está
// certo não se mexe. Também diz os graus de liberdade que sobram e os posicionamentos em conflito.
// Puro: testado em scripts/teste-montagem.ts. Comportamento: docs/funcional/montagem.md §2.2 e §4.

import type { Referencia, Vec3 } from "../model";
import { aplicarDirecao, aplicarPonto, girar, multQuat, normalizarQuat, type DocumentoMontagem, type Posicionamento, type RefMontagem, type TipoPosicionamento, type Transformacao } from "./modelo";

// ---------- vetores ----------
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (norma(a) || 1));

// ---------- primitivas geométricas ----------

/** Geometria de uma entidade para os posicionamentos (coordenadas da montagem). */
export type Primitiva =
  /** face plana / plano: ponto e normal (para fora) */
  | { tipo: "plano"; p: Vec3; n: Vec3 }
  /** face cilíndrica/cônica, aresta circular, eixo: ponto do eixo, direção e raio (0 = eixo) */
  | { tipo: "eixo"; p: Vec3; d: Vec3; r: number; centro?: Vec3 }
  /** aresta reta */
  | { tipo: "linha"; p: Vec3; d: Vec3 }
  /** vértice, origem, centro de esfera (com raio) */
  | { tipo: "ponto"; p: Vec3; r?: number };

const IDT: Transformacao = { pos: [0, 0, 0], rot: [0, 0, 0, 1] };
const PLANOS: Record<string, { n: Vec3 }> = { XY: { n: [0, 0, 1] }, XZ: { n: [0, 1, 0] }, YZ: { n: [1, 0, 0] } };
const EIXOS: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** Primitiva da referência no sistema da peça (antes da transformação do componente). */
export function primitivaLocal(r: Referencia): Primitiva | null {
  if (r.tipo === "face") {
    const a = r.ass;
    if (a.geom === "plano" && a.normal) return { tipo: "plano", p: a.centro, n: unit(a.normal) };
    if ((a.geom === "cilindro" || a.geom === "cone") && a.eixo && a.pontoEixo) return { tipo: "eixo", p: a.pontoEixo, d: unit(a.eixo), r: a.raio ?? 0, centro: a.centro };
    if (a.geom === "esfera") return { tipo: "ponto", p: a.centro, r: Math.sqrt(a.area / (4 * Math.PI)) };
    return null;
  }
  if (r.tipo === "aresta") {
    const a = r.ass;
    if (a.geom === "linha") return { tipo: "linha", p: a.a, d: unit(sub(a.b, a.a)) };
    if (a.geom === "circulo" && a.centro && a.eixo) return { tipo: "eixo", p: a.centro, d: unit(a.eixo), r: a.raio ?? 0, centro: a.centro };
    return null;
  }
  if (r.tipo === "vertice") return { tipo: "ponto", p: r.p };
  if (r.tipo === "plano" && PLANOS[r.id]) return { tipo: "plano", p: [0, 0, 0], n: PLANOS[r.id].n };
  if (r.tipo === "eixo" && EIXOS[r.id]) return { tipo: "eixo", p: [0, 0, 0], d: EIXOS[r.id], r: 0 };
  if (r.tipo === "plano" && r.id === "origem") return { tipo: "ponto", p: [0, 0, 0] };
  return null;
}

export function transformar(pr: Primitiva, t: Transformacao): Primitiva {
  switch (pr.tipo) {
    case "plano": return { tipo: "plano", p: aplicarPonto(t, pr.p), n: aplicarDirecao(t, pr.n) };
    case "eixo": return { tipo: "eixo", p: aplicarPonto(t, pr.p), d: aplicarDirecao(t, pr.d), r: pr.r, ...(pr.centro ? { centro: aplicarPonto(t, pr.centro) } : {}) };
    case "linha": return { tipo: "linha", p: aplicarPonto(t, pr.p), d: aplicarDirecao(t, pr.d) };
    case "ponto": return { tipo: "ponto", p: aplicarPonto(t, pr.p), ...(pr.r !== undefined ? { r: pr.r } : {}) };
  }
}

/** Direção principal da primitiva (normal ou eixo) — para alinhamento e ângulo. */
const direcao = (p: Primitiva): Vec3 | null => (p.tipo === "plano" ? p.n : p.tipo === "eixo" || p.tipo === "linha" ? p.d : null);

/** Tipos de posicionamento que fazem sentido entre as duas entidades (barra rápida, sugestão). */
export function tiposPossiveis(a: Primitiva, b: Primitiva): TipoPosicionamento[] {
  const t = new Set([a.tipo, b.tipo]);
  const par = (x: Primitiva["tipo"], y: Primitiva["tipo"]) => t.has(x) && t.has(y) && (x !== y || (a.tipo === x && b.tipo === y));
  const out: TipoPosicionamento[] = [];
  if (par("plano", "plano")) out.push("coincidente", "paralelo", "perpendicular", "distancia", "angulo");
  if (par("eixo", "eixo")) out.push("concentrico", "paralelo", "perpendicular", "distancia", "angulo", "tangente");
  if (par("linha", "linha")) out.push("coincidente", "paralelo", "perpendicular", "distancia", "angulo");
  if (par("plano", "eixo")) out.push("tangente", "paralelo", "perpendicular", "distancia", "coincidente");
  if (par("plano", "linha")) out.push("coincidente", "paralelo", "perpendicular", "distancia");
  if (par("plano", "ponto")) out.push("coincidente", "distancia", ...(a.tipo === "ponto" && a.r || b.tipo === "ponto" && b.r ? (["tangente"] as const) : []));
  if (par("eixo", "linha")) out.push("coincidente", "paralelo", "perpendicular");
  if (par("eixo", "ponto") || par("linha", "ponto")) out.push("coincidente", "distancia");
  if (par("ponto", "ponto")) out.push("coincidente", "distancia");
  out.push("travar");
  return [...new Set(out)];
}

/** Tipo mais provável (o primeiro da lista, como a sugestão automática dos CADs). */
export const tipoSugerido = (a: Primitiva, b: Primitiva): TipoPosicionamento => tiposPossiveis(a, b)[0];

/** Sinal do alinhamento: +1 alinhado, −1 antialinhado; "auto" escolhe o mais próximo da posição atual. */
export function sinalAlinhamento(m: Posicionamento, a: Primitiva, b: Primitiva): number {
  if (m.alinhamento === "alinhado") return 1;
  if (m.alinhamento === "antialinhado") return -1;
  const da = direcao(a), db = direcao(b);
  return da && db && esc(da, db) < 0 ? -1 : 1;
}

/** Ponto e direção para tratar a primitiva como "reta" (eixo ou linha). */
const comoReta = (p: Primitiva) => (p.tipo === "eixo" || p.tipo === "linha" ? { p: p.p, d: p.d } : null);

/**
 * Resíduos do posicionamento (zero = satisfeito) ou mensagem se o par não serve. Erros de direção
 * (normais e eixos) são multiplicados por `L` (tamanho típico, mm): um desvio de ângulo pesa como
 * o deslocamento que ele causa na peça — senão o solver inclinaria a peça em vez de movê-la.
 */
export function residuos(m: Posicionamento, A: Primitiva, B: Primitiva, travar?: { a: Transformacao; b: Transformacao; rel: Transformacao }, L = 100): number[] | string {
  let a = A, b = B;
  // ordem canônica para os pares mistos (plano primeiro, depois eixo, linha, ponto)
  const ordem = { plano: 0, eixo: 1, linha: 2, ponto: 3 };
  if (ordem[a.tipo] > ordem[b.tipo]) [a, b] = [b, a];
  const s = sinalAlinhamento(m, a, b);
  const v = (m.valor ?? 0) * (m.inverter ? -1 : 1);
  const paralelos = (da: Vec3, db: Vec3) => mul(m.alinhamento === "auto" ? cruz(da, db) : sub(da, mul(db, s)), L);
  const cruzL = (x: Vec3, y: Vec3) => mul(cruz(x, y), L);
  const naoServe = `${NOME_TIPO[m.tipo]} não serve para ${NOME_PRIM[A.tipo]} com ${NOME_PRIM[B.tipo]}.`;
  switch (m.tipo) {
    case "coincidente":
      if (a.tipo === "plano" && b.tipo === "plano") return [...paralelos(a.n, b.n), esc(sub(b.p, a.p), a.n)];
      if (a.tipo === "plano" && (b.tipo === "linha" || b.tipo === "eixo")) return [esc(b.d, a.n) * L, esc(sub(b.p, a.p), a.n)];
      if (a.tipo === "plano" && b.tipo === "ponto") return [esc(sub(b.p, a.p), a.n)];
      if (comoReta(a) && comoReta(b)) {
        const ra = comoReta(a)!, rb = comoReta(b)!;
        return [...cruzL(ra.d, rb.d), ...cruz(sub(rb.p, ra.p), ra.d)];
      }
      if (comoReta(a) && b.tipo === "ponto") return cruz(sub(b.p, a.p), comoReta(a)!.d);
      if (a.tipo === "ponto" && b.tipo === "ponto") return sub(b.p, a.p);
      return naoServe;
    case "paralelo": {
      const da = direcao(a), db = direcao(b);
      if (!da || !db) return naoServe;
      // plano com reta: a reta fica perpendicular à normal
      if (a.tipo === "plano" && b.tipo !== "plano") return [esc(a.n, db) * L];
      return paralelos(da, db);
    }
    case "perpendicular": {
      const da = direcao(a), db = direcao(b);
      if (!da || !db) return naoServe;
      if (a.tipo === "plano" && b.tipo !== "plano") return cruzL(a.n, db);
      return [esc(da, db) * L];
    }
    case "concentrico": {
      const ra = comoReta(a), rb = comoReta(b);
      if (!ra || !rb) return naoServe;
      return [...cruzL(ra.d, rb.d), ...cruz(sub(rb.p, ra.p), ra.d)];
    }
    case "distancia":
      if (a.tipo === "plano" && b.tipo === "plano") return [...paralelos(a.n, b.n), esc(sub(b.p, a.p), a.n) - v];
      if (a.tipo === "plano" && b.tipo === "ponto") return [esc(sub(b.p, a.p), a.n) - v];
      if (a.tipo === "plano" && (b.tipo === "linha" || b.tipo === "eixo")) return [esc(b.d, a.n) * L, esc(sub(b.p, a.p), a.n) - v];
      if (comoReta(a) && comoReta(b)) {
        const ra = comoReta(a)!, rb = comoReta(b)!;
        return [...cruzL(ra.d, rb.d), norma(cruz(sub(rb.p, ra.p), ra.d)) - Math.abs(v)];
      }
      if (comoReta(a) && b.tipo === "ponto") return [norma(cruz(sub(b.p, a.p), comoReta(a)!.d)) - Math.abs(v)];
      if (a.tipo === "ponto" && b.tipo === "ponto") return [norma(sub(b.p, a.p)) - Math.abs(v)];
      return naoServe;
    case "angulo": {
      const da = direcao(a), db = direcao(b);
      if (!da || !db) return naoServe;
      const ang = ((m.valor ?? 0) * Math.PI) / 180;
      return [(esc(da, db) - s * Math.cos(ang)) * L];
    }
    case "tangente":
      if (a.tipo === "plano" && b.tipo === "eixo") return [esc(b.d, a.n) * L, Math.abs(esc(sub(b.p, a.p), a.n)) - b.r];
      if (a.tipo === "plano" && b.tipo === "ponto" && b.r) return [Math.abs(esc(sub(b.p, a.p), a.n)) - b.r];
      if (a.tipo === "eixo" && b.tipo === "eixo") return [...cruzL(a.d, b.d), norma(cruz(sub(b.p, a.p), a.d)) - (a.r + b.r)];
      return naoServe;
    case "travar": {
      if (!travar) return naoServe;
      // posição relativa de b em relação a a fica igual à gravada ao criar
      const atual = compRel(travar.a, travar.b);
      const dp = sub(atual.pos, travar.rel.pos);
      const q = multQuat(atual.rot, [-travar.rel.rot[0], -travar.rel.rot[1], -travar.rel.rot[2], travar.rel.rot[3]]);
      const sq = q[3] < 0 ? -1 : 1;
      return [...dp, q[0] * sq * L, q[1] * sq * L, q[2] * sq * L];
    }
  }
}

/** Transformação de b vista de a (a⁻¹ ∘ b). */
export function compRel(a: Transformacao, b: Transformacao): Transformacao {
  const ri: [number, number, number, number] = [-a.rot[0], -a.rot[1], -a.rot[2], a.rot[3]];
  return { pos: girar(ri, sub(b.pos, a.pos)), rot: normalizarQuat(multQuat(ri, b.rot)) };
}

export const NOME_TIPO: Record<TipoPosicionamento, string> = {
  coincidente: "Coincidente", paralelo: "Paralelo", perpendicular: "Perpendicular", tangente: "Tangente",
  concentrico: "Concêntrico", travar: "Travar", distancia: "Distância", angulo: "Ângulo",
};
const NOME_PRIM: Record<Primitiva["tipo"], string> = { plano: "face plana/plano", eixo: "face cilíndrica/eixo", linha: "aresta reta", ponto: "vértice/ponto" };

// ---------- sistema ----------

export interface ResultadoSolver {
  /** novas transformações dos componentes que se moveram */
  poses: Map<string, Transformacao>;
  /** posicionamentos não satisfeitos (id → motivo) */
  erros: Map<string, string>;
  /** graus de liberdade que sobram em cada componente flutuante */
  graus: Map<string, number>;
  /** resíduo final (mm) */
  residuo: number;
}

export interface OpcoesSolver {
  /** componente sendo arrastado e para onde (segue o mouse/caneta nos graus livres) */
  arrastado?: { comp: string; alvo: Transformacao };
  /** componente que deve se mover de preferência (o primeiro tocado ao posicionar) */
  preferido?: string;
  /** centro de cada componente (pivô das rotações; melhora a convergência) */
  centros?: Map<string, Vec3>;
  /** tamanho típico da montagem (mm): escala das rotações no jacobiano */
  escala?: number;
  maxIter?: number;
  /** calcular os graus de liberdade que sobram (desligado durante o arraste: mais rápido) */
  semGraus?: boolean;
}

/** Aplica um passo (translação + rotação em vetor de rotação × 1/escala) em torno do centro. */
function passo(t: Transformacao, x: number[], i: number, c: Vec3, L: number): Transformacao {
  const rv: Vec3 = [x[i + 3] / L, x[i + 4] / L, x[i + 5] / L];
  const ang = norma(rv);
  const q: [number, number, number, number] = ang < 1e-12 ? [0, 0, 0, 1] : [...mul(rv, Math.sin(ang / 2) / ang), Math.cos(ang / 2)] as [number, number, number, number];
  const rel = sub(t.pos, c);
  return { pos: soma(soma(c, girar(q, rel)), [x[i], x[i + 1], x[i + 2]]), rot: normalizarQuat(multQuat(q, t.rot)) };
}

/** Resolve (n×n) por eliminação de Gauss com pivotamento; null se singular. */
function resolverLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((l, i) => [...l, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-14) return null;
    [M[k], M[p]] = [M[p], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      if (!f) continue;
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Posto de uma matriz (eliminação com tolerância) e as colunas livres (base do espaço nulo). */
function colunasLivres(J: number[][], ncol: number, tol = 1e-7): { posto: number; nulos: number[][] } {
  const M = J.map((l) => [...l]);
  const pivos: number[] = [];
  let lin = 0;
  for (let c = 0; c < ncol && lin < M.length; c++) {
    let p = lin;
    for (let i = lin + 1; i < M.length; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < tol) continue;
    [M[lin], M[p]] = [M[p], M[lin]];
    const piv = M[lin][c];
    for (let j = 0; j < ncol; j++) M[lin][j] /= piv;
    for (let i = 0; i < M.length; i++) {
      if (i === lin || !M[i][c]) continue;
      const f = M[i][c];
      for (let j = 0; j < ncol; j++) M[i][j] -= f * M[lin][j];
    }
    pivos.push(c);
    lin++;
  }
  // um vetor do espaço nulo por coluna livre
  const nulos: number[][] = [];
  for (let c = 0; c < ncol; c++) {
    if (pivos.includes(c)) continue;
    const v = new Array(ncol).fill(0);
    v[c] = 1;
    pivos.forEach((pc, i) => (v[pc] = -M[i][c]));
    nulos.push(v);
  }
  return { posto: pivos.length, nulos };
}

/** Bloco de resíduos de um posicionamento (ou do puxão do arraste). */
interface Bloco {
  /** componentes móveis que o bloco envolve */
  comps: string[];
  f: () => number[];
}

/**
 * Levenberg–Marquardt só nos componentes `moveis`, com os blocos dados. Jacobiano numérico
 * esparso: cada coluna recalcula só os blocos do componente perturbado.
 */
function ajustar(
  moveis: string[], blocos: Bloco[], poses: Map<string, Transformacao>, centros: Map<string, Vec3>, L: number, maxIter: number, preferido?: string,
): number {
  const n = moveis.length * 6;
  const idx = new Map(moveis.map((c, k) => [c, k]));
  const tams: number[] = [];
  const avaliar = () => blocos.map((b) => b.f());
  let atual = avaliar();
  blocos.forEach((_, i) => tams.push(atual[i].length));
  const somaQ = (v: number[][]) => v.reduce((s, b) => s + b.reduce((t, x) => t + x * x, 0), 0);
  let custo = somaQ(atual);
  if (!n || custo < 1e-20) return custo;
  const doComp = new Map<string, number[]>(moveis.map((c) => [c, []]));
  blocos.forEach((b, i) => b.comps.forEach((c) => doComp.get(c)?.push(i)));
  const ini: number[] = [];
  tams.reduce((o, t) => (ini.push(o), o + t), 0);
  const nl = tams.reduce((a, b) => a + b, 0);
  let lambda = 1e-3;
  const h = 1e-6;
  for (let it = 0; it < maxIter && custo > 1e-20; it++) {
    const salvas = new Map(moveis.map((c) => [c, poses.get(c)!]));
    // jacobiano esparso (linhas = resíduos, colunas = 6 por componente)
    const J: Float64Array[] = Array.from({ length: nl }, () => new Float64Array(n));
    for (const c of moveis) {
      const k = idx.get(c)!;
      for (let j = 0; j < 6; j++) {
        const x = new Array(6).fill(0);
        x[j] = h;
        poses.set(c, passo(salvas.get(c)!, x, 0, centros.get(c) ?? salvas.get(c)!.pos, L));
        for (const bi of doComp.get(c)!) {
          const f = blocos[bi].f();
          for (let r = 0; r < tams[bi]; r++) J[ini[bi] + r][k * 6 + j] = ((f[r] ?? 0) - atual[bi][r]) / h;
        }
        poses.set(c, salvas.get(c)!);
      }
    }
    const res = atual.flat();
    const JtJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let i = 0; i < nl; i++) {
      const li = J[i];
      const nz: number[] = [];
      for (let a = 0; a < n; a++) if (li[a]) nz.push(a);
      for (const a of nz) {
        Jtr[a] += li[a] * res[i];
        for (const b of nz) JtJ[a][b] += li[a] * li[b];
      }
    }
    // regularização mínima (Tikhonov): direções que os posicionamentos não prendem (deslizar,
    // girar no eixo livre) têm JᵀJ ≈ 0 e o ruído numérico viraria passos enormes; com ela o
    // componente se move o mínimo — o que já está certo não se mexe
    let maxDiag = 0;
    for (let a = 0; a < n; a++) maxDiag = Math.max(maxDiag, JtJ[a][a]);
    const mu = Math.max(maxDiag, 1e-12) * 1e-7;
    let melhorou = false;
    for (let tentativa = 0; tentativa < 10 && !melhorou; tentativa++) {
      const A = JtJ.map((l, a) => l.map((x, b) => {
        if (a !== b) return x;
        // quem não é o preferido resiste um pouco mais a se mover
        const resiste = preferido && moveis[Math.floor(a / 6)] !== preferido ? 10 : 1;
        return x + lambda * resiste * x + (mu + lambda * maxDiag * 1e-3) * resiste;
      }));
      const delta = resolverLinear(A, Jtr.map((x) => -x));
      if (!delta) {
        lambda *= 10;
        continue;
      }
      for (const c of moveis) poses.set(c, passo(salvas.get(c)!, delta, idx.get(c)! * 6, centros.get(c) ?? salvas.get(c)!.pos, L));
      const novo = avaliar();
      const nc = somaQ(novo);
      if (nc < custo) {
        atual = novo;
        custo = nc;
        lambda = Math.max(lambda / 10, 1e-12);
        melhorou = true;
      } else {
        for (const c of moveis) poses.set(c, salvas.get(c)!);
        lambda *= 10;
      }
    }
    if (!melhorou) break;
  }
  return custo;
}

/**
 * Resolve os posicionamentos ativos. Fixos e a própria montagem (comp null) não se movem;
 * componentes suprimidos ficam de fora. Primeiro em etapas (cada componente preso só ao que já
 * está resolvido, sozinho: cadeias e árvores convergem na hora); depois um ajuste de todos juntos
 * (ciclos e acoplamentos).
 */
export function resolverMontagem(d: DocumentoMontagem, o: OpcoesSolver = {}): ResultadoSolver {
  const comps = new Map(d.componentes.filter((c) => !c.suprimido).map((c) => [c.id, c]));
  const ativos = d.posicionamentos.filter((m) => !m.suprimido && m.a && m.b && (m.a.comp === null || comps.has(m.a.comp)) && (m.b.comp === null || comps.has(m.b.comp)));
  const L = o.escala ?? 100;
  const centros = o.centros ?? new Map<string, Vec3>();
  const poses = new Map<string, Transformacao>([...comps.values()].map((c) => [c.id, c.t]));
  // instâncias de padrão seguem a semente (aplicarPadroes): no solver contam como fixas
  const movel = (id: string | null): id is string => id !== null && !comps.get(id)!.fixo && !comps.get(id)!.padrao;
  const erros = new Map<string, string>();

  // blocos de resíduos
  const blocos: (Bloco & { m?: Posicionamento })[] = [];
  for (const m of ativos) {
    const la = primitivaLocal(m.a!.ref), lb = primitivaLocal(m.b!.ref);
    if (!la || !lb) {
      erros.set(m.id, "Entidade não serve para posicionar (escolha faces planas ou cilíndricas, arestas, vértices ou planos).");
      continue;
    }
    const prim = (r: RefMontagem, p: Primitiva) => (r.comp ? transformar(p, poses.get(r.comp)!) : p);
    const f = () => {
      const trava = m.tipo === "travar" ? { a: m.a!.comp ? poses.get(m.a!.comp)! : IDT, b: m.b!.comp ? poses.get(m.b!.comp)! : IDT, rel: m.rel ?? IDT } : undefined;
      const r = residuos(m, prim(m.a!, la), prim(m.b!, lb), trava, L);
      return typeof r === "string" ? [] : r;
    };
    const teste = residuos(m, prim(m.a!, la), prim(m.b!, lb), m.tipo === "travar" ? { a: IDT, b: IDT, rel: IDT } : undefined, L);
    if (typeof teste === "string") {
      erros.set(m.id, teste);
      continue;
    }
    blocos.push({ m, comps: [m.a!.comp, m.b!.comp].filter(movel), f });
  }
  const arraste: Bloco | null = o.arrastado && movel(o.arrastado.comp) && comps.has(o.arrastado.comp)
    ? { comps: [o.arrastado.comp], f: () => mul(sub(poses.get(o.arrastado!.comp)!.pos, o.arrastado!.alvo.pos), 0.02) }
    : null;

  const ligados = new Set<string>();
  for (const b of blocos) b.comps.forEach((c) => ligados.add(c));
  if (arraste) ligados.add(o.arrastado!.comp);
  const maxIter = o.maxIter ?? 60;

  // 1) em etapas: componente cujos posicionamentos só envolvem o que já está resolvido
  const resolvidos = new Set<string>();
  const pendentes = new Set(ligados);
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const c of [...pendentes]) {
      // só os posicionamentos que já ligam o componente ao que está resolvido (ou fixo)
      const meus = blocos.filter((b) => b.comps.includes(c) && b.comps.every((x) => x === c || resolvidos.has(x)));
      if (!meus.length) continue;
      const extras = arraste && o.arrastado!.comp === c ? [arraste] : [];
      ajustar([c], [...meus, ...extras], poses, centros, L, maxIter);
      resolvidos.add(c);
      pendentes.delete(c);
      mudou = true;
    }
  }
  // 2) todos juntos (o que sobrou acoplado + acabamento)
  const moveis = [...ligados];
  const custo = ajustar(moveis, arraste ? [...blocos, arraste] : blocos, poses, centros, L, maxIter, o.preferido);

  // posicionamentos não satisfeitos
  for (const b of blocos) {
    const r = b.f();
    const e = Math.sqrt(r.reduce((s, x) => s + x * x, 0));
    if (e > 1e-3 && !erros.has(b.m!.id)) erros.set(b.m!.id, "Não pode ser satisfeito junto com os outros posicionamentos (conflito ou superdefinido).");
  }

  // graus de liberdade que sobram: espaço nulo do jacobiano dos posicionamentos
  const graus = new Map<string, number>();
  for (const c of comps.values()) if (!c.fixo && !c.padrao) graus.set(c.id, 6);
  if (moveis.length && !o.semGraus) {
    const n = moveis.length * 6;
    const r0 = blocos.map((b) => b.f());
    const J: number[][] = [];
    r0.forEach((b) => b.forEach(() => J.push(new Array(n).fill(0))));
    const ini: number[] = [];
    r0.reduce((o2, b) => (ini.push(o2), o2 + b.length), 0);
    const h = 1e-6;
    moveis.forEach((c, k) => {
      const salva = poses.get(c)!;
      for (let j = 0; j < 6; j++) {
        const x = new Array(6).fill(0);
        x[j] = h;
        poses.set(c, passo(salva, x, 0, centros.get(c) ?? salva.pos, L));
        blocos.forEach((b, bi) => {
          if (!b.comps.includes(c)) return;
          const f = b.f();
          for (let r = 0; r < r0[bi].length; r++) J[ini[bi] + r][k * 6 + j] = ((f[r] ?? 0) - r0[bi][r]) / h;
        });
        poses.set(c, salva);
      }
    });
    const { nulos } = colunasLivres(J, n, 1e-5);
    moveis.forEach((c, k) => {
      const sub6 = nulos.map((v) => v.slice(k * 6, k * 6 + 6)).filter((v) => v.some((x) => Math.abs(x) > 1e-6));
      graus.set(c, Math.min(6, colunasLivres(sub6, 6, 1e-6).posto));
    });
  }
  const mudaram = new Map<string, Transformacao>();
  for (const [id, t] of poses) if (t !== comps.get(id)!.t) mudaram.set(id, t);
  return { poses: mudaram, erros, graus, residuo: Math.sqrt(custo) };
}
