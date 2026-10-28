// WJWrite: processador de texto do WJProMaster (especificação: docs/global/documentos.md).
// v1: texto rico sobre contenteditable (estilos, listas, tabelas, imagens, links), página com
// tamanho/margens reais, cabeçalho e rodapé numerados na impressão, sumário, navegação,
// localizar/substituir, contagem de palavras, arquivos .wjdoc, HTML, Markdown e PDF (impressão).

import "./documento.css";
import { $, autosave, baixar, Casca, el, escapar, escolherArquivo, janela, menu, registrarOffline, type Aba, salvarArquivo } from "../comum/casca";

interface Pagina {
  tamanho: "A4" | "Carta" | "Oficio" | "A5";
  orientacao: "retrato" | "paisagem";
  margens: { sup: number; inf: number; esq: number; dir: number };
  cabecalho: string;
  rodape: string;
  numerar: boolean;
}
interface DocTexto {
  formato: "wjdoc";
  versao: 1;
  nome: string;
  html: string;
  pagina: Pagina;
}

const CHAVE = "wjdoc:documento";
const TAMANHOS: Record<Pagina["tamanho"], [number, number, string]> = {
  A4: [210, 297, "A4 (210 × 297 mm)"], Carta: [215.9, 279.4, "Carta (216 × 279 mm)"], Oficio: [215.9, 355.6, "Ofício (216 × 356 mm)"], A5: [148, 210, "A5 (148 × 210 mm)"],
};
const MM = 96 / 25.4;

const docVazio = (): DocTexto => ({
  formato: "wjdoc", versao: 1, nome: "Documento1",
  html: "<p><br></p>",
  pagina: { tamanho: "A4", orientacao: "retrato", margens: { sup: 25, inf: 20, esq: 30, dir: 20 }, cabecalho: "", rodape: "", numerar: true },
});

function validar(d: unknown): DocTexto {
  const x = d as DocTexto;
  if (!x || x.formato !== "wjdoc" || typeof x.html !== "string") throw new Error("Arquivo não é um documento do WJWrite (.wjdoc).");
  x.pagina = { ...docVazio().pagina, ...(x.pagina ?? {}) };
  return x;
}

let doc: DocTexto = (() => {
  try {
    const d = autosave.ler<DocTexto>(CHAVE);
    return d ? validar(d) : docVazio();
  } catch {
    return docVazio();
  }
})();

const texto = $<HTMLDivElement>("#dc-texto");
const papel = $<HTMLDivElement>("#dc-papel");
const rolagem = $<HTMLDivElement>("#dc-rolagem");
let zoom = 1;
let paginas = 1;

// ---------- segurança: HTML de fora (colar/abrir) sem scripts nem eventos ----------

function limparHTML(html: string): string {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button, textarea, select").forEach((e) => e.remove());
  d.body.querySelectorAll("*").forEach((e) => {
    for (const a of [...e.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || ((n === "href" || n === "src") && /^\s*javascript:/i.test(a.value)) || n === "contenteditable") e.removeAttribute(a.name);
    }
    // estilos de outros programas: fica só o essencial
    const st = (e as HTMLElement).style;
    if (st?.length) {
      const fica = ["font-weight", "font-style", "text-decoration", "color", "background-color", "text-align"].map((p) => [p, st.getPropertyValue(p)] as const).filter(([, v]) => v);
      e.removeAttribute("style");
      for (const [p, v] of fica) (e as HTMLElement).style.setProperty(p, v);
    }
    e.removeAttribute("class");
  });
  return d.body.innerHTML;
}

// ---------- página ----------

function aplicarPagina() {
  const p = doc.pagina;
  let [w, h] = TAMANHOS[p.tamanho];
  if (p.orientacao === "paisagem") [w, h] = [h, w];
  papel.style.width = `${w}mm`;
  papel.style.minHeight = `${h}mm`;
  papel.style.padding = `${p.margens.sup}mm ${p.margens.dir}mm ${p.margens.inf}mm ${p.margens.esq}mm`;
  papel.style.zoom = String(zoom);
  // impressão: tamanho, margens, cabeçalho e rodapé (caixas de margem do @page)
  let css = document.getElementById("dc-css-pagina") as HTMLStyleElement | null;
  if (!css) {
    css = el("style", { id: "dc-css-pagina" });
    document.head.append(css);
  }
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  css.textContent = `@page { size: ${w}mm ${h}mm; margin: ${p.margens.sup}mm ${p.margens.dir}mm ${p.margens.inf}mm ${p.margens.esq}mm;
    ${p.cabecalho ? `@top-center { content: ${q(p.cabecalho)}; font: 9pt sans-serif; color: #5e6b78; }` : ""}
    ${p.rodape ? `@bottom-left { content: ${q(p.rodape)}; font: 9pt sans-serif; color: #5e6b78; }` : ""}
    ${p.numerar ? `@bottom-right { content: "Página " counter(page) " de " counter(pages); font: 9pt sans-serif; color: #5e6b78; }` : ""} }`;
  marcarPaginas();
}

/** Linhas tracejadas onde cada página termina (aproximação; a impressão pagina de verdade). */
function marcarPaginas() {
  papel.querySelectorAll(".dc-quebra-visual").forEach((x) => x.remove());
  const p = doc.pagina;
  let [, h] = TAMANHOS[p.tamanho];
  if (p.orientacao === "paisagem") h = TAMANHOS[p.tamanho][0];
  const util = (h - p.margens.sup - p.margens.inf) * MM;
  const alto = texto.scrollHeight;
  paginas = Math.max(1, Math.ceil(alto / util));
  for (let k = 1; k < paginas; k++) {
    const m = el("div", { class: "dc-quebra-visual" }, `<span>Página ${k + 1}</span>`);
    m.style.top = `${p.margens.sup * MM + k * util}px`;
    m.style.height = "0";
    m.style.background = "none";
    papel.append(m);
  }
  atualizarStatus();
}

// ---------- seleção e comandos ----------

let faixaSalva: Range | null = null;
document.addEventListener("selectionchange", () => {
  const s = getSelection();
  if (s && s.rangeCount && texto.contains(s.anchorNode)) faixaSalva = s.getRangeAt(0).cloneRange();
  casca?.renderizar();
});

function restaurar() {
  texto.focus({ preventScroll: true });
  if (faixaSalva) {
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(faixaSalva);
  }
}

function cmd(nome: string, valor?: string) {
  restaurar();
  document.execCommand("styleWithCSS", false, nome === "hiliteColor" || nome === "foreColor" ? "true" : "false");
  document.execCommand(nome, false, valor);
  mudou();
}

const estado = (nome: string) => {
  try {
    return document.queryCommandState(nome);
  } catch {
    return false;
  }
};

/** Bloco (parágrafo/título/item) onde está o cursor. */
function blocoAtual(): HTMLElement | null {
  let n: Node | null = faixaSalva?.startContainer ?? null;
  while (n && n !== texto) {
    if (n instanceof HTMLElement && /^(P|H1|H2|H3|H4|BLOCKQUOTE|PRE|LI|DIV|TD|TH)$/.test(n.tagName)) return n;
    n = n.parentNode;
  }
  return null;
}

/** Blocos tocados pela seleção. */
function blocosDaSelecao(): HTMLElement[] {
  if (!faixaSalva) return [];
  const out = new Set<HTMLElement>();
  const subir = (n: Node | null) => {
    while (n && n !== texto) {
      if (n instanceof HTMLElement && /^(P|H1|H2|H3|H4|BLOCKQUOTE|PRE|LI|DIV)$/.test(n.tagName)) return n;
      n = n.parentNode;
    }
    return null;
  };
  const a = subir(faixaSalva.startContainer), b = subir(faixaSalva.endContainer);
  if (a) out.add(a);
  if (b) out.add(b);
  for (const x of texto.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, blockquote, pre, li")) if (faixaSalva.intersectsNode(x)) out.add(x);
  return [...out];
}

const ESTILOS: [string, string][] = [
  ["p", "Normal"], ["titulo", "Título"], ["subtitulo", "Subtítulo"], ["h1", "Título 1"], ["h2", "Título 2"], ["h3", "Título 3"],
  ["blockquote", "Citação"], ["pre", "Código"],
];

function estiloAtual(): string {
  const b = blocoAtual();
  if (!b) return "p";
  if (b.classList.contains("dc-titulo")) return "titulo";
  if (b.classList.contains("dc-subtitulo")) return "subtitulo";
  const t = b.tagName.toLowerCase();
  return ESTILOS.some(([k]) => k === t) ? t : "p";
}

function aplicarEstilo(v: string) {
  restaurar();
  const tag = v === "titulo" || v === "subtitulo" ? "p" : v;
  document.execCommand("formatBlock", false, tag);
  const b = blocoAtual() ?? (getSelection()?.anchorNode?.parentElement as HTMLElement | null);
  if (b) {
    b.classList.remove("dc-titulo", "dc-subtitulo");
    if (v === "titulo") b.classList.add("dc-titulo");
    if (v === "subtitulo") b.classList.add("dc-subtitulo");
  }
  mudou();
}

function tamanhoFonte(pt: string) {
  restaurar();
  document.execCommand("styleWithCSS", false, "false");
  document.execCommand("fontSize", false, "7");
  for (const f of texto.querySelectorAll<HTMLElement>('font[size="7"]')) {
    const s = el("span");
    s.style.fontSize = `${pt}pt`;
    s.innerHTML = f.innerHTML;
    f.replaceWith(s);
  }
  mudou();
}

function entrelinhas(v: string) {
  for (const b of blocosDaSelecao()) b.style.lineHeight = v === "1.5" ? "" : v;
  mudou();
}

// ---------- tabelas, imagens, links, campos ----------

function inserirTabela() {
  janela("Inserir tabela", `
    <div class="wj-campo"><label>Colunas</label><input data-c type="number" min="1" max="20" value="3" /></div>
    <div class="wj-campo"><label>Linhas</label><input data-l type="number" min="1" max="200" value="3" /></div>
    <label style="font-size:14px"><input type="checkbox" data-cab checked /> Primeira linha como cabeçalho</label>`, [
    { rotulo: "Cancelar" },
    { rotulo: "Inserir", destaque: true, acao: (c) => {
      const nc = Math.max(1, Math.min(20, Number(c.querySelector<HTMLInputElement>("[data-c]")!.value) || 3));
      const nl = Math.max(1, Math.min(200, Number(c.querySelector<HTMLInputElement>("[data-l]")!.value) || 3));
      const cab = c.querySelector<HTMLInputElement>("[data-cab]")!.checked;
      const linha = (tag: string) => `<tr>${Array.from({ length: nc }, () => `<${tag}><br></${tag}>`).join("")}</tr>`;
      cmd("insertHTML", `<table data-nova="1">${cab ? linha("th") : ""}${Array.from({ length: cab ? nl - 1 : nl }, () => linha("td")).join("")}</table><p><br></p>`);
      // cursor na primeira célula, pronto para digitar
      const t = texto.querySelector<HTMLTableElement>('table[data-nova="1"]');
      if (t) {
        t.removeAttribute("data-nova");
        const r = document.createRange();
        r.setStart(t.rows[0].cells[0], 0);
        r.collapse(true);
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        faixaSalva = r.cloneRange();
      }
    } },
  ]);
}

function menuTabela(td: HTMLTableCellElement, x: number, y: number) {
  const tr = td.parentElement as HTMLTableRowElement;
  const tabela = td.closest("table")!;
  const col = td.cellIndex;
  const novaCelula = (tag: string) => el(tag as "td", {}, "<br>");
  menu(x, y, [
    { rotulo: "Inserir linha acima", icone: "inserirLinha", acao: () => { const n = tr.cloneNode(false) as HTMLTableRowElement; for (const _ of tr.cells) n.append(novaCelula("td")); tr.before(n); mudou(); } },
    { rotulo: "Inserir linha abaixo", icone: "inserirLinha", acao: () => { const n = tr.cloneNode(false) as HTMLTableRowElement; for (const _ of tr.cells) n.append(novaCelula("td")); tr.after(n); mudou(); } },
    { rotulo: "Inserir coluna à esquerda", icone: "inserirColuna", acao: () => { for (const r of tabela.rows) r.cells[col]?.before(novaCelula(r.cells[col]?.tagName.toLowerCase() ?? "td")); mudou(); } },
    { rotulo: "Inserir coluna à direita", icone: "inserirColuna", acao: () => { for (const r of tabela.rows) r.cells[col]?.after(novaCelula(r.cells[col]?.tagName.toLowerCase() ?? "td")); mudou(); } },
    "-",
    { rotulo: "Excluir linha", icone: "excluirLinha", acao: () => { tr.remove(); if (!tabela.rows.length) tabela.remove(); mudou(); } },
    { rotulo: "Excluir coluna", icone: "excluirColuna", acao: () => { for (const r of [...tabela.rows]) r.cells[col]?.remove(); if (!tabela.rows[0]?.cells.length) tabela.remove(); mudou(); } },
    { rotulo: "Excluir tabela", icone: "apagar", acao: () => { tabela.remove(); mudou(); } },
  ]);
}

async function inserirImagem() {
  const a = await escolherArquivo(true);
  if (!a?.dados) return;
  if (!/^image\//.test(a.tipo) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(a.nome)) return casca.avisar("Escolha uma imagem (PNG, JPG, GIF, WebP ou SVG).");
  const tipo = a.tipo || (a.nome.endsWith(".svg") ? "image/svg+xml" : "image/png");
  const b64 = btoa(new Uint8Array(a.dados).reduce((s, x) => s + String.fromCharCode(x), ""));
  cmd("insertHTML", `<img src="data:${tipo};base64,${b64}" alt="${escapar(a.nome)}" style="width:60%" data-alinhar="centro" />`);
}

let imgSel: HTMLImageElement | null = null;
function barraImagem(img: HTMLImageElement | null) {
  document.querySelector(".dc-barra-img")?.remove();
  texto.querySelectorAll("img.dc-sel").forEach((x) => x.classList.remove("dc-sel"));
  imgSel = img;
  if (!img) return;
  img.classList.add("dc-sel");
  const r = img.getBoundingClientRect();
  const b = el("div", { class: "dc-barra-img" });
  const botao = (rot: string, f: () => void) => {
    const x = el("button", {}, rot);
    x.onmousedown = (e) => e.preventDefault();
    x.onclick = () => {
      f();
      mudou();
      barraImagem(img);
    };
    b.append(x);
  };
  for (const p of [25, 50, 75, 100]) botao(`${p}%`, () => (img.style.width = `${p}%`));
  botao("⇤", () => (img.dataset.alinhar = "esquerda"));
  botao("↔", () => (img.dataset.alinhar = "centro"));
  botao("⇥", () => (img.dataset.alinhar = "direita"));
  botao("Texto alt.", () => {
    const t = prompt("Texto alternativo (descrição para leitores de tela):", img.alt);
    if (t !== null) img.alt = t;
  });
  const x = el("button", { class: "perigo" }, "Remover");
  x.onclick = () => {
    img.remove();
    barraImagem(null);
    mudou();
  };
  b.append(x);
  document.body.append(b);
  b.style.left = `${Math.max(8, r.left)}px`;
  b.style.top = `${Math.max(8, r.top - 46)}px`;
}

function inserirLink() {
  restaurar();
  const sel = getSelection()?.toString() ?? "";
  const url = prompt("Endereço do link (https://… ou #título):", "https://");
  if (!url || url === "https://") return;
  if (/^\s*javascript:/i.test(url)) return;
  if (sel) cmd("createLink", url);
  else cmd("insertHTML", `<a href="${escapar(url)}">${escapar(url)}</a>`);
}

function inserirData() {
  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  cmd("insertHTML", `<span class="dc-campo" data-campo="data">${d}</span>&nbsp;`);
}

// ---------- sumário e navegação ----------

function titulos(): HTMLElement[] {
  const hs = [...texto.querySelectorAll<HTMLElement>("h1, h2, h3")];
  hs.forEach((h, i) => {
    if (!h.id) h.id = `t${Date.now().toString(36)}${i}`;
  });
  return hs;
}

/** Página aproximada do elemento (pela altura útil da página). */
function paginaDe(e: HTMLElement) {
  const p = doc.pagina;
  let [, h] = TAMANHOS[p.tamanho];
  if (p.orientacao === "paisagem") h = TAMANHOS[p.tamanho][0];
  const util = (h - p.margens.sup - p.margens.inf) * MM;
  return Math.floor((e.offsetTop - texto.offsetTop) / util) + 1;
}

function htmlSumario() {
  const hs = titulos();
  if (!hs.length) return `<div class="dc-sumario" contenteditable="false"><p><b>Sumário</b></p><p><i>Use os estilos Título 1, 2 e 3 para montar o sumário.</i></p></div>`;
  return `<div class="dc-sumario" contenteditable="false"><p><b>Sumário</b></p>${hs.map((h) => `<p class="dc-s${h.tagName[1]}"><a href="#${h.id}">${escapar(h.textContent ?? "")}</a><span></span><span>${paginaDe(h)}</span></p>`).join("")}</div>`;
}

function inserirSumario() {
  const atual = texto.querySelector(".dc-sumario");
  if (atual) {
    atual.outerHTML = htmlSumario();
    mudou();
    return casca.avisar("Sumário atualizado.");
  }
  cmd("insertHTML", htmlSumario() + "<p><br></p>");
}

function renderizarNavegacao() {
  const nav = $("#dc-navegacao");
  if (nav.hidden) return;
  const ol = $("#dc-titulos");
  ol.innerHTML = "";
  for (const h of titulos()) {
    const li = el("li", { "data-n": h.tagName[1] }, escapar(h.textContent || "(sem texto)"));
    li.onclick = () => h.scrollIntoView({ behavior: "smooth", block: "start" });
    ol.append(li);
  }
  if (!ol.children.length) ol.innerHTML = `<li style="color:var(--texto-2)">Sem títulos. Use Título 1, 2 e 3.</li>`;
}

// ---------- localizar e substituir ----------

function localizar(substituir = false) {
  janela(substituir ? "Substituir" : "Localizar", `
    <div class="wj-campo"><label>Localizar</label><input data-q /></div>
    ${substituir ? `<div class="wj-campo"><label>Substituir por</label><input data-r /></div>` : ""}
    <label style="font-size:14px"><input type="checkbox" data-m /> Diferenciar maiúsculas</label>`, [
    { rotulo: "Fechar" },
    ...(substituir ? [{ rotulo: "Substituir tudo", acao: (c: HTMLElement) => {
      const q = c.querySelector<HTMLInputElement>("[data-q]")!.value, r = c.querySelector<HTMLInputElement>("[data-r]")!.value;
      const m = c.querySelector<HTMLInputElement>("[data-m]")!.checked;
      if (!q) return false;
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), m ? "g" : "gi");
      let n = 0;
      const w = document.createTreeWalker(texto, NodeFilter.SHOW_TEXT);
      const nos: Text[] = [];
      while (w.nextNode()) nos.push(w.currentNode as Text);
      for (const t of nos) {
        const novo = t.data.replace(rx, () => (n++, r));
        if (novo !== t.data) t.data = novo;
      }
      mudou();
      casca.avisar(`${n} substituição(ões).`);
      return false;
    } }] : []),
    { rotulo: "Localizar próxima", destaque: true, acao: (c: HTMLElement) => {
      const q = c.querySelector<HTMLInputElement>("[data-q]")!.value;
      const m = c.querySelector<HTMLInputElement>("[data-m]")!.checked;
      if (!q) return false;
      texto.focus();
      const w = window as unknown as { find?: (s: string, caso: boolean, tras: boolean, voltar: boolean) => boolean };
      if (!w.find?.(q, m, false, true)) casca.avisar("Não encontrado.");
      return false;
    } },
  ]);
}

// ---------- status, mudanças, arquivos ----------

function contarPalavras() {
  const t = texto.innerText.trim();
  return t ? t.split(/\s+/).length : 0;
}

function atualizarStatus() {
  casca?.definirStatus(`Página ${Math.min(paginas, paginaDoCursor())} de ${paginas} · ${contarPalavras().toLocaleString("pt-BR")} palavras`);
  if (casca) casca.statusDireita.innerHTML = `<span>Português (Brasil)</span><span>${Math.round(zoom * 100)}%</span>`;
}

function paginaDoCursor() {
  const n = faixaSalva?.startContainer;
  const e = n instanceof HTMLElement ? n : n?.parentElement;
  return e && texto.contains(e) ? paginaDe(e) : 1;
}

let temporizador = 0;
function mudou() {
  clearTimeout(temporizador);
  temporizador = window.setTimeout(() => {
    doc.html = texto.innerHTML;
    autosave.guardar(CHAVE, doc);
    marcarPaginas();
    renderizarNavegacao();
  }, 300);
  casca?.renderizar();
}

function carregar(d: DocTexto) {
  doc = d;
  texto.innerHTML = limparHTMLDoc(doc.html);
  aplicarPagina();
  renderizarNavegacao();
  casca?.renderizar();
  autosave.guardar(CHAVE, doc);
}

/** HTML do nosso arquivo: mantém classes e ids próprios, tira scripts e eventos. */
function limparHTMLDoc(html: string) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("script, iframe, object, embed").forEach((e) => e.remove());
  d.body.querySelectorAll("*").forEach((e) => {
    for (const a of [...e.attributes]) if (a.name.toLowerCase().startsWith("on") || /^\s*javascript:/i.test(a.value)) e.removeAttribute(a.name);
  });
  return d.body.innerHTML || "<p><br></p>";
}

function novo() {
  if (contarPalavras() && !confirm("Começar um documento novo? (salve antes se quiser guardar este)")) return;
  carregar(docVazio());
}

async function abrir() {
  const a = await escolherArquivo();
  if (!a?.texto) return;
  try {
    const nome = a.nome.replace(/\.[^.]+$/, "");
    if (/\.md$/i.test(a.nome)) carregar({ ...docVazio(), nome, html: markdownParaHTML(a.texto) });
    else if (/\.html?$/i.test(a.nome)) carregar({ ...docVazio(), nome, html: limparHTML(a.texto) });
    else if (/\.txt$/i.test(a.nome)) carregar({ ...docVazio(), nome, html: a.texto.split(/\r?\n\r?\n/).map((p) => `<p>${escapar(p).replace(/\r?\n/g, "<br>")}</p>`).join("") });
    else carregar(validar(JSON.parse(a.texto)));
  } catch (e) {
    casca.avisar((e as Error).message || "Não foi possível abrir o arquivo.");
  }
}

function salvar() {
  doc.html = texto.innerHTML;
  salvarArquivo(JSON.stringify(doc), doc.nome, "wjdoc");
  casca.avisar("Documento salvo (.wjdoc).");
}

function exportarHTML() {
  const p = doc.pagina;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(doc.nome)}</title>
<style>body{font-family:sans-serif;font-size:11pt;line-height:1.5;max-width:${TAMANHOS[p.tamanho][0] - p.margens.esq - p.margens.dir}mm;margin:2em auto}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 6px}img{max-width:100%}blockquote{border-left:3px solid #bbb;margin-left:0;padding-left:12px;color:#555}</style>
</head><body>${texto.innerHTML}</body></html>`;
  baixar(html, doc.nome, "html", "text/html");
}

function exportarMarkdown() {
  baixar(htmlParaMarkdown(texto), doc.nome, "md", "text/markdown");
}

// ---------- Markdown (básico) ----------

function htmlParaMarkdown(raiz: HTMLElement): string {
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").replace(/\s+/g, " ");
    if (!(n instanceof HTMLElement)) return "";
    const filhos = [...n.childNodes].map(inline).join("");
    switch (n.tagName) {
      case "B": case "STRONG": return filhos.trim() ? `**${filhos}**` : filhos;
      case "I": case "EM": return filhos.trim() ? `*${filhos}*` : filhos;
      case "S": case "STRIKE": return `~~${filhos}~~`;
      case "CODE": return `\`${filhos}\``;
      case "A": return `[${filhos}](${n.getAttribute("href") ?? ""})`;
      case "BR": return "  \n";
      case "IMG": return `![${n.getAttribute("alt") ?? ""}](imagem)`;
      default: return filhos;
    }
  };
  const blocos: string[] = [];
  const bloco = (n: Node, nivelLista = 0) => {
    if (!(n instanceof HTMLElement)) {
      const t = (n.textContent ?? "").trim();
      if (t) blocos.push(t);
      return;
    }
    const t = n.tagName;
    if (/^H[1-3]$/.test(t)) blocos.push(`${"#".repeat(Number(t[1]))} ${inline(n).trim()}`);
    else if (t === "P" || t === "DIV") {
      if (n.classList.contains("dc-titulo")) blocos.push(`# ${inline(n).trim()}`);
      else if (n.classList.contains("dc-sumario")) return;
      else if (n.innerText.trim()) blocos.push(inline(n).trim());
    } else if (t === "BLOCKQUOTE") blocos.push(inline(n).trim().split("\n").map((l) => `> ${l}`).join("\n"));
    else if (t === "PRE") blocos.push("```\n" + n.innerText + "\n```");
    else if (t === "UL" || t === "OL") {
      [...n.children].forEach((li, i) => {
        const sub = [...li.children].filter((x) => x.tagName === "UL" || x.tagName === "OL");
        const txt = [...li.childNodes].filter((x) => !(x instanceof HTMLElement && (x.tagName === "UL" || x.tagName === "OL"))).map(inline).join("").trim();
        blocos.push(`${"  ".repeat(nivelLista)}${t === "OL" ? `${i + 1}.` : "-"} ${txt}`);
        for (const s of sub) bloco(s, nivelLista + 1);
      });
    } else if (t === "TABLE") {
      const linhas = [...(n as HTMLTableElement).rows].map((r) => `| ${[...r.cells].map((c) => inline(c).trim().replace(/\|/g, "\\|")).join(" | ")} |`);
      if (linhas.length) linhas.splice(1, 0, `|${" --- |".repeat((n as HTMLTableElement).rows[0].cells.length)}`);
      blocos.push(linhas.join("\n"));
    } else if (t === "HR") blocos.push("---");
    else blocos.push(inline(n).trim());
  };
  for (const n of raiz.childNodes) bloco(n);
  return blocos.filter(Boolean).join("\n\n") + "\n";
}

function markdownParaHTML(md: string): string {
  const inline = (s: string) => escapar(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/`(.+?)`/g, "<code>$1</code>").replace(/\[(.+?)\]\((.+?)\)/g, (_, t: string, u: string) => (/^\s*javascript:/i.test(u) ? t : `<a href="${u}">${t}</a>`));
  const out: string[] = [];
  const linhas = md.replace(/\r/g, "").split("\n");
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (/^```/.test(l)) {
      const cod: string[] = [];
      while (++i < linhas.length && !/^```/.test(linhas[i])) cod.push(linhas[i]);
      out.push(`<pre>${escapar(cod.join("\n"))}</pre>`);
    } else if (/^#{1,3} /.test(l)) {
      const n = l.indexOf(" ");
      out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`);
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordenada = /^\s*\d+\./.test(l);
      const itens: string[] = [];
      while (i < linhas.length && /^\s*([-*]|\d+\.) /.test(linhas[i])) itens.push(`<li>${inline(linhas[i++].replace(/^\s*([-*]|\d+\.) /, ""))}</li>`);
      i--;
      out.push(`<${ordenada ? "ol" : "ul"}>${itens.join("")}</${ordenada ? "ol" : "ul"}>`);
    } else if (/^> /.test(l)) out.push(`<blockquote>${inline(l.slice(2))}</blockquote>`);
    else if (/^\|/.test(l)) {
      const tab: string[] = [];
      while (i < linhas.length && /^\|/.test(linhas[i])) tab.push(linhas[i++]);
      i--;
      const cels = (x: string) => x.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const corpo = tab.filter((x) => !/^\|\s*-/.test(x));
      out.push(`<table>${corpo.map((x, k) => `<tr>${cels(x).map((c) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`).join("")}</table>`);
    } else if (/^---+$/.test(l)) out.push("<hr>");
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join("") || "<p><br></p>";
}

// ---------- configurar página ----------

function configurarPagina() {
  const p = doc.pagina;
  janela("Configurar página", `
    <div class="wj-campo"><label>Tamanho</label><select data-t>${Object.entries(TAMANHOS).map(([k, v]) => `<option value="${k}" ${k === p.tamanho ? "selected" : ""}>${v[2]}</option>`).join("")}</select></div>
    <div class="wj-campo"><label>Orientação</label><select data-o><option value="retrato" ${p.orientacao === "retrato" ? "selected" : ""}>Retrato</option><option value="paisagem" ${p.orientacao === "paisagem" ? "selected" : ""}>Paisagem</option></select></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
      ${(["sup", "inf", "esq", "dir"] as const).map((k) => `<div class="wj-campo"><label>${{ sup: "Superior", inf: "Inferior", esq: "Esquerda", dir: "Direita" }[k]} (mm)</label><input type="number" min="0" max="80" data-m="${k}" value="${p.margens[k]}" /></div>`).join("")}
    </div>
    <p style="font-size:13px;color:var(--texto-2);margin:0 0 10px">Padrão ABNT: superior e esquerda 30 mm, inferior e direita 20 mm.</p>
    <div class="wj-campo"><label>Cabeçalho (impresso no topo de cada página)</label><input data-cab value="${escapar(p.cabecalho)}" /></div>
    <div class="wj-campo"><label>Rodapé</label><input data-rod value="${escapar(p.rodape)}" /></div>
    <label style="font-size:14px"><input type="checkbox" data-num ${p.numerar ? "checked" : ""} /> Numerar páginas (Página X de Y)</label>`, [
    { rotulo: "Cancelar" },
    { rotulo: "OK", destaque: true, acao: (c) => {
      p.tamanho = c.querySelector<HTMLSelectElement>("[data-t]")!.value as Pagina["tamanho"];
      p.orientacao = c.querySelector<HTMLSelectElement>("[data-o]")!.value as Pagina["orientacao"];
      for (const i of c.querySelectorAll<HTMLInputElement>("[data-m]")) p.margens[i.dataset.m as "sup"] = Math.max(0, Math.min(80, Number(i.value) || 0));
      p.cabecalho = c.querySelector<HTMLInputElement>("[data-cab]")!.value;
      p.rodape = c.querySelector<HTMLInputElement>("[data-rod]")!.value;
      p.numerar = c.querySelector<HTMLInputElement>("[data-num]")!.checked;
      aplicarPagina();
      mudou();
    } },
  ]);
}

// ---------- faixa de comandos ----------

const FONTES: [string, string][] = [
  ['"Noto Sans", sans-serif', "Sans (padrão)"], ['Georgia, "Times New Roman", serif', "Serifada"], ['"Times New Roman", Times, serif', "Times"],
  ["Arial, Helvetica, sans-serif", "Arial"], ['ui-monospace, Menlo, Consolas, monospace', "Monoespaçada"],
];
const PT: [string, string][] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48].map((x) => [String(x), String(x)]);

const abas: Aba[] = [
  {
    id: "inicio", rotulo: "Início", grupos: [
      [
        { id: "colar", rotulo: "Colar", icone: "colar", dica: "Colar (Ctrl+V)", acao: () => casca.avisar("Use Ctrl+V (ou toque longo → Colar) para colar.") },
        { id: "recortar", rotulo: "Recortar", icone: "recortar", peq: true, acao: () => cmd("cut") },
        { id: "copiar", rotulo: "Copiar", icone: "copiar", peq: true, acao: () => cmd("copy") },
      ],
      [
        { id: "fonte", rotulo: "Fonte", opcoes: () => FONTES, valor: () => FONTES[0][0], aoMudar: (v) => cmd("fontName", v) },
        { id: "tam", rotulo: "Tamanho", opcoes: () => PT, valor: () => "11", aoMudar: (v) => tamanhoFonte(v) },
        { id: "n", rotulo: "Negrito", icone: "negrito", peq: true, dica: "Negrito (Ctrl+B)", ativo: () => estado("bold"), acao: () => cmd("bold") },
        { id: "i", rotulo: "Itálico", icone: "italico", peq: true, dica: "Itálico (Ctrl+I)", ativo: () => estado("italic"), acao: () => cmd("italic") },
        { id: "s", rotulo: "Sublinhado", icone: "sublinhado", peq: true, dica: "Sublinhado (Ctrl+U)", ativo: () => estado("underline"), acao: () => cmd("underline") },
        { id: "r", rotulo: "Tachado", icone: "riscado", peq: true, ativo: () => estado("strikeThrough"), acao: () => cmd("strikeThrough") },
        { id: "sup", rotulo: "Sobrescrito", icone: "maiorFonte", peq: true, ativo: () => estado("superscript"), acao: () => cmd("superscript") },
        { id: "sub", rotulo: "Subscrito", icone: "menorFonte", peq: true, ativo: () => estado("subscript"), acao: () => cmd("subscript") },
        { id: "cor", rotulo: "Cor da fonte", icone: "corTexto", peq: true, cor: { valor: () => "#c9372c", aoMudar: (v) => cmd("foreColor", v) } },
        { id: "realce", rotulo: "Realce", icone: "corFundo", peq: true, cor: { valor: () => "#fff176", aoMudar: (v) => cmd("hiliteColor", v) } },
        { id: "limpa", rotulo: "Limpar formatação", icone: "apagar", peq: true, acao: () => cmd("removeFormat") },
      ],
      [
        { id: "marcas", rotulo: "Marcadores", icone: "listaMarcas", peq: true, ativo: () => estado("insertUnorderedList"), acao: () => cmd("insertUnorderedList") },
        { id: "nums", rotulo: "Numeração", icone: "listaNumeros", peq: true, ativo: () => estado("insertOrderedList"), acao: () => cmd("insertOrderedList") },
        { id: "rec-", rotulo: "Diminuir recuo", icone: "recuoMenos", peq: true, acao: () => cmd("outdent") },
        { id: "rec+", rotulo: "Aumentar recuo", icone: "recuoMais", peq: true, acao: () => cmd("indent") },
        { id: "esq", rotulo: "Alinhar à esquerda", icone: "alinharEsq", peq: true, ativo: () => estado("justifyLeft"), acao: () => cmd("justifyLeft") },
        { id: "cen", rotulo: "Centralizar", icone: "alinharCentro", peq: true, ativo: () => estado("justifyCenter"), acao: () => cmd("justifyCenter") },
        { id: "dir", rotulo: "Alinhar à direita", icone: "alinharDir", peq: true, ativo: () => estado("justifyRight"), acao: () => cmd("justifyRight") },
        { id: "just", rotulo: "Justificar", icone: "justificar", peq: true, ativo: () => estado("justifyFull"), acao: () => cmd("justifyFull") },
        { id: "entre", rotulo: "Espaçamento entre linhas", opcoes: () => [["1", "1,0"], ["1.15", "1,15"], ["1.5", "1,5"], ["2", "2,0"]], valor: () => "1.5", aoMudar: entrelinhas },
      ],
      [
        { id: "estilo", rotulo: "Estilo", opcoes: () => ESTILOS, valor: estiloAtual, aoMudar: aplicarEstilo },
      ],
      [
        { id: "loc", rotulo: "Localizar", icone: "localizar", peq: true, dica: "Localizar (Ctrl+F)", acao: () => localizar(false) },
        { id: "sub", rotulo: "Substituir", icone: "editar", peq: true, dica: "Substituir (Ctrl+H)", acao: () => localizar(true) },
      ],
    ],
  },
  {
    id: "inserir", rotulo: "Inserir", grupos: [
      [
        { id: "tabela", rotulo: "Tabela", icone: "tabela", acao: inserirTabela },
        { id: "imagem", rotulo: "Imagem", icone: "imagem", acao: () => void inserirImagem() },
        { id: "link", rotulo: "Link", icone: "link", acao: inserirLink },
      ],
      [
        { id: "linha", rotulo: "Linha", icone: "linhaHorizontal", acao: () => cmd("insertHorizontalRule") },
        { id: "quebra", rotulo: "Quebra de página", icone: "quebraPagina", dica: "Quebra de página (Ctrl+Enter)", acao: () => cmd("insertHTML", '<hr class="dc-pagina"><p><br></p>') },
        { id: "data", rotulo: "Data", icone: "calendario", acao: inserirData },
        { id: "sumario", rotulo: "Sumário", icone: "sumario", acao: inserirSumario },
      ],
    ],
  },
  {
    id: "layout", rotulo: "Layout", grupos: [
      [
        { id: "pagina", rotulo: "Configurar página", icone: "pagina", acao: configurarPagina },
        { id: "tam", rotulo: "Tamanho", opcoes: () => Object.entries(TAMANHOS).map(([k, v]): [string, string] => [k, v[2]]), valor: () => doc.pagina.tamanho, aoMudar: (v) => ((doc.pagina.tamanho = v as Pagina["tamanho"]), aplicarPagina(), mudou()) },
        { id: "ori", rotulo: "Orientação", opcoes: () => [["retrato", "Retrato"], ["paisagem", "Paisagem"]], valor: () => doc.pagina.orientacao, aoMudar: (v) => ((doc.pagina.orientacao = v as Pagina["orientacao"]), aplicarPagina(), mudou()) },
      ],
    ],
  },
  {
    id: "referencias", rotulo: "Referências", grupos: [
      [
        { id: "sumario", rotulo: "Sumário", icone: "sumario", dica: "Insere ou atualiza o sumário pelos títulos", acao: inserirSumario },
        { id: "atualizar", rotulo: "Atualizar sumário", icone: "refazer", acao: () => (texto.querySelector(".dc-sumario") ? inserirSumario() : casca.avisar("Não há sumário no documento.")) },
      ],
    ],
  },
  {
    id: "revisao", rotulo: "Revisão", grupos: [
      [
        { id: "palavras", rotulo: "Contar palavras", icone: "sumario", acao: () => {
          const t = texto.innerText;
          janela("Contagem de palavras", `<table class="wj-tabela">
            <tr><td>Páginas (aprox.)</td><td>${paginas}</td></tr>
            <tr><td>Palavras</td><td>${contarPalavras().toLocaleString("pt-BR")}</td></tr>
            <tr><td>Caracteres (sem espaços)</td><td>${t.replace(/\s/g, "").length.toLocaleString("pt-BR")}</td></tr>
            <tr><td>Caracteres (com espaços)</td><td>${t.length.toLocaleString("pt-BR")}</td></tr>
            <tr><td>Parágrafos</td><td>${texto.querySelectorAll("p, h1, h2, h3, li, blockquote, pre").length}</td></tr></table>`);
        } },
        { id: "orto", rotulo: "Ortografia", icone: "revisao", dica: "Liga/desliga a verificação ortográfica do navegador", ativo: () => texto.spellcheck, acao: () => ((texto.spellcheck = !texto.spellcheck), texto.focus(), casca.renderizar()) },
      ],
    ],
  },
  {
    id: "exibir", rotulo: "Exibir", grupos: [
      [
        { id: "nav", rotulo: "Navegação", icone: "listaMarcas", ativo: () => !$("#dc-navegacao").hidden, acao: () => (($("#dc-navegacao").hidden = !$("#dc-navegacao").hidden), renderizarNavegacao(), casca.renderizar()) },
      ],
      [
        { id: "z+", rotulo: "Aumentar zoom", icone: "zoomMais", acao: () => definirZoom(zoom * 1.1) },
        { id: "z-", rotulo: "Diminuir zoom", icone: "zoomMenos", acao: () => definirZoom(zoom / 1.1) },
        { id: "z1", rotulo: "100%", icone: "localizar", acao: () => definirZoom(1) },
        { id: "larg", rotulo: "Largura da página", icone: "regua", acao: () => definirZoom((rolagem.clientWidth - 40) / papel.offsetWidth * zoom) },
      ],
      [
        { id: "imprimir", rotulo: "Imprimir / PDF", icone: "imprimir", acao: () => window.print() },
        { id: "html", rotulo: "Exportar HTML", icone: "exportar", acao: exportarHTML },
        { id: "md", rotulo: "Exportar Markdown", icone: "exportar", acao: exportarMarkdown },
      ],
    ],
  },
];

function definirZoom(z: number) {
  zoom = Math.max(0.4, Math.min(2.5, Math.round(z * 100) / 100));
  papel.style.zoom = String(zoom);
  atualizarStatus();
}

const casca: Casca = new Casca({
  app: "WJWrite",
  icone: "",
  extensao: "wjdoc",
  abas,
  nomeDoc: () => doc.nome,
  renomear: (n) => ((doc.nome = n), mudou()),
  novo,
  abrir: () => void abrir(),
  salvar,
  desfazer: () => cmd("undo"),
  refazer: () => cmd("redo"),
  direita: [{ id: "pdf", rotulo: "PDF", icone: "imprimir", dica: "Imprimir ou salvar em PDF", acao: () => window.print() }],
});

// os botões da faixa não tiram o cursor do texto
document.querySelector(".wj-comandos")!.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest("button")) e.preventDefault();
});

// ---------- eventos do texto ----------

texto.addEventListener("input", mudou);
texto.addEventListener("paste", (e) => {
  const html = e.clipboardData?.getData("text/html");
  if (html) {
    e.preventDefault();
    document.execCommand("insertHTML", false, limparHTML(html));
  }
});
texto.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  barraImagem(t instanceof HTMLImageElement ? t : null);
  // Ctrl+clique segue o link (ou vai ao título do sumário)
  const a = t.closest("a");
  if (a && (e.ctrlKey || e.metaKey || a.closest(".dc-sumario"))) {
    e.preventDefault();
    const h = a.getAttribute("href") ?? "";
    if (h.startsWith("#")) document.getElementById(h.slice(1))?.scrollIntoView({ behavior: "smooth" });
    else window.open(h, "_blank", "noopener");
  }
});
texto.addEventListener("contextmenu", (e) => {
  const td = (e.target as HTMLElement).closest("td, th") as HTMLTableCellElement | null;
  if (td) {
    e.preventDefault();
    menuTabela(td, e.clientX, e.clientY);
  }
});
texto.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  // Tab dentro da tabela: próxima célula (Shift+Tab volta); na última, cria uma linha
  const celula = (getSelection()?.anchorNode instanceof HTMLElement ? (getSelection()!.anchorNode as HTMLElement) : getSelection()?.anchorNode?.parentElement)?.closest("td, th") as HTMLTableCellElement | null;
  if (e.key === "Tab" && celula && texto.contains(celula)) {
    e.preventDefault();
    const tabela = celula.closest("table")!;
    const todas = [...tabela.querySelectorAll<HTMLTableCellElement>("td, th")];
    let i = todas.indexOf(celula) + (e.shiftKey ? -1 : 1);
    if (i >= todas.length) {
      const tr = celula.parentElement!.cloneNode(false) as HTMLTableRowElement;
      for (const _ of (celula.parentElement as HTMLTableRowElement).cells) tr.append(el("td", {}, "<br>"));
      tabela.rows[tabela.rows.length - 1].after(tr);
      todas.push(...tr.cells);
      mudou();
    }
    i = Math.max(0, i);
    const r = document.createRange();
    r.selectNodeContents(todas[i]);
    r.collapse(false);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    return;
  }
  if (ctrl && e.key === "Enter") {
    e.preventDefault();
    cmd("insertHTML", '<hr class="dc-pagina"><p><br></p>');
  } else if (ctrl && e.key.toLowerCase() === "f") {
    e.preventDefault();
    localizar(false);
  } else if (ctrl && e.key.toLowerCase() === "h") {
    e.preventDefault();
    localizar(true);
  } else if (ctrl && e.altKey && /^[1-3]$/.test(e.key)) {
    e.preventDefault();
    aplicarEstilo(`h${e.key}`);
  } else if (ctrl && e.key.toLowerCase() === "k") {
    e.preventDefault();
    inserirLink();
  }
});
rolagem.addEventListener("scroll", () => barraImagem(imgSel && document.querySelector(".dc-barra-img") ? imgSel : null));
new ResizeObserver(() => marcarPaginas()).observe(texto);

carregar(doc);
atualizarStatus();
registrarOffline();

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__dc = { doc: () => doc, htmlParaMarkdown, markdownParaHTML };
