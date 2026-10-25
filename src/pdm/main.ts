// WJPDM: cofre de engenharia local (IndexedDB) — pastas, arquivos com versões e revisões,
// check-out/check-in, cartão de dados, fluxo de aprovação, visualização, itens e lista de materiais.
// Regras puras em src/pdm/regras.ts; especificação em docs/global/pdm.md.

import "./pdm.css";
import { $, baixar, Casca, el, escapar, janela, menu, registrarOffline } from "../comum/casca";
import { IC } from "../comum/icones";
import { Armazem, deBase64, paraBase64 } from "./armazem";
import {
  aplicarTransicao, bloqueioDoCheckout, CAMPOS_CARTAO, ESTADOS, explodirBOM, extensao, nomeLivre, ondeEUsado, proximoCodigo, TIPOS_ITEM,
  transicoesDe, type Arquivo, type Item, type Pasta, type TipoItem, type Versao,
} from "./regras";

const RAIZ = "raiz";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const agora = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const quando = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : "");
const tamanho = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1).replace(".", ",")} KB` : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`);

/** Apps do WJProMaster por extensão: chave do salvamento automático e endereço. */
const APPS: Record<string, { app: string; chave: string; url: string }> = {
  wjcad: { app: "WJCAD", chave: "jlscad:documento", url: "cad/#abrir-autosave" },
  jlscad: { app: "WJCAD", chave: "jlscad:documento", url: "cad/#abrir-autosave" },
  wjpl: { app: "WJPlaniel", chave: "wjpl:documento", url: "planilha/" },
  wjdoc: { app: "WJWord", chave: "wjdoc:documento", url: "documento/" },
  wjapn: { app: "WJApion", chave: "wjapn:documento", url: "apresentacao/" },
  wjcron: { app: "WJCronProject", chave: "wjcron:documento", url: "cronograma/" },
};
const TIPOS_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
  txt: "text/plain", csv: "text/csv", md: "text/markdown", json: "application/json", xml: "application/xml", dxf: "application/dxf",
};

interface Meta {
  id: "meta";
  nome: string;
  usuario: string;
  mascara: string;
}

let db: Armazem;
let meta: Meta = { id: "meta", nome: "Cofre local", usuario: "", mascara: "12-####" };
let pastas: Pasta[] = [];
let arquivos: Arquivo[] = [];
let itens: Item[] = [];

type Local = { tipo: "pasta"; id: string } | { tipo: "itens" } | { tipo: "lixeira" } | { tipo: "busca"; q: string };
let local: Local = { tipo: "pasta", id: RAIZ };
let sel: { tipo: "arquivo" | "pasta" | "item"; id: string } | null = null;
let aba = "cartao";
let urlPrevia = "";

const arvore = $("#pd-arvore");
const lista = $<HTMLTableElement>("#pd-lista");
const listaArea = $("#pd-lista-area");
const abasEl = $("#pd-abas");
const conteudo = $("#pd-conteudo");
const busca = $<HTMLInputElement>("#pd-busca");

const arquivoSel = () => (sel?.tipo === "arquivo" ? arquivos.find((a) => a.id === sel!.id) : undefined);
const itemSel = () => (sel?.tipo === "item" ? itens.find((i) => i.id === sel!.id) : undefined);
const pastaAtual = () => (local.tipo === "pasta" ? local.id : RAIZ);
const nomePasta = (id: string) => (id === RAIZ ? meta.nome : pastas.find((p) => p.id === id)?.nome ?? "?");
const versaoAtual = (a: Arquivo) => a.versoes[a.versoes.length - 1];
const usuario = () => meta.usuario || "Usuário";
const gravarArquivo = (a: Arquivo) => db.por("arquivos", a);

function caminho(id: string): Pasta[] {
  const r: Pasta[] = [];
  for (let p = pastas.find((x) => x.id === id); p; p = pastas.find((x) => x.id === p!.pai)) r.unshift(p);
  return r;
}
function subpastas(id: string) {
  return pastas.filter((p) => (p.pai ?? RAIZ) === id).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
function descendentes(id: string): string[] {
  return [id, ...subpastas(id).flatMap((p) => descendentes(p.id))];
}

// ---------- árvore ----------

function renderizarArvore() {
  const ativo = (l: Local) => JSON.stringify(l) === JSON.stringify(local);
  const qt = (id: string) => arquivos.filter((a) => a.pasta === id && !a.lixeira).length;
  let h = "";
  const no = (p: { id: string; nome: string }, nivel: number) => {
    h += `<div class="pd-no${ativo({ tipo: "pasta", id: p.id }) ? " sel" : ""}" data-pasta="${p.id}" style="padding-left:${8 + nivel * 16}px">${p.id === RAIZ ? IC.cadeado : IC.pasta}<span>${escapar(p.nome)}</span><span class="pd-qt">${qt(p.id) || ""}</span></div>`;
    for (const s of subpastas(p.id)) no(s, nivel + 1);
  };
  no({ id: RAIZ, nome: meta.nome }, 0);
  h += "<hr>";
  h += `<div class="pd-no${local.tipo === "itens" ? " sel" : ""}" data-especial="itens">${IC.item}<span>Itens e listas de materiais</span><span class="pd-qt">${itens.length || ""}</span></div>`;
  const lix = arquivos.filter((a) => a.lixeira).length;
  h += `<div class="pd-no${local.tipo === "lixeira" ? " sel" : ""}" data-especial="lixeira">${IC.apagar}<span>Lixeira</span><span class="pd-qt">${lix || ""}</span></div>`;
  arvore.innerHTML = h;
}

arvore.addEventListener("click", (e) => {
  const n = (e.target as HTMLElement).closest<HTMLElement>(".pd-no");
  if (!n) return;
  if (n.dataset.pasta) local = { tipo: "pasta", id: n.dataset.pasta };
  else local = { tipo: n.dataset.especial as "itens" | "lixeira" };
  busca.value = "";
  sel = null;
  document.body.classList.remove("pd-arvore-aberta");
  renderizar();
});
arvore.addEventListener("contextmenu", (e) => {
  const n = (e.target as HTMLElement).closest<HTMLElement>("[data-pasta]");
  if (!n) return;
  e.preventDefault();
  const id = n.dataset.pasta!;
  menu(e.clientX, e.clientY, [
    { rotulo: "Nova pasta aqui", icone: "novaPasta", acao: () => novaPasta(id) },
    ...(id !== RAIZ ? [{ rotulo: "Renomear pasta", icone: "editar" as const, acao: () => renomearPasta(id) }, { rotulo: "Excluir pasta", icone: "apagar" as const, acao: () => void excluirPasta(id) }] : []),
  ]);
});
$("#pd-pastas").onclick = () => document.body.classList.toggle("pd-arvore-aberta");

// ---------- lista ----------

function travaHtml(a: Arquivo) {
  if (!a.checkout) return "";
  const minha = a.checkout.usuario === usuario();
  return `<span class="pd-trava ${minha ? "minha" : "outro"}" title="Check-out de ${escapar(a.checkout.usuario)} em ${quando(a.checkout.data)}">${IC.cadeado}</span>`;
}
const estadoHtml = (a: Arquivo) => `<span class="pd-estado" style="background:${ESTADOS[a.estado].cor}">${ESTADOS[a.estado].nome}</span>`;

function renderizarLista() {
  const cab = (cols: string[]) => `<thead><tr>${cols.map((c) => `<th${c.startsWith("·") ? ' class="pd-opc"' : ""}>${c.replace(/^·/, "")}</th>`).join("")}</tr></thead>`;
  if (local.tipo === "itens") {
    const usos = (id: string) => itens.filter((i) => i.bom.some((l) => l.item === id)).length;
    lista.innerHTML = cab(["", "Código", "Descrição", "·Tipo", "·Unid.", "·Material", "·Arquivos", "·Usado em", "·Componentes"]) + `<tbody>${
      itens.length
        ? [...itens].sort((a, b) => a.codigo.localeCompare(b.codigo)).map((i) => `<tr data-item="${i.id}" class="${sel?.id === i.id ? "sel" : ""}">
          <td class="pd-ic">${IC.item}</td><td>${escapar(i.codigo)}</td><td>${escapar(i.descricao)}</td>
          <td class="pd-opc">${TIPOS_ITEM.find(([k]) => k === i.tipo)?.[1] ?? ""}</td><td class="pd-opc">${escapar(i.unidade)}</td><td class="pd-opc">${escapar(i.material ?? "")}</td>
          <td class="pd-opc">${arquivos.filter((a) => a.item === i.id && !a.lixeira).length || ""}</td><td class="pd-opc">${usos(i.id) || ""}</td><td class="pd-opc">${i.bom.length || ""}</td></tr>`).join("")
        : `<tr><td class="pd-vazio" colspan="9">Nenhum item. Use <b>Itens → Novo item</b> ou crie um item a partir de um arquivo (cartão de dados).</td></tr>`
    }</tbody>`;
    return;
  }
  let fs: Arquivo[];
  let ps: Pasta[] = [];
  if (local.tipo === "lixeira") fs = arquivos.filter((a) => a.lixeira);
  else if (local.tipo === "busca") {
    const q = local.q.toLowerCase();
    fs = arquivos.filter((a) => !a.lixeira && [a.nome, a.cartao.codigo, a.cartao.descricao, a.cartao.material, a.cartao.projeto].some((x) => x?.toLowerCase().includes(q)));
  } else {
    ps = subpastas(local.id);
    fs = arquivos.filter((a) => a.pasta === (local as { id: string }).id && !a.lixeira);
  }
  fs.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const colPasta = local.tipo !== "pasta";
  let corpo = ps.map((p) => `<tr data-pasta="${p.id}" class="${sel?.id === p.id ? "sel" : ""}"><td class="pd-ic">${IC.pasta}</td><td>${escapar(p.nome)}</td><td colspan="9" class="pd-opc"></td></tr>`).join("");
  corpo += fs.map((a) => {
    const v = versaoAtual(a);
    return `<tr data-arquivo="${a.id}" class="${sel?.id === a.id ? "sel" : ""}">
      <td class="pd-ic">${travaHtml(a) || IC.arquivo}</td><td title="${escapar(a.nome)}">${escapar(a.nome)}</td>
      <td>${v.n}</td><td>${a.revisao || "—"}</td><td>${estadoHtml(a)}</td>
      <td class="pd-opc">${escapar(a.checkout?.usuario ?? "")}</td><td class="pd-opc">${escapar(a.cartao.codigo ?? "")}</td>
      <td class="pd-opc">${escapar(a.cartao.descricao ?? "")}</td>${colPasta ? `<td class="pd-opc">${escapar(nomePasta(a.pasta))}</td>` : ""}
      <td class="pd-opc">${tamanho(v.tamanho)}</td><td class="pd-opc">${quando(v.data)}</td></tr>`;
  }).join("");
  if (!corpo) {
    const msg = local.tipo === "lixeira" ? "A lixeira está vazia." : local.tipo === "busca" ? "Nada encontrado." : "Pasta vazia. Arraste arquivos para cá ou use <b>Adicionar</b>.";
    corpo = `<tr><td class="pd-vazio" colspan="11">${msg}</td></tr>`;
  }
  lista.innerHTML = cab(["", "Nome", "Versão", "Rev.", "Estado", "·Check-out", "·Código", "·Descrição", ...(colPasta ? ["·Pasta"] : []), "·Tamanho", "·Modificado"]) + `<tbody>${corpo}</tbody>`;
}

let ultimoClique = { t: 0, id: "" };
lista.addEventListener("click", (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr");
  if (!tr) return;
  // duplo clique/toque detectado aqui: a lista é redesenhada a cada clique e o "dblclick" se perde
  const id = tr.dataset.arquivo ?? tr.dataset.pasta ?? tr.dataset.item ?? "";
  const duplo = Date.now() - ultimoClique.t < 450 && ultimoClique.id === id;
  ultimoClique = { t: duplo ? 0 : Date.now(), id };
  if (duplo) return abrirLinha(tr);
  if (tr.dataset.arquivo) sel = { tipo: "arquivo", id: tr.dataset.arquivo };
  else if (tr.dataset.pasta) sel = { tipo: "pasta", id: tr.dataset.pasta };
  else if (tr.dataset.item) sel = { tipo: "item", id: tr.dataset.item };
  else return;
  if (sel.tipo === "item" && aba !== "item" && aba !== "bom" && aba !== "usado" && aba !== "arquivos") aba = "item";
  if (sel.tipo === "arquivo" && !["cartao", "previa", "versoes", "historico"].includes(aba)) aba = "cartao";
  renderizar();
});
function abrirLinha(tr: HTMLTableRowElement) {
  if (tr.dataset.pasta) {
    local = { tipo: "pasta", id: tr.dataset.pasta };
    sel = null;
    renderizar();
  } else if (tr.dataset.arquivo) {
    const a = arquivos.find((x) => x.id === tr.dataset.arquivo)!;
    if (a.lixeira) return;
    if (APPS[extensao(a.nome)]) void abrirNoApp(a);
    else void obter(a);
  } else if (tr.dataset.item) {
    aba = "bom";
    renderizarPainel();
  }
}
lista.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr");
  if (tr?.dataset.arquivo) {
    sel = { tipo: "arquivo", id: tr.dataset.arquivo };
    renderizar();
    menuArquivo(e.clientX, e.clientY);
  } else if (tr?.dataset.pasta) {
    const id = tr.dataset.pasta;
    menu(e.clientX, e.clientY, [
      { rotulo: "Abrir pasta", icone: "pasta", acao: () => ((local = { tipo: "pasta", id }), (sel = null), renderizar()) },
      { rotulo: "Renomear pasta", icone: "editar", acao: () => renomearPasta(id) },
      { rotulo: "Excluir pasta", icone: "apagar", acao: () => void excluirPasta(id) },
    ]);
  } else if (local.tipo === "pasta") {
    menu(e.clientX, e.clientY, [
      { rotulo: "Adicionar arquivos…", icone: "importar", acao: () => void adicionarDoAparelho() },
      { rotulo: "Nova pasta", icone: "novaPasta", acao: () => novaPasta(pastaAtual()) },
    ]);
  }
});

function menuArquivo(x: number, y: number) {
  const a = arquivoSel();
  if (!a) return;
  if (a.lixeira)
    return menu(x, y, [
      { rotulo: "Restaurar", icone: "desfazer", acao: () => void restaurar(a) },
      { rotulo: "Destruir definitivamente", icone: "apagar", acao: () => void destruir(a) },
    ]);
  const app = APPS[extensao(a.nome)];
  menu(x, y, [
    ...(app ? [{ rotulo: `Abrir no ${app.app}`, icone: "abrir" as const, acao: () => void abrirNoApp(a) }] : []),
    { rotulo: "Obter (baixar)", icone: "exportar", acao: () => void obter(a) },
    "-",
    { rotulo: "Check-out", icone: "checkout", acao: () => void checkout(a) },
    { rotulo: "Check-in…", icone: "checkin", acao: () => checkin(a) },
    { rotulo: "Desfazer check-out", icone: "desfazer", acao: () => void desfazerCheckout(a) },
    { rotulo: "Alterar estado…", icone: "estado", acao: () => alterarEstado(a) },
    "-",
    { rotulo: "Renomear", icone: "editar", acao: () => renomearArquivo(a) },
    { rotulo: "Mover para…", icone: "pasta", acao: () => moverArquivo(a) },
    { rotulo: "Excluir (lixeira)", icone: "apagar", acao: () => void excluirArquivo(a) },
  ]);
}

// arrastar arquivos do aparelho para a lista
listaArea.addEventListener("dragover", (e) => {
  if (local.tipo !== "pasta" || !e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  listaArea.classList.add("soltar");
});
listaArea.addEventListener("dragleave", () => listaArea.classList.remove("soltar"));
listaArea.addEventListener("drop", (e) => {
  listaArea.classList.remove("soltar");
  if (local.tipo !== "pasta" || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  void adicionar([...e.dataTransfer.files], pastaAtual());
});

busca.addEventListener("input", () => {
  const q = busca.value.trim();
  if (q) local = { tipo: "busca", q };
  else if (local.tipo === "busca") local = { tipo: "pasta", id: RAIZ };
  sel = null;
  renderizar();
});

function renderizarMigalhas() {
  const m = $("#pd-migalhas");
  if (local.tipo === "pasta") {
    const partes = [{ id: RAIZ, nome: meta.nome }, ...caminho(local.id)];
    m.innerHTML = partes.map((p, k) => `${k ? "<span>›</span>" : ""}<button data-ir="${p.id}">${escapar(p.nome)}</button>`).join("");
  } else m.innerHTML = `<button data-ir="${RAIZ}">${escapar(meta.nome)}</button><span>›</span><b>${local.tipo === "itens" ? "Itens" : local.tipo === "lixeira" ? "Lixeira" : "Resultados da pesquisa"}</b>`;
}
$("#pd-migalhas").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ir]");
  if (!b) return;
  local = { tipo: "pasta", id: b.dataset.ir! };
  sel = null;
  busca.value = "";
  renderizar();
});

// ---------- painel ----------

function renderizarPainel() {
  if (urlPrevia) URL.revokeObjectURL(urlPrevia), (urlPrevia = "");
  const a = arquivoSel(), it = itemSel();
  const abas: [string, string][] = a
    ? [["cartao", "Cartão de dados"], ["previa", "Visualizar"], ["versoes", `Versões (${a.versoes.length})`], ["historico", "Histórico"]]
    : it ? [["item", "Item"], ["bom", `Lista de materiais (${it.bom.length})`], ["usado", "Onde é usado"], ["arquivos", "Arquivos"]] : [];
  abasEl.innerHTML = abas.map(([k, n]) => `<button role="tab" data-aba="${k}" aria-selected="${k === aba}">${n}</button>`).join("");
  if (a) {
    if (aba === "cartao") return painelCartao(a);
    if (aba === "previa") return void painelPrevia(a);
    if (aba === "versoes") return painelVersoes(a);
    return painelHistorico(a);
  }
  if (it) {
    if (aba === "bom") return painelBOM(it);
    if (aba === "usado") return painelUsado(it);
    if (aba === "arquivos") return painelArquivosDoItem(it);
    return painelItem(it);
  }
  const tot = arquivos.filter((x) => !x.lixeira);
  conteudo.innerHTML = `<p class="pd-dica">Selecione um arquivo para ver o cartão de dados, a visualização, as versões e o histórico.</p>
    <p class="pd-dica">${tot.length} arquivo(s) · ${pastas.length} pasta(s) · ${itens.length} item(ns) · usuário: <b>${escapar(usuario())}</b></p>
    <p class="pd-dica">O cofre fica <b>neste aparelho</b> (funciona sem internet). Faça cópias de segurança em <b>Ferramentas → Exportar cofre</b>; o cofre no servidor, compartilhado pela equipe, chega na fase G5.</p>`;
}
abasEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-aba]");
  if (b) (aba = b.dataset.aba!), renderizarPainel();
});

function painelCartao(a: Arquivo) {
  const editavel = a.checkout?.usuario === usuario();
  conteudo.innerHTML = `<div class="pd-cab"><strong>${escapar(a.nome)}</strong>${estadoHtml(a)}<span>versão ${versaoAtual(a).n} · revisão ${a.revisao || "—"}</span>
      ${a.checkout ? `<span class="pd-trava ${editavel ? "minha" : "outro"}">${IC.cadeado} check-out de ${escapar(a.checkout.usuario)}</span>` : ""}</div>
    ${editavel ? "" : `<p class="pd-dica">${a.checkout ? "Outro usuário está com o arquivo." : "Faça <b>check-out</b> para editar o cartão de dados."}</p>`}
    <div class="pd-cartao">${CAMPOS_CARTAO.map((c) => `<div class="wj-campo"><label>${c.nome}${c.obrigatorioNaRevisao ? " *" : ""}</label>${
      c.lista
        ? `<select data-campo="${c.id}" ${editavel ? "" : "disabled"}>${c.lista.map((o) => `<option${(a.cartao[c.id] ?? "") === o ? " selected" : ""}>${escapar(o)}</option>`).join("")}</select>`
        : `<input data-campo="${c.id}" value="${escapar(a.cartao[c.id] ?? "")}" ${editavel ? "" : "disabled"} />`
    }</div>`).join("")}
      <div class="wj-campo"><label>Item</label><select data-campo="__item" ${editavel ? "" : "disabled"}><option value="">— sem item —</option>${itens.map((i) => `<option value="${i.id}"${i.id === a.item ? " selected" : ""}>${escapar(i.codigo)} — ${escapar(i.descricao)}</option>`).join("")}</select></div>
    </div>
    <div class="pd-acoes"></div>`;
  conteudo.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-campo]").forEach((c) => {
    c.onchange = async () => {
      if (c.dataset.campo === "__item") a.item = c.value || undefined;
      else a.cartao[c.dataset.campo!] = c.value.trim();
      await gravarArquivo(a);
      renderizarLista();
      acoesDoCartao(a, editavel);
    };
  });
  acoesDoCartao(a, editavel);
}

/** Botões do cartão (criar/ver item), redesenhados sem perder o foco dos campos. */
function acoesDoCartao(a: Arquivo, editavel: boolean) {
  const alvo = conteudo.querySelector(".pd-acoes");
  if (!alvo) return;
  const item = itens.find((i) => i.id === a.item);
  alvo.innerHTML = `${editavel && a.cartao.codigo && !itens.some((i) => i.codigo === a.cartao.codigo) ? `<button data-acao="criarItem">Criar item ${escapar(a.cartao.codigo)}</button>` : ""}
    ${item ? `<button data-acao="verItem">Ver item ${escapar(item.codigo)}</button>` : ""}`;
  const ci = alvo.querySelector<HTMLElement>('[data-acao="criarItem"]');
  if (ci) ci.onclick = () => void criarItemDoArquivo(a);
  const vi = alvo.querySelector<HTMLElement>('[data-acao="verItem"]');
  if (vi) vi.onclick = () => ((local = { tipo: "itens" }), (sel = { tipo: "item", id: a.item! }), (aba = "item"), renderizar());
}

async function painelPrevia(a: Arquivo, v: Versao = versaoAtual(a)) {
  const b = await db.blob(v.blob);
  if (!b) return void (conteudo.innerHTML = `<p class="pd-dica">Conteúdo não encontrado.</p>`);
  if (arquivoSel() !== a || aba !== "previa") return;
  const ext = extensao(a.nome);
  const tipo = TIPOS_MIME[ext];
  if (tipo?.startsWith("image/") || tipo === "application/pdf") {
    urlPrevia = URL.createObjectURL(new Blob([b], { type: tipo }));
    conteudo.innerHTML = tipo === "application/pdf" ? `<iframe class="pd-previa" src="${urlPrevia}" title="Visualização"></iframe>` : `<img class="pd-previa-img" src="${urlPrevia}" alt="${escapar(a.nome)}" />`;
    return;
  }
  const texto = b.size < 5_000_000 ? await b.text() : "";
  const app = APPS[ext];
  if (app) {
    let resumo = "";
    try {
      const d = JSON.parse(texto);
      if (ext === "wjcad" || ext === "jlscad") {
        const fs = (d.features ?? []) as { tipo?: string; nome?: string }[];
        resumo = `<p>Peça <b>${escapar(d.nome ?? a.nome)}</b> · ${fs.length} recurso(s)</p><ol>${fs.slice(0, 60).map((f) => `<li>${escapar(f.nome ?? f.tipo ?? "")}</li>`).join("")}</ol>`;
      } else if (ext === "wjpl") resumo = `<p>Pasta de trabalho com ${d.folhas?.length ?? 0} folha(s): ${(d.folhas ?? []).map((f: { nome: string; celulas?: object }) => `<b>${escapar(f.nome)}</b> (${Object.keys(f.celulas ?? {}).length} células)`).join(", ")}</p>`;
      else if (ext === "wjdoc") {
        urlPrevia = URL.createObjectURL(new Blob([`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:800px;margin:auto;padding:16px">${d.html ?? ""}</body>`], { type: "text/html" }));
        return void (conteudo.innerHTML = `<iframe class="pd-previa" sandbox src="${urlPrevia}" title="Visualização"></iframe>`);
      } else if (ext === "wjapn") resumo = `<p>${d.slides?.length ?? 0} slide(s)</p><ol>${(d.slides ?? []).map((s: { objetos?: { papel?: string; html?: string }[] }) => `<li>${escapar((s.objetos?.find((o) => o.papel === "titulo")?.html ?? "(sem título)").replace(/<[^>]+>/g, ""))}</li>`).join("")}</ol>`;
      else if (ext === "wjcron") resumo = `<p>Projeto com ${d.tarefas?.length ?? 0} tarefa(s), início ${escapar(d.inicio ?? "")}</p><ol>${(d.tarefas ?? []).slice(0, 60).map((t: { nome: string; nivel: number }) => `<li style="margin-left:${(t.nivel - 1) * 14}px">${escapar(t.nome)}</li>`).join("")}</ol>`;
    } catch {
      resumo = `<p class="pd-dica">Não foi possível ler o conteúdo.</p>`;
    }
    conteudo.innerHTML = `${resumo}<div class="pd-acoes"><button class="destaque" data-acao="abrir">Abrir no ${app.app}</button></div>`;
    conteudo.querySelector<HTMLElement>('[data-acao="abrir"]')!.onclick = () => void abrirNoApp(a);
    return;
  }
  if (tipo?.startsWith("text/") || ["json", "xml", "dxf", "txt", "csv", "md"].includes(ext)) {
    conteudo.innerHTML = `<pre class="pd-previa-txt">${escapar(texto.slice(0, 40000))}${texto.length > 40000 ? "\n…" : ""}</pre>`;
    return;
  }
  conteudo.innerHTML = `<p class="pd-dica">Sem visualização para arquivos .${escapar(ext || "?")} (${tamanho(b.size)}). Use <b>Obter</b> para baixar.</p>`;
}

function painelVersoes(a: Arquivo) {
  const podeRestaurar = a.checkout?.usuario === usuario();
  conteudo.innerHTML = `<table class="pd-tab"><thead><tr><th>Versão</th><th>Revisão</th><th>Estado</th><th>Data</th><th>Autor</th><th>Comentário</th><th>Tamanho</th><th></th></tr></thead><tbody>
    ${[...a.versoes].reverse().map((v) => `<tr><td>${v.n}</td><td>${v.revisao || "—"}</td><td>${ESTADOS[v.estado]?.nome ?? ""}</td><td>${quando(v.data)}</td><td>${escapar(v.autor)}</td><td>${escapar(v.comentario)}</td><td>${tamanho(v.tamanho)}</td>
      <td style="white-space:nowrap"><button data-obter="${v.n}">Obter</button>${podeRestaurar && v !== versaoAtual(a) ? ` <button data-restaurar="${v.n}" title="Cria uma versão nova com este conteúdo">Restaurar</button>` : ""}</td></tr>`).join("")}
    </tbody></table>`;
  conteudo.querySelectorAll<HTMLElement>("[data-obter]").forEach((b) => (b.onclick = () => void obter(a, a.versoes.find((v) => v.n === Number(b.dataset.obter)))));
  conteudo.querySelectorAll<HTMLElement>("[data-restaurar]").forEach((b) => {
    b.onclick = async () => {
      const v = a.versoes.find((x) => x.n === Number(b.dataset.restaurar))!;
      const dados = await db.blob(v.blob);
      if (dados) await novaVersao(a, dados, `Restaurada da versão ${v.n}`);
    };
  });
}

function painelHistorico(a: Arquivo) {
  conteudo.innerHTML = `<table class="pd-tab"><thead><tr><th>Data</th><th>Usuário</th><th>Evento</th></tr></thead><tbody>
    ${[...a.historico].reverse().map((h) => `<tr><td style="white-space:nowrap">${quando(h.data)}</td><td>${escapar(h.usuario)}</td><td>${escapar(h.texto)}</td></tr>`).join("")}</tbody></table>`;
}

// ---------- itens e lista de materiais ----------

function painelItem(it: Item) {
  conteudo.innerHTML = `<div class="pd-cartao">
    <div class="wj-campo"><label>Código</label><input data-c="codigo" value="${escapar(it.codigo)}" /></div>
    <div class="wj-campo"><label>Descrição</label><input data-c="descricao" value="${escapar(it.descricao)}" /></div>
    <div class="wj-campo"><label>Tipo</label><select data-c="tipo">${TIPOS_ITEM.map(([k, n]) => `<option value="${k}"${it.tipo === k ? " selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="wj-campo"><label>Unidade</label><input data-c="unidade" value="${escapar(it.unidade)}" /></div>
    <div class="wj-campo"><label>Material</label><input data-c="material" value="${escapar(it.material ?? "")}" /></div>
    <div class="wj-campo"><label>Massa (kg)</label><input data-c="massa" type="number" step="0.001" min="0" value="${it.massa ?? ""}" /></div>
    <div class="wj-campo" style="grid-column:1/-1"><label>Observação</label><input data-c="obs" value="${escapar(it.obs ?? "")}" /></div>
  </div><div class="pd-acoes"><button class="perigo" data-acao="excluir">Excluir item</button></div>`;
  conteudo.querySelectorAll<HTMLInputElement>("[data-c]").forEach((c) => {
    c.onchange = async () => {
      const k = c.dataset.c!;
      if (k === "codigo") {
        const v = c.value.trim();
        if (!v || itens.some((x) => x !== it && x.codigo === v)) return casca.avisar("Código vazio ou já usado por outro item."), (c.value = it.codigo);
        it.codigo = v;
      } else if (k === "massa") it.massa = c.value ? Number(c.value) : undefined;
      else if (k === "tipo") it.tipo = c.value as TipoItem;
      else (it as unknown as Record<string, string>)[k] = c.value.trim();
      await db.por("itens", it);
      renderizarLista();
      renderizarArvore();
    };
  });
  conteudo.querySelector<HTMLElement>('[data-acao="excluir"]')!.onclick = () => void excluirItem(it);
}

function painelBOM(it: Item) {
  const opcoes = (selId: string) => itens.filter((x) => x.id !== it.id).sort((a, b) => a.codigo.localeCompare(b.codigo)).map((x) => `<option value="${x.id}"${x.id === selId ? " selected" : ""}>${escapar(x.codigo)} — ${escapar(x.descricao)}</option>`).join("");
  const ex = explodirBOM(itens, it.id);
  conteudo.innerHTML = `<table class="pd-tab"><thead><tr><th style="width:60px">Pos.</th><th>Componente</th><th style="width:90px">Qtd.</th><th style="width:60px">Unid.</th><th>Observação</th><th style="width:40px"></th></tr></thead><tbody>
    ${it.bom.map((l, k) => `<tr data-k="${k}"><td><input data-l="pos" value="${escapar(l.pos ?? String(k + 1))}" /></td><td><select data-l="item">${opcoes(l.item)}</select></td>
      <td><input data-l="qtd" type="number" min="0" step="any" value="${l.qtd}" /></td><td>${escapar(itens.find((x) => x.id === l.item)?.unidade ?? "")}</td>
      <td><input data-l="obs" value="${escapar(l.obs ?? "")}" /></td><td><button data-rem title="Remover">✕</button></td></tr>`).join("")}
    </tbody></table>
    <div class="pd-acoes"><button data-acao="mais">+ Componente</button><button data-acao="csv">Exportar lista (CSV)</button></div>
    <h4 style="margin:14px 0 6px">Lista explodida (todos os níveis)</h4>
    ${typeof ex === "string" ? `<p style="color:var(--erro)">${escapar(ex)}</p>` : ex.length ? `<table class="pd-tab"><thead><tr><th>Nível</th><th>Código</th><th>Descrição</th><th>Qtd. por</th><th>Qtd. total</th></tr></thead><tbody>${ex.map((l) => `<tr><td>${"·".repeat(l.nivel - 1)}${l.nivel}</td><td>${escapar(l.item.codigo)}</td><td>${escapar(l.item.descricao)}</td><td>${l.qtd}</td><td>${Math.round(l.total * 1000) / 1000} ${escapar(l.item.unidade)}</td></tr>`).join("")}</tbody></table>` : `<p class="pd-dica">Sem componentes.</p>`}`;
  const salvar = async () => {
    await db.por("itens", it);
    renderizarLista();
    renderizarPainel();
  };
  conteudo.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-l]").forEach((c) => {
    c.onchange = () => {
      const l = it.bom[Number(c.closest("tr")!.dataset.k)];
      const k = c.dataset.l!;
      if (k === "qtd") l.qtd = Math.max(0, Number(c.value) || 0);
      else if (k === "item") l.item = c.value;
      else (l as unknown as Record<string, string>)[k] = c.value.trim();
      void salvar();
    };
  });
  conteudo.querySelectorAll<HTMLElement>("[data-rem]").forEach((b) => (b.onclick = () => (it.bom.splice(Number(b.closest("tr")!.dataset.k), 1), void salvar())));
  conteudo.querySelector<HTMLElement>('[data-acao="mais"]')!.onclick = () => {
    const outro = itens.find((x) => x.id !== it.id);
    if (!outro) return casca.avisar("Cadastre outros itens para usá-los como componentes.");
    it.bom.push({ item: outro.id, qtd: 1, pos: String(it.bom.length + 1) });
    void salvar();
  };
  conteudo.querySelector<HTMLElement>('[data-acao="csv"]')!.onclick = () => exportarBOM(it);
}

function painelUsado(it: Item) {
  const u = ondeEUsado(itens, it.id);
  conteudo.innerHTML = u.length
    ? `<table class="pd-tab"><thead><tr><th>Nível</th><th>Código</th><th>Descrição</th></tr></thead><tbody>${u.map((x) => `<tr><td>${x.nivel}</td><td>${escapar(x.item.codigo)}</td><td>${escapar(x.item.descricao)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="pd-dica">${escapar(it.codigo)} não é usado em nenhuma lista de materiais.</p>`;
}

function painelArquivosDoItem(it: Item) {
  const fs = arquivos.filter((a) => a.item === it.id && !a.lixeira);
  conteudo.innerHTML = fs.length
    ? `<table class="pd-tab"><thead><tr><th>Arquivo</th><th>Pasta</th><th>Versão</th><th>Rev.</th><th>Estado</th></tr></thead><tbody>${fs.map((a) => `<tr data-ir="${a.id}" style="cursor:pointer"><td>${escapar(a.nome)}</td><td>${escapar(nomePasta(a.pasta))}</td><td>${versaoAtual(a).n}</td><td>${a.revisao || "—"}</td><td>${estadoHtml(a)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="pd-dica">Nenhum arquivo ligado. Ligue no cartão de dados do arquivo (campo Item).</p>`;
  conteudo.querySelectorAll<HTMLElement>("[data-ir]").forEach((tr) => {
    tr.onclick = () => {
      const a = arquivos.find((x) => x.id === tr.dataset.ir)!;
      local = { tipo: "pasta", id: a.pasta };
      sel = { tipo: "arquivo", id: a.id };
      aba = "cartao";
      renderizar();
    };
  });
}

async function novoItem(dados: Partial<Item> = {}) {
  const it: Item = { id: uid(), codigo: proximoCodigo(meta.mascara, itens.map((i) => i.codigo)), descricao: "Novo item", tipo: "fabricado", unidade: "pç", bom: [], ...dados };
  itens.push(it);
  await db.por("itens", it);
  local = { tipo: "itens" };
  sel = { tipo: "item", id: it.id };
  aba = "item";
  renderizar();
  return it;
}

async function criarItemDoArquivo(a: Arquivo) {
  const it = await novoItem({ codigo: a.cartao.codigo, descricao: a.cartao.descricao || a.nome, material: a.cartao.material || undefined });
  a.item = it.id;
  await gravarArquivo(a);
  casca.avisar(`Item ${it.codigo} criado e ligado a ${a.nome}.`);
}

async function excluirItem(it: Item) {
  const usado = ondeEUsado(itens, it.id);
  if (usado.length) return casca.avisar(`${it.codigo} é usado em ${usado.map((u) => u.item.codigo).join(", ")}: remova das listas antes.`, 6000);
  if (!confirm(`Excluir o item ${it.codigo}?`)) return;
  itens = itens.filter((x) => x !== it);
  await db.apagar("itens", it.id);
  for (const a of arquivos.filter((x) => x.item === it.id)) (a.item = undefined), await gravarArquivo(a);
  sel = null;
  renderizar();
}

function exportarBOM(it: Item) {
  const ex = explodirBOM(itens, it.id);
  if (typeof ex === "string") return casca.avisar(ex);
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lin = ex.map((l) => [String(l.nivel), l.item.codigo, l.item.descricao, String(l.qtd).replace(".", ","), String(Math.round(l.total * 1000) / 1000).replace(".", ","), l.item.unidade, l.item.material ?? ""].map(q).join(";"));
  baixar(`﻿Nível;Código;Descrição;Qtd. por;Qtd. total;Unidade;Material\r\n${lin.join("\r\n")}`, `Lista ${it.codigo}`, "csv", "text/csv");
}

// ---------- operações de arquivo ----------

function historico(a: Arquivo, texto: string) {
  a.historico.push({ data: agora(), usuario: usuario(), texto });
}

async function adicionar(files: File[], pasta: string) {
  const pastaCartao = [...caminho(pasta)].reverse().find((p) => p.cartao?.projeto)?.cartao?.projeto;
  for (const f of files) {
    const nomes = arquivos.filter((a) => a.pasta === pasta && !a.lixeira).map((a) => a.nome);
    const nome = nomeLivre(f.name, nomes);
    const blob = uid();
    await db.porBlob(blob, f);
    const base = f.name.replace(/\.[^.]+$/, "");
    const a: Arquivo = {
      id: uid(), nome, pasta, revisao: "", estado: "trabalho", historico: [],
      cartao: { descricao: base, projetista: usuario(), ...(pastaCartao ? { projeto: pastaCartao } : {}) },
      versoes: [{ n: 1, blob, tamanho: f.size, autor: usuario(), data: agora(), comentario: "Adicionado ao cofre", revisao: "", estado: "trabalho" }],
    };
    historico(a, `Adicionado ao cofre${nome !== f.name ? ` (renomeado de ${f.name})` : ""}`);
    arquivos.push(a);
    await gravarArquivo(a);
    sel = { tipo: "arquivo", id: a.id };
  }
  aba = "cartao";
  casca.avisar(`${files.length} arquivo(s) adicionado(s) em ${nomePasta(pasta)}.`);
  renderizar();
}

function escolherVarios(): Promise<File[]> {
  return new Promise((ok) => {
    const inp = el("input", { type: "file", multiple: "" }) as HTMLInputElement;
    inp.onchange = () => ok([...(inp.files ?? [])]);
    inp.click();
  });
}
async function adicionarDoAparelho() {
  if (local.tipo !== "pasta") return casca.avisar("Abra uma pasta do cofre para adicionar arquivos.");
  const fs = await escolherVarios();
  if (fs.length) await adicionar(fs, pastaAtual());
}

async function obter(a: Arquivo, v: Versao = versaoAtual(a)) {
  const b = await db.blob(v.blob);
  if (!b) return casca.avisar("Conteúdo não encontrado no cofre.");
  const ext = extensao(a.nome);
  const base = ext ? a.nome.slice(0, -(ext.length + 1)) : a.nome;
  baixar(b, v === versaoAtual(a) ? base : `${base} (versão ${v.n})`, ext || "bin", TIPOS_MIME[ext] ?? "application/octet-stream");
}

async function checkout(a: Arquivo) {
  const b = bloqueioDoCheckout(a, usuario());
  if (b) return casca.avisar(b, 5000);
  a.checkout = { usuario: usuario(), data: agora() };
  historico(a, "Check-out");
  await gravarArquivo(a);
  renderizar();
}

async function desfazerCheckout(a: Arquivo) {
  if (!a.checkout) return casca.avisar("O arquivo não está com check-out.");
  if (a.checkout.usuario !== usuario() && !confirm(`O check-out é de ${a.checkout.usuario}. Liberar mesmo assim (como administrador)?`)) return;
  historico(a, a.checkout.usuario === usuario() ? "Check-out desfeito" : `Check-out de ${a.checkout.usuario} liberado pelo administrador`);
  delete a.checkout;
  await gravarArquivo(a);
  renderizar();
}

async function novaVersao(a: Arquivo, dados: Blob, comentario: string) {
  const blob = uid();
  await db.porBlob(blob, dados);
  const n = versaoAtual(a).n + 1;
  a.versoes.push({ n, blob, tamanho: dados.size, autor: usuario(), data: agora(), comentario, revisao: a.revisao, estado: a.estado });
  historico(a, `Versão ${n}${comentario ? ` — ${comentario}` : ""}`);
  await gravarArquivo(a);
  renderizar();
}

function checkin(a: Arquivo) {
  if (a.checkout?.usuario !== usuario()) return casca.avisar(a.checkout ? `O check-out é de ${a.checkout.usuario}.` : "Faça o check-out antes do check-in.");
  const app = APPS[extensao(a.nome)];
  const temNoApp = app && localStorage.getItem(app.chave);
  const { corpo } = janela(`Check-in — ${a.nome}`, `
    <div class="wj-campo"><label>Conteúdo da nova versão</label>
      <label><input type="radio" name="fonte" value="aparelho" ${temNoApp ? "" : "checked"}/> Arquivo do aparelho…</label>
      ${app ? `<label><input type="radio" name="fonte" value="app" ${temNoApp ? "checked" : "disabled"}/> Documento aberto no ${app.app}${temNoApp ? "" : " (nenhum)"}</label>` : ""}
      <label><input type="radio" name="fonte" value="nada"/> Só o cartão de dados (sem versão nova)</label></div>
    <div class="wj-campo"><label>Comentário</label><input id="ck-com" placeholder="O que mudou?" /></div>
    <label><input id="ck-manter" type="checkbox"/> Manter o check-out</label>`, [
    { rotulo: "Cancelar" },
    {
      rotulo: "Check-in", destaque: true, acao: (b) => {
        const fonte = (b.querySelector('input[name="fonte"]:checked') as HTMLInputElement | null)?.value ?? "aparelho";
        const com = (b.querySelector("#ck-com") as HTMLInputElement).value.trim();
        const manter = (b.querySelector("#ck-manter") as HTMLInputElement).checked;
        const finalizar = async (dados?: Blob) => {
          if (dados) await novaVersao(a, dados, com);
          else historico(a, `Check-in sem versão nova${com ? ` — ${com}` : ""}`);
          if (!manter) delete a.checkout, historico(a, "Check-in");
          await gravarArquivo(a);
          renderizar();
        };
        if (fonte === "app") {
          const txt = localStorage.getItem(app!.chave);
          if (!txt) return void casca.avisar(`Não há documento aberto no ${app!.app}.`), false;
          void finalizar(new Blob([txt], { type: "application/json" }));
        } else if (fonte === "aparelho") {
          void escolherVarios().then((fs) => (fs[0] ? finalizar(fs[0]) : casca.avisar("Nenhum arquivo escolhido: check-in cancelado.")));
        } else void finalizar();
      },
    },
  ]);
  (corpo.querySelector("#ck-com") as HTMLInputElement).focus();
}

async function abrirNoApp(a: Arquivo) {
  const app = APPS[extensao(a.nome)];
  if (!app) return obter(a);
  const b = await db.blob(versaoAtual(a).blob);
  if (!b) return casca.avisar("Conteúdo não encontrado.");
  let texto = await b.text();
  try {
    const d = JSON.parse(texto);
    d.nome = a.nome.replace(/\.[^.]+$/, "");
    texto = JSON.stringify(d);
  } catch {
    return casca.avisar("O arquivo não é um documento válido do " + app.app + ".");
  }
  const atual = localStorage.getItem(app.chave);
  if (atual && atual !== texto && !confirm(`O documento aberto no ${app.app} neste aparelho será substituído por ${a.nome}. Se ele tiver alterações sem salvar, salve antes. Continuar?`)) return;
  if (a.checkout?.usuario !== usuario()) casca.avisar("Aberto sem check-out: as alterações não poderão voltar ao cofre sem check-out.", 6000);
  localStorage.setItem(app.chave, texto);
  location.href = `${import.meta.env.BASE_URL}${app.url}`;
}

function alterarEstado(a: Arquivo) {
  const ts = transicoesDe(a);
  if (!ts.length) return casca.avisar("Não há transições a partir deste estado.");
  const { corpo } = janela(`Alterar estado — ${a.nome}`, `
    <p>Estado atual: ${estadoHtml(a)} · revisão ${a.revisao || "—"}</p>
    <div class="wj-campo">${ts.map(({ t, bloqueio }, k) => `<label style="display:block;margin:4px 0"><input type="radio" name="tr" value="${t.id}" ${bloqueio ? "disabled" : k === ts.findIndex((x) => !x.bloqueio) ? "checked" : ""}/> ${escapar(t.nome)} → ${ESTADOS[t.para].nome}${bloqueio ? `<br><small style="color:var(--erro);margin-left:22px">${escapar(bloqueio)}</small>` : ""}</label>`).join("")}</div>
    <div class="wj-campo"><label>Comentário</label><input id="tr-com" /></div>`, [
    { rotulo: "Cancelar" },
    {
      rotulo: "Executar", destaque: true, acao: (b) => {
        const id = (b.querySelector('input[name="tr"]:checked') as HTMLInputElement | null)?.value;
        const t = ts.find((x) => x.t.id === id);
        if (!t || t.bloqueio) return void casca.avisar("Escolha uma transição disponível."), false;
        aplicarTransicao(a, t.t, usuario(), agora(), (b.querySelector("#tr-com") as HTMLInputElement).value.trim());
        void gravarArquivo(a).then(renderizar);
      },
    },
  ]);
  void corpo;
}

function renomearArquivo(a: Arquivo) {
  if (a.checkout && a.checkout.usuario !== usuario()) return casca.avisar(`Check-out de ${a.checkout.usuario}.`);
  if (ESTADOS[a.estado].bloqueado) return casca.avisar(`Arquivo "${ESTADOS[a.estado].nome}" não pode ser renomeado.`);
  pedirTexto("Renomear arquivo", "Nome", a.nome, async (n) => {
    if (arquivos.some((x) => x !== a && x.pasta === a.pasta && !x.lixeira && x.nome.toLowerCase() === n.toLowerCase())) return "Já existe um arquivo com esse nome na pasta.";
    historico(a, `Renomeado de ${a.nome} para ${n}`);
    a.nome = n;
    await gravarArquivo(a);
    renderizar();
  });
}

function moverArquivo(a: Arquivo) {
  if (a.checkout && a.checkout.usuario !== usuario()) return casca.avisar(`Check-out de ${a.checkout.usuario}.`);
  const opc = (id: string, nivel: number): string => `<option value="${id}"${id === a.pasta ? " selected" : ""}>${"  ".repeat(nivel)}${escapar(nomePasta(id))}</option>` + subpastas(id).map((p) => opc(p.id, nivel + 1)).join("");
  janela(`Mover ${a.nome}`, `<div class="wj-campo"><label>Pasta de destino</label><select id="mv-p">${opc(RAIZ, 0)}</select></div>`, [
    { rotulo: "Cancelar" },
    {
      rotulo: "Mover", destaque: true, acao: (b) => {
        const p = (b.querySelector("#mv-p") as HTMLSelectElement).value;
        if (p === a.pasta) return;
        a.nome = nomeLivre(a.nome, arquivos.filter((x) => x.pasta === p && !x.lixeira).map((x) => x.nome));
        historico(a, `Movido de ${nomePasta(a.pasta)} para ${nomePasta(p)}`);
        a.pasta = p;
        void gravarArquivo(a).then(renderizar);
      },
    },
  ]);
}

async function excluirArquivo(a: Arquivo) {
  if (a.checkout) return casca.avisar(`Está com check-out de ${a.checkout.usuario}: faça o check-in ou desfaça antes.`);
  if (a.estado === "liberado") return casca.avisar("Arquivo liberado não pode ser excluído (torne-o obsoleto antes).");
  a.lixeira = true;
  historico(a, "Enviado para a lixeira");
  await gravarArquivo(a);
  sel = null;
  renderizar();
}
async function restaurar(a: Arquivo) {
  a.lixeira = undefined;
  if (a.pasta !== RAIZ && !pastas.some((p) => p.id === a.pasta)) a.pasta = RAIZ;
  a.nome = nomeLivre(a.nome, arquivos.filter((x) => x !== a && x.pasta === a.pasta && !x.lixeira).map((x) => x.nome));
  historico(a, "Restaurado da lixeira");
  await gravarArquivo(a);
  renderizar();
}
async function destruir(a: Arquivo) {
  if (!confirm(`Destruir ${a.nome} e todas as ${a.versoes.length} versões? Não dá para desfazer.`)) return;
  for (const v of a.versoes) await db.apagar("blobs", v.blob);
  await db.apagar("arquivos", a.id);
  arquivos = arquivos.filter((x) => x !== a);
  sel = null;
  renderizar();
}

// ---------- pastas ----------

function pedirTexto(titulo: string, rotulo: string, valor: string, ok: (v: string) => Promise<string | void> | string | void) {
  const { corpo } = janela(titulo, `<div class="wj-campo"><label>${escapar(rotulo)}</label><input id="pt-v" value="${escapar(valor)}" /></div>`, [
    { rotulo: "Cancelar" },
    {
      rotulo: "OK", destaque: true, acao: (b) => {
        const v = (b.querySelector("#pt-v") as HTMLInputElement).value.trim().replace(/[\\/:*?"<>|]/g, "_");
        if (!v) return false;
        void Promise.resolve(ok(v)).then((erro) => erro && casca.avisar(erro));
      },
    },
  ]);
  const inp = corpo.querySelector("#pt-v") as HTMLInputElement;
  inp.select();
  inp.onkeydown = (e) => e.key === "Enter" && (corpo.closest(".wj-janela")!.querySelector<HTMLElement>("footer button:last-child")!.click());
}

function novaPasta(pai = pastaAtual()) {
  pedirTexto("Nova pasta", "Nome da pasta", "Nova pasta", async (nome) => {
    if (subpastas(pai).some((p) => p.nome.toLowerCase() === nome.toLowerCase())) return "Já existe uma pasta com esse nome.";
    const p: Pasta = { id: uid(), nome, pai: pai === RAIZ ? null : pai };
    pastas.push(p);
    await db.por("pastas", p);
    local = { tipo: "pasta", id: p.id };
    sel = null;
    renderizar();
  });
}
function renomearPasta(id: string) {
  const p = pastas.find((x) => x.id === id);
  if (!p) return;
  pedirTexto("Renomear pasta", "Nome da pasta", p.nome, async (nome) => {
    if (subpastas(p.pai ?? RAIZ).some((x) => x !== p && x.nome.toLowerCase() === nome.toLowerCase())) return "Já existe uma pasta com esse nome.";
    p.nome = nome;
    await db.por("pastas", p);
    renderizar();
  });
}
async function excluirPasta(id: string) {
  const ids = descendentes(id);
  if (arquivos.some((a) => ids.includes(a.pasta) && !a.lixeira)) return casca.avisar("A pasta (ou uma subpasta) tem arquivos: mova ou exclua os arquivos antes.", 5000);
  for (const k of ids) {
    pastas = pastas.filter((p) => p.id !== k);
    await db.apagar("pastas", k);
  }
  if (local.tipo === "pasta" && ids.includes(local.id)) local = { tipo: "pasta", id: RAIZ };
  sel = null;
  renderizar();
}

// ---------- ferramentas: usuário, máscara, cópia de segurança ----------

function configurar(primeiraVez = false) {
  janela(primeiraVez ? "Bem-vindo ao WJPDM" : "Usuário e cofre", `
    ${primeiraVez ? `<p>O cofre guarda seus arquivos de engenharia <b>neste aparelho</b>, com versões, revisões, check-out/check-in e aprovação. Informe seu nome: ele aparece no histórico e nos check-outs.</p>` : ""}
    <div class="wj-campo"><label>Seu nome (usuário)</label><input id="cf-u" value="${escapar(meta.usuario)}" placeholder="ex.: Johann" /></div>
    <div class="wj-campo"><label>Nome do cofre</label><input id="cf-n" value="${escapar(meta.nome)}" /></div>
    <div class="wj-campo"><label>Máscara de código dos itens (# = dígito)</label><input id="cf-m" value="${escapar(meta.mascara)}" /></div>`, [
    {
      rotulo: "OK", destaque: true, acao: (b) => {
        const u = (b.querySelector("#cf-u") as HTMLInputElement).value.trim();
        if (!u) return void casca.avisar("Informe o seu nome."), false;
        meta.usuario = u;
        meta.nome = (b.querySelector("#cf-n") as HTMLInputElement).value.trim() || "Cofre local";
        meta.mascara = (b.querySelector("#cf-m") as HTMLInputElement).value.trim() || "12-####";
        void db.por("meta", meta).then(renderizar);
      },
    },
  ]);
}

async function exportarCofre() {
  casca.avisar("Preparando a cópia de segurança…");
  const blobs: Record<string, { t: string; d: string }> = {};
  for (const a of arquivos) for (const v of a.versoes) {
    const b = await db.blob(v.blob);
    if (b) blobs[v.blob] = { t: b.type, d: await paraBase64(b) };
  }
  const dados = { formato: "wjpdm-copia", versao: 1, data: agora(), meta, pastas, arquivos, itens, blobs };
  baixar(JSON.stringify(dados), `${meta.nome} ${agora().slice(0, 10)}`, "wjpdm", "application/json");
}

async function importarCofre() {
  const [f] = await escolherVarios();
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.formato !== "wjpdm-copia") throw new Error("Não é uma cópia de segurança do WJPDM (.wjpdm).");
    if (!confirm(`Substituir o cofre deste aparelho pela cópia de ${String(d.data).slice(0, 10)} (${d.arquivos.length} arquivos)? O conteúdo atual será apagado.`)) return;
    await db.limparTudo();
    for (const [id, b] of Object.entries(d.blobs as Record<string, { t: string; d: string }>)) await db.porBlob(id, deBase64(b.d, b.t));
    for (const p of d.pastas) await db.por("pastas", p);
    for (const a of d.arquivos) await db.por("arquivos", a);
    for (const i of d.itens) await db.por("itens", i);
    await db.por("meta", { ...d.meta, usuario: meta.usuario || d.meta.usuario });
    await carregar();
    casca.avisar("Cofre restaurado.");
  } catch (e) {
    casca.avisar(e instanceof Error ? e.message : "Cópia inválida.", 6000);
  }
}

async function armazenamento() {
  const est = await navigator.storage?.estimate?.();
  const persistente = await navigator.storage?.persisted?.();
  janela("Armazenamento", `
    <p>Uso neste site: <b>${est?.usage ? tamanho(est.usage) : "?"}</b> de ${est?.quota ? tamanho(est.quota) : "?"} disponíveis.</p>
    <p>${persistente ? "✓ Armazenamento persistente: o navegador não apaga o cofre para liberar espaço." : "O navegador pode apagar os dados se faltar espaço. Peça armazenamento persistente:"}</p>`,
    persistente ? [{ rotulo: "Fechar" }] : [{ rotulo: "Fechar" }, { rotulo: "Pedir persistente", destaque: true, acao: () => void navigator.storage.persist().then((ok) => casca.avisar(ok ? "Armazenamento persistente concedido." : "O navegador não concedeu agora (instale como app para conseguir).")) }]);
}

// ---------- casca ----------

function renderizar() {
  renderizarArvore();
  renderizarMigalhas();
  renderizarLista();
  renderizarPainel();
  casca.renderizar();
  const tot = arquivos.filter((a) => !a.lixeira).length;
  const meus = arquivos.filter((a) => a.checkout?.usuario === usuario()).length;
  casca.definirStatus(`${tot} arquivo(s) · ${pastas.length} pasta(s) · ${itens.length} item(ns)${meus ? ` · ${meus} com check-out seu` : ""}`);
  casca.statusDireita.innerHTML = `<span>👤 ${escapar(usuario())}</span>`;
}

const exigeArquivo = (f: (a: Arquivo) => unknown) => () => {
  const a = arquivoSel();
  if (!a) return casca.avisar("Selecione um arquivo na lista.");
  if (a.lixeira) return casca.avisar("O arquivo está na lixeira: restaure-o antes.");
  f(a);
};

const casca: Casca = new Casca({
  app: "WJPDM",
  icone: "",
  extensao: "wjpdm",
  nomeDoc: () => meta.nome,
  renomear: (n) => ((meta.nome = n), void db.por("meta", meta).then(renderizar)),
  novo: () => novaPasta(),
  abrir: () => void adicionarDoAparelho(),
  salvar: () => void exportarCofre(),
  abas: [
    {
      id: "cofre", rotulo: "Cofre", grupos: [
        [
          { id: "pasta", rotulo: "Nova pasta", icone: "novaPasta", acao: () => novaPasta() },
          { id: "add", rotulo: "Adicionar", icone: "importar", dica: "Adicionar arquivos do aparelho (ou arraste para a lista)", acao: () => void adicionarDoAparelho() },
        ],
        [
          { id: "obter", rotulo: "Obter", icone: "exportar", dica: "Baixar a versão atual", acao: exigeArquivo((a) => void obter(a)) },
          { id: "abrirApp", rotulo: "Abrir no app", icone: "abrir", dica: "Abrir no WJCAD, WJPlaniel, WJWord, WJApion ou WJCronProject", acao: exigeArquivo((a) => void abrirNoApp(a)) },
        ],
        [
          { id: "co", rotulo: "Check-out", icone: "checkout", acao: exigeArquivo((a) => void checkout(a)) },
          { id: "ci", rotulo: "Check-in", icone: "checkin", acao: exigeArquivo((a) => checkin(a)) },
          { id: "dco", rotulo: "Desfazer check-out", icone: "desfazer", peq: true, acao: exigeArquivo((a) => void desfazerCheckout(a)) },
        ],
        [{ id: "estado", rotulo: "Alterar estado", icone: "estado", dica: "Enviar para revisão, aprovar, nova revisão…", acao: exigeArquivo(alterarEstado) }],
        [
          { id: "ren", rotulo: "Renomear", icone: "editar", peq: true, acao: exigeArquivo(renomearArquivo) },
          { id: "mov", rotulo: "Mover", icone: "pasta", peq: true, acao: exigeArquivo(moverArquivo) },
          { id: "exc", rotulo: "Excluir", icone: "apagar", peq: true, dica: "Enviar para a lixeira", acao: exigeArquivo((a) => void excluirArquivo(a)) },
        ],
      ],
    },
    {
      id: "itens", rotulo: "Itens", grupos: [
        [
          { id: "ni", rotulo: "Novo item", icone: "item", acao: () => void novoItem() },
          { id: "lista", rotulo: "Itens", icone: "estrutura", dica: "Ver itens e listas de materiais", acao: () => ((local = { tipo: "itens" }), (sel = null), renderizar()) },
        ],
        [
          { id: "bom", rotulo: "Lista de materiais", icone: "estrutura", acao: () => (itemSel() ? ((aba = "bom"), renderizarPainel()) : casca.avisar("Selecione um item.")) },
          { id: "csv", rotulo: "Exportar lista", icone: "exportar", dica: "Lista explodida em CSV (abre no WJPlaniel)", acao: () => (itemSel() ? exportarBOM(itemSel()!) : casca.avisar("Selecione um item.")) },
        ],
      ],
    },
    {
      id: "ferramentas", rotulo: "Ferramentas", grupos: [
        [{ id: "usu", rotulo: "Usuário e cofre", icone: "nome", acao: () => configurar() }],
        [
          { id: "exp", rotulo: "Exportar cofre", icone: "exportar", dica: "Cópia de segurança completa (.wjpdm)", acao: () => void exportarCofre() },
          { id: "imp", rotulo: "Restaurar cópia", icone: "importar", acao: () => void importarCofre() },
          { id: "arm", rotulo: "Armazenamento", icone: "pasta", acao: () => void armazenamento() },
        ],
      ],
    },
  ],
});

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea, select") || document.querySelector(".wj-fundo")) return;
  const a = arquivoSel();
  if (e.key === "Delete" && a) void (a.lixeira ? destruir(a) : excluirArquivo(a));
  else if (e.key === "F2" && a) renomearArquivo(a);
  else if (e.key === "Enter" && a) void (APPS[extensao(a.nome)] ? abrirNoApp(a) : obter(a));
  else return;
  e.preventDefault();
});

async function carregar() {
  meta = { ...meta, ...((await db.ler<Meta>("meta", "meta")) ?? {}) };
  pastas = await db.todos<Pasta>("pastas");
  arquivos = await db.todos<Arquivo>("arquivos");
  itens = await db.todos<Item>("itens");
  sel = null;
  renderizar();
}

void (async () => {
  try {
    db = await Armazem.abrir();
  } catch {
    casca.avisar("Este navegador não permitiu o armazenamento local (IndexedDB): o cofre não pode ser aberto.", 10000);
    return;
  }
  await carregar();
  if (!meta.usuario) configurar(true);
  void navigator.storage?.persist?.();
})();
registrarOffline();

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__pdm = { estado: () => ({ meta, pastas, arquivos, itens }), adicionar, carregar };
