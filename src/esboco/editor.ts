// Editor de esboço: ferramentas de desenho, encaixes, seleção, arrasto, cotas e relações.
// Entrada: caneta desenha e o dedo navega; sem caneta o dedo também desenha (encaixes maiores
// e lupa de precisão); no computador o botão esquerdo desenha, o do meio arrasta, o direito gira.

import type * as THREE from "three";
import type { CotaEsboco, FeatureEsboco, GeoEsboco, OpcoesTexto, Referencia, RestricaoEsboco } from "../model";
import { ehCota, novoId } from "../model";
import type { TipoEntidade, Viewport } from "../viewport";
import { ajustarTextoCota, desenharCota, medirCota, textoCota } from "./cotas";
import {
  amostrar, angulo, angulosArco, centroTresPontos, tracosDaGeo, paramElipse, parabolaDe, paramParabola, pontoElipse, pontoParabola, dist, distanciaGeo, distPontoSegmento, EIXO_H, EIXO_V, extremidades,
  mapaPontos, mult, ORIGEM, pontosDaGeo, polar, projetarNaGeo, soma, splineBeziers, pontoBezier, sub, type P2,
} from "./geometria";
import * as op from "./operacoes";
import { carregarFonte, fonteLida } from "./fontesTexto";
import { gerarContornos, OPCOES_TEXTO_PADRAO, type GuiaTexto } from "./texto";
import type { Font } from "opentype.js";
import { atualizarExternas, criarExterna, idsExternos, podarExternas, pontoNaProjecao, projetar, type ProjecaoExterna } from "./externas";
import { referencial, type Referencial } from "./referencial";
import type { ResultadoSolver, SolverEsboco } from "./solver";
import { construirCamada, descartarCamada } from "./visual";

export type Ferramenta =
  | "selecionar" | "ponto" | "linha" | "retangulo" | "circulo" | "arco" | "rasgo" | "poligono" | "spline"
  | "elipse" | "elipseParcial" | "parabola" | "texto"
  | "aparar" | "estender" | "fileteEsboco" | "chanfroEsboco" | "offset" | "espelhar" | "cota" | "converter"
  | "padraoLinearEsboco" | "padraoCircularEsboco" | "exibirRelacoes";

export const ROTULO_FERRAMENTA: Record<Ferramenta, string> = {
  selecionar: "Selecionar", ponto: "Ponto", linha: "Linha", retangulo: "Retângulo", circulo: "Círculo", arco: "Arco",
  rasgo: "Rasgo", poligono: "Polígono", spline: "Spline",
  elipse: "Elipse", elipseParcial: "Elipse parcial", parabola: "Parábola", texto: "Texto de esboço", aparar: "Aparar", estender: "Estender",
  fileteEsboco: "Filete de esboço", chanfroEsboco: "Chanfro de esboço", offset: "Offset",
  espelhar: "Espelhar", cota: "Cota", converter: "Converter entidades",
  padraoLinearEsboco: "Padrão linear de esboço", padraoCircularEsboco: "Padrão circular de esboço",
  exibirRelacoes: "Exibir/Excluir relações",
};

export type TipoRetangulo = "canto" | "centro" | "3pontos" | "centro3" | "paralelogramo";
export type TipoLinha = "normal" | "centro" | "pontoMedio";
export type TipoCirculo = "centro" | "perimetro";
export type TipoArco = "3pontos" | "centro" | "tangente";
export type TipoRasgo = "reto" | "centro" | "arco3" | "arcoCentro";
export type ModoAparar = "potente" | "canto" | "dentro" | "fora" | "proximo";

/** Instrução curta mostrada no painel para cada etapa da ferramenta. */
function instrucao(f: Ferramenta, n: number, ed?: EditorEsboco): string {
  if (ed) {
    if (f === "aparar") {
      const m = ed.aparo.modo, k = ed.qtdLimitesAparar;
      if (m === "potente") return "Arraste o cursor cruzando as entidades: cada trecho tocado é apagado (um toque também apara).";
      if (m === "canto") return k ? "Toque a segunda entidade (do lado que fica)." : "Toque a primeira entidade, do lado que fica.";
      if (m === "dentro" || m === "fora") {
        return k < 2 ? `Toque a ${k ? "segunda" : "primeira"} entidade de limite.`
          : m === "dentro" ? "Toque as entidades a aparar: sai o trecho entre os limites." : "Toque as entidades a aparar: sai o que passa dos limites.";
      }
    }
    if (f === "retangulo" && ed.tipoRetangulo === "centro") return n ? "Toque um canto." : "Toque o centro.";
    if (f === "retangulo" && ed.tipoRetangulo === "centro3") return ["Toque o centro.", "Toque o meio de um lado (define a direção).", "Toque um canto."][n] ?? "";
    if (f === "retangulo" && ed.tipoRetangulo === "paralelogramo") return ["Toque o 1º canto.", "Toque o 2º canto.", "Toque o 3º canto (o 4º é calculado)."][n] ?? "";
    if (f === "linha" && ed.tipoLinha === "pontoMedio") return n ? "Toque uma ponta da linha." : "Toque o ponto do meio da linha.";
    if (f === "linha" && ed.tipoLinha === "centro") return n ? "Próximo ponto da linha de centro (Esc termina)." : "Toque o início da linha de centro.";
    if (f === "rasgo" && ed.tipoRasgo === "arco3") return ["Toque o início do arco do rasgo.", "Toque o fim.", "Toque um ponto por onde o arco passa.", "Toque para definir a largura."][n] ?? "";
    if (f === "rasgo" && ed.tipoRasgo === "arcoCentro") return ["Toque o centro do arco.", "Toque o início (define o raio).", "Toque o fim.", "Toque para definir a largura."][n] ?? "";
    if (f === "retangulo" && ed.tipoRetangulo === "3pontos") return ["Toque o 1º canto.", "Toque o 2º canto (define o lado e o ângulo).", "Toque para definir a largura."][n] ?? "";
    if (f === "circulo" && ed.tipoCirculo === "perimetro") return ["Toque o 1º ponto do contorno.", "Toque o 2º ponto.", "Toque o 3º ponto."][n] ?? "";
    if (f === "arco" && ed.tipoArco === "centro") return ["Toque o centro.", "Toque o início do arco.", "Toque o fim do arco."][n] ?? "";
    if (f === "arco" && ed.tipoArco === "tangente") return n ? "Toque o fim do arco." : "Toque a ponta de uma linha ou arco existente.";
    if (f === "rasgo" && ed.tipoRasgo === "centro") return ["Toque o centro do rasgo.", "Toque o centro de uma ponta.", "Toque para definir a largura."][n] ?? "";
  }
  switch (f) {
    case "estender": return "Toque perto da ponta da linha a estender até a próxima interseção.";
    case "converter": return "Toque arestas e vértices da peça: viram geometria do esboço (fixa, usada no perfil).";
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
    case "elipse": return ["Toque o centro.", "Toque a ponta do eixo maior.", "Toque para definir o eixo menor."][n] ?? "";
    case "elipseParcial":
      return ["Toque o centro.", "Toque a ponta do eixo maior.", "Toque para definir o eixo menor e o início do arco.", "Toque o fim do arco (sentido anti-horário)."][n] ?? "";
    case "texto": return ed?.campoTexto === "curva"
      ? "Toque a linha, o arco ou o círculo que o texto deve seguir."
      : ed?.ultimoTexto ? "Edite o texto no painel; toque no desenho para começar outro texto ali." : "Toque onde o texto começa.";
    case "parabola": return ["Toque o foco.", "Toque o vértice.", "Toque o início do arco.", "Toque o fim do arco."][n] ?? "";
    case "spline": return n ? "Mais pontos. Toque no último de novo (ou Esc) para terminar; no primeiro, fecha a curva." : "Toque o primeiro ponto da curva.";
    case "aparar": return "Toque o trecho a apagar (entre interseções).";
    case "offset": return "Toque uma entidade: a cadeia ligada a ela é copiada à distância indicada.";
    case "exibirRelacoes": return "Toque uma relação da lista para ver as entidades; toque entidades no desenho para filtrar por elas.";
    case "padraoLinearEsboco":
    case "padraoCircularEsboco": {
      const c = ed?.campoPadrao;
      return c === "dir1" || c === "dir2" ? "Toque a direção: linha do esboço, eixo ou aresta reta da peça."
        : c === "centro" ? "Toque o ponto de centro (ou um círculo/arco: vale o centro dele)."
        : "Toque as entidades a padronizar.";
    }
    case "espelhar": return ed?.espelho.campo === "eixo"
      ? "Toque a linha de espelho: linha do esboço, eixo ou aresta reta da peça."
      : "Toque as entidades a espelhar; depois o campo \"Espelhar em relação a\".";
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
  tipoLinha: TipoLinha = "normal";
  /** Último polígono criado: o painel edita centro, diâmetro, ângulo, lados e tipo dele. */
  ultimoPoligono: { geos: string[]; circ: string; centro: string; vertice: string } | null = null;
  /** Padrão linear de esboço (painel): direções 1 e 2 e instâncias a pular ("2, 3-2"). */
  padraoLin = {
    dir1: { ref: null as string | null, ang: 0, esp: 20, n: 3, inverter: false, cotar: true },
    dir2: { ref: null as string | null, ang: 90, esp: 20, n: 1, inverter: false, cotar: true },
    pular: "",
  };
  /** Padrão circular de esboço (painel). */
  padraoCirc = { centro: null as string | null, cx: 0, cy: 0, angulo: 360, igual: true, n: 4, inverter: false, cotarRaio: false, pular: "" };
  /** Campo de seleção ativo nos painéis de padrão. */
  campoPadrao: "entidades" | "dir1" | "dir2" | "centro" = "entidades";
  poligonoCircunscrito = false;
  raioFilete = 3;
  cotarFilete = true;
  distChanfro = 2;
  distOffset = 5;
  /** Opções do aparar (painel "Aparar"). */
  aparo: { modo: ModoAparar; construcao: boolean; ignorarConstrucao: boolean } = { modo: "potente", construcao: false, ignorarConstrucao: false };
  /** Entidades já tocadas no canto / limites do aparar dentro-fora. */
  private aparoRefs: { id: string; p: P2 }[] = [];
  /** Rastro do aparar potente enquanto o cursor é arrastado. */
  private rastro: P2[] | null = null;
  get qtdLimitesAparar() {
    return this.aparoRefs.length;
  }
  /** Opções do offset (painel "Offset de entidades"). */
  offset: Required<op.OpcoesOffset> & { inverter: boolean; cadeia: boolean } = {
    cotar: true, inverter: false, cadeia: true, bidirecional: false, tampar: "nenhuma", baseConstrucao: false, construcao: false,
  };
  /** Sem caneta detectada o dedo desenha; ao primeiro toque de caneta isso desliga. */
  dedoDesenha = true;
  /** Mostrar a opção "desenhar com o dedo" (só no perfil tablet, onde há caneta). */
  opcaoDedo = true;
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
    if (f === "espelhar") {
      this.espelho = { campo: this.geosSelecionadas().length ? "eixo" : "entidades", eixo: null, copiar: this.espelho.copiar };
    }
    this.ferramenta = f;
    this.cliques = [];
    this.cotaEntidades = [];
    this.aparoRefs = [];
    this.fecharCaixaRelacoes();
    if (f === "padraoLinearEsboco" || f === "padraoCircularEsboco") this.campoPadrao = "entidades";
    if (f === "texto" && !this.editandoTexto) {
      this.ultimoTexto = null;
      this.campoTexto = "posicao";
    }
    this.editandoTexto = false;
    if (!["selecionar", "espelhar", "offset", "padraoLinearEsboco", "padraoCircularEsboco", "exibirRelacoes"].includes(f)) {
      this.selecao.clear();
      if (podarExternas(this.esb, this.selecao)) this.resolver(false);
    }
    this.redesenhar();
    this.h.atualizarInterface();
  }

  /** Variante atual de uma ferramenta (subfunção do menu ▾). */
  variante(f: string): string | undefined {
    return ({ linha: this.tipoLinha, retangulo: this.tipoRetangulo, circulo: this.tipoCirculo, arco: this.tipoArco, rasgo: this.tipoRasgo } as Record<string, string>)[f];
  }

  definirVariante(f: string, v: string) {
    if (f === "linha") this.tipoLinha = v as TipoLinha;
    else if (f === "retangulo") this.tipoRetangulo = v as TipoRetangulo;
    else if (f === "circulo") this.tipoCirculo = v as TipoCirculo;
    else if (f === "arco") this.tipoArco = v as TipoArco;
    else if (f === "rasgo") this.tipoRasgo = v as TipoRasgo;
  }

  get instrucao(): string {
    return instrucao(this.ferramenta, this.ferramenta === "cota" ? this.cotaEntidades.length : this.cliques.length, this);
  }

  // ---------- solver ----------

  /** Resolve, atualiza estado/definição e redesenha. `final` grava passo de desfazer. */
  resolver(final: boolean, notificar = true) {
    podarExternas(this.esb, this.selecao);
    this.estado = this.h.solver.resolver(this.esb);
    this.atualizarTextosNaCurva();
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

  /** Converter entidades: a aresta/vértice da peça vira geometria do esboço (fixa, não construção). */
  private converterModelo(m: AlvoModelo) {
    const g = criarExterna(this.esb, m.proj, m.ref);
    delete g.construcao;
    this.resolver(true);
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
    // Converter: a peça tem prioridade (o eixo do esboço pode passar por cima da aresta)
    const modelo = (this.ferramenta === "converter" || (!alvo && this.ferramenta === "selecionar")) && e.pointerType !== "touch"
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
    return !["selecionar", "aparar", "estender", "fileteEsboco", "chanfroEsboco", "offset", "espelhar", "cota", "converter",
      "padraoLinearEsboco", "padraoCircularEsboco", "exibirRelacoes"].includes(this.ferramenta);
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
    if (pt && pt.moveu && this.ferramenta === "aparar" && this.aparo.modo === "potente") {
      (this.rastro ??= [pt.enc.p]).push(p);
      const alvo = this.achar(p, tol);
      if (alvo?.tipo === "geo") this.aparoNoPonto(alvo.id, p);
      this.redesenhar();
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

    if (this.ferramenta === "converter") {
      if (pt.modelo && !pt.moveu) this.converterModelo(pt.modelo);
      return;
    }
    if (this.rastro) {
      // fim do aparar potente: um passo de desfazer para tudo o que foi riscado
      this.rastro = null;
      this.resolver(true);
      return;
    }
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
    const precisaDois = ["linha", "retangulo", "circulo", "arco", "rasgo", "poligono", "elipse", "elipseParcial", "parabola"].includes(this.ferramenta);
    if (pt.moveu && precisaDois && this.cliques.length === 0) this.registrar(pt.enc, tol, pt.tipo);
    const anterior = this.cliques.length ? this.cliques[this.cliques.length - 1].p : undefined;
    const enc = this.ferramentaUsaEncaixe() ? this.encaixar(p, tol, this.ferramenta === "linha" ? anterior : undefined) : { p };
    this.registrar(enc, tol, pt.tipo);
  }

  private aoToqueCurto(e: PointerEvent) {
    // toque de dedo que não foi interceptado (navegação): numa aresta/vértice da peça vira
    // referência; no vazio, limpa a seleção
    if (e.pointerType === "touch" && this.ferramenta === "converter") {
      const m = this.acharModelo(e.clientX, e.clientY, "touch", ["vertice", "aresta"]);
      if (m) this.converterModelo(m);
      return;
    }
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
    if (pt?.arraste || this.rastro) {
      this.rastro = null;
      this.resolver(true);
    }
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
          // elipse e parábola: arrastar a curva leva a curva inteira (as pontas dos eixos mudam o tamanho)
          const ids = g.tipo === "linha" ? [g.p1, g.p2] : g.tipo === "spline" ? g.pontos
            : g.tipo === "elipse" || g.tipo === "arcoElipse" || g.tipo === "parabola" ? pontosDaGeo(g) : [];
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
      const id = alvo?.tipo === "geo" && alvo.id !== EIXO_H && alvo.id !== EIXO_V ? alvo.id : null;
      if (!id) return;
      const m = this.aparo.modo;
      if (m === "potente" || m === "proximo") {
        if (this.aparoNoPonto(id, enc.p)) this.resolver(true);
        return;
      }
      if (m === "canto") {
        if (!this.aparoRefs.length) {
          this.aparoRefs = [{ id, p: enc.p }];
          this.selecao = new Set([id]);
        } else {
          const r = this.aparoRefs[0];
          this.aparoRefs = [];
          this.selecao.clear();
          if (op.canto(esb, r.id, r.p, id, enc.p)) this.resolver(true);
          else this.h.avisar("Canto: toque duas linhas que não sejam paralelas.");
        }
        this.redesenhar();
        this.h.atualizarInterface();
        return;
      }
      // dentro / fora: dois limites, depois as entidades a aparar
      if (this.aparoRefs.length < 2) {
        if (!this.aparoRefs.some((r) => r.id === id)) this.aparoRefs.push({ id, p: enc.p });
        this.selecao = new Set(this.aparoRefs.map((r) => r.id));
        this.redesenhar();
        this.h.atualizarInterface();
        return;
      }
      const g = esb.geos.find((x) => x.id === id);
      if (g?.construcao && this.aparo.ignorarConstrucao) return;
      const lim: [string, string] = [this.aparoRefs[0].id, this.aparoRefs[1].id];
      if (op.apararEntre(esb, id, lim, m === "dentro", this.aparo.construcao)) this.resolver(true);
      else this.h.avisar("A entidade precisa cruzar as duas entidades de limite.");
      return;
    }
    if (f === "offset") {
      const alvo = this.achar(enc.p, tol);
      if (alvo?.tipo !== "geo" || alvo.id === EIXO_H || alvo.id === EIXO_V) return;
      if (this.offset.cadeia) this.selecao = new Set(this.cadeiaDe(alvo.id));
      else if (this.selecao.has(alvo.id)) this.selecao.delete(alvo.id);
      else this.selecao.add(alvo.id);
      this.redesenhar();
      this.h.atualizarInterface();
      return;
    }
    if (f === "padraoLinearEsboco" || f === "padraoCircularEsboco") {
      this.toquePadrao(this.achar(enc.p, tol));
      return;
    }
    if (f === "texto") {
      this.toqueTexto(enc, tol);
      return;
    }
    if (f === "exibirRelacoes") {
      const alvo = this.achar(enc.p, tol);
      if (!alvo) this.selecao.clear();
      else if (this.selecao.has(alvo.id)) this.selecao.delete(alvo.id);
      else this.selecao.add(alvo.id);
      if (this.selecao.size) this.filtroRelacoes = "selecionadas";
      this.redesenhar();
      this.h.atualizarInterface();
      return;
    }
    if (f === "espelhar") {
      const alvo = this.achar(enc.p, tol);
      if (this.espelho.campo === "entidades") {
        if (alvo?.tipo !== "geo" || alvo.id === EIXO_H || alvo.id === EIXO_V) return;
        if (this.selecao.has(alvo.id)) this.selecao.delete(alvo.id);
        else this.selecao.add(alvo.id);
        if (this.espelho.eixo && this.selecao.has(this.espelho.eixo)) this.espelho.eixo = null;
      } else {
        const g = alvo && esb.geos.find((x) => x.id === alvo.id);
        let eixo = alvo && (alvo.id === EIXO_H || alvo.id === EIXO_V || g?.tipo === "linha") ? alvo.id : null;
        if (!eixo) {
          // aresta reta da peça: vira referência do modelo e serve de espelho
          const m = this.tela && this.acharModelo(this.tela.x, this.tela.y, this.tela.tipo, ["aresta"]);
          const ge = m && criarExterna(this.esb, m.proj, m.ref);
          if (ge?.tipo === "linha") eixo = ge.id;
        }
        if (!eixo) {
          this.h.avisar("Toque uma linha do esboço, um eixo ou uma aresta reta da peça para servir de espelho.");
          return;
        }
        this.espelho.eixo = eixo;
        this.selecao.delete(eixo);
      }
      this.redesenhar();
      this.h.atualizarInterface();
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
        if (this.tipoLinha === "pontoMedio") {
          if (c.length === 2) {
            op.linhaPontoMedio(esb, this.pontoDo(c[0]), c[1].p, cons);
            pronto = true;
          }
          break;
        }
        if (c.length === 2) {
          const a = this.pontoDo(c[0]);
          const b = this.pontoDo(c[1]);
          const l = op.linha(esb, a, b, cons || this.tipoLinha === "centro");
          if (c[1].hv) op.restringir(esb, { tipo: c[1].hv, a: l.id });
          const fecha = !!c[1].ponto; // terminou num ponto que já existia: fecha a cadeia
          this.cliques = fecha ? [] : [{ p: c[1].p, ponto: b }];
          this.resolver(true);
          return;
        }
        // primeiro clique: se ele cair num ponto existente, a linha parte dele
        break;
      case "retangulo":
        if (this.tipoRetangulo === "centro3") {
          if (c.length === 3) { op.retanguloCentro3Pontos(esb, this.pontoDo(c[0]), c[1].p, c[2].p, cons); pronto = true; }
        } else if (this.tipoRetangulo === "paralelogramo") {
          if (c.length === 3) { op.paralelogramo(esb, this.pontoDo(c[0]), this.pontoDo(c[1]), c[2].p, cons); pronto = true; }
        } else if (this.tipoRetangulo === "3pontos") {
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
        if (this.tipoRasgo === "arco3" || this.tipoRasgo === "arcoCentro") {
          if (c.length === 4) {
            const g = this.geometriaRasgoArco(c.map((k) => k.p));
            if (!g || g.w === null || !op.rasgoArco(esb, op.ponto(esb, g.c), g.r, g.a0, g.a1, g.w, cons).length) {
              this.h.avisar("Rasgo em arco: a largura deve ser menor que o raio, e os pontos não podem estar alinhados.");
            }
            pronto = true;
          }
          break;
        }
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
          const centro = this.pontoDo(c[0]);
          const gs = this.poligonoCircunscrito
            ? op.poligonoCircunscrito(esb, centro, c[1].p, this.lados, cons)
            : op.poligono(esb, centro, c[1].p, this.lados, cons);
          this.lembrarPoligono(gs, centro);
          pronto = true;
        }
        break;
      case "elipse":
      case "elipseParcial": {
        const final = f === "elipse" ? 3 : 4;
        if (c.length === final) {
          const b = op.semieixoMenor(c[0].p, c[1].p, c[2].p);
          if (dist(c[0].p, c[1].p) < 1e-6 || b < 1e-6) this.h.avisar("Elipse: os eixos não podem ter tamanho zero.");
          else if (f === "elipse") op.elipse(esb, this.pontoDo(c[0]), c[1].p, b, cons);
          else op.arcoElipse(esb, this.pontoDo(c[0]), c[1].p, b, c[2].p, c[3].p, cons);
          pronto = true;
        }
        break;
      }
      case "parabola":
        if (c.length === 4) {
          if (dist(c[0].p, c[1].p) < 1e-6) this.h.avisar("Parábola: o foco e o vértice não podem coincidir.");
          else op.parabola(esb, this.pontoDo(c[0]), c[1].p, c[2].p, c[3].p, cons);
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

  /**
   * Rasgo em arco a partir dos toques: arco3 = início, fim, ponto do arco, largura;
   * arcoCentro = centro, início, fim, largura. Devolve centro, raio, ângulos (anti-horário) e meia largura.
   */
  private geometriaRasgoArco(p: P2[]): { c: P2; r: number; a0: number; a1: number; w: number | null } | null {
    let c: P2 | null, a0: number, a1: number;
    if (this.tipoRasgo === "arco3") {
      if (p.length < 3) return null;
      c = centroTresPontos(p[0], p[2], p[1]);
      if (!c) return null;
      a0 = angulo(c, p[0]);
      a1 = angulo(c, p[1]);
      const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      // o arco anti-horário de a0 a a1 tem de passar pelo 3º ponto; senão, inverte
      if (norm(angulo(c, p[2]) - a0) > norm(a1 - a0)) [a0, a1] = [a1, a0];
    } else {
      if (p.length < 3) return null;
      c = p[0];
      a0 = angulo(c, p[1]);
      a1 = angulo(c, p[2]);
      const cr = (p[1].x - c.x) * (p[2].y - c.y) - (p[1].y - c.y) * (p[2].x - c.x);
      if (cr < 0) [a0, a1] = [a1, a0];
    }
    while (a1 <= a0) a1 += 2 * Math.PI;
    const r = dist(c, this.tipoRasgo === "arco3" ? p[0] : p[1]);
    const w = p[3] ? Math.abs(dist(c, p[3]) - r) : null;
    return { c, r, a0, a1, w };
  }

  private lembrarPoligono(gs: GeoEsboco[], centro: string) {
    const l0 = gs[1];
    this.ultimoPoligono = l0?.tipo === "linha" ? { geos: gs.map((g) => g.id), circ: gs[0].id, centro, vertice: l0.p1 } : null;
  }

  /** Parâmetros do último polígono (null se ele não existe mais). */
  parametrosPoligono(): { x: number; y: number; diametro: number; angulo: number } | null {
    const u = this.ultimoPoligono;
    if (!u || !u.geos.every((id) => this.esb.geos.some((g) => g.id === id))) return null;
    const pts = mapaPontos(this.esb);
    const c = pts.get(u.centro), v = pts.get(u.vertice);
    const circ = this.esb.geos.find((g) => g.id === u.circ);
    if (!c || !v || circ?.tipo !== "circulo") return null;
    return { x: c.x, y: c.y, diametro: 2 * circ.r, angulo: (angulo(c, v) * 180) / Math.PI };
  }

  /** Painel do polígono: muda centro, diâmetro e ângulo do último polígono (o solver segue). */
  editarPoligono(v: Partial<{ x: number; y: number; diametro: number; angulo: number }>) {
    const atual = this.parametrosPoligono();
    const u = this.ultimoPoligono;
    if (!atual || !u) return;
    const n = { ...atual, ...v };
    if (!(n.diametro > 0)) return;
    const circunscrito = this.esb.restricoes.some((r) => r.tipo === "tangente" && r.b === u.circ);
    const lados = u.geos.length - 1;
    const rv = (n.diametro / 2) / (circunscrito ? Math.cos(Math.PI / lados) : 1);
    const c = { x: n.x, y: n.y };
    this.h.solver.resolver(this.esb, {
      pontos: [{ id: u.centro, ...c }, { id: u.vertice, ...polar(c, rv, (n.angulo * Math.PI) / 180) }],
      raios: [{ id: u.circ, r: n.diametro / 2 }],
    });
    this.resolver(true);
  }

  /** Lados ou tipo mudaram no painel: refaz o último polígono no mesmo lugar. */
  refazerPoligono() {
    const atual = this.parametrosPoligono();
    const u = this.ultimoPoligono;
    if (!atual || !u) return;
    op.excluir(this.esb, u.geos);
    const centro = op.ponto(this.esb, { x: atual.x, y: atual.y });
    const a = (atual.angulo * Math.PI) / 180;
    const r = atual.diametro / 2;
    const ref = this.poligonoCircunscrito ? polar({ x: atual.x, y: atual.y }, r, a - Math.PI / this.lados) : polar({ x: atual.x, y: atual.y }, r, a);
    const gs = this.poligonoCircunscrito
      ? op.poligonoCircunscrito(this.esb, centro, ref, this.lados, this.construcao)
      : op.poligono(this.esb, centro, ref, this.lados, this.construcao);
    this.lembrarPoligono(gs, centro);
    this.resolver(true);
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

  /** Campo ativo do espelhar (como os campos rosa dos comandos), eixo escolhido e Copiar. */
  espelho: { campo: "entidades" | "eixo"; eixo: string | null; copiar: boolean } = { campo: "entidades", eixo: null, copiar: true };

  definirCampoEspelho(c: "entidades" | "eixo") {
    this.espelho.campo = c;
    this.h.atualizarInterface();
  }

  /** Nome curto do eixo do espelho para o painel. */
  get nomeEixoEspelho(): string | null {
    const e = this.espelho.eixo;
    if (!e) return null;
    if (e === EIXO_H) return "Eixo horizontal";
    if (e === EIXO_V) return "Eixo vertical";
    return this.esb.geos.find((g) => g.id === e)?.externa ? "Aresta da peça" : "Linha do esboço";
  }

  aplicarEspelho() {
    const geos = this.geosSelecionadas();
    const eixo = this.espelho.eixo;
    if (!geos.length || !eixo) return;
    const novas = op.espelhar(this.esb, geos, eixo);
    if (!this.espelho.copiar) op.excluir(this.esb, geos);
    this.espelho = { campo: "entidades", eixo: null, copiar: this.espelho.copiar };
    this.selecao = new Set(novas.filter((id) => this.esb.geos.some((g) => g.id === id)));
    this.ferramenta = "selecionar";
    this.resolver(true);
  }

  private previaEspelho(): { segmentos: P2[]; pontos: P2[] } | undefined {
    const geos = this.geosSelecionadas();
    if (!geos.length || !this.espelho.eixo) return undefined;
    const copia: FeatureEsboco = structuredClone(this.esb);
    return this.contornoDasNovas(copia, op.espelhar(copia, geos, this.espelho.eixo));
  }

  /** Segmentos (para a pré-visualização tracejada) das geometrias novas de uma cópia do esboço. */
  private contornoDasNovas(copia: FeatureEsboco, novas: string[]): { segmentos: P2[]; pontos: P2[] } {
    const pts = mapaPontos(copia);
    const segs: P2[] = [];
    for (const g of copia.geos) {
      if (!novas.includes(g.id)) continue;
      for (const am of tracosDaGeo(g, pts)) for (let i = 0; i + 1 < am.length; i++) segs.push(am[i], am[i + 1]);
    }
    return { segmentos: segs, pontos: [] };
  }

  // ---------- texto de esboço ----------

  /** Opções do painel de texto (valem para o próximo texto e editam o texto atual). */
  textoOpc: OpcoesTexto = { ...OPCOES_TEXTO_PADRAO };
  /** Texto sendo editado pelo painel (o último criado ou o escolhido em "Editar texto"). */
  ultimoTexto: string | null = null;
  /** Campo ativo: tocar no desenho posiciona o texto, ou escolhe a curva que ele segue. */
  campoTexto: "posicao" | "curva" = "posicao";
  private editandoTexto = false;

  private geoTexto(): Extract<GeoEsboco, { tipo: "texto" }> | null {
    const g = this.esb.geos.find((x) => x.id === this.ultimoTexto);
    return g?.tipo === "texto" ? g : null;
  }

  /** Curva do texto atual (para o campo do painel). */
  get curvaTexto(): string | null {
    const g = this.geoTexto();
    if (!g?.curva) return null;
    const c = this.esb.geos.find((x) => x.id === g.curva);
    return c ? ({ linha: "Linha", arco: "Arco", circulo: "Círculo" } as Record<string, string>)[c.tipo] ?? "Curva" : null;
  }

  /** Abre o painel do texto com um texto existente. */
  editarTexto(id: string) {
    const g = this.esb.geos.find((x) => x.id === id);
    if (g?.tipo !== "texto") return;
    this.textoOpc = { ...g.opc };
    this.editandoTexto = true;
    this.definirFerramenta("texto");
    this.ultimoTexto = id;
    this.campoTexto = "posicao";
    this.h.atualizarInterface();
  }

  definirCampoTexto(c: "posicao" | "curva") {
    this.campoTexto = c;
    this.h.atualizarInterface();
  }

  /** Ponto de ancoragem e guia (em coordenadas locais) de um texto que segue uma curva. */
  private guiaDaCurva(curvaId: string): { p: string; guia: GuiaTexto } | null {
    const c = this.esb.geos.find((x) => x.id === curvaId);
    const pts = mapaPontos(this.esb);
    if (c?.tipo === "linha") {
      const a = pts.get(c.p1)!, b = pts.get(c.p2)!;
      return { p: c.p1, guia: { tipo: "reta", a: { x: 0, y: 0 }, b: sub(b, a) } };
    }
    if (c?.tipo === "arco") {
      const ctr = pts.get(c.c)!;
      const [a0, a1] = angulosArco(ctr, pts.get(c.ini)!, pts.get(c.fim)!);
      return { p: c.c, guia: { tipo: "arco", c: { x: 0, y: 0 }, r: dist(ctr, pts.get(c.ini)!), a0, a1 } };
    }
    if (c?.tipo === "circulo") {
      // começa embaixo e corre no sentido horário: centralizado, fica no topo
      return { p: c.c, guia: { tipo: "arco", c: { x: 0, y: 0 }, r: c.r, a0: -Math.PI / 2, a1: (3 * Math.PI) / 2 } };
    }
    return null;
  }

  /** Recalcula os contornos das letras (a fonte precisa estar lida). */
  private regenerarTexto(g: Extract<GeoEsboco, { tipo: "texto" }>, fonte: Font) {
    const gc = g.curva ? this.guiaDaCurva(g.curva) : null;
    if (g.curva && !gc) delete g.curva; // a curva foi apagada: o texto fica onde está
    if (gc) g.p = gc.p;
    g.contornos = gerarContornos(fonte, g.opc, gc?.guia);
    delete g.transf;
  }

  /** Textos que seguem curvas acompanham a curva depois de resolver o esboço. */
  private atualizarTextosNaCurva() {
    for (const g of this.esb.geos) {
      if (g.tipo !== "texto" || !g.curva) continue;
      const f = fonteLida(g.opc.negrito, g.opc.italico);
      if (f) this.regenerarTexto(g, f);
    }
  }

  /** Mudou uma opção do painel: vale para o próximo texto e refaz o texto atual. */
  async mudarTexto(m: Partial<OpcoesTexto>, digitando = false) {
    Object.assign(this.textoOpc, m);
    const g = this.geoTexto();
    if (!g) return;
    g.opc = { ...this.textoOpc };
    try {
      this.regenerarTexto(g, await carregarFonte(g.opc.negrito, g.opc.italico));
    } catch {
      return this.h.avisar("Não foi possível ler a fonte do texto.");
    }
    if (digitando) {
      // enquanto digita: só redesenha (refazer o painel tiraria o foco da caixa de texto)
      this.redesenhar();
      this.h.alterou(false);
    } else this.resolver(true);
  }

  /** Fim da digitação: grava o passo de desfazer sem refazer o painel. */
  confirmarTexto() {
    if (this.geoTexto()) this.h.alterou(true);
  }

  /** Tira o texto atual da curva: ele fica parado onde está. */
  soltarTextoDaCurva() {
    const g = this.geoTexto();
    if (!g?.curva) return;
    const p = mapaPontos(this.esb).get(g.p)!;
    delete g.curva;
    g.p = op.ponto(this.esb, p);
    op.pontoSolto(this.esb, g.p, true);
    void this.mudarTexto({});
  }

  private async toqueTexto(enc: Encaixe, tol: number) {
    let fonte: Font;
    try {
      fonte = await carregarFonte(this.textoOpc.negrito, this.textoOpc.italico);
    } catch {
      return this.h.avisar("Não foi possível ler a fonte do texto.");
    }
    if (this.campoTexto === "curva") {
      const alvo = this.achar(enc.p, tol);
      const c = alvo?.tipo === "geo" ? this.esb.geos.find((x) => x.id === alvo.id) : null;
      if (!c || !["linha", "arco", "circulo"].includes(c.tipo)) return this.h.avisar("O texto segue uma linha, um arco ou um círculo do esboço.");
      let g = this.geoTexto();
      if (!g) {
        g = op.texto(this.esb, op.ponto(this.esb, enc.p), this.textoOpc, [], c.id, this.construcao);
        this.ultimoTexto = g.id;
      }
      g.curva = c.id;
      this.regenerarTexto(g, fonte);
      this.campoTexto = "posicao";
      this.resolver(true);
      return;
    }
    // ponto de partida do texto: um ponto solto de construção (para cotar a posição)
    const p = this.pontoDo(enc);
    if (!this.esb.geos.some((g) => g.tipo === "ponto" && g.p === p) && p !== ORIGEM) op.pontoSolto(this.esb, p, true);
    const g = op.texto(this.esb, p, this.textoOpc, [], undefined, this.construcao);
    this.regenerarTexto(g, fonte);
    this.ultimoTexto = g.id;
    this.resolver(true);
  }

  // ---------- padrões de esboço ----------

  definirCampoPadrao(c: EditorEsboco["campoPadrao"]) {
    this.campoPadrao = c;
    this.h.atualizarInterface();
  }

  private toquePadrao(alvo: Alvo | null) {
    const c = this.campoPadrao;
    if (c === "entidades") {
      if (alvo?.tipo !== "geo" || alvo.id === EIXO_H || alvo.id === EIXO_V) return;
      if (this.selecao.has(alvo.id)) this.selecao.delete(alvo.id);
      else this.selecao.add(alvo.id);
    } else if (c === "centro") {
      const pts = mapaPontos(this.esb);
      const g = alvo?.tipo === "geo" ? this.esb.geos.find((x) => x.id === alvo.id) : null;
      const id = alvo?.tipo === "ponto" ? alvo.id : g && (g.tipo === "circulo" || g.tipo === "arco") ? g.c : null;
      if (!id || !pts.has(id)) return this.h.avisar("Toque um ponto (ou um círculo/arco) para o centro.");
      const p = pts.get(id)!;
      Object.assign(this.padraoCirc, { centro: id, cx: p.x, cy: p.y });
      this.campoPadrao = "entidades";
    } else {
      // direção: linha do esboço, eixo ou aresta reta da peça
      let id = alvo?.tipo === "geo" ? alvo.id : null;
      let g = id ? this.esb.geos.find((x) => x.id === id) : undefined;
      if (!id || (g && g.tipo !== "linha")) {
        const m = this.tela && this.acharModelo(this.tela.x, this.tela.y, this.tela.tipo, ["aresta"]);
        const ge = m && criarExterna(this.esb, m.proj, m.ref);
        id = ge?.tipo === "linha" ? ge.id : null;
        g = ge ?? undefined;
      }
      if (!id) return this.h.avisar("Toque uma linha, um eixo ou uma aresta reta da peça para a direção.");
      let ang = id === EIXO_V ? 90 : 0;
      if (g?.tipo === "linha") {
        const pts = mapaPontos(this.esb);
        const a = pts.get(g.p1)!, b = pts.get(g.p2)!;
        ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      }
      const d = this.padraoLin[c];
      d.ref = id;
      d.ang = Number(ang.toFixed(6));
      this.campoPadrao = "entidades";
    }
    this.redesenhar();
    this.h.atualizarInterface();
  }

  /** Nome curto da referência de direção/centro para o painel. */
  nomeRefPadrao(id: string | null): string | null {
    if (!id) return null;
    if (id === EIXO_H) return "Eixo horizontal";
    if (id === EIXO_V) return "Eixo vertical";
    if (id === ORIGEM) return "Origem";
    const g = this.esb.geos.find((x) => x.id === id);
    return g?.externa ? "Aresta da peça" : g ? "Linha do esboço" : "Ponto do esboço";
  }

  /** "2, 4" → [2, 4]; "2-3" → par (2, 3). Valores inválidos são ignorados. */
  private static lerPular(t: string): [number, number][] {
    return t.split(/[,;\s]+/).filter(Boolean).flatMap((x) => {
      const [i, j] = x.split("-").map(Number);
      return Number.isInteger(i) && i > 0 ? [[i, Number.isInteger(j) && j > 0 ? j : 1] as [number, number]] : [];
    });
  }

  /** Raio e ângulo da semente em relação ao centro (só leitura no painel circular). */
  get posicaoSementeCircular(): { raio: number; angulo: number } | null {
    const geos = this.geosSelecionadas();
    const g = this.esb.geos.find((x) => geos.includes(x.id));
    const pid = g && pontosDaGeo(g)[0];
    const p = pid && mapaPontos(this.esb).get(pid);
    if (!p) return null;
    const c = { x: this.padraoCirc.cx, y: this.padraoCirc.cy };
    return { raio: dist(c, p), angulo: (angulo(c, p) * 180) / Math.PI };
  }

  private executarPadrao(esb: FeatureEsboco): string[] {
    const geos = this.geosSelecionadas();
    if (!geos.length) return [];
    if (this.ferramenta === "padraoLinearEsboco") {
      const { dir1: a, dir2: b, pular } = this.padraoLin;
      return op.padraoLinearEsboco(esb, geos, {
        n1: a.n, esp1: a.esp, ang1: a.ang + (a.inverter ? 180 : 0), cotar1: a.cotar,
        n2: b.n, esp2: b.esp, ang2: b.ang + (b.inverter ? 180 : 0), cotar2: b.cotar,
        pular: EditorEsboco.lerPular(pular),
      });
    }
    const c = this.padraoCirc;
    return op.padraoCircularEsboco(esb, geos, {
      centro: { x: c.cx, y: c.cy }, n: c.n, angulo: c.inverter ? -c.angulo : c.angulo, igual: c.igual,
      pular: EditorEsboco.lerPular(c.pular).map(([i]) => i), centroId: c.centro, cotarRaio: c.cotarRaio,
    });
  }

  private previaPadrao(): { segmentos: P2[]; pontos: P2[] } | undefined {
    if (!this.geosSelecionadas().length) return undefined;
    const copia: FeatureEsboco = structuredClone(this.esb);
    try {
      return this.contornoDasNovas(copia, this.executarPadrao(copia));
    } catch {
      return undefined;
    }
  }

  /** Mudou um campo do painel de padrão: redesenha a pré-visualização. */
  mudouPadrao() {
    this.redesenhar();
  }

  aplicarPadrao() {
    const novas = this.executarPadrao(this.esb);
    if (!novas.length) return this.h.avisar("Nada a repetir: selecione as entidades e confira o nº de instâncias.");
    this.selecao.clear();
    this.ferramenta = "selecionar";
    this.resolver(true);
  }

  /** Apara (o mais próximo) a geometria no ponto, respeitando as opções do painel. */
  private aparoNoPonto(id: string, p: P2): boolean {
    const g = this.esb.geos.find((x) => x.id === id);
    if (!g || g.externa || (g.construcao && this.aparo.ignorarConstrucao)) return false;
    return op.aparar(this.esb, id, p, { construcao: this.aparo.construcao });
  }

  /** Mudou o modo do aparar: recomeça a escolha de limites. */
  definirModoAparar(m: ModoAparar) {
    this.aparo.modo = m;
    this.aparoRefs = [];
    this.selecao.clear();
    this.redesenhar();
    this.h.atualizarInterface();
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

  private opcoesOffset(): [number, op.OpcoesOffset] {
    const o = this.offset;
    return [o.inverter ? -this.distOffset : this.distOffset, { ...o, construcao: o.construcao || undefined }];
  }

  aplicarOffset() {
    const geos = this.geosSelecionadas();
    if (!geos.length || !this.distOffset) return;
    const [d, opc] = this.opcoesOffset();
    const novas = op.deslocar(this.esb, geos, d, opc);
    this.selecao = new Set(novas);
    this.resolver(true);
  }

  /** Mudou uma opção do offset: redesenha a pré-visualização. */
  mudouOffset() {
    this.redesenhar();
  }

  /** Contorno tracejado das cópias que o offset criaria com as opções atuais. */
  private previaOffset(): { segmentos: P2[]; pontos: P2[] } | undefined {
    const geos = this.geosSelecionadas();
    if (!geos.length || !this.distOffset) return undefined;
    const copia: FeatureEsboco = structuredClone(this.esb);
    const [d, opc] = this.opcoesOffset();
    try {
      return this.contornoDasNovas(copia, op.deslocar(copia, geos, d, opc));
    } catch {
      return undefined;
    }
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

  transformarSelecao(oque: "mover" | "copiar" | "girar" | "girarCopia", v: { dx?: number; dy?: number; angulo?: number }) {
    const geos = this.geosSelecionadas();
    if (!geos.length) return this.h.avisar("Selecione as entidades primeiro.");
    let novas: string[] = [];
    if (oque === "mover" || oque === "copiar") novas = op.transformar(this.esb, geos, op.transladar({ x: v.dx ?? 0, y: v.dy ?? 0 }), oque === "copiar");
    else novas = op.transformar(this.esb, geos, op.girar(this.centroSelecao(), v.angulo ?? 0), oque === "girarCopia");
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
  /** Filtro do painel Exibir/Excluir relações. */
  filtroRelacoes: "todas" | "problemas" | "externas" | "fixas" | "selecionadas" = "todas";

  /** Relações (não cotas) do esboço que passam no filtro do painel. */
  relacoesFiltradas(): RestricaoEsboco[] {
    const rels = this.esb.restricoes.filter((r) => !ehCota(r));
    const externas = new Set(this.esb.geos.filter((g) => g.externa).flatMap((g) => [g.id, ...pontosDaGeo(g)]));
    switch (this.filtroRelacoes) {
      case "problemas": return rels.filter((r) => this.estadoRelacao(r) !== "Satisfeita");
      case "externas": return rels.filter((r) => op.referencias(r).some((x) => externas.has(x)));
      case "fixas": return rels.filter((r) => r.tipo === "fixo");
      case "selecionadas": return this.relacoesDaSelecao();
      default: return rels;
    }
  }

  estadoRelacao(r: RestricaoEsboco): "Satisfeita" | "Superdefinindo" | "Redundante" {
    return this.estado.conflitantes.includes(r.id) ? "Superdefinindo" : this.estado.redundantes.includes(r.id) ? "Redundante" : "Satisfeita";
  }

  /** Destaca as entidades de uma relação (a relação fica marcada na lista). */
  mostrarRelacao(id: string) {
    const r = this.esb.restricoes.find((x) => x.id === id);
    if (!r) return;
    this.relacaoAtiva = id;
    this.selecao = new Set(op.referencias(r).filter((x) => x !== ORIGEM));
    this.redesenhar();
    this.h.atualizarInterface();
  }
  relacaoAtiva: string | null = null;

  excluirRelacoes(ids: string[]) {
    if (!ids.length) return;
    const fora = new Set(ids);
    this.esb.restricoes = this.esb.restricoes.filter((r) => !fora.has(r.id));
    this.relacaoAtiva = null;
    this.resolver(true);
  }

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
        if (c.length && this.tipoLinha === "pontoMedio") segs.push({ x: 2 * c[0].x - cur.x, y: 2 * c[0].y - cur.y }, cur);
        else if (c.length) segs.push(c[0], cur);
        break;
      case "retangulo":
        if (this.tipoRetangulo === "centro3") {
          if (c.length === 1) segs.push(c[0], cur);
          if (c.length === 2) {
            const d1 = sub(c[1], c[0]);
            const l = Math.hypot(d1.x, d1.y) || 1;
            const n = { x: -d1.y / l, y: d1.x / l };
            const h = Math.abs((cur.x - c[0].x) * n.x + (cur.y - c[0].y) * n.y);
            const q = (s: number, t2: number) => soma(soma(c[0], mult(d1, s)), mult(n, t2 * h));
            poli([q(1, -1), q(1, 1), q(-1, 1), q(-1, -1)], true);
          }
        } else if (this.tipoRetangulo === "paralelogramo") {
          if (c.length === 1) segs.push(c[0], cur);
          if (c.length === 2) poli([c[0], c[1], cur, { x: c[0].x + cur.x - c[1].x, y: c[0].y + cur.y - c[1].y }], true);
        } else if (this.tipoRetangulo === "centro" && c.length) {
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
        if (this.tipoRasgo === "arco3" || this.tipoRasgo === "arcoCentro") {
          if (c.length === 1) segs.push(c[0], cur);
          const g = c.length >= 2 ? this.geometriaRasgoArco([...c, cur]) : null;
          if (g) {
            circ(g.c, g.r, g.a0, g.a1);
            if (g.w !== null && g.w < g.r) {
              circ(g.c, g.r + g.w, g.a0, g.a1);
              circ(g.c, g.r - g.w, g.a0, g.a1);
              circ(polar(g.c, g.r, g.a0), g.w, g.a0 + Math.PI, g.a0 + 2 * Math.PI);
              circ(polar(g.c, g.r, g.a1), g.w, g.a1, g.a1 + Math.PI);
            }
          }
          break;
        }
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
      case "elipse":
      case "elipseParcial":
        if (c.length === 1) segs.push(c[0], cur);
        if (c.length >= 2) {
          const a = dist(c[0], c[1]);
          const u = a > 1e-9 ? mult(sub(c[1], c[0]), 1 / a) : { x: 1, y: 0 };
          const b = op.semieixoMenor(c[0], c[1], c.length === 2 ? cur : c[2]);
          const e = { c: c[0], u, a, b };
          segs.push(c[0], c[1]);
          let t0 = 0, t1 = 2 * Math.PI;
          if (c.length === 3) {
            t0 = paramElipse(e, c[2]);
            t1 = paramElipse(e, cur);
            while (t1 <= t0) t1 += 2 * Math.PI;
          }
          const n = 72;
          poli(Array.from({ length: n + 1 }, (_, i) => pontoElipse(e, t0 + ((t1 - t0) * i) / n)));
          if (c.length === 3) pontos.push(pontoElipse(e, t0));
        }
        break;
      case "parabola":
        if (c.length === 1) segs.push(c[0], cur);
        if (c.length >= 2) {
          const pb = parabolaDe({ v: "v", f: "f" }, new Map([["v", c[1]], ["f", c[0]]]));
          const sc = paramParabola(pb, cur);
          const [s0, s1] = c.length === 2 ? [-Math.abs(sc), Math.abs(sc)] : [paramParabola(pb, c[2]), sc];
          const n = 48;
          poli(Array.from({ length: n + 1 }, (_, i) => pontoParabola(pb, s0 + ((s1 - s0) * i) / n)));
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
      previa: this.ferramentaUsaEncaixe() ? this.previa()
        : this.ferramenta === "offset" ? this.previaOffset()
        : this.ferramenta === "espelhar" ? this.previaEspelho()
        : this.ferramenta === "padraoLinearEsboco" || this.ferramenta === "padraoCircularEsboco" ? this.previaPadrao()
        : this.rastro ? { segmentos: this.rastro.flatMap((q, i) => (i ? [this.rastro![i - 1], q] : [])), pontos: [] } : undefined,
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
        if (g.tipo === "spline") return pts.get(g.pontos[Math.floor(g.pontos.length / 2)]) ?? null;
        const am = amostrar(g, pts);
        return am[Math.floor(am.length / 4)];
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
