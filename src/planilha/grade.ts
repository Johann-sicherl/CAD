// Grade do WJPlan: desenho em Canvas só da parte visível (milhões de linhas sem pesar),
// seleção, edição na célula com autocompletar de funções e "modo apontar" (clicar numa célula
// durante uma fórmula insere a referência), alça de preenchimento, largura de coluna, painéis
// congelados, teclado do computador e toque do tablet/celular.

import { listaDeFuncoes, normalizarNome, FUNCOES } from "../formulas/funcoes";
import { chave, interpretarEntrada, type Calculadora, type Celula, type Folha, type Formato, type Pasta } from "../formulas/pasta";
import { deslocarReferencias, referenciasDaFormula } from "../formulas/sintaxe";
import { enderecoA1, indiceParaColuna, LIMITE_COLUNAS, LIMITE_LINHAS } from "../formulas/tipos";
import { exibir } from "./formatar";

export interface Pos {
  l: number;
  c: number;
}
export interface Faixa {
  l0: number;
  c0: number;
  l1: number;
  c1: number;
}

export interface HostGrade {
  pasta: Pasta;
  calc: Calculadora;
  folha(): Folha;
  /** Altera o documento (histórico, recálculo, salvamento automático, redesenho). */
  alterar(descricao: string, muda: () => void): void;
  aoMudarSelecao(): void;
  aoEditar(texto: string | null): void;
  menuContexto(x: number, y: number): void;
}

const LARG = 86, ALT = 22, CAB_A = 24, CAB_L = 46;
const CORES_REF = ["#2f7fd0", "#c9372c", "#2e8b57", "#8a4fbf", "#d07a00", "#0f8b8d"];
const FONTE = `"Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

export const normalizarFaixa = (a: Pos, b: Pos): Faixa => ({ l0: Math.min(a.l, b.l), c0: Math.min(a.c, b.c), l1: Math.max(a.l, b.l), c1: Math.max(a.c, b.c) });

export class Grade {
  ativa: Pos = { l: 0, c: 0 };
  ancora: Pos = { l: 0, c: 0 };
  foco: Pos = { l: 0, c: 0 };
  zoom = 1;
  mostrarGrade = true;
  mostrarFormulas = false;
  editando: { pos: Pos; original: string; modo: "entrar" | "editar" } | null = null;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rolagem: HTMLElement;
  private espaco: HTMLElement;
  editor: HTMLTextAreaElement;
  private teclado: HTMLTextAreaElement;
  private sugestoes: HTMLElement;
  private dica: HTMLElement;
  private pedido = 0;
  private arrasto: { tipo: "sel" | "preencher" | "coluna" | "linha" | "apontar" | "larg" | "alt"; ini: Pos; idx?: number; x0?: number; tam0?: number; alvo?: Pos } | null = null;
  /** Referência inserida pelo modo apontar (para trocar enquanto se arrasta/clica de novo). */
  private apontado: { i: number; f: number } | null = null;
  private interno: { texto: string; origem: Faixa; celulas: (Celula | undefined)[][]; recorte: boolean } | null = null;
  private toqueLongo?: number;

  constructor(public area: HTMLElement, public host: HostGrade) {
    area.classList.add("pl-area");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pl-canvas";
    this.rolagem = document.createElement("div");
    this.rolagem.className = "pl-rolagem";
    this.espaco = document.createElement("div");
    this.espaco.className = "pl-espaco";
    this.rolagem.append(this.espaco);
    // dois campos que trocam de papel: o "teclado" (escondido, recebe as teclas com a célula
    // selecionada) e o "editor" (visível sobre a célula). Quando o navegador não diz a tecla
    // (teclado virtual do celular/tablet, acentos ´ ~ ^, sugestões do teclado), o próprio teclado
    // vira o editor no lugar, para o texto aparecer enquanto é digitado.
    const campo = () => {
      const x = document.createElement("textarea");
      x.spellcheck = false;
      x.setAttribute("autocapitalize", "off");
      x.setAttribute("autocomplete", "off");
      x.setAttribute("aria-label", "Célula da planilha");
      return x;
    };
    this.editor = campo();
    this.editor.className = "pl-editor";
    this.editor.hidden = true;
    this.teclado = campo();
    this.teclado.className = "pl-teclado";
    this.sugestoes = document.createElement("div");
    this.sugestoes.className = "pl-sugestoes";
    this.sugestoes.hidden = true;
    this.dica = document.createElement("div");
    this.dica.className = "pl-dica";
    this.dica.hidden = true;
    area.append(this.canvas, this.rolagem, this.editor, this.teclado, this.sugestoes, this.dica);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.redesenhar()).observe(area);
    this.rolagem.addEventListener("scroll", () => {
      this.crescerSeNecessario();
      this.redesenhar();
      this.posicionarEditor();
    });
    this.instalarPonteiro();
    for (const x of [this.editor, this.teclado]) {
      this.instalarTeclado(x);
      this.instalarEditor(x);
    }
  }

  /** O campo escondido vira o editor (com o foco e o texto que já está nele) e vice-versa. */
  private trocarPapeis() {
    const novoEditor = this.teclado, novoTeclado = this.editor;
    this.editor = novoEditor;
    this.teclado = novoTeclado;
    novoEditor.className = "pl-editor";
    novoEditor.hidden = false;
    novoTeclado.className = "pl-teclado";
    novoTeclado.removeAttribute("style");
    novoTeclado.hidden = false;
    novoTeclado.value = "";
  }

  // ---------- geometria ----------

  private larguras(): Record<number, number> {
    return this.host.folha().larguras ?? {};
  }
  private alturas(): Record<number, number> {
    return this.host.folha().alturas ?? {};
  }
  largura(c: number) {
    return this.larguras()[c] ?? LARG;
  }
  altura(l: number) {
    return this.alturas()[l] ?? ALT;
  }
  /** Esquerda da coluna (em px sem zoom, sem o cabeçalho). */
  colX(c: number) {
    let x = c * LARG;
    for (const [k, w] of Object.entries(this.larguras())) if (Number(k) < c) x += w - LARG;
    return x;
  }
  linY(l: number) {
    let y = l * ALT;
    for (const [k, h] of Object.entries(this.alturas())) if (Number(k) < l) y += h - ALT;
    return y;
  }
  private colEm(px: number) {
    let a = 0, b = LIMITE_COLUNAS - 1;
    while (a < b) {
      const m = (a + b + 1) >> 1;
      if (this.colX(m) <= px) a = m;
      else b = m - 1;
    }
    return a;
  }
  private linEm(px: number) {
    let a = 0, b = LIMITE_LINHAS - 1;
    while (a < b) {
      const m = (a + b + 1) >> 1;
      if (this.linY(m) <= px) a = m;
      else b = m - 1;
    }
    return a;
  }
  private get congelar() {
    return this.host.folha().congelar ?? { lin: 0, col: 0 };
  }
  private cabL() {
    return CAB_L * this.zoom;
  }
  private cabA() {
    return CAB_A * this.zoom;
  }

  /** Extensão rolável: o usado + folga (cresce ao chegar perto do fim). */
  private extensao = { lins: 200, cols: 40 };
  private crescerSeNecessario() {
    const z = this.zoom;
    const r = this.rolagem;
    if (r.scrollTop + r.clientHeight > this.linY(this.extensao.lins) * z - 400) this.extensao.lins = Math.min(LIMITE_LINHAS, this.extensao.lins + 500);
    if (r.scrollLeft + r.clientWidth > this.colX(this.extensao.cols) * z - 300) this.extensao.cols = Math.min(LIMITE_COLUNAS, this.extensao.cols + 20);
    this.atualizarEspaco();
  }
  atualizarEspaco() {
    const d = this.host.calc.dimensao(this.host.folha().nome);
    this.extensao.lins = Math.max(this.extensao.lins, d.lins + 100, this.ativa.l + 50);
    this.extensao.cols = Math.max(this.extensao.cols, d.cols + 10, this.ativa.c + 10);
    this.espaco.style.width = `${this.cabL() + this.colX(this.extensao.cols) * this.zoom}px`;
    this.espaco.style.height = `${this.cabA() + this.linY(this.extensao.lins) * this.zoom}px`;
  }

  /** Retângulo da célula na tela (px CSS dentro da área), considerando painéis congelados. */
  retangulo(p: Pos) {
    const z = this.zoom, cg = this.congelar;
    const sx = p.c < cg.col ? 0 : this.rolagem.scrollLeft;
    const sy = p.l < cg.lin ? 0 : this.rolagem.scrollTop;
    return { x: this.cabL() + this.colX(p.c) * z - sx, y: this.cabA() + this.linY(p.l) * z - sy, w: this.largura(p.c) * z, h: this.altura(p.l) * z };
  }

  /** O que está sob o ponto (px dentro da área). */
  acertar(x: number, y: number): { tipo: "canto" | "col" | "lin" | "celula"; pos: Pos; borda?: "col" | "lin" } {
    const z = this.zoom, cg = this.congelar;
    const fx = this.cabL() + this.colX(cg.col) * z, fy = this.cabA() + this.linY(cg.lin) * z;
    const px = x < fx ? (x - this.cabL()) / z : (x - this.cabL() + this.rolagem.scrollLeft) / z;
    const py = y < fy ? (y - this.cabA()) / z : (y - this.cabA() + this.rolagem.scrollTop) / z;
    const c = Math.max(0, this.colEm(Math.max(0, px))), l = Math.max(0, this.linEm(Math.max(0, py)));
    if (x < this.cabL() && y < this.cabA()) return { tipo: "canto", pos: { l: 0, c: 0 } };
    if (y < this.cabA()) {
      // borda direita da coluna: redimensionar
      const dir = this.colX(c + 1) * z, esq = this.colX(c) * z;
      const xx = px * z;
      if (Math.abs(xx - dir) < 5) return { tipo: "col", pos: { l: 0, c }, borda: "col" };
      if (c > 0 && Math.abs(xx - esq) < 5) return { tipo: "col", pos: { l: 0, c: c - 1 }, borda: "col" };
      return { tipo: "col", pos: { l: 0, c } };
    }
    if (x < this.cabL()) {
      const baixo = this.linY(l + 1) * z, cima = this.linY(l) * z, yy = py * z;
      if (Math.abs(yy - baixo) < 4) return { tipo: "lin", pos: { l, c: 0 }, borda: "lin" };
      if (l > 0 && Math.abs(yy - cima) < 4) return { tipo: "lin", pos: { l: l - 1, c: 0 }, borda: "lin" };
      return { tipo: "lin", pos: { l, c: 0 } };
    }
    return { tipo: "celula", pos: { l, c } };
  }

  faixa(): Faixa {
    return normalizarFaixa(this.ancora, this.foco);
  }

  // ---------- desenho ----------

  redesenhar() {
    if (this.pedido) return;
    this.pedido = requestAnimationFrame(() => {
      this.pedido = 0;
      this.desenhar();
    });
  }

  private desenhar() {
    const dpr = devicePixelRatio || 1;
    const W = this.area.clientWidth, H = this.area.clientHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = `${W}px`;
      this.canvas.style.height = `${H}px`;
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W, H);
    const z = this.zoom, cg = this.congelar;
    const sx = this.rolagem.scrollLeft, sy = this.rolagem.scrollTop;
    const fx = this.cabL() + this.colX(cg.col) * z, fy = this.cabA() + this.linY(cg.lin) * z;
    // faixas visíveis de colunas/linhas roladas
    const c0 = Math.max(cg.col, this.colEm((fx - this.cabL() + sx) / z)), c1 = this.colEm((W - this.cabL() + sx) / z);
    const l0 = Math.max(cg.lin, this.linEm((fy - this.cabA() + sy) / z)), l1 = this.linEm((H - this.cabA() + sy) / z);
    const regioes: [number, number, number, number, number, number, number, number][] = [
      // c0, c1, l0, l1, clip x, clip y, clip w, clip h
      [c0, c1, l0, l1, fx, fy, W - fx, H - fy],
      [c0, c1, 0, cg.lin - 1, fx, this.cabA(), W - fx, fy - this.cabA()],
      [0, cg.col - 1, l0, l1, this.cabL(), fy, fx - this.cabL(), H - fy],
      [0, cg.col - 1, 0, cg.lin - 1, this.cabL(), this.cabA(), fx - this.cabL(), fy - this.cabA()],
    ];
    for (const [a0, a1, b0, b1, x, y, w, h] of regioes) {
      if (a1 < a0 || b1 < b0 || w <= 0 || h <= 0) continue;
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      this.desenharCelulas(a0, a1, b0, b1);
      this.desenharSelecao();
      g.restore();
    }
    this.desenharCabecalhos(c0, c1, l0, l1, fx, fy);
    // linhas de congelamento
    g.strokeStyle = "#9aa6b2";
    g.lineWidth = 1.5;
    if (cg.col > 0) {
      g.beginPath();
      g.moveTo(fx, 0);
      g.lineTo(fx, H);
      g.stroke();
    }
    if (cg.lin > 0) {
      g.beginPath();
      g.moveTo(0, fy);
      g.lineTo(W, fy);
      g.stroke();
    }
  }

  private fonte(f: Formato | undefined) {
    const t = (f?.tamanho ?? 11) * (4 / 3) * this.zoom;
    return `${f?.italico ? "italic " : ""}${f?.negrito ? "bold " : ""}${t.toFixed(1)}px ${FONTE}`;
  }

  private desenharCelulas(c0: number, c1: number, l0: number, l1: number) {
    const g = this.ctx, folha = this.host.folha(), calc = this.host.calc;
    const z = this.zoom;
    const larg = (c: number) => this.largura(c) * z;
    // fundos e linhas de grade
    for (let l = l0; l <= l1; l++) {
      for (let c = c0; c <= c1; c++) {
        const r = this.retangulo({ l, c });
        const cel = folha.celulas[chave(l, c)];
        if (cel?.f?.fundo) {
          g.fillStyle = cel.f.fundo;
          g.fillRect(r.x, r.y, r.w, r.h);
        }
        if (this.mostrarGrade) {
          g.strokeStyle = "#e1e5ea";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(r.x + r.w - 0.5, r.y);
          g.lineTo(r.x + r.w - 0.5, r.y + r.h);
          g.moveTo(r.x, r.y + r.h - 0.5);
          g.lineTo(r.x + r.w, r.y + r.h - 0.5);
          g.stroke();
        }
      }
    }
    // conteúdo (texto pode transbordar para as vizinhas vazias)
    g.textBaseline = "middle";
    for (let l = l0; l <= l1; l++) {
      for (let c = Math.max(0, c0 - 8); c <= c1; c++) {
        const cel = folha.celulas[chave(l, c)];
        if (!cel || cel.e === "") continue;
        const r = this.retangulo({ l, c });
        const v = this.mostrarFormulas && cel.e.startsWith("=") ? cel.e : calc.valor(folha.nome, l, c);
        const { texto, alinhar } = this.mostrarFormulas && cel.e.startsWith("=") ? { texto: cel.e, alinhar: "esquerda" as const } : exibir(v, cel.f);
        if (!texto) continue;
        const al = cel.f?.alinhar ?? alinhar;
        g.font = this.fonte(cel.f);
        g.fillStyle = cel.f?.cor ?? (typeof v === "object" && v !== null ? "#c9372c" : "#1e2730");
        const pad = 4 * z;
        if (cel.f?.quebrar) {
          this.textoQuebrado(texto, r, al, cel.f);
          continue;
        }
        let w = r.w;
        // transborda à direita enquanto as vizinhas estiverem vazias (texto à esquerda)
        const medida = g.measureText(texto).width;
        if (al === "esquerda" && typeof v === "string" && medida > r.w - 2 * pad) {
          for (let k = c + 1; k <= c + 20 && medida > w - 2 * pad; k++) {
            const viz = folha.celulas[chave(l, k)];
            if (viz && viz.e !== "") break;
            w += larg(k);
          }
        }
        let t = texto;
        if (typeof v === "number" && medida > r.w - 2 * pad && !this.mostrarFormulas) t = "#".repeat(Math.max(1, Math.floor((r.w - 2 * pad) / g.measureText("#").width)));
        g.save();
        g.beginPath();
        g.rect(r.x + 1, r.y, w - 2, r.h);
        g.clip();
        const x = al === "direita" ? r.x + r.w - pad : al === "centro" ? r.x + r.w / 2 : r.x + pad;
        g.textAlign = al === "direita" ? "right" : al === "centro" ? "center" : "left";
        const y = r.y + r.h / 2 + 1;
        g.fillText(t, x, y);
        if (cel.f?.sublinhado || cel.f?.riscado) {
          const mw = Math.min(g.measureText(t).width, w);
          const xi = al === "direita" ? x - mw : al === "centro" ? x - mw / 2 : x;
          g.strokeStyle = g.fillStyle as string;
          g.lineWidth = Math.max(1, z);
          g.beginPath();
          const yy = cel.f?.sublinhado ? y + 6 * z : y;
          g.moveTo(xi, yy);
          g.lineTo(xi + mw, yy);
          g.stroke();
        }
        g.restore();
      }
    }
    // bordas
    for (let l = l0; l <= l1; l++) {
      for (let c = c0; c <= c1; c++) {
        const cel = folha.celulas[chave(l, c)];
        if (!cel?.f?.borda) continue;
        const r = this.retangulo({ l, c });
        g.strokeStyle = "#1e2730";
        g.lineWidth = 1;
        g.strokeRect(r.x - 0.5, r.y - 0.5, r.w, r.h);
      }
    }
  }

  private textoQuebrado(texto: string, r: { x: number; y: number; w: number; h: number }, al: string, f: Formato) {
    const g = this.ctx, pad = 4 * this.zoom;
    const palavras = texto.split(/\s+/);
    const linhas: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const t = atual ? `${atual} ${p}` : p;
      if (g.measureText(t).width > r.w - 2 * pad && atual) {
        linhas.push(atual);
        atual = p;
      } else atual = t;
    }
    if (atual) linhas.push(atual);
    const lh = (f.tamanho ?? 11) * 1.6 * this.zoom;
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.textAlign = al === "direita" ? "right" : al === "centro" ? "center" : "left";
    linhas.forEach((t, i) => g.fillText(t, al === "direita" ? r.x + r.w - pad : al === "centro" ? r.x + r.w / 2 : r.x + pad, r.y + lh * (i + 0.6)));
    g.restore();
  }

  private desenharSelecao() {
    const g = this.ctx;
    const f = this.faixa();
    const a = this.retangulo({ l: f.l0, c: f.c0 }), b = this.retangulo({ l: f.l1, c: f.c1 });
    const x = a.x, y = a.y, w = b.x + b.w - a.x, h = b.y + b.h - a.y;
    // referências da fórmula em edição, coloridas
    if (this.editando && this.editor.value.startsWith("=")) {
      referenciasDaFormula(this.editor.value).forEach((ref, i) => {
        if (ref.a.folha && ref.a.folha.toLowerCase() !== this.host.folha().nome.toLowerCase()) return;
        const p = this.retangulo({ l: Math.min(ref.a.lin, ref.b.lin), c: Math.min(ref.a.col, ref.b.col) });
        const q = this.retangulo({ l: Math.min(Math.max(ref.a.lin, ref.b.lin), this.extensao.lins), c: Math.min(Math.max(ref.a.col, ref.b.col), this.extensao.cols) });
        const cor = CORES_REF[i % CORES_REF.length];
        g.fillStyle = cor + "18";
        g.fillRect(p.x, p.y, q.x + q.w - p.x, q.y + q.h - p.y);
        g.strokeStyle = cor;
        g.lineWidth = 1.5;
        g.setLineDash([4, 2]);
        g.strokeRect(p.x + 0.5, p.y + 0.5, q.x + q.w - p.x - 1, q.y + q.h - p.y - 1);
        g.setLineDash([]);
      });
    }
    if (f.l0 !== f.l1 || f.c0 !== f.c1) {
      g.fillStyle = "rgba(47,127,208,0.10)";
      g.fillRect(x, y, w, h);
      const at = this.retangulo(this.ativa);
      g.fillStyle = "#ffffff";
      g.fillRect(at.x + 1, at.y + 1, at.w - 2, at.h - 2);
      // redesenha o conteúdo da ativa por cima do branco
      this.desenharConteudoAtiva();
    }
    if (this.arrasto?.tipo === "preencher" && this.arrasto.alvo) {
      const fx = this.faixaPreenchimento(this.arrasto.alvo);
      const p = this.retangulo({ l: fx.l0, c: fx.c0 }), q = this.retangulo({ l: fx.l1, c: fx.c1 });
      g.strokeStyle = "#5e6b78";
      g.setLineDash([3, 3]);
      g.strokeRect(p.x + 0.5, p.y + 0.5, q.x + q.w - p.x - 1, q.y + q.h - p.y - 1);
      g.setLineDash([]);
    }
    g.strokeStyle = "#2f7fd0";
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    // alça de preenchimento
    if (!this.editando) {
      const s = 7 * Math.max(1, this.zoom);
      g.fillStyle = "#2f7fd0";
      g.fillRect(x + w - s / 2 - 1, y + h - s / 2 - 1, s, s);
      g.strokeStyle = "#fff";
      g.lineWidth = 1;
      g.strokeRect(x + w - s / 2 - 1, y + h - s / 2 - 1, s, s);
    }
  }

  private desenharConteudoAtiva() {
    const folha = this.host.folha(), { l, c } = this.ativa;
    const cel = folha.celulas[chave(l, c)];
    if (!cel || cel.e === "") return;
    const g = this.ctx, r = this.retangulo(this.ativa);
    const v = this.host.calc.valor(folha.nome, l, c);
    const { texto, alinhar } = exibir(v, cel.f);
    const al = cel.f?.alinhar ?? alinhar;
    if (cel.f?.fundo) {
      g.fillStyle = cel.f.fundo;
      g.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    g.font = this.fonte(cel.f);
    g.fillStyle = cel.f?.cor ?? "#1e2730";
    g.textAlign = al === "direita" ? "right" : al === "centro" ? "center" : "left";
    g.textBaseline = "middle";
    const pad = 4 * this.zoom;
    g.save();
    g.beginPath();
    g.rect(r.x + 1, r.y, r.w - 2, r.h);
    g.clip();
    g.fillText(texto, al === "direita" ? r.x + r.w - pad : al === "centro" ? r.x + r.w / 2 : r.x + pad, r.y + r.h / 2 + 1);
    g.restore();
  }

  private desenharCabecalhos(c0: number, c1: number, l0: number, l1: number, fx: number, fy: number) {
    const g = this.ctx, W = this.area.clientWidth, H = this.area.clientHeight, z = this.zoom, cg = this.congelar;
    const f = this.faixa();
    g.fillStyle = "#f5f7f9";
    g.fillRect(0, 0, W, this.cabA());
    g.fillRect(0, 0, this.cabL(), H);
    g.font = `${(12 * z).toFixed(1)}px ${FONTE}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const col = (c: number) => {
      const r = this.retangulo({ l: 0, c });
      const sel = c >= f.c0 && c <= f.c1;
      if (sel) {
        g.fillStyle = "#dbe8f6";
        g.fillRect(r.x, 0, r.w, this.cabA());
      }
      g.fillStyle = sel ? "#2f7fd0" : "#5e6b78";
      g.fillText(indiceParaColuna(c), r.x + r.w / 2, this.cabA() / 2);
      g.strokeStyle = "#d5dbe1";
      g.beginPath();
      g.moveTo(r.x + r.w - 0.5, 0);
      g.lineTo(r.x + r.w - 0.5, this.cabA());
      g.stroke();
    };
    const lin = (l: number) => {
      const r = this.retangulo({ l, c: 0 });
      const sel = l >= f.l0 && l <= f.l1;
      if (sel) {
        g.fillStyle = "#dbe8f6";
        g.fillRect(0, r.y, this.cabL(), r.h);
      }
      g.fillStyle = sel ? "#2f7fd0" : "#5e6b78";
      g.fillText(String(l + 1), this.cabL() / 2, r.y + r.h / 2);
      g.strokeStyle = "#d5dbe1";
      g.beginPath();
      g.moveTo(0, r.y + r.h - 0.5);
      g.lineTo(this.cabL(), r.y + r.h - 0.5);
      g.stroke();
    };
    g.save();
    g.beginPath();
    g.rect(fx, 0, W - fx, this.cabA());
    g.clip();
    for (let c = c0; c <= c1; c++) col(c);
    g.restore();
    for (let c = 0; c < cg.col; c++) col(c);
    g.save();
    g.beginPath();
    g.rect(0, fy, this.cabL(), H - fy);
    g.clip();
    for (let l = l0; l <= l1; l++) lin(l);
    g.restore();
    for (let l = 0; l < cg.lin; l++) lin(l);
    g.strokeStyle = "#b9c2cc";
    g.beginPath();
    g.moveTo(0, this.cabA() - 0.5);
    g.lineTo(W, this.cabA() - 0.5);
    g.moveTo(this.cabL() - 0.5, 0);
    g.lineTo(this.cabL() - 0.5, H);
    g.stroke();
    g.fillStyle = "#e3e8ed";
    g.fillRect(0, 0, this.cabL() - 1, this.cabA() - 1);
  }

  // ---------- seleção e rolagem ----------

  selecionar(p: Pos, estender = false) {
    p = { l: Math.max(0, Math.min(LIMITE_LINHAS - 1, p.l)), c: Math.max(0, Math.min(LIMITE_COLUNAS - 1, p.c)) };
    if (estender) this.foco = p;
    else {
      this.ativa = p;
      this.ancora = p;
      this.foco = p;
    }
    this.atualizarEspaco();
    this.mostrar(estender ? this.foco : this.ativa);
    this.redesenhar();
    this.host.aoMudarSelecao();
  }

  selecionarFaixa(f: Faixa) {
    this.ativa = { l: f.l0, c: f.c0 };
    this.ancora = { l: f.l0, c: f.c0 };
    this.foco = { l: f.l1, c: f.c1 };
    this.redesenhar();
    this.host.aoMudarSelecao();
  }

  /** Rola até a célula ficar visível. */
  mostrar(p: Pos) {
    const r = this.retangulo(p), cg = this.congelar, z = this.zoom;
    const fx = this.cabL() + this.colX(cg.col) * z, fy = this.cabA() + this.linY(cg.lin) * z;
    const W = this.area.clientWidth, H = this.area.clientHeight;
    if (p.c >= cg.col) {
      if (r.x < fx) this.rolagem.scrollLeft -= fx - r.x;
      else if (r.x + r.w > W - 14) this.rolagem.scrollLeft += r.x + r.w - W + 14;
    }
    if (p.l >= cg.lin) {
      if (r.y < fy) this.rolagem.scrollTop -= fy - r.y;
      else if (r.y + r.h > H - 14) this.rolagem.scrollTop += r.y + r.h - H + 14;
    }
  }

  /** Ctrl+seta: vai até a borda do bloco de dados. */
  private pular(p: Pos, dl: number, dc: number): Pos {
    const folha = this.host.folha();
    const cheia = (q: Pos) => {
      const c = folha.celulas[chave(q.l, q.c)];
      return !!c && c.e !== "";
    };
    const d = this.host.calc.dimensao(folha.nome);
    const lim = (q: Pos) => q.l >= 0 && q.c >= 0 && q.l < Math.max(d.lins, 1) + (dl > 0 ? 0 : 1) && q.c < Math.max(d.cols, 1) + (dc > 0 ? 0 : 1);
    let q = { ...p };
    const prox = (x: Pos) => ({ l: x.l + dl, c: x.c + dc });
    if (cheia(q) && cheia(prox(q))) {
      while (lim(prox(q)) && cheia(prox(q))) q = prox(q);
      return q;
    }
    q = prox(q);
    while (lim(q) && !cheia(q)) q = prox(q);
    if (!lim(q)) return dl > 0 ? { l: LIMITE_LINHAS - 1, c: p.c } : dc > 0 ? { l: p.l, c: LIMITE_COLUNAS - 1 } : { l: Math.max(0, q.l), c: Math.max(0, q.c) };
    return q;
  }

  // ---------- ponteiro ----------

  private pontoLocal(e: PointerEvent | MouseEvent) {
    const r = this.area.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private naAlca(x: number, y: number) {
    const f = this.faixa();
    const b = this.retangulo({ l: f.l1, c: f.c1 });
    return Math.abs(x - (b.x + b.w)) < 9 && Math.abs(y - (b.y + b.h)) < 9;
  }

  private instalarPonteiro() {
    const r = this.rolagem;
    let ultimoToque = 0;
    r.addEventListener("pointerdown", (e) => {
      const { x, y } = this.pontoLocal(e);
      if (e.button === 2) return;
      const toque = e.pointerType === "touch";
      const a = this.acertar(x, y);
      // mouse/caneta: o clique não pode tirar o foco do teclado da grade (nem da célula em edição)
      if (!toque) {
        e.preventDefault();
        if (!this.editando) this.focar();
      }
      clearTimeout(this.toqueLongo);
      if (toque) {
        // toque longo: menu de contexto; toque duplo: editar
        this.toqueLongo = window.setTimeout(() => {
          if (a.tipo === "celula") {
            const f = this.faixa();
            const dentro = a.pos.l >= f.l0 && a.pos.l <= f.l1 && a.pos.c >= f.c0 && a.pos.c <= f.c1;
            if (!dentro) this.selecionar(a.pos);
          }
          this.host.menuContexto(e.clientX, e.clientY);
        }, 550);
      }
      if (a.borda && !toque) {
        e.preventDefault();
        r.setPointerCapture(e.pointerId);
        if (a.borda === "col") this.arrasto = { tipo: "larg", ini: a.pos, idx: a.pos.c, x0: e.clientX, tam0: this.largura(a.pos.c) };
        else this.arrasto = { tipo: "alt", ini: a.pos, idx: a.pos.l, x0: e.clientY, tam0: this.altura(a.pos.l) };
        return;
      }
      // modo apontar: fórmula em edição esperando uma referência
      if (this.editando && a.tipo === "celula" && this.podeApontar()) {
        e.preventDefault();
        this.inserirReferencia(a.pos, a.pos);
        if (!toque) {
          r.setPointerCapture(e.pointerId);
          this.arrasto = { tipo: "apontar", ini: a.pos };
        }
        return;
      }
      if (this.editando) this.confirmarEdicao(null);
      if (!toque && !this.editando && this.naAlca(x, y)) {
        e.preventDefault();
        r.setPointerCapture(e.pointerId);
        this.arrasto = { tipo: "preencher", ini: this.foco };
        return;
      }
      if (a.tipo === "canto") return this.selecionarFaixa({ l0: 0, c0: 0, l1: LIMITE_LINHAS - 1, c1: LIMITE_COLUNAS - 1 });
      if (a.tipo === "col") {
        if (e.shiftKey) this.foco = { l: LIMITE_LINHAS - 1, c: a.pos.c };
        else {
          this.ativa = { l: 0, c: a.pos.c };
          this.ancora = { ...this.ativa };
          this.foco = { l: LIMITE_LINHAS - 1, c: a.pos.c };
        }
        if (!toque) {
          r.setPointerCapture(e.pointerId);
          this.arrasto = { tipo: "coluna", ini: a.pos };
        }
        this.redesenhar();
        return this.host.aoMudarSelecao();
      }
      if (a.tipo === "lin") {
        if (e.shiftKey) this.foco = { l: a.pos.l, c: LIMITE_COLUNAS - 1 };
        else {
          this.ativa = { l: a.pos.l, c: 0 };
          this.ancora = { ...this.ativa };
          this.foco = { l: a.pos.l, c: LIMITE_COLUNAS - 1 };
        }
        if (!toque) {
          r.setPointerCapture(e.pointerId);
          this.arrasto = { tipo: "linha", ini: a.pos };
        }
        this.redesenhar();
        return this.host.aoMudarSelecao();
      }
      this.inicioTab = null;
      const duplo = toque && Date.now() - ultimoToque < 350 && this.ativa.l === a.pos.l && this.ativa.c === a.pos.c;
      ultimoToque = Date.now();
      this.selecionar(a.pos, e.shiftKey);
      if (duplo) return this.iniciarEdicao(null, "editar");
      if (!toque) {
        r.setPointerCapture(e.pointerId);
        this.arrasto = { tipo: "sel", ini: a.pos };
      }
    });
    r.addEventListener("pointermove", (e) => {
      clearTimeout(this.toqueLongo);
      const { x, y } = this.pontoLocal(e);
      if (!this.arrasto) {
        const a = this.acertar(x, y);
        r.style.cursor = a.borda === "col" ? "col-resize" : a.borda === "lin" ? "row-resize" : !this.editando && this.naAlca(x, y) ? "crosshair" : a.tipo === "celula" ? "cell" : "default";
        return;
      }
      const ar = this.arrasto;
      if (ar.tipo === "larg" || ar.tipo === "alt") {
        const d = ((ar.tipo === "larg" ? e.clientX : e.clientY) - ar.x0!) / this.zoom;
        const novo = Math.max(ar.tipo === "larg" ? 12 : 10, Math.round(ar.tam0! + d));
        const fl = this.host.folha();
        if (ar.tipo === "larg") (fl.larguras ??= {})[ar.idx!] = novo;
        else (fl.alturas ??= {})[ar.idx!] = novo;
        this.atualizarEspaco();
        this.redesenhar();
        return;
      }
      // rola sozinho perto das bordas
      const W = this.area.clientWidth, H = this.area.clientHeight;
      if (x > W - 10) r.scrollLeft += 20;
      if (x < this.cabL() + 4) r.scrollLeft -= 20;
      if (y > H - 10) r.scrollTop += 20;
      if (y < this.cabA() + 4) r.scrollTop -= 20;
      const p = this.acertar(Math.max(this.cabL() + 1, x), Math.max(this.cabA() + 1, y)).pos;
      if (ar.tipo === "sel") {
        this.foco = p;
        this.host.aoMudarSelecao();
      } else if (ar.tipo === "coluna") this.foco = { l: LIMITE_LINHAS - 1, c: p.c };
      else if (ar.tipo === "linha") this.foco = { l: p.l, c: LIMITE_COLUNAS - 1 };
      else if (ar.tipo === "apontar") this.inserirReferencia(ar.ini, p);
      else if (ar.tipo === "preencher") ar.alvo = p;
      this.redesenhar();
    });
    const fim = (e: PointerEvent) => {
      clearTimeout(this.toqueLongo);
      const ar = this.arrasto;
      this.arrasto = null;
      if (!ar) return;
      if (ar.tipo === "larg" || ar.tipo === "alt") {
        const fl = this.host.folha();
        const mapa = ar.tipo === "larg" ? fl.larguras! : fl.alturas!;
        const v = mapa[ar.idx!];
        mapa[ar.idx!] = ar.tam0!;
        this.host.alterar(ar.tipo === "larg" ? "Largura da coluna" : "Altura da linha", () => (mapa[ar.idx!] = v));
      }
      if (ar.tipo === "preencher" && ar.alvo) this.preencher(this.faixaPreenchimento(ar.alvo));
      if (ar.tipo === "apontar") this.editor.focus();
      this.redesenhar();
      void e;
    };
    r.addEventListener("pointerup", fim);
    r.addEventListener("pointercancel", () => {
      clearTimeout(this.toqueLongo);
      this.arrasto = null;
    });
    r.addEventListener("dblclick", (e) => {
      const { x, y } = this.pontoLocal(e);
      const a = this.acertar(x, y);
      if (a.borda === "col") return this.autoAjustar(a.pos.c);
      if (a.tipo === "celula") this.iniciarEdicao(null, "editar");
    });
    r.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const { x, y } = this.pontoLocal(e);
      const a = this.acertar(x, y);
      const f = this.faixa();
      if (a.tipo === "celula" && !(a.pos.l >= f.l0 && a.pos.l <= f.l1 && a.pos.c >= f.c0 && a.pos.c <= f.c1)) this.selecionar(a.pos);
      this.host.menuContexto(e.clientX, e.clientY);
    });
    r.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.definirZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
  }

  definirZoom(z: number) {
    this.zoom = Math.max(0.5, Math.min(2.5, Math.round(z * 100) / 100));
    this.atualizarEspaco();
    this.redesenhar();
    this.posicionarEditor();
    this.host.aoMudarSelecao();
  }

  private autoAjustar(c: number) {
    const folha = this.host.folha(), g = this.ctx;
    let w = 30;
    for (const [k, cel] of Object.entries(folha.celulas)) {
      const [l, cc] = k.split(",").map(Number);
      if (cc !== c || cel.e === "") continue;
      g.font = this.fonte(cel.f);
      const t = exibir(this.host.calc.valor(folha.nome, l, c), cel.f).texto;
      w = Math.max(w, g.measureText(t).width / this.zoom + 12);
    }
    this.host.alterar("Ajustar largura", () => ((folha.larguras ??= {})[c] = Math.ceil(w)));
  }

  // ---------- teclado ----------

  /** Foco no teclado da grade (só com mouse/caneta: no celular abriria o teclado virtual). */
  focar() {
    if (!this.editando) this.teclado.focus({ preventScroll: true });
  }

  private instalarTeclado(t: HTMLTextAreaElement) {
    // digitação sem tecla conhecida (composição/teclado virtual): edita no lugar, já visível
    const noLugar = () => {
      if (t !== this.teclado || this.editando) return;
      this.trocarPapeis();
      this.iniciarEdicao(null, "entrar", true);
    };
    t.addEventListener("compositionstart", noLugar);
    t.addEventListener("input", () => {
      if (t === this.teclado && !this.editando && t.value) noLugar();
    });
    t.addEventListener("keydown", (e) => {
      if (t !== this.teclado || this.editando || e.isComposing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const mover = (dl: number, dc: number) => {
        e.preventDefault();
        this.inicioTab = null;
        const base = e.shiftKey ? this.foco : this.ativa;
        const alvo = ctrl ? this.pular(base, dl, dc) : { l: base.l + dl, c: base.c + dc };
        this.selecionar(alvo, e.shiftKey);
      };
      switch (e.key) {
        case "ArrowUp":
          return mover(-1, 0);
        case "ArrowDown":
          return mover(1, 0);
        case "ArrowLeft":
          return mover(0, -1);
        case "ArrowRight":
          return mover(0, 1);
        case "Enter":
          e.preventDefault();
          return this.moverDentroDaSelecao(e.shiftKey ? -1 : 1, 0);
        case "Tab":
          e.preventDefault();
          return this.moverDentroDaSelecao(0, e.shiftKey ? -1 : 1);
        case "Home":
          e.preventDefault();
          return this.selecionar(ctrl ? { l: 0, c: 0 } : { l: this.ativa.l, c: 0 }, e.shiftKey);
        case "PageDown":
        case "PageUp": {
          e.preventDefault();
          const n = Math.max(1, Math.floor(this.area.clientHeight / (ALT * this.zoom)) - 1);
          return this.selecionar({ l: (e.shiftKey ? this.foco : this.ativa).l + (e.key === "PageDown" ? n : -n), c: (e.shiftKey ? this.foco : this.ativa).c }, e.shiftKey);
        }
        case "F2":
          e.preventDefault();
          return this.iniciarEdicao(null, "editar");
        case "Delete":
        case "Backspace":
          e.preventDefault();
          if (e.key === "Backspace") return this.iniciarEdicao("", "entrar");
          return this.limpar();
        case "Escape":
          this.interno = null;
          return this.redesenhar();
      }
      if (ctrl && e.key === " ") {
        e.preventDefault();
        return this.selecionarFaixa({ l0: 0, c0: this.ativa.c, l1: LIMITE_LINHAS - 1, c1: this.ativa.c });
      }
      if (e.shiftKey && e.key === " ") {
        e.preventDefault();
        return this.selecionarFaixa({ l0: this.ativa.l, c0: 0, l1: this.ativa.l, c1: LIMITE_COLUNAS - 1 });
      }
      if (ctrl && e.key.toLowerCase() === "a") {
        e.preventDefault();
        return this.selecionarFaixa({ l0: 0, c0: 0, l1: LIMITE_LINHAS - 1, c1: LIMITE_COLUNAS - 1 });
      }
      if (ctrl && e.key === ";") {
        e.preventDefault();
        const d = new Date();
        return this.definirNaAtiva(`${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`);
      }
      if (ctrl && (e.key.toLowerCase() === "d" || e.key.toLowerCase() === "r")) {
        e.preventDefault();
        return this.preencherDireto(e.key.toLowerCase() === "d" ? "baixo" : "direita");
      }
      if (!ctrl && !e.altKey && e.key.length === 1) {
        e.preventDefault();
        this.iniciarEdicao(e.key, "entrar");
      }
    });
    t.addEventListener("copy", (e) => t === this.teclado && this.copiar(e, false));
    t.addEventListener("cut", (e) => t === this.teclado && this.copiar(e, true));
    t.addEventListener("paste", (e) => {
      if (t !== this.teclado) return;
      e.preventDefault();
      this.colar(e.clipboardData?.getData("text/plain") ?? "");
    });
  }

  /** Coluna onde começou uma sequência de Tab: o Enter seguinte volta para ela, na linha de baixo. */
  private inicioTab: number | null = null;

  private moverDentroDaSelecao(dl: number, dc: number) {
    const f = this.faixa();
    if (f.l0 === f.l1 && f.c0 === f.c1) {
      if (dc) this.inicioTab ??= this.ativa.c;
      if (dl === 1 && this.inicioTab !== null) {
        const c = this.inicioTab;
        this.inicioTab = null;
        return this.selecionar({ l: this.ativa.l + 1, c });
      }
      if (!dc) this.inicioTab = null;
      return this.selecionar({ l: this.ativa.l + dl, c: this.ativa.c + dc });
    }
    // dentro da faixa selecionada, como nas planilhas de mercado
    let { l, c } = this.ativa;
    if (dl) {
      l += dl;
      if (l > f.l1) [l, c] = [f.l0, c + 1 > f.c1 ? f.c0 : c + 1];
      if (l < f.l0) [l, c] = [f.l1, c - 1 < f.c0 ? f.c1 : c - 1];
    } else {
      c += dc;
      if (c > f.c1) [c, l] = [f.c0, l + 1 > f.l1 ? f.l0 : l + 1];
      if (c < f.c0) [c, l] = [f.c1, l - 1 < f.l0 ? f.l1 : l - 1];
    }
    this.ativa = { l, c };
    this.mostrar(this.ativa);
    this.redesenhar();
    this.host.aoMudarSelecao();
  }

  // ---------- edição ----------

  podeApontar() {
    if (!this.editando || !this.editor.value.startsWith("=")) return false;
    const i = this.editor.selectionStart ?? this.editor.value.length;
    if (this.apontado && this.apontado.f === i) return true;
    const antes = this.editor.value.slice(0, i).trimEnd();
    return /[=(;+\-*/^&<>:%]$/.test(antes);
  }

  private inserirReferencia(a: Pos, b: Pos) {
    const f = normalizarFaixa(a, b);
    const texto = f.l0 === f.l1 && f.c0 === f.c1 ? enderecoA1(f.l0, f.c0) : `${enderecoA1(f.l0, f.c0)}:${enderecoA1(f.l1, f.c1)}`;
    const v = this.editor.value;
    let i = this.editor.selectionStart ?? v.length, j = this.editor.selectionEnd ?? i;
    if (this.apontado && this.apontado.f === i) [i, j] = [this.apontado.i, this.apontado.f];
    this.editor.value = v.slice(0, i) + texto + v.slice(j);
    const k = i + texto.length;
    this.editor.setSelectionRange(k, k);
    this.apontado = { i, f: k };
    this.host.aoEditar(this.editor.value);
    this.redesenhar();
  }

  /** Começa a editar a célula ativa: com um caractere digitado (substitui) ou o conteúdo atual. */
  iniciarEdicao(inicial: string | null, modo: "entrar" | "editar", noLugar = false) {
    const cel = this.host.folha().celulas[chave(this.ativa.l, this.ativa.c)];
    const original = cel?.e ?? "";
    this.editando = { pos: { ...this.ativa }, original, modo };
    // no lugar: o campo já tem o foco e o texto em composição; mexer nele quebraria a digitação
    if (!noLugar) this.editor.value = inicial ?? original;
    this.editor.hidden = false;
    this.apontado = null;
    this.mostrar(this.ativa);
    this.posicionarEditor();
    if (!noLugar) {
      this.editor.focus({ preventScroll: true });
      const k = this.editor.value.length;
      this.editor.setSelectionRange(k, k);
    }
    this.host.aoEditar(this.editor.value);
    this.atualizarSugestoes();
    this.redesenhar();
  }

  posicionarEditor() {
    if (!this.editando) return;
    const r = this.retangulo(this.editando.pos);
    const cel = this.host.folha().celulas[chave(this.editando.pos.l, this.editando.pos.c)];
    const s = this.editor.style;
    s.left = `${r.x}px`;
    s.top = `${r.y}px`;
    s.minWidth = `${r.w}px`;
    s.height = `${Math.max(r.h, this.editor.scrollHeight)}px`;
    s.font = this.fonte(cel?.f);
    s.width = "auto";
    // cresce com o texto
    const ctx = this.ctx;
    ctx.font = this.fonte(cel?.f);
    const w = Math.max(r.w, Math.min(this.area.clientWidth - r.x - 4, ctx.measureText(this.editor.value + "MM").width + 8));
    s.width = `${w}px`;
  }

  /** Texto vindo da barra de fórmulas. */
  definirTextoEdicao(t: string) {
    if (!this.editando) this.iniciarEdicao(t, "editar");
    this.editor.value = t;
    this.posicionarEditor();
    this.redesenhar();
  }

  confirmarEdicao(mover: { dl: number; dc: number } | null) {
    if (!this.editando) return;
    const { pos } = this.editando;
    let texto = this.editor.value;
    this.encerrarEditor();
    // fecha parênteses esquecidos, como as planilhas de mercado
    if (texto.startsWith("=")) {
      const abertos = (texto.match(/\(/g)?.length ?? 0) - (texto.match(/\)/g)?.length ?? 0);
      if (abertos > 0 && !/"[^"]*$/.test(texto)) texto += ")".repeat(abertos);
    }
    this.definirCelula(pos, texto);
    if (mover) {
      if (mover.dl || mover.dc) this.moverDentroDaSelecao(mover.dl, mover.dc);
    }
    this.focar();
  }

  cancelarEdicao() {
    if (!this.editando) return;
    this.encerrarEditor();
    this.host.aoMudarSelecao();
    this.focar();
  }

  private encerrarEditor() {
    this.editando = null;
    this.apontado = null;
    this.editor.hidden = true;
    this.teclado.value = "";
    this.sugestoes.hidden = true;
    this.dica.hidden = true;
    this.host.aoEditar(null);
    this.redesenhar();
  }

  private instalarEditor(ed: HTMLTextAreaElement) {
    ed.addEventListener("input", () => {
      if (ed !== this.editor || !this.editando) return;
      this.apontado = null;
      this.posicionarEditor();
      this.host.aoEditar(ed.value);
      this.atualizarSugestoes();
      this.redesenhar();
    });
    ed.addEventListener("click", () => {
      if (ed !== this.editor) return;
      if (this.editando) this.editando.modo = "editar";
      this.atualizarSugestoes();
    });
    ed.addEventListener("keydown", (e) => {
      if (ed !== this.editor || !this.editando || e.isComposing) return;
      const lista = !this.sugestoes.hidden;
      if (lista && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const itens = [...this.sugestoes.children] as HTMLElement[];
        const i = itens.findIndex((x) => x.classList.contains("sel"));
        const n = (i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
        itens.forEach((x, k) => x.classList.toggle("sel", k === n));
        return;
      }
      if (lista && (e.key === "Tab" || (e.key === "Enter" && !e.altKey))) {
        const sel = this.sugestoes.querySelector<HTMLElement>(".sel");
        if (sel) {
          e.preventDefault();
          this.aceitarSugestao(sel.dataset.nome!);
          return;
        }
      }
      if (e.key === "Enter" && e.altKey) {
        e.preventDefault();
        const i = ed.selectionStart;
        ed.value = ed.value.slice(0, i) + "\n" + ed.value.slice(ed.selectionEnd);
        ed.setSelectionRange(i + 1, i + 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        return this.confirmarEdicao({ dl: e.shiftKey ? -1 : 1, dc: 0 });
      }
      if (e.key === "Tab") {
        e.preventDefault();
        return this.confirmarEdicao({ dl: 0, dc: e.shiftKey ? -1 : 1 });
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (lista) {
          this.sugestoes.hidden = true;
          return;
        }
        return this.cancelarEdicao();
      }
      if (e.key === "F2") {
        e.preventDefault();
        this.editando.modo = this.editando.modo === "entrar" ? "editar" : "entrar";
        return;
      }
      if (e.key === "F4" && ed.value.startsWith("=")) {
        e.preventDefault();
        return this.alternarAbsoluta();
      }
      // modo "entrar": setas confirmam e movem (ou apontam, numa fórmula)
      if (this.editando.modo === "entrar" && e.key.startsWith("Arrow")) {
        const dl = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0, dc = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        e.preventDefault();
        if (this.podeApontar()) {
          const base = this.apontadoPos ?? this.editando.pos;
          const p = { l: Math.max(0, base.l + dl), c: Math.max(0, base.c + dc) };
          this.apontadoPos = p;
          this.inserirReferencia(p, p);
          return;
        }
        return this.confirmarEdicao({ dl, dc });
      }
    });
  }
  private apontadoPos: Pos | null = null;

  /** F4: alterna A1 → $A$1 → A$1 → $A1 na referência sob o cursor. */
  private alternarAbsoluta() {
    const ed = this.editor, v = ed.value, i = ed.selectionStart ?? v.length;
    const rx = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(v))) {
      if (i < m.index || i > m.index + m[0].length) continue;
      const [, a, col, b, lin] = m;
      const prox = !a && !b ? ["$", "$"] : a && b ? ["", "$"] : !a && b ? ["$", ""] : ["", ""];
      const novo = `${prox[0]}${col}${prox[1]}${lin}`;
      ed.value = v.slice(0, m.index) + novo + v.slice(m.index + m[0].length);
      const k = m.index + novo.length;
      ed.setSelectionRange(k, k);
      this.host.aoEditar(ed.value);
      this.redesenhar();
      return;
    }
  }

  private atualizarSugestoes() {
    const ed = this.editor;
    this.apontadoPos = null;
    if (!this.editando || !ed.value.startsWith("=")) {
      this.sugestoes.hidden = true;
      this.dica.hidden = true;
      return;
    }
    const i = ed.selectionStart ?? ed.value.length;
    const antes = ed.value.slice(0, i);
    const m = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.]*)$/.exec(antes);
    const r = this.retangulo(this.editando.pos);
    if (m && !/\d/.test(m[1][0]) && !/^[A-Za-z]{1,3}\d+$/.test(m[1])) {
      const q = normalizarNome(m[1]);
      const achadas = listaDeFuncoes().filter((x) => normalizarNome(x.nome).startsWith(q)).slice(0, 8);
      if (achadas.length) {
        this.sugestoes.innerHTML = achadas.map((x, k) => `<div data-nome="${x.nome}" class="${k === 0 ? "sel" : ""}"><b>${x.nome}</b><small>${x.def.descricao}</small></div>`).join("");
        this.sugestoes.style.left = `${r.x}px`;
        this.sugestoes.style.top = `${r.y + r.h + 2}px`;
        this.sugestoes.hidden = false;
        for (const d of this.sugestoes.children) {
          (d as HTMLElement).onpointerdown = (e) => {
            e.preventDefault();
            this.aceitarSugestao((d as HTMLElement).dataset.nome!);
          };
        }
      } else this.sugestoes.hidden = true;
    } else this.sugestoes.hidden = true;
    // dica de sintaxe da função em que o cursor está
    let nivel = 0, nome = "";
    for (let k = antes.length - 1; k >= 0; k--) {
      const ch = antes[k];
      if (ch === ")") nivel++;
      else if (ch === "(") {
        if (nivel === 0) {
          nome = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.]*)$/.exec(antes.slice(0, k))?.[1] ?? "";
          break;
        }
        nivel--;
      }
    }
    const def = nome ? FUNCOES[normalizarNome(nome)] : undefined;
    if (def && this.sugestoes.hidden) {
      this.dica.textContent = def.sintaxe;
      this.dica.style.left = `${r.x}px`;
      this.dica.style.top = `${r.y + r.h + 2}px`;
      this.dica.hidden = false;
    } else this.dica.hidden = true;
  }

  private aceitarSugestao(nome: string) {
    const ed = this.editor;
    const i = ed.selectionStart ?? ed.value.length;
    const antes = ed.value.slice(0, i).replace(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.]*)$/, "");
    ed.value = `${antes}${nome}(${ed.value.slice(i)}`;
    const k = antes.length + nome.length + 1;
    ed.setSelectionRange(k, k);
    this.sugestoes.hidden = true;
    this.host.aoEditar(ed.value);
    this.atualizarSugestoes();
    ed.focus();
  }

  // ---------- conteúdo ----------

  definirCelula(p: Pos, texto: string) {
    const folha = this.host.folha();
    const k = chave(p.l, p.c);
    const antes = folha.celulas[k];
    if ((antes?.e ?? "") === texto) {
      this.redesenhar();
      return;
    }
    this.host.alterar("Editar célula", () => {
      const cel: Celula = { ...(folha.celulas[k] ?? { e: "" }), e: texto };
      // formato sugerido pela entrada (12% → porcentagem, 25/12/2026 → data) se ainda não tem
      if (!texto.startsWith("=")) {
        const sug = interpretarEntrada(texto).formato;
        if (sug && sug !== "texto" && !cel.f?.tipo) cel.f = { ...cel.f, tipo: sug, ...(sug === "moeda" ? { casas: 2 } : {}) };
      }
      if (texto === "" && !cel.f) delete folha.celulas[k];
      else folha.celulas[k] = cel;
    });
  }

  definirNaAtiva(texto: string) {
    this.definirCelula(this.ativa, texto);
  }

  /** Apaga o conteúdo da seleção (formatos ficam). */
  limpar(tambemFormatos = false) {
    const f = this.faixaLimitada();
    const folha = this.host.folha();
    this.host.alterar("Limpar", () => {
      for (const k of Object.keys(folha.celulas)) {
        const [l, c] = k.split(",").map(Number);
        if (l < f.l0 || l > f.l1 || c < f.c0 || c > f.c1) continue;
        if (tambemFormatos || !folha.celulas[k].f) delete folha.celulas[k];
        else folha.celulas[k].e = "";
      }
    });
  }

  /** Seleção cortada ao que existe (linha/coluna inteira não percorre 1 milhão de células). */
  faixaLimitada(): Faixa {
    const f = this.faixa();
    const d = this.host.calc.dimensao(this.host.folha().nome);
    return { l0: f.l0, c0: f.c0, l1: Math.min(f.l1, Math.max(f.l0, d.lins - 1)), c1: Math.min(f.c1, Math.max(f.c0, d.cols - 1)) };
  }

  // ---------- área de transferência ----------

  private textoDaFaixa(f: Faixa) {
    const folha = this.host.folha();
    const linhas: string[] = [];
    for (let l = f.l0; l <= f.l1; l++) {
      const cs: string[] = [];
      for (let c = f.c0; c <= f.c1; c++) {
        const cel = folha.celulas[chave(l, c)];
        const v = cel ? exibir(this.host.calc.valor(folha.nome, l, c), cel.f).texto : "";
        cs.push(/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      }
      linhas.push(cs.join("\t"));
    }
    return linhas.join("\n");
  }

  copiar(e: ClipboardEvent | null, recorte: boolean) {
    e?.preventDefault();
    const f = this.faixaLimitada();
    const folha = this.host.folha();
    const texto = this.textoDaFaixa(f);
    const celulas: (Celula | undefined)[][] = [];
    for (let l = f.l0; l <= f.l1; l++) {
      const linha: (Celula | undefined)[] = [];
      for (let c = f.c0; c <= f.c1; c++) {
        const x = folha.celulas[chave(l, c)];
        linha.push(x ? JSON.parse(JSON.stringify(x)) : undefined);
      }
      celulas.push(linha);
    }
    this.interno = { texto, origem: f, celulas, recorte };
    if (e?.clipboardData) e.clipboardData.setData("text/plain", texto);
    else void navigator.clipboard?.writeText(texto).catch(() => {});
    this.redesenhar();
  }

  /** Cola: do próprio WJPlan (fórmulas e formatos, referências deslocadas) ou texto (TSV). */
  colar(texto: string) {
    const folha = this.host.folha();
    const destino = this.ativa;
    const int = this.interno;
    if (int && (texto === "" || texto.replace(/\r/g, "") === int.texto)) {
      const alt = int.celulas.length, larg = int.celulas[0]?.length ?? 0;
      this.host.alterar(int.recorte ? "Recortar e colar" : "Colar", () => {
        if (int.recorte) {
          for (let l = int.origem.l0; l <= int.origem.l1; l++) for (let c = int.origem.c0; c <= int.origem.c1; c++) delete folha.celulas[chave(l, c)];
        }
        int.celulas.forEach((linha, i) => linha.forEach((cel, j) => {
          const k = chave(destino.l + i, destino.c + j);
          if (!cel) delete folha.celulas[k];
          else {
            const dl = destino.l + i - (int.origem.l0 + i), dc = destino.c + j - (int.origem.c0 + j);
            folha.celulas[k] = { ...cel, e: int.recorte ? cel.e : deslocarReferencias(cel.e, dl, dc) };
          }
        }));
      });
      if (int.recorte) this.interno = null;
      this.selecionarFaixa({ l0: destino.l, c0: destino.c, l1: destino.l + alt - 1, c1: destino.c + larg - 1 });
      return;
    }
    const linhas = lerTSV(texto);
    if (!linhas.length) return;
    this.host.alterar("Colar", () => {
      linhas.forEach((cs, i) => cs.forEach((v, j) => {
        const k = chave(destino.l + i, destino.c + j);
        if (v === "") delete folha.celulas[k];
        else {
          const sug = interpretarEntrada(v).formato;
          folha.celulas[k] = { e: v, ...(sug && sug !== "texto" ? { f: { tipo: sug } } : {}) };
        }
      }));
    });
    this.selecionarFaixa({ l0: destino.l, c0: destino.c, l1: destino.l + linhas.length - 1, c1: destino.c + Math.max(...linhas.map((x) => x.length)) - 1 });
  }

  // ---------- preencher ----------

  private faixaPreenchimento(alvo: Pos): Faixa {
    const f = this.faixa();
    const dBaixo = alvo.l - f.l1, dCima = f.l0 - alvo.l, dDir = alvo.c - f.c1, dEsq = f.c0 - alvo.c;
    const m = Math.max(dBaixo, dCima, dDir, dEsq);
    if (m <= 0) return f;
    if (m === dBaixo) return { ...f, l1: alvo.l };
    if (m === dCima) return { ...f, l0: alvo.l };
    if (m === dDir) return { ...f, c1: alvo.c };
    return { ...f, c0: alvo.c };
  }

  /** Preenche a faixa nova a partir da seleção: série (números, datas, "Item 1") ou cópia. */
  preencher(alvo: Faixa) {
    const f = this.faixa();
    if (alvo.l0 === f.l0 && alvo.l1 === f.l1 && alvo.c0 === f.c0 && alvo.c1 === f.c1) return;
    const folha = this.host.folha();
    const vertical = alvo.c0 === f.c0 && alvo.c1 === f.c1;
    const para = vertical ? (alvo.l1 > f.l1 ? 1 : -1) : (alvo.c1 > f.c1 ? 1 : -1);
    this.host.alterar("Preencher", () => {
      const linhasFonte = vertical ? f.c1 - f.c0 + 1 : f.l1 - f.l0 + 1;
      for (let k = 0; k < linhasFonte; k++) {
        const fonte: Pos[] = [];
        if (vertical) for (let l = f.l0; l <= f.l1; l++) fonte.push({ l, c: f.c0 + k });
        else for (let c = f.c0; c <= f.c1; c++) fonte.push({ l: f.l0 + k, c });
        if (para < 0) fonte.reverse();
        const cels = fonte.map((p) => folha.celulas[chave(p.l, p.c)]);
        const nums = cels.map((c) => (c && !c.e.startsWith("=") ? interpretarEntrada(c.e).valor : null));
        const serieNum = nums.every((v) => typeof v === "number") && (nums.length >= 2 || cels[0]?.f?.tipo === "data");
        const passo = serieNum ? (nums.length >= 2 ? ((nums[nums.length - 1] as number) - (nums[0] as number)) / (nums.length - 1) : 1) : 0;
        const textoNum = cels.length === 1 && cels[0] && !cels[0].e.startsWith("=") ? /^(.*?)(\d+)$/.exec(cels[0].e) : null;
        const total = vertical ? (para > 0 ? alvo.l1 - f.l1 : f.l0 - alvo.l0) : para > 0 ? alvo.c1 - f.c1 : f.c0 - alvo.c0;
        for (let n = 1; n <= total; n++) {
          const ori = fonte[(n - 1) % fonte.length];
          const p = vertical ? { l: (para > 0 ? f.l1 : f.l0) + para * n, c: f.c0 + k } : { l: f.l0 + k, c: (para > 0 ? f.c1 : f.c0) + para * n };
          const cel = folha.celulas[chave(ori.l, ori.c)];
          const kk = chave(p.l, p.c);
          if (!cel) {
            delete folha.celulas[kk];
            continue;
          }
          let e = cel.e;
          if (serieNum) {
            const v = (nums[nums.length - 1] as number) + passo * n;
            e = cel.f?.tipo === "data" || cel.f?.tipo === "porcentagem" || cel.f?.tipo === "moeda" ? String(v).replace(".", ",") : String(Number(v.toPrecision(15))).replace(".", ",");
            if (cel.f?.tipo === "data") {
              const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
              folha.celulas[kk] = { e: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`, f: cel.f };
              continue;
            }
          } else if (textoNum) e = `${textoNum[1]}${Number(textoNum[2]) + n * para}`;
          else if (e.startsWith("=")) e = deslocarReferencias(e, p.l - ori.l, p.c - ori.c);
          folha.celulas[kk] = { ...cel, e };
        }
      }
    });
    this.selecionarFaixa(alvo);
  }

  /** Ctrl+D / Ctrl+R: copia a primeira linha/coluna da seleção para o resto. */
  preencherDireto(sentido: "baixo" | "direita") {
    const f = this.faixaLimitada();
    const folha = this.host.folha();
    this.host.alterar(sentido === "baixo" ? "Preencher abaixo" : "Preencher à direita", () => {
      for (let l = f.l0; l <= f.l1; l++) {
        for (let c = f.c0; c <= f.c1; c++) {
          const ori = sentido === "baixo" ? { l: f.l0, c } : { l, c: f.c0 };
          if (ori.l === l && ori.c === c) continue;
          const cel = folha.celulas[chave(ori.l, ori.c)];
          const k = chave(l, c);
          if (!cel) delete folha.celulas[k];
          else folha.celulas[k] = { ...cel, e: deslocarReferencias(cel.e, l - ori.l, c - ori.c) };
        }
      }
    });
  }
}

/** Texto separado por tabulação (ou ;) com aspas → matriz de textos. */
export function lerTSV(texto: string, sep = "\t"): string[][] {
  const t = texto.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (!t) return [];
  const linhas: string[][] = [];
  let linha: string[] = [], campo = "", aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"' && campo === "") aspas = true;
    else if (ch === sep) {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += ch;
  }
  linha.push(campo);
  linhas.push(linha);
  return linhas;
}
