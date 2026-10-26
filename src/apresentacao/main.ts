// WJApresentation: apresentações do WJProMaster (especificação: docs/global/apresentacoes.md).
// v1: slides 16:9/4:3 com caixas de texto, formas e imagens; temas e layouts próprios;
// mover/redimensionar com alças (mouse, caneta e dedo); anotações; transições e animações;
// apresentação em tela cheia, modo do apresentador; PDF pela impressão; arquivo .wjapn.

import "./apresentacao.css";
import { $, autosave, baixar, Casca, el, escapar, escolherArquivo, Historico, janela, menu, registrarOffline, type Aba } from "../comum/casca";

type TipoForma = "retangulo" | "arredondado" | "elipse" | "triangulo" | "seta" | "linha" | "estrela";
type Anim = "nenhuma" | "aparecer" | "esmaecer" | "voar" | "zoom";
type Transicao = "nenhuma" | "esmaecer" | "empurrar" | "zoom";

interface Obj {
  id: string;
  tipo: "texto" | "forma" | "imagem";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Texto (HTML) de caixas e formas. */
  html?: string;
  /** Espaço reservado do layout ("titulo", "corpo"): some do slide apresentado se vazio. */
  papel?: "titulo" | "subtitulo" | "corpo";
  tam?: number;
  cor?: string;
  alinhar?: "left" | "center" | "right";
  vertical?: "start" | "center" | "end";
  negrito?: boolean;
  forma?: TipoForma;
  preenchimento?: string;
  contorno?: string;
  espessura?: number;
  src?: string;
  anim?: Anim;
}

interface Slide {
  id: string;
  layout: string;
  objetos: Obj[];
  notas: string;
  fundo?: string;
  transicao?: Transicao;
  oculto?: boolean;
}

interface Apresentacao {
  formato: "wjapn";
  versao: 1;
  nome: string;
  tema: string;
  proporcao: "16:9" | "4:3";
  slides: Slide[];
}

interface Tema {
  nome: string;
  fundo: string;
  titulo: string;
  texto: string;
  destaque: string;
  fonteTitulo: string;
  fonteCorpo: string;
  faixa?: string;
}

const TEMAS: Record<string, Tema> = {
  claro: { nome: "Claro", fundo: "#ffffff", titulo: "#1e2730", texto: "#3a4652", destaque: "#2f7fd0", fonteTitulo: '"Noto Sans", sans-serif', fonteCorpo: '"Noto Sans", sans-serif' },
  engenharia: { nome: "Engenharia", fundo: "#f4f7fa", titulo: "#12395c", texto: "#2b3a48", destaque: "#2f7fd0", fonteTitulo: '"Noto Sans", sans-serif', fonteCorpo: '"Noto Sans", sans-serif', faixa: "#2f7fd0" },
  noite: { nome: "Noite", fundo: "#1d242b", titulo: "#ffffff", texto: "#cfd8e1", destaque: "#5eb0ff", fonteTitulo: '"Noto Sans", sans-serif', fonteCorpo: '"Noto Sans", sans-serif' },
  aco: { nome: "Aço", fundo: "#e9ecef", titulo: "#2b2f33", texto: "#40464d", destaque: "#c9372c", fonteTitulo: 'Georgia, serif', fonteCorpo: '"Noto Sans", sans-serif', faixa: "#5e6b78" },
  verde: { nome: "Verde", fundo: "#f3f8f4", titulo: "#1f5134", texto: "#2e3f33", destaque: "#2e8b57", fonteTitulo: '"Noto Sans", sans-serif', fonteCorpo: '"Noto Sans", sans-serif', faixa: "#2e8b57" },
  ambar: { nome: "Âmbar", fundo: "#fffaf0", titulo: "#5a3b00", texto: "#4a3a20", destaque: "#d07a00", fonteTitulo: 'Georgia, serif', fonteCorpo: 'Georgia, serif', faixa: "#d07a00" },
};

const LAYOUTS: Record<string, string> = {
  titulo: "Slide de título", tituloConteudo: "Título e conteúdo", duasColunas: "Duas colunas", secao: "Cabeçalho de seção", soTitulo: "Só título", branco: "Em branco",
};

const CHAVE = "wjapn:documento";
const id = () => Math.random().toString(36).slice(2, 10);
const larguraDe = (p: string) => (p === "4:3" ? 960 : 1280);
const largura = () => larguraDe(doc.proporcao);
const ALTURA = 720;

function slideDoLayout(layout: string, W = largura()): Slide {
  const o: Obj[] = [];
  const txt = (papel: Obj["papel"], x: number, y: number, w: number, h: number, tam: number, extra: Partial<Obj> = {}): Obj =>
    ({ id: id(), tipo: "texto", papel, x, y, w, h, html: "", tam, ...extra });
  switch (layout) {
    case "titulo":
      o.push(txt("titulo", 80, 220, W - 160, 150, 60, { alinhar: "center", vertical: "end", negrito: true }), txt("subtitulo", 80, 390, W - 160, 90, 28, { alinhar: "center" }));
      break;
    case "tituloConteudo":
      o.push(txt("titulo", 60, 40, W - 120, 110, 44, { negrito: true, vertical: "center" }), txt("corpo", 60, 170, W - 120, 500, 28));
      break;
    case "duasColunas":
      o.push(txt("titulo", 60, 40, W - 120, 110, 44, { negrito: true, vertical: "center" }), txt("corpo", 60, 170, (W - 150) / 2, 500, 26), txt("corpo", 90 + (W - 150) / 2, 170, (W - 150) / 2, 500, 26));
      break;
    case "secao":
      o.push(txt("titulo", 80, 260, W - 160, 130, 54, { negrito: true, vertical: "end" }), txt("subtitulo", 80, 400, W - 160, 70, 26));
      break;
    case "soTitulo":
      o.push(txt("titulo", 60, 40, W - 120, 110, 44, { negrito: true, vertical: "center" }));
      break;
  }
  return { id: id(), layout, objetos: o, notas: "" };
}

const docVazio = (): Apresentacao => ({ formato: "wjapn", versao: 1, nome: "Apresentação1", tema: "engenharia", proporcao: "16:9", slides: [slideDoLayout("titulo", 1280)] });

function validar(d: unknown): Apresentacao {
  const x = d as Apresentacao;
  if (!x || x.formato !== "wjapn" || !Array.isArray(x.slides)) throw new Error("Arquivo não é uma apresentação do WJApresentation (.wjapn).");
  if (!x.slides.length) x.slides.push(slideDoLayout("titulo", larguraDe(x.proporcao)));
  if (!TEMAS[x.tema]) x.tema = "claro";
  return x;
}

let doc: Apresentacao = (() => {
  try {
    const d = autosave.ler<Apresentacao>(CHAVE);
    return d ? validar(d) : docVazio();
  } catch {
    return docVazio();
  }
})();
let atual = 0;
let selecionados: string[] = [];
let editando: string | null = null;
const historico = new Historico<Apresentacao>();
historico.limpar(doc);

const slide = () => doc.slides[atual];
const objSel = () => slide().objetos.find((o) => o.id === selecionados[0]);
const palco = $<HTMLDivElement>("#ap-palco");
const palcoArea = $<HTMLDivElement>("#ap-palco-area");
const notas = $<HTMLTextAreaElement>("#ap-notas");

// ---------- desenho de um slide (palco, miniaturas, apresentação, impressão) ----------

function svgForma(o: Obj): string {
  const f = o.preenchimento ?? TEMAS[doc.tema].destaque, c = o.contorno ?? "none", e = o.espessura ?? 0;
  const W = o.w, H = o.h, m = e / 2;
  const est = `fill="${o.forma === "linha" ? "none" : f}" stroke="${o.forma === "linha" ? (o.contorno ?? f) : c}" stroke-width="${o.forma === "linha" ? Math.max(2, e) : e}"`;
  switch (o.forma) {
    case "elipse":
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2 - m}" ry="${H / 2 - m}" ${est}/></svg>`;
    case "triangulo":
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="${W / 2},${m} ${W - m},${H - m} ${m},${H - m}" ${est}/></svg>`;
    case "seta":
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="${m},${H * 0.3} ${W * 0.62},${H * 0.3} ${W * 0.62},${m} ${W - m},${H / 2} ${W * 0.62},${H - m} ${W * 0.62},${H * 0.7} ${m},${H * 0.7}" ${est}/></svg>`;
    case "linha":
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" ${est} stroke-linecap="round"/></svg>`;
    case "estrela": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? 0.4 : 0.5, a = -Math.PI / 2 + (i * Math.PI) / 5;
        return `${W / 2 + Math.cos(a) * W * r},${H / 2 + Math.sin(a) * H * r}`;
      }).join(" ");
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="${pts}" ${est}/></svg>`;
    }
    case "arredondado":
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect x="${m}" y="${m}" width="${W - e}" height="${H - e}" rx="${Math.min(W, H) * 0.15}" ${est}/></svg>`;
    default:
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect x="${m}" y="${m}" width="${W - e}" height="${H - e}" ${est}/></svg>`;
  }
}

function elementoObjeto(o: Obj, editavel: boolean): HTMLElement {
  const t = TEMAS[doc.tema];
  const d = el("div", { class: `ap-obj ap-${o.tipo}`, "data-id": o.id });
  d.style.cssText = `left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px`;
  if (o.tipo === "imagem") d.innerHTML = `<img src="${o.src ?? ""}" alt="" />`;
  if (o.tipo === "forma") d.innerHTML = svgForma(o);
  if (o.tipo === "texto" || (o.tipo === "forma" && o.html)) {
    const tx = el("div", { class: "ap-txt" });
    tx.innerHTML = o.html ?? "";
    const titulo = o.papel === "titulo";
    tx.style.cssText = `font-size:${o.tam ?? 28}px;color:${o.cor ?? (titulo ? t.titulo : o.tipo === "forma" ? "#fff" : t.texto)};text-align:${o.alinhar ?? (o.tipo === "forma" ? "center" : "left")};
      font-family:${titulo ? t.fonteTitulo : t.fonteCorpo};font-weight:${o.negrito ? 700 : 400};display:flex;flex-direction:column;justify-content:${o.vertical ?? (o.tipo === "forma" ? "center" : "start")};position:relative`;
    d.append(tx);
    if (editavel && !(o.html ?? "").replace(/<[^>]+>/g, "").trim()) {
      d.classList.add("vazio");
      tx.dataset.dica = o.papel === "titulo" ? "Clique duas vezes para adicionar um título" : o.papel === "subtitulo" ? "Subtítulo" : o.papel === "corpo" ? "Clique duas vezes para adicionar texto" : "";
    }
    if (editavel && o.papel) d.classList.add("reserva");
  }
  return d;
}

/** Monta o slide (sem alças). `vazios`: mostra os espaços reservados vazios. */
function montarSlide(s: Slide, editavel: boolean): HTMLDivElement {
  const t = TEMAS[doc.tema];
  const raiz = el("div", { class: "ap-slide" });
  raiz.style.width = `${largura()}px`;
  raiz.style.background = s.fundo ?? t.fundo;
  raiz.style.setProperty("--ap-texto", t.texto);
  raiz.style.setProperty("--ap-fonte-corpo", t.fonteCorpo);
  if (t.faixa && s.layout !== "branco") raiz.insertAdjacentHTML("beforeend", `<div style="position:absolute;left:0;top:0;bottom:0;width:14px;background:${t.faixa}"></div>`);
  for (const o of s.objetos) {
    if (!editavel && o.papel && !(o.html ?? "").replace(/<[^>]+>/g, "").trim()) continue;
    raiz.append(elementoObjeto(o, editavel));
  }
  return raiz;
}

// ---------- palco (edição) ----------

let escala = 1;

function renderizarPalco() {
  const novo = montarSlide(slide(), true);
  novo.id = "ap-palco";
  novo.classList.add("ap-editavel");
  palcoRef.replaceWith(novo);
  palcoRef = novo;
  ajustarEscala();
  for (const d of novo.querySelectorAll<HTMLElement>(".ap-obj")) {
    if (selecionados.includes(d.dataset.id!)) d.classList.add("sel");
    if (d.dataset.id === editando) iniciarEdicaoEl(d);
  }
  desenharAlcas();
  notas.value = slide().notas;
}
let palcoRef: HTMLDivElement = palco;

function ajustarEscala() {
  const W = largura();
  const ew = palcoArea.clientWidth - 40, eh = palcoArea.clientHeight - 40;
  escala = Math.max(0.1, Math.min(ew / W, eh / ALTURA));
  palcoRef.style.transform = `translate(-50%, -50%) scale(${escala})`;
  desenharAlcas();
}
new ResizeObserver(ajustarEscala).observe(palcoArea);

function desenharAlcas() {
  palcoArea.querySelectorAll(".ap-alca").forEach((a) => a.remove());
  const o = objSel();
  if (!o || editando || selecionados.length !== 1) return;
  const r = palcoRef.getBoundingClientRect(), base = palcoArea.getBoundingClientRect();
  const px = (x: number) => r.left - base.left + x * escala, py = (y: number) => r.top - base.top + y * escala;
  const pontos: [string, number, number][] = o.forma === "linha"
    ? [["w", o.x, o.y + o.h / 2], ["e", o.x + o.w, o.y + o.h / 2]]
    : [["nw", o.x, o.y], ["n", o.x + o.w / 2, o.y], ["ne", o.x + o.w, o.y], ["e", o.x + o.w, o.y + o.h / 2], ["se", o.x + o.w, o.y + o.h], ["s", o.x + o.w / 2, o.y + o.h], ["sw", o.x, o.y + o.h], ["w", o.x, o.y + o.h / 2]];
  for (const [k, x, y] of pontos) {
    const a = el("div", { class: "ap-alca", "data-k": k });
    a.style.left = `${px(x)}px`;
    a.style.top = `${py(y)}px`;
    a.style.cursor = `${k}-resize`;
    a.addEventListener("pointerdown", (e) => redimensionar(e, k));
    palcoArea.append(a);
  }
}

/** Ponto do evento em coordenadas do slide. */
function noSlide(e: PointerEvent | MouseEvent) {
  const r = palcoRef.getBoundingClientRect();
  return { x: (e.clientX - r.left) / escala, y: (e.clientY - r.top) / escala };
}

function redimensionar(e: PointerEvent, k: string) {
  e.preventDefault();
  e.stopPropagation();
  const o = objSel();
  if (!o) return;
  const ini = { ...o }, p0 = noSlide(e);
  // captura na área (as alças são recriadas a cada movimento)
  const alvo = palcoArea;
  alvo.setPointerCapture(e.pointerId);
  const mover = (ev: PointerEvent) => {
    const p = noSlide(ev);
    const dx = p.x - p0.x, dy = p.y - p0.y;
    let { x, y, w, h } = ini;
    if (k.includes("e")) w = Math.max(10, ini.w + dx);
    if (k.includes("s")) h = Math.max(10, ini.h + dy);
    if (k.includes("w")) {
      w = Math.max(10, ini.w - dx);
      x = ini.x + ini.w - w;
    }
    if (k.includes("n")) {
      h = Math.max(10, ini.h - dy);
      y = ini.y + ini.h - h;
    }
    // Shift (ou imagem) mantém a proporção pelos cantos
    if ((ev.shiftKey || o.tipo === "imagem") && k.length === 2) {
      const prop = ini.w / ini.h;
      h = w / prop;
      if (k.includes("n")) y = ini.y + ini.h - h;
    }
    Object.assign(o, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    const d = palcoRef.querySelector<HTMLElement>(`[data-id="${o.id}"]`)!;
    d.style.cssText = `left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px`;
    if (o.tipo === "forma") d.querySelector("svg")!.outerHTML = svgForma(o);
    desenharAlcas();
  };
  const fim = () => {
    alvo.removeEventListener("pointermove", mover);
    alvo.removeEventListener("pointerup", fim);
    mudou(true);
  };
  alvo.addEventListener("pointermove", mover);
  alvo.addEventListener("pointerup", fim);
}

palcoArea.addEventListener("pointerdown", (e) => {
  if ((e.target as HTMLElement).classList.contains("ap-alca")) return;
  const d = (e.target as HTMLElement).closest<HTMLElement>(".ap-obj");
  if (d && d.dataset.id === editando) return; // clicando dentro do texto em edição
  if (editando) terminarEdicao();
  if (!d || !palcoRef.contains(d)) {
    selecionados = [];
    renderizarPalco();
    casca.renderizar();
    return;
  }
  const oid = d.dataset.id!;
  if (e.shiftKey || e.ctrlKey) selecionados = selecionados.includes(oid) ? selecionados.filter((x) => x !== oid) : [...selecionados, oid];
  else if (!selecionados.includes(oid)) selecionados = [oid];
  palcoRef.querySelectorAll(".ap-obj").forEach((x) => x.classList.toggle("sel", selecionados.includes((x as HTMLElement).dataset.id!)));
  desenharAlcas();
  casca.renderizar();
  // arrastar move os selecionados
  e.preventDefault();
  const p0 = noSlide(e);
  const ini = slide().objetos.filter((o) => selecionados.includes(o.id)).map((o) => ({ o, x: o.x, y: o.y }));
  let moveu = false;
  const mover = (ev: PointerEvent) => {
    const p = noSlide(ev);
    const dx = p.x - p0.x, dy = p.y - p0.y;
    if (!moveu && Math.hypot(dx, dy) < 3) return;
    // captura só ao arrastar: capturar no toque faria o duplo clique cair na área e não no objeto
    if (!moveu) palcoArea.setPointerCapture(ev.pointerId);
    moveu = true;
    for (const { o, x, y } of ini) {
      // encaixe no centro do slide
      let nx = Math.round(x + dx), ny = Math.round(y + dy);
      if (ini.length === 1) {
        if (Math.abs(nx + o.w / 2 - largura() / 2) < 8) nx = Math.round(largura() / 2 - o.w / 2);
        if (Math.abs(ny + o.h / 2 - ALTURA / 2) < 8) ny = Math.round(ALTURA / 2 - o.h / 2);
      }
      o.x = nx;
      o.y = ny;
      const el2 = palcoRef.querySelector<HTMLElement>(`[data-id="${o.id}"]`)!;
      el2.style.left = `${o.x}px`;
      el2.style.top = `${o.y}px`;
    }
    desenharAlcas();
  };
  const fim = () => {
    palcoArea.removeEventListener("pointermove", mover);
    palcoArea.removeEventListener("pointerup", fim);
    if (moveu) mudou(true);
  };
  palcoArea.addEventListener("pointermove", mover);
  palcoArea.addEventListener("pointerup", fim);
});

palcoArea.addEventListener("dblclick", (e) => {
  const d = (e.target as HTMLElement).closest<HTMLElement>(".ap-obj");
  if (!d) return;
  const o = slide().objetos.find((x) => x.id === d.dataset.id);
  if (!o || o.tipo === "imagem") return;
  editando = o.id;
  selecionados = [o.id];
  if (o.tipo === "forma" && !palcoRef.querySelector(`[data-id="${o.id}"] .ap-txt`)) {
    o.html = "";
    renderizarPalco();
  } else {
    iniciarEdicaoEl(d);
    desenharAlcas();
  }
});

palcoArea.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const d = (e.target as HTMLElement).closest<HTMLElement>(".ap-obj");
  if (d && !selecionados.includes(d.dataset.id!)) {
    selecionados = [d.dataset.id!];
    renderizarPalco();
  }
  menu(e.clientX, e.clientY, selecionados.length ? [
    { rotulo: "Recortar", icone: "recortar", acao: () => (copiarObjetos(), excluirObjetos()) },
    { rotulo: "Copiar", icone: "copiar", acao: copiarObjetos },
    { rotulo: "Colar", icone: "colar", acao: colarObjetos },
    { rotulo: "Duplicar", icone: "duplicar", acao: duplicarObjetos },
    "-",
    { rotulo: "Trazer para a frente", icone: "frente", acao: () => ordem(1) },
    { rotulo: "Enviar para trás", icone: "tras", acao: () => ordem(-1) },
    { rotulo: "Centralizar no slide", icone: "alinharCentro", acao: centralizar },
    "-",
    { rotulo: "Excluir", icone: "apagar", acao: excluirObjetos },
  ] : [
    { rotulo: "Colar", icone: "colar", acao: colarObjetos },
    { rotulo: "Novo slide", icone: "slide", acao: () => novoSlide("tituloConteudo") },
    { rotulo: "Cor do plano de fundo…", icone: "corFundo", acao: corFundo },
  ]);
});

function iniciarEdicaoEl(d: HTMLElement) {
  d.classList.add("editando");
  d.classList.remove("vazio");
  const tx = d.querySelector<HTMLElement>(".ap-txt");
  if (!tx) return;
  tx.contentEditable = "true";
  tx.focus();
  const r = document.createRange();
  r.selectNodeContents(tx);
  r.collapse(false);
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(r);
  tx.oninput = () => {
    const o = slide().objetos.find((x) => x.id === d.dataset.id);
    if (o) o.html = tx.innerHTML;
    mudou(false);
  };
  tx.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      terminarEdicao();
    }
  };
}

function terminarEdicao() {
  if (!editando) return;
  const tx = palcoRef.querySelector<HTMLElement>(`[data-id="${editando}"] .ap-txt`);
  const o = slide().objetos.find((x) => x.id === editando);
  if (tx && o) o.html = tx.innerHTML === "<br>" ? "" : tx.innerHTML;
  editando = null;
  mudou(true);
}

// ---------- objetos ----------

let area: Obj[] = [];
const copiarObjetos = () => (area = slide().objetos.filter((o) => selecionados.includes(o.id)).map((o) => JSON.parse(JSON.stringify(o))));
function colarObjetos() {
  if (!area.length) return;
  const novos = area.map((o) => ({ ...JSON.parse(JSON.stringify(o)), id: id(), x: o.x + 20, y: o.y + 20, papel: undefined }));
  slide().objetos.push(...novos);
  selecionados = novos.map((o) => o.id);
  area = novos;
  mudou(true);
}
function duplicarObjetos() {
  copiarObjetos();
  colarObjetos();
}
function excluirObjetos() {
  slide().objetos = slide().objetos.filter((o) => !selecionados.includes(o.id));
  selecionados = [];
  mudou(true);
}
function ordem(d: 1 | -1) {
  const ob = slide().objetos;
  const sel = ob.filter((o) => selecionados.includes(o.id)), resto = ob.filter((o) => !selecionados.includes(o.id));
  slide().objetos = d > 0 ? [...resto, ...sel] : [...sel, ...resto];
  mudou(true);
}
function centralizar() {
  for (const o of slide().objetos) if (selecionados.includes(o.id)) {
    o.x = Math.round(largura() / 2 - o.w / 2);
    o.y = Math.round(ALTURA / 2 - o.h / 2);
  }
  mudou(true);
}
function inserirObjeto(o: Omit<Obj, "id">) {
  const n = { id: id(), ...o } as Obj;
  // em cascata: não esconde um objeto inserido antes no mesmo lugar
  while (slide().objetos.some((x) => x.x === n.x && x.y === n.y)) (n.x += 24), (n.y += 24);
  slide().objetos.push(n);
  selecionados = [n.id];
  mudou(true);
  return n;
}
function inserirTexto() {
  const n = inserirObjeto({ tipo: "texto", x: largura() / 2 - 260, y: 300, w: 520, h: 90, html: "", tam: 28 });
  editando = n.id;
  renderizarPalco();
}
function inserirForma(forma: TipoForma) {
  inserirObjeto({ tipo: "forma", forma, x: largura() / 2 - 150, y: 260, w: forma === "linha" ? 400 : 300, h: forma === "linha" ? 20 : 200, espessura: forma === "linha" ? 4 : 0 });
}
async function inserirImagem() {
  const a = await escolherArquivo(true);
  if (!a?.dados) return;
  const tipo = a.tipo || "image/png";
  if (!/^image\//.test(tipo)) return casca.avisar("Escolha uma imagem (PNG, JPG, GIF, WebP ou SVG).");
  const src = `data:${tipo};base64,${btoa(new Uint8Array(a.dados).reduce((s, x) => s + String.fromCharCode(x), ""))}`;
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 600 / img.width, 450 / img.height);
    inserirObjeto({ tipo: "imagem", src, x: Math.round(largura() / 2 - (img.width * k) / 2), y: Math.round(ALTURA / 2 - (img.height * k) / 2), w: Math.round(img.width * k), h: Math.round(img.height * k) });
  };
  img.src = src;
}

/** Formatação do texto: no trecho em edição (execCommand) ou na caixa inteira selecionada. */
function formatarTexto(cmd: string, campo?: keyof Obj, valor?: unknown) {
  if (editando) {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(cmd, false, typeof valor === "string" ? valor : undefined);
    const tx = palcoRef.querySelector<HTMLElement>(`[data-id="${editando}"] .ap-txt`);
    const o = slide().objetos.find((x) => x.id === editando);
    if (tx && o) o.html = tx.innerHTML;
    mudou(false);
    return;
  }
  if (!campo) return;
  for (const o of slide().objetos) if (selecionados.includes(o.id)) (o as unknown as Record<string, unknown>)[campo] = typeof valor === "function" ? (valor as (x: unknown) => unknown)((o as unknown as Record<string, unknown>)[campo]) : valor;
  mudou(true);
}

// ---------- slides ----------

function novoSlide(layout: string) {
  const s = slideDoLayout(layout);
  doc.slides.splice(atual + 1, 0, s);
  irPara(atual + 1);
  mudou(true);
}
function duplicarSlide(i = atual) {
  const c: Slide = JSON.parse(JSON.stringify(doc.slides[i]));
  c.id = id();
  c.objetos.forEach((o) => (o.id = id()));
  doc.slides.splice(i + 1, 0, c);
  irPara(i + 1);
  mudou(true);
}
function excluirSlide(i = atual) {
  if (doc.slides.length === 1) return casca.avisar("A apresentação precisa de pelo menos um slide.");
  doc.slides.splice(i, 1);
  irPara(Math.min(atual, doc.slides.length - 1));
  mudou(true);
}
function moverSlide(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= doc.slides.length) return;
  const [s] = doc.slides.splice(i, 1);
  doc.slides.splice(j, 0, s);
  irPara(j);
  mudou(true);
}
function irPara(i: number) {
  if (editando) terminarEdicao();
  atual = Math.max(0, Math.min(doc.slides.length - 1, i));
  selecionados = [];
  renderizarPalco();
  renderizarMiniaturas();
  casca.renderizar();
  atualizarStatus();
}

function renderizarMiniaturas() {
  const lista = $("#ap-miniaturas");
  lista.innerHTML = "";
  doc.slides.forEach((s, i) => {
    const m = el("div", { class: `ap-mini${i === atual ? " sel" : ""}${s.oculto ? " oculto" : ""}`, draggable: "true" });
    const q = el("div", { class: "ap-mini-quadro" });
    q.style.aspectRatio = doc.proporcao === "4:3" ? "4 / 3" : "16 / 9";
    const sl = montarSlide(s, false);
    q.append(sl);
    m.append(el("b", {}, String(i + 1)), q);
    m.onclick = () => irPara(i);
    m.oncontextmenu = (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY, [
        { rotulo: "Novo slide", icone: "slide", acao: () => ((atual = i), novoSlide("tituloConteudo")) },
        { rotulo: "Duplicar slide", icone: "duplicar", acao: () => duplicarSlide(i) },
        { rotulo: s.oculto ? "Mostrar slide" : "Ocultar slide", icone: "olho" in {} ? "slide" : "slide", acao: () => ((s.oculto = !s.oculto), mudou(true)) },
        { rotulo: "Mover para cima", acao: () => moverSlide(i, -1) },
        { rotulo: "Mover para baixo", acao: () => moverSlide(i, 1) },
        "-",
        { rotulo: "Excluir slide", icone: "apagar", acao: () => excluirSlide(i) },
      ]);
    };
    m.ondragstart = (e) => e.dataTransfer?.setData("text/plain", String(i));
    m.ondragover = (e) => e.preventDefault();
    m.ondrop = (e) => {
      e.preventDefault();
      const de = Number(e.dataTransfer?.getData("text/plain"));
      if (Number.isFinite(de) && de !== i) moverSlide(de, i - de);
    };
    lista.append(m);
    requestAnimationFrame(() => (sl.style.transform = `scale(${q.clientWidth / largura()})`));
  });
  const mais = el("button", { class: "ap-mini-mais" }, "+ Novo slide");
  mais.onclick = () => novoSlide("tituloConteudo");
  lista.append(mais);
}

// ---------- alterações ----------

let tMini = 0;
function mudou(registrar: boolean) {
  if (registrar) historico.registrar(doc);
  autosave.guardar(CHAVE, doc);
  if (registrar) renderizarPalco();
  clearTimeout(tMini);
  tMini = window.setTimeout(renderizarMiniaturas, registrar ? 0 : 400);
  casca.renderizar();
}

notas.addEventListener("input", () => {
  slide().notas = notas.value;
  mudou(false);
});

function atualizarStatus() {
  casca.definirStatus(`Slide ${atual + 1} de ${doc.slides.length} · tema ${TEMAS[doc.tema].nome}`);
  casca.statusDireita.innerHTML = `<span>${doc.proporcao}</span><span>${Math.round(escala * 100)}%</span>`;
}

function corFundo() {
  const inp = el("input", { type: "color" }) as HTMLInputElement;
  inp.value = slide().fundo ?? TEMAS[doc.tema].fundo;
  inp.style.cssText = "position:fixed;opacity:0";
  document.body.append(inp);
  inp.oninput = () => {
    slide().fundo = inp.value;
    mudou(false);
    renderizarPalco();
  };
  inp.onchange = () => {
    inp.remove();
    mudou(true);
  };
  inp.click();
}

function escolherTema() {
  const { corpo, fechar } = janela("Temas", `<div class="ap-temas">${Object.entries(TEMAS).map(([k, t]) =>
    `<button class="ap-tema ${k === doc.tema ? "sel" : ""}" data-t="${k}" style="background:${t.fundo};color:${t.texto};font-family:${t.fonteCorpo};${t.faixa ? `border-left:10px solid ${t.faixa}` : ""}">
      <b style="color:${t.titulo};font-family:${t.fonteTitulo}">${t.nome}</b><span>Texto do slide</span><span style="color:${t.destaque}">■ destaque</span></button>`).join("")}</div>`, [{ rotulo: "Fechar" }], true);
  for (const b of corpo.querySelectorAll<HTMLElement>("[data-t]")) {
    b.onclick = () => {
      doc.tema = b.dataset.t!;
      mudou(true);
      renderizarMiniaturas();
      atualizarStatus();
      fechar();
    };
  }
}

// ---------- apresentação ----------

interface Estado {
  i: number;
  passo: number;
}

/** Objetos com animação, em ordem: cada clique revela o próximo. */
const animados = (s: Slide) => s.objetos.filter((o) => o.anim && o.anim !== "nenhuma");
const visiveis = () => doc.slides.map((s, i) => [s, i] as const).filter(([s]) => !s.oculto).map(([, i]) => i);

function apresentar(deAtual: boolean) {
  if (editando) terminarEdicao();
  const ordem = visiveis();
  if (!ordem.length) return casca.avisar("Todos os slides estão ocultos.");
  const est: Estado = { i: deAtual ? Math.max(0, ordem.indexOf(atual)) : 0, passo: 0 };
  const show = $("#ap-show");
  show.hidden = false;
  show.requestFullscreen?.().catch(() => {});
  let tela: "" | "preta" | "branca" = "";
  let cursorT = 0;
  const desenhar = (transicao: boolean) => {
    const s = doc.slides[ordem[est.i]];
    show.innerHTML = "";
    const sl = montarSlide(s, false);
    const k = Math.min(innerWidth / largura(), innerHeight / ALTURA);
    sl.style.transform = `translate(-50%, -50%) scale(${k})`;
    const an = animados(s);
    an.forEach((o, j) => {
      const d = sl.querySelector<HTMLElement>(`[data-id="${o.id}"]`);
      if (!d) return;
      if (j >= est.passo) d.classList.add("ap-oculto");
      else if (j === est.passo - 1 && o.anim !== "aparecer") d.classList.add(`ap-anim-${o.anim}`);
    });
    const caixa = el("div");
    caixa.style.cssText = "position:absolute;inset:0;overflow:hidden";
    caixa.append(sl);
    if (transicao && s.transicao && s.transicao !== "nenhuma") caixa.classList.add(`ap-trans-${s.transicao}`);
    show.append(caixa);
    show.insertAdjacentHTML("beforeend", `<div class="ap-tela ${tela}"></div><div class="ap-controles"><button data-c="ant">◀</button><button data-c="prox">▶</button><button data-c="sair">Sair</button><span style="color:#fff;align-self:center;font-size:14px">${est.i + 1} / ${ordem.length}</span></div>`);
    show.querySelector<HTMLElement>('[data-c="ant"]')!.onclick = (e) => (e.stopPropagation(), voltar());
    show.querySelector<HTMLElement>('[data-c="prox"]')!.onclick = (e) => (e.stopPropagation(), avancar());
    show.querySelector<HTMLElement>('[data-c="sair"]')!.onclick = (e) => (e.stopPropagation(), sair());
  };
  const avancar = () => {
    const s = doc.slides[ordem[est.i]];
    if (est.passo < animados(s).length) {
      est.passo++;
      desenhar(false);
    } else if (est.i < ordem.length - 1) {
      est.i++;
      est.passo = 0;
      desenhar(true);
    } else sair();
  };
  const voltar = () => {
    if (est.passo > 0) {
      est.passo--;
      desenhar(false);
    } else if (est.i > 0) {
      est.i--;
      est.passo = animados(doc.slides[ordem[est.i]]).length;
      desenhar(false);
    }
  };
  let numero = "";
  const tecla = (e: KeyboardEvent) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"].includes(e.key) && !numero) {
      e.preventDefault();
      avancar();
    } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(e.key)) {
      e.preventDefault();
      voltar();
    } else if (e.key === "Escape") sair();
    else if (e.key === "b" || e.key === "B" || e.key === ".") {
      tela = tela === "preta" ? "" : "preta";
      desenhar(false);
    } else if (e.key === "w" || e.key === "W" || e.key === ",") {
      tela = tela === "branca" ? "" : "branca";
      desenhar(false);
    } else if (/^\d$/.test(e.key)) numero += e.key;
    else if (e.key === "Enter" && numero) {
      est.i = Math.max(0, Math.min(ordem.length - 1, Number(numero) - 1));
      est.passo = 0;
      numero = "";
      desenhar(true);
    }
  };
  const clique = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".ap-controles")) return;
    avancar();
  };
  const mexeu = () => {
    show.classList.add("com-cursor");
    clearTimeout(cursorT);
    cursorT = window.setTimeout(() => show.classList.remove("com-cursor"), 2000);
  };
  // toque: deslizar para os lados troca de slide
  let x0 = 0;
  const tIni = (e: TouchEvent) => (x0 = e.touches[0].clientX);
  const tFim = (e: TouchEvent) => {
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) {
      e.preventDefault();
      if (dx < 0) avancar();
      else voltar();
    }
  };
  const sair = () => {
    document.removeEventListener("keydown", tecla, true);
    show.removeEventListener("click", clique);
    show.removeEventListener("mousemove", mexeu);
    show.removeEventListener("touchstart", tIni);
    show.removeEventListener("touchend", tFim);
    show.hidden = true;
    show.innerHTML = "";
    if (document.fullscreenElement) void document.exitFullscreen();
    irPara(ordem[est.i]);
  };
  document.addEventListener("keydown", tecla, true);
  show.addEventListener("click", clique);
  show.addEventListener("mousemove", mexeu);
  show.addEventListener("touchstart", tIni, { passive: true });
  show.addEventListener("touchend", tFim);
  addEventListener("resize", () => !show.hidden && desenhar(false), { once: true });
  desenhar(true);
}

/** Modo do apresentador: slide atual, próximo, notas, cronômetro (numa tela só). */
function modoApresentador() {
  if (editando) terminarEdicao();
  const ordem = visiveis();
  let i = Math.max(0, ordem.indexOf(atual));
  const raiz = el("div", { class: "ap-apresentador" });
  document.body.append(raiz);
  raiz.requestFullscreen?.().catch(() => {});
  const inicio = Date.now();
  const desenhar = () => {
    const s = doc.slides[ordem[i]], prox = doc.slides[ordem[i + 1]];
    raiz.innerHTML = `<header><span class="relogio" data-r>00:00</span><span>Slide ${i + 1} de ${ordem.length}</span><span style="margin-left:auto;opacity:.7">${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></header>
      <div class="quadro" data-q></div>
      <div class="lado"><div><div style="margin-bottom:6px;opacity:.7">Próximo</div><div class="proximo" data-p></div></div><div class="notas-ap">${escapar(s.notas || "(sem anotações)")}</div></div>
      <footer><button data-c="ant">◀ Anterior</button><button data-c="prox">Próximo ▶</button><button data-c="sair" style="margin-left:auto">Encerrar</button></footer>`;
    const q = raiz.querySelector<HTMLElement>("[data-q]")!;
    const sl = montarSlide(s, false);
    q.append(sl);
    requestAnimationFrame(() => (sl.style.transform = `translate(-50%, -50%) scale(${Math.min(q.clientWidth / largura(), q.clientHeight / ALTURA)})`));
    const p = raiz.querySelector<HTMLElement>("[data-p]")!;
    if (prox) {
      const sp = montarSlide(prox, false);
      p.append(sp);
      requestAnimationFrame(() => (sp.style.transform = `scale(${p.clientWidth / largura()})`));
    } else p.innerHTML = `<div style="color:#fff;display:grid;place-items:center;height:100%">Fim da apresentação</div>`;
    raiz.querySelector<HTMLElement>('[data-c="ant"]')!.onclick = () => ir(-1);
    raiz.querySelector<HTMLElement>('[data-c="prox"]')!.onclick = () => ir(1);
    raiz.querySelector<HTMLElement>('[data-c="sair"]')!.onclick = sair;
  };
  const ir = (d: number) => {
    i = Math.max(0, Math.min(ordem.length - 1, i + d));
    desenhar();
  };
  const tic = setInterval(() => {
    const s = Math.floor((Date.now() - inicio) / 1000);
    const r = raiz.querySelector("[data-r]");
    if (r) r.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
  const tecla = (e: KeyboardEvent) => {
    if (["ArrowRight", "PageDown", " "].includes(e.key)) ir(1);
    else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) ir(-1);
    else if (e.key === "Escape") sair();
  };
  const sair = () => {
    clearInterval(tic);
    document.removeEventListener("keydown", tecla, true);
    raiz.remove();
    if (document.fullscreenElement) void document.exitFullscreen();
    irPara(ordem[i]);
  };
  document.addEventListener("keydown", tecla, true);
  desenhar();
}

function imprimir() {
  const alvo = $("#ap-impressao");
  alvo.innerHTML = "";
  for (const s of doc.slides) if (!s.oculto) alvo.append(montarSlide(s, false));
  window.print();
}

// ---------- arquivos ----------

function carregar(d: Apresentacao) {
  doc = d;
  atual = 0;
  selecionados = [];
  editando = null;
  historico.limpar(doc);
  autosave.guardar(CHAVE, doc);
  irPara(0);
}
function novo() {
  if (doc.slides.length > 1 && !confirm("Começar uma apresentação nova? (salve antes se quiser guardar esta)")) return;
  carregar(docVazio());
}
async function abrir() {
  const a = await escolherArquivo();
  if (!a?.texto) return;
  try {
    carregar(validar(JSON.parse(a.texto)));
  } catch (e) {
    casca.avisar((e as Error).message || "Não foi possível abrir o arquivo.");
  }
}
function salvar() {
  if (editando) terminarEdicao();
  baixar(JSON.stringify(doc), doc.nome, "wjapn");
  casca.avisar("Apresentação salva (.wjapn).");
}

// ---------- faixa de comandos ----------

const temSel = () => selecionados.length > 0;
const TAM: [string, string][] = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 60, 72, 96].map((x) => [String(x), String(x)]);
const ANIMS: [Anim, string][] = [["nenhuma", "Nenhuma"], ["aparecer", "Aparecer"], ["esmaecer", "Esmaecer"], ["voar", "Voar para dentro"], ["zoom", "Zoom"]];
const TRANS: [Transicao, string][] = [["nenhuma", "Nenhuma"], ["esmaecer", "Esmaecer"], ["empurrar", "Empurrar"], ["zoom", "Zoom"]];

const abas: Aba[] = [
  {
    id: "inicio", rotulo: "Início", grupos: [
      [
        { id: "novo", rotulo: "Novo slide", icone: "slide", acao: () => novoSlide("tituloConteudo") },
        { id: "layout", rotulo: "Layout", opcoes: () => Object.entries(LAYOUTS), valor: () => slide().layout, aoMudar: (v) => {
          // troca o layout mantendo o texto dos espaços reservados
          const novo = slideDoLayout(v);
          const antigos = slide().objetos.filter((o) => o.papel);
          for (const o of novo.objetos) {
            const a = antigos.find((x) => x.papel === o.papel && x.html);
            if (a) {
              o.html = a.html;
              antigos.splice(antigos.indexOf(a), 1);
            }
          }
          slide().layout = v;
          slide().objetos = [...novo.objetos, ...slide().objetos.filter((o) => !o.papel)];
          mudou(true);
        } },
        { id: "dup", rotulo: "Duplicar", icone: "duplicar", peq: true, acao: () => duplicarSlide() },
        { id: "exc", rotulo: "Excluir slide", icone: "apagar", peq: true, acao: () => excluirSlide() },
      ],
      [
        { id: "tam", rotulo: "Tamanho do texto", opcoes: () => TAM, valor: () => String(objSel()?.tam ?? 28), aoMudar: (v) => formatarTexto("fontSize", "tam", Number(v)) },
        { id: "n", rotulo: "Negrito", icone: "negrito", peq: true, ativo: () => !!objSel()?.negrito, acao: () => (editando ? formatarTexto("bold") : formatarTexto("", "negrito", (x: unknown) => !x)) },
        { id: "i", rotulo: "Itálico", icone: "italico", peq: true, acao: () => formatarTexto("italic") },
        { id: "s", rotulo: "Sublinhado", icone: "sublinhado", peq: true, acao: () => formatarTexto("underline") },
        { id: "cor", rotulo: "Cor do texto", icone: "corTexto", peq: true, cor: { valor: () => objSel()?.cor ?? TEMAS[doc.tema].texto, aoMudar: (v) => (editando ? formatarTexto("foreColor", "cor", v) : formatarTexto("", "cor", v)) } },
        { id: "marcas", rotulo: "Marcadores", icone: "listaMarcas", peq: true, acao: () => formatarTexto("insertUnorderedList") },
        { id: "nums", rotulo: "Numeração", icone: "listaNumeros", peq: true, acao: () => formatarTexto("insertOrderedList") },
        { id: "esq", rotulo: "Alinhar à esquerda", icone: "alinharEsq", peq: true, ativo: () => objSel()?.alinhar === "left", acao: () => formatarTexto("", "alinhar", "left") },
        { id: "cen", rotulo: "Centralizar", icone: "alinharCentro", peq: true, ativo: () => objSel()?.alinhar === "center", acao: () => formatarTexto("", "alinhar", "center") },
        { id: "dir", rotulo: "Alinhar à direita", icone: "alinharDir", peq: true, ativo: () => objSel()?.alinhar === "right", acao: () => formatarTexto("", "alinhar", "right") },
      ],
      [
        { id: "preench", rotulo: "Preenchimento da forma", icone: "corFundo", peq: true, desabilitado: () => objSel()?.tipo !== "forma", cor: { valor: () => objSel()?.preenchimento ?? TEMAS[doc.tema].destaque, aoMudar: (v) => formatarTexto("", "preenchimento", v) } },
        { id: "contorno", rotulo: "Contorno da forma", icone: "borda", peq: true, desabilitado: () => objSel()?.tipo !== "forma", cor: { valor: () => objSel()?.contorno ?? "#1e2730", aoMudar: (v) => {
          for (const o of slide().objetos) if (selecionados.includes(o.id)) {
            o.contorno = v;
            o.espessura ||= 3;
          }
          mudou(true);
        } } },
        { id: "frente", rotulo: "Trazer para a frente", icone: "frente", peq: true, desabilitado: () => !temSel(), acao: () => ordem(1) },
        { id: "tras", rotulo: "Enviar para trás", icone: "tras", peq: true, desabilitado: () => !temSel(), acao: () => ordem(-1) },
      ],
    ],
  },
  {
    id: "inserir", rotulo: "Inserir", grupos: [
      [
        { id: "slide", rotulo: "Novo slide", icone: "slide", acao: () => novoSlide("tituloConteudo") },
        { id: "texto", rotulo: "Caixa de texto", icone: "caixaTexto", acao: inserirTexto },
        { id: "imagem", rotulo: "Imagem", icone: "imagem", acao: () => void inserirImagem() },
      ],
      [
        { id: "ret", rotulo: "Retângulo", icone: "forma", acao: () => inserirForma("retangulo") },
        { id: "arr", rotulo: "Arredondado", icone: "forma", acao: () => inserirForma("arredondado") },
        { id: "eli", rotulo: "Elipse", icone: "forma", acao: () => inserirForma("elipse") },
        { id: "tri", rotulo: "Triângulo", icone: "forma", acao: () => inserirForma("triangulo") },
        { id: "seta", rotulo: "Seta", icone: "forma", acao: () => inserirForma("seta") },
        { id: "est", rotulo: "Estrela", icone: "forma", acao: () => inserirForma("estrela") },
        { id: "lin", rotulo: "Linha", icone: "linhaHorizontal", acao: () => inserirForma("linha") },
      ],
    ],
  },
  {
    id: "design", rotulo: "Design", grupos: [
      [
        { id: "temas", rotulo: "Temas", icone: "tema", acao: escolherTema },
        { id: "fundo", rotulo: "Plano de fundo", icone: "corFundo", acao: corFundo },
        { id: "prop", rotulo: "Tamanho do slide", opcoes: () => [["16:9", "Widescreen (16:9)"], ["4:3", "Padrão (4:3)"]], valor: () => doc.proporcao, aoMudar: (v) => {
          const de = largura();
          doc.proporcao = v as Apresentacao["proporcao"];
          const k = largura() / de;
          for (const s of doc.slides) for (const o of s.objetos) {
            o.x = Math.round(o.x * k);
            o.w = Math.round(o.w * k);
          }
          mudou(true);
          renderizarMiniaturas();
          atualizarStatus();
        } },
      ],
    ],
  },
  {
    id: "transicoes", rotulo: "Transições", grupos: [
      [
        { id: "trans", rotulo: "Transição deste slide", opcoes: () => TRANS, valor: () => slide().transicao ?? "nenhuma", aoMudar: (v) => ((slide().transicao = v as Transicao), mudou(true)) },
        { id: "todos", rotulo: "Aplicar a todos", icone: "transicao", acao: () => {
          for (const s of doc.slides) s.transicao = slide().transicao;
          mudou(true);
          casca.avisar("Transição aplicada a todos os slides.");
        } },
      ],
    ],
  },
  {
    id: "animacoes", rotulo: "Animações", grupos: [
      [
        { id: "anim", rotulo: "Animação do objeto", opcoes: () => ANIMS, valor: () => objSel()?.anim ?? "nenhuma", aoMudar: (v) => {
          if (!temSel()) return casca.avisar("Selecione um objeto do slide.");
          for (const o of slide().objetos) if (selecionados.includes(o.id)) o.anim = v as Anim;
          mudou(true);
        } },
        { id: "info", rotulo: "Ordem", icone: "listaNumeros", dica: "As animações entram na ordem dos objetos no slide (Trazer para a frente = depois)", acao: () => {
          const an = animados(slide());
          casca.avisar(an.length ? `Ordem: ${an.map((o, i) => `${i + 1}. ${(o.html ?? "").replace(/<[^>]+>/g, "").slice(0, 20) || o.forma || o.tipo}`).join(" · ")}` : "Nenhum objeto animado neste slide.", 6000);
        } },
      ],
    ],
  },
  {
    id: "apresentar", rotulo: "Apresentação", grupos: [
      [
        { id: "inicio", rotulo: "Do início", icone: "apresentar", dica: "Apresentar do início (F5)", acao: () => apresentar(false) },
        { id: "atual", rotulo: "Do slide atual", icone: "apresentar", dica: "Do slide atual (Shift+F5)", acao: () => apresentar(true) },
        { id: "apres", rotulo: "Modo do apresentador", icone: "slide", acao: modoApresentador },
      ],
      [
        { id: "ocultar", rotulo: "Ocultar slide", icone: "slide", ativo: () => !!slide().oculto, acao: () => ((slide().oculto = !slide().oculto), mudou(true)) },
        { id: "pdf", rotulo: "Imprimir / PDF", icone: "imprimir", acao: imprimir },
      ],
    ],
  },
];

const casca: Casca = new Casca({
  app: "WJApresentation",
  icone: "",
  extensao: "wjapn",
  abas,
  nomeDoc: () => doc.nome,
  renomear: (n) => ((doc.nome = n), mudou(false)),
  novo,
  abrir: () => void abrir(),
  salvar,
  desfazer: () => {
    if (editando) return void document.execCommand("undo");
    const d = historico.desfazer();
    if (d) {
      doc = d;
      atual = Math.min(atual, doc.slides.length - 1);
      selecionados = [];
      autosave.guardar(CHAVE, doc);
      renderizarPalco();
      renderizarMiniaturas();
    }
  },
  refazer: () => {
    if (editando) return void document.execCommand("redo");
    const d = historico.refazer();
    if (d) {
      doc = d;
      atual = Math.min(atual, doc.slides.length - 1);
      autosave.guardar(CHAVE, doc);
      renderizarPalco();
      renderizarMiniaturas();
    }
  },
  direita: [{ id: "apres", rotulo: "Apresentar", icone: "apresentar", dica: "Apresentar do início (F5)", acao: () => apresentar(false) }],
});

document.querySelector(".wj-comandos")!.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest("button")) e.preventDefault();
});

document.addEventListener("keydown", (e) => {
  if (!$("#ap-show").hidden || document.querySelector(".ap-apresentador")) return;
  const naEdicao = !!editando || (e.target as HTMLElement).closest("input, textarea, select");
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === "F5") {
    e.preventDefault();
    return apresentar(e.shiftKey);
  }
  if (naEdicao) return;
  if (ctrl && e.key.toLowerCase() === "z") {
    e.preventDefault();
    casca.o.desfazer!();
  } else if (ctrl && e.key.toLowerCase() === "y") {
    e.preventDefault();
    casca.o.refazer!();
  } else if (ctrl && e.key.toLowerCase() === "m") {
    e.preventDefault();
    novoSlide("tituloConteudo");
  } else if (ctrl && e.key.toLowerCase() === "d") {
    e.preventDefault();
    if (temSel()) duplicarObjetos();
    else duplicarSlide();
  } else if (ctrl && e.key.toLowerCase() === "c" && temSel()) copiarObjetos();
  else if (ctrl && e.key.toLowerCase() === "x" && temSel()) (copiarObjetos(), excluirObjetos());
  else if (ctrl && e.key.toLowerCase() === "v" && area.length) colarObjetos();
  else if ((e.key === "Delete" || e.key === "Backspace") && temSel()) {
    e.preventDefault();
    excluirObjetos();
  } else if (e.key.startsWith("Arrow") && temSel()) {
    e.preventDefault();
    const p = ctrl ? 1 : 10;
    const dx = e.key === "ArrowLeft" ? -p : e.key === "ArrowRight" ? p : 0, dy = e.key === "ArrowUp" ? -p : e.key === "ArrowDown" ? p : 0;
    for (const o of slide().objetos) if (selecionados.includes(o.id)) {
      o.x += dx;
      o.y += dy;
    }
    mudou(true);
  } else if ((e.key === "PageDown" || e.key === "ArrowDown") && !temSel()) irPara(atual + 1);
  else if ((e.key === "PageUp" || e.key === "ArrowUp") && !temSel()) irPara(atual - 1);
  else if (e.key === "Enter" && selecionados.length === 1) {
    const d = palcoRef.querySelector<HTMLElement>(`[data-id="${selecionados[0]}"]`);
    if (d && objSel()?.tipo !== "imagem") {
      e.preventDefault();
      editando = selecionados[0];
      iniciarEdicaoEl(d);
      desenharAlcas();
    }
  }
});

irPara(0);
registrarOffline();

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ap = { doc: () => doc, irPara };
