// Curvas 3D (menu Curvas ▾): hélice/espiral, curva por pontos (XYZ ou de referência), composta e
// projetada. Cada curva vira uma lista de trechos (os mesmos da varredura), que servem de
// trajetória, curva-guia ou linha de centro. Campos: docs/funcional/features.md §16.

import { cast, getOC, Vector, type AnyShape, type Edge, type Face, type Shape3D } from "replicad";
import type { FeatureCurva, Vec3 } from "../model";
import { cruz, normalizar } from "../esboco/referencial";
import { trechoDaAresta, type Trecho } from "./varredura";

const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- hélice e espiral ----------

/** Círculo de base da hélice (centro, raio, normal e direção do ângulo zero). */
export interface BaseHelice {
  c: Vec3;
  r: number;
  normal: Vec3;
  x: Vec3;
}

/** Passo, altura e voltas conforme a forma de definição escolhida. */
export function medidasHelice(f: Pick<FeatureCurva, "definicao" | "passo" | "revolucoes" | "altura">): { passo: number; voltas: number; altura: number } {
  const pos = (v: number, nome: string) => {
    if (!(v > 0)) throw new Error(`${nome} deve ser maior que zero.`);
    return v;
  };
  const r = (() => {
    switch (f.definicao) {
      case "passoRevolucao": return { passo: pos(f.passo, "O passo"), voltas: pos(f.revolucoes, "O nº de revoluções"), altura: f.passo * f.revolucoes };
      case "alturaRevolucao": return { passo: pos(f.altura, "A altura") / pos(f.revolucoes, "O nº de revoluções"), voltas: f.revolucoes, altura: f.altura };
      case "alturaPasso": return { passo: pos(f.passo, "O passo"), voltas: pos(f.altura, "A altura") / f.passo, altura: f.altura };
      case "espiral": return { passo: pos(f.passo, "O passo"), voltas: pos(f.revolucoes, "O nº de revoluções"), altura: 0 };
    }
  })();
  // cada volta vira dezenas de pontos e trechos: limite para não travar a regeneração
  if (r.voltas > MAX_VOLTAS) throw new Error(`Voltas demais (${Math.round(r.voltas)}): o máximo é ${MAX_VOLTAS}. Aumente o passo ou diminua a altura.`);
  return r;
}

export const MAX_VOLTAS = 200;

/**
 * Pontos da hélice (ou espiral plana) a partir do círculo de base. Hélice cônica: o raio muda
 * com a altura pelo ângulo do cone. Espiral: o raio cresce um passo por volta, no plano da base.
 */
export function pontosHelice(f: FeatureCurva, b: BaseHelice, porVolta = 48): Vec3[] {
  const { passo, voltas, altura } = medidasHelice(f);
  const n = mul(normalizar(b.normal), f.inverter ? -1 : 1);
  const x = normalizar(b.x);
  const y = cruz(n, x);
  const sentido = f.horario ? -1 : 1;
  const a0 = (f.anguloInicial * Math.PI) / 180;
  const tanCone = f.conica.ativa ? Math.tan((f.conica.angulo * Math.PI) / 180) * (f.conica.paraFora ? 1 : -1) : 0;
  const total = Math.max(2, Math.ceil(voltas * porVolta));
  const out: Vec3[] = [];
  for (let i = 0; i <= total; i++) {
    const u = (i / total) * voltas; // voltas percorridas
    const ang = a0 + sentido * u * 2 * Math.PI;
    const h = f.definicao === "espiral" ? 0 : (u / voltas) * altura;
    const r = f.definicao === "espiral" ? b.r + u * passo : b.r + h * tanCone;
    if (r <= 0) throw new Error("A hélice cônica fecha antes do fim: diminua o ângulo ou a altura.");
    out.push(soma(b.c, soma(mul(n, h), soma(mul(x, r * Math.cos(ang)), mul(y, r * Math.sin(ang))))));
  }
  return out;
}

// ---------- curva por pontos ----------

/** Lê a tabela "x; y; z" (uma linha por ponto; aceita vírgula decimal e tabulação). */
export function lerPontosXYZ(texto: string): Vec3[] {
  const out: Vec3[] = [];
  texto.split(/\r?\n/).forEach((linha, i) => {
    const t = linha.trim();
    if (!t) return;
    // separadores: ponto e vírgula, tabulação ou espaço; vírgula é decimal (30,5)
    const partes = t.split(/[;\s]+/).filter(Boolean).map((p) => Number(p.replace(",", ".")));
    if (partes.length !== 3 || partes.some((v) => !Number.isFinite(v))) throw new Error(`Linha ${i + 1} dos pontos: use "x; y; z".`);
    out.push(partes as Vec3);
  });
  return out;
}

/**
 * Curva suave que passa pelos pontos (Catmull-Rom → Béziers cúbicas, como a spline do esboço).
 * Fechada: o último ponto liga no primeiro com a mesma suavidade.
 */
export function curvaPorPontos(pts: Vec3[], fechada: boolean): Trecho[] {
  const q = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-9);
  if (fechada && q.length > 2 && dist(q[0], q[q.length - 1]) < 1e-9) q.pop();
  if (q.length < 2) throw new Error("A curva precisa de pelo menos 2 pontos diferentes.");
  if (q.length === 2 && !fechada) return [{ tipo: "linha", a: q[0], b: q[1] }];
  const m = q.length;
  const pega = (i: number): Vec3 => {
    if (fechada) return q[(i + m) % m];
    if (i < 0) return soma(q[0], sub(q[0], q[1]));
    if (i >= m) return soma(q[m - 1], sub(q[m - 1], q[m - 2]));
    return q[i];
  };
  const out: Trecho[] = [];
  for (let i = 0; i < (fechada ? m : m - 1); i++) {
    const p0 = pega(i - 1), p1 = pega(i), p2 = pega(i + 1), p3 = pega(i + 2);
    out.push({ tipo: "bezier", pts: [p1, soma(p1, mul(sub(p2, p0), 1 / 6)), sub(p2, mul(sub(p3, p1), 1 / 6)), p2] });
  }
  return out;
}

// ---------- curva projetada ----------

type OC = {
  BRepPrimAPI_MakePrism: new (s: unknown, v: unknown, copiar?: boolean, canonizar?: boolean) => { Shape(): unknown; delete(): void };
  BRepAlgoAPI_Section: new (a: unknown, b: unknown, ja?: boolean) => { Shape(): unknown; delete(): void };
};

/** Superfície "parede" varrida pela aresta ao longo de `v` (começando em `-v` se bidirecional). */
function parede(e: Edge, v: Vec3, bidirecional: boolean): AnyShape {
  const oc = getOC() as unknown as OC;
  const base = bidirecional ? e.clone().translate(mul(v, -1)) : e;
  const vec = new Vector(bidirecional ? mul(v, 2) : v);
  const mk = new oc.BRepPrimAPI_MakePrism(base.wrapped, vec.wrapped, true, true);
  const s = cast(mk.Shape() as never);
  mk.delete();
  return s;
}

/** Interseção (seção) de duas formas: as arestas onde se cruzam. */
function secao(a: AnyShape, b: AnyShape | Face | Shape3D): Edge[] {
  const oc = getOC() as unknown as OC;
  const s = new oc.BRepAlgoAPI_Section(a.wrapped, b.wrapped, true);
  const r = cast(s.Shape() as never);
  s.delete();
  return (r as unknown as { edges: Edge[] }).edges;
}

/**
 * Esboço em faces: cada trecho do esboço vira uma parede na direção da normal do esboço; a curva é
 * onde essa parede corta as faces escolhidas.
 */
export function projetarEmFaces(trechosEsboco: Edge[], normal: Vec3, faces: Face[], comprimento: number, bidirecional: boolean): Trecho[] {
  const out: Trecho[] = [];
  const v = mul(normalizar(normal), comprimento);
  for (const e of trechosEsboco) {
    const p = parede(e, v, bidirecional);
    for (const f of faces) for (const a of secao(p, f)) out.push(trechoDaAresta(a));
  }
  if (!out.length) throw new Error("O esboço não alcança as faces nessa direção (tente Inverter ou Bidirecional).");
  return out;
}

/** Esboço em esboço: as duas paredes (cada esboço na sua normal) se cruzam numa curva 3D. */
export function cruzarEsbocos(e1: Edge[], n1: Vec3, e2: Edge[], n2: Vec3, comprimento: number): Trecho[] {
  const out: Trecho[] = [];
  const v1 = mul(normalizar(n1), comprimento), v2 = mul(normalizar(n2), comprimento);
  const p2 = e2.map((e) => parede(e, v2, true));
  for (const e of e1) {
    const p1 = parede(e, v1, true);
    for (const q of p2) for (const a of secao(p1, q)) out.push(trechoDaAresta(a));
  }
  if (!out.length) throw new Error("Os dois esboços não se cruzam (os planos precisam se interceptar).");
  return out;
}

/** Polilinhas de cada trecho (para desenhar a curva no viewport). */
export function polilinhasDe(trechos: Trecho[], arestaDe: (t: Trecho) => Edge): Vec3[][] {
  return trechos.map((t) => {
    if (t.tipo === "linha") return [t.a, t.b];
    const e = arestaDe(t);
    const n = t.tipo === "pontos" ? Math.min(400, t.pts.length * 2) : 32;
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = e.pointAt(i / n);
      return [p.x, p.y, p.z] as Vec3;
    });
  });
}


