// Casca comum dos apps do WJProMaster: barra superior (logo → início, nome do documento, ações
// de arquivo), faixa de comandos por abas, barra de status, avisos, janelas, menus, perfil de
// dispositivo, desfazer/refazer por fotografias do documento, salvar/abrir arquivos.

import { abrirCopias, abrirDoCofre, APPS, desligar, salvarNoCofre, type ChaveApp } from "./cofre";
import "./comum.css";
import { IC, type NomeIc } from "./icones";

export interface Comando {
  id: string;
  rotulo: string;
  icone?: NomeIc;
  dica?: string;
  acao?: () => void;
  /** Botão ligado (negrito, alinhamento…). */
  ativo?: () => boolean;
  /** Botão pequeno (só ícone, empilhável). */
  peq?: boolean;
  /** Seletor no lugar do botão. */
  opcoes?: () => [string, string][];
  valor?: () => string;
  aoMudar?: (v: string) => void;
  /** Cor (input color). */
  cor?: { valor: () => string; aoMudar: (v: string) => void };
  desabilitado?: () => boolean;
}

export interface Aba {
  id: string;
  rotulo: string;
  grupos: Comando[][];
}

export interface OpcoesCasca {
  app: string;
  /** Ícone do app (SVG) para o logo. */
  icone: string;
  extensao: string;
  abas: Aba[];
  nomeDoc: () => string;
  renomear: (n: string) => void;
  novo: () => void;
  abrir: () => void;
  salvar: () => void;
  desfazer?: () => void;
  refazer?: () => void;
  /** Ações extras à direita da barra superior. */
  direita?: Comando[];
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, raiz: ParentNode = document) => raiz.querySelector(sel) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

export const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Perfil de dispositivo (o mesmo do WJCAD: celular, tablet ou computador). */
export function aplicarDispositivo() {
  let d: string | undefined;
  try {
    d = JSON.parse(localStorage.getItem("jlscad:interface") ?? "{}").dispositivo;
  } catch {
    /* sem preferências */
  }
  if (!d) d = matchMedia("(pointer: coarse)").matches ? (Math.min(screen.width, screen.height) < 600 ? "celular" : "tablet") : "computador";
  document.body.classList.add(`disp-${d}`);
  return d as "celular" | "tablet" | "computador";
}

export class Casca {
  aba: string;
  /** Abrir (Ctrl+O / botão): nos apps de documento, pergunta se é do cofre ou do aparelho. */
  abrir: (x: number, y: number) => void = () => {};
  private faixa!: HTMLElement;
  private abasEl!: HTMLElement;
  status!: HTMLElement;
  statusDireita!: HTMLElement;
  private nome!: HTMLInputElement;
  private avisoT?: number;

  constructor(public o: OpcoesCasca) {
    this.aba = o.abas[0]?.id ?? "";
    document.body.classList.add("wj-app");
    aplicarDispositivo();
    const topo = el("header", { class: "wj-topo" });
    topo.innerHTML = `
      <a class="wj-marca" href="../" title="Voltar ao WJProMaster"><img src="${import.meta.env.BASE_URL}wjpromaster.svg" alt="" /><span>${o.app}</span></a>
      <button class="wj-ic" data-a="novo" title="Novo (Ctrl+N)">${IC.novo}</button>
      <button class="wj-ic" data-a="abrir" title="Abrir (Ctrl+O)">${IC.abrir}</button>
      <button class="wj-ic" data-a="salvar" title="Salvar no cofre (Ctrl+S): pendrive, Drive e tablet">${IC.salvar}</button>
      <button class="wj-ic" data-a="locais" title="Cópias do cofre (pendrive, Google Drive, tablet)">${IC.pasta}</button>
      ${o.desfazer ? `<span class="wj-sep"></span><button class="wj-ic" data-a="desfazer" title="Desfazer (Ctrl+Z)">${IC.desfazer}</button><button class="wj-ic" data-a="refazer" title="Refazer (Ctrl+Y)">${IC.refazer}</button>` : ""}
      <input class="wj-nome" aria-label="Nome do documento" />
      <div class="wj-direita"></div>`;
    const comandos = el("nav", { class: "wj-comandos" });
    this.faixa = el("div", { class: "wj-faixa", role: "toolbar" });
    this.abasEl = el("div", { class: "wj-abas", role: "tablist" });
    comandos.append(this.faixa, this.abasEl);
    this.status = el("footer", { class: "wj-status" });
    this.statusDireita = el("div", { class: "wj-direita" });
    this.status.append(el("span", { class: "wj-status-texto" }), this.statusDireita);
    document.body.prepend(topo, comandos);
    document.body.append(this.status);
    this.nome = $(".wj-nome", topo);
    this.nome.onchange = () => o.renomear(this.nome.value.trim() || o.nomeDoc());
    // documentos dos apps vivem no cofre: novo/abrir do aparelho desligam do arquivo do cofre
    const chave = chaveDaExtensao(o.extensao);
    const ehDocumento = Object.values(APPS).some((x) => x.face === chave);
    const novo = () => {
      if (ehDocumento) desligar(chave);
      o.novo();
    };
    const abrirAparelho = () => {
      if (ehDocumento) desligar(chave);
      o.abrir();
    };
    this.abrir = (x, y) => (ehDocumento
      ? menu(x, y, [{ rotulo: "Abrir do cofre (WJPDM)…", icone: "pasta", acao: () => void abrirDoCofre(chave) }, { rotulo: "Abrir arquivo do aparelho…", icone: "abrir", acao: abrirAparelho }])
      : abrirAparelho());
    topo.querySelector<HTMLElement>('[data-a="novo"]')!.onclick = novo;
    const btAbrir = topo.querySelector<HTMLElement>('[data-a="abrir"]')!;
    btAbrir.onclick = () => {
      const r = btAbrir.getBoundingClientRect();
      this.abrir(r.left, r.bottom + 4);
    };
    topo.querySelector<HTMLElement>('[data-a="salvar"]')!.onclick = () => o.salvar();
    topo.querySelector<HTMLElement>('[data-a="locais"]')!.onclick = () => void abrirCopias();
    cascaAtual = this;
    if (o.desfazer) {
      topo.querySelector<HTMLElement>('[data-a="desfazer"]')!.onclick = () => o.desfazer!();
      topo.querySelector<HTMLElement>('[data-a="refazer"]')!.onclick = () => o.refazer!();
    }
    const dir = $(".wj-direita", topo);
    for (const c of o.direita ?? []) dir.append(this.botao(c));
    document.title = `${o.nomeDoc()} — ${o.app}`;
    this.renderizar();
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        o.salvar();
      } else if (k === "o") {
        e.preventDefault();
        this.abrir(innerWidth / 2 - 120, 80);
      }
    });
  }

  /** Redesenha a faixa (estado dos botões) e o nome do documento. */
  renderizar() {
    this.nome.value = this.o.nomeDoc();
    document.title = `${this.o.nomeDoc()} — ${this.o.app}`;
    this.abasEl.innerHTML = "";
    for (const a of this.o.abas) {
      const b = el("button", { class: "wj-aba", role: "tab", "aria-selected": String(a.id === this.aba) }, escapar(a.rotulo));
      b.onclick = () => {
        this.aba = a.id;
        this.renderizar();
      };
      this.abasEl.append(b);
    }
    const aba = this.o.abas.find((a) => a.id === this.aba) ?? this.o.abas[0];
    this.faixa.innerHTML = "";
    if (!aba) return;
    for (const g of aba.grupos) {
      const grupo = el("div", { class: "wj-grupo" });
      const peqs = g.every((c) => c.peq);
      const alvo = peqs && g.length > 2 ? el("div", { class: "wj-pilha" }) : grupo;
      for (const c of g) alvo.append(this.botao(c));
      if (alvo !== grupo) grupo.append(alvo);
      this.faixa.append(grupo);
    }
  }

  private botao(c: Comando): HTMLElement {
    if (c.opcoes) {
      const s = el("select", { title: c.dica ?? c.rotulo, "aria-label": c.rotulo });
      for (const [v, r] of c.opcoes()) s.append(new Option(r, v));
      s.value = c.valor?.() ?? "";
      s.onchange = () => c.aoMudar?.(s.value);
      return s;
    }
    const b = el("button", { class: `wj-cmd${c.peq ? " wj-cmd-peq" : ""}${c.cor ? " wj-cor" : ""}`, title: c.dica ?? c.rotulo });
    b.innerHTML = `${c.icone ? IC[c.icone] : ""}${c.peq ? "" : `<span>${escapar(c.rotulo)}</span>`}`;
    if (c.ativo) b.setAttribute("aria-pressed", String(c.ativo()));
    if (c.desabilitado?.()) b.disabled = true;
    if (c.cor) {
      const inp = el("input", { type: "color" }) as HTMLInputElement;
      inp.value = c.cor.valor();
      b.append(inp);
      b.onclick = () => {
        const sel = el("input", { type: "color" }) as HTMLInputElement;
        sel.value = c.cor!.valor();
        sel.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        document.body.append(sel);
        sel.oninput = () => c.cor!.aoMudar(sel.value);
        sel.onchange = () => sel.remove();
        sel.click();
      };
    } else b.onclick = () => c.acao?.();
    return b;
  }

  definirStatus(texto: string) {
    $(".wj-status-texto", this.status).textContent = texto;
  }

  avisar(msg: string, ms = 3500) {
    let a = document.querySelector<HTMLElement>(".wj-aviso");
    if (!a) {
      a = el("div", { class: "wj-aviso", role: "status" });
      document.body.append(a);
    }
    a.textContent = msg;
    a.hidden = false;
    clearTimeout(this.avisoT);
    this.avisoT = window.setTimeout(() => (a!.hidden = true), ms);
  }
}

/** Janela modal simples. Devolve o elemento do corpo e uma função para fechar. */
export function janela(titulo: string, corpo: string, botoes: { rotulo: string; destaque?: boolean; acao?: (corpo: HTMLElement) => boolean | void }[] = [{ rotulo: "Fechar" }], larga = false) {
  const fundo = el("div", { class: "wj-fundo" });
  fundo.innerHTML = `<div class="wj-janela" role="dialog" aria-modal="true" style="${larga ? "width:min(860px,100%)" : ""}">
    <header><span>${escapar(titulo)}</span><button class="wj-ic" data-x title="Fechar">${IC.fechar}</button></header>
    <div class="wj-corpo">${corpo}</div><footer></footer></div>`;
  const c = $(".wj-corpo", fundo);
  const fechar = () => fundo.remove();
  for (const b of botoes) {
    const x = el("button", b.destaque ? { class: "destaque" } : {}, escapar(b.rotulo));
    x.onclick = () => {
      if (b.acao?.(c) === false) return;
      fechar();
    };
    $("footer", fundo).append(x);
  }
  $("[data-x]", fundo).onclick = fechar;
  fundo.addEventListener("pointerdown", (e) => {
    if (e.target === fundo) fechar();
  });
  fundo.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fechar();
  });
  document.body.append(fundo);
  // foco dentro da janela (Esc fecha); sem campos, vai para o último botão
  (c.querySelector<HTMLElement>("input, select, textarea, button") ?? fundo.querySelector<HTMLElement>("footer button:last-child"))?.focus();
  return { corpo: c, fechar };
}

/** Menu flutuante (botão direito / toque longo). */
export function menu(x: number, y: number, itens: ({ rotulo: string; acao: () => void; icone?: NomeIc } | "-")[]) {
  document.querySelector(".wj-menu")?.remove();
  const m = el("div", { class: "wj-menu", role: "menu" });
  for (const it of itens) {
    if (it === "-") {
      m.append(el("hr"));
      continue;
    }
    const b = el("button", { role: "menuitem" }, `${it.icone ? IC[it.icone] : ""}<span>${escapar(it.rotulo)}</span>`);
    b.onclick = () => {
      m.remove();
      it.acao();
    };
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  const fora = (e: PointerEvent) => {
    if (!m.contains(e.target as Node)) {
      m.remove();
      document.removeEventListener("pointerdown", fora, true);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", fora, true));
}

/** Desfazer/refazer por fotografias (JSON) do documento. */
export class Historico<T> {
  private passos: string[] = [];
  private refeitos: string[] = [];
  constructor(private limite = 100) {}
  registrar(doc: T) {
    const s = JSON.stringify(doc);
    if (this.passos[this.passos.length - 1] === s) return;
    this.passos.push(s);
    if (this.passos.length > this.limite) this.passos.shift();
    this.refeitos.length = 0;
  }
  desfazer(): T | null {
    if (this.passos.length < 2) return null;
    this.refeitos.push(this.passos.pop()!);
    return JSON.parse(this.passos[this.passos.length - 1]);
  }
  refazer(): T | null {
    const s = this.refeitos.pop();
    if (!s) return null;
    this.passos.push(s);
    return JSON.parse(s);
  }
  limpar(doc: T) {
    this.passos = [JSON.stringify(doc)];
    this.refeitos = [];
  }
}

const CHAVES: Record<string, ChaveApp> = { wjpl: "plan", wjdoc: "word", wjapn: "apn", wjcron: "cron", wjpdm: "pdm", wjerp: "erp", wjcad: "cad" };
const chaveDaExtensao = (ext: string): ChaveApp => CHAVES[ext] ?? "word";
let cascaAtual: Casca | null = null;

/**
 * Salva o documento do app no cofre do WJPDM (cópia de trabalho; versão só no GO-IN) e iguala as
 * cópias conectadas (pendrive, Drive, pasta do tablet). Exportações (CSV, HTML…) continuam baixando.
 */
export function salvarArquivo(conteudo: BlobPart, nome: string, extensao: string, tipo = "application/octet-stream") {
  const dados = new Blob([conteudo], { type: tipo });
  void salvarNoCofre(chaveDaExtensao(extensao), `${nome}.${extensao}`, dados).then(
    (msg) => cascaAtual?.avisar(msg, 6000),
    (e) => cascaAtual?.avisar(`Não foi possível salvar: ${(e as Error).message}`, 6000),
  );
}

/** Baixa um arquivo (octet-stream: o Android não troca a extensão). */
export function baixar(conteudo: BlobPart, nome: string, extensao: string, tipo = "application/octet-stream") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  a.download = `${nome.replace(/[\\/:*?"<>|]/g, "_")}.${extensao}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Abre um arquivo do aparelho (sem filtro de tipo: o Android não conhece nossas extensões). */
export function escolherArquivo(binario = false): Promise<{ nome: string; texto?: string; dados?: ArrayBuffer; tipo: string } | null> {
  return new Promise((ok) => {
    const inp = el("input", { type: "file" }) as HTMLInputElement;
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return ok(null);
      ok(binario ? { nome: f.name, dados: await f.arrayBuffer(), tipo: f.type } : { nome: f.name, texto: await f.text(), tipo: f.type });
    };
    inp.click();
  });
}

/** Guarda/lê o documento aberto no aparelho (salvamento automático). */
export const autosave = {
  guardar(chave: string, v: unknown) {
    try {
      localStorage.setItem(chave, JSON.stringify(v));
    } catch {
      /* cheio ou bloqueado: segue sem autosave */
    }
  },
  ler<T>(chave: string): T | null {
    try {
      const s = localStorage.getItem(chave);
      return s ? (JSON.parse(s) as T) : null;
    } catch {
      return null;
    }
  },
};

/** Service worker do WJProMaster (cache offline compartilhado com o WJCAD). */
export function registrarOffline() {
  if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
