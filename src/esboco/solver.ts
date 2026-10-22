// Ponte entre o esboço do modelo e o solver PlaneGCS (WASM, LGPL — FreeCAD via @salusoft89/planegcs).
// Converte pontos, geometrias e restrições em primitivas do solver, resolve e devolve as posições.
// Também mede a definição do esboço: graus de liberdade, conflitos e quais entidades ainda estão livres.

import { Algorithm, GcsWrapper, init_planegcs_module, SolveStatus } from "@salusoft89/planegcs";
import type { SketchPrimitive } from "@salusoft89/planegcs/dist/sketch/sketch_primitive";
import type { FeatureEsboco, GeoEsboco, RestricaoEsboco } from "../model";
import { ehCota } from "../model";
import { angulosArco, EIXO_H, EIXO_V, extremidades, mapaPontos, ORIGEM, pontosDaGeo } from "./geometria";

export type Definicao = "subdefinido" | "definido" | "superdefinido";

export interface ResultadoSolver {
  ok: boolean;
  gl: number; // graus de liberdade restantes
  conflitantes: string[]; // ids de restrições do modelo
  redundantes: string[];
  definicao: Definicao;
}

/** Arrasto: pontos (ou raios) puxados para uma posição, sem tirar graus de liberdade. */
export interface Arrasto {
  pontos?: { id: string; x: number; y: number }[];
  raios?: { id: string; r: number }[];
}

type Prim = Record<string, unknown> & { id: string; type: string };

/** Tradução de ids do modelo para ids numéricos crescentes (o solver exige referências a ids menores). */
class Ids {
  private mapa = new Map<string, string>();
  private volta = new Map<string, string>();
  private n = 0;
  novo(idModelo: string): string {
    const id = String(++this.n);
    this.mapa.set(idModelo, id);
    this.volta.set(id, idModelo);
    return id;
  }
  /** id auxiliar sem correspondente no modelo (ex.: 2ª equação de uma restrição) */
  aux(idModelo: string): string {
    const id = String(++this.n);
    this.volta.set(id, idModelo);
    return id;
  }
  de(idModelo: string): string {
    const id = this.mapa.get(idModelo);
    if (!id) throw new Error(`Referência inexistente no esboço: ${idModelo}`);
    return id;
  }
  modelo(id: string): string | undefined {
    return this.volta.get(id);
  }
}

export class SolverEsboco {
  private constructor(private w: GcsWrapper) {
    w.set_max_iterations(200);
  }

  /** `locateFile` aponta para o planegcs.wasm (no Vite, use o import `?url`). */
  static async criar(locateFile?: () => string): Promise<SolverEsboco> {
    const mod = await init_planegcs_module(locateFile ? { locateFile } : undefined);
    return new SolverEsboco(new GcsWrapper(new mod.GcsSystem()));
  }

  /** Resolve o esboço e grava as novas posições/raios nele. */
  resolver(esb: FeatureEsboco, arrasto?: Arrasto): ResultadoSolver {
    const { prims, ids } = montar(esb, arrasto);
    const w = this.w;
    w.clear_data();
    silenciar(() => w.push_primitives_and_params(prims as unknown as SketchPrimitive[]));
    const st = silenciar(() => w.solve(Algorithm.DogLeg));
    const ok = st === SolveStatus.Success || st === SolveStatus.Converged;
    if (ok) {
      w.apply_solution();
      gravar(esb, w, ids);
    }
    const conflitantes = unicos(w.get_gcs_conflicting_constraints().map((i) => ids.modelo(i)));
    const redundantes = unicos(w.get_gcs_redundant_constraints().map((i) => ids.modelo(i)));
    const gl = Math.max(0, w.gcs.dof());
    const definicao: Definicao = conflitantes.length || !ok ? "superdefinido" : gl === 0 ? "definido" : "subdefinido";
    return { ok, gl, conflitantes, redundantes, definicao };
  }

  /**
   * Quais pontos e geometrias ainda podem se mover (subdefinidos).
   * Para cada parâmetro, fixa-o provisoriamente e vê se os graus de liberdade caem:
   * se caírem, o parâmetro estava livre. Esboços de tablet são pequenos, então é rápido.
   */
  livres(esb: FeatureEsboco): Set<string> {
    const livres = new Set<string>();
    const base = montar(esb);
    const w = this.w;
    const gl0 = this.glDe(base.prims);
    if (gl0 <= 0) return livres;

    const pts = mapaPontos(esb);
    const usados = new Set(esb.pontos.map((p) => p.id));
    for (const id of usados) {
      const p = pts.get(id)!;
      for (const eixo of ["x", "y"] as const) {
        const extra: Prim = eixo === "x"
          ? { id: "teste", type: "coordinate_x", p_id: base.ids.de(id), x: p.x }
          : { id: "teste", type: "coordinate_y", p_id: base.ids.de(id), y: p.y };
        if (this.glDe([...base.prims, { ...extra, id: String(base.prims.length + 1000) }]) < gl0) {
          livres.add(id);
          break;
        }
      }
    }
    for (const g of esb.geos) {
      if (g.tipo === "circulo" || g.tipo === "arco") {
        const r = g.r;
        const extra: Prim = g.tipo === "circulo"
          ? { id: "x", type: "circle_radius", c_id: base.ids.de(g.id), radius: r }
          : { id: "x", type: "arc_radius", a_id: base.ids.de(g.id), radius: r };
        if (this.glDe([...base.prims, { ...extra, id: String(base.prims.length + 1000) }]) < gl0) livres.add(g.id);
      }
      if (geoPontos(g).some((p) => livres.has(p))) livres.add(g.id);
    }
    w.clear_data();
    return livres;
  }

  private glDe(prims: Prim[]): number {
    const w = this.w;
    w.clear_data();
    silenciar(() => w.push_primitives_and_params(prims as unknown as SketchPrimitive[]));
    silenciar(() => w.solve(Algorithm.DogLeg));
    return w.gcs.dof();
  }
}

function geoPontos(g: GeoEsboco): string[] {
  return pontosDaGeo(g);
}

const unicos = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

/** O PlaneGCS escreve diagnósticos no console; aqui eles só poluiriam. */
function silenciar<T>(f: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return f();
  } finally {
    console.log = log;
  }
}

// ---------- montagem das primitivas ----------

function montar(esb: FeatureEsboco, arrasto?: Arrasto): { prims: Prim[]; ids: Ids } {
  const ids = new Ids();
  const prims: Prim[] = [];
  const pts = mapaPontos(esb);

  // referências implícitas: origem e eixos (fixos)
  prims.push({ id: ids.novo(ORIGEM), type: "point", x: 0, y: 0, fixed: true });
  const ex = ids.aux(EIXO_H), ey = ids.aux(EIXO_V);
  prims.push({ id: ex, type: "point", x: 1, y: 0, fixed: true });
  prims.push({ id: ey, type: "point", x: 0, y: 1, fixed: true });
  prims.push({ id: ids.novo(EIXO_H), type: "line", p1_id: ids.de(ORIGEM), p2_id: ex });
  prims.push({ id: ids.novo(EIXO_V), type: "line", p1_id: ids.de(ORIGEM), p2_id: ey });

  for (const p of esb.pontos) prims.push({ id: ids.novo(p.id), type: "point", x: p.x, y: p.y, fixed: false });

  for (const g of esb.geos) {
    switch (g.tipo) {
      case "linha":
        prims.push({ id: ids.novo(g.id), type: "line", p1_id: ids.de(g.p1), p2_id: ids.de(g.p2) });
        break;
      case "circulo":
        prims.push({ id: ids.novo(g.id), type: "circle", c_id: ids.de(g.c), radius: g.r });
        break;
      case "arco": {
        const [a0, a1] = angulosArco(pts.get(g.c)!, pts.get(g.ini)!, pts.get(g.fim)!);
        const id = ids.novo(g.id);
        prims.push({
          id, type: "arc", c_id: ids.de(g.c), radius: g.r, start_angle: a0, end_angle: a1,
          start_id: ids.de(g.ini), end_id: ids.de(g.fim),
        });
        prims.push({ id: ids.aux(g.id), type: "arc_rules", a_id: id });
        break;
      }
      case "spline":
        break; // só os pontos de passagem entram no solver
    }
  }

  const geos = new Map(esb.geos.map((g) => [g.id, g]));
  const tipoDe = (id: string): "ponto" | GeoEsboco["tipo"] | "eixo" => {
    if (id === EIXO_H || id === EIXO_V) return "eixo";
    const g = geos.get(id);
    return g ? g.tipo : "ponto";
  };
  const centro = (id: string) => {
    const g = geos.get(id);
    return g && (g.tipo === "circulo" || g.tipo === "arco") ? g.c : id;
  };

  const coincidentes = new Set<string>();
  for (const r of esb.restricoes) {
    if (r.tipo === "coincidente") coincidentes.add(`${r.a}|${r.b}`).add(`${r.b}|${r.a}`);
  }

  for (const r of esb.restricoes) {
    if (ehCota(r) && r.referencia) continue;
    try {
      prims.push(...traduzir(r, ids, tipoDe, centro, geos, pts, coincidentes));
    } catch {
      /* restrição com referência apagada: ignorada (o editor limpa essas sobras) */
    }
  }

  for (const a of arrasto?.pontos ?? []) {
    prims.push({ id: ids.aux("arrasto"), type: "coordinate_x", p_id: ids.de(a.id), x: a.x, temporary: true });
    prims.push({ id: ids.aux("arrasto"), type: "coordinate_y", p_id: ids.de(a.id), y: a.y, temporary: true });
  }
  for (const a of arrasto?.raios ?? []) {
    const g = geos.get(a.id)!;
    prims.push(g.tipo === "circulo"
      ? { id: ids.aux("arrasto"), type: "circle_radius", c_id: ids.de(a.id), radius: a.r, temporary: true }
      : { id: ids.aux("arrasto"), type: "arc_radius", a_id: ids.de(a.id), radius: a.r, temporary: true });
  }
  return { prims, ids };
}

/** Ponto de extremidade compartilhado (mesmo id ou ligado por relação coincidente). */
function extremidadeComum(
  a: GeoEsboco | undefined,
  b: GeoEsboco | undefined,
  coincidentes: Set<string>,
): string | null {
  const ea = a && extremidades(a), eb = b && extremidades(b);
  if (!ea || !eb) return null;
  for (const p of ea) for (const q of eb) if (p === q || coincidentes.has(`${p}|${q}`)) return p;
  return null;
}

/** Direção da tangente da curva no ponto (linha: p1→p2; arco: sentido anti-horário). */
function tangenteNoPonto(g: GeoEsboco, p: string, pts: Map<string, { x: number; y: number }>) {
  if (g.tipo === "linha") {
    const a = pts.get(g.p1)!, b = pts.get(g.p2)!;
    return { x: b.x - a.x, y: b.y - a.y };
  }
  if (g.tipo === "arco") {
    const c = pts.get(g.c)!, q = pts.get(p)!;
    return { x: -(q.y - c.y), y: q.x - c.x };
  }
  return { x: 1, y: 0 };
}

function traduzir(
  r: RestricaoEsboco,
  ids: Ids,
  tipoDe: (id: string) => string,
  centro: (id: string) => string,
  geos: Map<string, GeoEsboco>,
  pts: Map<string, { x: number; y: number }>,
  coincidentes: Set<string>,
): Prim[] {
  const P = (tipo: string, campos: Record<string, unknown>, primeira = true): Prim => ({
    id: primeira ? ids.novo(r.id) : ids.aux(r.id),
    type: tipo,
    ...campos,
  });
  const linha = (id: string) => tipoDe(id) === "linha" || tipoDe(id) === "eixo";
  const redondo = (id: string) => tipoDe(id) === "circulo" || tipoDe(id) === "arco";
  const ponto = (id: string) => tipoDe(id) === "ponto";
  const d = (id: string) => ids.de(id);

  switch (r.tipo) {
    case "coincidente": {
      if (ponto(r.a) && ponto(r.b)) return [P("p2p_coincident", { p1_id: d(r.a), p2_id: d(r.b) })];
      const [p, g] = ponto(r.a) ? [r.a, r.b] : [r.b, r.a];
      const t = tipoDe(g);
      if (t === "linha" || t === "eixo") return [P("point_on_line_pl", { p_id: d(p), l_id: d(g) })];
      if (t === "circulo") return [P("point_on_circle", { p_id: d(p), c_id: d(g) })];
      if (t === "arco") return [P("point_on_arc", { p_id: d(p), a_id: d(g) })];
      return [];
    }
    case "horizontal":
    case "vertical": {
      const h = r.tipo === "horizontal";
      if (r.b) return [P(h ? "horizontal_pp" : "vertical_pp", { p1_id: d(r.a), p2_id: d(r.b) })];
      return [P(h ? "horizontal_l" : "vertical_l", { l_id: d(r.a) })];
    }
    case "paralelo":
      return [P("parallel", { l1_id: d(r.a), l2_id: d(r.b) })];
    case "perpendicular":
      return [P("perpendicular_ll", { l1_id: d(r.a), l2_id: d(r.b) })];
    case "colinear": {
      const lb = geos.get(r.b);
      if (!lb || lb.tipo !== "linha") return [];
      return [
        P("point_on_line_pl", { p_id: d(lb.p1), l_id: d(r.a) }),
        P("point_on_line_pl", { p_id: d(lb.p2), l_id: d(r.a) }, false),
      ];
    }
    case "tangente": {
      // Tangência numa extremidade comum (linha→arco, arco→arco): pelo ângulo no ponto, como no
      // FreeCAD. A forma genérica + ponto comum deixa o sistema degenerado (falso conflito).
      const comum = extremidadeComum(geos.get(r.a), geos.get(r.b), coincidentes);
      if (comum) {
        const ta = tangenteNoPonto(geos.get(r.a)!, comum, pts), tb = tangenteNoPonto(geos.get(r.b)!, comum, pts);
        const atual = Math.atan2(ta.x * tb.y - ta.y * tb.x, ta.x * tb.x + ta.y * tb.y);
        const alvo = Math.abs(atual) > Math.PI / 2 ? Math.PI : 0;
        return [P("angle_via_point", { crv1_id: d(r.a), crv2_id: d(r.b), p_id: d(comum), angle: alvo })];
      }
      const [a, b] = linha(r.a) ? [r.a, r.b] : [r.b, r.a];
      const ta = tipoDe(a), tb = tipoDe(b);
      if (linha(a) && tb === "circulo") return [P("tangent_lc", { l_id: d(a), c_id: d(b) })];
      if (linha(a) && tb === "arco") return [P("tangent_la", { l_id: d(a), a_id: d(b) })];
      if (ta === "circulo" && tb === "circulo") return [P("tangent_cc", { c1_id: d(a), c2_id: d(b) })];
      if (ta === "arco" && tb === "arco") return [P("tangent_aa", { a1_id: d(a), a2_id: d(b) })];
      if (ta === "circulo" && tb === "arco") return [P("tangent_ca", { c_id: d(a), a_id: d(b) })];
      if (ta === "arco" && tb === "circulo") return [P("tangent_ca", { c_id: d(b), a_id: d(a) })];
      return [];
    }
    case "igual": {
      if (linha(r.a) && linha(r.b)) return [P("equal_length", { l1_id: d(r.a), l2_id: d(r.b) })];
      const ta = tipoDe(r.a), tb = tipoDe(r.b);
      if (ta === "circulo" && tb === "circulo") return [P("equal_radius_cc", { c1_id: d(r.a), c2_id: d(r.b) })];
      if (ta === "arco" && tb === "arco") return [P("equal_radius_aa", { a1_id: d(r.a), a2_id: d(r.b) })];
      if (ta === "circulo" && tb === "arco") return [P("equal_radius_ca", { c1_id: d(r.a), a2_id: d(r.b) })];
      if (ta === "arco" && tb === "circulo") return [P("equal_radius_ca", { c1_id: d(r.b), a2_id: d(r.a) })];
      return [];
    }
    case "concentrico":
      return [P("p2p_coincident", { p1_id: d(centro(r.a)), p2_id: d(centro(r.b)) })];
    case "pontoMedio": {
      const g = geos.get(r.g);
      if (!g || g.tipo !== "linha") return [];
      return [P("p2p_symmetric_ppp", { p1_id: d(g.p1), p2_id: d(g.p2), p_id: d(r.p) })];
    }
    case "simetrico":
      return [P("p2p_symmetric_ppl", { p1_id: d(r.a), p2_id: d(r.b), l_id: d(r.g) })];
    case "fixo": {
      if (redondo(r.a)) {
        const g = geos.get(r.a)!;
        const c = centro(r.a);
        const out = [
          P("coordinate_x", { p_id: d(c), x: r.x }),
          P("coordinate_y", { p_id: d(c), y: r.y }, false),
        ];
        if (r.r !== undefined) {
          out.push(g.tipo === "circulo"
            ? P("circle_radius", { c_id: d(r.a), radius: r.r }, false)
            : P("arc_radius", { a_id: d(r.a), radius: r.r }, false));
        }
        return out;
      }
      return [P("coordinate_x", { p_id: d(r.a), x: r.x }), P("coordinate_y", { p_id: d(r.a), y: r.y }, false)];
    }

    // ---------- cotas ----------
    case "distancia": {
      if (!r.b) {
        const g = geos.get(r.a);
        if (!g || g.tipo !== "linha") return [];
        return [P("p2p_distance", { p1_id: d(g.p1), p2_id: d(g.p2), distance: r.valor })];
      }
      const a = centro(r.a), b = centro(r.b);
      if (ponto(a) && ponto(b)) return [P("p2p_distance", { p1_id: d(a), p2_id: d(b), distance: r.valor })];
      if (ponto(a) && linha(b)) return [P("p2l_distance", { p_id: d(a), l_id: d(b), distance: r.valor })];
      if (linha(a) && ponto(b)) return [P("p2l_distance", { p_id: d(b), l_id: d(a), distance: r.valor })];
      if (linha(a) && linha(b)) {
        // linhas paralelas: distância de uma extremidade de b até a linha a
        const lb = geos.get(b);
        const p = lb && lb.tipo === "linha" ? lb.p1 : ORIGEM;
        return [P("p2l_distance", { p_id: d(p), l_id: d(a), distance: r.valor })];
      }
      return [];
    }
    case "distanciaH":
    case "distanciaV": {
      const prop = r.tipo === "distanciaH" ? "x" : "y";
      const a = centro(r.a), b = centro(r.b);
      // o sinal segue a posição atual: a cota mede sempre um valor positivo
      const pa = pts.get(a), pb = pts.get(b);
      const sinal = pa && pb && pb[prop] - pa[prop] < 0 ? -1 : 1;
      return [P("difference", {
        param1: { o_id: d(a), prop },
        param2: { o_id: d(b), prop },
        difference: sinal * r.valor,
      })];
    }
    case "raio":
    case "diametro": {
      const t = tipoDe(r.a);
      const dia = r.tipo === "diametro";
      if (t === "circulo") return [P(dia ? "circle_diameter" : "circle_radius", { c_id: d(r.a), [dia ? "diameter" : "radius"]: r.valor })];
      if (t === "arco") return [P(dia ? "arc_diameter" : "arc_radius", { a_id: d(r.a), [dia ? "diameter" : "radius"]: r.valor })];
      return [];
    }
    case "angulo": {
      // mantém o sentido atual (horário/anti-horário) entre as linhas
      const v = (id: string) => {
        if (id === EIXO_H) return { x: 1, y: 0 };
        if (id === EIXO_V) return { x: 0, y: 1 };
        const g = geos.get(id);
        if (!g || g.tipo !== "linha") return null;
        const a = pts.get(g.p1)!, b = pts.get(g.p2)!;
        return { x: b.x - a.x, y: b.y - a.y };
      };
      const va = v(r.a), vb = v(r.b);
      if (!va || !vb) return [];
      const atual = Math.atan2(va.x * vb.y - va.y * vb.x, va.x * vb.x + va.y * vb.y);
      const alvo = (Math.sign(atual) || 1) * (r.valor * Math.PI) / 180;
      return [P("l2l_angle_ll", { l1_id: d(r.a), l2_id: d(r.b), angle: alvo })];
    }
  }
}

function gravar(esb: FeatureEsboco, w: GcsWrapper, ids: Ids) {
  const sol = new Map<string, Record<string, unknown>>();
  for (const p of w.sketch_index.get_primitives()) {
    const m = ids.modelo(p.id);
    // ids auxiliares (ex.: arc_rules) apontam para o mesmo id do modelo: só a geometria interessa
    if (m && ["point", "circle", "arc"].includes(p.type)) sol.set(m, p as unknown as Record<string, unknown>);
  }
  for (const p of esb.pontos) {
    const s = sol.get(p.id);
    if (s && s.type === "point") {
      p.x = s.x as number;
      p.y = s.y as number;
    }
  }
  for (const g of esb.geos) {
    const s = sol.get(g.id);
    if (!s) continue;
    if ((g.tipo === "circulo" && s.type === "circle") || (g.tipo === "arco" && s.type === "arc")) g.r = s.radius as number;
  }
}
