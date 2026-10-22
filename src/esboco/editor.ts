// Editor de esboço: ferramentas de desenho, encaixes, seleção, arrasto, cotas e relações.
// Entrada: caneta desenha e o dedo navega; sem caneta o dedo também desenha (encaixes maiores
// e lupa de precisão); no computador o botão esquerdo desenha, o do meio arrasta, o direito gira.

import type * as THREE from "three";
import type { CotaEsboco, FeatureEsboco, GeoEsboco, Referencia, RestricaoEsboco } from "../model";
import { ehCota, novoId } from "../model";
import type { TipoEntidade, Viewport } from "../viewport";
import { ajustarTextoCota, desenharCota, medirCota, textoCota } from "./cotas";
import {
  angulo, centroTresPontos, dist, distanciaGeo, distPontoSegmento, EIXO_H, EIXO_V, extremidades,
  mapaPontos, mult, ORIGEM, pontosDaGeo, polar, projetarNaGeo, soma, splineBeziers, pontoBezier, sub, type P2,
} from "./geometria";
import * as op from "./operacoes";
import { atualizarExternas, criarExterna, idsExternos, podarExternas, pontoNaProjecao, projetar, type ProjecaoExterna } from "./externas";
import { referencial, type Referencial } from "./referencial";
import type { ResultadoSolver, SolverEsboco } from "./solver";
import { construirCamada, descartarCamada } from "./visual";

export type Ferramenta =
  | "selecionar" | "ponto" | "linha" | "retangulo" | "circulo" | "arco" | "rasgo" | "poligono" | "spline"
  | "aparar" | "estender" | "fileteEsboco" | "chanfroEsboco" | "offset" | "espelhar" | "cota";

export const ROTULO_FERRAMENTA: Record<Ferramenta, string> = {
  selecionar: "Selecionar", ponto: "Ponto", linha: "Linha", retangulo: "Retângulo", circulo: "Círculo", arco: "Arco",
  rasgo: "Rasgo", poligono: "Polígono", spline: "Spline", aparar: "Aparar", estender: "Estender",
  fileteEsboco: "Filete de esboço", chanfroEsboco: "Chanfro de esboço", offset: "Offset",
  espelhar: "Espelhar", cota: "Cota",
};

export type TipoRetangulo = "canto" | "centro" | "3pontos";
export type TipoCirculo = "centro" | "perimetro";
export type TipoArco = "3pontos" | "centro" | "tangente";
export type TipoRasgo = "reto" | "centro";

/** Instrução curta mostrada no painel para cada etapa da ferramenta. */
function instrucao(f: Ferramenta, n: number, ed?: EditorEsboco): string {
  if (ed) {
    if (f === "retangulo" && ed.tipoRetangulo === "centro") return n ? "Toque um canto." : "Toque o centro.";
    if (f === "retangulo" && ed.tipoRetangulo === "3pontos") return ["Toque o 1º canto.", "Toque o 2º canto (define o lado e o ângulo).", "Toque para definir a largura."][n] ?? "";
    if (f === "circulo" && ed.tipoCirculo === "perimetro") return ["Toque o 1º ponto do contorno.", "Toque o 2º ponto.", "Toque o 3º ponto."][n] ?? "";
    if (f === "arco" && ed.tipoArco === "centro") return ["Toque o centro.", "Toque o início do arco.", "Toque o fim do arco."][n] ?? "";
    if (f === "arco" && ed.tipoArco === "tangente") return n ? "Toque o fim do arco." : "Toque a ponta de uma linha ou arco existente.";
    if (f === "rasgo" && ed.tipoRasgo === "centro") return ["Toque o centro do rasgo.", "Toque o centro de uma ponta.", "Toque para definir a largura."][n] ?? "";
  }
  switch (f) {
    case "estender": return "Toque perto da ponta da linha a estender até a próxima interseção.";
    case "fileteEsboco": return "Toque o canto (ponto onde duas linhas se encontram).";
    case "chanfroEsboco": return "Toque o canto (ponto onde duas linhas se encontram).";
    case "selecionar": return "Toque para selecionar; arraste pontos e linhas para mover o que está livre. Arestas e vértices da peça também podem ser tocados: viram referência (roxo) para relações e cotas.";
    case "ponto": return "Toque para cada ponto (posições de furo, referências).";
    case "linha": return n ? "Próximo ponto. Toque de novo no último ponto (ou Esc) para terminar." : "Toque o ponto inicial (ou arraste de um ponto ao outro).";
    case "retangulo": return n ? "Toque o canto oposto." : "Toque o primeiro canto.";
    case "circulo": return n ? "Toque um ponto do contorno." : "Toque o centro.";
    case "arco": return ["Toque o início do arco.", "Toque o fim do arco.", "Toque um ponto por onde o arco passa."][n] ?? "";
    case "rasgo": return ["Toque o centro da primeira ponta.", "Toque o centro da segunda ponta.", "Toque para definir a largura."][n] ?? "";
    case "poligono": return n ? "Toque um vértice." : "Toque o centro.";
    case "spline": return n ? "Mais pontos. Toque no último de novo (ou Esc) para terminar; no primeiro, fecha a curva." : "Toque o primeiro ponto da curva.";
    case "aparar": return "Toque o trecho a apagar (entre interseções).";
    case "offset": return "Toque uma entidade: a cadeia ligada a ela é copiada à distância indicada.";
    case "espelhar": return "Toque a linha de espelho (linha do esboço ou eixo).";
    case "cota": return n === 0 ? "Toque uma entidade (ou duas) e depois onde fica o número. Arestas e vértices da peça também valem." : n === 1 ? "Toque outra entidade (do esboço ou da peça), ou onde fica o número." : "Toque onde fica o número.";
  }
}

export interface Hospedeiro {
  viewport: Viewport;
  solver: SolverEsboco;
  overlay: HTMLElement;
  /** O documento mudou; `final` = vira passo de desfazer. */
  alterou(final: boolean): void;
  /** Redesenhar painel, barra de status e faixa de comandos. */
  atualizarInterface(): void;
  avisar(texto: string): void;
}

/** Resultado de um encaixe: posição e com o que ela coincide. */
/** Aresta/vértice da peça sob o ponteiro, projetado no plano do esboço. */
interface AlvoModelo {
  ref: Referencia;
  proj: ProjecaoExterna;
  rotulo: string;
}

interface Encaixe {
  p: P2;
  modelo?: AlvoModelo; // vértice da peça: o ponto vira a própria referência
  sobreModelo?: AlvoModelo; // sobre uma aresta da peça
  ponto?: string; // ponto existente (ou origem)
  geo?: string; // sobre esta curva/eixo
  meio?: string; // ponto médio desta linha
  hv?: "horizontal" | "vertical";
  rotulo?: string;
}

interface Alvo {
  tipo: "ponto" | "geo";
  id: string;
}

type Arraste =
  | { tipo: "ponto"; id: string }
  | { tipo: "pontos"; ids: string[]; orig: P2[]; inicio: P2 }
  | { tipo: "raio"; id: string };

/** Símbolos das relações (no desenho e na caixinha de relações). */
export const SIMBOLO_RELACAO: Record<string, string> = {
  horizontal: "H", vertical: "V", paralelo: "∥", perpendicular: "⊥", colinear: "⫽", tangente: "T",
  igual: "=", concentrico: "◎", pontoMedio: "½", simetrico: "⇹", fixo: "⚲", coincidente: "◉",
};

const LUPA = 132;
const ZOOM_LUPA = 2.5;

export class EditorEsboco {
  ferramenta: Ferramenta = "selecionar";
  selecao = new Set<string>();
  construcao = false;
  lados = 6;
  tipoRetangulo: TipoRetangulo = "canto";
  tipoCirculo: TipoCirculo = "centro";
  tipoArco: TipoArco = "3pontos";
  tipoRasgo: TipoRasgo = "reto";
  poligonoCircunscrito = false;
  raioFilete = 3;
  cotarFilete = true;
  distChanfro = 2;
  distOffset = 5;
  /** Sem caneta detectada o dedo desenha; ao primeiro toque de caneta isso desliga. */
  dedoDesenha = true;
  mostrarRelacoes = true;
  estado: ResultadoSolver = { ok: true, gl: 0, conflitantes: [], redundantes: [], definicao: "subdefinido" };
  livres = new Set<string>();
  private conflito = new Set<string>();

  private ref: Referencial;
  private camada: THREE.Group | null = null;
  private cliques: Encaixe[] = [];
  private cursor: Encaixe | null = null;
  private cotaEntidades: string[] = [];
  private ponteiro: { id: number; tipo: string; x0: number; y0: number; moveu: boolean; enc: Encaixe; alvo: Alvo | null; modelo: AlvoModelo | null; arraste: Arraste | null } | null = null;
  /** Última posição do ponteiro na tela (para encaixar em arestas/vértices da peça). */
  private tela: { x: number; y: number; tipo: string } | null = null;
  /** Caixinha de relações aberta ao lado do ponteiro. */
  private caixaRel: { el: HTMLElement; x: number; y: number } | null = null;
  private lupa: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
  private mmPxDesenho = 0;
  private quadroPendente = 0;
  private soltos: (() => void)[] = [];

  constructor(private h: Hospedeiro, public esb: FeatureEsboco) {
    this.ref = referencial(esb.suporte);
    const vp = h.viewport;
    vp.modoEsboco(true);
    vp.interceptador = (e) => this.aoPressionar(e);
    vp.aposDesenhar = () => this.aposDesenhar();
    vp.aoMudarCamera = () => this.aoMudarCamera();
    vp.aoToqueCurto = (e) => this.aoToqueCurto(e);
    const cv = vp.canvas();
    const mover = (e: PointerEvent) => this.aoMover(e);
    const soltar = (e: PointerEvent) => this.aoSoltar(e);
    const cancelar = (e: PointerEvent) => this.ponteiro?.id === e.pointerId && this.cancelarPonteiro();
    const sair = () => {
      if (!this.ponteiro) {
        this.cursor = null;
        this.redesenhar();
      }
    };
    cv.addEventListener("pointermove", mover);
    cv.addEventListener("pointerup", soltar);
    cv.addEventListener("pointercancel", cancelar);
    cv.addEventListener("pointerleave", sair);
    this.soltos.push(() => {
      cv.removeEventListener("pointermove", mover);
      cv.removeEventListener("pointerup", soltar);
      cv.removeEventListener("pointercancel", cancelar);
      cv.removeEventListener("pointerleave", sair);
    });
    vp.olharPlano(this.ref);
    // referências do modelo acompanham a peça atual (a entidade mais parecida)
    if (vp.topologia && esb.geos.some((g) => g.externa)) {
      const { perdidas } = atualizarExternas(esb, vp.topologia, this.ref);
      if (perdidas) h.avisar(`${perdidas} referência${perdidas > 1 ? "s" : ""} do modelo não ${perdidas > 1 ? "foram encontradas" : "foi encontrada"} na peça atual (ficou onde estava).`);
    }
    this.resolver(true);
  }

  /** Encerra o modo esboço e devolve o viewport ao normal. */
  fechar() {
    const vp = this.h.viewport;
    vp.modoEsboco(false);
    vp.interceptador = null;
    vp.aposDesenhar = null;
    vp.aoMudarCamera = null;
    vp.aoToqueCurto = null;
    this.soltos.forEach((f) => f());
    if (this.camada) {
      vp.grupoEsboco.remove(this.camada);
      descartarCamada(this.camada);
    }
    this.caixaRel = null;
    this.h.overlay.innerHTML = "";
    vp.pedirRender();
  }

  /** Depois de desfazer/refazer o documento é outro objeto: aponta para o esboço novo. */
  reatar(esb: FeatureEsboco) {
    this.esb = esb;
    this.ref = referencial(esb.suporte);
    const existe = new Set([...esb.pontos.map((p) => p.id), ...esb.geos.map((g) => g.id), ...esb.restricoes.map((r) => r.id), ORIGEM, EIXO_H, EIXO_V]);
    for (const id of [...this.selecao]) if (!existe.has(id)) this.selecao.delete(id);
    this.cliques = [];
    this.resolver(false, false);
  }

  definirFerramenta(f: Ferramenta) {
    if (f === "espelhar" && !this.geosSelecionadas().length) {
      this.h.avisar("Espelhar: selecione primeiro as entidades (ferramenta Selecionar) e toque Espelhar de novo.");
      return;
    }
    this.ferramenta = f;
    this.cliques = [];
    this.cotaEntidades = [];
    this.fecharCaixaRelacoes();
    if (f !== "selecionar" && f !== "espelhar" && f !== "offset") {
      this.selecao.clear();
      if (podarExternas(this.esb, this.selecao)) this.resolver(false);
    }
    this.redesenhar();
    this.h.atualizarInterface();
  }

  get instrucao(): string {
    return instrucao(this.ferramenta, this.ferramenta === "cota" ? this.cotaEntidades.length : this.cliques.length, this);
  }

  // ---------- solver ----------

  /** Resolve, atualiza estado/definição e redesenha. `final` grava passo de desfazer. */
  resolver(final: boolean, notificar = true) {
    podarExternas(this.esb, this.selecao);
    this.estado = this.h.solver.resolver(this.esb);
    this.conflito = new Set(this.estado.conflitantes);
    for (const r of this.esb.restricoes) if (this.conflito.has(r.id)) op.referencias(r).forEach((x) => this.conflito.add(x));
    this.livres = this.estado.definicao === "subdefinido" ? this.h.solver.livres(this.esb) : new Set();
    this.redesenhar();
    if (notificar) this.h.alterou(final);
    this.h.atualizarInterface();
  }

  get textoDefinicao(): string {
    const e = this.estado;
    if (!this.esb.geos.length) return "Esboço vazio";
    if (e.definicao === "superdefinido") return "Superdefinido (conflito)";
    if (e.definicao === "definido") return "Totalmente definido";
    return `Subdefinido · ${e.gl} grau${e.gl === 1 ? "" : "s"} de liberdade`;
  }

  // ---------- coordenadas e tolerâncias ----------

  private noPlano(e: { clientX: number; clientY: number }): P2 | null {
    return this.h.viewport.telaParaPlano(e.clientX, e.clientY, this.ref);
  }

  private tolMm(tipo: string): number {
    return (tipo === "touch" ? 24 : 10) * this.h.viewport.mmPorPixel(this.ref);
  }

  /** Entidade sob o ponto: pontos têm prioridade sobre curvas; eixos por último. */
  private achar(p: P2, tol: number): Alvo | null {
    const pts = mapaPontos(this.esb);
    let melhor: Alvo | null = null, dm = tol;
    for (const [id, q] of pts) {
      const d = dist(p, q);
      if (d < dm) { dm = d; melhor = { tipo: "ponto", id }; }
    }
    if (melhor) return melhor;
    dm = tol;
    for (const g of this.esb.geos) {
      const d = distanciaGeo(g, pts, p);
      if (d < dm) { dm = d; melhor = { tipo: "geo", id: g.id }; }
    }
    if (melhor) return melhor;
    if (Math.abs(p.y) < tol) return { tipo: "geo", id: EIXO_H };
    if (Math.abs(p.x) < tol) return { tipo: "geo", id: EIXO_V };
    return null;
  }

  /** Encaixe do cursor: ponto existente, ponto médio, sobre curva/eixo, e H/V em relação ao anterior. */
  private encaixar(p: P2, tol: number, anterior?: P2): Encaixe {
    const pts = mapaPontos(this.esb);
    let melhor: Encaixe | null = null, dm = tol;
    for (const [id, q] of pts) {
      const d = dist(p, q);
      if (d < dm) { dm = d; melhor = { p: q, ponto: id, rotulo: id === ORIGEM ? "Origem" : "Coincidente" }; }
    }
    if (melhor) return melhor;
    const mv = this.tela && this.acharModelo(this.tela.x, this.tela.y, this.tela.tipo, ["vertice"]);
    if (mv && mv.proj.tipo === "ponto") return { p: mv.proj.p, modelo: mv, rotulo: mv.rotulo };
    for (const g of this.esb.geos) {
      if (g.tipo !== "linha") continue;
      const m = mult(soma(pts.get(g.p1)!, pts.get(g.p2)!), 0.5);
      const d = dist(p, m);
      if (d < dm) { dm = d; melhor = { p: m, meio: g.id, rotulo: "Ponto médio" }; }
    }
    if (melhor) return melhor;
    let hv: Encaixe["hv"];
    let q = p;
    if (anterior) {
      const d = sub(p, anterior);
      const tan = Math.tan((4 * Math.PI) / 180);
      if (Math.abs(d.y) <= Math.abs(d.x) * tan && Math.abs(d.x) > tol) { q = { x: p.x, y: anterior.y }; hv = "horizontal"; }
      else if (Math.abs(d.x) <= Math.abs(d.y) * tan && Math.abs(d.y) > tol) { q = { x: anterior.x, y: p.y }; hv = "vertical"; }
    }
    dm = tol;
    for (const g of this.esb.geos) {
      const d = distanciaGeo(g, pts, q);
      if (d < dm) { dm = d; melhor = { p: projetarNaGeo(g, pts, q), geo: g.id, rotulo: "Sobre a curva" }; }
    }
    if (melhor) return { ...melhor, hv: undefined };
    const ma = this.tela && this.acharModelo(this.tela.x, this.tela.y, this.tela.tipo, ["aresta"]);
    if (ma && ma.proj.tipo !== "ponto") return { p: pontoNaProjecao(ma.proj, q), sobreModelo: ma, rotulo: "Sobre aresta do modelo" };
    if (Math.abs(q.y) < tol && !hv) return { p: { x: q.x, y: 0 }, geo: EIXO_H, rotulo: "Sobre o eixo H" };
    if (Math.abs(q.x) < tol && !hv) return { p: { x: 0, y: q.y }, geo: EIXO_V, rotulo: "Sobre o eixo V" };
    return { p: q, hv, rotulo: hv === "horizontal" ? "Horizontal" : hv === "vertical" ? "Vertical" : undefined };
  }

  /** Cria (ou reaproveita) o ponto do encaixe e as relações que ele implica. */
  private pontoDo(enc: Encaixe): string {
    if (!enc.ponto && enc.modelo) {
      // vértice da peça: o ponto do esboço é a própria referência (fixa)
      const g = criarExterna(this.esb, enc.modelo.proj, enc.modelo.ref);
      return pontosDaGeo(g)[0];
    }
    const id = op.ponto(this.esb, enc.p, enc.ponto);
    if (!enc.ponto) {
      if (enc.geo) op.restringir(this.esb, { tipo: "coincidente", a: id, b: enc.geo });
      if (enc.meio) op.restringir(this.esb, { tipo: "pontoMedio", p: id, g: enc.meio });
      if (enc.sobreModelo) {
        const g = criarExterna(this.esb, enc.sobreModelo.proj, enc.sobreModelo.ref);
        op.restringir(this.esb, { tipo: "coincidente", a: id, b: g.id });
      }
    }
    return id;
  }

  /** Aresta/vértice da peça sob o ponto da tela, já projetado no plano do esboço. */
  private acharModelo(x: number, y: number, tipo: string, filtro: TipoEntidade[]): AlvoModelo | null {
    const vp = this.h.viewport;
    const topo = vp.topologia;
    if (!topo) return null;
    const e = vp.picarEntidade(x, y, new Set(filtro), tipo === "touch" ? 22 : 10);
    if (!e || e.tipo === "face") return null;
    const ref: Referencia = e.tipo === "vertice" ? { tipo: "vertice", p: topo.vertices[e.indice] } : { tipo: "aresta", ass: topo.arestas[e.indice] };
    const proj = projetar(ref, this.ref);
    if (!proj) return null;
    return { ref, proj, rotulo: e.tipo === "vertice" ? "Vértice do modelo" : "Aresta do modelo" };
  }

  /** Toque numa aresta/vértice da peça: vira referência e entra na seleção. */
  private selecionarModelo(m: AlvoModelo, x: number, y: number) {
    const g = criarExterna(this.esb, m.proj, m.ref);
    // vértice entra como ponto (para relações ponto-ponto / ponto-curva)
    this.selecao.add(g.tipo === "ponto" ? g.p : g.id);
    this.resolver(true);
    this.abrirCaixaRelacoes(x, y);
  }

  // ---------- ponteiro ----------

  private aoPressionar(e: PointerEvent): boolean {
    if (e.pointerType === "pen" && this.dedoDesenha) {
      this.dedoDesenha = false; // há caneta: o dedo passa a só navegar
      this.h.atualizarInterface();
    }
    if (this.ponteiro) {
      // segundo dedo: o gesto é de navegação; desiste do que estava em andamento
      if (e.pointerType === "touch") this.cancelarPonteiro();
      return false;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return false;
    this.tela = { x: e.clientX, y: e.clientY, tipo: e.pointerType };
    const p = this.noPlano(e);
    if (!p) return false;
    const tol = this.tolMm(e.pointerType);
    const alvo = this.achar(p, tol);
    const modelo = !alvo && this.ferramenta === "selecionar" && e.pointerType !== "touch"
      ? this.acharModelo(e.clientX, e.clientY, e.pointerType, ["vertice", "aresta"]) : null;
    if (e.pointerType === "touch") {
      if (!this.dedoDesenha) return false;
      // com Selecionar, dedo no vazio gira a vista; em cima de algo, seleciona/arrasta
      if (this.ferramenta === "selecionar" && !alvo) return false;
    }
    const anterior = this.cliques.length ? this.cliques[this.cliques.length - 1].p : undefined;
    const enc = this.ferramentaUsaEncaixe() ? this.encaixar(p, tol, this.ferramenta === "linha" ? anterior : undefined) : { p };
    this.ponteiro = { id: e.pointerId, tipo: e.pointerType, x0: e.clientX, y0: e.clientY, moveu: false, enc, alvo, modelo, arraste: null };
    this.h.viewport.canvas().setPointerCapture(e.pointerId);
    if (e.pointerType === "touch" && this.ferramenta !== "selecionar") this.abrirLupa(e);
    this.cursor = enc;
    this.redesenhar();
    return true;
  }

  private ferramentaUsaEncaixe() {
    return !["selecionar", "aparar", "estender", "fileteEsboco", "chanfroEsboco", "offset", "espelhar", "cota"].includes(this.ferramenta);
  }

  private aoMover(e: PointerEvent) {
    const pt = this.ponteiro;
    if (pt && e.pointerId !== pt.id) return;
    if (!pt && e.pointerType === "touch") return;
    this.tela = { x: e.clientX, y: e.clientY, tipo: e.pointerType };
    const p = this.noPlano(e);
    if (!p) return;
    const tol = this.tolMm(e.pointerType);
    if (pt && Math.hypot(e.clientX - pt.x0, e.clientY - pt.y0) > 6) pt.moveu = true;

    if (pt && this.ferramenta === "selecionar") {
      if (pt.moveu && pt.alvo) this.arrastar(pt, p);
      return;
    }
    if (this.ferramentaUsaEncaixe()) {
      const anterior = this.cliques.length ? this.cliques[this.cliques.length - 1].p
        : pt?.moveu ? pt.enc.p : undefined;
      this.cursor = this.encaixar(p, tol, this.ferramenta === "linha" || (!this.cliques.length && pt) ? anterior : undefined);
    } else {
      this.cursor = { p };
    }
    if (this.lupa) {
      this.lupa.x = e.clientX;
      this.lupa.y = e.clientY;
    }
    this.redesenhar();
  }

  private aoSoltar(e: PointerEvent) {
    const pt = this.ponteiro;
    if (!pt || e.pointerId !== pt.id) return;
    this.ponteiro = null;
    this.fecharLupa();
    this.tela = { x: e.clientX, y: e.clientY, tipo: pt.tipo };
    const p = this.noPlano(e);
    if (!p) return;
    const tol = this.tolMm(pt.tipo);

    if (this.ferramenta === "selecionar") {
      if (pt.arraste) {
        this.resolver(true);
      } else if (pt.alvo) {
        this.alternarSelecao(pt.alvo.id);
        this.abrirCaixaRelacoes(e.clientX, e.clientY);
      } else if (pt.modelo && !pt.moveu) {
        this.selecionarModelo(pt.modelo, e.clientX, e.clientY);
      } else {
        this.limparSelecao();
      }
      return;
    }
    // arrastar de um ponto a outro = dois cliques (início no ponto pressionado)
    const precisaDois = ["linha", "retangulo", "circulo", "arco", "rasgo", "poligono"].includes(this.ferramenta);
    if (pt.moveu && precisaDois && this.cliques.length === 0) this.registrar(pt.enc, tol, pt.tipo);
    const anterior = this.cliques.length ? this.cliques[this.cliques.length - 1].p : undefined;
    const enc = this.ferramentaUsaEncaixe() ? this.encaixar(p, tol, this.ferramenta === "linha" ? anterior : undefined) : { p };
    this.registrar(enc, tol, pt.tipo);
  }

  private aoToqueCurto(e: PointerEvent) {
    // toque de dedo que não foi interceptado (navegação): numa aresta/vértice da peça vira
    // referência; no vazio, limpa a seleção
    if (e.pointerType !== "touch" || this.ferramenta !== "selecionar") return;
    const m = this.acharModelo(e.clientX, e.clientY, "touch", ["vertice", "aresta"]);
    if (m) this.selecionarModelo(m, e.clientX, e.clientY);
    else if (this.selecao.size) this.limparSelecao();
  }

  /** Limpa a seleção e remove referências do modelo que ficaram sem uso. */
  limparSelecao() {
    this.selecao.clear();
    this.fecharCaixaRelacoes();
    if (podarExternas(this.esb, this.selecao)) {
      this.resolver(true);
      return;
    }
    this.redesenhar();
    this.h.atualizarInterface();
  }

  private cancelarPonteiro() {
    const pt = this.ponteiro;
    this.ponteiro = null;
    this.fecharLupa();
    if (pt?.arraste) this.resolver(true);
    this.redesenhar();
  }

  private arrastar(pt: NonNullable<EditorEsboco["ponteiro"]>, p: P2) {
    const alvo = pt.alvo!;
    const pts = mapaPontos(this.esb);
    if (!pt.arraste) {
      if (alvo.tipo === "ponto") {
        if (alvo.id === ORIGEM) return;
        pt.arraste = { tipo: "ponto", id: alvo.id };
      } else {
        const g = this.esb.geos.find((x) => x.id === alvo.id);
        if (!g) return; // eixos não se movem
        const borda = (g.tipo === "circulo" || g.tipo === "arco");
        if (borda) pt.arraste = { tipo: "raio", id: g.id };
        else {
          const ids = g.tipo === "linha" ? [g.p1, g.p2] : g.tipo === "spline" ? g.pontos : [];
          pt.arraste = { tipo: "pontos", ids, orig: ids.map((i) => ({ ...pts.get(i)! })), inicio: p };
        }
      }
    }
    const a = pt.arraste;
    if (a.tipo === "ponto") this.h.solver.resolver(this.esb, { pontos: [{ id: a.id, ...p }] });
    else if (a.tipo === "raio") {
      const g = this.esb.geos.find((x) => x.id === a.id) as Extract<GeoEsboco, { tipo: "circulo" | "arco" }>;
      this.h.solver.resolver(this.esb, { raios: [{ id: a.id, r: Math.max(1e-3, dist(pts.get(g.c)!, p)) }] });
    } else {
      const d = sub(p, a.inicio);
      this.h.solver.resolver(this.esb, { pontos: a.ids.map((id, i) => ({ id, ...soma(a.orig[i], d) })) });
    }
    this.redesenhar();
    this.h.alterou(false);
  }

  // ---------- ferramentas ----------

  private registrar(enc: Encaixe, tol: number, tipo: string) {
    const f = this.ferramenta;
    const esb = this.esb;
    const c = this.cliques;

    if (f === "fileteEsboco" || f === "chanfroEsboco") {
      const alvo = this.achar(enc.p, tol);
      if (alvo?.tipo !== "ponto") return this.h.avisar("Toque o ponto do canto.");
      const ok = f === "fileteEsboco"
        ? op.fileteEsboco(esb, alvo.id, this.raioFilete, this.cotarFilete)
        : op.chanfroEsboco(esb, alvo.id, this.distChanfro);
      if (!ok) return this.h.avisar("Esse ponto não é um canto entre duas linhas (ou o tamanho é grande demais).");
      this.resolver(true);
      return;
    }
    if (["estender", "aparar", "offset", "fileteEsboco", "chanfroEsboco"].includes(f)) {
      const alvo = this.achar(enc.p, tol);
      const g = alvo && this.esb.geos.find((x) => x.id === alvo.id);
      if (g?.externa) return this.h.avisar("Referência do modelo é fixa: não pode ser alterada (apague-a se não precisar).");
    }
    if (f === "estender") {
      const alvo = this.achar(enc.p, tol);
      if (alvo?.tipo === "geo" && op.estender(esb, alvo.id, enc.p)) this.resolver(true);
      else this.h.avisar("Nada para encontrar nessa direção.");
      return;
    }
    if (f === "aparar") {
      const alvo = this.achar(enc.p, tol);
      if (alvo?.tipo === "geo" && alvo.id !== EIXO_H && alvo.id !== EIXO_V && op.aparar(esb, alvo.id, enc.p)) this.resolver(true);
      return;
    }
    if (f === "offset") {
      const alvo = this.achar(enc.p, tol);
      if (alvo?.tipo !== "geo") return;
      this.selecao = new Set(this.cadeiaDe(alvo.id));
      this.redesenhar();
      this.h.atualizarInterface();
      return;
    }
    if (f === "espelhar") {
      const alvo = this.achar(enc.p, tol);
      const g = alvo && esb.geos.find((x) => x.id === alvo.id);
      const eixo = alvo && (alvo.id === EIXO_H || alvo.id === EIXO_V || g?.tipo === "linha") ? alvo.id : null;
      if (!eixo) {
        this.h.avisar("Toque uma linha (ou um eixo) para servir de espelho.");
        return;
      }
      const novas = op.espelhar(esb, this.geosSelecionadas(), eixo);
      this.selecao = new Set(novas);
      this.ferramenta = "selecionar";
      this.resolver(true);
      return;
    }
    if (f === "cota") {
      this.cliqueCota(enc.p, tol, tipo);
      return;
    }

    // ferramentas de desenho
    const ultimo = c[c.length - 1];
    if (ultimo && dist(ultimo.p, enc.p) < tol * 0.5) {
      // toque repetido no mesmo lugar: termina cadeia de linha/spline
      if (f === "spline") this.concluirSpline();
      this.cliques = [];
      this.redesenhar();
      this.h.atualizarInterface();
      return;
    }
    c.push(enc);
    const cons = this.construcao;
    let pronto = false;
    switch (f) {
      case "ponto":
        op.pontoSolto(esb, this.pontoDo(c[0]), cons);
        pronto = true;
        break;
      case "linha":
        if (c.length === 2) {
          const a = this.pontoDo(c[0]);
          const b = this.pontoDo(c[1]);
          const l = op.linha(esb, a, b, cons);
          if (c[1].hv) op.restringir(esb, { tipo: c[1].hv, a: l.id });
          const fecha = !!c[1].ponto; // terminou num ponto que já existia: fecha a cadeia
          this.cliques = fecha ? [] : [{ p: c[1].p, ponto: b }];
          this.resolver(true);
          return;
        }
        // primeiro clique: se ele cair num ponto existente, a linha parte dele
        break;
      case "retangulo":
        if (this.tipoRetangulo === "3pontos") {
          if (c.length === 3) { op.retangulo3Pontos(esb, this.pontoDo(c[0]), this.pontoDo(c[1]), c[2].p, cons); pronto = true; }
        } else if (c.length === 2) {
          if (this.tipoRetangulo === "centro") op.retanguloCentro(esb, this.pontoDo(c[0]), c[1].p, cons);
          else op.retangulo(esb, this.pontoDo(c[0]), this.pontoDo(c[1]), cons);
          pronto = true;
        }
        break;
      case "circulo":
        if (this.tipoCirculo === "perimetro") {
          if (c.length === 3) {
            const ci = op.circulo3Pontos(esb, c[0].p, c[1].p, c[2].p, cons);
            if (!ci) this.h.avisar("Pontos alinhados: não formam círculo.");
            else for (const k of c) if (k.ponto) op.restringir(esb, { tipo: "coincidente", a: k.ponto, b: ci.id });
            pronto = true;
          }
          break;
        }
        if (c.length === 2) {
          const ci = op.circulo(esb, this.pontoDo(c[0]), Math.max(1e-3, dist(c[0].p, c[1].p)), cons);
          if (c[1].ponto || c[1].geo) {
            // contorno passando por um ponto/curva existente
            if (c[1].ponto) op.restringir(esb, { tipo: "coincidente", a: c[1].ponto, b: ci.id });
          }
          pronto = true;
        }
        break;
      case "arco":
        if (this.tipoArco === "tangente") {
          if (c.length === 1 && !(c[0].ponto && op.tangenteNaPonta(esb, c[0].ponto))) {
            this.cliques = [];
            this.h.avisar("O arco tangente começa na ponta de uma linha ou arco existente.");
            this.redesenhar();
            return;
          }
          if (c.length === 2) {
            if (!op.arcoTangente(esb, c[0].ponto!, c[1].p, cons)) this.h.avisar("Não foi possível fazer o arco tangente até esse ponto.");
            pronto = true;
          }
          break;
        }
        if (this.tipoArco === "centro") {
          if (c.length === 3) { op.arcoCentro(esb, this.pontoDo(c[0]), this.pontoDo(c[1]), c[2].p, cons); pronto = true; }
          break;
        }
        if (c.length === 3) {
          const a = this.pontoDo(c[0]), b = this.pontoDo(c[1]);
          if (!op.arcoTresPontos(esb, a, b, c[2].p, cons)) this.h.avisar("Pontos alinhados: não formam arco.");
          pronto = true;
        }
        break;
      case "rasgo":
        if (c.length === 3 && this.tipoRasgo === "centro") {
          const p0 = c[0].p, p1 = c[1].p;
          const r = distPontoSegmento(c[2].p, { x: 2 * p0.x - p1.x, y: 2 * p0.y - p1.y }, p1).d;
          if (r > 1e-6 && dist(p0, p1) > 1e-6) op.rasgoCentro(esb, this.pontoDo(c[0]), p1, r, cons);
          pronto = true;
          break;
        }
        if (c.length === 3) {
          const r = distPontoSegmento(c[2].p, c[0].p, c[1].p).d;
          if (r > 1e-6 && dist(c[0].p, c[1].p) > 1e-6) {
            const c1 = this.pontoDo(c[0]), c2 = this.pontoDo(c[1]);
            op.rasgo(esb, c1, c2, r, cons);
            const d = sub(c[1].p, c[0].p);
            if (Math.abs(d.y) < Math.abs(d.x) * 0.07) op.restringir(esb, { tipo: "horizontal", a: c1, b: c2 });
            else if (Math.abs(d.x) < Math.abs(d.y) * 0.07) op.restringir(esb, { tipo: "vertical", a: c1, b: c2 });
          }
          pronto = true;
        }
        break;
      case "poligono":
        if (c.length === 2) {
          if (this.poligonoCircunscrito) op.poligonoCircunscrito(esb, this.pontoDo(c[0]), c[1].p, this.lados, cons);
          else op.poligono(esb, this.pontoDo(c[0]), c[1].p, this.lados, cons);
          pronto = true;
        }
        break;
      case "spline":
        if (c.length > 2 && c[c.length - 1].ponto && c[c.length - 1].ponto === c[0].ponto) {
          this.concluirSpline();
          pronto = true;
        }
        break;
    }
    if (pronto) {
      this.cliques = [];
      this.resolver(true);
    } else {
      this.redesenhar();
      this.h.atualizarInterface();
    }
  }

  /** Termina a spline com os pontos tocados (se o último for o primeiro, ela fecha). */
  concluirSpline() {
    const c = this.cliques;
    if (this.ferramenta !== "spline" || c.length < 2) return;
    const ids = c.map((e) => this.pontoDo(e));
    op.spline(this.esb, ids, this.construcao);
    this.cliques = [];
    this.resolver(true);
  }

  /** Esc: cancela a etapa em andamento; sem etapa, volta para Selecionar. */
  cancelar() {
    if (this.ferramenta === "spline" && this.cliques.length >= 2) {
      this.concluirSpline();
      return;
    }
    if (this.cliques.length || this.cotaEntidades.length) {
      this.cliques = [];
      this.cotaEntidades = [];
      this.selecao.clear();
      this.redesenhar();
      this.h.atualizarInterface();
      return;
    }
    if (this.ferramenta !== "selecionar") this.definirFerramenta("selecionar");
    else if (this.selecao.size || this.caixaRel) this.limparSelecao();
  }

  /** Geometrias ligadas pelas extremidades à geometria tocada (para offset). */
  private cadeiaDe(id: string): string[] {
    const pts = mapaPontos(this.esb);
    const g0 = this.esb.geos.find((g) => g.id === id);
    if (!g0) return [];
    if (g0.tipo === "circulo") return [id];
    const chave = (pid: string) => { const p = pts.get(pid)!; return `${p.x.toFixed(6)}|${p.y.toFixed(6)}`; };
    const out = new Set([id]);
    const fila = [g0];
    while (fila.length) {
      const g = fila.pop()!;
      const ex = extremidades(g)?.map(chave) ?? [];
      for (const o of this.esb.geos) {
        if (out.has(o.id) || o.tipo === "circulo" || o.tipo === "spline" || !!o.construcao !== !!g0.construcao) continue;
        if ((extremidades(o) ?? []).some((x) => ex.includes(chave(x)))) { out.add(o.id); fila.push(o); }
      }
    }
    return [...out];
  }

  aplicarOffset(inverter = false) {
    const geos = this.geosSelecionadas();
    if (!geos.length || !this.distOffset) return;
    const novas = op.deslocar(this.esb, geos, inverter ? -this.distOffset : this.distOffset);
    this.selecao = new Set(novas);
    this.resolver(true);
  }

  // ---------- cotas ----------

  private cliqueCota(p: P2, tol: number, _tipo: string) {
    const ents = this.cotaEntidades;
    let alvo = this.achar(p, tol);
    if (!alvo && ents.length < 2) {
      // aresta/vértice da peça: vira referência do modelo e entra na cota
      const m = this.tela && this.acharModelo(this.tela.x, this.tela.y, this.tela.tipo, ["vertice", "aresta"]);
      if (m) {
        const g = criarExterna(this.esb, m.proj, m.ref);
        alvo = g.tipo === "ponto" ? { tipo: "ponto", id: g.p } : { tipo: "geo", id: g.id };
      }
    }
    if (alvo && ents.length < 2 && !ents.includes(alvo.id)) {
      ents.push(alvo.id);
      this.selecao = new Set(ents);
      // círculo/arco/linha sozinhos já podem virar cota no próximo toque; nada a fazer agora
      this.redesenhar();
      this.h.atualizarInterface();
      return;
    }
    if (!ents.length) return;
    const nova = this.novaCota(ents, p);
    this.cotaEntidades = [];
    this.selecao.clear();
    if (!nova) {
      this.h.avisar("Essa combinação não tem cota. Toque linha, círculo, arco, ou dois pontos/linhas.");
      this.redesenhar();
      this.h.atualizarInterface();
      return;
    }
    this.esb.restricoes.push(nova);
    this.verificarNovaRestricao(nova);
    this.abrirEdicaoCota(nova.id);
  }

  /** Cota “inteligente” conforme o que foi tocado e onde o número foi posto. */
  private novaCota(ents: string[], local: P2): CotaEsboco | null {
    const tipoDe = (id: string) => {
      if (id === EIXO_H || id === EIXO_V) return "linha";
      const g = this.esb.geos.find((x) => x.id === id);
      return g ? g.tipo : "ponto";
    };
    const pts = mapaPontos(this.esb);
    const centro = (id: string) => {
      const g = this.esb.geos.find((x) => x.id === id);
      return g && (g.tipo === "circulo" || g.tipo === "arco") ? g.c : id;
    };
    let c: CotaEsboco | null = null;
    const base = { id: novoId(), valor: 0, texto: local };
    if (ents.length === 1) {
      const t = tipoDe(ents[0]);
      if (t === "linha" && ents[0] !== EIXO_H && ents[0] !== EIXO_V) c = { ...base, tipo: "distancia", a: ents[0] };
      else if (t === "circulo") c = { ...base, tipo: "diametro", a: ents[0] };
      else if (t === "arco") c = { ...base, tipo: "raio", a: ents[0] };
    } else {
      const [a, b] = ents;
      const ta = tipoDe(a), tb = tipoDe(b);
      const ehPonto = (t: string) => t === "ponto" || t === "circulo" || t === "arco";
      if (ehPonto(ta) && ehPonto(tb)) {
        const pa = pts.get(centro(a))!, pb = pts.get(centro(b))!;
        const dentroX = local.x > Math.min(pa.x, pb.x) && local.x < Math.max(pa.x, pb.x);
        const dentroY = local.y > Math.min(pa.y, pb.y) && local.y < Math.max(pa.y, pb.y);
        const tipo = dentroX && !dentroY ? "distanciaH" : dentroY && !dentroX ? "distanciaV" : "distancia";
        c = { ...base, tipo, a, b };
      } else if (ta === "linha" && tb === "linha") {
        const va = this.direcao(a), vb = this.direcao(b);
        const paralelas = va && vb && Math.abs(va.x * vb.y - va.y * vb.x) < 1e-6 * Math.hypot(va.x, va.y) * Math.hypot(vb.x, vb.y);
        c = paralelas ? { ...base, tipo: "distancia", a, b } : { ...base, tipo: "angulo", a, b };
      } else {
        c = { ...base, tipo: "distancia", a, b };
      }
    }
    if (c) {
      c.valor = medirCota(c, this.esb);
      // distanciador automático: a cota vai para a distância padrão da geometria
      c.texto = ajustarTextoCota(c, this.esb, local, this.mmPxDesenho || this.h.viewport.mmPorPixel(this.ref));
    }
    return c;
  }

  private direcao(id: string): P2 | null {
    if (id === EIXO_H) return { x: 1, y: 0 };
    if (id === EIXO_V) return { x: 0, y: 1 };
    const g = this.esb.geos.find((x) => x.id === id);
    if (!g || g.tipo !== "linha") return null;
    const pts = mapaPontos(this.esb);
    return sub(pts.get(g.p2)!, pts.get(g.p1)!);
  }

  /** Nova relação/cota: se conflitar, cota vira de referência e relação é desfeita. */
  private verificarNovaRestricao(r: RestricaoEsboco): boolean {
    const copia = JSON.stringify(this.esb.pontos);
    const raios = this.esb.geos.map((g) => (g.tipo === "circulo" || g.tipo === "arco" ? g.r : 0));
    const res = this.h.solver.resolver(this.esb);
    if (res.conflitantes.includes(r.id) || !res.ok) {
      this.esb.pontos = JSON.parse(copia);
      this.esb.geos.forEach((g, i) => { if (g.tipo === "circulo" || g.tipo === "arco") g.r = raios[i]; });
      if (ehCota(r)) {
        r.referencia = true;
        r.valor = medirCota(r, this.esb);
        this.h.avisar("Essa cota superdefiniria o esboço: ficou como cota de referência (entre parênteses).");
      } else {
        this.esb.restricoes = this.esb.restricoes.filter((x) => x.id !== r.id);
        this.h.avisar("Essa relação conflita com as que já existem: não foi aplicada.");
        this.resolver(false);
        return false;
      }
    }
    this.resolver(true);
    return true;
  }

  definirValorCota(id: string, valor: number) {
    const c = this.esb.restricoes.find((r) => r.id === id);
    if (!c || !ehCota(c) || !Number.isFinite(valor) || valor <= 0 && c.tipo !== "angulo") return;
    if (c.referencia) return;
    const antigo = c.valor;
    c.valor = valor;
    const res = this.h.solver.resolver(this.esb);
    if (!res.ok) {
      c.valor = antigo;
      this.h.avisar("O esboço não consegue chegar nesse valor (geometria impossível).");
      this.resolver(false);
      return;
    }
    this.resolver(true);
  }

  alternarReferencia(id: string) {
    const c = this.esb.restricoes.find((r) => r.id === id);
    if (!c || !ehCota(c)) return;
    if (c.referencia) {
      c.referencia = false;
      c.valor = medirCota(c, this.esb);
      this.verificarNovaRestricao(c);
    } else {
      c.referencia = true;
      this.resolver(true);
    }
  }

  /** Caixa de número sobre a cota (teclado numérico do tablet). */
  abrirEdicaoCota(id: string) {
    const c = this.esb.restricoes.find((r) => r.id === id);
    if (!c || !ehCota(c) || c.referencia) return;
    this.selecao = new Set([id]);
    this.redesenhar();
    this.h.atualizarInterface();
    const caixa = document.createElement("form");
    caixa.className = "cota-edicao";
    caixa.innerHTML = `<input inputmode="decimal" aria-label="Valor da cota" /><button type="submit" aria-label="Aplicar">✓</button>`;
    const inp = caixa.querySelector("input")!;
    inp.value = String(Number(c.valor.toFixed(4)));
    caixa.onsubmit = (ev) => {
      ev.preventDefault();
      fechar();
      this.definirValorCota(id, avaliar(inp.value));
    };
    const fechar = () => {
      caixa.remove();
      this.edicaoCota = null;
    };
    inp.onkeydown = (ev) => {
      if (ev.key === "Escape") { fechar(); ev.stopPropagation(); }
    };
    inp.onblur = () => setTimeout(() => caixa.isConnected && caixa.requestSubmit(), 120);
    this.edicaoCota = { el: caixa, id };
    this.h.overlay.appendChild(caixa);
    this.posicionarOverlay();
    inp.focus();
    inp.select();
  }
  private edicaoCota: { el: HTMLElement; id: string } | null = null;

  // ---------- seleção, relações, exclusão ----------

  private alternarSelecao(id: string) {
    if (this.selecao.has(id)) {
      this.selecao.delete(id);
      if (podarExternas(this.esb, this.selecao)) {
        this.resolver(true);
        return;
      }
    } else this.selecao.add(id);
    this.redesenhar();
    this.h.atualizarInterface();
  }

  selecionarSo(id: string) {
    this.selecao = new Set([id]);
    this.redesenhar();
    this.h.atualizarInterface();
  }

  geosSelecionadas(): string[] {
    return this.esb.geos.filter((g) => this.selecao.has(g.id)).map((g) => g.id);
  }

  /** Relações que fazem sentido para o que está selecionado. */
  relacoesPossiveis(): { rotulo: string; simbolo: string; aplicar: () => void }[] {
    const sel = [...this.selecao];
    const geos = new Map(this.esb.geos.map((g) => [g.id, g]));
    const ehPonto = (id: string) => id === ORIGEM || this.esb.pontos.some((p) => p.id === id);
    const ehLinha = (id: string) => id === EIXO_H || id === EIXO_V || geos.get(id)?.tipo === "linha";
    const ehLinhaReal = (id: string) => geos.get(id)?.tipo === "linha";
    const ehRedondo = (id: string) => ["circulo", "arco"].includes(geos.get(id)?.tipo ?? "");
    const P = sel.filter(ehPonto), L = sel.filter(ehLinha), R = sel.filter(ehRedondo);
    const out: { rotulo: string; simbolo: string; aplicar: () => void }[] = [];
    const add = (rotulo: string, rs: op.NovaRestricao[]) =>
      out.push({ rotulo, simbolo: SIMBOLO_RELACAO[rs[0].tipo] ?? "•", aplicar: () => this.aplicarRelacoes(rs) });
    const n = sel.length;

    if (n === L.length && L.length >= 1) {
      const reais = L.filter(ehLinhaReal);
      if (reais.length === L.length) {
        add("Horizontal", reais.map((a) => ({ tipo: "horizontal", a })));
        add("Vertical", reais.map((a) => ({ tipo: "vertical", a })));
      }
      if (L.length >= 2) {
        add("Paralelo", L.slice(1).map((b) => ({ tipo: "paralelo", a: L[0], b })));
        if (L.length === 2) add("Perpendicular", [{ tipo: "perpendicular", a: L[0], b: L[1] }]);
        if (reais.length === L.length) add("Igual", L.slice(1).map((b) => ({ tipo: "igual", a: L[0], b })));
        if (L.length === 2 && reais.length === 2) add("Colinear", [{ tipo: "colinear", a: L[0], b: L[1] }]);
      }
    }
    if (n === R.length && R.length >= 2) {
      if (R.length === 2) add("Tangente", [{ tipo: "tangente", a: R[0], b: R[1] }]);
      add("Igual", R.slice(1).map((b) => ({ tipo: "igual", a: R[0], b })));
      add("Concêntrico", R.slice(1).map((b) => ({ tipo: "concentrico", a: R[0], b })));
    }
    if (n === 2 && P.length === 2) {
      add("Coincidente", [{ tipo: "coincidente", a: P[0], b: P[1] }]);
      add("Horizontal", [{ tipo: "horizontal", a: P[0], b: P[1] }]);
      add("Vertical", [{ tipo: "vertical", a: P[0], b: P[1] }]);
    }
    if (n === 2 && P.length === 1 && (L.length === 1 || R.length === 1)) {
      add("Coincidente (sobre)", [{ tipo: "coincidente", a: P[0], b: L[0] ?? R[0] }]);
      if (L.length === 1 && ehLinhaReal(L[0])) add("Ponto médio", [{ tipo: "pontoMedio", p: P[0], g: L[0] }]);
    }
    if (n === 2 && L.length === 1 && R.length === 1) add("Tangente", [{ tipo: "tangente", a: L[0], b: R[0] }]);
    if (n === 3 && P.length === 2 && L.length === 1) add("Simétrico", [{ tipo: "simetrico", a: P[0], b: P[1], g: L[0] }]);

    const fixaveis = sel.filter((id) => id !== ORIGEM && id !== EIXO_H && id !== EIXO_V && (ehPonto(id) || geos.has(id)));
    if (fixaveis.length && fixaveis.length === n) {
      out.push({ rotulo: "Fixo", simbolo: SIMBOLO_RELACAO.fixo, aplicar: () => this.fixar(fixaveis) });
    }
    return out;
  }

  private aplicarRelacoes(rs: op.NovaRestricao[]) {
    const criadas: RestricaoEsboco[] = [];
    for (const r of rs) {
      const id = op.restringir(this.esb, r);
      criadas.push(this.esb.restricoes.find((x) => x.id === id)!);
    }
    const res = this.h.solver.resolver(this.esb);
    if (!res.ok || criadas.some((c) => res.conflitantes.includes(c.id))) {
      const ids = new Set(criadas.map((c) => c.id));
      this.esb.restricoes = this.esb.restricoes.filter((x) => !ids.has(x.id));
      this.h.avisar("Essa relação conflita com as que já existem: não foi aplicada.");
      this.resolver(false);
      return;
    }
    this.selecao.clear();
    this.fecharCaixaRelacoes();
    podarExternas(this.esb, this.selecao);
    this.resolver(true);
  }

  private fixar(ids: string[]) {
    const pts = mapaPontos(this.esb);
    const rs: op.NovaRestricao[] = [];
    for (const id of ids) {
      const g = this.esb.geos.find((x) => x.id === id);
      if (!g) {
        const p = pts.get(id)!;
        rs.push({ tipo: "fixo", a: id, x: p.x, y: p.y });
      } else if (g.tipo === "circulo" || g.tipo === "arco") {
        const c = pts.get(g.c)!;
        rs.push({ tipo: "fixo", a: g.id, x: c.x, y: c.y, r: g.r });
        if (g.tipo === "arco") for (const e of [g.ini, g.fim]) rs.push({ tipo: "fixo", a: e, ...pts.get(e)! });
      } else {
        const ps = g.tipo === "linha" ? [g.p1, g.p2] : pontosDaGeo(g);
        for (const e of ps) rs.push({ tipo: "fixo", a: e, x: pts.get(e)!.x, y: pts.get(e)!.y });
      }
    }
    this.aplicarRelacoes(rs);
  }

  /** Centro para girar/padrão circular: ponto selecionado ou a origem. */
  private centroSelecao(): P2 {
    const pts = mapaPontos(this.esb);
    const pid = [...this.selecao].find((id) => pts.has(id));
    return pid ? pts.get(pid)! : { x: 0, y: 0 };
  }

  transformarSelecao(oque: "mover" | "copiar" | "girar" | "girarCopia" | "padraoLinear" | "padraoCircular", v: { dx?: number; dy?: number; angulo?: number; n?: number; esp?: number }) {
    const geos = this.geosSelecionadas();
    if (!geos.length) return this.h.avisar("Selecione as entidades primeiro.");
    let novas: string[] = [];
    if (oque === "mover" || oque === "copiar") novas = op.transformar(this.esb, geos, op.transladar({ x: v.dx ?? 0, y: v.dy ?? 0 }), oque === "copiar");
    else if (oque === "girar" || oque === "girarCopia") novas = op.transformar(this.esb, geos, op.girar(this.centroSelecao(), v.angulo ?? 0), oque === "girarCopia");
    else if (oque === "padraoLinear") novas = op.padraoLinearEsboco(this.esb, geos, v.n ?? 2, v.esp ?? 10, v.angulo ?? 0);
    else novas = op.padraoCircularEsboco(this.esb, geos, this.centroSelecao(), v.n ?? 2, v.angulo ?? 360);
    this.selecao = new Set(novas);
    this.resolver(true);
  }

  excluirSelecao() {
    const ids = [...this.selecao].filter((id) => id !== ORIGEM && id !== EIXO_H && id !== EIXO_V);
    if (!ids.length) return;
    op.excluir(this.esb, ids);
    this.selecao.clear();
    this.resolver(true);
  }

  excluirConflitos() {
    const ids = new Set(this.estado.conflitantes);
    const antes = this.esb.restricoes.length;
    this.esb.restricoes = this.esb.restricoes.filter((r) => !ids.has(r.id));
    if (this.esb.restricoes.length === antes) {
      this.h.avisar("O conflito vem da própria geometria; apague cotas ou relações manualmente.");
      return;
    }
    this.resolver(true);
  }

  alternarConstrucaoSelecao() {
    const gs = this.esb.geos.filter((g) => this.selecao.has(g.id));
    if (!gs.length) return;
    const valor = !gs.every((g) => g.construcao);
    for (const g of gs) {
      if (valor) g.construcao = true;
      else delete g.construcao;
    }
    this.resolver(true);
  }

  /** Relações (não cotas) que citam algo selecionado — listadas no painel. */
  relacoesDaSelecao(): RestricaoEsboco[] {
    return this.esb.restricoes.filter((r) =>
      !ehCota(r) && (this.selecao.has(r.id) || op.referencias(r).some((x) => this.selecao.has(x))));
  }

  // ---------- caixinha de relações no ponteiro ----------

  /** Abre (ou move) a caixinha com os símbolos das relações possíveis ao lado do ponteiro. */
  private abrirCaixaRelacoes(x: number, y: number) {
    if (this.ferramenta !== "selecionar" || !this.selecao.size || !this.relacoesPossiveis().length) {
      this.fecharCaixaRelacoes();
      return;
    }
    if (!this.caixaRel) {
      const el = document.createElement("div");
      el.className = "caixa-relacoes";
      el.setAttribute("role", "toolbar");
      el.setAttribute("aria-label", "Adicionar relação");
      el.onpointerdown = (ev) => ev.stopPropagation();
      el.onwheel = (ev) => ev.stopPropagation();
      this.h.overlay.appendChild(el);
      this.caixaRel = { el, x, y };
    }
    this.caixaRel.x = x;
    this.caixaRel.y = y;
    this.atualizarCaixaRelacoes();
  }

  /** Refaz os botões conforme a seleção atual; fecha se nada se aplica. */
  private atualizarCaixaRelacoes() {
    const c = this.caixaRel;
    if (!c) return;
    const rels = this.ferramenta === "selecionar" && this.selecao.size ? this.relacoesPossiveis() : [];
    if (!rels.length) {
      this.fecharCaixaRelacoes();
      return;
    }
    c.el.innerHTML = "";
    for (const r of rels) {
      const b = document.createElement("button");
      b.className = "simbolo-relacao";
      b.textContent = r.simbolo;
      b.title = r.rotulo;
      b.setAttribute("aria-label", r.rotulo);
      b.onclick = () => r.aplicar();
      c.el.appendChild(b);
    }
    // ao lado do ponteiro, sem sair da área do desenho
    const ov = this.h.overlay.getBoundingClientRect();
    const w = c.el.offsetWidth || rels.length * 46, h = c.el.offsetHeight || 50;
    const px = Math.min(Math.max(4, c.x - ov.left + 18), ov.width - w - 4);
    const py = Math.min(Math.max(4, c.y - ov.top + 18), ov.height - h - 4);
    c.el.style.transform = `translate(${px}px, ${py}px)`;
  }

  fecharCaixaRelacoes() {
    this.caixaRel?.el.remove();
    this.caixaRel = null;
  }

  // ---------- teclado (computador ou teclado do tablet) ----------

  teclado(e: KeyboardEvent): boolean {
    const atalhos: Record<string, Ferramenta> = {
      l: "linha", r: "retangulo", c: "circulo", a: "arco", s: "spline", p: "poligono",
      t: "aparar", d: "cota", o: "offset", m: "espelhar", v: "selecionar",
    };
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === "Escape") { this.cancelar(); return true; }
    if (e.key === "Enter") {
      if (this.ferramenta === "spline") this.concluirSpline();
      else { this.cliques = []; this.redesenhar(); }
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") { this.excluirSelecao(); return true; }
    const f = atalhos[e.key.toLowerCase()];
    if (f) { this.definirFerramenta(f); return true; }
    return false;
  }

  // ---------- desenho ----------

  private aoMudarCamera() {
    if (this.quadroPendente) return;
    this.quadroPendente = requestAnimationFrame(() => {
      this.quadroPendente = 0;
      const m = this.h.viewport.mmPorPixel(this.ref);
      if (Math.abs(m - this.mmPxDesenho) > this.mmPxDesenho * 0.12) this.redesenhar();
      else this.posicionarOverlay();
    });
  }

  private previa(): { segmentos: P2[]; pontos: P2[] } {
    const segs: P2[] = [];
    const pontos: P2[] = this.cliques.map((c) => c.p);
    const cur = this.cursor?.p;
    const c = this.cliques.map((x) => x.p);
    // arrastando sem clique anterior: o ponto onde a caneta/dedo desceu é o primeiro
    if (!c.length && this.ponteiro?.moveu) {
      c.push(this.ponteiro.enc.p);
      pontos.push(this.ponteiro.enc.p);
    }
    const poli = (ps: P2[], fechar = false) => {
      for (let i = 0; i + 1 < ps.length; i++) segs.push(ps[i], ps[i + 1]);
      if (fechar && ps.length > 2) segs.push(ps[ps.length - 1], ps[0]);
    };
    const circ = (ctr: P2, r: number, a0 = 0, a1 = Math.PI * 2) => {
      const n = 64;
      poli(Array.from({ length: n + 1 }, (_, i) => polar(ctr, r, a0 + ((a1 - a0) * i) / n)));
    };
    if (!cur) return { segmentos: segs, pontos };
    switch (this.ferramenta) {
      case "linha":
        if (c.length) segs.push(c[0], cur);
        break;
      case "retangulo":
        if (this.tipoRetangulo === "centro" && c.length) {
          const d = sub(cur, c[0]);
          poli([sub(c[0], d), { x: c[0].x + d.x, y: c[0].y - d.y }, cur, { x: c[0].x - d.x, y: c[0].y + d.y }], true);
        } else if (this.tipoRetangulo === "3pontos") {
          if (c.length === 1) segs.push(c[0], cur);
          if (c.length === 2) {
            const u = sub(c[1], c[0]);
            const l = Math.hypot(u.x, u.y) || 1;
            const n = { x: -u.y / l, y: u.x / l };
            const h = (cur.x - c[1].x) * n.x + (cur.y - c[1].y) * n.y;
            poli([c[0], c[1], soma(c[1], mult(n, h)), soma(c[0], mult(n, h))], true);
          }
        } else if (c.length) poli([c[0], { x: cur.x, y: c[0].y }, cur, { x: c[0].x, y: cur.y }], true);
        break;
      case "circulo":
        if (this.tipoCirculo === "perimetro") {
          if (c.length === 1) segs.push(c[0], cur);
          const ctr = c.length === 2 ? centroTresPontos(c[0], c[1], cur) : null;
          if (ctr) circ(ctr, dist(ctr, cur));
        } else if (c.length) circ(c[0], dist(c[0], cur));
        break;
      case "arco":
        if (this.tipoArco === "centro") {
          if (c.length === 1) segs.push(c[0], cur);
          if (c.length === 2) {
            const r = dist(c[0], c[1]);
            let a0 = angulo(c[0], c[1]), a1 = angulo(c[0], cur);
            const cr = (c[1].x - c[0].x) * (cur.y - c[0].y) - (c[1].y - c[0].y) * (cur.x - c[0].x);
            if (cr < 0) [a0, a1] = [a1, a0];
            while (a1 < a0) a1 += 2 * Math.PI;
            circ(c[0], r, a0, a1);
          }
          break;
        }
        if (this.tipoArco === "tangente") {
          if (c.length === 1) segs.push(c[0], cur);
          break;
        }
        if (c.length === 1) segs.push(c[0], cur);
        if (c.length === 2) {
          const ctr = centroTresPontos(c[0], cur, c[1]);
          if (ctr) {
            const r = dist(ctr, c[0]);
            let a0 = angulo(ctr, c[0]), a1 = angulo(ctr, c[1]);
            const am = angulo(ctr, cur);
            const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            if (norm(am - a0) > norm(a1 - a0)) [a0, a1] = [a1, a0];
            circ(ctr, r, a0, a0 + norm(a1 - a0));
          }
        }
        break;
      case "rasgo":
        if (c.length === 1) segs.push(c[0], cur);
        if (c.length === 2) {
          const [e0, e1] = this.tipoRasgo === "centro" ? [{ x: 2 * c[0].x - c[1].x, y: 2 * c[0].y - c[1].y }, c[1]] : [c[0], c[1]];
          c.splice(0, 2, e0, e1);
          const r = distPontoSegmento(cur, c[0], c[1]).d;
          const u = sub(c[1], c[0]);
          const l = Math.hypot(u.x, u.y) || 1;
          const n = { x: -u.y / l, y: u.x / l };
          const ang = Math.atan2(n.y, n.x);
          segs.push(soma(c[0], mult(n, r)), soma(c[1], mult(n, r)), soma(c[0], mult(n, -r)), soma(c[1], mult(n, -r)));
          circ(c[1], r, ang - Math.PI, ang);
          circ(c[0], r, ang, ang + Math.PI);
        }
        break;
      case "poligono":
        if (c.length) {
          const n = Math.max(3, Math.round(this.lados));
          const r = dist(c[0], cur) / (this.poligonoCircunscrito ? Math.cos(Math.PI / n) : 1);
          const a0 = angulo(c[0], cur) + (this.poligonoCircunscrito ? Math.PI / n : 0);
          poli(Array.from({ length: n }, (_, i) => polar(c[0], r, a0 + (i * 2 * Math.PI) / n)), true);
        }
        break;
      case "spline":
        if (c.length) {
          const bz = splineBeziers([...c, cur]);
          const ps: P2[] = [];
          bz.forEach((b, i) => { for (let k = i ? 1 : 0; k <= 12; k++) ps.push(pontoBezier(b, k / 12)); });
          poli(ps);
        }
        break;
    }
    return { segmentos: segs, pontos };
  }

  redesenhar() {
    const vp = this.h.viewport;
    if (this.camada) {
      vp.grupoEsboco.remove(this.camada);
      descartarCamada(this.camada);
    }
    this.mmPxDesenho = vp.mmPorPixel(this.ref);
    const { w, h } = vp.tamanho();
    const marcador = this.cursor && (this.cursor.ponto || this.cursor.geo || this.cursor.meio) ? this.cursor.p : null;
    this.cotaPrevia = this.previaCota();
    this.camada = construirCamada(this.esb, {
      ref: this.ref,
      mmPx: this.mmPxDesenho,
      resolucao: { w, h },
      editando: true,
      livres: this.livres,
      selecao: this.selecao,
      conflitantes: this.conflito,
      previa: this.ferramentaUsaEncaixe() ? this.previa() : undefined,
      marcador,
      mostrarEixos: true,
      cotaPrevia: this.cotaPrevia,
    });
    vp.grupoEsboco.add(this.camada);
    this.montarOverlay();
    vp.pedirRender();
  }

  /** Cota em andamento seguindo o cursor (já com o distanciador aplicado). */
  private cotaPrevia: CotaEsboco | null = null;
  private previaCota(): CotaEsboco | null {
    if (this.ferramenta !== "cota" || !this.cotaEntidades.length || !this.cursor) return null;
    // cursor sobre outra entidade: o próximo toque a escolhe, não posiciona a cota
    const alvo = this.achar(this.cursor.p, this.tolMm(this.tela?.tipo ?? "mouse"));
    if (alvo && !this.cotaEntidades.includes(alvo.id) && this.cotaEntidades.length < 2) return null;
    if (!alvo && this.cotaEntidades.length < 2 && this.tela && this.acharModelo(this.tela.x, this.tela.y, this.tela.tipo, ["vertice", "aresta"])) return null;
    return this.novaCota(this.cotaEntidades, this.cursor.p);
  }

  // ---------- rótulos HTML: cotas, relações, dica do cursor, lupa ----------

  private rotulos: { el: HTMLElement; p: P2; dx?: number; dy?: number }[] = [];

  private montarOverlay() {
    const ov = this.h.overlay;
    // preserva a caixa de edição de cota e a lupa
    for (const el of [...ov.children]) if (el !== this.edicaoCota?.el && el !== this.lupa?.canvas && el !== this.caixaRel?.el) el.remove();
    this.atualizarCaixaRelacoes();
    this.rotulos = [];
    const pts = mapaPontos(this.esb);
    const geos = new Map(this.esb.geos.map((g) => [g.id, g]));

    for (const r of this.esb.restricoes) {
      if (!ehCota(r)) continue;
      const d = desenharCota(r, this.esb, this.mmPxDesenho);
      if (!d) continue;
      const el = document.createElement("div");
      el.className = "cota-rotulo";
      el.classList.toggle("selecionado", this.selecao.has(r.id));
      el.classList.toggle("conflito", this.conflito.has(r.id));
      el.classList.toggle("referencia", !!r.referencia);
      el.textContent = textoCota(r);
      this.prenderArrasteCota(el, r);
      ov.appendChild(el);
      this.rotulos.push({ el, p: d.texto });
    }

    if (this.mostrarRelacoes) {
      const ancora = (id: string): P2 | null => {
        if (id === EIXO_H) return { x: 30 * this.mmPxDesenho, y: 0 };
        if (id === EIXO_V) return { x: 0, y: 30 * this.mmPxDesenho };
        const g = geos.get(id);
        if (!g) return pts.get(id) ?? null;
        if (g.tipo === "linha") return mult(soma(pts.get(g.p1)!, pts.get(g.p2)!), 0.5);
        if (g.tipo === "circulo") return polar(pts.get(g.c)!, g.r, Math.PI / 2);
        if (g.tipo === "arco") return mult(soma(pts.get(g.ini)!, pts.get(g.fim)!), 0.5);
        if (g.tipo === "ponto") return pts.get(g.p) ?? null;
        return pts.get(g.pontos[Math.floor(g.pontos.length / 2)]) ?? null;
      };
      const SIMBOLO = SIMBOLO_RELACAO;
      const externos = idsExternos(this.esb);
      const contagem = new Map<string, number>();
      const vistos = new Set<string>();
      for (const r of this.esb.restricoes) {
        if (ehCota(r)) continue;
        if (r.tipo === "fixo" && externos.has(r.a)) continue; // referência do modelo: já é fixa por natureza
        const refs = r.tipo === "pontoMedio" ? [r.p] : r.tipo === "simetrico" ? [r.a, r.b]
          : r.tipo === "coincidente" ? [r.a] : r.tipo === "fixo" ? [r.a]
          : (r.tipo === "horizontal" || r.tipo === "vertical") && r.b ? [r.a] : op.referencias(r);
        for (const id of refs) {
          const p = ancora(id);
          if (!p) continue;
          const k = `${p.x.toFixed(3)}|${p.y.toFixed(3)}`;
          // mesmo símbolo no mesmo lugar (ex.: lados iguais do polígono) aparece uma vez só
          const chaveSimbolo = `${k}|${r.tipo}`;
          if (vistos.has(chaveSimbolo)) continue;
          vistos.add(chaveSimbolo);
          const i = contagem.get(k) ?? 0;
          contagem.set(k, i + 1);
          const el = document.createElement("button");
          el.className = "relacao";
          el.textContent = SIMBOLO[r.tipo] ?? "•";
          el.title = r.tipo;
          el.classList.toggle("selecionado", this.selecao.has(r.id));
          el.classList.toggle("conflito", this.conflito.has(r.id));
          el.onpointerdown = (ev) => ev.stopPropagation();
          el.onclick = () => this.alternarSelecao(r.id);
          ov.appendChild(el);
          this.rotulos.push({ el, p, dx: 14 + i * 20, dy: -18 });
        }
      }
    }

    if (this.cotaPrevia) {
      const d = desenharCota(this.cotaPrevia, this.esb, this.mmPxDesenho);
      if (d) {
        const el = document.createElement("div");
        el.className = "cota-rotulo previa";
        el.textContent = textoCota(this.cotaPrevia);
        ov.appendChild(el);
        this.rotulos.push({ el, p: d.texto });
      }
    }

    // dica do cursor: encaixe ou medida em andamento
    const cur = this.cursor;
    if (cur && this.ferramentaUsaEncaixe()) {
      const partes: string[] = [];
      if (cur.rotulo) partes.push(cur.rotulo);
      const c0 = this.cliques[0]?.p;
      if (c0) {
        const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
        if (this.ferramenta === "linha") partes.push(`L ${fmt(dist(c0, cur.p))}`);
        if (this.ferramenta === "circulo" || this.ferramenta === "poligono") partes.push(`R ${fmt(dist(c0, cur.p))}`);
        if (this.ferramenta === "retangulo") partes.push(`${fmt(Math.abs(cur.p.x - c0.x))} × ${fmt(Math.abs(cur.p.y - c0.y))}`);
      }
      if (partes.length) {
        const el = document.createElement("div");
        el.className = "dica-cursor";
        el.textContent = partes.join(" · ");
        ov.appendChild(el);
        this.rotulos.push({ el, p: cur.p, dx: 16, dy: 16 });
      }
    }
    this.posicionarOverlay();
  }

  /** Arrastar o número move a cota; tocar abre a edição do valor. */
  private prenderArrasteCota(el: HTMLElement, c: CotaEsboco) {
    let ini: { x: number; y: number; moveu: boolean } | null = null;
    el.onpointerdown = (e) => {
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      ini = { x: e.clientX, y: e.clientY, moveu: false };
    };
    el.onpointermove = (e) => {
      if (!ini) return;
      if (Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 5) ini.moveu = true;
      if (!ini.moveu) return;
      const p = this.noPlano(e);
      if (!p) return;
      c.texto = ajustarTextoCota(c, this.esb, p, this.mmPxDesenho);
      this.redesenhar();
    };
    el.onpointerup = () => {
      if (!ini) return;
      const moveu = ini.moveu;
      ini = null;
      if (moveu) this.h.alterou(true);
      else if (this.ferramenta === "selecionar" && !c.referencia) this.abrirEdicaoCota(c.id);
      else this.alternarSelecao(c.id);
    };
  }

  private posicionarOverlay() {
    const vp = this.h.viewport;
    for (const r of this.rotulos) {
      const t = vp.planoParaTela(this.ref, r.p.x, r.p.y);
      r.el.style.transform = `translate(${t.x + (r.dx ?? 0)}px, ${t.y + (r.dy ?? 0)}px) translate(-50%, -50%)`;
    }
    if (this.edicaoCota) {
      const c = this.esb.restricoes.find((r) => r.id === this.edicaoCota!.id);
      const d = c && ehCota(c) ? desenharCota(c, this.esb, this.mmPxDesenho) : null;
      if (d) {
        const t = vp.planoParaTela(this.ref, d.texto.x, d.texto.y);
        this.edicaoCota.el.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -50%)`;
      }
    }
  }

  private abrirLupa(e: PointerEvent) {
    if (this.lupa) return;
    const canvas = document.createElement("canvas");
    canvas.className = "lupa";
    canvas.width = canvas.height = LUPA * Math.min(2, window.devicePixelRatio);
    this.h.overlay.appendChild(canvas);
    this.lupa = { canvas, x: e.clientX, y: e.clientY };
  }

  private fecharLupa() {
    this.lupa?.canvas.remove();
    this.lupa = null;
  }

  private aposDesenhar() {
    this.posicionarOverlay();
    const l = this.lupa;
    if (!l) return;
    const fonte = this.h.viewport.canvas();
    const r = fonte.getBoundingClientRect();
    const escala = fonte.width / r.width;
    const lado = (LUPA / ZOOM_LUPA) * escala;
    const sx = (l.x - r.left) * escala - lado / 2;
    const sy = (l.y - r.top) * escala - lado / 2;
    const g = l.canvas.getContext("2d")!;
    const W = l.canvas.width;
    g.fillStyle = "#f4f6f8";
    g.fillRect(0, 0, W, W);
    g.drawImage(fonte, sx, sy, lado, lado, 0, 0, W, W);
    g.strokeStyle = "rgba(240,140,0,0.9)";
    g.lineWidth = Math.max(1, W / 120);
    g.beginPath();
    g.moveTo(W / 2 - W / 10, W / 2); g.lineTo(W / 2 + W / 10, W / 2);
    g.moveTo(W / 2, W / 2 - W / 10); g.lineTo(W / 2, W / 2 + W / 10);
    g.stroke();
    // acima e à esquerda do dedo, para não ficar embaixo da mão
    const x = Math.max(4, l.x - r.left - LUPA - 24);
    const y = Math.max(4, l.y - r.top - LUPA - 40);
    l.canvas.style.transform = `translate(${x}px, ${y}px)`;
  }
}

/** Aceita vírgula decimal e contas simples ("12,5", "20/2", "3*4+1"). */
export function avaliar(texto: string): number {
  const t = texto.replace(/,/g, ".").replace(/\s/g, "");
  if (!/^[\d.+\-*/()]+$/.test(t)) return NaN;
  try {
    return Number(Function(`"use strict"; return (${t});`)());
  } catch {
    return NaN;
  }
}
