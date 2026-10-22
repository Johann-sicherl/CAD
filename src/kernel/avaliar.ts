// Aba Avaliar no kernel: medições exatas no B-Rep, propriedades de massa (com inércia)
// e verificação de geometria. Ver docs/funcional/avaliar.md.

import { getOC, measureArea, measureLength, measureShapeVolumeProperties, type Shape3D } from "replicad";
import type { Referencia, Vec3 } from "../model";
import { acharAresta, acharFace, assinaturaAresta, assinaturaFace } from "./topologia";

export interface LinhaMedida {
  rotulo: string;
  valor: string;
}

export interface ResultadoMedida {
  linhas: LinhaMedida[];
  /** Segmento da menor distância, para desenhar no viewport. */
  segmento?: [Vec3, Vec3];
}

type OC = Record<string, new (...a: unknown[]) => Record<string, (...a: unknown[]) => unknown>>;
const oc = () => getOC() as unknown as OC;
const mm = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} mm`;
const graus = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}°`;
const xyz = (p: Vec3) => p.map((v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })).join("; ");
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norma = (a: Vec3) => Math.hypot(...a);

interface Item {
  forma: unknown; // TopoDS_Shape
  ref: Referencia;
  pontoCentro?: Vec3;
  direcao?: Vec3; // normal de face plana ou direção de aresta reta
}

function itemDe(peca: Shape3D, r: Referencia): Item {
  if (r.tipo === "face") {
    const f = acharFace(peca, r.ass);
    const a = assinaturaFace(f);
    return { forma: f.wrapped, ref: r, pontoCentro: a.geom === "cilindro" ? a.pontoEixo : a.centro, direcao: a.normal };
  }
  if (r.tipo === "aresta") {
    const e = acharAresta(peca, r.ass);
    const a = assinaturaAresta(e);
    return { forma: e.wrapped, ref: r, pontoCentro: a.centro, direcao: a.geom === "linha" ? sub(a.b, a.a) : undefined };
  }
  if (r.tipo === "vertice") {
    const O = oc();
    const v = new O.BRepBuilderAPI_MakeVertex(new O.gp_Pnt(...r.p)).Vertex();
    return { forma: v, ref: r, pontoCentro: r.p };
  }
  throw new Error("Medir: escolha faces, arestas ou vértices.");
}

function descreverUm(peca: Shape3D, r: Referencia): LinhaMedida[] {
  if (r.tipo === "vertice") return [{ rotulo: "X; Y; Z", valor: xyz(r.p) }];
  if (r.tipo === "aresta") {
    const e = acharAresta(peca, r.ass);
    const a = assinaturaAresta(e);
    const out = [{ rotulo: "Comprimento", valor: mm(measureLength(e)) }];
    if (a.geom === "circulo" && a.raio !== undefined) {
      out.push({ rotulo: "Diâmetro", valor: mm(2 * a.raio) }, { rotulo: "Raio", valor: mm(a.raio) });
      if (a.centro) out.push({ rotulo: "Centro", valor: xyz(a.centro) });
    }
    return out;
  }
  if (r.tipo === "face") {
    const f = acharFace(peca, r.ass);
    const a = assinaturaFace(f);
    const perimetro = f.edges.reduce((s, e) => s + measureLength(e), 0);
    const out = [
      { rotulo: "Área", valor: `${measureArea(f).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} mm²` },
      { rotulo: "Perímetro", valor: mm(perimetro) },
    ];
    if (a.geom === "cilindro" && a.raio !== undefined) out.push({ rotulo: "Diâmetro", valor: mm(2 * a.raio) });
    if (a.normal) out.push({ rotulo: "Normal", valor: xyz(a.normal) });
    return out;
  }
  return [];
}

export function medir(peca: Shape3D | null, refs: Referencia[]): ResultadoMedida {
  if (!peca) throw new Error("Não há peça para medir.");
  if (!refs.length) return { linhas: [{ rotulo: "Medir", valor: "Toque faces, arestas ou vértices" }] };
  if (refs.length === 1) return { linhas: descreverUm(peca, refs[0]) };
  const [a, b] = refs.slice(0, 2).map((r) => itemDe(peca, r));
  const O = oc();
  const dss = new O.BRepExtrema_DistShapeShape();
  dss.LoadS1(a.forma);
  dss.LoadS2(b.forma);
  dss.Perform();
  const d = dss.Value() as number;
  const p1 = dss.PointOnShape1(1) as { X(): number; Y(): number; Z(): number };
  const p2 = dss.PointOnShape2(1) as { X(): number; Y(): number; Z(): number };
  const q1: Vec3 = [p1.X(), p1.Y(), p1.Z()], q2: Vec3 = [p2.X(), p2.Y(), p2.Z()];
  const linhas: LinhaMedida[] = [{ rotulo: "Distância mínima", valor: mm(d) }];
  const delta = sub(q2, q1);
  linhas.push({ rotulo: "ΔX; ΔY; ΔZ", valor: xyz(delta.map(Math.abs) as Vec3) });
  if (a.pontoCentro && b.pontoCentro && (a.ref.tipo !== "face" || !a.direcao || b.ref.tipo === "vertice")) {
    linhas.push({ rotulo: "Centro a centro", valor: mm(norma(sub(b.pontoCentro, a.pontoCentro))) });
  }
  if (a.direcao && b.direcao) {
    const c = Math.abs(esc(a.direcao, b.direcao)) / (norma(a.direcao) * norma(b.direcao));
    const ang = (Math.acos(Math.min(1, c)) * 180) / Math.PI;
    linhas.push({ rotulo: "Ângulo", valor: graus(ang) });
    if (ang < 1e-6 && a.ref.tipo === "face" && b.ref.tipo === "face") linhas.push({ rotulo: "Distância normal", valor: mm(Math.abs(esc(sub(b.pontoCentro!, a.pontoCentro!), a.direcao)) / norma(a.direcao)) });
  }
  return { linhas, segmento: [q1, q2] };
}

// ---------- propriedades de massa ----------

export interface PropriedadesMassa {
  volume: number; // mm³
  area: number; // mm²
  centro: Vec3;
  /** Tensor de inércia no centro de massa, densidade 1 (mm⁵): [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] (Ixy = −∫xy). */
  inercia: [number, number, number, number, number, number];
  principais: [number, number, number];
  eixos: [Vec3, Vec3, Vec3];
}

export function massa(peca: Shape3D | null): PropriedadesMassa {
  if (!peca) throw new Error("Não há peça.");
  const props = measureShapeVolumeProperties(peca) as unknown as {
    volume: number; centerOfMass: Vec3; wrapped: { MomentOfInertia(a: unknown): number };
  };
  const c = props.centerOfMass;
  const O = oc();
  const I = (d: Vec3) => {
    const n = norma(d);
    return props.wrapped.MomentOfInertia(new O.gp_Ax1(new O.gp_Pnt(...c), new O.gp_Dir(d[0] / n, d[1] / n, d[2] / n)));
  };
  const ixx = I([1, 0, 0]), iyy = I([0, 1, 0]), izz = I([0, 0, 1]);
  // produtos de inércia a partir de eixos diagonais: I(u) = uᵀ J u
  const ixy = I([1, 1, 0]) - (ixx + iyy) / 2;
  const ixz = I([1, 0, 1]) - (ixx + izz) / 2;
  const iyz = I([0, 1, 1]) - (iyy + izz) / 2;
  const { valores, vetores } = autovalores([[ixx, ixy, ixz], [ixy, iyy, iyz], [ixz, iyz, izz]]);
  return {
    volume: props.volume,
    area: measureArea(peca),
    centro: c,
    inercia: [ixx, iyy, izz, ixy, ixz, iyz],
    principais: valores as [number, number, number],
    eixos: vetores as [Vec3, Vec3, Vec3],
  };
}

/** Autovalores/vetores de matriz 3×3 simétrica (Jacobi), em ordem crescente. */
function autovalores(m: number[][]): { valores: number[]; vetores: Vec3[] } {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) [p, q] = [i, j];
    if (Math.abs(a[p][q]) < 1e-12 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-30)) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  const ordem = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { valores: ordem.map((i) => a[i][i]), vetores: ordem.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3) };
}

// ---------- verificar ----------

export interface ResultadoVerificacao {
  valida: boolean;
  faces: number;
  arestas: number;
  arestasCurtas: number;
  menorAresta: number;
  menorFace: number;
}

export function verificar(peca: Shape3D | null, limiteCurta = 0.01): ResultadoVerificacao {
  if (!peca) throw new Error("Não há peça.");
  const O = oc();
  const an = new O.BRepCheck_Analyzer(peca.wrapped, true, false, false);
  const valida = an.IsValid(peca.wrapped) as boolean;
  const comps = peca.edges.map((e) => measureLength(e));
  const areas = peca.faces.map((f) => measureArea(f));
  return {
    valida,
    faces: areas.length,
    arestas: comps.length,
    arestasCurtas: comps.filter((c) => c < limiteCurta).length,
    menorAresta: Math.min(...comps),
    menorFace: Math.min(...areas),
  };
}
