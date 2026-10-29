// Vistas de desenho: projeção ortográfica de um sólido (peça) ou de vários (montagem, cada um na
// sua posição) com remoção de linhas ocultas (HLR do OpenCascade via replicad). Devolve polilinhas
// 2D (mm, no plano da vista: x para a direita, y para cima) separadas em visíveis e ocultas.
// Roda no Web Worker do kernel e nos testes (scripts/teste-desenho.ts).

import { cast, getOC, makeCompound, Plane, ProjectionCamera, type Edge, type Shape3D } from "replicad";
import type { Vec3 } from "../model";
import { CAMERAS, type Orientacao } from "../desenho/modelo";

export { CAMERAS, type Orientacao };

export interface Projecao {
  /** polilinhas visíveis e ocultas, coordenadas da vista (mm, sem escala) */
  visiveis: [number, number][][];
  ocultas: [number, number][][];
  /** caixa das linhas visíveis */
  caixa: { x0: number; y0: number; x1: number; y1: number };
  /** círculos e arcos visíveis inteiros vistos de frente (centro, raio): marcas de centro e cotas */
  circulos: { cx: number; cy: number; r: number }[];
  /** vista de seção: regiões cortadas (laços: contorno e furos; preencher com par-ímpar) por sólido */
  cortes?: { i: number; lacos: [number, number][][] }[];
}

/** Plano de corte da vista de seção: o material entre quem olha (lado de `n`) e o plano sai. */
export interface Corte {
  p: Vec3;
  n: Vec3;
}

/** Liga as arestas (pontos amostrados) em laços fechados pelas pontas. */
function lacos(arestas: Vec3[][], eps: number): Vec3[][] {
  const resto = arestas.filter((a) => a.length > 1).map((a) => a.slice());
  const out: Vec3[][] = [];
  const perto = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= eps;
  while (resto.length) {
    const laco = resto.shift()!;
    for (let achou = true; achou && !perto(laco[0], laco[laco.length - 1]);) {
      achou = false;
      const fim = laco[laco.length - 1];
      for (let k = 0; k < resto.length; k++) {
        const a = resto[k];
        if (perto(a[0], fim)) laco.push(...a.slice(1));
        else if (perto(a[a.length - 1], fim)) laco.push(...a.slice(0, -1).reverse());
        else continue;
        resto.splice(k, 1);
        achou = true;
        break;
      }
    }
    out.push(laco);
  }
  return out;
}

/** Corta o sólido pelo plano (fica o lado oposto a `n`) e acha as faces no plano (hachura). */
function cortar(s: Shape3D, c: Corte, tol: number): { forma: Shape3D | null; faces: Vec3[][][] } {
  const n = norm(c.n);
  let forma: Shape3D | null = null;
  try {
    forma = s.clone().cutPlane(new Plane(c.p, null, [-n[0], -n[1], -n[2]]), 0, "positive") as Shape3D | null;
  } catch {
    forma = null;
  }
  if (!forma) return { forma: null, faces: [] };
  const faces: Vec3[][][] = [];
  for (const f of forma.faces) {
    if (f.geomType === "PLANE") {
      const ct = f.center;
      const nf = f.normalAt(ct);
      const noPlano = Math.abs(Math.abs(nf.x * n[0] + nf.y * n[1] + nf.z * n[2]) - 1) < 1e-6
        && Math.abs((ct.x - c.p[0]) * n[0] + (ct.y - c.p[1]) * n[1] + (ct.z - c.p[2]) * n[2]) < 1e-4;
      nf.delete();
      ct.delete();
      if (noPlano) {
        const es = f.edges;
        faces.push(lacos(es.map((e) => pontosDaAresta(e, tol)), Math.max(1e-4, tol * 0.01)));
        for (const e of es) e.delete();
      }
    }
    f.delete();
  }
  return { forma, faces };
}

const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Quantos pontos para desenhar a aresta (retas: 2; curvas: pela curvatura). */
function pontosDaAresta(e: Edge, tol: number): Vec3[] {
  const tipo = e.geomType;
  if (tipo === "LINE") return [e.startPoint, e.endPoint].map((p) => [p.x, p.y, p.z] as Vec3);
  const L = e.length;
  const n = Math.max(8, Math.min(180, Math.ceil(L / Math.max(tol, 0.05))));
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = e.pointAt(i / n);
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

type P2 = [number, number];
const distSeg = (p: P2, a: P2, b: P2) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const sobre = (p: P2, l: P2[], eps: number) => l.some((a, i) => i > 0 && distSeg(p, l[i - 1], a) <= eps);

/**
 * Remoção de linhas ocultas (HLR) como no replicad, mas separando as arestas vivas das de
 * tangência e de contorno: as emendas das superfícies fechadas (cilindro, cone, esfera), que o
 * OpenCascade devolve como arestas vivas, não entram no desenho.
 */
function linhasDaVista(forma: Shape3D, camera: ProjectionCamera, olho: Vec3, dir: Vec3, tol: number): { visible: Edge[]; hidden: Edge[] } {
  const oc = getOC() as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const algo = new oc.HLRBRep_Algo();
  algo.Add(forma.wrapped, 0);
  const proj = new oc.HLRAlgo_Projector((camera as unknown as { wrapped: unknown }).wrapped);
  algo.Projector(proj);
  algo.Update();
  algo.Hide();
  const hs = new oc.HLRBRep_HLRToShape(algo);
  const arestas = (sh: { IsNull(): boolean }): Edge[] => {
    if (sh.IsNull()) return [];
    const c = cast(sh as never);
    const es = c.edges;
    c.delete();
    for (const e of es) oc.BRepLib.BuildCurves3d(e.wrapped);
    return es;
  };
  // emendas projetadas no plano da vista (x = direita, y = olho × direita)
  const up: Vec3 = [olho[1] * dir[2] - olho[2] * dir[1], olho[2] * dir[0] - olho[0] * dir[2], olho[0] * dir[1] - olho[1] * dir[0]];
  const emendas: P2[][] = [];
  for (const f of forma.faces) {
    for (const e of f.edges) {
      if (oc.BRep_Tool.IsClosed(e.wrapped, f.wrapped)) {
        const pts = pontosDaAresta(e, tol);
        // emenda vista de lado é também o contorno da superfície: essa linha fica
        const n = f.normalAt(pts[Math.floor(pts.length / 2)]);
        const contorno = Math.abs(n.x * olho[0] + n.y * olho[1] + n.z * olho[2]) < 1e-4;
        n.delete();
        if (!contorno) emendas.push(pts.map((p) => [esc(p, dir), esc(p, up)]));
      }
      e.delete();
    }
    f.delete();
  }
  const eps = Math.max(1e-3, tol);
  const semEmendas = (es: Edge[]) => emendas.length ? es.filter((e) => {
    const pl = pontosDaAresta(e, tol).map((p) => [p[0], p[1]] as P2);
    const amostra = [pl[0], pl[Math.floor(pl.length / 2)], pl[pl.length - 1]];
    const emenda = emendas.some((l) => amostra.every((p) => sobre(p, l, eps)));
    if (emenda) e.delete();
    return !emenda;
  }) : es;
  const visible = [...semEmendas(arestas(hs.VCompound())), ...arestas(hs.Rg1LineVCompound()), ...arestas(hs.OutLineVCompound())];
  const hidden = [...semEmendas(arestas(hs.HCompound())), ...arestas(hs.Rg1LineHCompound()), ...arestas(hs.OutLineHCompound())];
  hs.delete();
  proj.delete();
  algo.delete();
  return { visible, hidden };
}

/**
 * Projeta o(s) sólido(s) na direção da vista. `tol` (mm) controla quantos pontos as curvas
 * ganham: use ~ 0,2 mm / escala da vista.
 */
export function projetar(solidosEntrada: Shape3D[], o: Orientacao | { olho: Vec3; direita: Vec3 }, tol = 0.2, corte?: Corte): Projecao {
  const cam = typeof o === "string" ? CAMERAS[o] : o;
  const olho = norm(cam.olho);
  // "para a direita" perpendicular à direção de visão
  let dir = norm(cam.direita);
  dir = norm([dir[0] - olho[0] * esc(dir, olho), dir[1] - olho[1] * esc(dir, olho), dir[2] - olho[2] * esc(dir, olho)]);
  const up: Vec3 = [olho[1] * dir[2] - olho[2] * dir[1], olho[2] * dir[0] - olho[0] * dir[2], olho[0] * dir[1] - olho[1] * dir[0]];
  // vista de seção: cada sólido cortado (cópias, apagadas no fim) e as regiões cortadas no plano da vista
  let cortes: Projecao["cortes"];
  const cortados: Shape3D[] = [];
  let solidos = solidosEntrada;
  if (corte) {
    cortes = [];
    solidos = [];
    solidosEntrada.forEach((s, i) => {
      const r = cortar(s, corte, tol);
      if (!r.forma) return;
      cortados.push(r.forma);
      solidos.push(r.forma);
      for (const f of r.faces) cortes!.push({ i, lacos: f.map((l) => l.map((p) => [esc(p, dir), esc(p, up)] as [number, number])) });
    });
    if (!solidos.length) throw new Error("O plano de corte não passa pelo modelo.");
  }
  // makeCompound apaga as formas que recebe: junta cópias e apaga o composto no fim
  const composto = solidos.length > 1 ? (makeCompound(solidos.map((s) => s.clone())) as unknown as Shape3D) : null;
  // faces da mesma superfície (cilindro em duas metades, planos divididos) viram uma só: sem as
  // arestas de emenda que o desenho não deve mostrar
  const base = composto ?? solidos[0];
  let unida: Shape3D | null = null;
  try {
    unida = base.simplify() as Shape3D;
  } catch {
    unida = null;
  }
  const forma = unida ?? base;
  // câmera em (0,0,0) olhando para −olho (a vista mostra o lado de onde se olha)
  const camera = new ProjectionCamera([0, 0, 0], olho, dir);
  const { visible, hidden } = linhasDaVista(forma, camera, olho, dir, tol);
  camera.delete();
  // as arestas projetadas já vêm no sistema do plano da câmera (x = direita, y = olho × direita)
  const plano = (p: Vec3): [number, number] => [p[0], p[1]];
  const caixa = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const circulos: Projecao["circulos"] = [];
  const conv = (es: Edge[], visivel: boolean) => es.map((e) => {
    const pl = pontosDaAresta(e, tol).map(plano);
    if (visivel) for (const [x, y] of pl) {
      caixa.x0 = Math.min(caixa.x0, x); caixa.y0 = Math.min(caixa.y0, y);
      caixa.x1 = Math.max(caixa.x1, x); caixa.y1 = Math.max(caixa.y1, y);
    }
    if (visivel && e.geomType === "CIRCLE") {
      // círculo inteiro visto de frente: centro e raio (marca de centro, cota de diâmetro)
      const a = pl[0], b = pl[Math.floor(pl.length / 3)], c = pl[Math.floor((2 * pl.length) / 3)];
      const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
      if (Math.abs(d) > 1e-9) {
        const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
        const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
        const r = Math.hypot(a[0] - ux, a[1] - uy);
        // é círculo de verdade na vista (não elipse): todos os pontos à mesma distância
        if (pl.every(([x, y]) => Math.abs(Math.hypot(x - ux, y - uy) - r) < Math.max(1e-3, r * 1e-3)) && !circulos.some((k) => Math.hypot(k.cx - ux, k.cy - uy) < 1e-3 && Math.abs(k.r - r) < 1e-3)) {
          circulos.push({ cx: ux, cy: uy, r });
        }
      }
    }
    return pl;
  });
  const visiveis = conv(visible, true), ocultas = conv(hidden, false);
  for (const e of visible) e.delete();
  for (const e of hidden) e.delete();
  unida?.delete();
  composto?.delete();
  for (const s of cortados) s.delete();
  if (!Number.isFinite(caixa.x0)) Object.assign(caixa, { x0: 0, y0: 0, x1: 0, y1: 0 });
  return { visiveis, ocultas, caixa, circulos, ...(cortes ? { cortes } : {}) };
}

/** Posição + rotação (quatérnio [x, y, z, w]) aplicadas a uma cópia do sólido. */
export function posicionar(s: Shape3D, t: { pos: Vec3; rot: [number, number, number, number] }): Shape3D {
  let r = s.clone() as Shape3D;
  const [x, y, z, w] = t.rot;
  const ang = 2 * Math.acos(Math.max(-1, Math.min(1, w)));
  const sn = Math.sqrt(Math.max(0, 1 - w * w));
  if (ang > 1e-9 && sn > 1e-9) r = r.rotate((ang * 180) / Math.PI, [0, 0, 0], [x / sn, y / sn, z / sn]) as Shape3D;
  if (t.pos.some((v) => Math.abs(v) > 1e-12)) r = r.translate(t.pos[0], t.pos[1], t.pos[2]) as Shape3D;
  return r;
}
