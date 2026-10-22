// Regeneração da peça a partir da árvore de features, usando o kernel B-Rep
// (OpenCascade via replicad). Não depende do navegador: roda no Web Worker e nos testes.
// Campos e comportamento de cada recurso: docs/funcional/features.md.

import {
  draw,
  drawCircle,
  drawPolysides,
  drawRoundedRectangle,
  drawRectangle,
  makeBox,
  measureVolume,
  Plane,
  type Drawing,
  type Edge,
  type Face,
  type Shape3D,
} from "replicad";
import type {
  Condicao, Feature, FeatureEsboco, FeatureExtrusao, FeatureFuro, FeatureNervura, FeatureRevolucao,
  Inclinacao, Perfil, Plano, Referencia, RecursoFino, Vec3,
} from "../model";
import { aninhamento, cadeiaAberta, encontrarLacos, mapaPontos, type Laco, type P2 } from "../esboco/geometria";
import { cruz, eixoXParaNormal, normalizar, paraMundo, referencial, type Referencial } from "../esboco/referencial";
import { medidasFuro } from "./furos";
import {
  acharAresta, acharFace, arestasDosItens, assinaturaAresta, assinaturaFace, ErroReferencia,
  propagarTangente, topologia, type Topologia,
} from "./topologia";

export interface ErroFeature {
  id: string;
  mensagem: string;
}

export interface MalhaPeca {
  vertices: Float32Array;
  normais: Float32Array;
  triangulos: Uint32Array;
  arestas: Float32Array; // pares de pontos (x,y,z) formando segmentos
  /** Faces B-Rep: trincas (início, quantidade, id) em índices de `triangulos`. */
  faces: Uint32Array;
  /** Arestas B-Rep: pares (início, quantidade) em vértices de `arestas` (ordem de `topologia.arestas`). */
  gruposArestas: Uint32Array;
}

export type InfoReferencia =
  | { id: string; tipo: "plano"; ref: Referencial; tamanho: number }
  | { id: string; tipo: "eixo"; origem: Vec3; dir: Vec3; comprimento: number };

export interface ResultadoRegeneracao {
  malha: MalhaPeca | null;
  erros: ErroFeature[];
  volume: number | null; // mm³
  topologia: Topologia | null;
  referencias: InfoReferencia[];
  tempos: { id: string; ms: number }[];
}

// ---------- vetores ----------

const soma3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const esc3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg3 = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

type Sk = { extrude(d: number): Shape3D; revolve(e: Vec3, o: { origin: Vec3; angle: number }): Shape3D };
const noPlano = (d: Drawing, r: Referencial, desloc = 0): Sk =>
  d.sketchOnPlane(new Plane(soma3(r.origem, mul3(r.normal, desloc)), r.x, r.normal)) as unknown as Sk;

// ---------- contexto da regeneração ----------

interface Ferramenta {
  tool: Shape3D;
  op: "adicionar" | "cortar";
}

interface Ctx {
  peca: Shape3D | null;
  esbocos: Map<string, FeatureEsboco>;
  ferramentas: Map<string, Ferramenta[]>;
  planos: Map<string, Referencial>;
  eixos: Map<string, { origem: Vec3; dir: Vec3 }>;
  refsSaida: InfoReferencia[];
}

function novoCtx(): Ctx {
  const planos = new Map<string, Referencial>();
  for (const p of ["XY", "XZ", "YZ"] as Plano[]) planos.set(p, referencial({ tipo: "plano", plano: p, deslocamento: 0 }));
  const eixos = new Map<string, { origem: Vec3; dir: Vec3 }>([
    ["X", { origem: [0, 0, 0], dir: [1, 0, 0] }],
    ["Y", { origem: [0, 0, 0], dir: [0, 1, 0] }],
    ["Z", { origem: [0, 0, 0], dir: [0, 0, 1] }],
  ]);
  return { peca: null, esbocos: new Map(), ferramentas: new Map(), planos, eixos, refsSaida: [] };
}

function exigirPeca(ctx: Ctx, oque = "Este recurso"): Shape3D {
  if (!ctx.peca) throw new Error(`${oque} precisa de um sólido antes dele na árvore.`);
  return ctx.peca;
}

function aplicar(ctx: Ctx, id: string, ferramentas: Ferramenta[]) {
  for (const f of ferramentas) {
    if (f.op === "adicionar") ctx.peca = ctx.peca ? ctx.peca.fuse(f.tool) : f.tool;
    else ctx.peca = exigirPeca(ctx, "O corte").cut(f.tool);
  }
  ctx.ferramentas.set(id, ferramentas);
}

function caixa(ctx: Ctx): { min: Vec3; max: Vec3; diag: number } | null {
  if (!ctx.peca) return null;
  const b = ctx.peca.boundingBox.bounds as [Vec3, Vec3];
  return { min: b[0], max: b[1], diag: Math.hypot(...sub3(b[1], b[0])) };
}

// ---------- resolução de referências ----------

function planoDeRef(ref: Referencia | undefined, ctx: Ctx): Referencial {
  if (!ref) throw new Error("Escolha um plano ou uma face plana.");
  if (ref.tipo === "plano") {
    const r = ctx.planos.get(ref.id);
    if (!r) throw new ErroReferencia("Plano de referência não encontrado (excluído ou depois deste recurso).");
    return r;
  }
  if (ref.tipo === "face") {
    const f = acharFace(exigirPeca(ctx), ref.ass);
    const a = assinaturaFace(f);
    if (a.geom !== "plano" || !a.normal) throw new Error("A face escolhida não é plana.");
    const x = eixoXParaNormal(a.normal);
    return { origem: a.centro, normal: a.normal, x, y: cruz(a.normal, x) };
  }
  throw new Error("A referência escolhida não é um plano.");
}

function eixoDeRef(ref: Referencia | undefined, ctx: Ctx): { origem: Vec3; dir: Vec3 } {
  if (!ref) throw new Error("Escolha um eixo, aresta ou linha.");
  switch (ref.tipo) {
    case "eixo": {
      const e = ctx.eixos.get(ref.id);
      if (!e) throw new ErroReferencia("Eixo de referência não encontrado.");
      return e;
    }
    case "aresta": {
      const a = assinaturaAresta(acharAresta(exigirPeca(ctx), ref.ass));
      if (a.geom === "circulo" && a.centro && a.eixo) return { origem: a.centro, dir: a.eixo };
      return { origem: a.a, dir: normalizar(sub3(a.b, a.a)) };
    }
    case "face": {
      const a = assinaturaFace(acharFace(exigirPeca(ctx), ref.ass));
      if (a.eixo && a.pontoEixo) return { origem: a.pontoEixo, dir: a.eixo };
      if (a.normal) return { origem: a.centro, dir: a.normal };
      throw new Error("Essa face não define um eixo.");
    }
    case "plano": {
      const r = planoDeRef(ref, ctx);
      return { origem: r.origem, dir: r.normal };
    }
    case "linhaEsboco": {
      const esb = ctx.esbocos.get(ref.esboco);
      const g = esb?.geos.find((x) => x.id === ref.geo);
      if (!esb || !g || g.tipo !== "linha") throw new ErroReferencia("Linha do esboço não encontrada.");
      const r = referencial(esb.suporte, ctx.planos);
      const pts = mapaPontos(esb);
      const a = paraMundo(r, pts.get(g.p1)!.x, pts.get(g.p1)!.y);
      const b = paraMundo(r, pts.get(g.p2)!.x, pts.get(g.p2)!.y);
      return { origem: a, dir: normalizar(sub3(b, a)) };
    }
    default:
      throw new Error("A referência escolhida não define uma direção.");
  }
}

function pontoDeRef(ref: Referencia | undefined, ctx: Ctx): Vec3 {
  if (!ref) throw new Error("Escolha um vértice.");
  if (ref.tipo === "vertice") return ref.p;
  if (ref.tipo === "aresta") {
    const a = assinaturaAresta(acharAresta(exigirPeca(ctx), ref.ass));
    return a.centro ?? a.meio;
  }
  throw new Error("A referência escolhida não é um vértice.");
}

function esbocoDe(id: string | undefined, ctx: Ctx): FeatureEsboco {
  const e = id ? ctx.esbocos.get(id) : undefined;
  if (!e) throw new Error("Escolha um esboço (ele precisa vir antes deste recurso e não estar suprimido).");
  return e;
}

// ---------- perfis ----------

function desenharPerfil(p: Perfil): Drawing {
  switch (p.tipo) {
    case "retangulo":
      return p.raioCanto > 0 ? drawRoundedRectangle(p.largura, p.altura, p.raioCanto) : drawRectangle(p.largura, p.altura);
    case "circulo":
      return drawCircle(p.diametro / 2);
    case "poligono":
      return drawPolysides(p.diametro / 2, Math.max(3, Math.round(p.lados)));
  }
}

function desenhoDoLaco(l: Laco): Drawing {
  if (l.tipo === "circulo") return drawCircle(l.r).translate(l.c.x, l.c.y);
  const ts = l.trechos;
  const ini = ts[0].a;
  const pen = draw([ini.x, ini.y]);
  ts.forEach((t, i) => {
    // o último trecho termina exatamente no início (pontos coincidentes podem diferir no 1e-9)
    const b = i === ts.length - 1 ? ini : t.b;
    if (t.tipo === "linha") pen.lineTo([b.x, b.y]);
    else if (t.tipo === "arco") pen.threePointsArcTo([b.x, b.y], [t.meio.x, t.meio.y]);
    else pen.cubicBezierCurveTo([b.x, b.y], [t.c1.x, t.c1.y], [t.c2.x, t.c2.y]);
  });
  return pen.close();
}

/** Contornos do esboço → região plana: externos somam, internos viram furos (ilhas voltam a somar). */
export function desenhoDoEsboco(esb: FeatureEsboco, contornos?: (string | number)[]): Drawing {
  let lacos = encontrarLacos(esb);
  if (contornos?.length) lacos = lacos.filter((_, i) => contornos.map(Number).includes(i));
  if (!lacos.length) throw new Error("Nenhum contorno selecionado.");
  const prof = aninhamento(lacos);
  let res: Drawing | null = null;
  const niveis = [...new Set(prof)].sort((a, b) => a - b);
  for (const n of niveis) {
    lacos.forEach((l, i) => {
      if (prof[i] !== n) return;
      const d = desenhoDoLaco(l);
      res = n % 2 === 0 ? (res ? res.fuse(d) : d) : res!.cut(d);
    });
  }
  return res!;
}

function poligonoDesenho(pts: P2[]): Drawing {
  const pen = draw([pts[0].x, pts[0].y]);
  for (const p of pts.slice(1)) pen.lineTo([p.x, p.y]);
  return pen.close();
}

/** Desloca uma polilinha aberta para a esquerda (d > 0) ou direita, com cantos em meia-esquadria. */
function deslocarPolilinha(pl: P2[], d: number): P2[] {
  const n = (a: P2, b: P2) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
  };
  return pl.map((p, i) => {
    const n1 = i > 0 ? n(pl[i - 1], p) : n(p, pl[i + 1]);
    const n2 = i < pl.length - 1 ? n(p, pl[i + 1]) : n1;
    const m = { x: n1.x + n2.x, y: n1.y + n2.y };
    const lm = Math.hypot(m.x, m.y) || 1;
    const cos = Math.max(0.2, (m.x * n1.x + m.y * n1.y) / lm);
    return { x: p.x + (m.x / lm) * (d / cos), y: p.y + (m.y / lm) * (d / cos) };
  });
}

/** Região do recurso fino: anel em contorno fechado, faixa em perfil aberto. */
function desenhoFino(esb: FeatureEsboco | null, base: Drawing | null, fino: RecursoFino, contornos?: (string | number)[]): Drawing {
  const [fora, dentro] =
    fino.tipo === "uma" ? (fino.inverter ? [0, fino.t1] : [fino.t1, 0])
    : fino.tipo === "medio" ? [fino.t1 / 2, fino.t1 / 2]
    : [fino.t1, fino.t2];
  if (fora < 0 || dentro < 0 || fora + dentro <= 0) throw new Error("Espessura do recurso fino deve ser positiva.");
  let fechado: Drawing | null = base;
  if (!fechado && esb) {
    try {
      fechado = desenhoDoEsboco(esb, contornos);
    } catch {
      fechado = null;
    }
  }
  if (fechado) {
    const ext = fora > 0 ? fechado.offset(fora, { lineJoinType: "miter" }) : fechado;
    return dentro > 0 ? ext.cut(fechado.offset(-dentro, { lineJoinType: "miter" })) : ext.cut(fechado);
  }
  const pl = esb && cadeiaAberta(esb);
  if (!pl) throw new Error("O esboço não tem contorno fechado nem um perfil aberto contínuo.");
  // perfil aberto: esquerda = "fora"
  const esq = deslocarPolilinha(pl, fora);
  const dir = deslocarPolilinha(pl, -dentro);
  return poligonoDesenho([...esq, ...dir.reverse()]);
}

// ---------- raio contra a malha (até o próximo) ----------

function cortesDoRaio(peca: Shape3D, o: Vec3, d: Vec3): number[] {
  const m = peca.mesh({ tolerance: 0.2, angularTolerance: 20 });
  const v = m.vertices, t = m.triangles;
  const out: number[] = [];
  for (let i = 0; i < t.length; i += 3) {
    const a: Vec3 = [v[t[i] * 3], v[t[i] * 3 + 1], v[t[i] * 3 + 2]];
    const b: Vec3 = [v[t[i + 1] * 3], v[t[i + 1] * 3 + 1], v[t[i + 1] * 3 + 2]];
    const c: Vec3 = [v[t[i + 2] * 3], v[t[i + 2] * 3 + 1], v[t[i + 2] * 3 + 2]];
    const e1 = sub3(b, a), e2 = sub3(c, a);
    const p = cruz(d, e2);
    const det = esc3(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub3(o, a);
    const u = esc3(s, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cruz(s, e1);
    const w = esc3(d, q) / det;
    if (w < 0 || u + w > 1) continue;
    const tt = esc3(e2, q) / det;
    if (tt > 1e-6) out.push(tt);
  }
  out.sort((x, y) => x - y);
  // descarta repetidos (raio passando em aresta compartilhada por dois triângulos)
  return out.filter((x, i) => i === 0 || x - out[i - 1] > 1e-6);
}

// ---------- extrusão ----------

interface Limite {
  comp: number;
  /** Plano que apara o prisma (até a superfície não paralela ao esboço). */
  aparar?: Referencial;
}

function semiespaco(p: Referencial, ladoPonto: Vec3, tam: number): Shape3D {
  const lado = Math.sign(esc3(sub3(ladoPonto, p.origem), p.normal)) || 1;
  return noPlano(drawRectangle(4 * tam, 4 * tam), p).extrude(lado * 2 * tam);
}

function limiteDa(
  c: Condicao, o: Vec3, d: Vec3, ctx: Ctx, op: "adicionar" | "cortar", centroPerfil: Vec3,
): Limite {
  const cx = caixa(ctx);
  switch (c.tipo) {
    case "cego":
    case "planoMedio":
      if (!(c.dist > 0)) throw new Error("A profundidade deve ser maior que zero.");
      return { comp: c.dist };
    case "passante":
    case "passanteAmbos": {
      if (!cx) throw new Error("Passante precisa de um sólido para atravessar.");
      let m = 0;
      for (const x of [cx.min[0], cx.max[0]]) for (const y of [cx.min[1], cx.max[1]]) for (const z of [cx.min[2], cx.max[2]]) {
        m = Math.max(m, esc3(sub3([x, y, z], o), d));
      }
      if (m <= 1e-6) throw new Error("Não há material nesse sentido: inverta a direção.");
      return { comp: m + 1 };
    }
    case "vertice": {
      const t = esc3(sub3(pontoDeRef(c.ref, ctx), o), d);
      if (t <= 1e-6) throw new Error("O vértice está do outro lado: inverta a direção.");
      return { comp: t };
    }
    case "superficie":
    case "deslocSuperficie": {
      let p = planoDeRef(c.ref, ctx);
      if (c.tipo === "deslocSuperficie") {
        const s = (c.inverterDesloc ? -1 : 1) * c.dist;
        p = { ...p, origem: soma3(p.origem, mul3(p.normal, s)) };
      }
      const dn = esc3(d, p.normal);
      if (Math.abs(dn) < 1e-9) throw new Error("A superfície é paralela à direção da extrusão.");
      const t = esc3(sub3(p.origem, o), p.normal) / dn;
      if (Math.abs(Math.abs(dn) - 1) < 1e-6) {
        if (t <= 1e-6) throw new Error("A superfície está do outro lado: inverta a direção.");
        return { comp: t };
      }
      // plano inclinado: extrude além dele e apara
      return { comp: Math.max(Math.abs(t), cx?.diag ?? 0) * 2 + 10, aparar: p };
    }
    case "proximo": {
      const peca = exigirPeca(ctx, "Até o próximo");
      const hits = cortesDoRaio(peca, centroPerfil, d);
      if (!hits.length) throw new Error("Nada à frente do perfil: inverta a direção.");
      // corte: atravessa o primeiro trecho de material; ressalto: vai até tocar a peça
      const dentro = hits.length % 2 === 1;
      const t = op === "cortar" ? (dentro ? hits[0] : hits[1] ?? hits[0]) : hits[0];
      return { comp: t };
    }
  }
}

function aplicarInclinacao(tool: Shape3D, inc: Inclinacao | undefined, r: Referencial, inicio: Vec3, d: Vec3): Shape3D {
  if (!inc?.ativa || !inc.angulo) return tool;
  const neutro = new Plane(inicio, r.x, d);
  const ang = inc.paraFora ? -inc.angulo : inc.angulo;
  type Ff = { not(f: (g: Ff) => Ff): Ff; parallelTo(p: Plane): Ff };
  return tool.draft(ang, (f) => (f as unknown as Ff).not((g) => g.parallelTo(neutro)) as never, neutro);
}

function prismaDirecao(
  D: Drawing, r: Referencial, s0: number, sentido: 1 | -1, cond: Condicao, inc: Inclinacao | undefined,
  ctx: Ctx, op: "adicionar" | "cortar", centro2: P2,
): Shape3D {
  const d = mul3(r.normal, sentido);
  const inicio = soma3(r.origem, mul3(r.normal, s0));
  const centro = paraMundo({ ...r, origem: inicio }, centro2.x, centro2.y);
  if (cond.tipo === "planoMedio") {
    const t = noPlano(D, r, s0 - cond.dist / 2).extrude(cond.dist);
    return aplicarInclinacao(t, inc, r, inicio, d);
  }
  const lim = limiteDa(cond, inicio, d, ctx, op, centro);
  let t = noPlano(D, r, s0).extrude(sentido * lim.comp);
  t = aplicarInclinacao(t, inc, r, inicio, d);
  if (lim.aparar) t = t.intersect(semiespaco(lim.aparar, inicio, lim.comp));
  return t;
}

function centroDoDesenho(D: Drawing): P2 {
  const b = (D as unknown as { boundingBox: { center: [number, number] } }).boundingBox;
  return { x: b.center[0], y: b.center[1] };
}

function extrusao(f: FeatureExtrusao, ctx: Ctx): Ferramenta[] {
  let r: Referencial;
  let D: Drawing;
  let esb: FeatureEsboco | null = null;
  if (f.esboco) {
    esb = esbocoDe(f.esboco, ctx);
    r = referencial(esb.suporte, ctx.planos);
  } else {
    r = referencial({ tipo: "plano", plano: f.plano, deslocamento: f.deslocamento });
  }
  const base = esb ? null : desenharPerfil(f.perfil).translate(f.centroU, f.centroV);
  if (f.fino?.ativo) D = desenhoFino(esb, base, f.fino, f.contornos);
  else D = base ?? desenhoDoEsboco(esb!, f.contornos);

  // corte com lado invertido: remove tudo o que está fora do perfil
  if (f.operacao === "cortar" && f.inverterLadoCorte) {
    const cx = caixa(ctx);
    const L = (cx?.diag ?? 100) * 4;
    D = drawRectangle(L, L).cut(D);
  }

  // início
  let s0 = 0;
  const de = f.de ?? { tipo: "plano", dist: 0, inverter: false };
  if (de.tipo === "deslocamento") s0 = (de.inverter ? -1 : 1) * de.dist;
  else if (de.tipo === "superficie") {
    const p = planoDeRef(de.ref, ctx);
    if (Math.abs(Math.abs(esc3(p.normal, r.normal)) - 1) > 1e-6) throw new Error("O início deve ser paralelo ao plano do esboço.");
    s0 = esc3(sub3(p.origem, r.origem), r.normal);
  } else if (de.tipo === "vertice") s0 = esc3(sub3(pontoDeRef(de.ref, ctx), r.origem), r.normal);

  const sentido: 1 | -1 = f.inverter ? -1 : 1;
  // a profundidade da direção 1 (cego/plano médio) é sempre `profundidade`;
  // condicao.dist fica para o deslocamento em "deslocamento da superfície"
  const cond: Condicao = { ...(f.condicao ?? { tipo: "cego", dist: 0 }) };
  if (cond.tipo === "cego" || cond.tipo === "planoMedio") cond.dist = Math.abs(f.profundidade);
  if (f.profundidade < 0) throw new Error("Use \"Inverter direção\" em vez de profundidade negativa.");
  const centro2 = centroDoDesenho(D);
  let tool: Shape3D;
  if (cond.tipo === "passanteAmbos") {
    // um dos lados pode não ter material (perfil numa face da peça): usa só o que existir
    const lados = ([1, -1] as const).flatMap((sg) => {
      try {
        return [prismaDirecao(D, r, s0, sg, { ...cond, tipo: "passante" }, f.inclinacao, ctx, f.operacao, centro2)];
      } catch {
        return [];
      }
    });
    if (!lados.length) throw new Error("Não há material para atravessar.");
    tool = lados.length === 2 ? lados[0].fuse(lados[1]) : lados[0];
  } else {
    tool = prismaDirecao(D, r, s0, sentido, cond, f.inclinacao, ctx, f.operacao, centro2);
    if (f.direcao2?.ativa && cond.tipo !== "planoMedio") {
      const t2 = prismaDirecao(D, r, s0, sentido === 1 ? -1 : 1, f.direcao2.condicao, f.direcao2.inclinacao, ctx, f.operacao, centro2);
      tool = tool.fuse(t2);
    }
  }
  return [{ tool, op: f.operacao }];
}

// ---------- revolução ----------

function revolucao(f: FeatureRevolucao, ctx: Ctx): Ferramenta[] {
  if (!f.esboco) return [{ tool: revolucaoRapida(f), op: f.operacao }];
  const esb = esbocoDe(f.esboco, ctx);
  const r = referencial(esb.suporte, ctx.planos);
  let eixo: { origem: Vec3; dir: Vec3 };
  if (f.eixo) eixo = eixoDeRef(f.eixo, ctx);
  else {
    // sem eixo escolhido: 1ª linha de construção do esboço; sem ela, o eixo V do esboço
    const pts = mapaPontos(esb);
    const lc = esb.geos.find((g) => g.tipo === "linha" && g.construcao);
    if (lc && lc.tipo === "linha") {
      const a = paraMundo(r, pts.get(lc.p1)!.x, pts.get(lc.p1)!.y);
      const b = paraMundo(r, pts.get(lc.p2)!.x, pts.get(lc.p2)!.y);
      eixo = { origem: a, dir: normalizar(sub3(b, a)) };
    } else eixo = { origem: r.origem, dir: r.y };
  }
  const D = f.fino?.ativo ? desenhoFino(esb, null, f.fino, f.contornos) : desenhoDoEsboco(esb, f.contornos);
  const sk = () => noPlano(D, r);
  const ang = Math.min(360, Math.max(0.1, f.angulo));
  const sentido = f.inverter ? -1 : 1;
  let tool = sk().revolve(mul3(eixo.dir, sentido), { origin: eixo.origem, angle: ang });
  if (f.planoMedio && ang < 360) tool = tool.rotate((-sentido * ang) / 2, eixo.origem, eixo.dir);
  else if (f.direcao2?.ativa && ang < 360 && f.direcao2.angulo > 0) {
    const t2 = sk().revolve(mul3(eixo.dir, -sentido), { origin: eixo.origem, angle: Math.min(360 - ang, f.direcao2.angulo) });
    tool = tool.fuse(t2);
  }
  return [{ tool, op: f.operacao }];
}

function revolucaoRapida(f: FeatureRevolucao): Shape3D {
  if (f.largura <= 0 || f.altura <= 0) throw new Error("Largura e altura devem ser positivas.");
  if (f.raioInterno < 0) throw new Error("O perfil não pode cruzar o eixo.");
  const desenho = drawRectangle(f.largura, f.altura).translate(f.raioInterno + f.largura / 2, f.altura / 2);
  const esboco = desenho.sketchOnPlane(f.plano) as unknown as Sk;
  const eixo: Vec3 = f.plano === "XY" ? [0, 1, 0] : [0, 0, 1];
  return esboco.revolve(eixo, { origin: [0, 0, 0], angle: Math.min(360, Math.max(1, f.angulo)) });
}

// ---------- nervura ----------

function nervura(f: FeatureNervura, ctx: Ctx): Ferramenta[] {
  const peca = exigirPeca(ctx, "A nervura");
  const esb = esbocoDe(f.esboco, ctx);
  const r = referencial(esb.suporte, ctx.planos);
  const pl = cadeiaAberta(esb);
  if (!pl || pl.length < 2) throw new Error("A nervura precisa de um esboço aberto (linha ou arcos encadeados).");
  if (!(f.espessura > 0)) throw new Error("Espessura deve ser positiva.");
  const cx = caixa(ctx)!;
  const L = cx.diag * 2 + 10;
  const t = f.espessura;
  const [s0, comp] = f.lado === "ambos" ? [-t / 2, t] : f.lado === "primeiro" ? [0, t] : [-t, t];
  let tool: Shape3D;
  if (f.direcao === "normal") {
    // região no plano: do perfil até o material, limitada pela caixa da peça; espessura na normal
    const a = pl[0], b = pl[pl.length - 1];
    const ul = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / ul, y: (b.y - a.y) / ul };
    // lado do material: o lado em que um raio a partir do meio do perfil encontra a peça primeiro
    let m = { x: -u.y, y: u.x };
    const meio = pl[Math.floor(pl.length / 2)];
    const o3 = paraMundo(r, meio.x, meio.y);
    const dir3 = (v: P2): Vec3 => normalizar(soma3(mul3(r.x, v.x), mul3(r.y, v.y)));
    const hA = cortesDoRaio(peca, o3, dir3(m))[0] ?? Infinity;
    const hB = cortesDoRaio(peca, o3, dir3({ x: -m.x, y: -m.y }))[0] ?? Infinity;
    if (hB < hA) m = { x: -m.x, y: -m.y };
    if (f.inverterMaterial) m = { x: -m.x, y: -m.y };
    const poli: P2[] = [
      { x: a.x - u.x * L, y: a.y - u.y * L },
      ...pl,
      { x: b.x + u.x * L, y: b.y + u.y * L },
      { x: b.x + u.x * L + m.x * L, y: b.y + u.y * L + m.y * L },
      { x: a.x - u.x * L + m.x * L, y: a.y - u.y * L + m.y * L },
    ];
    tool = noPlano(poligonoDesenho(poli), r, s0).extrude(comp);
  } else {
    // espessura no plano; extrusão na normal do esboço até atravessar a peça
    const faixa = poligonoDesenho([...deslocarPolilinha(pl, t / 2), ...deslocarPolilinha(pl, -t / 2).reverse()]);
    tool = noPlano(faixa, r).extrude((f.inverterMaterial ? -1 : 1) * L);
  }
  tool = tool.intersect(makeBox(cx.min, cx.max));
  return [{ tool, op: "adicionar" }];
}

// ---------- furo assistido ----------

function furo(f: FeatureFuro, ctx: Ctx): Ferramenta[] {
  const peca = exigirPeca(ctx, "O furo");
  const esb = esbocoDe(f.esboco, ctx);
  const r = referencial(esb.suporte, ctx.planos);
  const pts = mapaPontos(esb);
  const posicoes = esb.geos.filter((g) => g.tipo === "ponto" && !g.construcao).map((g) => g.tipo === "ponto" ? pts.get(g.p)! : null).filter((p): p is P2 => !!p);
  if (!posicoes.length) throw new Error("Posicione os furos: aba Posições → toque na face para cada furo.");
  const m = medidasFuro(f);
  const cx = caixa(ctx)!;
  const baixo = neg3(r.normal); // furo entra contra a normal da face
  let tool: Shape3D | null = null;
  for (const q of posicoes) {
    const o = paraMundo(r, q.x, q.y);
    let prof: number;
    let ponta = true;
    if (f.condicao.tipo === "passante") {
      prof = cx.diag + 2;
      ponta = false;
    } else if (f.condicao.tipo === "proximo") {
      const hits = cortesDoRaio(peca, soma3(o, mul3(r.normal, 1e-3)), baixo);
      prof = (hits.length % 2 === 1 ? hits[0] : hits[1] ?? hits[0] ?? 10) + 0.01;
      ponta = false;
    } else prof = f.condicao.profundidade;
    if (!(prof > 0)) throw new Error("Profundidade do furo deve ser positiva.");
    // meio perfil (x = raio, y = profundidade para dentro), revolvido no eixo do furo
    const rr = m.diametro / 2;
    const perfil: P2[] = [{ x: 0, y: -0.05 }];
    const topo = (x: number) => perfil.push({ x, y: -0.05 });
    if (f.tipoFuro === "rebaixado") {
      topo(m.diamRebaixo / 2);
      perfil.push({ x: m.diamRebaixo / 2, y: m.profRebaixo }, { x: rr, y: m.profRebaixo });
    } else if (f.tipoFuro === "escareado" || f.escareadoProximo?.ativo) {
      const de = f.tipoFuro === "escareado" ? m.diamEscareado : f.escareadoProximo!.diametro;
      const ang = f.tipoFuro === "escareado" ? m.anguloEscareado : f.escareadoProximo!.angulo;
      topo(de / 2);
      perfil.push({ x: rr, y: (de / 2 - rr) / Math.tan(((ang / 2) * Math.PI) / 180) });
    } else topo(rr);
    perfil.push({ x: rr, y: prof });
    if (ponta) perfil.push({ x: 0, y: prof + rr / Math.tan(((f.condicao.anguloPonta / 2) * Math.PI) / 180) });
    else perfil.push({ x: 0, y: prof });
    const ux = r.x;
    const n = cruz(ux, baixo);
    const plano = new Plane(o, ux, n);
    const sk = poligonoDesenho(perfil).sketchOnPlane(plano) as unknown as Sk;
    const t = sk.revolve(baixo, { origin: o, angle: 360 });
    tool = tool ? tool.fuse(t) : t;
  }
  return [{ tool: tool!, op: "cortar" }];
}

// ---------- padrões e espelho ----------

function ferramentasDe(ids: string[], ctx: Ctx): Ferramenta[] {
  if (!ids.length) throw new Error("Escolha os recursos a repetir.");
  const out: Ferramenta[] = [];
  for (const id of ids) {
    const f = ctx.ferramentas.get(id);
    if (!f) throw new Error("Só extrusões, revoluções, cortes, furos, nervuras e outros padrões podem ser repetidos.");
    out.push(...f);
  }
  return out;
}

function juntar(fs: Ferramenta[]): Ferramenta[] {
  // une ferramentas da mesma operação (uma booleana só na peça)
  const out: Ferramenta[] = [];
  for (const op of ["adicionar", "cortar"] as const) {
    const ts = fs.filter((f) => f.op === op).map((f) => f.tool);
    if (ts.length) out.push({ op, tool: ts.slice(1).reduce((a, b) => a.fuse(b), ts[0]) });
  }
  return out;
}

// ---------- regeneração ----------

export function regenerar(features: Feature[], tolerancia = 0.05): ResultadoRegeneracao {
  const erros: ErroFeature[] = [];
  const tempos: { id: string; ms: number }[] = [];
  const ctx = novoCtx();

  for (const f of features) {
    if (f.suprimida) continue;
    const t0 = performance.now();
    try {
      regenerarFeature(f, ctx);
    } catch (e) {
      // A feature com falha é ignorada e a regeneração continua com a peça anterior,
      // como um CAD faz ao marcar a feature em vermelho na árvore.
      erros.push({ id: f.id, mensagem: traduzirErro(e) });
    }
    tempos.push({ id: f.id, ms: performance.now() - t0 });
  }

  // referências para a interface desenhar
  const tam = (caixa(ctx)?.diag ?? 100) * 0.6;
  for (const ri of ctx.refsSaida) {
    if (ri.tipo === "plano") ri.tamanho = Math.max(30, tam);
    else ri.comprimento = Math.max(40, tam * 1.4);
  }

  const peca = ctx.peca;
  ultimaPeca = peca;
  if (!peca) return { malha: null, erros, volume: null, topologia: null, referencias: ctx.refsSaida, tempos };

  const m = peca.mesh({ tolerance: tolerancia, angularTolerance: 15 });
  const a = peca.meshEdges({ tolerance: tolerancia, angularTolerance: 15 });
  let volume: number | null = null;
  try {
    volume = measureVolume(peca);
  } catch {
    volume = null;
  }
  return {
    malha: {
      vertices: Float32Array.from(m.vertices),
      normais: Float32Array.from(m.normals),
      triangulos: Uint32Array.from(m.triangles),
      arestas: Float32Array.from(a.lines),
      faces: Uint32Array.from(m.faceGroups.flatMap((g) => [g.start, g.count, g.faceId >>> 0])),
      gruposArestas: Uint32Array.from(a.edgeGroups.flatMap((g) => [g.start, g.count])),
    },
    erros,
    volume,
    topologia: topologia(peca).topo,
    referencias: ctx.refsSaida,
    tempos,
  };
}

function regenerarFeature(f: Feature, ctx: Ctx) {
  switch (f.tipo) {
    case "esboco":
      // não gera sólido; fica disponível para as features seguintes
      referencial(f.suporte, ctx.planos);
      ctx.esbocos.set(f.id, f);
      return;
    case "extrusao":
      return aplicar(ctx, f.id, extrusao(f, ctx));
    case "revolucao":
      return aplicar(ctx, f.id, revolucao(f, ctx));
    case "nervura":
      return aplicar(ctx, f.id, nervura(f, ctx));
    case "furo":
      return aplicar(ctx, f.id, furo(f, ctx));

    case "filete": {
      const peca = exigirPeca(ctx, "O filete");
      if (!(f.raio > 0)) throw new Error("Raio deve ser positivo.");
      if (!f.itens?.length) throw new Error("Selecione as arestas (ou faces) a filetar.");
      let arestas = arestasDosItens(peca, f.itens);
      // raio por item (múltiplos raios): arestas vindas de cada item
      const raioDe = new Map<Edge, number>();
      f.itens.forEach((it, i) => {
        const r = f.multiplosRaios ? f.raios?.[i] ?? f.raio : f.raio;
        for (const e of arestasDosItens(peca, [it])) raioDe.set(e, r);
      });
      if (f.propagarTangente) arestas = propagarTangente(peca, arestas);
      const raio = (e: Edge) => {
        for (const [k, r] of raioDe) if (k.isSame(e)) return r;
        return f.raio;
      };
      ctx.peca = peca.fillet((e) => {
        if (!arestas.some((x) => x.isSame(e))) return null;
        return f.assimetrico ? [raio(e), f.raio2 ?? raio(e)] : raio(e);
      });
      return;
    }

    case "chanfro": {
      const peca = exigirPeca(ctx, "O chanfro");
      if (!(f.distancia > 0)) throw new Error("Distância deve ser positiva.");
      if (!f.itens?.length) throw new Error("Selecione as arestas (ou faces) a chanfrar.");
      let arestas = arestasDosItens(peca, f.itens);
      if (f.propagarTangente) arestas = propagarTangente(peca, arestas);
      const faceDe = (e: Edge): Face => {
        const adj = peca.faces.filter((fc) => fc.edges.some((x) => x.isSame(e)));
        return adj[f.inverter ? 1 : 0] ?? adj[0];
      };
      type Ff = { inList(l: Face[]): Ff };
      ctx.peca = peca.chamfer((e) => {
        if (!arestas.some((x) => x.isSame(e))) return null;
        const face = faceDe(e);
        const sel = (fi: unknown) => (fi as Ff).inList([face]) as never;
        if (f.modo === "anguloDistancia") return { distance: f.distancia, angle: f.angulo ?? 45, selectedFace: sel };
        if (f.assimetrico) return { distances: [f.distancia, f.distancia2 ?? f.distancia], selectedFace: sel };
        return f.distancia;
      });
      return;
    }

    case "casca": {
      const peca = exigirPeca(ctx, "A casca");
      if (!(f.espessura > 0)) throw new Error("Espessura deve ser positiva.");
      const faces = f.faces.map((r) => {
        if (r.tipo !== "face") throw new Error("Selecione faces.");
        return acharFace(peca, r.ass);
      });
      type Ff = { inList(l: Face[]): Ff };
      const t = f.paraFora ? -f.espessura : f.espessura;
      ctx.peca = peca.shell(t, (fi) => (fi as unknown as Ff).inList(faces) as never);
      return;
    }

    case "inclinacao": {
      const peca = exigirPeca(ctx, "A inclinação");
      if (!f.faces.length) throw new Error("Selecione as faces a inclinar.");
      const p = planoDeRef(f.planoNeutro, ctx);
      const faces = f.faces.map((r) => {
        if (r.tipo !== "face") throw new Error("Selecione faces.");
        return acharFace(peca, r.ass);
      });
      const n = f.inverter ? neg3(p.normal) : p.normal;
      type Ff = { inList(l: Face[]): Ff };
      ctx.peca = peca.draft(f.angulo, (fi) => (fi as unknown as Ff).inList(faces) as never, new Plane(p.origem, p.x, n));
      return;
    }

    case "padraoLinear": {
      const base = ferramentasDe(f.recursos, ctx);
      const d1 = mul3(eixoDeRef(f.dir1.ref, ctx).dir, f.dir1.inverter ? -1 : 1);
      const n1 = Math.max(1, Math.round(f.dir1.instancias));
      const usa2 = !!f.dir2?.ativa;
      const d2 = usa2 ? mul3(eixoDeRef(f.dir2!.ref, ctx).dir, f.dir2!.inverter ? -1 : 1) : [0, 0, 0] as Vec3;
      const n2 = usa2 ? Math.max(1, Math.round(f.dir2!.instancias)) : 1;
      const copias: Ferramenta[] = [];
      for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
        if ((i === 0 && j === 0) || f.pular.includes(`${i},${j}`)) continue;
        if (usa2 && f.dir2!.somenteSemente && i > 0 && j > 0) continue;
        const v = soma3(mul3(d1, i * f.dir1.espacamento), mul3(d2, j * (f.dir2?.espacamento ?? 0)));
        for (const b of base) copias.push({ op: b.op, tool: b.tool.clone().translate(v) });
      }
      if (!copias.length) throw new Error("O padrão precisa de pelo menos 2 instâncias.");
      return aplicar(ctx, f.id, juntar(copias));
    }

    case "padraoCircular": {
      const base = ferramentasDe(f.recursos, ctx);
      const ax = eixoDeRef(f.eixo, ctx);
      const n = Math.max(1, Math.round(f.instancias));
      const passo = (f.igual ? (Math.abs(f.angulo) >= 360 ? f.angulo / n : f.angulo / Math.max(1, n - 1)) : f.angulo) * (f.inverter ? -1 : 1);
      const copias: Ferramenta[] = [];
      for (let i = 1; i < n; i++) {
        if (f.pular.includes(String(i))) continue;
        for (const b of base) copias.push({ op: b.op, tool: b.tool.clone().rotate(passo * i, ax.origem, ax.dir) });
      }
      if (!copias.length) throw new Error("O padrão precisa de pelo menos 2 instâncias.");
      return aplicar(ctx, f.id, juntar(copias));
    }

    case "espelhar": {
      const p = planoDeRef(f.plano, ctx);
      const pl = new Plane(p.origem, p.x, p.normal);
      if (f.corpo) {
        const peca = exigirPeca(ctx, "Espelhar corpo");
        ctx.peca = peca.fuse(peca.clone().mirror(pl));
        return;
      }
      const base = ferramentasDe(f.recursos, ctx);
      return aplicar(ctx, f.id, juntar(base.map((b) => ({ op: b.op, tool: b.tool.clone().mirror(pl) }))));
    }

    case "planoRef": {
      const p1 = planoDeRef(f.ref1, ctx);
      let r: Referencial;
      if (f.modo === "deslocamento") {
        r = { ...p1, origem: soma3(p1.origem, mul3(p1.normal, (f.inverter ? -1 : 1) * f.distancia)) };
      } else if (f.modo === "medio") {
        const p2 = planoDeRef(f.ref2, ctx);
        r = { ...p1, origem: mul3(soma3(p1.origem, p2.origem), 0.5) };
      } else {
        // gira o plano em torno do eixo/aresta
        const ax = eixoDeRef(f.ref2, ctx);
        const a = (((f.inverter ? -1 : 1) * f.angulo) * Math.PI) / 180;
        const rot = (v: Vec3): Vec3 => {
          const k = ax.dir, c = Math.cos(a), s = Math.sin(a);
          const kxv = cruz(k, v);
          const kv = esc3(k, v);
          return [v[0] * c + kxv[0] * s + k[0] * kv * (1 - c), v[1] * c + kxv[1] * s + k[1] * kv * (1 - c), v[2] * c + kxv[2] * s + k[2] * kv * (1 - c)];
        };
        const normal = normalizar(rot(p1.normal));
        const x = normalizar(ax.dir);
        r = { origem: ax.origem, normal, x, y: cruz(normal, x) };
      }
      ctx.planos.set(f.id, r);
      ctx.refsSaida.push({ id: f.id, tipo: "plano", ref: r, tamanho: 0 });
      return;
    }

    case "eixoRef": {
      let e: { origem: Vec3; dir: Vec3 };
      if (f.modo === "doisPlanos") {
        const a = planoDeRef(f.ref1, ctx), b = planoDeRef(f.ref2, ctx);
        const dir = cruz(a.normal, b.normal);
        if (Math.hypot(...dir) < 1e-9) throw new Error("Os planos são paralelos.");
        // ponto na interseção: resolve no plano perpendicular à direção
        const n1 = a.normal, n2 = b.normal, d1 = esc3(n1, a.origem), d2 = esc3(n2, b.origem);
        const u = cruz(n1, n2), uu = esc3(u, u);
        const p = mul3(soma3(mul3(cruz(n2, u), d1), mul3(cruz(u, n1), d2)), 1 / uu);
        e = { origem: p, dir: normalizar(dir) };
      } else if (f.modo === "doisPontos") {
        const a = pontoDeRef(f.ref1, ctx), b = pontoDeRef(f.ref2, ctx);
        e = { origem: a, dir: normalizar(sub3(b, a)) };
      } else e = eixoDeRef(f.ref1, ctx);
      ctx.eixos.set(f.id, e);
      ctx.refsSaida.push({ id: f.id, tipo: "eixo", origem: e.origem, dir: e.dir, comprimento: 0 });
      return;
    }
  }
}

let ultimaPeca: Shape3D | null = null;

export function pecaAtual(): Shape3D | null {
  return ultimaPeca;
}

export function exportar(formato: "step" | "stl"): Blob {
  if (!ultimaPeca) throw new Error("Não há peça para exportar.");
  return formato === "step"
    ? ultimaPeca.blobSTEP()
    : ultimaPeca.blobSTL({ tolerance: 0.01, angularTolerance: 5, binary: true } as never);
}

function traduzirErro(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fillet|chamfer/i.test(msg)) return "Raio/distância grande demais para as arestas escolhidas.";
  if (/shell|thick/i.test(msg)) return "Não foi possível fazer a casca (espessura grande demais para a peça?).";
  if (/draft/i.test(msg)) return "Não foi possível inclinar essas faces (verifique o plano neutro).";
  if (/boolean|fuse|cut|intersect/i.test(msg)) return "Falha na operação booleana.";
  // Exceções C++ do OpenCascade chegam como números ou WebAssembly.Exception, sem texto útil.
  if (typeof e === "number" || /WebAssembly|object/i.test(msg)) {
    return "O kernel não conseguiu gerar esta geometria (valor grande demais ou perfil inválido).";
  }
  return msg;
}
