// Topologia da peça para seleção e referências persistentes.
// Cada face/aresta ganha uma "assinatura" geométrica (tipo, centro, normal/eixo, área/comprimento).
// O recurso guarda a assinatura; na regeneração, a entidade mais parecida da peça nova é usada.

import { measureArea, type Edge, type Face, type Shape3D } from "replicad";
import type { AssinaturaAresta, AssinaturaFace, Referencia, Vec3 } from "../model";

const tupla = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const esc3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const gp = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];

type Adaptador = {
  GetType(): { value: number } | number;
  Circle(): { Radius(): number; Location(): never; Axis(): { Direction(): never } };
  Cylinder(): { Radius(): number; Axis(): { Location(): never; Direction(): never } };
  Cone(): { Axis(): { Location(): never; Direction(): never }; RefRadius(): number };
};

export function assinaturaFace(f: Face): AssinaturaFace {
  const tipo = f.geomType;
  const ass: AssinaturaFace = {
    geom: tipo === "PLANE" ? "plano" : tipo === "CYLINDRE" ? "cilindro" : tipo === "CONE" ? "cone" : tipo === "SPHERE" ? "esfera" : "outra",
    centro: tupla(f.center),
    area: measureArea(f),
  };
  try {
    if (ass.geom === "plano") ass.normal = tupla(f.normalAt());
    else if (ass.geom === "cilindro" || ass.geom === "cone") {
      const ad = (f as unknown as { _geomAdaptor(): Adaptador })._geomAdaptor();
      const eixo = ass.geom === "cilindro" ? ad.Cylinder().Axis() : ad.Cone().Axis();
      ass.eixo = gp(eixo.Direction());
      ass.pontoEixo = gp(eixo.Location());
      if (ass.geom === "cilindro") ass.raio = ad.Cylinder().Radius();
    }
  } catch {
    /* sem dados extras: a assinatura básica basta */
  }
  return ass;
}

export function assinaturaAresta(e: Edge): AssinaturaAresta {
  const tipo = e.geomType;
  const ass: AssinaturaAresta = {
    geom: tipo === "LINE" ? "linha" : tipo === "CIRCLE" ? "circulo" : "outra",
    meio: tupla(e.pointAt(0.5)),
    a: tupla(e.startPoint),
    b: tupla(e.endPoint),
    comprimento: e.length,
  };
  if (ass.geom === "circulo") {
    try {
      const c = (e as unknown as { _geomAdaptor(): Adaptador })._geomAdaptor().Circle();
      ass.raio = c.Radius();
      ass.centro = gp(c.Location());
      ass.eixo = gp(c.Axis().Direction());
    } catch {
      /* ignora */
    }
  }
  return ass;
}

export interface Topologia {
  faces: AssinaturaFace[];
  arestas: AssinaturaAresta[];
  vertices: Vec3[];
}

const cache = new WeakMap<Shape3D, { faces: Face[]; arestas: Edge[]; topo: Topologia }>();

export function topologia(peca: Shape3D) {
  let t = cache.get(peca);
  if (t) return t;
  const faces = peca.faces;
  const arestas = peca.edges;
  const vs: Vec3[] = [];
  const add = (p: Vec3) => {
    if (!vs.some((q) => dist3(p, q) < 1e-6)) vs.push(p);
  };
  const assA = arestas.map(assinaturaAresta);
  for (const a of assA) {
    add(a.a);
    add(a.b);
  }
  t = { faces, arestas, topo: { faces: faces.map(assinaturaFace), arestas: assA, vertices: vs } };
  cache.set(peca, t);
  return t;
}

export class ErroReferencia extends Error {}

/** Face da peça atual que melhor corresponde à assinatura guardada. */
export function acharFace(peca: Shape3D, ass: AssinaturaFace): Face {
  const { faces, topo } = topologia(peca);
  let melhor = -1, nota = Infinity;
  topo.faces.forEach((f, i) => {
    if (f.geom !== ass.geom) return;
    if (ass.normal && f.normal && esc3(ass.normal, f.normal) < 0.995) return;
    if (ass.eixo && f.eixo && Math.abs(esc3(ass.eixo, f.eixo)) < 0.995) return;
    const n = dist3(f.centro, ass.centro) + Math.abs(f.area - ass.area) / Math.max(1, Math.sqrt(ass.area)) +
      (ass.raio !== undefined && f.raio !== undefined ? Math.abs(ass.raio - f.raio) * 2 : 0);
    if (n < nota) { nota = n; melhor = i; }
  });
  const tol = Math.max(2, 0.25 * Math.sqrt(ass.area));
  if (melhor < 0 || nota > tol) throw new ErroReferencia("Uma face selecionada não existe mais: reselecione.");
  return faces[melhor];
}

export function acharAresta(peca: Shape3D, ass: AssinaturaAresta): Edge {
  const { arestas, topo } = topologia(peca);
  let melhor = -1, nota = Infinity;
  topo.arestas.forEach((a, i) => {
    if (a.geom !== ass.geom) return;
    const n = dist3(a.meio, ass.meio) + Math.abs(a.comprimento - ass.comprimento) * 0.5;
    if (n < nota) { nota = n; melhor = i; }
  });
  const tol = Math.max(1, 0.3 * ass.comprimento);
  if (melhor < 0 || nota > tol) throw new ErroReferencia("Uma aresta selecionada não existe mais: reselecione.");
  return arestas[melhor];
}

/** Arestas pedidas por uma lista de itens (arestas e todas as arestas das faces). */
export function arestasDosItens(peca: Shape3D, itens: Referencia[]): Edge[] {
  const out: Edge[] = [];
  const add = (e: Edge) => {
    if (!out.some((x) => x.isSame(e))) out.push(e);
  };
  for (const it of itens) {
    if (it.tipo === "aresta") add(acharAresta(peca, it.ass));
    else if (it.tipo === "face") {
      const f = acharFace(peca, it.ass);
      for (const e of peca.edges) if (f.edges.some((x) => x.isSame(e))) add(e);
    }
  }
  return out;
}

/** Acrescenta as arestas ligadas por tangência contínua (propagação tangente). */
export function propagarTangente(peca: Shape3D, base: Edge[]): Edge[] {
  const todas = peca.edges;
  const out = [...base];
  const tangEm = (e: Edge, p: Vec3): Vec3 | null => {
    const a = tupla(e.startPoint), b = tupla(e.endPoint);
    if (dist3(a, p) < 1e-5) return tupla(e.tangentAt(0));
    if (dist3(b, p) < 1e-5) return tupla(e.tangentAt(1));
    return null;
  };
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const e of out.slice()) {
      for (const p of [tupla(e.startPoint), tupla(e.endPoint)]) {
        const t1 = tangEm(e, p);
        if (!t1) continue;
        for (const o of todas) {
          if (out.some((x) => x.isSame(o))) continue;
          const t2 = tangEm(o, p);
          if (!t2) continue;
          const c = Math.abs(esc3(t1, t2)) / (Math.hypot(...t1) * Math.hypot(...t2) || 1);
          if (c > 0.9995) {
            out.push(o);
            mudou = true;
          }
        }
      }
    }
  }
  return out;
}

export { dist3, esc3 };
