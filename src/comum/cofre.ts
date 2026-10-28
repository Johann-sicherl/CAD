// O WJPDM é o lugar de todos os arquivos do WJProMaster (decisão do Johann, 28/10/2026).
// Cada app salva no cofre (cópia de trabalho; versão só no GO-IN) e o cofre se iguala entre as
// cópias conectadas: pendrive, Google Drive e a pasta padrão do tablet (3ª cópia). O banco do
// aparelho (IndexedDB) é a cópia de trabalho de todos os apps. Regras da sincronia em
// src/pdm/sincronia.ts; pastas de disco em repositorios.ts.

import { Armazem } from "./armazem";
import { permissao, RepositorioAparelho, RepositorioPasta, type PastaDisco } from "./repositorios";
import { sincronizar, type MetaCofre, type Repositorio, type ResultadoSincronia } from "../pdm/sincronia";
import { bloqueioDoCheckout, extensao, nomeLivre, type Arquivo, type Pasta } from "../pdm/regras";

export type ChaveApp = "cad" | "plan" | "word" | "cron" | "apn" | "pdm" | "erp";
export const NOME_APP: Record<ChaveApp, string> = {
  cad: "WJCAD", plan: "WJPlan", word: "WJWord", cron: "WJCronProject", apn: "WJApresentation", pdm: "WJPDM", erp: "WJERP",
};
/** Pasta padrão de cada face na raiz do cofre. */
export const PASTA_DA_FACE: Record<ChaveApp, string> = {
  cad: "CAD", plan: "Planilhas", word: "Documentos", cron: "Cronogramas", apn: "Apresentações", pdm: "PDM", erp: "ERP",
};
/** Apps por extensão: chave do salvamento automático e endereço (abrir arquivo do cofre no app). */
export const APPS: Record<string, { app: string; chave: string; url: string; face: ChaveApp }> = {
  wjcad: { app: "WJCAD", chave: "jlscad:documento", url: "cad/#abrir-autosave", face: "cad" },
  jlscad: { app: "WJCAD", chave: "jlscad:documento", url: "cad/#abrir-autosave", face: "cad" },
  wjpl: { app: "WJPlan", chave: "wjpl:documento", url: "planilha/", face: "plan" },
  wjdoc: { app: "WJWord", chave: "wjdoc:documento", url: "documento/", face: "word" },
  wjapn: { app: "WJApresentation", chave: "wjapn:documento", url: "apresentacao/", face: "apn" },
  wjcron: { app: "WJCronProject", chave: "wjcron:documento", url: "cronograma/", face: "cron" },
};
const EXT_DA_FACE: Record<ChaveApp, string[]> = { cad: ["wjcad", "jlscad"], plan: ["wjpl"], word: ["wjdoc"], cron: ["wjcron"], apn: ["wjapn"], pdm: ["wjpdm"], erp: ["wjerp"] };

const agora = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Destino na nuvem (Google Drive): entra quando o cliente OAuth estiver configurado. */
export interface DestinoNuvem {
  nome: string;
  conectado(): boolean;
  situacao(): string;
  conectar?(): Promise<void>;
  repositorio(): Repositorio;
}
let nuvem: DestinoNuvem | null = null;
export function registrarNuvem(d: DestinoNuvem) {
  nuvem = d;
}

// ---------- banco do cofre e pastas das cópias ----------

let cofreDb: Promise<Armazem> | null = null;
export const abrirCofre = () => (cofreDb ??= Armazem.abrir());
let locaisDb: Promise<Armazem> | null = null;
const locais = () => (locaisDb ??= Armazem.abrir("wjlocais", ["pastas"]));
type Copia = "pendrive" | "tablet";
async function pastaDa(c: Copia): Promise<PastaDisco | undefined> {
  try {
    return (await (await locais()).ler<{ id: string; pasta: PastaDisco }>("pastas", `cofre:${c}`))?.pasta;
  } catch {
    return undefined;
  }
}
async function guardarPasta(c: Copia, p: PastaDisco | null) {
  const a = await locais();
  if (p) await a.por("pastas", { id: `cofre:${c}`, pasta: p } as { id: string });
  else await a.apagar("pastas", `cofre:${c}`);
}
type Janela = typeof window & { showDirectoryPicker?(o?: { id?: string; mode?: "readwrite"; startIn?: string }): Promise<PastaDisco> };
export const temPastas = () => typeof (window as Janela).showDirectoryPicker === "function";

const usuarioDo = async (db: Armazem) => (await db.ler<MetaCofre>("meta", "meta"))?.usuario || "Usuário";

// ---------- sincronia ----------

let ultima: { quando: string; texto: string } | null = null;
let rodando: Promise<string> | null = null;

/**
 * Iguala o cofre do aparelho com as cópias conectadas (pendrive, pasta do tablet, Drive).
 * `pedir`: pode mostrar o "Permitir" do navegador (só logo depois de um toque do usuário).
 */
export function sincronizarCofre(pedir = true): Promise<string> {
  return (rodando ??= (async () => {
    try {
      const db = await abrirCofre();
      const repos: Repositorio[] = [new RepositorioAparelho(db)];
      const ausentes: string[] = [];
      for (const [c, rot] of [["pendrive", "pendrive"], ["tablet", "pasta do tablet"]] as const) {
        const p = await pastaDa(c);
        if (!p) continue;
        if (await permissao(p, pedir).catch(() => false)) repos.push(new RepositorioPasta(rot, p));
        else ausentes.push(`${rot} sem permissão`);
      }
      if (nuvem?.conectado() && navigator.onLine) repos.push(nuvem.repositorio());
      if (repos.length === 1) return (ultima = { quando: agora(), texto: "Cofre salvo só neste aparelho: conecte o pendrive ou escolha a pasta do tablet (Cópias do cofre)." }).texto;
      const r = await sincronizar(repos, agora());
      return (ultima = { quando: agora(), texto: resumo(r, repos, ausentes) }).texto;
    } finally {
      rodando = null;
    }
  })());
}

function resumo(r: ResultadoSincronia, repos: Repositorio[], ausentes: string[]): string {
  const ok = repos.filter((x) => x.nome !== "aparelho" && !r.falhas.some((f) => f.repo === x.nome)).map((x) => x.nome);
  const partes = [ok.length ? `Cofre igual em: aparelho, ${ok.join(", ")}` : "Cofre salvo só neste aparelho"];
  const fora = [...r.falhas.map((f) => `${f.repo} desconectado`), ...ausentes];
  if (fora.length) partes.push(fora.join(", "));
  if (r.conflitos.length) partes.push(`conflito em ${r.conflitos.join(", ")} (a mais recente ficou; a outra está na lixeira)`);
  if (r.faltando.length) partes.push(`${r.faltando.length} conteúdo(s) não encontrado(s) em nenhuma cópia`);
  return `${partes.join(" · ")}.`;
}

// ---------- salvar e abrir pelos apps ----------

const chaveVinculo = (app: ChaveApp) => `wjpdm:vinculo:${app}`;
/** Arquivo do cofre ligado ao documento aberto no app (salvar atualiza esse arquivo). */
export const vinculo = (app: ChaveApp) => localStorage.getItem(chaveVinculo(app));
export const ligar = (app: ChaveApp, id: string) => localStorage.setItem(chaveVinculo(app), id);
/** Novo documento / aberto do aparelho: o próximo salvar cria um arquivo novo no cofre. */
export const desligar = (app: ChaveApp) => localStorage.removeItem(chaveVinculo(app));

async function pastaDaFace(db: Armazem, app: ChaveApp): Promise<string> {
  const nome = PASTA_DA_FACE[app];
  const ps = await db.todos<Pasta>("pastas");
  const p = ps.find((x) => !x.pai && x.nome.toLowerCase() === nome.toLowerCase());
  if (p) return p.id;
  const nova: Pasta = { id: uid(), nome, pai: null, mod: agora() };
  await db.por("pastas", nova);
  return nova.id;
}

/**
 * Salva o documento do app no cofre: atualiza a cópia de trabalho do arquivo ligado (faz o GO-OUT
 * se precisar) ou cria um arquivo novo na pasta da face, já em GO-OUT; depois iguala as cópias.
 */
export async function salvarNoCofre(app: ChaveApp, nomeArquivo: string, dados: Blob): Promise<string> {
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  const t = agora();
  let a = vinculo(app) ? await db.ler<Arquivo>("arquivos", vinculo(app)!) : undefined;
  let aviso = "";
  if (a?.lixeira) a = undefined;
  if (a && a.checkout?.usuario !== usuario) {
    const b = bloqueioDoCheckout(a, usuario);
    if (b) {
      aviso = ` ${a.nome}: ${b} Salvo como arquivo novo.`;
      a = undefined;
    } else {
      a.checkout = { usuario, data: t };
      a.historico.push({ data: t, usuario, texto: `GO-OUT (ao salvar no ${NOME_APP[app]})` });
    }
  }
  const blob = uid();
  await db.porBlob(blob, dados);
  if (a) {
    const velho = a.trabalho?.blob;
    a.trabalho = { blob, tamanho: dados.size, data: t, autor: usuario };
    // renomeado no app: o arquivo do cofre acompanha (sem repetir nome na pasta)
    if (a.nome !== nomeArquivo) {
      const irmaos = (await db.todos<Arquivo>("arquivos")).filter((x) => x.pasta === a!.pasta && x.id !== a!.id && !x.lixeira).map((x) => x.nome);
      a.nome = nomeLivre(nomeArquivo, irmaos);
    }
    a.mod = t;
    await db.por("arquivos", a);
    if (velho && !a.versoes.some((v) => v.blob === velho)) await db.apagar("blobs", velho);
  } else {
    const pasta = await pastaDaFace(db, app);
    const irmaos = (await db.todos<Arquivo>("arquivos")).filter((x) => x.pasta === pasta && !x.lixeira).map((x) => x.nome);
    const nome = nomeLivre(nomeArquivo, irmaos);
    a = {
      id: uid(), nome, pasta, revisao: "", estado: "trabalho", cartao: { descricao: nome.replace(/\.[^.]+$/, ""), projetista: usuario },
      checkout: { usuario, data: t }, mod: t,
      versoes: [{ n: 1, blob, tamanho: dados.size, autor: usuario, data: t, comentario: `Criado no ${NOME_APP[app]}`, revisao: "", estado: "trabalho" }],
      historico: [{ data: t, usuario, texto: `Criado no ${NOME_APP[app]} (em GO-OUT)` }],
    };
    await db.por("arquivos", a);
  }
  ligar(app, a.id);
  const sinc = await sincronizarCofre(true);
  return `Salvo no cofre (${PASTA_DA_FACE[app]}/${a.nome}). ${sinc}${aviso}`;
}

/** Abre um arquivo do cofre no app (grava o salvamento automático do app e recarrega a página). */
export async function abrirArquivoNoApp(a: Arquivo, db?: Armazem): Promise<string | null> {
  const app = APPS[extensao(a.nome)];
  if (!app) return "Este arquivo não abre em nenhum app do WJProMaster.";
  db ??= await abrirCofre();
  const blob = a.trabalho?.blob ?? a.versoes[a.versoes.length - 1]?.blob;
  const b = blob ? await db.blob(blob) : undefined;
  if (!b) return "Conteúdo não encontrado no cofre.";
  let texto = await b.text();
  try {
    const d = JSON.parse(texto);
    d.nome = a.nome.replace(/\.[^.]+$/, "");
    texto = JSON.stringify(d);
  } catch {
    return `O arquivo não é um documento válido do ${app.app}.`;
  }
  localStorage.setItem(app.chave, texto);
  ligar(app.face, a.id);
  const destino = new URL(`${import.meta.env.BASE_URL}${app.url}`, location.href);
  if (destino.pathname === location.pathname) {
    // já está no app: troca o endereço e recarrega (só o "#" não recarregaria)
    history.replaceState(null, "", destino.href);
    location.reload();
  } else location.href = destino.href;
  return null;
}

// ---------- janelas ----------

const CSS = `
.wjc-fundo{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:rgba(20,30,40,.35);padding:12px}
.wjc-janela{width:min(600px,100%);max-height:calc(100% - 24px);overflow:auto;background:#fff;color:#1d2733;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:15px system-ui,sans-serif}
.wjc-janela header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #dfe5ec;font-weight:700}
.wjc-janela section{padding:12px 16px;border-bottom:1px solid #eef1f5}
.wjc-janela h3{margin:0 0 4px;font-size:15px}
.wjc-janela p{margin:4px 0 8px;color:#55606d;font-size:13px}
.wjc-botoes{display:flex;flex-wrap:wrap;gap:8px}
.wjc-janela button{min-height:44px;padding:0 14px;border:1px solid #c9d3de;border-radius:8px;background:#f6f8fa;font:inherit;cursor:pointer}
.wjc-janela button.destaque{background:#2f7fd0;border-color:#2f7fd0;color:#fff}
.wjc-ok{color:#24883f;font-weight:600}.wjc-nao{color:#b3401f;font-weight:600}
.wjc-lista{list-style:none;margin:0;padding:0}
.wjc-lista li button{width:100%;display:flex;justify-content:space-between;gap:8px;text-align:left;border:0;border-bottom:1px solid #eef1f5;border-radius:0;background:#fff}
.wjc-lista small{color:#55606d}
.wjc-janela footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px}`;

function janela(titulo: string): { caixa: HTMLElement; fechar: () => void } {
  if (!document.getElementById("wjc-css")) document.head.append(Object.assign(document.createElement("style"), { id: "wjc-css", textContent: CSS }));
  const fundo = document.createElement("div");
  fundo.className = "wjc-fundo";
  fundo.innerHTML = `<div class="wjc-janela" role="dialog" aria-modal="true"><header><span></span><button data-fechar title="Fechar">✕</button></header><div data-corpo></div></div>`;
  fundo.querySelector("header span")!.textContent = titulo;
  const fechar = () => fundo.remove();
  fundo.addEventListener("pointerdown", (e) => e.target === fundo && fechar());
  fundo.addEventListener("keydown", (e) => e.key === "Escape" && fechar());
  fundo.querySelector<HTMLElement>("[data-fechar]")!.onclick = fechar;
  document.body.append(fundo);
  return { caixa: fundo.querySelector<HTMLElement>("[data-corpo]")!, fechar };
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const quando = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;

/** Tela "Cópias do cofre": pendrive, pasta do tablet, Google Drive e sincronizar agora. */
export async function abrirCopias(aoSincronizar?: () => void) {
  const { caixa, fechar } = janela("Cópias do cofre (WJPDM)");
  const desenhar = async (msg = "") => {
    const pen = await pastaDa("pendrive"), tab = await pastaDa("tablet");
    const sitPen = pen ? ((await permissao(pen, false).catch(() => false)) ? "conectado" : "toque Sincronizar para permitir o acesso") : "";
    caixa.innerHTML = `
      <section><p>Todos os arquivos dos apps ficam no cofre do WJPDM. Ao salvar, o cofre fica <b>igual</b> em todas as cópias conectadas; o que faltar numa cópia é copiado e a alteração mais recente vence (a outra vai para a lixeira).</p></section>
      <section><h3>Pendrive</h3>
        <p>${pen ? `Pasta: <b>${esc(pen.name)}</b>/WJPDM (${sitPen})` : "Nenhum pendrive escolhido."} Conecte o pendrive (USB-C no tablet) e escolha a pasta raiz dele: o cofre fica em WJPDM/.</p>
        <div class="wjc-botoes">${temPastas() ? `<button data-b="pen" class="destaque">Escolher pendrive…</button>${pen ? `<button data-b="tirarPen">Remover</button>` : ""}` : "<span class='wjc-nao'>Este navegador não permite escolher pastas: use o Chrome atualizado.</span>"}</div></section>
      <section><h3>Pasta padrão do tablet (3ª cópia)</h3>
        <p>${tab ? `Pasta: <b>${esc(tab.name)}</b>/WJPDM` : "Nenhuma pasta escolhida: escolha uma pasta do aparelho (ex.: Documentos)."}</p>
        ${temPastas() ? `<div class="wjc-botoes"><button data-b="tab">${tab ? "Trocar pasta…" : "Escolher pasta…"}</button></div>` : ""}</section>
      <section><h3>Google Drive</h3><p>${nuvem ? esc(nuvem.situacao()) : "Aguardando a configuração do acesso ao Google (cliente OAuth)."}</p>
        ${nuvem?.conectar && !nuvem.conectado() ? `<div class="wjc-botoes"><button data-b="drive" class="destaque">Conectar ao Google Drive</button></div>` : ""}</section>
      <section><div class="wjc-botoes"><button data-b="sinc" class="destaque">Sincronizar agora</button></div>
        <p data-r class="${/desconectado|não encontrado|sem permissão/.test(msg) ? "wjc-nao" : msg ? "wjc-ok" : ""}">${esc(msg || (ultima ? `Última: ${quando(ultima.quando)} — ${ultima.texto}` : ""))}</p></section>
      <footer><button data-b="fechar" class="destaque">Fechar</button></footer>`;
    const escolher = async (c: Copia) => {
      try {
        const p = await (window as Janela).showDirectoryPicker!({ id: `wjpdm-${c}`, mode: "readwrite", startIn: c === "tablet" ? "documents" : undefined });
        await guardarPasta(c, p);
      } catch {
        return desenhar();
      }
      await desenhar("Sincronizando…");
      await desenhar(await sincronizarCofre(true));
      aoSincronizar?.();
    };
    const acoes: Record<string, () => Promise<void> | void> = {
      fechar,
      pen: () => escolher("pendrive"),
      tab: () => escolher("tablet"),
      tirarPen: async () => {
        await guardarPasta("pendrive", null);
        await desenhar();
      },
      drive: async () => {
        await nuvem?.conectar?.();
        await desenhar();
      },
      sinc: async () => {
        caixa.querySelector<HTMLElement>("[data-r]")!.textContent = "Sincronizando…";
        await desenhar(await sincronizarCofre(true));
        aoSincronizar?.();
      },
    };
    caixa.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => void acoes[b.dataset.b!]?.()));
  };
  await desenhar();
}

/** Lista os arquivos da face no cofre (mais recentes primeiro) e abre o escolhido no app. */
export async function abrirDoCofre(app: ChaveApp) {
  const db = await abrirCofre();
  const ps = await db.todos<Pasta>("pastas");
  const caminho = (id: string) => {
    const n: string[] = [];
    for (let p = ps.find((x) => x.id === id); p; p = p.pai ? ps.find((x) => x.id === p!.pai) : undefined) n.unshift(p.nome);
    return n.join("/") || "(raiz)";
  };
  const lista = (await db.todos<Arquivo>("arquivos"))
    .filter((a) => !a.lixeira && EXT_DA_FACE[app].includes(extensao(a.nome)))
    .sort((a, b) => (b.mod ?? "").localeCompare(a.mod ?? ""));
  const { caixa, fechar } = janela(`Abrir do cofre — ${NOME_APP[app]}`);
  caixa.innerHTML = lista.length
    ? `<section><ul class="wjc-lista">${lista.map((a) => `<li><button data-id="${a.id}"><span>${esc(a.nome)}<br><small>${esc(caminho(a.pasta))}${a.checkout ? ` · GO-OUT ${esc(a.checkout.usuario)}` : ""}${a.revisao ? ` · rev. ${esc(a.revisao)}` : ""}</small></span><small>${a.mod ? quando(a.mod) : ""}</small></button></li>`).join("")}</ul></section>`
    : `<section><p>Nenhum arquivo do ${NOME_APP[app]} no cofre ainda. Salve um documento (💾) e ele entra em ${PASTA_DA_FACE[app]}/.</p></section>`;
  caixa.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((b) => {
    b.onclick = async () => {
      const a = lista.find((x) => x.id === b.dataset.id)!;
      fechar();
      const erro = await abrirArquivoNoApp(a, db);
      if (erro) alert(erro);
    };
  });
}
