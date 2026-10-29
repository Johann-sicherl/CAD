// Peças de interface das páginas de Montagem e Desenho do WJCAD: aviso flutuante, popover,
// janela, barra de contexto e perfil do dispositivo. Mesmos elementos e estilos da página da peça
// (cad/index.html + style.css), para o usuário ver o mesmo app nos três ambientes.

import { ICONES, type NomeIcone } from "../icones";

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------- aviso ----------
let tempoAviso: number | undefined;
export function avisar(texto: string, ms = 3600) {
  const el = $("aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(tempoAviso);
  tempoAviso = window.setTimeout(() => (el.hidden = true), ms);
}

// ---------- popover ----------
export interface ItemPopover {
  rotulo: string;
  icone?: NomeIcone;
  marcado?: boolean;
  acao: () => void;
}
let popoverAberto: HTMLElement | null = null;
export function fecharPopover() {
  popoverAberto?.remove();
  popoverAberto = null;
}
export function abrirPopover(ancora: HTMLElement | { x: number; y: number }, itens: ItemPopover[]) {
  const titulo = ancora instanceof HTMLElement ? ancora.title || ancora.textContent || "" : "cursor";
  const reabrir = popoverAberto?.dataset.ancora !== titulo;
  fecharPopover();
  if (!reabrir) return;
  const p = document.createElement("div");
  p.className = "popover";
  p.dataset.ancora = titulo;
  for (const it of itens) {
    const b = document.createElement("button");
    b.innerHTML = `${it.icone ? ICONES[it.icone] : ""}<span></span>${it.marcado ? "<b>✓</b>" : ""}`;
    b.querySelector("span")!.textContent = it.rotulo;
    b.onclick = () => {
      fecharPopover();
      it.acao();
    };
    p.appendChild(b);
  }
  document.body.appendChild(p);
  const r = ancora instanceof HTMLElement ? ancora.getBoundingClientRect() : { left: ancora.x, bottom: ancora.y };
  p.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - p.offsetHeight - 8))}px`;
  p.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - p.offsetWidth - 8))}px`;
  popoverAberto = p;
}

// ---------- janela (resultado, tabelas) ----------
export function abrirJanela(titulo: string, html: string, larga = false) {
  $("janela").classList.toggle("larga", larga);
  $("janela-titulo").textContent = titulo;
  $("janela-corpo").innerHTML = html;
  $("janela").hidden = false;
}
export function fecharJanela() {
  $("janela").hidden = true;
}

// ---------- barra de contexto ----------
export interface AcaoContexto {
  rotulo: string;
  icone: NomeIcone;
  acao: () => void;
}
export function mostrarBarra(acoes: AcaoContexto[], x: number, y: number) {
  const barra = $("barra-contexto");
  barra.innerHTML = "";
  for (const a of acoes) {
    const b = document.createElement("button");
    b.innerHTML = `${ICONES[a.icone]}<span></span>`;
    b.querySelector("span")!.textContent = a.rotulo;
    b.title = a.rotulo;
    b.onclick = () => {
      esconderBarra();
      a.acao();
    };
    barra.appendChild(b);
  }
  const wrap = $("viewport").getBoundingClientRect();
  barra.hidden = false;
  const w = barra.offsetWidth, h = barra.offsetHeight;
  barra.style.left = `${Math.max(6, Math.min(x - wrap.left + 12, wrap.width - w - 6))}px`;
  barra.style.top = `${Math.max(56, Math.min(y - wrap.top - h - 12, wrap.height - h - 6))}px`;
}
export function esconderBarra() {
  $("barra-contexto").hidden = true;
}

/** Fecha popover, menu e barra de contexto ao tocar fora deles. */
export function instalarFecharAoTocarFora(fecharMenu: () => void) {
  document.addEventListener("pointerdown", (e) => {
    const alvo = e.target as HTMLElement;
    const b = alvo.closest("button");
    const ehAncora = !!b && (b.title || b.textContent) === popoverAberto?.dataset.ancora;
    if (popoverAberto && !popoverAberto.contains(alvo) && !ehAncora) fecharPopover();
    if (!alvo.closest(".menu-wrap")) fecharMenu();
    if (!$("barra-contexto").hidden && !alvo.closest(".barra-contexto") && !alvo.closest("canvas") && !alvo.closest(".arvore")) esconderBarra();
  });
}

// ---------- dispositivo (o mesmo perfil da peça: Ferramentas → Dispositivo) ----------
export type Dispositivo = "celular" | "tablet" | "computador";
export interface PrefsCad {
  dispositivo?: Dispositivo;
  toqueLongoMs?: number;
  estilo?: string;
}
export function lerPrefsCad(): PrefsCad {
  try {
    return JSON.parse(localStorage.getItem("jlscad:interface") ?? "{}");
  } catch {
    return {};
  }
}
export function aplicarDispositivo(): Dispositivo {
  const p = lerPrefsCad();
  const d = p.dispositivo ?? (matchMedia("(pointer: coarse)").matches ? (Math.min(screen.width, screen.height) < 600 ? "celular" : "tablet") : "computador");
  for (const x of ["celular", "tablet", "computador"]) document.body.classList.toggle(`disp-${x}`, x === d);
  return d;
}

/** Celular: árvore/painel em gaveta sobre o modelo. */
export function abrirGaveta(aberta: boolean) {
  document.body.classList.toggle("lateral-aberta", aberta && document.body.classList.contains("disp-celular"));
}

export function baixar(blob: Blob, nome: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
