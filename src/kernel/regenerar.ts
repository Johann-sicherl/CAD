// Regeneração da peça a partir da árvore de features, usando o kernel B-Rep
// (OpenCascade via replicad). Não depende do navegador: roda no Web Worker e nos testes.
// Campos e comportamento de cada recurso: docs/funcional/features.md.

import {
  draw,
  drawCircle,
  drawEllipse,
  drawPolysides,
  drawRoundedRectangle,
  drawRectangle,
  makeBox,
  makeOffset,
  measureVolume,
  Plane,
  type Drawing,
  type Edge,
  type Face,
  type Shape3D,
} from "replicad";
import type {
  Condicao, Feature, FeatureAbaChapa, FeatureConverterChapa, FeatureDesdobrar, FeatureAlivioCanto, FeatureBainha, FeatureFecharCanto, FeatureQuebrarCanto, FeatureDobraEsboco, FeatureJunta, FeatureMeiaEsquadria, FeatureCurva, FeatureEsboco, FeatureFlangeAresta, FeatureFlangeBase, FeatureExtrusao, FeatureFuro, FeatureNervura, FeatureRevolucao, FeatureVarredura, FeatureLoft,
  Inclinacao, Perfil, Plano, Referencia, RecursoFino, Vec3,
} from "../model";
import { aninhamento, cadeiaAberta, encontrarLacos, mapaPontos, pontoNoPoligono, type Laco, type P2 } from "../esboco/geometria";
import { cruz, eixoXParaNormal, normalizar, paraMundo, referencial, type Referencial } from "../esboco/referencial";
import { medidasFuro } from "./furos";
import { RastreadorFaces } from "./facesRecurso";
import { arestaDe, encadear, trechoDaAresta, trechosDoEsboco, varrer, type Trecho } from "./varredura";
import {
  areaContorno, circuloAlivio, comprimentoReto, desenhoDoPoligono, local3, ModeloChapa, normalExterna, recortarPoligono, recuo, retanguloDesenho,
  transformarDesenho, type Canto, type Corte, type Dobra, type Parede,
} from "./chapa";
import { dxfDoPlanificado, lacosDoDesenho, type ResumoPlanificado } from "./dxf";
import { cruzarEsbocos, curvaPorPontos, lerPontosXYZ, pontosHelice, polilinhasDe, projetarEmFaces } from "./curvas";
import { lofting } from "./loft";
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
  | { id: string; tipo: "eixo"; origem: Vec3; dir: Vec3; comprimento: number }
  /** Curva 3D: polilinhas para desenhar e tocar no viewport. */
  | { id: string; tipo: "curva"; linhas: Vec3[][] };

export interface ResultadoRegeneracao {
  malha: MalhaPeca | null;
  erros: ErroFeature[];
  volume: number | null; // mm³
  topologia: Topologia | null;
  referencias: InfoReferencia[];
  tempos: { id: string; ms: number }[];
  /** Faces da peça final (índices de `topologia.faces`) de cada recurso: destaque na árvore. */
  facesPorRecurso: Record<string, number[]>;
  /**
   * Prévia do recurso em edição (opção `previa`): o material que ele tira (peça antes − peça
   * depois), para ver cortes, furos, filetes etc. antes de confirmar.
   */
  previaRemovido?: MalhaSimples | null;
}

/** Malha só de triângulos (prévia). */
export interface MalhaSimples {
  vertices: Float32Array;
  normais: Float32Array;
  triangulos: Uint32Array;
  arestas: Float32Array;
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
  /** Curvas 3D já calculadas (recursos de curva), como trechos. */
  curvas: Map<string, Trecho[]>;
  /** Chapa metálica (paredes + dobras), criada pela flange base. */
  chapa: ModeloChapa | null;
  /** Sólido que já existia antes da flange base (a chapa é somada a ele). */
  corpoAntesChapa: Shape3D | null;
  /** Ferramentas de recursos comuns depois da chapa (reaplicadas quando a chapa muda). */
  opsAposChapa: Ferramenta[];
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
  return { peca: null, esbocos: new Map(), ferramentas: new Map(), planos, eixos, curvas: new Map(), chapa: null, corpoAntesChapa: null, opsAposChapa: [], refsSaida: [] };
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
  if (ctx.chapa) ctx.opsAposChapa.push(...ferramentas);
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
  if (l.tipo === "elipse") {
    const { c, u, a, b } = l.e;
    return drawEllipse(a, b).rotate((Math.atan2(u.y, u.x) * 180) / Math.PI, [0, 0]).translate(c.x, c.y);
  }
  const ts = l.trechos;
  const ini = ts[0].a;
  const pen = draw([ini.x, ini.y]);
  ts.forEach((t, i) => {
    // o último trecho termina exatamente no início (pontos coincidentes podem diferir no 1e-9)
    const b = i === ts.length - 1 ? ini : t.b;
    if (t.tipo === "linha") pen.lineTo([b.x, b.y]);
    else if (t.tipo === "arco") pen.threePointsArcTo([b.x, b.y], [t.meio.x, t.meio.y]);
    else if (t.tipo === "quad") pen.quadraticBezierCurveTo([b.x, b.y], [t.c1.x, t.c1.y]);
    else if (t.tipo === "elipse") {
      const { u, a, b: rb } = t.e;
      const varr = t.t1 - t.t0;
      // como no arco elíptico do SVG: grande = mais de meia volta; sentido = anti-horário
      pen.ellipseTo([b.x, b.y], a, rb, (Math.atan2(u.y, u.x) * 180) / Math.PI, Math.abs(varr) > Math.PI, varr > 0);
    }
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
  // cada região (laço externo ou ilha) menos os seus furos diretos; depois une as regiões.
  // Cortar furos de um desenho com várias regiões separadas perde regiões no replicad.
  let res: Drawing | null = null;
  lacos.forEach((l, i) => {
    if (prof[i] % 2) return;
    let regiao = desenhoDoLaco(l);
    lacos.forEach((h, j) => {
      if (prof[j] === prof[i] + 1 && pontoNoPoligono(h.poligono[0], l.poligono)) regiao = regiao.cut(desenhoDoLaco(h));
    });
    res = res ? res.fuse(regiao) : regiao;
  });
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

/**
 * Condições "até o vértice / superfície / deslocamento da superfície": a própria referência diz
 * para que lado extrudar (não é preciso inverter a direção). Null = decide o botão Inverter.
 */
function sentidoDaReferencia(cond: Condicao, r: Referencial, inicio: Vec3, centro: Vec3, ctx: Ctx): 1 | -1 | null {
  let t: number;
  if (cond.tipo === "vertice") {
    t = esc3(sub3(pontoDeRef(cond.ref, ctx), inicio), r.normal);
  } else if (cond.tipo === "superficie" || cond.tipo === "deslocSuperficie") {
    let p = planoDeRef(cond.ref, ctx);
    if (cond.tipo === "deslocSuperficie") {
      p = { ...p, origem: soma3(p.origem, mul3(p.normal, (cond.inverterDesloc ? -1 : 1) * cond.dist)) };
    }
    const dn = esc3(r.normal, p.normal);
    if (Math.abs(dn) < 1e-9) return null;
    // onde a reta normal ao esboço, saindo do centro do perfil, encontra a superfície
    t = esc3(sub3(p.origem, centro), p.normal) / dn;
  } else return null;
  return Math.abs(t) > 1e-6 ? (t > 0 ? 1 : -1) : null;
}

function prismaDirecao(
  D: Drawing, r: Referencial, s0: number, sentido: 1 | -1, cond: Condicao, inc: Inclinacao | undefined,
  ctx: Ctx, op: "adicionar" | "cortar", centro2: P2,
): Shape3D {
  const inicio = soma3(r.origem, mul3(r.normal, s0));
  const centro = paraMundo({ ...r, origem: inicio }, centro2.x, centro2.y);
  sentido = sentidoDaReferencia(cond, r, inicio, centro, ctx) ?? sentido;
  const d = mul3(r.normal, sentido);
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
    const lc = esb.geos.find((g) => g.tipo === "linha" && g.construcao && !g.externa);
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
  // mesma base dos esboços; o eixo é o "vertical" (y) do plano, passando pela origem
  const r = referencial({ tipo: "plano", plano: f.plano, deslocamento: 0 });
  const esboco = noPlano(desenho, r) as unknown as Sk;
  return esboco.revolve(r.y, { origin: [0, 0, 0], angle: Math.min(360, Math.max(1, f.angulo)) });
}

// ---------- chapa metálica (docs/funcional/chapa.md) ----------

function exigirChapa(ctx: Ctx, oque: string): ModeloChapa {
  if (!ctx.chapa) throw new Error(`${oque} precisa de uma Flange base (ou Converter em chapa) antes dele na árvore.`);
  return ctx.chapa;
}

/** Recursos que criam paredes ou cortam por planos 3D só valem com a chapa dobrada. */
function exigirChapaDobrada(ctx: Ctx, oque: string): ModeloChapa {
  const m = exigirChapa(ctx, oque);
  if (m.planas.size) throw new Error(`${oque}: a chapa está desdobrada — coloque um Dobrar antes deste recurso.`);
  return m;
}

/** Peça = chapa (+ corpo anterior) com os recursos comuns que vieram depois reaplicados. */
function reconstruirChapa(ctx: Ctx) {
  let p = ctx.chapa!.solido();
  if (ctx.corpoAntesChapa) p = ctx.corpoAntesChapa.fuse(p);
  for (const f of ctx.opsAposChapa) p = f.op === "adicionar" ? p.fuse(f.tool) : p.cut(f.tool);
  ctx.peca = p;
}

const grausRad = (g: number) => (g * Math.PI) / 180;
type V2 = { x: number; y: number };
const unit2 = (a: V2): V2 => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

function flangeBase(f: FeatureFlangeBase, ctx: Ctx): ModeloChapa {
  if (!(f.espessura > 0)) throw new Error("A espessura da chapa deve ser maior que zero.");
  if (!(f.raio >= 0)) throw new Error("O raio de dobra não pode ser negativo.");
  if (!(f.fatorK >= 0 && f.fatorK <= 1)) throw new Error("O fator K fica entre 0 e 1 (típico 0,3 a 0,5).");
  const esb = esbocoDe(f.esboco, ctx);
  const r = referencial(esb.suporte, ctx.planos);
  const m = new ModeloChapa({ t: f.espessura, r: f.raio, k: f.fatorK });
  let lacos: Laco[] | null = null;
  try {
    lacos = encontrarLacos(esb);
  } catch {
    lacos = null;
  }
  if (lacos) {
    // perfil fechado: uma placa no plano do esboço
    m.raiz(`${f.id}:0`, { o: r.origem, u: r.x, v: r.y, n: r.normal }, f.inverter ? -1 : 1, desenhoDoEsboco(esb), lacos.map((l) => l.poligono));
    return m;
  }
  // perfil aberto (só linhas): paredes ao longo do perfil, dobras com o raio da chapa nos cantos
  const linhas = esb.geos.filter((g) => !g.construcao && g.tipo !== "ponto");
  if (!linhas.length || linhas.some((g) => g.tipo !== "linha")) {
    throw new Error("Flange base: use um contorno fechado (placa) ou um perfil aberto só de linhas (perfil dobrado).");
  }
  const pl = cadeiaAberta(esb);
  if (!pl || pl.length < 2) throw new Error("O perfil aberto deve ser uma cadeia única de linhas.");
  if (!(f.profundidade > 0)) throw new Error("A profundidade deve ser maior que zero.");
  const t = f.espessura;
  const U = mul3(r.normal, f.inverterDirecao ? -1 : 1);
  const [u0, u1] = f.planoMedio ? [-f.profundidade / 2, f.profundidade / 2] : [0, f.profundidade];
  const segs = pl.slice(1).map((b, i) => {
    const a = pl[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    return { a, L, d: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } };
  }).filter((sg) => sg.L > 1e-9);
  const em3 = (d: V2): Vec3 => soma3(mul3(r.x, d.x), mul3(r.y, d.y));
  // cantos: ângulo e se a dobra vai para o lado do material
  const v0 = em3(segs[0].d);
  const n0 = cruz(U, v0);
  const lado = em3({ x: -segs[0].d.y, y: segs[0].d.x });
  const s0: 1 | -1 = esc3(n0, lado) * (f.inverter ? -1 : 1) >= 0 ? 1 : -1;
  // recuos dos cantos: a linha do esboço é a face de referência (canto vivo virtual)
  const cantos = segs.slice(1).map((sg, i) => {
    const ant = segs[i];
    const cos = Math.max(-1, Math.min(1, ant.d.x * sg.d.x + ant.d.y * sg.d.y));
    const theta = Math.acos(cos);
    if (theta > grausRad(175)) throw new Error("Ângulo do perfil fechado demais (dobra acima de 175°).");
    const vira = ant.d.x * sg.d.y - ant.d.y * sg.d.x; // + = vira à esquerda no esboço
    return { theta, vira };
  });
  const recuoCanto = (i: number, paraMaterial: boolean) => {
    const c = cantos[i];
    if (!c || c.theta < 1e-9) return 0;
    return (paraMaterial ? t + f.raio : f.raio) * Math.tan(c.theta / 2);
  };
  // a primeira parede define o lado do material; os cantos seguintes viram para dentro/fora dele
  const ladoEsq = s0 * esc3(n0, lado) >= 0; // material à esquerda do perfil?
  const paraMat = cantos.map((c) => (c.vira > 0) === ladoEsq);
  const rect = (y1: number) => retanguloDesenho(u0, u1, 0, y1);
  const cont = (y1: number) => [[{ x: u0, y: 0 }, { x: u1, y: 0 }, { x: u1, y: y1 }, { x: u0, y: y1 }]];
  const comp = (i: number) => segs[i].L - (i > 0 ? recuoCanto(i - 1, paraMat[i - 1]) : 0) - (i < cantos.length ? recuoCanto(i, paraMat[i]) : 0);
  if (segs.some((_, i) => comp(i) <= 1e-6)) throw new Error("Um trecho do perfil é curto demais para as dobras (raio + espessura).");
  const p0 = soma3(r.origem, em3(segs[0].a));
  let w = m.raiz(`${f.id}:0`, { o: p0, u: U, v: v0, n: n0 }, s0, rect(comp(0)), cont(comp(0)));
  for (let i = 1; i < segs.length; i++) {
    const L0 = comp(i - 1);
    w = m.dobrar({
      pai: w, idDobra: `${f.id}:d${i}`, idFilha: `${f.id}:${i}`, e0: { x: 0, y: L0 }, e: { x: 1, y: 0 }, d: { x: 0, y: 1 },
      s0: u0, s1: u1, theta: cantos[i - 1].theta, r: f.raio, paraMaterial: paraMat[i - 1], forma: rect(comp(i)), contornos: cont(comp(i)),
    });
  }
  return m;
}

/** Parede e aresta da chapa para cada aresta escolhida (antes de mexer em qualquer parede). */
function arestasDaChapa(m: ModeloChapa, refs: Referencia[], ctx: Ctx, oque: string) {
  if (!refs.length) throw new Error(`${oque}: escolha as arestas.`);
  const peca = exigirPeca(ctx, oque);
  return refs.map((ref) => {
    if (ref.tipo !== "aresta") throw new Error(`${oque}: escolha arestas retas da chapa.`);
    const ass = assinaturaAresta(acharAresta(peca, ref.ass));
    if (ass.geom !== "linha") throw new Error(`${oque}: a aresta precisa ser reta.`);
    const h = m.acharAresta(ass.a, ass.b);
    if (!h) throw new Error(`${oque}: a aresta precisa ser uma borda reta de uma parede plana da chapa (não de uma dobra).`);
    const L = Math.hypot(h.q.x - h.p.x, h.q.y - h.p.y);
    const e = unit2({ x: h.q.x - h.p.x, y: h.q.y - h.p.y });
    const d = normalExterna(h.p, h.q, areaContorno(h.contorno));
    return { ...h, L, e, d };
  });
}

/** Dobra uma aba em cada aresta (flange de aresta e bainha). */
function dobrarArestas(
  m: ModeloChapa, f: { id: string }, arestas: ReturnType<typeof arestasDaChapa>,
  o: {
    theta: number; r: number; inverter: boolean; setback: number; compReto: number; desloc0: number; desloc1: number; folga?: number;
    /** Lado da dobra fixo (meia-esquadria: vem do perfil), em vez de pela face da aresta. */
    paraMaterial?: boolean;
  },
): AbaFeita[] {
  const t = m.p.t;
  const feitas: AbaFeita[] = [];
  arestas.forEach((h, i) => {
    const s0 = h.ta * h.L + o.desloc0, s1 = h.tb * h.L - o.desloc1;
    if (s1 - s0 <= 1e-6) throw new Error("Os deslocamentos são maiores que a aresta.");
    // na face de cima, a aba sobe; na de referência, desce (Inverter troca)
    const paraMaterial = o.paraMaterial ?? (h.noTopo !== o.inverter);
    const noLocal = (a0: number, a1: number, b0: number, b1: number) =>
      transformarDesenho(retanguloDesenho(a0, a1, b0, b1), h.e.x, h.d.x, h.e.y, h.d.y, h.p.x, h.p.y);
    if (o.setback > 1e-9) {
      m.recortar(h.parede.id, noLocal(s0, s1, -o.setback, 0.01));
      // alívio retangular nas pontas quando a aba não ocupa a aresta toda
      if (s0 > 1e-6) m.recortar(h.parede.id, noLocal(s0 - t, s0, -(o.setback + t), 0.01));
      if (s1 < h.L - 1e-6) m.recortar(h.parede.id, noLocal(s1, s1 + t, -(o.setback + t), 0.01));
    }
    const e0 = { x: h.p.x - h.d.x * o.setback, y: h.p.y - h.d.y * o.setback };
    const forma = o.compReto > 1e-6 ? retanguloDesenho(s0, s1, 0, o.compReto) : null;
    const filha = m.dobrar({
      pai: h.parede, idDobra: `${f.id}:d${i}`, idFilha: `${f.id}:${i}`, e0, e: h.e, d: h.d, s0, s1, theta: o.theta, r: o.r,
      paraMaterial, forma, contornos: forma ? [[{ x: s0, y: 0 }, { x: s1, y: 0 }, { x: s1, y: o.compReto }, { x: s0, y: o.compReto }]] : [],
    });
    feitas.push({ h, filha, dobra: m.dobras[m.dobras.length - 1], s0, s1, comParede: !!forma });
  });
  if (o.folga !== undefined) cantosAutomaticos(m, feitas, Math.max(0, o.folga));
  return feitas;
}

interface AbaFeita {
  h: ReturnType<typeof arestasDaChapa>[number];
  filha: Parede;
  dobra: Dobra;
  s0: number;
  s1: number;
  comParede: boolean;
}

/**
 * Canto automático: abas da mesma flange em arestas que se encontram num canto são aparadas
 * pelo plano bissetor das duas paredes (meia-esquadria), afastadas pela folga. O corte pega a
 * parede e a dobra de cada aba; no planificado vira corte perpendicular à chapa.
 */
function cantosAutomaticos(m: ModeloChapa, feitas: AbaFeita[], folga: number) {
  const t = m.p.t;
  const ponta = (f: AbaFeita, s: number) => ({ x: f.h.p.x + f.h.e.x * s, y: f.h.p.y + f.h.e.y * s });
  const meio = (w: Parede) => ({ p: local3(w.q, { x: 0, y: 0 }, (w.s * t) / 2), n: w.q.n });
  const longe = (f: AbaFeita) => local3(f.filha.q, { x: (f.s0 + f.s1) / 2, y: 0 }, (f.filha.s * t) / 2);
  for (let i = 0; i < feitas.length; i++) {
    for (let j = i + 1; j < feitas.length; j++) {
      const A = feitas[i], B = feitas[j];
      if (A.h.parede !== B.h.parede || !A.comParede || !B.comParede) continue;
      const pa = [ponta(A, A.s0), ponta(A, A.s1)], pb = [ponta(B, B.s0), ponta(B, B.s1)];
      let canto: { x: number; y: number } | null = null;
      for (const p of pa) for (const q of pb) if (Math.hypot(p.x - q.x, p.y - q.y) < 1e-3) canto = p;
      if (!canto) continue;
      const mA = meio(A.filha), mB = meio(B.filha), fA = longe(A), fB = longe(B);
      // bissetor: nA·(x − pA) = σ·nB·(x − pB); o certo deixa cada aba de um lado
      let melhor: { N: Vec3; K: number; sep: number; lado: number } | null = null;
      for (const sg of [1, -1]) {
        const N = sub3(mA.n, mul3(mB.n, sg));
        const l = Math.hypot(...N);
        if (l < 1e-6) continue;
        const K = esc3(mA.n, mA.p) - sg * esc3(mB.n, mB.p);
        const vA = (esc3(N, fA) - K) / l, vB = (esc3(N, fB) - K) / l;
        if (vA * vB >= 0) continue;
        const sep = Math.min(Math.abs(vA), Math.abs(vB));
        if (!melhor || sep > melhor.sep) melhor = { N, K, sep, lado: Math.sign(vA) };
      }
      let p0: Vec3, n: Vec3;
      if (melhor) {
        const l2 = esc3(melhor.N, melhor.N);
        p0 = mul3(melhor.N, melhor.K / l2);
        n = mul3(melhor.N, melhor.lado / Math.sqrt(l2));
      } else {
        // paredes paralelas (bainhas): plano perpendicular à mãe pela bissetriz do canto
        const W = A.h.parede;
        const sai = (f: AbaFeita) => {
          const outra = Math.hypot(ponta(f, f.s0).x - canto!.x, ponta(f, f.s0).y - canto!.y) < 1e-3 ? f.s1 : f.s0;
          const q = ponta(f, outra);
          const l = Math.hypot(q.x - canto!.x, q.y - canto!.y);
          return { x: (q.x - canto!.x) / l, y: (q.y - canto!.y) / l };
        };
        const uA = sai(A), uB = sai(B);
        const d = { x: uA.x - uB.x, y: uA.y - uB.y };
        const l = Math.hypot(d.x, d.y);
        if (l < 1e-6) continue;
        p0 = local3(W.q, canto, 0);
        n = sub3(local3(W.q, { x: d.x / l, y: d.y / l }, 0), local3(W.q, { x: 0, y: 0 }, 0));
      }
      const chave = `${A.dobra.id}|${B.dobra.id}`;
      const corteA = { p: soma3(p0, mul3(n, folga / 2)), m: n, canto: chave };
      const corteB = { p: soma3(p0, mul3(n, -folga / 2)), m: mul3(n, -1), canto: chave };
      for (const [f, c] of [[A, corteA], [B, corteB]] as const) {
        (f.filha.cortes ??= []).push(c);
        (f.dobra.cortes ??= []).push(c);
      }
    }
  }
}

function flangeAresta(f: FeatureFlangeAresta, ctx: Ctx) {
  const m = exigirChapaDobrada(ctx, "A flange de aresta");
  if (!(f.angulo > 0 && f.angulo <= 180)) throw new Error("O ângulo da flange fica entre 0° e 180°.");
  const theta = grausRad(f.angulo);
  const r = f.raioProprio ? f.raio : m.p.r;
  const arestas = arestasDaChapa(m, f.arestas, ctx, "Flange de aresta");
  dobrarArestas(m, f, arestas, {
    theta, r, inverter: f.inverter, setback: recuo(f.posicao, theta, r, m.p.t),
    compReto: comprimentoReto(f.medicao, f.comprimento, theta, r, m.p.t), desloc0: f.deslocInicio, desloc1: f.deslocFim,
    folga: f.folga ?? 0.25,
  });
}

/**
 * Flange de meia-esquadria: o perfil aberto (linhas) desenhado num plano perpendicular à 1ª
 * aresta, começando nela, é levado ao longo de cada aresta escolhida. A 1ª linha vira a aba
 * (como uma flange de aresta, medida até o canto vivo virtual externo); cada canto do perfil
 * vira uma dobra com o raio da chapa e cada linha seguinte, uma parede (também medida até os
 * cantos vivos virtuais externos). Arestas que se encontram num canto: todas as paredes e dobras
 * das duas abas são aparadas pelo plano bissetor do canto, afastadas pela folga.
 */
function meiaEsquadria(f: FeatureMeiaEsquadria, ctx: Ctx) {
  const m = exigirChapaDobrada(ctx, "A flange de meia-esquadria");
  const t = m.p.t;
  const r = f.raioProprio ? f.raio : m.p.r;
  if (!(r > 0)) throw new Error("O raio de dobra deve ser maior que zero.");
  const arestas = arestasDaChapa(m, f.arestas, ctx, "Flange de meia-esquadria");
  // perfil: cadeia de linhas no espaço, começando na ponta mais perto da 1ª aresta
  const esb = esbocoDe(f.esboco, ctx);
  const rs = referencial(esb.suporte, ctx.planos);
  if (esb.geos.some((g) => !g.construcao && !g.externa && g.tipo !== "linha" && g.tipo !== "ponto")) {
    throw new Error("Flange de meia-esquadria: o perfil deve ter só linhas (arcos: próxima versão).");
  }
  const cadeia = cadeiaAberta(esb);
  if (!cadeia || cadeia.length < 2) throw new Error("Flange de meia-esquadria: desenhe um perfil aberto (cadeia de linhas) começando na aresta.");
  const h0 = arestas[0], W0 = h0.parede;
  const A0 = local3(W0.q, h0.p), B0 = local3(W0.q, h0.q);
  const eixo = normalizar(sub3(B0, A0));
  if (Math.abs(esc3(rs.normal, eixo)) < 0.999) {
    throw new Error("Flange de meia-esquadria: desenhe o perfil num plano perpendicular à 1ª aresta (ex.: na face da ponta da chapa).");
  }
  let pts = cadeia.map((p) => paraMundo(rs, p.x, p.y));
  const distAresta = (P: Vec3) => {
    const v = sub3(P, A0);
    return Math.hypot(...sub3(v, mul3(eixo, esc3(v, eixo))));
  };
  if (distAresta(pts[pts.length - 1]) < distAresta(pts[0])) pts = pts.reverse();
  if (distAresta(pts[0]) > Math.max(1, 2 * t)) throw new Error("Flange de meia-esquadria: o perfil precisa começar na aresta escolhida.");
  const dirs = pts.slice(1).map((P, i) => sub3(P, pts[i]));
  const L = dirs.map((v) => Math.hypot(...v));
  if (L.some((x) => x < 1e-6)) throw new Error("Flange de meia-esquadria: o perfil tem linhas de comprimento zero.");
  const s = dirs.map((v, i) => mul3(v, 1 / L[i]));
  // 1ª aba: ângulo entre a direção de fora da aresta (no plano da chapa) e a 1ª linha
  const d3 = soma3(mul3(W0.q.u, h0.d.x), mul3(W0.q.v, h0.d.y));
  const cima = mul3(W0.q.n, W0.s);
  const theta1 = Math.atan2(Math.abs(esc3(s[0], cima)), esc3(s[0], d3));
  if (theta1 < 1e-3) throw new Error("Flange de meia-esquadria: a 1ª linha do perfil não pode seguir no plano da chapa.");
  const sobe = esc3(s[0], cima) > 0;
  const paraMaterial1 = sobe !== f.inverter;
  // cantos do perfil: ângulo e recuo (medida até o canto vivo virtual externo)
  const thetas = s.slice(1).map((v, i) => Math.acos(Math.max(-1, Math.min(1, esc3(s[i], v)))));
  if (thetas.some((x) => x > grausRad(175))) throw new Error("Flange de meia-esquadria: canto do perfil fechado demais (acima de 175°).");
  const tg = (x: number) => (x <= Math.PI / 2 + 1e-9 ? Math.tan(x / 2) : 1);
  const ded = thetas.map((x) => (r + t) * tg(x));
  const comp = L.map((x, i) => {
    let c = i === 0 ? comprimentoReto("externoVirtual", x, theta1, r, t) : x;
    if (i > 0) c -= ded[i - 1];
    if (i < ded.length) c -= ded[i];
    return c;
  });
  if (comp.some((c) => c <= 1e-6)) throw new Error("Flange de meia-esquadria: uma linha do perfil é curta demais para as dobras (raio + espessura).");
  const feitas = dobrarArestas(m, f, arestas, {
    theta: theta1, r, inverter: false, setback: recuo(f.posicao, theta1, r, t), compReto: comp[0], desloc0: 0, desloc1: 0,
    paraMaterial: paraMaterial1,
  });
  // paredes seguintes; o lado de cada dobra sai do perfil na 1ª aresta e vale para as outras
  const lados: boolean[] = [];
  const cadeias = feitas.map((fe, j) => {
    const paredes = [fe.filha], dobras = [fe.dobra];
    let atual = fe.filha;
    for (let k = 1; k < s.length; k++) {
      if (j === 0) {
        const b = sub3(s[k], mul3(s[k - 1], esc3(s[k], s[k - 1])));
        lados[k] = esc3(b, mul3(atual.q.n, atual.s)) > 0;
      }
      const forma = retanguloDesenho(fe.s0, fe.s1, 0, comp[k]);
      atual = m.dobrar({
        pai: atual, idDobra: `${f.id}:d${j}_${k}`, idFilha: `${f.id}:${j}_${k}`, e0: { x: 0, y: comp[k - 1] }, e: { x: 1, y: 0 },
        d: { x: 0, y: 1 }, s0: fe.s0, s1: fe.s1, theta: thetas[k - 1], r, paraMaterial: lados[k], forma,
        contornos: [[{ x: fe.s0, y: 0 }, { x: fe.s1, y: 0 }, { x: fe.s1, y: comp[k] }, { x: fe.s0, y: comp[k] }]],
      });
      paredes.push(atual);
      dobras.push(m.dobras[m.dobras.length - 1]);
    }
    return { fe, paredes, dobras };
  });
  // cantos entre arestas vizinhas da mesma parede: plano bissetor do canto (perpendicular à chapa)
  const ponta = (fe: AbaFeita, x: number) => ({ x: fe.h.p.x + fe.h.e.x * x, y: fe.h.p.y + fe.h.e.y * x });
  for (let i = 0; i < cadeias.length; i++) {
    for (let j = i + 1; j < cadeias.length; j++) {
      const A = cadeias[i], B = cadeias[j];
      if (A.fe.h.parede !== B.fe.h.parede) continue;
      let canto: V2 | null = null;
      for (const p of [ponta(A.fe, A.fe.s0), ponta(A.fe, A.fe.s1)]) {
        for (const q of [ponta(B.fe, B.fe.s0), ponta(B.fe, B.fe.s1)]) if (Math.hypot(p.x - q.x, p.y - q.y) < 1e-3) canto = p;
      }
      if (!canto) continue;
      const sai = (fe: AbaFeita) => {
        const outra = Math.hypot(ponta(fe, fe.s0).x - canto!.x, ponta(fe, fe.s0).y - canto!.y) < 1e-3 ? fe.s1 : fe.s0;
        return unit2({ x: ponta(fe, outra).x - canto!.x, y: ponta(fe, outra).y - canto!.y });
      };
      const uA = sai(A.fe), uB = sai(B.fe);
      const dl = unit2({ x: uA.x - uB.x, y: uA.y - uB.y });
      const W = A.fe.h.parede;
      const p0 = local3(W.q, canto, 0);
      const n = sub3(local3(W.q, dl, 0), local3(W.q, { x: 0, y: 0 }, 0));
      const g = Math.max(0, f.folga) / 2;
      const chave = `${A.dobras[0].id}|${B.dobras[0].id}`;
      const cA = { p: soma3(p0, mul3(n, g)), m: n, canto: chave }, cB = { p: soma3(p0, mul3(n, -g)), m: mul3(n, -1), canto: chave };
      for (const [cad, c] of [[A, cA], [B, cB]] as const) {
        for (const w of cad.paredes) (w.cortes ??= []).push(c);
        for (const b of cad.dobras) (b.cortes ??= []).push(c);
      }
    }
  }
}

function bainha(f: FeatureBainha, ctx: Ctx) {
  const m = exigirChapaDobrada(ctx, "A bainha");
  const t = m.p.t;
  const arestas = arestasDaChapa(m, f.arestas, ctx, "Bainha");
  let theta = Math.PI, r: number, compReto: number;
  if (f.estilo === "fechada") {
    r = 0.01 * t; // dobra sobre ela mesma (folga mínima para o sólido continuar válido)
    compReto = f.comprimento;
  } else if (f.estilo === "aberta") {
    if (!(f.folga > 0)) throw new Error("A folga da bainha aberta deve ser maior que zero.");
    r = f.folga / 2;
    compReto = f.comprimento;
  } else {
    if (!(f.angulo > 0 && f.angulo < 360)) throw new Error("O ângulo da bainha enrolada fica entre 0° e 360°.");
    if (!(f.raio > 0)) throw new Error("O raio da bainha enrolada deve ser maior que zero.");
    theta = grausRad(f.angulo);
    r = f.raio;
    compReto = 0;
  }
  if (f.estilo !== "enrolada" && !(f.comprimento > 0)) throw new Error("O comprimento da bainha deve ser maior que zero.");
  dobrarArestas(m, f, arestas, {
    theta, r, inverter: f.inverter, setback: f.posicao === "materialInterno" ? r + t : 0, compReto, desloc0: 0, desloc1: 0, folga: 0.25,
  });
}

// ---------- cantos (docs/funcional/chapa.md §9) ----------

/** Cantos entre abas vizinhas; sem nenhum, explica o que falta. */
function cantosDaChapa(m: ModeloChapa, oque: string): Canto[] {
  const ks = m.cantos();
  if (!ks.length) throw new Error(`${oque}: não há cantos entre abas vizinhas (flanges em arestas que se encontram).`);
  return ks;
}

/**
 * Fecha um canto entre as paredes-filhas das duas dobras. As dobras são sempre aparadas pelo
 * plano bissetor (afastadas pela folga). As paredes: meia-esquadria (mesmo plano) ou
 * sobreposta/subposta (uma vai até a face de fora da outra; a outra para na face de dentro da
 * primeira, menos a folga). Os cortes anteriores desse canto são trocados.
 */
function tratarCanto(m: ModeloChapa, k: Canto, tipo: FeatureFecharCanto["tipoCanto"], folga: number): boolean {
  const t = m.p.t;
  const wA = m.parede(k.a.filha!), wB = m.parede(k.b.filha!), mae = m.parede(k.a.pai)!;
  if (!wA || !wB) return false;
  // abas com mais paredes depois (perfil de meia-esquadria): ficam como estão
  if (m.dobras.some((d) => d.pai === wA.id || d.pai === wB.id)) return false;
  const chaves = [`${k.a.id}|${k.b.id}`, `${k.b.id}|${k.a.id}`];
  for (const x of [wA, wB, k.a, k.b]) x.cortes = x.cortes?.filter((c) => !c.canto || !chaves.includes(c.canto));
  // estende as duas abas além do canto (fecha frestas de abas feitas em recursos diferentes);
  // os planos do canto aparam o excesso
  const alem = (outra: Dobra) => 2 * (outra.ba + outra.r + t) + 1;
  m.estender(k.a, k.pontaA, k.pontaA === "s1" ? k.sa + alem(k.b) : k.sa - alem(k.b));
  m.estender(k.b, k.pontaB, k.pontaB === "s1" ? k.sb + alem(k.a) : k.sb - alem(k.a));
  const canto = chaves[0];
  const meio = (w: Parede) => ({ p: local3(w.q, { x: 0, y: 0 }, (w.s * t) / 2), n: w.q.n });
  const longe = (w: Parede, b: Dobra) => local3(w.q, { x: (b.s0 + b.s1) / 2, y: 0 }, (w.s * t) / 2);
  const mA = meio(wA), mB = meio(wB), fA = longe(wA, k.a), fB = longe(wB, k.b);
  // plano bissetor das linhas médias que deixa cada aba de um lado
  let melhor: { N: Vec3; K: number; sep: number; lado: number } | null = null;
  for (const sg of [1, -1]) {
    const N = sub3(mA.n, mul3(mB.n, sg));
    const l = Math.hypot(...N);
    if (l < 1e-6) continue;
    const K = esc3(mA.n, mA.p) - sg * esc3(mB.n, mB.p);
    const vA = (esc3(N, fA) - K) / l, vB = (esc3(N, fB) - K) / l;
    if (vA * vB >= 0) continue;
    const sep = Math.min(Math.abs(vA), Math.abs(vB));
    if (!melhor || sep > melhor.sep) melhor = { N, K, sep, lado: Math.sign(vA) };
  }
  let p0: Vec3, n: Vec3;
  if (melhor) {
    const l2 = esc3(melhor.N, melhor.N);
    p0 = mul3(melhor.N, melhor.K / l2);
    n = mul3(melhor.N, melhor.lado / Math.sqrt(l2));
  } else {
    // paredes paralelas (bainhas): plano perpendicular à mãe pela bissetriz do canto
    const sai = (b: Dobra, ponta: "s0" | "s1") => (ponta === "s1" ? { x: -b.e.x, y: -b.e.y } : b.e);
    const uA = sai(k.a, k.pontaA), uB = sai(k.b, k.pontaB);
    const dl = unit2({ x: uA.x - uB.x, y: uA.y - uB.y });
    p0 = local3(mae.q, k.c, 0);
    n = sub3(local3(mae.q, dl, 0), local3(mae.q, { x: 0, y: 0 }, 0));
  }
  const g = folga / 2;
  const miterA: Corte = { p: soma3(p0, mul3(n, g)), m: n, canto }, miterB: Corte = { p: soma3(p0, mul3(n, -g)), m: mul3(n, -1), canto };
  (k.a.cortes ??= []).push(miterA);
  (k.b.cortes ??= []).push(miterB);
  if (tipo === "meiaEsquadria" || !melhor) {
    (wA.cortes ??= []).push(miterA);
    (wB.cortes ??= []).push(miterB);
    return true;
  }
  // sobreposta: "cobre" vai até a face de fora da "coberta"; a coberta para na face de dentro
  const [cobre, coberta, fCobre, fCoberta] = tipo === "sobreposto" ? [wA, wB, fA, fB] : [wB, wA, fB, fA];
  const faces = (w: Parede) => [local3(w.q, { x: 0, y: 0 }, 0), local3(w.q, { x: 0, y: 0 }, w.s * t)];
  const dist = (w: Parede, P: Vec3, X: Vec3) => esc3(w.q.n, sub3(X, P));
  const [c0, c1] = faces(coberta);
  const fora = Math.abs(dist(coberta, c0, fCobre)) > Math.abs(dist(coberta, c1, fCobre)) ? c0 : c1;
  const mCobre = mul3(coberta.q.n, Math.sign(dist(coberta, fora, fCobre)) || 1);
  const [k0, k1] = faces(cobre);
  const dentro = Math.abs(dist(cobre, k0, fCoberta)) < Math.abs(dist(cobre, k1, fCoberta)) ? k0 : k1;
  const mCoberta = mul3(cobre.q.n, Math.sign(dist(cobre, dentro, fCoberta)) || 1);
  (cobre.cortes ??= []).push({ p: fora, m: mCobre, canto });
  (coberta.cortes ??= []).push({ p: soma3(dentro, mul3(mCoberta, folga)), m: mCoberta, canto });
  return true;
}

function fecharCanto(f: FeatureFecharCanto, ctx: Ctx) {
  const m = exigirChapaDobrada(ctx, "Fechar canto");
  if (!(f.folga >= 0)) throw new Error("A distância de folga não pode ser negativa.");
  let n = 0;
  for (const k of cantosDaChapa(m, "Fechar canto")) if (tratarCanto(m, k, f.tipoCanto, f.folga)) n++;
  if (!n) throw new Error("Fechar canto: os cantos encontrados são de flanges de meia-esquadria (já fechados pelo perfil).");
}

/**
 * Alívio de canto (2 dobras): recorte centrado no encontro das linhas de centro das dobras
 * (retangular ou circular, tamanho = lado/diâmetro; automático = maior BA + 2t) ou só a região
 * onde as duas dobras se cruzam (rasgado). Tira da parede-mãe, das dobras e das abas — o
 * planificado mostra o mesmo recorte.
 */
function alivioCanto(f: FeatureAlivioCanto, ctx: Ctx) {
  const m = exigirChapa(ctx, "Alívio de canto");
  const t = m.p.t;
  for (const k of cantosDaChapa(m, "Alívio de canto")) {
    const { a, b } = k;
    // ponto em que dA·(X − e0A) = u e dB·(X − e0B) = v
    const det = a.d.x * b.d.y - a.d.y * b.d.x;
    const ponto = (u: number, v: number): P2 => {
      const ra = u + a.d.x * a.e0.x + a.d.y * a.e0.y, rb = v + b.d.x * b.e0.x + b.d.y * b.e0.y;
      return { x: (ra * b.d.y - rb * a.d.y) / det, y: (a.d.x * rb - b.d.x * ra) / det };
    };
    if (f.tipoAlivio === "rasgado") {
      const poli = [ponto(0, 0), ponto(a.ba, 0), ponto(a.ba, b.ba), ponto(0, b.ba)];
      m.aliviar(k, poli, desenhoDoPoligono(poli));
      continue;
    }
    const lado = f.tamanho > 0 ? f.tamanho : Math.max(a.ba, b.ba) + 2 * t;
    const X = ponto(a.ba / 2, b.ba / 2);
    if (f.tipoAlivio === "circular") {
      const c = circuloAlivio(X, lado / 2);
      m.aliviar(k, c.poli, c.desenho);
    } else {
      const h = lado / 2;
      const q = (i: number, j: number): P2 => ({ x: X.x + i * h * a.e.x + j * h * b.e.x, y: X.y + i * h * a.e.y + j * h * b.e.y });
      const poli = [q(-1, -1), q(1, -1), q(1, 1), q(-1, 1)];
      m.aliviar(k, poli, desenhoDoPoligono(poli));
    }
  }
}

/**
 * Quebrar canto: chanfro (distância) ou filete (raio) num canto do contorno de uma parede,
 * escolhido pela aresta da espessura (ou por um vértice). Canto convexo: tira material;
 * côncavo: completa. Vale no 3D e no planificado.
 */
function quebrarCanto(f: FeatureQuebrarCanto, ctx: Ctx) {
  const m = exigirChapa(ctx, "Quebrar canto");
  const t = m.p.t;
  if (!f.arestas.length) throw new Error("Quebrar canto: toque nas arestas da espessura (ou nos vértices) dos cantos.");
  if (!(f.distancia > 0)) throw new Error(`Quebrar canto: ${f.tipoQuebra === "filete" ? "o raio" : "a distância"} deve ser maior que zero.`);
  const peca = exigirPeca(ctx, "Quebrar canto");
  for (const ref of f.arestas) {
    let pts: Vec3[];
    if (ref.tipo === "vertice") pts = [ref.p];
    else if (ref.tipo === "aresta") {
      const ass = assinaturaAresta(acharAresta(peca, ref.ass));
      pts = [ass.a, ass.b];
    } else throw new Error("Quebrar canto: escolha arestas da espessura ou vértices.");
    // parede em que os pontos caem nas faces de cima/baixo com o mesmo (x, y) local
    let achou: { w: Parede; V: P2 } | null = null;
    for (const w of m.paredes) {
      const loc = pts.map((P) => ({ x: esc3(sub3(P, w.q.o), w.q.u), y: esc3(sub3(P, w.q.o), w.q.v), z: esc3(sub3(P, w.q.o), w.q.n) }));
      if (!loc.every((l) => Math.abs(l.z) < 1e-3 || Math.abs(l.z - w.s * t) < 1e-3)) continue;
      if (loc.some((l) => Math.hypot(l.x - loc[0].x, l.y - loc[0].y) > 1e-3)) continue;
      if (ref.tipo === "aresta" && Math.abs(Math.abs(loc[0].z - loc[1].z) - t) > 1e-3) continue;
      achou = { w, V: { x: loc[0].x, y: loc[0].y } };
      break;
    }
    if (!achou) throw new Error("Quebrar canto: escolha a aresta da espessura num canto de uma parede plana da chapa (ou o vértice do canto).");
    const { w, V } = achou;
    // as duas bordas que chegam ao canto (no contorno atual da parede)
    const lacos = lacosDoDesenho(w.forma);
    const lados: { dir: P2; L: number }[] = [];
    for (const l of lacos) {
      for (const e of l.ents) {
        if (e.tipo !== "linha") {
          const toca = [e.p0, e.p1].some((p) => Math.hypot(p.x - V.x, p.y - V.y) < 1e-3);
          if (toca) throw new Error("Quebrar canto: um dos lados do canto é curvo (só cantos entre retas).");
          continue;
        }
        for (const [p, q] of [[e.a, e.b], [e.b, e.a]] as const) {
          if (Math.hypot(p.x - V.x, p.y - V.y) > 1e-3) continue;
          const L = Math.hypot(q.x - p.x, q.y - p.y);
          if (L > 1e-6) lados.push({ dir: { x: (q.x - p.x) / L, y: (q.y - p.y) / L }, L });
        }
      }
    }
    if (lados.length !== 2) throw new Error("Quebrar canto: o ponto escolhido não é um canto do contorno da parede.");
    const [t1, t2] = lados.map((x) => x.dir);
    const alfa = Math.acos(Math.max(-1, Math.min(1, t1.x * t2.x + t1.y * t2.y)));
    if (alfa < 1e-3 || alfa > Math.PI - 1e-3) throw new Error("Quebrar canto: o canto escolhido é reto (180°) ou fechado demais.");
    const ub = unit2({ x: t1.x + t2.x, y: t1.y + t2.y });
    const dentro = (P: P2) => lacos.reduce((n, l) => n + (pontoNoPoligono(P, l.pol) ? 1 : 0), 0) % 2 === 1;
    const convexo = dentro({ x: V.x + ub.x * 1e-3, y: V.y + ub.y * 1e-3 });
    const d = f.tipoQuebra === "filete" ? f.distancia / Math.tan(alfa / 2) : f.distancia;
    if (d >= Math.min(lados[0].L, lados[1].L) - 1e-6) throw new Error(`Quebrar canto: ${f.tipoQuebra === "filete" ? "raio" : "distância"} grande demais para os lados do canto.`);
    const T1 = { x: V.x + t1.x * d, y: V.y + t1.y * d }, T2 = { x: V.x + t2.x * d, y: V.y + t2.y * d };
    const fim = convexo ? { x: V.x - ub.x * (d + t), y: V.y - ub.y * (d + t) } : V;
    let D;
    if (f.tipoQuebra === "chanfro") D = desenhoDoPoligono([T1, T2, fim]);
    else {
      const R = f.distancia, C = { x: V.x + (ub.x * R) / Math.sin(alfa / 2), y: V.y + (ub.y * R) / Math.sin(alfa / 2) };
      const M = { x: C.x - ub.x * R, y: C.y - ub.y * R };
      D = draw([T1.x, T1.y]).threePointsArcTo([T2.x, T2.y], [M.x, M.y]).lineTo([fim.x, fim.y]).close();
    }
    if (convexo) m.recortar(w.id, D);
    else m.somar(w.id, D, []);
  }
}

/** Linhas (não de construção) do esboço da dobra, no espaço. */
function linhasDoEsboco(esbId: string | undefined, ctx: Ctx, oque: string) {
  const esb = esbocoDe(esbId, ctx);
  const rs = referencial(esb.suporte, ctx.planos);
  const pts = mapaPontos(esb);
  const linhas = esb.geos.filter((g) => g.tipo === "linha" && !g.construcao && !g.externa);
  if (!linhas.length) throw new Error(`${oque}: desenhe uma linha no esboço, atravessando a face onde a chapa deve dobrar.`);
  return {
    rs,
    linhas: linhas.map((g) => {
      const l = g as Extract<typeof g, { tipo: "linha" }>;
      return { A: paraMundo(rs, pts.get(l.p1)!.x, pts.get(l.p1)!.y), B: paraMundo(rs, pts.get(l.p2)!.x, pts.get(l.p2)!.y) };
    }),
  };
}

/**
 * Parede da chapa onde está a linha AB (numa face de cima ou de baixo), a linha em coordenadas
 * locais (pa, e) e a normal no plano `d` que aponta para o lado que se move (o menor, ou o
 * maior com `inverterFixo`). Confere que as dobras já feitas na parede ficam do lado fixo.
 */
function linhaNaChapa(m: ModeloChapa, rs: Referencial, A: Vec3, B: Vec3, inverterFixo: boolean, oque: string) {
  const t = m.p.t;
  for (const w of m.paredes) {
    if (Math.abs(Math.abs(esc3(rs.normal, w.q.n)) - 1) > 1e-6) continue;
    const z = esc3(sub3(A, w.q.o), w.q.n);
    if (Math.abs(z) > 1e-4 && Math.abs(z - w.s * t) > 1e-4) continue;
    const loc = (P: Vec3): V2 => ({ x: esc3(sub3(P, w.q.o), w.q.u), y: esc3(sub3(P, w.q.o), w.q.v) });
    const pa = loc(A), pb = loc(B);
    const meio = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    if (!w.contornos.some((c) => pontoNoPoligono(meio, c))) continue;
    const e = unit2({ x: pb.x - pa.x, y: pb.y - pa.y });
    let d = { x: -e.y, y: e.x };
    // lado que se move: o menor (pela área dos contornos), salvo "inverter lado fixo"
    const lado = (sg: number) => w.contornos.reduce((s, c) => {
      const parte = recortarPoligono(c, (q) => sg * ((q.x - pa.x) * d.x + (q.y - pa.y) * d.y));
      return s + (parte.length >= 3 ? Math.abs(areaContorno(parte)) : 0);
    }, 0);
    if ((lado(1) > lado(-1)) !== inverterFixo) d = { x: -d.x, y: -d.y };
    for (const b of m.dobras) {
      if (b.pai !== w.id) continue;
      const mb = { x: b.e0.x + (b.e.x * (b.s0 + b.s1)) / 2, y: b.e0.y + (b.e.y * (b.s0 + b.s1)) / 2 };
      if ((mb.x - pa.x) * d.x + (mb.y - pa.y) * d.y > 1e-6) {
        throw new Error(`${oque}: há flanges no lado que vai dobrar. Faça este recurso antes delas na árvore (ou inverta o lado fixo).`);
      }
    }
    return { w, pa, e, d, noTopo: Math.abs(z - w.s * t) <= 1e-4 };
  }
  throw new Error(`${oque}: a linha precisa estar numa face plana da chapa (de cima ou de baixo de uma parede).`);
}

/** Onde começa a faixa da dobra em relação à linha do esboço (ao longo de d). */
function inicioDaDobra(posicao: FeatureDobraEsboco["posicao"], theta: number, r: number, t: number, ba: number) {
  return posicao === "centro" ? -ba / 2 : posicao === "dobraExterna" ? 0 : -recuo(posicao, theta, r, t);
}

/**
 * Dobra esboçada: cada linha do esboço (numa face plana da chapa) dobra a parede ali. O lado
 * maior fica parado (ou o outro, com "inverter lado fixo"); a posição diz onde fica a faixa da
 * dobra em relação à linha: centrada, material interno/externo ou dobra externa.
 */
function dobraEsboco(f: FeatureDobraEsboco, ctx: Ctx) {
  const m = exigirChapaDobrada(ctx, "A dobra esboçada");
  if (!(f.angulo > 0 && f.angulo <= 180)) throw new Error("O ângulo da dobra fica entre 0° e 180°.");
  const { rs, linhas } = linhasDoEsboco(f.esboco, ctx, "Dobra esboçada");
  const t = m.p.t, theta = grausRad(f.angulo);
  const r = f.raioProprio ? f.raio : m.p.r;
  if (!(r > 0)) throw new Error("O raio de dobra deve ser maior que zero.");
  const a = inicioDaDobra(f.posicao, theta, r, t, theta * (r + m.p.k * t));
  linhas.forEach(({ A, B }, i) => {
    const l = linhaNaChapa(m, rs, A, B, f.inverterFixo, "Dobra esboçada");
    m.dobrarPorLinha({
      pai: l.w, idDobra: `${f.id}:d${i}`, idFilha: `${f.id}:${i}`, p0: l.pa, e: l.e, d: l.d, a, theta, r,
      paraMaterial: l.noTopo !== f.inverter,
    });
  });
}

/**
 * Junta: em cada linha, uma dobra de ângulo θ e, depois de um trecho reto, outra de −θ que
 * devolve a chapa paralela à original, deslocada da altura pedida. Altura entre faces do
 * mesmo lado: Z = (2R + t)(1 − cos θ) + L·sen θ, de onde sai o trecho reto L.
 */
function junta(f: FeatureJunta, ctx: Ctx) {
  const m = exigirChapaDobrada(ctx, "A junta");
  if (!(f.angulo > 0 && f.angulo < 180)) throw new Error("O ângulo da junta fica entre 0° e 180° (sem incluir).");
  const { rs, linhas } = linhasDoEsboco(f.esboco, ctx, "Junta");
  const t = m.p.t, theta = grausRad(f.angulo);
  const r = f.raioProprio ? f.raio : m.p.r;
  if (!(r > 0)) throw new Error("O raio de dobra deve ser maior que zero.");
  const Z = f.medicao === "interno" ? f.deslocamento + t : f.medicao === "total" ? f.deslocamento - t : f.deslocamento;
  const L = (Z - (2 * r + t) * (1 - Math.cos(theta))) / Math.sin(theta);
  if (!(L >= -1e-9)) {
    const min = (2 * r + t) * (1 - Math.cos(theta)) + (f.medicao === "interno" ? -t : f.medicao === "total" ? t : 0);
    throw new Error(`Junta: deslocamento pequeno demais para o raio e a espessura (mínimo ${Number(min.toFixed(2))} mm).`);
  }
  const a = inicioDaDobra(f.posicao, theta, r, t, theta * (r + m.p.k * t));
  linhas.forEach(({ A, B }, i) => {
    const l = linhaNaChapa(m, rs, A, B, f.inverterFixo, "Junta");
    const subida = m.dobrarPorLinha({
      pai: l.w, idDobra: `${f.id}:d${i}a`, idFilha: `${f.id}:${i}a`, p0: l.pa, e: l.e, d: l.d, a, theta, r,
      paraMaterial: l.noTopo !== f.inverter,
    });
    // segunda dobra: depois do trecho reto, volta para a direção original (para o lado de d)
    const d3 = soma3(mul3(l.w.q.u, l.d.x), mul3(l.w.q.v, l.d.y));
    try {
      m.dobrarPorLinha({
        pai: subida, idDobra: `${f.id}:d${i}b`, idFilha: `${f.id}:${i}b`, p0: { x: 0, y: Math.max(0, L) }, e: { x: 1, y: 0 }, d: { x: 0, y: 1 },
        a: 0, theta, r, paraMaterial: esc3(subida.q.n, d3) * subida.s > 0,
      });
    } catch {
      throw new Error("Junta: o lado que se move é curto demais para as duas dobras (diminua o deslocamento ou mude a linha).");
    }
  });
}

/** Aba (soma) ou corte (tira) a partir de um esboço feito numa face plana da chapa. */
function abaOuCorte(f: FeatureAbaChapa, ctx: Ctx) {
  const corte = f.tipo === "corteChapa";
  const m = exigirChapa(ctx, corte ? "O corte na chapa" : "A aba");
  const esb = esbocoDe(f.esboco, ctx);
  const rs = referencial(esb.suporte, ctx.planos);
  const t = m.p.t;
  const D = desenhoDoEsboco(esb);
  const lacos = encontrarLacos(esb);
  let usou = false;
  for (const w of m.paredes) {
    if (Math.abs(Math.abs(esc3(rs.normal, w.q.n)) - 1) > 1e-6) continue;
    const z = esc3(sub3(rs.origem, w.q.o), w.q.n);
    if (Math.abs(z) > 1e-4 && Math.abs(z - w.s * t) > 1e-4) continue;
    // esboço → coordenadas locais da parede (giro ou espelho + translação)
    const a = esc3(rs.x, w.q.u), b = esc3(rs.y, w.q.u), c = esc3(rs.x, w.q.v), d = esc3(rs.y, w.q.v);
    const tx = esc3(sub3(rs.origem, w.q.o), w.q.u), ty = esc3(sub3(rs.origem, w.q.o), w.q.v);
    const Dl = transformarDesenho(D, a, b, c, d, tx, ty);
    if (corte) {
      m.recortar(w.id, Dl);
      // dobras desdobradas que continuam esta parede: o corte também vale nelas
      const conts = lacos.map((l) => l.poligono.map((p) => ({ x: a * p.x + b * p.y + tx, y: c * p.x + d * p.y + ty })));
      for (const db of m.dobras) if (db.pai === w.id && m.planas.has(db.id)) m.cortarDobraPlana(db, Dl, conts);
    } else {
      const conts = lacos.map((l) => l.poligono.map((p) => ({ x: a * p.x + b * p.y + tx, y: c * p.x + d * p.y + ty })));
      m.somar(w.id, Dl, conts);
      usou = true;
      break; // a aba entra numa parede só
    }
    usou = true;
  }
  if (!usou) throw new Error("Faça o esboço numa face plana da chapa (de cima ou de baixo de uma parede).");
}

// ---------- desdobrar / dobrar (docs/funcional/chapa.md §11) ----------

function desdobrar(f: FeatureDesdobrar, ctx: Ctx) {
  const m = exigirChapa(ctx, "Desdobrar");
  const peca = exigirPeca(ctx, "Desdobrar");
  let fixa: string | undefined;
  if (f.faceFixa) {
    if (f.faceFixa.tipo !== "face") throw new Error("Desdobrar: a face fixa precisa ser uma face plana da chapa.");
    const a = assinaturaFace(acharFace(peca, f.faceFixa.ass));
    const w = a.geom === "plano" && a.normal ? m.paredeDaFace(a.centro, a.normal) : undefined;
    if (!w) throw new Error("Desdobrar: a face fixa precisa ser uma face plana de uma parede da chapa (não de uma dobra).");
    fixa = w.id;
  }
  let ids: string[];
  if (f.todas) ids = m.dobras.map((b) => b.id);
  else {
    if (!f.dobras.length) throw new Error("Desdobrar: toque nas faces curvas das dobras (ou marque Coletar todas as dobras).");
    ids = f.dobras.map((ref) => {
      if (ref.tipo !== "face") throw new Error("Desdobrar: escolha as faces curvas das dobras.");
      const a = assinaturaFace(acharFace(peca, ref.ass));
      const b = a.geom === "cilindro" && a.eixo && a.pontoEixo ? m.dobraDoEixo(a.pontoEixo, a.eixo) : undefined;
      if (!b) throw new Error("Desdobrar: a face escolhida não é a face curva de uma dobra.");
      return b.id;
    });
  }
  if (!ids.length) throw new Error("Desdobrar: a chapa não tem dobras.");
  m.desdobrar(ids, fixa);
}

// ---------- converter em chapa (docs/funcional/chapa.md §13) ----------

/** Contornos de uma face plana (externo primeiro) em 3D; círculos inteiros ficam exatos. */
function lacosDaFace(face: Face): { lacos: Vec3[][]; circulos: { c: Vec3; r: number }[] } {
  const ponto = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
  const perto = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-5;
  const lacos: Vec3[][] = [], circulos: { c: Vec3; r: number }[] = [];
  // outerWire/innerWires apagam a face (que fica no cache da topologia): usa cópias
  for (const fio of [face.clone().outerWire(), ...face.clone().innerWires()]) {
    const trechos = fio.edges.map((e) => {
      if (e.geomType === "LINE") return [ponto(e.startPoint), ponto(e.endPoint)];
      return Array.from({ length: 17 }, (_, i) => ponto(e.pointAt(i / 16)));
    });
    if (trechos.length === 1 && perto(trechos[0][0], trechos[0][trechos[0].length - 1])) {
      const ass = assinaturaAresta(fio.edges[0]);
      if (ass.geom === "circulo" && ass.centro && ass.raio) {
        circulos.push({ c: ass.centro, r: ass.raio });
        continue;
      }
    }
    // encadeia os trechos (cada um pode vir no sentido contrário)
    const resto = trechos.slice(1), laco = [...trechos[0]];
    while (resto.length) {
      const fim = laco[laco.length - 1];
      const i = resto.findIndex((t) => perto(t[0], fim) || perto(t[t.length - 1], fim));
      if (i < 0) break;
      const [t] = resto.splice(i, 1);
      laco.push(...(perto(t[0], fim) ? t : t.slice().reverse()).slice(1));
    }
    if (perto(laco[0], laco[laco.length - 1])) laco.pop();
    if (laco.length >= 3) lacos.push(laco);
  }
  return { lacos, circulos };
}

/**
 * Converter em chapa: a face fixa e as faces planas ligadas a ela pelas arestas de dobra viram
 * paredes (espessura para dentro do sólido, ou para fora), com dobras de raio R nas arestas
 * escolhidas (canto vivo virtual na face do sólido). Arestas entre paredes que não dobram viram
 * rasgos com folga; cantos entre abas vizinhas ficam em meia-esquadria.
 */
function converterChapa(f: FeatureConverterChapa, ctx: Ctx): ModeloChapa {
  const oque = "Converter em chapa";
  if (!(f.espessura > 0)) throw new Error("A espessura da chapa deve ser maior que zero.");
  if (!(f.raio >= 0)) throw new Error("O raio de dobra não pode ser negativo.");
  if (!(f.fatorK >= 0 && f.fatorK <= 1)) throw new Error("O fator K fica entre 0 e 1 (típico 0,3 a 0,5).");
  if (ctx.chapa) throw new Error(`${oque}: a peça já é de chapa.`);
  const peca = exigirPeca(ctx, oque);
  if (!f.faceFixa || f.faceFixa.tipo !== "face") throw new Error(`${oque}: escolha a face fixa (uma face plana do sólido).`);
  const { faces, arestas, topo } = topologia(peca);
  const indiceDe = <T extends Face | Edge>(lista: T[], x: T) => lista.findIndex((y) => y.isSame(x));
  const iFixa = indiceDe(faces, acharFace(peca, f.faceFixa.ass));
  if (iFixa < 0 || topo.faces[iFixa].geom !== "plano") throw new Error(`${oque}: a face fixa precisa ser plana.`);
  const t = f.espessura, R = f.raio;
  const plana = (i: number) => topo.faces[i].geom === "plano" && !!topo.faces[i].normal;
  const facesDaAresta = (k: number) => topo.arestasDaFace!.flatMap((l, i) => (l.includes(k) ? [i] : []));
  // arestas de dobra: cada uma entre duas faces planas
  const dobrasK = new Set<number>();
  for (const ref of f.arestas) {
    if (ref.tipo !== "aresta") throw new Error(`${oque}: as arestas de dobra precisam ser arestas retas do sólido.`);
    const k = indiceDe(arestas, acharAresta(peca, ref.ass));
    const fs = facesDaAresta(k);
    if (topo.arestas[k]?.geom !== "linha" || fs.length !== 2 || !fs.every(plana)) {
      throw new Error(`${oque}: cada aresta de dobra precisa ser reta e ficar entre duas faces planas.`);
    }
    dobrasK.add(k);
  }
  // paredes: faces ligadas à fixa pelas dobras (árvore em largura)
  const pai = new Map<number, { face: number; aresta: number }>();
  const ordem = [iFixa];
  for (let q = 0; q < ordem.length; q++) {
    for (const k of topo.arestasDaFace![ordem[q]]) {
      if (!dobrasK.has(k)) continue;
      for (const j of facesDaAresta(k)) {
        if (j === ordem[q] || ordem.includes(j)) continue;
        pai.set(j, { face: ordem[q], aresta: k });
        ordem.push(j);
      }
    }
  }
  if (pai.size < [...dobrasK].length) throw new Error(`${oque}: toda aresta de dobra precisa ligar (direta ou indiretamente) à face fixa, sem formar um anel.`);
  const N = (i: number) => topo.faces[i].normal!;
  const geo = new Map(ordem.map((i) => [i, lacosDaFace(faces[i])]));
  const centro = (i: number): Vec3 => {
    const l = geo.get(i)!.lacos[0];
    return mul3(l.reduce((a, p) => soma3(a, p), [0, 0, 0] as Vec3), 1 / l.length);
  };
  // cada dobra: ângulo, lado e recuo (canto vivo virtual na face do sólido)
  const s0: 1 | -1 = f.inverter ? 1 : -1; // −1: material para dentro (normal da face aponta para fora)
  const para = (i: number, k: number) => {
    // direção no plano da face i, perpendicular à aresta k, apontando para dentro da face
    const A = topo.arestas[k];
    const e = normalizar(sub3(A.b, A.a));
    let w = cruz(N(i), e);
    if (esc3(w, sub3(centro(i), A.a)) < 0) w = mul3(w, -1);
    return { e, w, a: A.a, b: A.b };
  };
  const infoDobra = new Map<number, { theta: number; paraMaterial: boolean; recuo: number }>();
  for (const [filha, { face: mae, aresta: k }] of pai) {
    const pm = para(mae, k), pf = para(filha, k);
    const d3 = mul3(pm.w, -1); // sai da mãe pela aresta
    const theta = Math.acos(Math.max(-1, Math.min(1, esc3(d3, pf.w))));
    if (theta < grausRad(1) || theta > grausRad(175)) throw new Error(`${oque}: o ângulo entre as faces de uma aresta de dobra precisa ficar entre 1° e 175°.`);
    const paraMaterial = esc3(pf.w, mul3(N(mae), s0)) > 0;
    infoDobra.set(k, { theta, paraMaterial, recuo: (paraMaterial ? R + t : R) * Math.tan(theta / 2) });
  }
  // contorno de cada face recortado nas suas arestas de dobra (recuo dos dois lados)
  const recorte = (i: number, P: Vec3[]) => {
    let pol = P;
    for (const k of topo.arestasDaFace![i]) {
      const inf = infoDobra.get(k);
      if (!inf) continue;
      const { w, a } = para(i, k);
      pol = recortarPoligono3(pol, (x) => esc3(sub3(x, a), w) - inf.recuo);
    }
    return pol;
  };
  const m = new ModeloChapa({ t, r: R, k: f.fatorK });
  const preencher = (w: Parede, i: number) => {
    const g = geo.get(i)!;
    const loc = (x: Vec3): P2 => ({ x: esc3(sub3(x, w.q.o), w.q.u), y: esc3(sub3(x, w.q.o), w.q.v) });
    const conts = g.lacos.map((l) => recorte(i, l).map(loc)).filter((c) => c.length >= 3);
    if (!conts.length) throw new Error(`${oque}: uma face ficou pequena demais para as dobras (raio + espessura).`);
    let D = desenhoDoPoligono(conts[0]);
    for (const c of conts.slice(1)) D = D.cut(desenhoDoPoligono(c));
    for (const c of g.circulos) {
      const p = loc(c.c);
      D = D.cut(drawCircle(c.r).translate(p.x, p.y));
      conts.push(Array.from({ length: 48 }, (_, j) => ({ x: p.x + c.r * Math.cos((j * Math.PI) / 24), y: p.y + c.r * Math.sin((j * Math.PI) / 24) })));
    }
    w.forma = D;
    w.contornos = conts;
  };
  const paredeDe = new Map<number, Parede>();
  const n0 = N(iFixa), u0 = eixoXParaNormal(n0);
  const raiz = m.raiz(`${f.id}:${iFixa}`, { o: centro(iFixa), u: u0, v: cruz(n0, u0), n: n0 }, s0, retanguloDesenho(0, 1, 0, 1), []);
  preencher(raiz, iFixa);
  paredeDe.set(iFixa, raiz);
  for (const i of ordem.slice(1)) {
    const { face: mae, aresta: k } = pai.get(i)!;
    const P = paredeDe.get(mae)!, inf = infoDobra.get(k)!;
    const loc = (x: Vec3): P2 => ({ x: esc3(sub3(x, P.q.o), P.q.u), y: esc3(sub3(x, P.q.o), P.q.v) });
    const pa = loc(topo.arestas[k].a), pb = loc(topo.arestas[k].b);
    const L = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const e = { x: (pb.x - pa.x) / L, y: (pb.y - pa.y) / L };
    const cm = loc(centro(mae));
    let d = { x: e.y, y: -e.x };
    if ((cm.x - pa.x) * d.x + (cm.y - pa.y) * d.y > 0) d = { x: -d.x, y: -d.y };
    const filha = m.dobrar({
      pai: P, idDobra: `${f.id}:d${k}`, idFilha: `${f.id}:${i}`, e0: { x: pa.x - d.x * inf.recuo, y: pa.y - d.y * inf.recuo }, e, d,
      s0: 0, s1: L, theta: inf.theta, r: R, paraMaterial: inf.paraMaterial, forma: retanguloDesenho(0, 1, 0, 1), contornos: [],
    });
    // a filha precisa cair no plano da face do sólido (confere a conta da dobra)
    if (Math.abs(Math.abs(esc3(filha.q.n, N(i))) - 1) > 1e-6 || Math.abs(esc3(sub3(filha.q.o, topo.arestas[k].a), N(i))) > 1e-4) {
      throw new Error(`${oque}: não consegui posicionar a parede depois de uma dobra (geometria não suportada).`);
    }
    preencher(filha, i);
    paredeDe.set(i, filha);
  }
  // cantos entre abas vizinhas: meia-esquadria (paredes e dobras)
  const tratadas = new Set<string>();
  for (const k of m.cantos()) {
    if (tratarCanto(m, k, "meiaEsquadria", f.folga)) tratadas.add([k.a.filha, k.b.filha].sort().join("|"));
  }
  // rasgos: arestas entre duas paredes que não dobram → corte pelo plano bissetor, com folga
  const g = f.folga / 2;
  topo.arestas.forEach((A, k) => {
    if (dobrasK.has(k)) return;
    const fs = facesDaAresta(k).filter((i) => paredeDe.has(i));
    if (fs.length !== 2) return;
    const [wa, wb] = fs.map((i) => paredeDe.get(i)!);
    if (tratadas.has([wa.id, wb.id].sort().join("|"))) return;
    const ca = centro(fs[0]), cb = centro(fs[1]);
    let melhor: Vec3 | null = null, sep = 0;
    for (const n of [sub3(N(fs[0]), N(fs[1])), soma3(N(fs[0]), N(fs[1]))]) {
      if (Math.hypot(...n) < 1e-6) continue;
      const u = normalizar(n);
      const va = esc3(sub3(ca, A.a), u), vb = esc3(sub3(cb, A.a), u);
      if (va * vb < 0 && Math.min(Math.abs(va), Math.abs(vb)) > sep) (sep = Math.min(Math.abs(va), Math.abs(vb))), (melhor = mul3(u, Math.sign(va)));
    }
    if (!melhor) return;
    (wa.cortes ??= []).push({ p: soma3(A.a, mul3(melhor, g)), m: melhor });
    (wb.cortes ??= []).push({ p: soma3(A.a, mul3(melhor, -g)), m: mul3(melhor, -1) });
  });
  return m;
}

/** Recorta um polígono 3D (plano) no semiespaço f(x) ≥ 0. */
function recortarPoligono3(c: Vec3[], f: (x: Vec3) => number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < c.length; i++) {
    const p = c[i], q = c[(i + 1) % c.length];
    const fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) out.push(soma3(p, mul3(sub3(q, p), fp / (fp - fq))));
  }
  return out;
}

// ---------- curvas 3D ----------

function curvaRecurso(f: FeatureCurva, ctx: Ctx): Trecho[] {
  switch (f.modo) {
    case "helice": {
      if (f.base?.tipo !== "esboco") throw new Error("Escolha o esboço com o círculo de base da hélice.");
      const esb = esbocoDe(f.base.id, ctx);
      const r = referencial(esb.suporte, ctx.planos);
      const pts = mapaPontos(esb);
      const c = esb.geos.find((g) => g.tipo === "circulo") ?? esb.geos.find((g) => g.tipo === "arco");
      if (!c || (c.tipo !== "circulo" && c.tipo !== "arco")) throw new Error("O esboço da hélice precisa de um círculo (diâmetro e centro da hélice).");
      const cc = pts.get(c.c)!;
      const raio = c.tipo === "circulo" ? c.r : Math.hypot(pts.get(c.ini)!.x - cc.x, pts.get(c.ini)!.y - cc.y);
      return [{ tipo: "pontos", pts: pontosHelice(f, { c: paraMundo(r, cc.x, cc.y), r: raio, normal: r.normal, x: r.x }) }];
    }
    case "xyz":
      return curvaPorPontos(lerPontosXYZ(f.pontosTexto), f.fechada);
    case "pontosRef": {
      if (f.pontos.length < 2) throw new Error("Escolha pelo menos 2 pontos (vértices) em ordem.");
      return curvaPorPontos(f.pontos.map((p) => pontoDeRef(p, ctx)), f.fechada);
    }
    case "composta": {
      if (!f.itens.length) throw new Error("Escolha os esboços, arestas ou curvas a juntar.");
      // ligadas pelas pontas numa cadeia única (erro claro se houver vão ou ramificação)
      return encadear(trechosDe(f.itens, ctx, "A curva composta"), null).trechos;
    }
    case "projetada": {
      if (f.esboco?.tipo !== "esboco") throw new Error("Escolha o esboço a projetar.");
      const e1 = esbocoDe(f.esboco.id, ctx);
      const r1 = referencial(e1.suporte, ctx.planos);
      const arestas1 = trechosDoEsboco(e1, r1).map(arestaDe);
      if (!arestas1.length) throw new Error("O esboço a projetar não tem curvas (só construção?).");
      const L = tamanhoCena(ctx);
      if (f.projecao === "esbocoEmEsboco") {
        if (f.esboco2?.tipo !== "esboco") throw new Error("Escolha o segundo esboço.");
        const e2 = esbocoDe(f.esboco2.id, ctx);
        const r2 = referencial(e2.suporte, ctx.planos);
        return cruzarEsbocos(arestas1, r1.normal, trechosDoEsboco(e2, r2).map(arestaDe), r2.normal, L);
      }
      const peca = exigirPeca(ctx, "A curva projetada em faces");
      if (!f.faces.length) throw new Error("Escolha as faces onde projetar.");
      const faces = f.faces.map((x) => {
        if (x.tipo !== "face") throw new Error("Escolha faces da peça.");
        return acharFace(peca, x.ass);
      });
      return projetarEmFaces(arestas1, f.inverter ? mul3(r1.normal, -1) : r1.normal, faces, L, f.bidirecional);
    }
  }
}

/** Comprimento seguro para "paredes" de projeção: bem maior que a peça. */
function tamanhoCena(ctx: Ctx): number {
  try {
    const b = (ctx.peca?.boundingBox as unknown as { bounds: [Vec3, Vec3] } | undefined)?.bounds;
    if (b) return Math.max(100, 4 * Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]));
  } catch {
    /* sem peça: valor padrão */
  }
  return 2000;
}

// ---------- varredura ----------

/** Trechos de curva de uma lista de referências: esboços e/ou arestas do modelo. */
function trechosDe(refs: Referencia[], ctx: Ctx, oque: string): Trecho[] {
  const out: Trecho[] = [];
  for (const r of refs) {
    if (r.tipo === "esboco") {
      const esb = esbocoDe(r.id, ctx);
      out.push(...trechosDoEsboco(esb, referencial(esb.suporte, ctx.planos)));
    } else if (r.tipo === "aresta") {
      out.push(trechoDaAresta(acharAresta(exigirPeca(ctx, oque), r.ass)));
    } else if (r.tipo === "curva") {
      const c = ctx.curvas.get(r.id);
      if (!c) throw new Error(`${oque}: a curva precisa vir antes deste recurso (e não estar suprimida ou com erro).`);
      out.push(...c);
    } else throw new Error(`${oque}: use esboços, arestas ou curvas.`);
  }
  return out;
}

function varredura(f: FeatureVarredura, ctx: Ctx): Shape3D {
  let perfil: { D: Drawing; r: Referencial } | null = null;
  if (f.tipoPerfil === "esboco") {
    if (f.perfil?.tipo !== "esboco") throw new Error("Escolha o perfil: um esboço fechado.");
    const esb = esbocoDe(f.perfil.id, ctx);
    const r = referencial(esb.suporte, ctx.planos);
    // perfil aberto só com recurso fino (vira faixa); fechado: as regiões do esboço
    perfil = { D: f.fino?.ativo ? desenhoFino(esb, null, f.fino) : desenhoDoEsboco(esb), r };
  }
  const trajetoria = trechosDe(f.trajetoria, ctx, "A trajetória");
  if (!trajetoria.length) throw new Error("Escolha a trajetória (esboço ou arestas).");
  return varrer({
    f,
    perfil,
    trajetoria,
    guias: f.guias.map((g) => trechosDe([g], ctx, "A curva-guia")),
    afinar: (D) => desenhoFino(null, D, f.fino!),
    faces: facesDoDesenho,
  });
}

// ---------- loft ----------

function loftRecurso(f: FeatureLoft, ctx: Ctx) {
  const perfis = f.perfis.map((ref) => {
    if (ref.tipo !== "esboco") throw new Error("Perfis do loft: escolha esboços.");
    const esb = esbocoDe(ref.id, ctx);
    const r = referencial(esb.suporte, ctx.planos);
    const D = f.fino?.ativo ? desenhoFino(esb, null, f.fino) : desenhoDoEsboco(esb);
    return { faces: facesDoDesenho(D, r), normal: r.normal };
  });
  const vetor = (rest: FeatureLoft["restricaoInicio"]): Vec3 | null => {
    if (rest.tipo !== "vetor" || !rest.ref) return null;
    const ref = rest.ref;
    if (ref.tipo === "aresta" || ref.tipo === "eixo") return eixoDeRef(ref, ctx).dir;
    return planoDeRef(ref, ctx).normal;
  };
  return lofting({
    f,
    perfis,
    guias: f.guias.map((g) => trechosDe([g], ctx, "A curva-guia")),
    linhaCentro: f.linhaCentro.length ? trechosDe(f.linhaCentro, ctx, "A linha de centro") : null,
    vetorInicio: vetor(f.restricaoInicio),
    vetorFim: vetor(f.restricaoFim),
  });
}

/** Desenho 2D no plano → faces (várias regiões → várias faces; furos ficam na face). */
function facesDoDesenho(D: Drawing, r: Referencial): Face[] {
  const s = noPlano(D, r) as unknown as { faces?: () => { faces: Face[] }; face(): Face };
  return typeof s.faces === "function" ? s.faces().faces : [s.face()];
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

/**
 * Falha fatal do WebAssembly (acesso fora da memória, divisão por zero, função nula…): depois
 * dela a memória do OpenCascade pode ficar corrompida e toda regeneração seguinte falha. Quem
 * chama precisa reiniciar o kernel (ver regenerarComRecuperacao).
 */
export class KernelQuebrado extends Error {
  constructor(public culpado: string | null, causa: string) {
    super(`Falha interna do kernel: ${causa}`);
  }
}

const FATAL = /memory access out of bounds|table index is out of bounds|null function|function signature mismatch|unreachable|remainder by zero|divide by zero|integer overflow|call stack|out of memory|Aborted/i;
export function ehFatal(e: unknown): boolean {
  const W = (globalThis as { WebAssembly?: { RuntimeError?: new () => Error } }).WebAssembly;
  return (!!W?.RuntimeError && e instanceof W.RuntimeError) || (e instanceof Error && FATAL.test(e.message));
}

export function regenerar(features: Feature[], tolerancia = 0.05, opcoes: { planificar?: boolean; previa?: string } = {}): ResultadoRegeneracao {
  try {
    return regenerarBruto(features, tolerancia, opcoes);
  } catch (e) {
    if (e instanceof KernelQuebrado) throw e;
    // falha fora dos recursos (malha, topologia, volume): o recurso culpado é procurado
    throw new KernelQuebrado(null, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Regenera; se o kernel quebrar, reinicia o OpenCascade, suprime o recurso culpado (marcado com
 * erro) e tenta de novo — o resto da peça continua aparecendo. Sem culpado conhecido (a falha foi
 * ao gerar a malha), testa o recurso em edição e depois os últimos da árvore.
 */
export async function regenerarComRecuperacao(
  features: Feature[], tolerancia: number, opcoes: { planificar?: boolean; previa?: string }, reiniciar: () => Promise<void>,
): Promise<ResultadoRegeneracao> {
  let feats = features;
  const extras: ErroFeature[] = [];
  const msg = "O kernel não aguentou este recurso (geometria degenerada) e foi reiniciado. Mude os valores ou exclua o recurso.";
  const candidatos = [opcoes.previa, ...features.filter((f) => !f.suprimida && f.tipo !== "esboco").map((f) => f.id).reverse()].filter((x): x is string => !!x);
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    try {
      const r = regenerar(feats, tolerancia, opcoes);
      r.erros.push(...extras.filter((x) => !r.erros.some((y) => y.id === x.id)));
      return r;
    } catch (e) {
      if (!(e instanceof KernelQuebrado)) throw e;
      await reiniciar();
      ultimaPeca = null;
      ultimaChapa = null;
      const culpado = e.culpado ?? candidatos.find((id) => !extras.some((x) => x.id === id));
      if (!culpado) throw e;
      extras.push({ id: culpado, mensagem: msg });
      feats = feats.map((f) => (f.id === culpado ? { ...f, suprimida: true } : f));
    }
  }
  throw new Error("O kernel falhou várias vezes seguidas: recarregue a página.");
}

function regenerarBruto(features: Feature[], tolerancia: number, opcoes: { planificar?: boolean; previa?: string }): ResultadoRegeneracao {
  const erros: ErroFeature[] = [];
  const tempos: { id: string; ms: number }[] = [];
  const ctx = novoCtx();
  const rastreador = new RastreadorFaces();
  let previaRemovido: MalhaSimples | null | undefined;

  for (const f of features) {
    if (f.suprimida) continue;
    const t0 = performance.now();
    try {
      const antes = ctx.peca;
      regenerarFeature(f, ctx);
      rastreador.registrar(f.id, antes, ctx.peca);
      if (opcoes.previa === f.id) previaRemovido = materialRemovido(antes, ctx.peca, tolerancia);
    } catch (e) {
      // memória do kernel possivelmente corrompida: não dá para continuar nesta instância
      if (ehFatal(e)) throw new KernelQuebrado(f.id, (e as Error).message);
      // A feature com falha é ignorada e a regeneração continua com a peça anterior,
      // como um CAD faz ao marcar a feature em vermelho na árvore.
      erros.push({ id: f.id, mensagem: traduzirErro(e, f.tipo) });
    }
    tempos.push({ id: f.id, ms: performance.now() - t0 });
  }

  ultimaChapa = ctx.chapa;
  // chapa desdobrada no fim da árvore: linhas de dobra sobre as dobras planas
  if (!opcoes.planificar && ctx.chapa?.planas.size) ctx.refsSaida.push({ id: "__dobras", tipo: "curva", linhas: ctx.chapa.linhasDasPlanas() });
  // vista planificada: troca a peça pelo planificado e mostra as linhas de dobra
  let planificada = false;
  if (opcoes.planificar && ctx.chapa) {
    try {
      const { solido, linhas3D } = ctx.chapa.solidoPlanificado();
      ctx.peca = solido;
      ctx.refsSaida.push({ id: "__dobras", tipo: "curva", linhas: linhas3D });
      planificada = true;
    } catch (e) {
      erros.push({ id: "__planificado", mensagem: `Planificado: ${traduzirErro(e)}` });
    }
  }

  // referências para a interface desenhar
  const tam = (caixa(ctx)?.diag ?? 100) * 0.6;
  for (const ri of ctx.refsSaida) {
    if (ri.tipo === "plano") ri.tamanho = Math.max(30, tam);
    else if (ri.tipo === "eixo") ri.comprimento = Math.max(40, tam * 1.4);
  }

  const peca = ctx.peca;
  ultimaPeca = peca;
  if (!peca) return { malha: null, erros, volume: null, topologia: null, referencias: ctx.refsSaida, tempos, facesPorRecurso: {} };

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
    facesPorRecurso: planificada ? {} : rastreador.atribuir(peca),
    previaRemovido: planificada ? null : previaRemovido,
  };
}

/** Material que um recurso tirou da peça (antes − depois), em malha; null se não tirou nada. */
function materialRemovido(antes: Shape3D | null, depois: Shape3D | null, tolerancia: number): MalhaSimples | null {
  if (!antes || !depois || antes === depois) return null;
  try {
    const r = antes.cut(depois);
    let v = 0;
    try {
      v = measureVolume(r);
    } catch {
      v = 0;
    }
    if (!(v > 1e-6)) return null;
    const m = r.mesh({ tolerance: tolerancia * 2, angularTolerance: 20 });
    const a = r.meshEdges({ tolerance: tolerancia * 2, angularTolerance: 20 });
    if (!m.triangles.length) return null;
    return { vertices: Float32Array.from(m.vertices), normais: Float32Array.from(m.normals), triangulos: Uint32Array.from(m.triangles), arestas: Float32Array.from(a.lines) };
  } catch (e) {
    if (ehFatal(e)) throw e;
    return null; // a prévia nunca impede a regeneração
  }
}

let ultimaChapa: ModeloChapa | null = null;

/** Limite de cópias do padrão linear (n1 × n2): acima disso a regeneração trava o aparelho. */
const MAX_COPIAS = 500;

/** DXF do planificado da última regeneração e o resumo para a lista de corte. */
export function exportarDxf(nome: string): { dxf: string; resumo: ResumoPlanificado } {
  if (!ultimaChapa) throw new Error("A peça não tem chapa metálica (comece por uma Flange base).");
  const { desenho, dobras } = ultimaChapa.planificado();
  return dxfDoPlanificado(desenho, dobras, nome, ultimaChapa.p, ultimaChapa.dobras.length);
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
    case "varredura":
      return aplicar(ctx, f.id, [{ tool: varredura(f, ctx), op: f.operacao }]);
    case "loft":
      return aplicar(ctx, f.id, [{ tool: loftRecurso(f, ctx), op: f.operacao }]);
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
      if (!faces.length) {
        // casca fechada: oca por dentro, parede de espessura constante em toda a volta
        // (sólido deslocado para dentro e subtraído; "para fora" desloca para fora e tira o original)
        type ComSolidos = { solids: Shape3D[] };
        const solidos = (peca as unknown as ComSolidos).solids;
        if (!solidos.length) throw new Error("A casca precisa de um sólido.");
        let res: Shape3D | null = null;
        for (const s of solidos) {
          const desloc = makeOffset(s as unknown as Face, f.paraFora ? f.espessura : -f.espessura) as Shape3D;
          const parte = f.paraFora ? desloc.cut(s.clone()) : s.clone().cut(desloc);
          res = res ? res.fuse(parte) : parte;
        }
        if (!res || !(measureVolume(res) > 0)) throw new Error("Não foi possível fazer a casca (espessura grande demais para a peça?).");
        ctx.peca = res;
        return;
      }
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
      if (!(n1 * n2 <= MAX_COPIAS)) throw new Error(`Padrão grande demais (${n1} × ${n2} = ${n1 * n2} instâncias): o máximo é ${MAX_COPIAS}.`);
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
      if (!(n <= 360)) throw new Error(`Padrão grande demais (${n} instâncias): o máximo é 360.`);
      const passo = (f.igual ? (Math.abs(f.angulo) >= 360 ? f.angulo / n : f.angulo / Math.max(1, n - 1)) : f.angulo) * (f.inverter ? -1 : 1);
      // cópias quase no mesmo lugar: o booleano degenera (e pode derrubar o kernel)
      if (n > 1 && !(Math.abs(passo) >= 0.5)) throw new Error(`Ângulo entre as instâncias pequeno demais (${Math.abs(passo).toFixed(3)}°): o mínimo é 0,5°.`);
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

    case "flangeBase":
      ctx.corpoAntesChapa = ctx.peca;
      ctx.opsAposChapa = [];
      ctx.chapa = flangeBase(f, ctx);
      return reconstruirChapa(ctx);
    case "flangeAresta":
      flangeAresta(f, ctx);
      return reconstruirChapa(ctx);
    case "bainha":
      bainha(f, ctx);
      return reconstruirChapa(ctx);
    case "dobraEsboco":
      dobraEsboco(f, ctx);
      return reconstruirChapa(ctx);
    case "junta":
      junta(f, ctx);
      return reconstruirChapa(ctx);
    case "meiaEsquadria":
      meiaEsquadria(f, ctx);
      return reconstruirChapa(ctx);
    case "converterChapa":
      ctx.chapa = converterChapa(f, ctx);
      ctx.corpoAntesChapa = null; // o sólido vira a chapa
      ctx.opsAposChapa = [];
      return reconstruirChapa(ctx);
    case "desdobrar":
      desdobrar(f, ctx);
      return reconstruirChapa(ctx);
    case "dobrar":
      exigirChapa(ctx, "Dobrar").dobrarDeVolta();
      return reconstruirChapa(ctx);
    case "fecharCanto":
      fecharCanto(f, ctx);
      reconstruirChapa(ctx);
      return;
    case "alivioCanto":
      alivioCanto(f, ctx);
      reconstruirChapa(ctx);
      return;
    case "quebrarCanto":
      quebrarCanto(f, ctx);
      reconstruirChapa(ctx);
      return;
    case "abaChapa":
    case "corteChapa":
      abaOuCorte(f, ctx);
      return reconstruirChapa(ctx);
    case "curva": {
      const t = curvaRecurso(f, ctx);
      ctx.curvas.set(f.id, t);
      ctx.refsSaida.push({ id: f.id, tipo: "curva", linhas: polilinhasDe(t, arestaDe) });
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

/** Quando o kernel falha sem texto: o que costuma causar a falha em cada recurso. */
const DICA_FALHA: Partial<Record<Feature["tipo"], string>> = {
  extrusao: "Não foi possível extrudar: confira se o perfil é fechado e sem auto-interseção, e a condição final.",
  revolucao: "Não foi possível revolver: o perfil não pode cruzar o eixo de revolução.",
  filete: "Raio grande demais para as arestas escolhidas (ou arestas que não aceitam filete).",
  chanfro: "Distância grande demais para as arestas escolhidas.",
  casca: "Não foi possível fazer a casca: espessura grande demais para a peça ou face que não pode ser removida.",
  inclinacao: "Não foi possível inclinar essas faces: escolha faces laterais (não paralelas ao plano neutro) e um ângulo menor.",
  nervura: "Não foi possível fazer a nervura: o esboço precisa ficar sobre a peça e a nervura precisa encostar nela.",
  furo: "Não foi possível fazer o furo: confira se os pontos estão sobre a face e a profundidade.",
  varredura: "Não foi possível varrer: o perfil não pode ser maior que a curvatura da trajetória nem se cruzar.",
  loft: "Não foi possível fazer o loft: confira a ordem dos perfis e se eles não se cruzam.",
  padraoLinear: "Não foi possível repetir: as cópias precisam encostar na peça (ou mude o espaçamento).",
  padraoCircular: "Não foi possível repetir: as cópias precisam encostar na peça (ou mude o ângulo/quantidade).",
  espelhar: "Não foi possível espelhar: a cópia precisa encostar na peça ou ficar separada dela sem sobrepor faces.",
};

function traduzirErro(e: unknown, tipo?: Feature["tipo"]): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fillet|chamfer/i.test(msg)) return "Raio/distância grande demais para as arestas escolhidas.";
  if (/shell|thick/i.test(msg)) return "Não foi possível fazer a casca (espessura grande demais para a peça?).";
  if (/draft/i.test(msg)) return "Não foi possível inclinar essas faces (verifique o plano neutro).";
  if (/boolean|fuse|cut|intersect/i.test(msg)) return "Falha na operação booleana.";
  // Exceções C++ do OpenCascade chegam como números ou WebAssembly.Exception, sem texto útil.
  if (typeof e === "number" || /WebAssembly|object/i.test(msg)) {
    return (tipo && DICA_FALHA[tipo]) ?? "O kernel não conseguiu gerar esta geometria (valor grande demais ou perfil inválido).";
  }
  return msg;
}
