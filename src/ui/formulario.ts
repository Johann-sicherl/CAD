// Painel de comando (substitui a árvore enquanto um recurso é criado/editado):
// cabeçalho com ✓/✕, caixas recolhíveis (opcionais com caixa de seleção no título),
// campos numéricos com equações, listas de seleção que recebem faces/arestas do viewport.
// Convenção: docs/funcional/README.md.

import type { Referencia } from "../model";

export type TipoSel = "face" | "aresta" | "vertice" | "plano" | "eixo" | "esboco" | "recurso";

type Vis<F> = { vis?: (f: F) => boolean };
export type Campo<F> = Vis<F> & (
  | { t: "num"; rot: string; cam: string; un?: string; passo?: number; min?: number; max?: number }
  | { t: "sel"; rot: string; cam: string; opcoes: [string, string][] | ((f: F) => [string, string][]); aoMudar?: (f: F, v: string) => void; valor?: (f: F) => string }
  | { t: "check"; rot: string; cam: string }
  | { t: "inverter"; rot: string; cam: string }
  /** `ordenavel`: botões ↑ ↓ em cada item (a ordem importa, ex.: curvas-guia). */
  | { t: "refs"; rot: string; cam: string; aceita: TipoSel[]; multiplo: boolean; dica?: string; cor?: "rosa" | "azul"; ordenavel?: boolean }
  | { t: "lista"; rot: string; cam: string; opcoes: (f: F) => [string, string][] }
  | { t: "info"; texto: (f: F) => string }
  | { t: "botao"; rot: string; acao: (f: F) => void; destaque?: boolean }
);

export interface Caixa<F> {
  titulo: string;
  /** Caminho de um booleano: a caixa só se expande quando marcada (ex.: Direção 2). */
  opcional?: string;
  campos: Campo<F>[];
  vis?: (f: F) => boolean;
  aba?: string;
}

export interface Esquema<F> {
  titulo: string;
  abas?: string[];
  caixas: Caixa<F>[];
}

export interface ContextoFormulario {
  aoMudar(final: boolean): void;
  ok(): void;
  cancelar(): void;
  erro?: string;
  /** Campo de seleção que recebe os cliques no viewport/árvore. */
  campoAtivo: string | null;
  ativarCampo(cam: string | null, aceita: TipoSel[], multiplo: boolean): void;
  rotuloRef(r: Referencia, i: number): string;
  realcarRef(r: Referencia | null): void;
  equacao(cam: string): string | undefined;
  definirEquacao(cam: string, expr: string | null): void;
  avaliar(expr: string): number;
  abaAtiva?: string;
  mudarAba?(a: string): void;
  recolhidas: Set<string>;
}

// ---------- caminhos ("condicao.tipo", "dir1.espacamento") ----------

export function ler(obj: unknown, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

export function gravar(obj: unknown, caminho: string, valor: unknown) {
  const partes = caminho.split(".");
  const ultimo = partes.pop()!;
  let o = obj as Record<string, unknown>;
  for (const k of partes) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[ultimo] = valor;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

const fmt = (v: number) => String(Math.round(v * 10000) / 10000);

export function renderizarFormulario<F>(painel: HTMLElement, f: F, esq: Esquema<F>, ctx: ContextoFormulario) {
  painel.innerHTML = "";
  painel.classList.add("painel-comando");

  // cabeçalho: título + ✓ ✕
  const cab = el("div", "pc-cabecalho");
  cab.append(el("h2", "pc-titulo", esq.titulo));
  const ok = el("button", "pc-ok", "✓");
  ok.title = "OK (Enter)";
  ok.onclick = () => ctx.ok();
  const cancelar = el("button", "pc-cancelar", "✕");
  cancelar.title = "Cancelar (Esc)";
  cancelar.onclick = () => ctx.cancelar();
  cab.append(ok, cancelar);
  painel.append(cab);
  if (ctx.erro) painel.append(el("p", "prop-erro", ctx.erro));

  if (esq.abas?.length) {
    const abas = el("div", "pc-abas");
    for (const a of esq.abas) {
      const b = el("button", "pc-aba", a);
      b.setAttribute("aria-selected", String((ctx.abaAtiva ?? esq.abas[0]) === a));
      b.onclick = () => ctx.mudarAba?.(a);
      abas.append(b);
    }
    painel.append(abas);
  }
  const aba = ctx.abaAtiva ?? esq.abas?.[0];

  for (const cx of esq.caixas) {
    if (cx.aba && cx.aba !== aba) continue;
    if (cx.vis && !cx.vis(f)) continue;
    const caixa = el("section", "pc-caixa");
    const titulo = el("header", "pc-caixa-titulo");
    const recolhida = ctx.recolhidas.has(cx.titulo);
    let aberta = !recolhida;
    if (cx.opcional) {
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!ler(f, cx.opcional);
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => {
        gravar(f, cx.opcional!, cb.checked);
        ctx.aoMudar(true);
      };
      titulo.append(cb);
      aberta = aberta && cb.checked;
    }
    titulo.append(el("span", "", cx.titulo), el("span", "pc-seta", aberta ? "▾" : "▸"));
    titulo.onclick = () => {
      if (recolhida) ctx.recolhidas.delete(cx.titulo);
      else ctx.recolhidas.add(cx.titulo);
      ctx.aoMudar(false);
    };
    caixa.append(titulo);
    if (aberta) {
      const corpo = el("div", "pc-caixa-corpo");
      for (const c of cx.campos) {
        if (c.vis && !c.vis(f)) continue;
        corpo.append(campo(f, c, ctx));
      }
      caixa.append(corpo);
    }
    painel.append(caixa);
  }
}

function campo<F>(f: F, c: Campo<F>, ctx: ContextoFormulario): HTMLElement {
  switch (c.t) {
    case "info":
      return el("p", "dica", c.texto(f));
    case "botao": {
      const b = el("button", c.destaque ? "destaque largo" : "largo", c.rot);
      b.onclick = () => c.acao(f);
      return b;
    }
    case "inverter": {
      const b = el("button", "pc-inverter", `⇅ ${c.rot}`);
      b.setAttribute("aria-pressed", String(!!ler(f, c.cam)));
      b.onclick = () => {
        gravar(f, c.cam, !ler(f, c.cam));
        ctx.aoMudar(true);
      };
      return b;
    }
    case "check": {
      const l = el("label", "interruptor");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!ler(f, c.cam);
      cb.onchange = () => {
        gravar(f, c.cam, cb.checked);
        ctx.aoMudar(true);
      };
      l.append(cb, el("span", "", c.rot));
      return l;
    }
    case "sel": {
      const l = el("label", "campo");
      l.append(el("span", "campo-rotulo", c.rot));
      const s = el("select");
      const ops = typeof c.opcoes === "function" ? c.opcoes(f) : c.opcoes;
      for (const [v, r] of ops) s.add(new Option(r, v));
      s.value = c.valor ? c.valor(f) : String(ler(f, c.cam) ?? "");
      s.onchange = () => {
        if (c.aoMudar) c.aoMudar(f, s.value);
        else gravar(f, c.cam, s.value);
        ctx.aoMudar(true);
      };
      l.append(s);
      return l;
    }
    case "lista": {
      const box = el("div", "campo");
      box.append(el("span", "campo-rotulo", c.rot));
      const ul = el("div", "pc-lista");
      const atuais = (ler(f, c.cam) as string[] | undefined) ?? [];
      const ops = c.opcoes(f);
      if (!ops.length) ul.append(el("span", "dica", "Nada disponível."));
      for (const [id, rot] of ops) {
        const lb = el("label", "interruptor");
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = atuais.includes(id);
        cb.onchange = () => {
          const novo = cb.checked ? [...atuais, id] : atuais.filter((x) => x !== id);
          gravar(f, c.cam, novo);
          ctx.aoMudar(true);
        };
        lb.append(cb, el("span", "", rot));
        ul.append(lb);
      }
      box.append(ul);
      return box;
    }
    case "refs": {
      const box = el("div", "campo");
      box.append(el("span", "campo-rotulo", c.rot));
      const area = el("div", `pc-refs ${c.cor ?? "rosa"}`);
      const ativo = ctx.campoAtivo === c.cam;
      area.classList.toggle("ativo", ativo);
      const v = ler(f, c.cam);
      const lista: Referencia[] = c.multiplo ? ((v as Referencia[] | undefined) ?? []) : v ? [v as Referencia] : [];
      lista.forEach((r, i) => {
        const chip = el("span", "pc-chip", ctx.rotuloRef(r, i));
        chip.onpointerenter = () => ctx.realcarRef(r);
        chip.onpointerleave = () => ctx.realcarRef(null);
        if (c.multiplo && c.ordenavel && lista.length > 1) {
          for (const [rot, d] of [["↑", -1], ["↓", 1]] as const) {
            const j = i + d;
            const b = el("button", "pc-chip-ordem", rot);
            b.title = d < 0 ? "Subir" : "Descer";
            b.disabled = j < 0 || j >= lista.length;
            b.onclick = (e) => {
              e.stopPropagation();
              const nova = lista.slice();
              [nova[i], nova[j]] = [nova[j], nova[i]];
              gravar(f, c.cam, nova);
              ctx.aoMudar(true);
            };
            chip.append(b);
          }
        }
        const x = el("button", "pc-chip-x", "×");
        x.onclick = (e) => {
          e.stopPropagation();
          if (c.multiplo) gravar(f, c.cam, lista.filter((_, k) => k !== i));
          else gravar(f, c.cam, undefined);
          ctx.realcarRef(null);
          ctx.aoMudar(true);
        };
        chip.append(x);
        area.append(chip);
      });
      if (!lista.length) area.append(el("span", "pc-vazio", c.dica ?? "Toque para escolher no modelo"));
      area.onclick = () => ctx.ativarCampo(ativo ? null : c.cam, c.aceita, c.multiplo);
      box.append(area);
      return box;
    }
    case "num": {
      const l = el("label", "campo");
      l.append(el("span", "campo-rotulo", c.rot));
      const g = el("div", "num");
      const menos = el("button", "", "−");
      menos.type = "button";
      const inp = el("input");
      inp.inputMode = "decimal";
      const eq = ctx.equacao(c.cam);
      inp.value = eq ?? fmt(Number(ler(f, c.cam) ?? 0));
      if (eq) inp.title = `= ${fmt(Number(ler(f, c.cam) ?? 0))}`;
      inp.classList.toggle("com-equacao", !!eq);
      const mais = el("button", "", "+");
      mais.type = "button";
      const passo = c.passo ?? 1;
      const aplicar = (v: number, final: boolean) => {
        if (!Number.isFinite(v)) return;
        if (c.min !== undefined) v = Math.max(c.min, v);
        if (c.max !== undefined) v = Math.min(c.max, v);
        gravar(f, c.cam, Math.round(v * 10000) / 10000);
        ctx.aoMudar(final);
      };
      const ler2 = (final: boolean) => {
        const t = inp.value.trim();
        if (t.startsWith("=")) {
          if (!final) return;
          const v = ctx.avaliar(t);
          if (!Number.isFinite(v)) {
            inp.classList.add("invalido");
            return;
          }
          ctx.definirEquacao(c.cam, t);
          aplicar(v, true);
          return;
        }
        if (final && ctx.equacao(c.cam)) ctx.definirEquacao(c.cam, null);
        const v = ctx.avaliar(t);
        aplicar(v, final);
      };
      inp.oninput = () => ler2(false);
      inp.onchange = () => ler2(true);
      inp.onkeydown = (e) => e.stopPropagation();
      menos.onclick = () => {
        ctx.definirEquacao(c.cam, null);
        aplicar(Number(ler(f, c.cam) ?? 0) - passo, true);
      };
      mais.onclick = () => {
        ctx.definirEquacao(c.cam, null);
        aplicar(Number(ler(f, c.cam) ?? 0) + passo, true);
      };
      g.append(menos, inp, mais, el("span", "unidade", c.un ?? ""));
      l.append(g);
      return l;
    }
  }
}
