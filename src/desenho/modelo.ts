// Modelo do desenho (.wjdrw): modelos referenciados (peça ou montagem embutida, como os componentes
// da montagem), folhas com formato ABNT (NBR 10068), legenda (NBR 10582) e vistas (projeções
// ortográficas no 1º ou 3º diedro). Puro: testado em scripts/teste-desenho.ts.
// Comportamento: docs/funcional/desenho.md.
//
// Coordenadas da folha em mm, origem no canto inferior esquerdo, y para cima. A posição de uma vista
// é o ponto da folha onde cai a origem do modelo: assim vistas alinhadas (projetadas) têm o mesmo
// x (acima/abaixo) ou o mesmo y (esquerda/direita) e o alinhamento se mantém ao mover.

import type { Documento, Vec3 } from "../model";
import type { DocumentoMontagem } from "../montagem/modelo";
import type { Balao, Cota, TabelaLista } from "./anotacoes";

// ---------- formatos e escalas ----------

export type Formato = "A4R" | "A4" | "A3" | "A2" | "A1" | "A0";
/** largura × altura (mm) e margens (NBR 10068: esquerda 25; demais 10 em A0/A1, 7 em A2–A4) */
export const FORMATOS: Record<Formato, { nome: string; l: number; a: number; m: number }> = {
  A4R: { nome: "A4 retrato", l: 210, a: 297, m: 7 },
  A4: { nome: "A4 paisagem", l: 297, a: 210, m: 7 },
  A3: { nome: "A3 paisagem", l: 420, a: 297, m: 7 },
  A2: { nome: "A2 paisagem", l: 594, a: 420, m: 7 },
  A1: { nome: "A1 paisagem", l: 841, a: 594, m: 10 },
  A0: { nome: "A0 paisagem", l: 1189, a: 841, m: 10 },
};
export const MARGEM_ESQUERDA = 25;
export const LEGENDA_LARGURA = 175;
export const LEGENDA_ALTURA = 44;

export interface Retangulo {
  x0: number; y0: number; x1: number; y1: number;
}

/** Moldura (área dentro das margens). */
export function moldura(f: Formato): Retangulo {
  const F = FORMATOS[f];
  return { x0: MARGEM_ESQUERDA, y0: F.m, x1: F.l - F.m, y1: F.a - F.m };
}

/** Legenda no canto inferior direito (em A4 retrato ocupa toda a largura útil). */
export function retanguloLegenda(f: Formato): Retangulo {
  const m = moldura(f);
  // folha estreita (A4 retrato): a legenda ocupa a largura útil inteira
  return { x0: m.x1 - m.x0 - LEGENDA_LARGURA < 40 ? m.x0 : m.x1 - LEGENDA_LARGURA, y0: m.y0, x1: m.x1, y1: m.y0 + LEGENDA_ALTURA };
}

/** Área livre para as vistas (moldura sem a faixa da legenda). */
export function areaUtil(f: Formato): Retangulo {
  const m = moldura(f);
  return { x0: m.x0, y0: m.y0 + LEGENDA_ALTURA, x1: m.x1, y1: m.y1 };
}

/** Escalas normalizadas (NBR 8196): ampliação e redução. */
export const ESCALAS = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

export function rotuloEscala(e: number): string {
  if (e >= 1) return `${fmtNum(e)}:1`;
  return `1:${fmtNum(1 / e)}`;
}
const fmtNum = (v: number) => String(Math.round(v * 1000) / 1000).replace(".", ",");

/** Lê "1:2", "2:1", "1/5" ou "0,5". null se inválido. */
export function lerEscala(t: string): number | null {
  const s = t.trim().replace(",", ".");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  const v = m ? Number(m[1]) / Number(m[2]) : Number(s);
  return Number.isFinite(v) && v > 0 && v <= 1000 ? v : null;
}

// ---------- câmeras das vistas ----------

/** Direção de onde se olha e o "para a direita" da vista (Y para cima no modelo, como no WJCAD). */
export interface Camera {
  olho: Vec3;
  direita: Vec3;
}

export type Orientacao = "frontal" | "posterior" | "superior" | "inferior" | "esquerda" | "direita" | "iso";
export const CAMERAS: Record<Orientacao, Camera> = {
  frontal: { olho: [0, 0, 1], direita: [1, 0, 0] },
  posterior: { olho: [0, 0, -1], direita: [-1, 0, 0] },
  superior: { olho: [0, 1, 0], direita: [1, 0, 0] },
  inferior: { olho: [0, -1, 0], direita: [1, 0, 0] },
  esquerda: { olho: [-1, 0, 0], direita: [0, 0, 1] },
  direita: { olho: [1, 0, 0], direita: [0, 0, -1] },
  iso: { olho: [1, 1, 1], direita: [1, 0, -1] },
};
export const NOME_ORIENTACAO: Record<Orientacao, string> = {
  frontal: "Frontal", posterior: "Posterior", superior: "Superior", inferior: "Inferior", esquerda: "Lateral esquerda", direita: "Lateral direita", iso: "Isométrica",
};

const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const vet = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
const igual = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;

/** "Para cima" da vista (olho × direita). */
export const acima = (c: Camera): Vec3 => norm(vet(norm(c.olho), norm(c.direita)));

/** Nome da orientação padrão igual à câmera (ou null). */
export function orientacaoDe(c: Camera): Orientacao | null {
  for (const [k, v] of Object.entries(CAMERAS) as [Orientacao, Camera][]) if (igual(norm(v.olho), norm(c.olho)) && igual(norm(v.direita), norm(c.direita))) return k;
  return null;
}

export type Lado = "direita" | "esquerda" | "acima" | "abaixo" | "diagonal";

/**
 * Câmera da vista projetada colocada ao lado da vista mãe. 1º diedro (ABNT): a vista da esquerda
 * fica à direita, a de cima fica abaixo; 3º diedro: cada vista fica do lado de onde se olha.
 * Diagonal = isométrica pelo canto correspondente.
 */
export function cameraProjetada(mae: Camera, lado: Lado, diedro: 1 | 3, diag: { dx: number; dy: number } = { dx: 1, dy: 1 }): Camera {
  const o = norm(mae.olho), r = norm(mae.direita), u = acima(mae);
  const s = diedro === 1 ? -1 : 1; // 1º diedro: a vista fica do lado oposto ao de onde se olha
  switch (lado) {
    case "direita": return s > 0 ? { olho: r, direita: neg(o) } : { olho: neg(r), direita: o };
    case "esquerda": return s > 0 ? { olho: neg(r), direita: o } : { olho: r, direita: neg(o) };
    case "acima": return { olho: s > 0 ? u : neg(u), direita: r };
    case "abaixo": return { olho: s > 0 ? neg(u) : u, direita: r };
    case "diagonal": {
      // isométrica: olha do canto (direita/esquerda, cima/baixo) para onde se arrastou
      const sx = Math.sign(diag.dx) || 1, sy = Math.sign(diag.dy) || 1;
      const ol = norm([o[0] + sx * r[0] + sy * u[0], o[1] + sx * r[1] + sy * u[1], o[2] + sx * r[2] + sy * u[2]]);
      // "direita" da isométrica: horizontal da mãe projetado no plano da nova vista
      const d = norm(vet(u, ol));
      return { olho: ol, direita: Math.hypot(...d) > 1e-6 ? d : r };
    }
  }
}

/** Lado da vista mãe em que caiu o ponto (folha), pela posição em relação à caixa da mãe. */
export function ladoDoPonto(caixa: Retangulo, x: number, y: number): Lado {
  const fx = x < caixa.x0 ? -1 : x > caixa.x1 ? 1 : 0;
  const fy = y < caixa.y0 ? -1 : y > caixa.y1 ? 1 : 0;
  if (fx && fy) return "diagonal";
  if (fx > 0) return "direita";
  if (fx < 0) return "esquerda";
  if (fy > 0) return "acima";
  if (fy < 0) return "abaixo";
  // dentro da caixa: pelo eixo de maior afastamento do centro
  const cx = (caixa.x0 + caixa.x1) / 2, cy = (caixa.y0 + caixa.y1) / 2;
  const ax = (x - cx) / Math.max(1, caixa.x1 - caixa.x0), ay = (y - cy) / Math.max(1, caixa.y1 - caixa.y0);
  return Math.abs(ax) >= Math.abs(ay) ? (ax >= 0 ? "direita" : "esquerda") : ay >= 0 ? "acima" : "abaixo";
}

// ---------- documento ----------

export interface ModeloDesenho {
  id: string;
  nome: string;
  tipo: "peca" | "montagem";
  /** id do arquivo no cofre (WJPDM) e versão lida */
  arquivo?: string;
  versao?: number;
  /** impressão digital do conteúdo (atualização associativa) */
  marca?: string;
  doc: Documento | DocumentoMontagem;
}

export type EstiloVista = "ocultas" | "sem-ocultas" | "arame";
export const NOME_ESTILO: Record<EstiloVista, string> = {
  ocultas: "Linhas ocultas visíveis (tracejadas)",
  "sem-ocultas": "Linhas ocultas removidas",
  arame: "Arame (todas contínuas)",
};

export interface VistaDesenho {
  id: string;
  nome: string;
  modelo: string;
  camera: Camera;
  /** ponto da folha (mm) onde cai a origem do modelo */
  x: number;
  y: number;
  /** escala própria; ausente = escala da folha */
  escala?: number;
  estilo: EstiloVista;
  /** vista projetada: segue a mãe no eixo de alinhamento */
  mae?: string;
  lado?: Lado;
  marcasCentro?: boolean;
  /** rótulo embaixo da vista (nome e escala); padrão: só quando a escala difere da folha */
  rotulo?: boolean;
  /** vista de seção: plano de corte por `p` com normal = olho da vista (o lado de quem olha sai) */
  secao?: { p: Vec3; letra: string; mae: string };
  /** vista de detalhe: círculo (centro e raio no plano da vista, mm do modelo) da vista mãe */
  detalhe?: { mae: string; cx: number; cy: number; r: number; letra: string };
  /** montagem na posição explodida (passos da vista explodida) */
  explodida?: boolean;
  /** peça de chapa planificada (com as linhas de dobra) */
  planificada?: boolean;
}

/** Letras de seção e detalhe (ABNT: sem I, O e Q, que se confundem com números). */
const LETRAS = "ABCDEFGHJKLMNPRSTUVWXYZ";
export function proximaLetra(d: DocumentoDesenho): string {
  const usadas = new Set(d.folhas.flatMap((f) => f.vistas.flatMap((v) => [v.secao?.letra, v.detalhe?.letra])).filter(Boolean));
  for (const l of LETRAS) if (!usadas.has(l)) return l;
  for (const a of LETRAS) for (const b of LETRAS) if (!usadas.has(a + b)) return a + b;
  return "?";
}

/** Plano de corte da seção a partir da linha tocada na vista mãe (coordenadas do plano da mãe). */
export function pontoNaVista(mae: Camera, x: number, y: number): Vec3 {
  const r = norm(mae.direita), u = acima(mae);
  return [r[0] * x + u[0] * y, r[1] * x + u[1] * y, r[2] * x + u[2] * y];
}

/** Ponto 3D → plano da vista (x para a direita, y para cima). */
export function naVista(c: Camera, p: Vec3): [number, number] {
  const o = norm(c.olho);
  let r = norm(c.direita);
  const k = r[0] * o[0] + r[1] * o[1] + r[2] * o[2];
  r = norm([r[0] - o[0] * k, r[1] - o[1] * k, r[2] - o[2] * k]);
  const u = norm(vet(o, r));
  return [p[0] * r[0] + p[1] * r[1] + p[2] * r[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2]];
}

export interface Nota {
  id: string;
  x: number;
  y: number;
  texto: string;
  /** altura do texto (mm): NBR 8402 — 2,5 / 3,5 / 5 / 7 */
  altura: number;
}

export interface Folha {
  id: string;
  nome: string;
  formato: Formato;
  escala: number;
  diedro: 1 | 3;
  vistas: VistaDesenho[];
  notas: Nota[];
  cotas: Cota[];
  baloes: Balao[];
  tabelas: TabelaLista[];
}

/** Campos da legenda (NBR 10582); vazios vêm do cartão do modelo no cofre e da folha. */
export const CAMPOS_LEGENDA = [
  ["empresa", "Empresa"], ["titulo", "Título"], ["codigo", "Código / nº do desenho"], ["material", "Material"], ["massa", "Massa"],
  ["projetista", "Projetista"], ["aprovado", "Aprovado"], ["data", "Data"], ["revisao", "Revisão"],
] as const;
export type CampoLegenda = (typeof CAMPOS_LEGENDA)[number][0];

export interface DocumentoDesenho {
  formato: "wjdrw";
  versao: 1;
  nome: string;
  modelos: ModeloDesenho[];
  folhas: Folha[];
  legenda: Partial<Record<CampoLegenda, string>>;
}

export const novoIdD = () => Math.random().toString(36).slice(2, 10);

export function novaFolha(d: DocumentoDesenho | null, formato: Formato = "A3"): Folha {
  const n = (d?.folhas.length ?? 0) + 1;
  return { id: novoIdD(), nome: `Folha${n}`, formato, escala: 1, diedro: 1, vistas: [], notas: [], cotas: [], baloes: [], tabelas: [] };
}

export function desenhoVazio(nome = "Desenho1", formato: Formato = "A3"): DocumentoDesenho {
  return { formato: "wjdrw", versao: 1, nome, modelos: [], folhas: [novaFolha(null, formato)], legenda: {} };
}

const num = (v: unknown, p: number) => (typeof v === "number" && Number.isFinite(v) ? v : p);
const vec = (v: unknown, p: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as Vec3) : p);

/** Confere e completa um desenho lido de arquivo. */
export function validarDesenho(dados: unknown): DocumentoDesenho {
  const d = dados as Partial<DocumentoDesenho> | null;
  if (!d || d.formato !== "wjdrw" || !Array.isArray(d.folhas)) throw new Error("Arquivo de desenho inválido (.wjdrw).");
  const modelos = (Array.isArray(d.modelos) ? d.modelos : []).filter((m) => m && typeof m.id === "string" && m.doc && (m.tipo === "peca" || m.tipo === "montagem"));
  const ids = new Set(modelos.map((m) => m.id));
  const folhas: Folha[] = d.folhas.filter(Boolean).map((f, i) => ({
    id: typeof f.id === "string" ? f.id : novoIdD(),
    nome: typeof f.nome === "string" && f.nome ? f.nome : `Folha${i + 1}`,
    formato: f.formato in FORMATOS ? f.formato : "A3",
    escala: num(f.escala, 1) > 0 ? num(f.escala, 1) : 1,
    diedro: f.diedro === 3 ? 3 : 1,
    vistas: (Array.isArray(f.vistas) ? f.vistas : []).filter((v) => v && ids.has(v.modelo)).map((v) => ({
      ...v,
      camera: { olho: vec(v.camera?.olho, [0, 0, 1]), direita: vec(v.camera?.direita, [1, 0, 0]) },
      x: num(v.x, 100), y: num(v.y, 100),
      estilo: v.estilo === "sem-ocultas" || v.estilo === "arame" ? v.estilo : "ocultas",
      ...(v.escala !== undefined && num(v.escala, 0) > 0 ? { escala: v.escala } : { escala: undefined }),
    })),
    notas: (Array.isArray(f.notas) ? f.notas : []).filter((n) => n && typeof n.texto === "string").map((n) => ({ ...n, x: num(n.x, 50), y: num(n.y, 50), altura: num(n.altura, 3.5) })),
    cotas: Array.isArray(f.cotas) ? f.cotas.filter((c) => c && c.e1 && Array.isArray(c.pos)) : [],
    baloes: Array.isArray(f.baloes) ? f.baloes.filter((b) => b && Array.isArray(b.pos) && Array.isArray(b.ancora)) : [],
    tabelas: Array.isArray(f.tabelas) ? f.tabelas.filter((t) => t && typeof t.modelo === "string" && ids.has(t.modelo)) : [],
  }));
  if (!folhas.length) folhas.push(novaFolha(null));
  // mãe que sumiu: a vista fica independente; cotas e balões de vista que sumiu saem
  for (const f of folhas) {
    const vs = new Set(f.vistas.map((v) => v.id));
    f.cotas = f.cotas.filter((c) => vs.has(c.vista));
    f.baloes = f.baloes.filter((b) => vs.has(b.vista));
    for (const v of f.vistas) if (v.mae && !vs.has(v.mae)) delete v.mae, delete v.lado;
  }
  return { formato: "wjdrw", versao: 1, nome: typeof d.nome === "string" && d.nome ? d.nome : "Desenho", modelos, folhas, legenda: d.legenda && typeof d.legenda === "object" ? d.legenda : {} };
}

export const escalaDaVista = (f: Folha, v: VistaDesenho) => v.escala ?? f.escala;

/** Próximo nome livre "Vista1", "Vista2"… na folha. */
export function proximoNomeVista(f: Folha, base = "Vista"): string {
  let n = 1;
  const nomes = new Set(f.vistas.map((v) => v.nome));
  while (nomes.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Move a vista (e as projetadas dela, em cascata). Projetadas só andam no eixo de alinhamento. */
export function moverVista(f: Folha, id: string, x: number, y: number, livre = false) {
  const v = f.vistas.find((k) => k.id === id);
  if (!v) return;
  if (v.mae && !livre) {
    if (v.lado === "acima" || v.lado === "abaixo") x = v.x;
    else if (v.lado === "direita" || v.lado === "esquerda") y = v.y;
  }
  const dx = x - v.x, dy = y - v.y;
  v.x = x;
  v.y = y;
  // filhas alinhadas acompanham no eixo comum
  for (const fi of f.vistas.filter((k) => k.mae === id)) {
    if (fi.lado === "acima" || fi.lado === "abaixo") moverVista(f, fi.id, fi.x + dx, fi.y, true);
    else if (fi.lado === "direita" || fi.lado === "esquerda") moverVista(f, fi.id, fi.x, fi.y + dy, true);
  }
}

/** Exclui vistas; as projetadas delas ficam independentes. */
export function excluirVistas(f: Folha, ids: string[]) {
  const s = new Set(ids);
  f.vistas = f.vistas.filter((v) => !s.has(v.id));
  f.cotas = f.cotas.filter((c) => !s.has(c.vista));
  f.baloes = f.baloes.filter((b) => !s.has(b.vista));
  for (const v of f.vistas) if (v.mae && s.has(v.mae)) delete v.mae, delete v.lado;
}

/** Modelos sem nenhuma vista em nenhuma folha (limpeza ao salvar). */
export function modelosSemUso(d: DocumentoDesenho): string[] {
  const usados = new Set(d.folhas.flatMap((f) => f.vistas.map((v) => v.modelo)));
  return d.modelos.filter((m) => !usados.has(m.id)).map((m) => m.id);
}

// ---------- layout ----------

/** Caixa de uma vista na folha (mm), a partir da caixa da projeção (mm do modelo). */
export function caixaNaFolha(v: VistaDesenho, escala: number, c: Retangulo): Retangulo {
  return { x0: v.x + c.x0 * escala, y0: v.y + c.y0 * escala, x1: v.x + c.x1 * escala, y1: v.y + c.y1 * escala };
}

/**
 * Três vistas padrão: frontal, superior e lateral alinhadas no diedro, com a maior escala
 * normalizada que cabe na área útil (vãos de `vao` mm). Devolve a escala e a posição (origem do
 * modelo na folha) de cada vista.
 */
export function layoutTresVistas(
  caixas: { frontal: Retangulo; superior: Retangulo; lateral: Retangulo },
  area: Retangulo, diedro: 1 | 3, vao = 20, escalaFixa?: number,
): { escala: number; frontal: [number, number]; superior: [number, number]; lateral: [number, number] } {
  const w = (r: Retangulo) => Math.max(1e-6, r.x1 - r.x0), h = (r: Retangulo) => Math.max(1e-6, r.y1 - r.y0);
  const { frontal: F, superior: S, lateral: L } = caixas;
  const W = area.x1 - area.x0, H = area.y1 - area.y0;
  const cabe = (e: number) => e * (w(F) + w(L)) + 3 * vao <= W && e * (h(F) + h(S)) + 3 * vao <= H;
  const escala = escalaFixa ?? (ESCALAS.find(cabe) ?? ESCALAS[ESCALAS.length - 1]);
  const totalW = escala * (w(F) + w(L)) + vao, totalH = escala * (h(F) + h(S)) + vao;
  const esq = area.x0 + Math.max(vao, (W - totalW) / 2);
  const topo = area.y1 - Math.max(vao, (H - totalH) / 2);
  // 1º diedro: frontal em cima à esquerda, superior embaixo, lateral (esquerda) à direita;
  // 3º diedro: superior em cima, frontal embaixo, lateral (direita) à direita
  const topoF = diedro === 1 ? topo : topo - escala * h(S) - vao;
  const fx = esq - escala * F.x0, fy = topoF - escala * F.y1;
  const lx = esq + escala * w(F) + vao - escala * L.x0;
  const sy = diedro === 1 ? topoF - escala * h(F) - vao - escala * S.y1 : topo - escala * S.y1;
  return { escala, frontal: [fx, fy], superior: [fx, sy], lateral: [lx, fy] };
}

/** Maior escala normalizada (até `max`) em que a caixa (mm do modelo) cabe em w × h mm. */
export function escalaQueCabe(c: Retangulo, w: number, h: number, max = Infinity): number {
  const cw = Math.max(1e-6, c.x1 - c.x0), ch = Math.max(1e-6, c.y1 - c.y0);
  return ESCALAS.find((e) => e <= max + 1e-12 && e * cw <= w && e * ch <= h) ?? ESCALAS[ESCALAS.length - 1];
}

/**
 * Afasta a vista projetada da mãe quando o toque a deixou encostada ou sobreposta: no lado em que
 * foi colocada, a caixa nova fica pelo menos `vao` mm longe da caixa da mãe.
 */
export function afastarDaMae(caixaMae: Retangulo, caixaNova: Retangulo, lado: Lado, vao = 10): [number, number] {
  switch (lado) {
    case "direita": return [Math.max(0, caixaMae.x1 + vao - caixaNova.x0), 0];
    case "esquerda": return [Math.min(0, caixaMae.x0 - vao - caixaNova.x1), 0];
    case "acima": return [0, Math.max(0, caixaMae.y1 + vao - caixaNova.y0)];
    case "abaixo": return [0, Math.min(0, caixaMae.y0 - vao - caixaNova.y1)];
    case "diagonal": return [0, 0];
  }
}

/** Posição de uma vista projetada ao lado da mãe (alinhada), afastada `vao` mm da caixa da mãe. */
export function posicaoProjetada(mae: VistaDesenho, caixaMae: Retangulo, caixaNova: Retangulo, escala: number, lado: Lado, vao = 20): [number, number] {
  switch (lado) {
    case "direita": return [caixaMae.x1 + vao - caixaNova.x0 * escala, mae.y];
    case "esquerda": return [caixaMae.x0 - vao - caixaNova.x1 * escala, mae.y];
    case "acima": return [mae.x, caixaMae.y1 + vao - caixaNova.y0 * escala];
    case "abaixo": return [mae.x, caixaMae.y0 - vao - caixaNova.y1 * escala];
    case "diagonal": return [caixaMae.x1 + vao - caixaNova.x0 * escala, caixaMae.y0 - vao - caixaNova.y1 * escala];
  }
}

/** Texto da nota com as propriedades ligadas: {codigo}, {titulo}, {material}, {revisao}, {massa}… */
export function preencherPropriedades(texto: string, props: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (m, k: string) => (k in props ? props[k] : m));
}
