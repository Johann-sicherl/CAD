// WJTaskPlan: tarefas em pastas (árvore editável à esquerda), escritas à mão com a caneta e
// transcritas ao vivo, estados editáveis com data e hora de cada troca, prazo opcional com alerta
// ao abrir, painel de indicadores e configurações. Regras puras em regras.ts; dados no aparelho e
// na pasta WJTaskPlan/ ao lado do cofre do WJPDM (copias.ts). Especificação: docs/global/taskplan.md.

import "../comum/comum.css";
import "./tarefas.css";
import { $, aplicarDispositivo, baixar, el, escapar, janela, menu, registrarOffline } from "../comum/casca";
import { abrirCopias, EVENTO_SINCRONIZADO, sincronizarAoAbrir } from "../comum/cofre";
import { botaoDiagnostico } from "../comum/diagnostico";
import { IC } from "../comum/icones";
import { lerLocal, gravarLocal, sincronizarTarefas } from "./copias";
import { areaEscrita, permitirOnline, reconhecedor } from "./escrita";
import {
  alertas, caminhoPasta, concluidaEm, criarPasta, criarTarefa, descendentes, diaLocal, diasEntre, duracao, estadoDe, estadosOrdenados, excluirEstado,
  excluirPasta, excluirTarefa, filhas, mesclar, moverPasta, mudarEstado, painel, tabelaCSV, uid, type Base, type Estado, type Tarefa, type TipoEstado,
} from "./regras";

// ---------- estado da página ----------

let base: Base = await lerLocal();
type Vista = "lista" | "painel" | "config";
const pref = (k: string, padrao: string) => localStorage.getItem(`wjtask:${k}`) ?? padrao;
const guardarPref = (k: string, v: string) => localStorage.setItem(`wjtask:${k}`, v);
let vista: Vista = (pref("vista", "lista") as Vista) || "lista";
/** pasta escolhida na árvore ("" = todas as tarefas) */
let pastaSel = pref("pasta", "");
let comSub = pref("subpastas", "1") === "1";
let filtroEstado = "";
let busca = "";
const fechadas = new Set<string>(JSON.parse(pref("fechadas", "[]")) as string[]);
let textoSincronia = "";
permitirOnline(pref("online", "1") === "1");

const agoraISO = () => new Date().toISOString();
const hoje = () => diaLocal(new Date());
const dataHora = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const ROT_TIPO: Record<TipoEstado, string> = { inicio: "Início (tarefa nova)", andamento: "Em andamento", fim: "Concluído" };

// ---------- gravar e sincronizar ----------

let tSinc = 0;
/** Aplica uma alteração: grava no aparelho na hora e iguala as cópias pouco depois. */
function alterar(f: (b: Base) => void) {
  f(base);
  void gravarLocal(base);
  renderizar();
  clearTimeout(tSinc);
  tSinc = window.setTimeout(() => void sincronizar(false), 2500);
}

async function sincronizar(pedir: boolean) {
  if (pedir) definirSincronia("Sincronizando…");
  try {
    const r = await sincronizarTarefas(pedir);
    // o que mudou na memória durante a sincronia também vale (a mescla junta os dois)
    const junto = mesclar([base, r.base], agoraISO());
    if (JSON.stringify(junto) !== JSON.stringify(base)) {
      base = junto;
      await gravarLocal(base);
      renderizar();
    }
    definirSincronia(r.texto);
  } catch (e) {
    definirSincronia(`Sincronia falhou: ${(e as Error).message}`);
  }
}

// ---------- casca da página ----------

aplicarDispositivo();
document.body.classList.add("wj-app", "tp-app");
const topo = el("header", { class: "wj-topo" });
topo.innerHTML = `
  <a class="wj-marca" href="../" title="Voltar ao WJProMaster"><img src="${import.meta.env.BASE_URL}wjpromaster.svg" alt="" /><span>WJTaskPlan</span></a>
  <button class="wj-ic tp-so-gaveta" data-a="gaveta" title="Pastas">${IC.pasta}</button>
  <div class="tp-vistas" role="tablist">
    <button data-v="lista" role="tab">${IC.lista}<span>Tarefas</span></button>
    <button data-v="painel" role="tab">${IC.painel}<span>Painel</span></button>
    <button data-v="config" role="tab">${IC.config}<span>Configurações</span></button>
  </div>
  <div class="wj-direita">
    <button class="wj-ic" data-a="sinc" title="Sincronizar agora (aparelho, pendrive, Google Drive)">${IC.sincronizar}</button>
    <button class="destaque tp-nova" data-a="nova" title="Nova tarefa (escrever com a caneta)">${IC.caneta}<span>Nova tarefa</span></button>
  </div>`;
const principal = el("main", { class: "tp-principal" });
principal.innerHTML = `<aside class="tp-arvore"><div class="tp-arvore-topo"><b>Pastas</b><button class="wj-ic" data-a="nova-pasta" title="Nova pasta na raiz">${IC.novaPasta}</button></div><div class="tp-pastas"></div></aside><section class="tp-conteudo"></section>`;
const status = el("footer", { class: "wj-status" });
status.innerHTML = `<span class="wj-status-texto"></span><div class="wj-direita"><span data-sinc></span></div>`;
document.body.append(topo, principal, status);
{
  const d = botaoDiagnostico("wj-ic");
  if (d) $(".wj-direita", topo).prepend(d);
}
const arvoreEl = $(".tp-pastas", principal);
const conteudo = $(".tp-conteudo", principal);
const definirSincronia = (t: string) => {
  textoSincronia = t;
  $("[data-sinc]", status).textContent = t;
};

topo.querySelectorAll<HTMLButtonElement>("[data-v]").forEach((b) => (b.onclick = () => irPara(b.dataset.v as Vista)));
$('[data-a="nova"]', topo).onclick = () => editarTarefa(null);
$('[data-a="sinc"]', topo).onclick = () => void sincronizar(true);
$('[data-a="gaveta"]', topo).onclick = () => document.body.classList.toggle("tp-gaveta-aberta");
$('[data-a="nova-pasta"]', principal).onclick = () => void novaPasta(null);
principal.addEventListener("pointerdown", (e) => {
  // celular: tocar fora da gaveta fecha
  if (document.body.classList.contains("tp-gaveta-aberta") && !(e.target as HTMLElement).closest(".tp-arvore")) document.body.classList.remove("tp-gaveta-aberta");
});

function irPara(v: Vista) {
  vista = v;
  guardarPref("vista", v);
  renderizar();
}

// ---------- caixas de diálogo pequenas ----------

function pedirTexto(titulo: string, rotulo: string, valor = ""): Promise<string | null> {
  return new Promise((ok) => {
    let feito = false;
    const { corpo, fechar } = janela(titulo, `<div class="wj-campo"><label>${escapar(rotulo)}</label><input data-t value="${escapar(valor)}" /></div>`, [
      { rotulo: "Cancelar" },
      { rotulo: "OK", destaque: true, acao: (c) => ((feito = true), ok($<HTMLInputElement>("[data-t]", c).value.trim() || null)) },
    ]);
    const inp = $<HTMLInputElement>("[data-t]", corpo);
    inp.select();
    inp.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      feito = true;
      ok(inp.value.trim() || null);
      fechar();
    };
    new MutationObserver((_, o) => {
      if (corpo.isConnected) return;
      o.disconnect();
      if (!feito) ok(null);
    }).observe(document.body, { childList: true });
  });
}

function confirmar(titulo: string, texto: string, rotuloOk = "Excluir"): Promise<boolean> {
  return new Promise((ok) => {
    let feito = false;
    const { corpo } = janela(titulo, `<p>${texto}</p>`, [{ rotulo: "Cancelar" }, { rotulo: rotuloOk, destaque: true, acao: () => ((feito = true), ok(true)) }]);
    new MutationObserver((_, o) => {
      if (corpo.isConnected) return;
      o.disconnect();
      if (!feito) ok(false);
    }).observe(document.body, { childList: true });
  });
}

/** Lista de pastas para um <select> (com recuo pela profundidade). */
function opcoesPastas(sel: string, excluir?: Set<string>, raiz?: string): string {
  const linhas: string[] = raiz ? [`<option value="">${escapar(raiz)}</option>`] : [];
  const andar = (pai: string | null, nivel: number) => {
    for (const p of filhas(base, pai)) {
      if (excluir?.has(p.id)) continue;
      linhas.push(`<option value="${p.id}"${p.id === sel ? " selected" : ""}>${"  ".repeat(nivel)}${escapar(p.nome)}</option>`);
      andar(p.id, nivel + 1);
    }
  };
  andar(null, 0);
  return linhas.join("");
}

// ---------- árvore de pastas ----------

const abertasNaLista = (id: string) => base.tarefas.filter((t) => t.pasta === id && estadoDe(base, t.estado)?.tipo !== "fim").length;

function renderizarArvore() {
  const linhas: string[] = [`<div class="tp-pasta${pastaSel === "" ? " sel" : ""}" data-id="" style="--nivel:0"><span class="tp-seta"></span><span class="tp-nome">Todas as tarefas</span><span class="tp-conta">${base.tarefas.filter((t) => estadoDe(base, t.estado)?.tipo !== "fim").length || ""}</span></div>`];
  const andar = (pai: string | null, nivel: number) => {
    for (const p of filhas(base, pai)) {
      const temFilhas = base.pastas.some((x) => x.pai === p.id);
      const fechada = fechadas.has(p.id);
      const n = abertasNaLista(p.id);
      linhas.push(`<div class="tp-pasta${p.id === pastaSel ? " sel" : ""}" data-id="${p.id}" style="--nivel:${nivel}">
        <button class="tp-seta" data-seta ${temFilhas ? "" : "disabled"} title="${fechada ? "Abrir" : "Fechar"}">${temFilhas ? (fechada ? "▸" : "▾") : ""}</button>
        <span class="tp-alca" data-alca title="Arraste para mudar a posição na árvore">⠿</span>
        <span class="tp-nome">${escapar(p.nome)}</span><span class="tp-conta">${n || ""}</span>
        <button class="tp-mais" data-menu title="Opções da pasta">⋯</button></div>`);
      if (!fechada) andar(p.id, nivel + 1);
    }
  };
  andar(null, 0);
  arvoreEl.innerHTML = linhas.join("");
}

arvoreEl.addEventListener("click", (e) => {
  const alvo = e.target as HTMLElement;
  const linha = alvo.closest<HTMLElement>(".tp-pasta");
  if (!linha) return;
  const id = linha.dataset.id!;
  if (alvo.closest("[data-seta]")) {
    if (fechadas.has(id)) fechadas.delete(id);
    else fechadas.add(id);
    guardarPref("fechadas", JSON.stringify([...fechadas]));
    return renderizarArvore();
  }
  if (alvo.closest("[data-menu]")) {
    const r = alvo.getBoundingClientRect();
    return menuPasta(id, r.left, r.bottom);
  }
  pastaSel = id;
  guardarPref("pasta", id);
  document.body.classList.remove("tp-gaveta-aberta");
  if (vista === "config") vista = "lista";
  renderizar();
});
arvoreEl.addEventListener("dblclick", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>(".tp-pasta")?.dataset.id;
  if (id) void renomearPasta(id);
});
arvoreEl.addEventListener("contextmenu", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>(".tp-pasta")?.dataset.id;
  if (id === undefined) return;
  e.preventDefault();
  if (id) menuPasta(id, e.clientX, e.clientY);
});

function menuPasta(id: string, x: number, y: number) {
  if (!id) return;
  const p = base.pastas.find((q) => q.id === id)!;
  const irmas = filhas(base, p.pai);
  const k = irmas.findIndex((q) => q.id === id);
  menu(x, y, [
    { rotulo: "Nova tarefa aqui", icone: "caneta", acao: () => editarTarefa(null, id) },
    { rotulo: "Nova subpasta", icone: "novaPasta", acao: () => void novaPasta(id) },
    { rotulo: "Renomear", icone: "editar", acao: () => void renomearPasta(id) },
    "-",
    { rotulo: "Mover para…", icone: "movimento", acao: () => moverPara(id) },
    ...(k > 0 ? [{ rotulo: "Subir", acao: () => alterar((b) => moverPasta(b, id, p.pai, k - 1, agoraISO())) }] : []),
    ...(k < irmas.length - 1 ? [{ rotulo: "Descer", acao: () => alterar((b) => moverPasta(b, id, p.pai, k + 1, agoraISO())) }] : []),
    ...(p.pai ? [{ rotulo: "Tirar da pasta (um nível acima)", acao: () => {
      const avo = base.pastas.find((q) => q.id === p.pai)!;
      alterar((b) => moverPasta(b, id, avo.pai, filhas(b, avo.pai).findIndex((q) => q.id === avo.id) + 1, agoraISO()));
    } }] : []),
    "-",
    { rotulo: "Excluir pasta…", icone: "apagar", acao: () => void apagarPasta(id) },
  ]);
}

async function novaPasta(pai: string | null) {
  const nome = await pedirTexto(pai ? `Nova subpasta em ${caminhoPasta(base, pai)}` : "Nova pasta", "Nome da pasta");
  if (!nome) return;
  if (pai) fechadas.delete(pai);
  alterar((b) => {
    const p = criarPasta(b, nome, pai, agoraISO());
    pastaSel = p.id;
  });
}

async function renomearPasta(id: string) {
  const p = base.pastas.find((q) => q.id === id);
  if (!p) return;
  const nome = await pedirTexto("Renomear pasta", "Nome da pasta", p.nome);
  if (nome && nome !== p.nome) alterar(() => ((p.nome = nome), (p.atualizado = agoraISO())));
}

function moverPara(id: string) {
  const p = base.pastas.find((q) => q.id === id)!;
  janela(`Mover "${p.nome}"`, `<div class="wj-campo"><label>Colocar dentro de</label><select data-d>${opcoesPastas(p.pai ?? "", descendentes(base, id), "(raiz da árvore)")}</select></div>`, [
    { rotulo: "Cancelar" },
    { rotulo: "Mover", destaque: true, acao: (c) => {
      const destino = $<HTMLSelectElement>("[data-d]", c).value || null;
      if (destino) fechadas.delete(destino);
      alterar((b) => moverPasta(b, id, destino, filhas(b, destino).length, agoraISO()));
    } },
  ]);
}

async function apagarPasta(id: string) {
  const ids = descendentes(base, id);
  const n = base.tarefas.filter((t) => ids.has(t.pasta)).length;
  const p = base.pastas.find((q) => q.id === id)!;
  const ok = await confirmar("Excluir pasta", `Excluir <b>${escapar(p.nome)}</b>${ids.size > 1 ? `, ${ids.size - 1} subpasta(s)` : ""}${n ? ` e ${n} tarefa(s)` : ""}? A exclusão vale também nas cópias (pendrive, Drive).`);
  if (!ok) return;
  alterar((b) => {
    excluirPasta(b, id, agoraISO());
    if (ids.has(pastaSel)) pastaSel = "";
  });
}

// arrastar pastas na árvore (caneta, dedo ou mouse) pela alça ⠿: no meio de outra pasta = entra
// nela; na borda de cima/baixo = fica antes/depois dela
{
  let arrasto: { id: string; x: number; y: number; ativo: boolean; fantasma?: HTMLElement } | null = null;
  let alvo: { id: string; onde: "antes" | "dentro" | "depois" } | null = null;
  const limpar = () => arvoreEl.querySelectorAll(".tp-antes, .tp-dentro, .tp-depois").forEach((x) => x.classList.remove("tp-antes", "tp-dentro", "tp-depois"));
  arvoreEl.addEventListener("pointerdown", (e) => {
    const alca = (e.target as HTMLElement).closest<HTMLElement>("[data-alca]");
    if (!alca) return;
    e.preventDefault();
    alca.setPointerCapture(e.pointerId);
    arrasto = { id: alca.closest<HTMLElement>(".tp-pasta")!.dataset.id!, x: e.clientX, y: e.clientY, ativo: false };
  });
  arvoreEl.addEventListener("pointermove", (e) => {
    if (!arrasto) return;
    if (!arrasto.ativo) {
      if (Math.hypot(e.clientX - arrasto.x, e.clientY - arrasto.y) < 6) return;
      arrasto.ativo = true;
      const nome = base.pastas.find((p) => p.id === arrasto!.id)?.nome ?? "";
      arrasto.fantasma = el("div", { class: "tp-fantasma" }, escapar(nome));
      document.body.append(arrasto.fantasma);
    }
    arrasto.fantasma!.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
    limpar();
    alvo = null;
    const linha = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".tp-pasta");
    const id = linha?.dataset.id;
    if (!linha || id === undefined) return;
    if (id === "") {
      alvo = { id: "", onde: "dentro" }; // "Todas as tarefas" = raiz
    } else {
      if (descendentes(base, arrasto.id).has(id)) return;
      const r = linha.getBoundingClientRect();
      const f = (e.clientY - r.top) / r.height;
      alvo = { id, onde: f < 0.28 ? "antes" : f > 0.72 ? "depois" : "dentro" };
    }
    linha.classList.add(`tp-${alvo.onde}`);
  });
  const soltar = () => {
    if (!arrasto) return;
    const { id, ativo, fantasma } = arrasto;
    fantasma?.remove();
    limpar();
    arrasto = null;
    if (!ativo || !alvo) return;
    const a = alvo;
    alvo = null;
    alterar((b) => {
      const agora = agoraISO();
      if (a.onde === "dentro") {
        const pai = a.id || null;
        if (pai) fechadas.delete(pai);
        moverPasta(b, id, pai, filhas(b, pai).length, agora);
      } else {
        const ref = b.pastas.find((p) => p.id === a.id)!;
        const irmas = filhas(b, ref.pai).filter((p) => p.id !== id);
        const k = irmas.findIndex((p) => p.id === ref.id) + (a.onde === "depois" ? 1 : 0);
        moverPasta(b, id, ref.pai, k, agora);
      }
    });
  };
  arvoreEl.addEventListener("pointerup", soltar);
  arvoreEl.addEventListener("pointercancel", soltar);
}

// ---------- lista de tarefas ----------

function tarefasDoEscopo(): Tarefa[] {
  if (!pastaSel) return base.tarefas;
  const ids = comSub ? descendentes(base, pastaSel) : new Set([pastaSel]);
  return base.tarefas.filter((t) => ids.has(t.pasta));
}

function seloPrazo(t: Tarefa): string {
  if (!t.prazo) return "";
  const fim = estadoDe(base, t.estado)?.tipo === "fim";
  const d = diasEntre(hoje(), t.prazo);
  const cls = fim ? "" : d < 0 ? " tp-atrasada" : d <= base.config.diasAlerta ? " tp-proxima" : "";
  const txt = fim ? `prazo ${dataBR(t.prazo)}` : d < 0 ? `atrasada ${-d} dia(s) · ${dataBR(t.prazo)}` : d === 0 ? "vence hoje" : `prazo ${dataBR(t.prazo)} (${d} dia${d > 1 ? "s" : ""})`;
  return `<span class="wj-selo${cls}">${txt}</span>`;
}

function seletorEstado(t: Tarefa): string {
  const e = estadoDe(base, t.estado);
  return `<select class="tp-estado" data-estado="${t.id}" style="--cor:${e?.cor ?? "#8a96a3"}" aria-label="Estado">${estadosOrdenados(base).map((x) => `<option value="${x.id}"${x.id === t.estado ? " selected" : ""}>${escapar(x.nome)}</option>`).join("")}</select>`;
}

function renderizarLista() {
  const escopo = tarefasDoEscopo();
  const ordem = new Map(estadosOrdenados(base).map((e, k) => [e.id, k]));
  const q = busca.trim().toLowerCase();
  const lista = escopo
    .filter((t) => (!filtroEstado || t.estado === filtroEstado) && (!q || t.titulo.toLowerCase().includes(q)))
    .sort((a, b) => {
      const fa = estadoDe(base, a.estado)?.tipo === "fim", fb = estadoDe(base, b.estado)?.tipo === "fim";
      if (fa !== fb) return fa ? 1 : -1;
      if (fa) return (concluidaEm(base, b) ?? "").localeCompare(concluidaEm(base, a) ?? "");
      return (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999") || (ordem.get(b.estado)! - ordem.get(a.estado)!) || b.criada.localeCompare(a.criada);
    });
  const mostrarPasta = !pastaSel || (comSub && base.pastas.some((p) => p.pai === pastaSel));
  const titulo = pastaSel ? caminhoPasta(base, pastaSel) : "Todas as tarefas";
  conteudo.innerHTML = `
    <div class="tp-cabeca">
      <h2>${escapar(titulo)}</h2>
      <div class="tp-filtros">
        ${pastaSel && base.pastas.some((p) => p.pai === pastaSel) ? `<label class="tp-chk"><input type="checkbox" data-sub ${comSub ? "checked" : ""}/> Incluir subpastas</label>` : ""}
        <select data-filtro aria-label="Filtrar por estado"><option value="">Todos os estados</option>${estadosOrdenados(base).map((e) => `<option value="${e.id}"${e.id === filtroEstado ? " selected" : ""}>${escapar(e.nome)} (${escopo.filter((t) => t.estado === e.id).length})</option>`).join("")}</select>
        <input type="search" data-busca placeholder="Procurar" value="${escapar(busca)}" />
      </div>
    </div>
    ${lista.length ? `<ul class="tp-lista">${lista.map((t) => `
      <li class="tp-tarefa${estadoDe(base, t.estado)?.tipo === "fim" ? " tp-feita" : ""}" data-id="${t.id}">
        ${seletorEstado(t)}
        <div class="tp-texto" data-editar>
          <span class="tp-titulo">${escapar(t.titulo)}</span>
          <span class="tp-meta">criada ${dataHora(t.criada)}${mostrarPasta ? ` · ${escapar(caminhoPasta(base, t.pasta))}` : ""} ${seloPrazo(t)}</span>
        </div>
        <button class="tp-mais" data-menu title="Opções da tarefa">⋯</button>
      </li>`).join("")}</ul>`
    : `<div class="wj-vazio">${escopo.length ? "Nenhuma tarefa com este filtro." : `Nenhuma tarefa aqui.<br/><button class="destaque" data-nova>${IC.caneta} Nova tarefa</button>`}</div>`}`;
  conteudo.querySelector<HTMLInputElement>("[data-sub]")?.addEventListener("change", (e) => {
    comSub = (e.target as HTMLInputElement).checked;
    guardarPref("subpastas", comSub ? "1" : "0");
    renderizar();
  });
  $<HTMLSelectElement>("[data-filtro]", conteudo).onchange = (e) => ((filtroEstado = (e.target as HTMLSelectElement).value), renderizar());
  const b = $<HTMLInputElement>("[data-busca]", conteudo);
  b.oninput = () => {
    busca = b.value;
    renderizarLista();
    const n = $<HTMLInputElement>("[data-busca]", conteudo);
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  };
  conteudo.querySelector<HTMLElement>("[data-nova]")?.addEventListener("click", () => editarTarefa(null));
}

conteudo.addEventListener("change", (e) => {
  const s = (e.target as HTMLElement).closest<HTMLSelectElement>("[data-estado]");
  if (!s) return;
  const t = base.tarefas.find((x) => x.id === s.dataset.estado);
  if (t) alterar(() => mudarEstado(t, s.value, agoraISO()));
});
conteudo.addEventListener("click", (e) => {
  const alvo = e.target as HTMLElement;
  const id = alvo.closest<HTMLElement>(".tp-tarefa")?.dataset.id;
  const t = id && base.tarefas.find((x) => x.id === id);
  if (!t) return;
  if (alvo.closest("[data-menu]")) {
    const r = alvo.getBoundingClientRect();
    menuTarefa(t, r.left, r.bottom);
  } else if (alvo.closest("[data-editar]")) editarTarefa(t);
});
conteudo.addEventListener("contextmenu", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>(".tp-tarefa")?.dataset.id;
  const t = id && base.tarefas.find((x) => x.id === id);
  if (!t) return;
  e.preventDefault();
  menuTarefa(t, e.clientX, e.clientY);
});

function menuTarefa(t: Tarefa, x: number, y: number) {
  menu(x, y, [
    { rotulo: "Editar", icone: "editar", acao: () => editarTarefa(t) },
    { rotulo: "Mover para outra pasta…", icone: "movimento", acao: () => moverTarefa(t) },
    { rotulo: "Histórico de estados", icone: "historico", acao: () => historico(t) },
    "-",
    { rotulo: "Excluir tarefa", icone: "apagar", acao: async () => (await confirmar("Excluir tarefa", `Excluir <b>${escapar(t.titulo)}</b>?`)) && alterar((b) => excluirTarefa(b, t.id, agoraISO())) },
  ]);
}

function moverTarefa(t: Tarefa) {
  janela("Mover tarefa", `<div class="wj-campo"><label>Pasta</label><select data-d>${opcoesPastas(t.pasta)}</select></div>`, [
    { rotulo: "Cancelar" },
    { rotulo: "Mover", destaque: true, acao: (c) => {
      const p = $<HTMLSelectElement>("[data-d]", c).value;
      if (p && p !== t.pasta) alterar(() => ((t.pasta = p), (t.atualizado = agoraISO())));
    } },
  ]);
}

function historico(t: Tarefa) {
  const linhas = t.historico.map((h, k) => {
    const prox = t.historico[k + 1]?.quando;
    const e = estadoDe(base, h.estado);
    return `<tr><td><span class="tp-ponto" style="--cor:${e?.cor ?? "#8a96a3"}"></span>${escapar(e?.nome ?? "(estado excluído)")}</td><td>${dataHora(h.quando)}</td><td>${prox ? duracao(Date.parse(prox) - Date.parse(h.quando)) : e?.tipo === "fim" ? "—" : `${duracao(Date.now() - Date.parse(h.quando))} (até agora)`}</td></tr>`;
  });
  const fim = concluidaEm(base, t);
  janela(`Histórico — ${t.titulo}`, `
    <table class="wj-tabela"><thead><tr><th>Estado</th><th>Desde</th><th>Tempo no estado</th></tr></thead><tbody>${linhas.join("")}</tbody></table>
    <p>${fim ? `Tempo de atendimento (criação → conclusão): <b>${duracao(Date.parse(fim) - Date.parse(t.criada))}</b>` : `Aberta há ${duracao(Date.now() - Date.parse(t.criada))}.`}</p>`);
}

// ---------- nova tarefa / editar (escrita à mão) ----------

function editarTarefa(t: Tarefa | null, pasta?: string) {
  const pastaPadrao = t?.pasta ?? pasta ?? (base.pastas.some((p) => p.id === pastaSel) ? pastaSel : filhas(base, null)[0]?.id ?? "");
  const amanha = diaLocal(new Date(Date.now() + 86400000));
  const { corpo, fechar } = janela(t ? "Editar tarefa" : "Nova tarefa", `
    <div class="tp-escrita">
      <textarea class="tp-transcrito" data-titulo rows="1" placeholder="Escreva abaixo com a caneta (ou digite aqui)" autocomplete="off" spellcheck="true">${escapar(t?.titulo ?? "")}</textarea>
      <div class="tp-alts" data-alts></div>
      <canvas class="tp-tela" data-tela></canvas>
      <div class="tp-barra-escrita">
        <button data-desf class="tp-so-tinta" title="Apaga o último traço">Desfazer traço</button>
        <button data-limpa class="tp-so-tinta" title="Guarda o texto e limpa a área para continuar escrevendo">Continuar escrevendo</button>
        <button data-modo title="Alterna entre a área de escrita do app (transcrição online) e a escrita do próprio tablet no campo (sem internet)">Escrita do tablet</button>
        <span class="tp-sit" data-sit></span>
      </div>
      <div class="tp-linha">
        <label class="tp-chk"><input type="checkbox" data-tem-prazo ${t?.prazo ? "checked" : ""}/> Prazo de conclusão</label>
        <input type="date" data-prazo value="${t?.prazo ?? amanha}" ${t?.prazo ? "" : "disabled"} />
      </div>
      <div class="tp-linha"><label for="tp-pasta-sel">Pasta</label><select id="tp-pasta-sel" data-pasta>${opcoesPastas(pastaPadrao)}</select></div>
    </div>`, [
    { rotulo: "Cancelar" },
    { rotulo: "OK", destaque: true, acao: () => (void ok(), false) },
  ], true);
  const campo = $<HTMLTextAreaElement>("[data-titulo]", corpo);
  // com teclado físico (ou no computador), o campo já abre pronto para digitar; só com o teclado
  // da tela o foco fica fora, para ele não cobrir a área de escrita
  if (temTecladoFisico()) campo.focus();
  else (document.activeElement as HTMLElement | null)?.blur();
  // tecla digitada com o foco fora do campo (teclado físico): vai para o campo
  const tecla = (e: KeyboardEvent) => {
    if (!corpo.isConnected) return document.removeEventListener("keydown", tecla);
    if (e.target === campo || (e.target as HTMLElement).closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    e.preventDefault();
    campo.focus();
    campo.setRangeText(e.key, campo.selectionStart, campo.selectionEnd, "end");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  };
  document.addEventListener("keydown", tecla);
  // altura do campo acompanha o texto (várias linhas quando a frase é longa)
  const crescer = () => {
    campo.style.height = "auto";
    campo.style.height = `${campo.scrollHeight + 2}px`;
  };
  campo.addEventListener("input", crescer);
  requestAnimationFrame(crescer);
  const altsEl = $("[data-alts]", corpo);
  const sit = $("[data-sit]", corpo);
  const area = areaEscrita($<HTMLCanvasElement>("[data-tela]", corpo), campo, (alts) => {
    altsEl.innerHTML = alts.length > 1 ? alts.map((a) => `<button data-alt="${escapar(a)}">${escapar(a)}</button>`).join("") : "";
  }, (s) => (sit.textContent = s));
  altsEl.onclick = (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-alt]")?.dataset.alt;
    if (a) area.escolher(a);
  };
  $("[data-desf]", corpo).onclick = () => area.desfazer();
  $("[data-limpa]", corpo).onclick = () => area.limpar();
  const temPrazo = $<HTMLInputElement>("[data-tem-prazo]", corpo);
  const prazo = $<HTMLInputElement>("[data-prazo]", corpo);
  temPrazo.onchange = () => (prazo.disabled = !temPrazo.checked);
  campo.onkeydown = (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    void ok();
  };
  // modo "escrita do tablet": sem a área do app, o campo fica grande para escrever nele com a
  // S Pen (o próprio tablet transcreve, sem internet) ou digitar
  const janelaEl = corpo.closest<HTMLElement>(".wj-janela")!;
  const modoTablet = (ligar: boolean, lembrar = true) => {
    janelaEl.classList.toggle("tp-modo-tablet", ligar);
    $("[data-modo]", corpo).textContent = ligar ? "Área de escrita do app" : "Escrita do tablet";
    if (lembrar) guardarPref("modo-escrita", ligar ? "tablet" : "app");
    campo.placeholder = ligar ? "Escreva aqui com a S Pen ou digite" : "Escreva abaixo com a caneta (ou digite aqui)";
    if (ligar) {
      sit.textContent = "Escreva com a S Pen direto no campo (o tablet transcreve, sem internet) ou digite.";
      campo.focus();
    }
    crescer();
  };
  $("[data-modo]", corpo).onclick = () => modoTablet(!janelaEl.classList.contains("tp-modo-tablet"));
  void reconhecedor().then((r) => {
    // sem internet e sem reconhecedor próprio do navegador: vai direto para a escrita do tablet
    const semRec = !r || (r.online && !navigator.onLine);
    if (semRec || pref("modo-escrita", "app") === "tablet") return modoTablet(true, false);
    sit.textContent = `Escrita: ${r.nome}.`;
  });

  async function ok() {
    await area.concluir();
    const titulo = campo.value.trim();
    if (!titulo) {
      sit.textContent = "Escreva ou digite o texto da tarefa.";
      return;
    }
    const p = $<HTMLSelectElement>("[data-pasta]", corpo).value;
    if (!p) {
      sit.textContent = "Crie uma pasta antes (botão + em Pastas).";
      return;
    }
    const dataPrazo = temPrazo.checked && prazo.value ? prazo.value : null;
    fechar();
    alterar((b) => {
      const agora = agoraISO();
      if (!t) return void criarTarefa(b, p, titulo, dataPrazo, agora);
      if (t.titulo !== titulo || t.prazo !== dataPrazo || t.pasta !== p) Object.assign(t, { titulo, prazo: dataPrazo, pasta: p, atualizado: agora });
    });
  }
}

// ---------- painel ----------

function renderizarPainel() {
  const escopo = tarefasDoEscopo();
  const pn = painel(base, escopo, new Date());
  const est = (s: typeof pn.atendimento) => s ? `<b>${duracao(s.media)}</b><small>média de ${s.n} tarefa(s) · mediana ${duracao(s.mediana)} · mín. ${duracao(s.min)} · máx. ${duracao(s.max)}</small>` : `<b>—</b><small>nenhuma tarefa concluída</small>`;
  const estados = estadosOrdenados(base);
  // tabela por pasta (cada pasta com as subpastas)
  const linhas: string[] = [];
  const andar = (pai: string | null, nivel: number) => {
    for (const p of filhas(base, pai)) {
      const ids = descendentes(base, p.id);
      const ts = base.tarefas.filter((t) => ids.has(t.pasta));
      const x = painel(base, ts, new Date());
      linhas.push(`<tr><td style="padding-left:${8 + nivel * 16}px">${escapar(p.nome)}</td><td>${x.total}</td>${estados.map((e) => `<td>${x.porEstado[e.id] || ""}</td>`).join("")}<td>${x.atrasadas || ""}</td><td>${x.atendimento ? duracao(x.atendimento.media) : ""}</td></tr>`);
      andar(p.id, nivel + 1);
    }
  };
  andar(pastaSel || null, 0);
  conteudo.innerHTML = `
    <div class="tp-cabeca"><h2>Painel — ${escapar(pastaSel ? caminhoPasta(base, pastaSel) : "todas as tarefas")}</h2>
      ${pastaSel ? `<span class="tp-nota">${comSub ? "com as subpastas" : "só esta pasta"}</span>` : ""}</div>
    <div class="tp-blocos">
      <div class="tp-bloco"><span>Total</span><b>${pn.total}</b></div>
      ${estados.map((e) => `<div class="tp-bloco"><span><i class="tp-ponto" style="--cor:${e.cor}"></i>${escapar(e.nome)}</span><b>${pn.porEstado[e.id] ?? 0}</b></div>`).join("")}
      <div class="tp-bloco${pn.atrasadas ? " tp-alerta" : ""}"><span>⚠ Atrasadas</span><b>${pn.atrasadas}</b></div>
      <div class="tp-bloco"><span>Vencem em até ${base.config.diasAlerta} dia(s)</span><b>${pn.vencendo}</b></div>
    </div>
    <div class="tp-blocos tp-largos">
      <div class="tp-bloco"><span>Tempo de atendimento (Novo → Concluído)</span>${est(pn.atendimento)}</div>
      <div class="tp-bloco"><span>Tempo de execução (Em execução → Concluído)</span>${est(pn.execucao)}</div>
      <div class="tp-bloco"><span>Concluídas</span><b>${pn.concluidas7}</b><small>nos últimos 7 dias · ${pn.concluidas30} nos últimos 30</small></div>
    </div>
    ${linhas.length ? `<h3>Por pasta</h3><div class="tp-rolar"><table class="wj-tabela"><thead><tr><th>Pasta</th><th>Total</th>${estados.map((e) => `<th>${escapar(e.nome)}</th>`).join("")}<th>Atrasadas</th><th>Atendimento médio</th></tr></thead><tbody>${linhas.join("")}</tbody></table></div>` : ""}`;
}

// ---------- configurações ----------

function renderizarConfig() {
  const estados = estadosOrdenados(base);
  conteudo.innerHTML = `
    <div class="tp-cabeca"><h2>Configurações</h2></div>
    <section class="tp-secao"><h3>Alertas de prazo</h3>
      <div class="tp-linha"><label for="tp-dias">Avisar com</label><input id="tp-dias" type="number" min="0" max="365" step="1" data-dias value="${base.config.diasAlerta}" style="width:80px" /><span>dia(s) de antecedência (0 = só no dia do prazo e atrasadas)</span></div>
      <label class="tp-chk"><input type="checkbox" data-aviso ${pref("aviso", "1") === "1" ? "checked" : ""}/> Mostrar a janela de prazos ao abrir o WJTaskPlan</label>
      <div class="tp-linha"><button data-ver>Ver alertas agora</button></div>
    </section>
    <section class="tp-secao"><h3>Estados das tarefas</h3>
      <p class="tp-nota">O tipo diz como o estado conta no painel: <b>Início</b> (tarefa nova entra no primeiro), <b>Em andamento</b> e <b>Concluído</b> (encerra o tempo de atendimento).</p>
      <div class="tp-rolar"><table class="wj-tabela tp-estados"><thead><tr><th>Cor</th><th>Nome</th><th>Tipo</th><th></th></tr></thead><tbody>
      ${estados.map((e, k) => `<tr data-e="${e.id}">
        <td><input type="color" data-cor value="${e.cor}" aria-label="Cor" /></td>
        <td><input data-nome value="${escapar(e.nome)}" aria-label="Nome" /></td>
        <td><select data-tipo aria-label="Tipo">${(Object.keys(ROT_TIPO) as TipoEstado[]).map((x) => `<option value="${x}"${x === e.tipo ? " selected" : ""}>${ROT_TIPO[x]}</option>`).join("")}</select></td>
        <td class="tp-acoes"><button data-sobe ${k ? "" : "disabled"} title="Subir">↑</button><button data-desce ${k < estados.length - 1 ? "" : "disabled"} title="Descer">↓</button><button data-tira title="Excluir estado">${IC.apagar}</button></td></tr>`).join("")}
      </tbody></table></div>
      <div class="tp-linha"><button data-novo-estado>${IC.mais} Adicionar estado</button></div>
    </section>
    <section class="tp-secao"><h3>Escrita à mão</h3>
      <p class="tp-nota" data-rec>Verificando o reconhecimento deste aparelho…</p>
      <label class="tp-chk"><input type="checkbox" data-online ${pref("online", "1") === "1" ? "checked" : ""}/> Usar o reconhecimento online do Google quando o aparelho não tiver um próprio (os traços da escrita vão para o Google)</label>
      <p class="tp-nota">No Galaxy Tab, a <b>S Pen para texto</b> do próprio tablet também escreve direto no campo da tarefa, sem internet.</p>
    </section>
    <section class="tp-secao"><h3>Cópias dos dados</h3>
      <p class="tp-nota">As tarefas ficam neste aparelho e na pasta <b>WJTaskPlan/</b>, irmã da pasta WJPDM do cofre, nas mesmas cópias: pasta padrão do dispositivo, pendrive e Google Drive (Meu Drive/WJTaskPlan). Lá ficam <b>tarefas.json</b> (dados) e <b>tarefas.csv</b> (tabela que abre no WJPlan). Entre as cópias, a alteração mais recente de cada tarefa vence.</p>
      <p data-situacao>${escapar(textoSincronia || "Ainda não sincronizado nesta abertura.")}</p>
      <div class="tp-linha"><button data-copias>${IC.pasta} Escolher cópias (pendrive, Drive, pasta)…</button><button class="destaque" data-sinc>${IC.sincronizar} Sincronizar agora</button><button data-csv>${IC.exportar} Baixar tabela (CSV)</button></div>
    </section>`;
  const dias = $<HTMLInputElement>("[data-dias]", conteudo);
  dias.onchange = () => {
    const n = Math.max(0, Math.min(365, Math.round(Number(dias.value) || 0)));
    alterar((b) => (b.config = { diasAlerta: n, atualizado: agoraISO() }));
  };
  $<HTMLInputElement>("[data-aviso]", conteudo).onchange = (e) => guardarPref("aviso", (e.target as HTMLInputElement).checked ? "1" : "0");
  $("[data-ver]", conteudo).onclick = () => mostrarAlertas(true);
  $<HTMLInputElement>("[data-online]", conteudo).onchange = (e) => {
    const v = (e.target as HTMLInputElement).checked;
    guardarPref("online", v ? "1" : "0");
    permitirOnline(v);
    void mostrarReconhecedor();
  };
  const mostrarReconhecedor = async () => {
    const r = await reconhecedor();
    const p = conteudo.querySelector("[data-rec]");
    if (p) p.textContent = r ? `Em uso: ${r.nome}.` : "Sem reconhecimento automático: digite ou use a S Pen direto no campo da tarefa.";
  };
  void mostrarReconhecedor();
  $("[data-copias]", conteudo).onclick = () => void abrirCopias(() => void sincronizar(false));
  $("[data-sinc]", conteudo).onclick = () => void sincronizar(true);
  $("[data-csv]", conteudo).onclick = () => baixar(tabelaCSV(base), "tarefas", "csv", "text/csv");
  $("[data-novo-estado]", conteudo).onclick = () => alterar((b) => b.estados.push({ id: uid(), nome: "Novo estado", cor: "#7b4bb7", tipo: "andamento", ordem: b.estados.length, atualizado: agoraISO() }));
  conteudo.querySelectorAll<HTMLTableRowElement>("tr[data-e]").forEach((tr) => {
    const e = base.estados.find((x) => x.id === tr.dataset.e)!;
    const mudar = (f: (e: Estado) => void) => alterar(() => (f(e), (e.atualizado = agoraISO())));
    $<HTMLInputElement>("[data-cor]", tr).onchange = (ev) => mudar((x) => (x.cor = (ev.target as HTMLInputElement).value));
    $<HTMLInputElement>("[data-nome]", tr).onchange = (ev) => {
      const v = (ev.target as HTMLInputElement).value.trim();
      if (v) mudar((x) => (x.nome = v));
    };
    $<HTMLSelectElement>("[data-tipo]", tr).onchange = (ev) => {
      const v = (ev.target as HTMLSelectElement).value as TipoEstado;
      const outros = base.estados.filter((x) => x.id !== e.id);
      if ((e.tipo === "inicio" && !outros.some((x) => x.tipo === "inicio")) || (e.tipo === "fim" && !outros.some((x) => x.tipo === "fim"))) {
        aviso("É preciso ter ao menos um estado de Início e um de Concluído.");
        return renderizar();
      }
      mudar((x) => (x.tipo = v));
    };
    const trocar = (d: number) => {
      const l = estadosOrdenados(base);
      const k = l.findIndex((x) => x.id === e.id);
      [l[k], l[k + d]] = [l[k + d], l[k]];
      const agora = agoraISO();
      alterar(() => l.forEach((x, j) => x.ordem !== j && ((x.ordem = j), (x.atualizado = agora))));
    };
    $("[data-sobe]", tr).onclick = () => trocar(-1);
    $("[data-desce]", tr).onclick = () => trocar(1);
    $("[data-tira]", tr).onclick = () => removerEstado(e);
  });
}

function removerEstado(e: Estado) {
  const outros = estadosOrdenados(base).filter((x) => x.id !== e.id);
  if (!outros.some((x) => x.tipo === "inicio") || !outros.some((x) => x.tipo === "fim")) return aviso("É preciso ter ao menos um estado de Início e um de Concluído.");
  const n = base.tarefas.filter((t) => t.estado === e.id).length;
  janela(`Excluir o estado "${e.nome}"`, `<p>${n ? `${n} tarefa(s) estão neste estado. Passar para:` : "Nenhuma tarefa está neste estado."}</p>
    ${n ? `<select data-d>${outros.map((x) => `<option value="${x.id}">${escapar(x.nome)}</option>`).join("")}</select>` : ""}`, [
    { rotulo: "Cancelar" },
    { rotulo: "Excluir", destaque: true, acao: (c) => alterar((b) => excluirEstado(b, e.id, c.querySelector<HTMLSelectElement>("[data-d]")?.value ?? outros[0].id, agoraISO())) },
  ]);
}

// ---------- alerta de prazos ----------

function mostrarAlertas(sempre: boolean) {
  const l = alertas(base, hoje());
  if (!l.length) {
    if (sempre) aviso(`Nenhuma tarefa pendente com prazo nos próximos ${base.config.diasAlerta} dia(s).`);
    return;
  }
  const txt = (d: number) => (d < 0 ? `atrasada ${-d} dia(s)` : d === 0 ? "vence hoje" : `vence em ${d} dia(s)`);
  const { corpo, fechar } = janela(`Prazos: ${l.length} tarefa(s) pendente(s)`, `
    <ul class="tp-alertas">${l.map((a) => `<li data-id="${a.tarefa.id}" class="${a.dias < 0 ? "tp-atrasada" : a.dias === 0 ? "tp-hoje" : ""}">
      <span class="tp-ponto" style="--cor:${estadoDe(base, a.tarefa.estado)?.cor ?? "#8a96a3"}"></span>
      <span><b>${escapar(a.tarefa.titulo)}</b><small>${escapar(caminhoPasta(base, a.tarefa.pasta))} · ${escapar(estadoDe(base, a.tarefa.estado)?.nome ?? "")} · prazo ${dataBR(a.tarefa.prazo!)}</small></span>
      <em>${txt(a.dias)}</em></li>`).join("")}</ul>
    <p class="tp-nota">Alerta com ${base.config.diasAlerta} dia(s) de antecedência (Configurações).</p>`, [{ rotulo: "OK", destaque: true }]);
  corpo.querySelectorAll<HTMLElement>("li[data-id]").forEach((li) => (li.onclick = () => {
    const t = base.tarefas.find((x) => x.id === li.dataset.id);
    if (!t) return;
    fechar();
    pastaSel = t.pasta;
    vista = "lista";
    renderizar();
    editarTarefa(t);
  }));
}

let avisoT = 0;
function aviso(msg: string, ms = 4000) {
  let a = document.querySelector<HTMLElement>(".wj-aviso");
  if (!a) document.body.append((a = el("div", { class: "wj-aviso", role: "status" })));
  a.textContent = msg;
  a.hidden = false;
  clearTimeout(avisoT);
  avisoT = window.setTimeout(() => (a!.hidden = true), ms);
}

// ---------- desenhar ----------

function renderizar() {
  if (pastaSel && !base.pastas.some((p) => p.id === pastaSel)) pastaSel = "";
  topo.querySelectorAll<HTMLButtonElement>("[data-v]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === vista)));
  renderizarArvore();
  if (vista === "painel") renderizarPainel();
  else if (vista === "config") renderizarConfig();
  else renderizarLista();
  const abertas = base.tarefas.filter((t) => estadoDe(base, t.estado)?.tipo !== "fim").length;
  const atrasadas = alertas(base, hoje(), -1).length;
  $(".wj-status-texto", status).textContent = `${base.tarefas.length} tarefa(s) · ${abertas} aberta(s)${atrasadas ? ` · ${atrasadas} atrasada(s)` : ""}`;
  document.title = "WJTaskPlan — WJProMaster";
}

/** Teclado físico (capa com teclado, Bluetooth, computador): lembrado quando aparece uma tecla real. */
const temTecladoFisico = () => pref("teclado", "") === "1" || !matchMedia("(pointer: coarse)").matches;
document.addEventListener("keydown", (e) => {
  // o teclado da tela do Android manda "Unidentified"/229; tecla real = teclado físico
  if (e.key !== "Unidentified" && e.keyCode !== 229 && pref("teclado", "") !== "1") guardarPref("teclado", "1");
}, true);
document.addEventListener("keydown", (e) => {
  if (document.querySelector(".wj-fundo") || (e.target as HTMLElement).closest("input, textarea, select")) return;
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    editarTarefa(null);
  }
});

renderizar();
if (pref("aviso", "1") === "1") mostrarAlertas(false);
registrarOffline();
// cópias das tarefas (WJTaskPlan/) e sincronia global do cofre a cada abertura, sem pedir permissão
setTimeout(() => void sincronizar(false), 600);
void sincronizarAoAbrir();
// "Sincronizar agora" da faixa do topo liberou pendrive/Drive: iguala as tarefas também
window.addEventListener(EVENTO_SINCRONIZADO, () => void sincronizar(false));
