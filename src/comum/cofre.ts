// O WJPDM é o lugar de todos os arquivos do WJProMaster (decisões do Johann, 28/10/2026):
// - salvar num app grava a cópia de trabalho NO DISPOSITIVO (banco do app + pasta padrão do
//   dispositivo); o primeiro salvar pergunta a pasta do cofre e o arquivo entra em GO-OUT;
// - GO-IN cria a versão e PUBLICA no pendrive e no Google Drive (que só recebem o que passou por
//   GO-IN); painel lateral em cada app com GO-OUT/GO-IN e a lista dos arquivos em GO-OUT.
// Regras da sincronia em src/pdm/sincronia.ts; pastas de disco em repositorios.ts.

import { Armazem } from "./armazem";
import { permissao, RepositorioAparelho, RepositorioPasta, type PastaDisco } from "./repositorios";
import { sincronizar, type MetaCofre, type Repositorio, type ResultadoSincronia } from "../pdm/sincronia";
import { nuvemGoogle, type DestinoNuvem } from "./drive";
import { bloqueioDoCheckout, estadoDe, extensao, fluxoAtual, nomeLivre, trocarReferencias, usarFluxo, type Arquivo, type DadosModelo, type Pasta, type ReferenciaArquivo } from "../pdm/regras";

export type ChaveApp = "cad" | "asm" | "drw" | "plan" | "word" | "cron" | "apn" | "pdm" | "erp" | "flow";
export const NOME_APP: Record<ChaveApp, string> = {
  cad: "WJCAD", asm: "WJCAD (montagem)", drw: "WJCAD (desenho)", plan: "WJPlan", word: "WJWrite", cron: "WJCronProject", apn: "WJApresentation", pdm: "WJPDM", erp: "WJERP", flow: "WJFlow",
};
/** Pasta padrão de cada face na raiz do cofre. */
export const PASTA_DA_FACE: Record<ChaveApp, string> = {
  cad: "CAD", asm: "CAD", drw: "CAD", plan: "Planilhas", word: "Documentos", cron: "Cronogramas", apn: "Apresentações", pdm: "PDM", erp: "ERP", flow: "Escoamento",
};
/** Apps por extensão: chave do salvamento automático e endereço (abrir arquivo do cofre no app). */
export const APPS: Record<string, { app: string; chave: string; url: string; face: ChaveApp }> = {
  wjcad: { app: "WJCAD", chave: "jlscad:documento", url: "cad/#abrir-autosave", face: "cad" },
  jlscad: { app: "WJCAD", chave: "jlscad:documento", url: "cad/#abrir-autosave", face: "cad" },
  wjasm: { app: "WJCAD (montagem)", chave: "wjcad:montagem", url: "cad/montagem/#abrir-autosave", face: "asm" },
  wjdrw: { app: "WJCAD (desenho)", chave: "wjcad:desenho", url: "cad/desenho/#abrir-autosave", face: "drw" },
  wjpl: { app: "WJPlan", chave: "wjpl:documento", url: "planilha/", face: "plan" },
  wjdoc: { app: "WJWrite", chave: "wjdoc:documento", url: "documento/", face: "word" },
  wjapn: { app: "WJApresentation", chave: "wjapn:documento", url: "apresentacao/", face: "apn" },
  wjcron: { app: "WJCronProject", chave: "wjcron:documento", url: "cronograma/", face: "cron" },
  wjflow: { app: "WJFlow", chave: "wjflow:estudo", url: "flow/", face: "flow" },
};
const EXT_DA_FACE: Record<ChaveApp, string[]> = { cad: ["wjcad", "jlscad"], asm: ["wjasm"], drw: ["wjdrw"], plan: ["wjpl"], word: ["wjdoc"], cron: ["wjcron"], apn: ["wjapn"], pdm: ["wjpdm"], erp: ["wjerp"], flow: ["wjflow"] };

const agora = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Google Drive (login do Google, escopo drive.file): cópia do cofre em Meu Drive/WJPDM. */
let nuvem: DestinoNuvem | null = nuvemGoogle;
export function registrarNuvem(d: DestinoNuvem | null) {
  nuvem = d;
}

/**
 * Acesso ao Drive vencido: pede a renovação JÁ (antes de qualquer espera), enquanto o toque do
 * usuário ainda vale — senão o navegador bloqueia a janela do Google.
 */
function renovarNuvem(pedir: boolean): Promise<boolean> {
  return pedir && nuvem ? nuvem.renovar().catch(() => false) : Promise.resolve(!!nuvem?.conectado());
}

// ---------- banco do cofre e pastas das cópias ----------

let cofreDb: Promise<Armazem> | null = null;
export const abrirCofre = () => (cofreDb ??= Armazem.abrir());
let locaisDb: Promise<Armazem> | null = null;
const locais = () => (locaisDb ??= Armazem.abrir("wjlocais", ["pastas"]));
type Copia = "pendrive" | "tablet";
/** Raiz escolhida para uma cópia do cofre (o cofre fica em <raiz>/WJPDM; outras faces usam pastas irmãs). */
export async function pastaDa(c: Copia): Promise<PastaDisco | undefined> {
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

/** Usuário do cofre; também passa a usar o fluxo de trabalho do cofre (estados e travas). */
const usuarioDo = async (db: Armazem) => {
  const meta = await db.ler<MetaCofre>("meta", "meta");
  usarFluxo(meta?.fluxo);
  return meta?.usuario || "Usuário";
};

// ---------- sincronia ----------

let ultima: { quando: string; texto: string } | null = null;
let fila: Promise<unknown> = Promise.resolve();

export interface OpcoesSincronia {
  /** pode mostrar o "Permitir"/janela do Google (só logo depois de um toque do usuário) */
  pedir?: boolean;
  /** true: também pendrive e Drive (publicação, depois de um GO-IN); false: só o dispositivo */
  publicar?: boolean;
  /** renovação do Drive já pedida no toque (ver renovarNuvem) */
  renovacao?: Promise<boolean>;
}

/**
 * Iguala o cofre do aparelho com a pasta padrão do dispositivo e, ao publicar, com o pendrive e o
 * Google Drive. Uma sincronia por vez (as seguintes esperam na fila).
 */
export function sincronizarCofre(o: OpcoesSincronia = {}): Promise<string> {
  const pedir = o.pedir ?? true, publicar = o.publicar ?? true;
  const renovacao = publicar ? (o.renovacao ?? renovarNuvem(pedir)) : Promise.resolve(false);
  const tarefa = fila.then(async () => {
    const db = await abrirCofre();
    const repos: Repositorio[] = [new RepositorioAparelho(db)];
    const ausentes: string[] = [];
    const copias = publicar ? ([["tablet", "pasta do dispositivo"], ["pendrive", "pendrive"]] as const) : ([["tablet", "pasta do dispositivo"]] as const);
    for (const [c, rot] of copias) {
      const p = await pastaDa(c);
      if (!p) continue;
      if (await permissao(p, pedir).catch(() => false)) repos.push(new RepositorioPasta(rot, p, c === "pendrive"));
      else ausentes.push(`${rot} sem permissão`);
    }
    if (publicar) {
      if (nuvem && navigator.onLine && ((await renovacao) || nuvem.conectado())) repos.push(nuvem.repositorio());
      else if (nuvem && localStorage.getItem("wjgoogle:autorizado") === "1") ausentes.push("Google Drive com acesso vencido (toque em Cofre → Sincronizar agora)");
    }
    if (repos.length === 1) {
      const t = publicar ? "Nenhuma cópia conectada: conecte o pendrive ou o Google Drive (📁 Cópias do cofre)." : "Salvo só no banco do app: escolha a pasta padrão do dispositivo (📁 Cópias do cofre).";
      return (ultima = { quando: agora(), texto: t }).texto;
    }
    const r = await sincronizar(repos, agora());
    return (ultima = { quando: agora(), texto: resumo(r, repos, ausentes) }).texto;
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

let abriu = false;
/**
 * Sincronia global ao abrir (cada recarregar do app): dispositivo, pendrive e Drive, sem pedir nada
 * (não há toque): cópias que precisam de permissão ou de novo login ficam para o próximo toque.
 * Roda depois de `espera` (o app termina de abrir antes) e só uma vez por página.
 */
export function sincronizarAoAbrir(espera: Promise<unknown> = Promise.resolve()): Promise<string> | undefined {
  if (abriu) return;
  abriu = true;
  return espera
    .catch(() => {})
    .then(() => new Promise((r) => setTimeout(r, 800)))
    .then(() => sincronizarCofre({ pedir: false, publicar: true }))
    .then((m) => (avisarMudanca(), m));
}
/** A sincronia ou outro salvar mudou o cofre (para recarregar listas). */
export const aoMudarCofre = (f: () => void) => ouvintes.add(f);
/** Mensagem da sincronia ao abrir que merece aviso: algo pede um toque ou houve conflito. */
export const precisaToque = (m: string) => /sem permissão|vencido|conflito|desconectado/.test(m);

function resumo(r: ResultadoSincronia, repos: Repositorio[], ausentes: string[]): string {
  const ok = repos.filter((x) => x.nome !== "aparelho" && !r.falhas.some((f) => f.repo === x.nome)).map((x) => x.nome);
  const partes = [ok.length ? `Igual em: ${ok.join(", ")}` : "Só no banco do app"];
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

const caminhoDaPasta = (ps: Pasta[], id: string) => {
  const n: string[] = [];
  const vistos = new Set<string>();
  for (let p = ps.find((x) => x.id === id); p && !vistos.has(p.id); p = p.pai ? ps.find((x) => x.id === p!.pai) : undefined) {
    vistos.add(p.id);
    n.unshift(p.nome);
  }
  return n.join("/");
};
const RAIZ = "raiz";
const ULTIMA_PASTA = (app: ChaveApp) => `wjpdm:ultimaPasta:${app}`;

/** Pasta da face na raiz do cofre (cria se faltar): onde o WJPDM e o WJERP guardam suas cópias. */
async function pastaDaFace(db: Armazem, app: ChaveApp): Promise<string> {
  const ps = await db.todos<Pasta>("pastas");
  const achada = ps.find((p) => p.pai === null && p.nome === PASTA_DA_FACE[app]);
  if (achada) return achada.id;
  const nova: Pasta = { id: uid(), nome: PASTA_DA_FACE[app], pai: null, mod: agora() };
  await db.por("pastas", nova);
  return nova.id;
}

/**
 * Primeiro salvar de um documento: escolhe a pasta do cofre (com "Nova pasta") e o nome. Mostra se
 * a pasta padrão do dispositivo já foi escolhida (e permite escolher). null = cancelado.
 */
async function escolherLocal(app: ChaveApp, nomeArquivo: string): Promise<{ pasta: string; nome: string } | null> {
  const db = await abrirCofre();
  if (app === "pdm" || app === "erp") return { pasta: await pastaDaFace(db, app), nome: nomeArquivo };
  const meta = await db.ler<MetaCofre>("meta", "meta");
  let ps = await db.todos<Pasta>("pastas");
  const lembrada = localStorage.getItem(ULTIMA_PASTA(app));
  let sel = lembrada && ps.some((p) => p.id === lembrada) ? lembrada : (ps.find((p) => p.pai === null && p.nome === PASTA_DA_FACE[app])?.id ?? RAIZ);
  const ext = extensao(nomeArquivo);
  const base = ext ? nomeArquivo.slice(0, -(ext.length + 1)) : nomeArquivo;
  return new Promise((fim) => {
    const { caixa, fechar } = janela(`Salvar no cofre — ${NOME_APP[app]}`);
    let feito = false;
    const terminar = (r: { pasta: string; nome: string } | null) => {
      if (feito) return;
      feito = true;
      fechar();
      fim(r);
    };
    // fechar pelo ✕, Esc ou fora da janela = cancelar
    new MutationObserver((_, o) => {
      if (!caixa.isConnected) {
        o.disconnect();
        terminar(null);
      }
    }).observe(document.body, { childList: true });
    const arvore = () => {
      const filhos = (pai: string | null) => ps.filter((p) => p.pai === pai).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      const linha = (id: string, nome: string, nivel: number) => `<li><button data-p="${id}" class="${id === sel ? "sel" : ""}" style="padding-left:${12 + nivel * 18}px">📁 ${esc(nome)}</button></li>`;
      const ramo = (pai: string | null, nivel: number): string => filhos(pai).map((p) => linha(p.id, p.nome, nivel) + ramo(p.id, nivel + 1)).join("");
      return linha(RAIZ, meta?.nome || "Cofre", 0) + ramo(null, 1);
    };
    const desenhar = async () => {
      const tab = await pastaDa("tablet");
      caixa.innerHTML = `
        <section><h3>Pasta do cofre</h3><ul class="wjc-lista wjc-arvore">${arvore()}</ul>
          <div class="wjc-botoes" style="margin-top:8px"><button data-b="nova">Nova pasta…</button></div></section>
        <section><h3>Nome</h3><div class="wjc-nome"><input data-nome value="${esc(base)}" aria-label="Nome do arquivo" />${ext ? `<span>.${esc(ext)}</span>` : ""}</div></section>
        <section><p>O arquivo fica <b>em GO-OUT, só no dispositivo</b> (banco do app${tab ? ` e pasta <b>${esc(tab.name)}</b>/WJPDM` : ""}). O GO-IN publica no pendrive e no Google Drive.</p>
          ${tab ? "" : `<p class="wjc-nao">Pasta padrão do dispositivo ainda não escolhida.</p>${temPastas() ? `<div class="wjc-botoes"><button data-b="tab">Escolher pasta do dispositivo…</button></div>` : ""}`}</section>
        <footer><button data-b="cancelar">Cancelar</button><button data-b="ok" class="destaque">Salvar</button></footer>`;
      const campo = caixa.querySelector<HTMLInputElement>("[data-nome]")!;
      campo.onkeydown = (e) => {
        if (e.key === "Enter") ok(); // sem "&&": devolver false cancelaria as outras teclas
      };
      caixa.querySelectorAll<HTMLButtonElement>("[data-p]").forEach((b) => (b.onclick = () => {
        sel = b.dataset.p!;
        caixa.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("sel", x === b));
      }));
      const ok = () => {
        const n = campo.value.trim().replace(/[\\/:*?"<>|]/g, "_");
        if (!n) return campo.focus();
        localStorage.setItem(ULTIMA_PASTA(app), sel);
        terminar({ pasta: sel, nome: ext ? `${n}.${ext}` : n });
      };
      const acoes: Record<string, () => void | Promise<void>> = {
        ok,
        cancelar: () => terminar(null),
        nova: async () => {
          const nome = prompt("Nome da nova pasta:")?.trim();
          if (!nome) return;
          const pai = sel === RAIZ ? null : sel;
          if (ps.some((p) => p.pai === pai && p.nome.toLowerCase() === nome.toLowerCase())) return alert("Já existe uma pasta com esse nome aqui.");
          const p: Pasta = { id: uid(), nome, pai, mod: agora() };
          await db.por("pastas", p);
          ps = await db.todos<Pasta>("pastas");
          sel = p.id;
          base0 = campo.value;
          await desenhar();
        },
        tab: async () => {
          try {
            await guardarPasta("tablet", await (window as Janela).showDirectoryPicker!({ id: "wjpdm-tablet", mode: "readwrite", startIn: "documents" }));
          } catch {
            /* desistiu */
          }
          base0 = campo.value;
          await desenhar();
        },
      };
      caixa.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => void acoes[b.dataset.b!]?.()));
      if (base0 !== null) campo.value = base0;
      campo.focus();
      campo.select();
    };
    let base0: string | null = null;
    void desenhar();
  });
}

/**
 * Salva o documento do app no cofre, no dispositivo. Arquivo ligado: atualiza a cópia de trabalho
 * (faz o GO-OUT se o arquivo estiver livre). Primeira vez: pergunta a pasta do cofre e o nome; o
 * arquivo entra em GO-OUT e "só no dispositivo" até o primeiro GO-IN (publicação).
 */
export interface ExtrasSalvar {
  /** o que o arquivo usa (componentes da montagem, modelo do desenho): tabela de referências */
  referencias?: Omit<ReferenciaArquivo, "id" | "pai" | "mod">[];
  /** dados do modelo (tipo, configurações, material, massa, volume) */
  modelo?: DadosModelo;
}

export async function salvarNoCofre(app: ChaveApp, nomeArquivo: string, dados: Blob, renomear?: (nome: string) => void, extras: ExtrasSalvar = {}): Promise<string> {
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  let a = vinculo(app) ? await db.ler<Arquivo>("arquivos", vinculo(app)!) : undefined;
  let aviso = "";
  if (a?.lixeira) a = undefined;
  if (a && a.checkout?.usuario !== usuario) {
    const b = bloqueioDoCheckout(a, usuario);
    if (b) {
      aviso = ` (${a.nome}: ${b} Salve como arquivo novo.)`;
      a = undefined;
    }
  }
  let local: { pasta: string; nome: string } | null = null;
  if (!a) {
    local = await escolherLocal(app, nomeArquivo);
    if (!local) return "Salvamento cancelado.";
  }
  const t = agora();
  const blob = uid();
  await db.porBlob(blob, dados);
  if (a) {
    if (a.checkout?.usuario !== usuario) {
      a.checkout = { usuario, data: t };
      a.historico.push({ data: t, usuario, texto: `GO-OUT (ao salvar no ${NOME_APP[app]})` });
    }
    let velho = a.trabalho?.blob;
    if (a.soLocal && a.versoes.length === 1) {
      // nunca publicado: o conteúdo novo substitui a versão 1 (o primeiro GO-IN publica a versão 1)
      velho = a.versoes[0].blob;
      a.versoes[0] = { ...a.versoes[0], blob, tamanho: dados.size, data: t };
      a.trabalho = undefined;
    } else a.trabalho = { blob, tamanho: dados.size, data: t, autor: usuario };
    // renomeado no app: o arquivo do cofre acompanha (sem repetir nome na pasta)
    if (a.nome !== nomeArquivo) {
      const irmaos = (await db.todos<Arquivo>("arquivos")).filter((x) => x.pasta === a!.pasta && x.id !== a!.id && !x.lixeira).map((x) => x.nome);
      a.nome = nomeLivre(nomeArquivo, irmaos);
    }
    a.mod = t;
    await db.por("arquivos", a);
    if (velho && velho !== a.trabalho?.blob && !a.versoes.some((v) => v.blob === velho)) await db.apagar("blobs", velho);
  } else {
    const irmaos = (await db.todos<Arquivo>("arquivos")).filter((x) => x.pasta === local!.pasta && !x.lixeira).map((x) => x.nome);
    const nome = nomeLivre(local!.nome, irmaos);
    a = {
      id: uid(), nome, pasta: local!.pasta, revisao: "", estado: fluxoAtual().inicial, cartao: { descricao: nome.replace(/\.[^.]+$/, ""), projetista: usuario },
      checkout: { usuario, data: t }, soLocal: true, mod: t,
      versoes: [{ n: 1, blob, tamanho: dados.size, autor: usuario, data: t, comentario: `Criado no ${NOME_APP[app]}`, revisao: "", estado: fluxoAtual().inicial }],
      historico: [{ data: t, usuario, texto: `Criado no ${NOME_APP[app]} (em GO-OUT, só no dispositivo)` }],
    };
    await db.por("arquivos", a);
    // o documento aberto passa a ter o nome escolhido (senão o próximo salvar renomearia de volta)
    if (nome !== nomeArquivo) renomear?.(nome.replace(/\.[^.]+$/, ""));
  }
  if (extras.modelo) {
    a.modelo = extras.modelo;
    // material do CAD preenche o cartão vazio
    if (extras.modelo.material && !a.cartao.material) a.cartao.material = extras.modelo.material;
    await db.por("arquivos", a);
  }
  if (extras.referencias) await gravarReferencias(db, a.id, extras.referencias);
  ligar(app, a.id);
  avisarMudanca();
  const sinc = await sincronizarCofre({ pedir: true, publicar: false });
  const onde = caminhoDaPasta(await db.todos<Pasta>("pastas"), a.pasta);
  return `Salvo no dispositivo, em GO-OUT: ${onde ? `${onde}/` : ""}${a.nome}. ${sinc} Faça o GO-IN para publicar no pendrive e no Drive.${aviso}`;
}

/** Troca as referências do arquivo (montagem/desenho) na tabela; as que saíram viram exclusão. */
async function gravarReferencias(db: Armazem, pai: string, novas: Omit<ReferenciaArquivo, "id" | "pai" | "mod">[]) {
  const t = agora();
  const { gravar, sair } = trocarReferencias(await db.todos<ReferenciaArquivo>("referencias"), pai, novas, t);
  for (const r of gravar) await db.por("referencias", r);
  for (const id of sair) {
    await db.apagar("referencias", id);
    await db.por("exclusoes", { id, tipo: "referencia", data: t } as { id: string });
  }
}

/** Arquivos do cofre com estas extensões (fora da lixeira), mais recentes primeiro, com o caminho. */
export async function documentosDoCofre(exts: string[]): Promise<{ arquivo: Arquivo; caminho: string }[]> {
  const db = await abrirCofre();
  usarFluxo((await db.ler<MetaCofre>("meta", "meta"))?.fluxo);
  const ps = await db.todos<Pasta>("pastas");
  return (await db.todos<Arquivo>("arquivos"))
    .filter((a) => !a.lixeira && exts.includes(extensao(a.nome)))
    .sort((a, b) => (b.mod ?? "").localeCompare(a.mod ?? ""))
    .map((arquivo) => ({ arquivo, caminho: caminhoDaPasta(ps, arquivo.pasta) || "(raiz)" }));
}

/** Conteúdo atual de um arquivo do cofre (cópia de trabalho ou última versão). */
export async function lerDoCofre(id: string): Promise<{ arquivo: Arquivo; texto: string; versao: number } | null> {
  const db = await abrirCofre();
  const a = await db.ler<Arquivo>("arquivos", id);
  if (!a || a.lixeira) return null;
  const blob = a.trabalho?.blob ?? a.versoes[a.versoes.length - 1]?.blob;
  const b = blob ? await db.blob(blob) : undefined;
  if (!b) return null;
  return { arquivo: a, texto: await b.text(), versao: a.versoes[a.versoes.length - 1]?.n ?? 1 };
}

/** Referências da tabela: o que o arquivo contém e onde ele é usado. */
export async function referenciasDe(id: string): Promise<{ contem: ReferenciaArquivo[]; usadoEm: ReferenciaArquivo[] }> {
  const rs = await (await abrirCofre()).todos<ReferenciaArquivo>("referencias");
  return { contem: rs.filter((r) => r.pai === id), usadoEm: rs.filter((r) => r.filho === id) };
}

// ---------- GO-OUT / GO-IN (painel lateral e WJPDM) ----------

const ouvintes = new Set<() => void>();
/** Avisa os painéis abertos que o cofre mudou. */
function avisarMudanca() {
  for (const f of ouvintes) f();
}

/** GO-OUT: retira o arquivo para editar (trava com o seu nome). */
export async function goOut(id: string): Promise<string> {
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  const a = await db.ler<Arquivo>("arquivos", id);
  if (!a) return "Arquivo não encontrado no cofre.";
  const b = bloqueioDoCheckout(a, usuario);
  if (b) return b;
  const t = agora();
  a.checkout = { usuario, data: t };
  a.historico.push({ data: t, usuario, texto: "GO-OUT" });
  a.mod = t;
  await db.por("arquivos", a);
  avisarMudanca();
  await sincronizarCofre({ pedir: true, publicar: false });
  return `${a.nome} em GO-OUT com você.`;
}

/**
 * GO-IN: a cópia de trabalho vira a próxima versão, o arquivo deixa de ser "só no dispositivo" e
 * tudo é publicado no pendrive e no Drive. `manter`: continua em GO-OUT. `renovacao`: pedida no
 * toque (janela do Google).
 */
export async function goIn(ids: string[], comentario: string, manter: boolean, renovacao?: Promise<boolean>): Promise<string> {
  renovacao ??= renovarNuvem(true);
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  const feitos: string[] = [], recusados: string[] = [];
  for (const id of ids) {
    const a = await db.ler<Arquivo>("arquivos", id);
    if (!a) continue;
    if (a.checkout?.usuario !== usuario) {
      recusados.push(`${a.nome} (${a.checkout ? `GO-OUT de ${a.checkout.usuario}` : "não está em GO-OUT"})`);
      continue;
    }
    const t = agora();
    if (a.trabalho) {
      const n = a.versoes[a.versoes.length - 1].n + 1;
      a.versoes.push({ n, blob: a.trabalho.blob, tamanho: a.trabalho.tamanho, autor: usuario, data: t, comentario, revisao: a.revisao, estado: a.estado });
      a.historico.push({ data: t, usuario, texto: `Versão ${n}${comentario ? ` — ${comentario}` : ""}` });
      a.trabalho = undefined;
    } else if (a.soLocal && comentario) a.versoes[0].comentario = comentario;
    if (a.soLocal) a.historico.push({ data: t, usuario, texto: "Publicado (primeiro GO-IN)" });
    a.soLocal = undefined;
    if (!manter) {
      delete a.checkout;
      a.historico.push({ data: t, usuario, texto: "GO-IN" });
    }
    a.mod = t;
    await db.por("arquivos", a);
    feitos.push(a.nome);
  }
  avisarMudanca();
  const sinc = feitos.length ? await sincronizarCofre({ pedir: true, publicar: true, renovacao }) : "";
  avisarMudanca();
  return [feitos.length ? `GO-IN: ${feitos.join(", ")}. ${sinc}` : "", recusados.length ? `Sem GO-IN: ${recusados.join("; ")}.` : ""].filter(Boolean).join(" ");
}

/** Desfaz o GO-OUT: descarta a cópia de trabalho (o arquivo volta à última versão publicada). */
export async function desfazerGoOut(id: string): Promise<string> {
  const db = await abrirCofre();
  const usuario = await usuarioDo(db);
  const a = await db.ler<Arquivo>("arquivos", id);
  if (!a?.checkout) return "O arquivo não está em GO-OUT.";
  if (a.checkout.usuario !== usuario) return `O GO-OUT é de ${a.checkout.usuario}.`;
  if (a.soLocal) return "Arquivo novo (nunca publicado): faça o GO-IN para publicar ou exclua-o no WJPDM.";
  const t = agora();
  if (a.trabalho) await db.apagar("blobs", a.trabalho.blob);
  a.trabalho = undefined;
  delete a.checkout;
  a.historico.push({ data: t, usuario, texto: "GO-OUT desfeito (cópia de trabalho descartada)" });
  a.mod = t;
  await db.por("arquivos", a);
  avisarMudanca();
  await sincronizarCofre({ pedir: true, publicar: false });
  return `GO-OUT de ${a.nome} desfeito: voltou à versão ${a.versoes[a.versoes.length - 1].n}.`;
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
.wjc-janela footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px}
.wjc-arvore{max-height:40vh;overflow:auto;border:1px solid #dfe5ec;border-radius:8px}
.wjc-arvore li button{justify-content:flex-start}
.wjc-arvore li button.sel{background:#e3effb;font-weight:600}
.wjc-nome{display:flex;align-items:center;gap:6px}.wjc-nome input{flex:1;min-height:44px;padding:0 10px;border:1px solid #c9d3de;border-radius:8px;font:inherit}
.wjc-aba{position:fixed;right:0;top:calc(50% - 48px);z-index:900;width:30px;min-height:96px;padding:8px 0;border:1px solid #c9d3de;border-right:0;border-radius:10px 0 0 10px;background:#fff;color:#1d2733;font:600 13px system-ui,sans-serif;writing-mode:vertical-rl;cursor:pointer;box-shadow:-2px 2px 8px rgba(0,0,0,.12)}
.wjc-aba b{display:inline-block;margin-top:6px;min-width:18px;border-radius:9px;background:#c98a12;color:#fff;writing-mode:horizontal-tb;font-size:11px;padding:1px 4px}
body.disp-celular .wjc-aba{width:26px;min-height:72px;font-size:12px}
.wjc-gaveta{position:fixed;inset:0;z-index:950}
.wjc-painel{position:absolute;right:0;top:0;bottom:0;width:min(380px,100%);overflow:auto;background:#fff;color:#1d2733;box-shadow:-6px 0 24px rgba(0,0,0,.2);font:14px system-ui,sans-serif}
.wjc-painel header{position:sticky;top:0;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #dfe5ec;font-weight:700;font-size:15px}
.wjc-painel section{padding:10px 14px;border-bottom:1px solid #eef1f5}
.wjc-painel h3{margin:0 0 6px;font-size:14px}
.wjc-painel p{margin:4px 0;color:#55606d;font-size:13px}
.wjc-painel dl{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0 0 8px}.wjc-painel dt{color:#55606d}.wjc-painel dd{margin:0;font-weight:600;overflow-wrap:anywhere}
.wjc-painel button{min-height:44px;padding:0 12px;border:1px solid #c9d3de;border-radius:8px;background:#f6f8fa;font:inherit;cursor:pointer}
.wjc-painel button.destaque{background:#2f7fd0;border-color:#2f7fd0;color:#fff}
.wjc-painel button:disabled{opacity:.45;cursor:default}
.wjc-painel input[type=text]{width:100%;box-sizing:border-box;min-height:40px;margin:4px 0;padding:0 10px;border:1px solid #c9d3de;border-radius:8px;font:inherit}
.wjc-tag{display:inline-block;padding:1px 6px;border-radius:9px;background:#fff3dc;color:#8a5a00;font-size:11px;font-weight:600}
.wjc-go{list-style:none;margin:6px 0;padding:0}
.wjc-go li{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eef1f5}
.wjc-go li input{width:22px;height:22px}.wjc-go li span{flex:1;min-width:0;overflow-wrap:anywhere}.wjc-go small{color:#55606d}
.wjc-msg{min-height:1em}`;

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

/** Pastas que cada app grava na raiz escolhida (o cofre e as pastas irmãs dele). */
const PASTAS_DOS_APPS = ["WJPDM", "WJTaskPlan"];
const DISPOSITIVOS: [string, string][] = [["celular", "Celular"], ["tablet", "Tablet"], ["computador", "Computador"]];

/**
 * Tela "Cópias do cofre": pendrive, pasta do tablet, Google Drive e sincronizar agora.
 * `mestre`: configurações gerais do WJProMaster (página inicial, ⚙): também o perfil do
 * dispositivo e as pastas de todos os apps dentro de cada cópia.
 */
export async function abrirCopias(aoSincronizar?: () => void, mestre = false) {
  const { caixa, fechar } = janela(mestre ? "Configurações do WJProMaster" : "Cópias do cofre (WJPDM)");
  const lerPrefs = (): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem("jlscad:interface") ?? "{}");
    } catch {
      return {};
    }
  };
  const pastas = (raiz: string) => PASTAS_DOS_APPS.map((p) => `<code>${esc(raiz)}/${p}</code>`).join(" e ");
  const desenhar = async (msg = "") => {
    const pen = await pastaDa("pendrive"), tab = await pastaDa("tablet");
    const sitPen = pen ? ((await permissao(pen, false).catch(() => false)) ? "conectado" : "toque Sincronizar para permitir o acesso") : "";
    const disp = String(lerPrefs().dispositivo ?? (matchMedia("(pointer: coarse)").matches ? (Math.min(screen.width, screen.height) < 600 ? "celular" : "tablet") : "computador"));
    caixa.innerHTML = `
      ${mestre ? `<section><h3>Dispositivo</h3><p>Adapta todos os apps ao aparelho: celular (ícones sem texto, painéis em gaveta), tablet (caneta e dedo, alvos grandes) ou computador (mouse e atalhos).</p>
        <div class="wjc-botoes"><select data-disp aria-label="Perfil do dispositivo" style="min-height:40px;min-width:200px;font:inherit;padding:4px 8px;border:1px solid #c9d2dc;border-radius:8px">${DISPOSITIVOS.map(([v, r]) => `<option value="${v}"${v === disp ? " selected" : ""}>${r}</option>`).join("")}</select></div></section>
      <section><h3>Onde ficam os dados</h3><p>Em cada cópia abaixo (pasta padrão do dispositivo, pendrive e Google Drive), os apps gravam na mesma estrutura: <b>WJPDM/</b> (cofre com os arquivos de todos os apps: peças, montagens, desenhos, planilhas, documentos…) e <b>WJTaskPlan/</b> (tarefas). O navegador informa só o nome da pasta escolhida, não o caminho completo.</p></section>` : ""}
      <section><p>Todos os arquivos dos apps ficam no cofre do WJPDM. <b>Salvar</b> grava no dispositivo (banco do app e pasta padrão do dispositivo), em GO-OUT. <b>GO-IN</b> publica no pendrive e no Google Drive, que recebem só o que passou por GO-IN. Entre as cópias, a alteração mais recente vence (a outra vai para a lixeira).</p></section>
      <section><h3>Pendrive</h3>
        <p>${pen ? `Pasta: ${pastas(pen.name)} (${sitPen})` : "Nenhum pendrive escolhido."} Conecte o pendrive (USB-C no tablet) e escolha a pasta raiz dele: o cofre fica em WJPDM/.</p>
        <div class="wjc-botoes">${temPastas() ? `<button data-b="pen" class="destaque">Escolher pendrive…</button>${pen ? `<button data-b="tirarPen">Remover</button>` : ""}` : "<span class='wjc-nao'>Este navegador não permite escolher pastas: use o Chrome atualizado.</span>"}</div></section>
      <section><h3>Pasta padrão do dispositivo</h3>
        <p>${tab ? `Pasta: ${pastas(tab.name)}` : "Nenhuma pasta escolhida: escolha uma pasta do aparelho (ex.: Documentos)."}</p>
        ${temPastas() ? `<div class="wjc-botoes"><button data-b="tab">${tab ? "Trocar pasta…" : "Escolher pasta…"}</button></div>` : ""}</section>
      <section><h3>Google Drive</h3><p>${nuvem ? esc(nuvem.situacao()) : "Aguardando a configuração do acesso ao Google (cliente OAuth)."}${mestre ? ` Pastas: ${pastas("Meu Drive")}.` : ""}</p>
        ${nuvem && !nuvem.conectado() ? `<div class="wjc-botoes"><button data-b="drive" class="destaque">${localStorage.getItem("wjgoogle:autorizado") === "1" ? "Reconectar" : "Conectar ao Google Drive"}</button></div>` : ""}</section>
      <section><div class="wjc-botoes"><button data-b="sinc" class="destaque">Sincronizar agora</button></div>
        <p data-r class="${/desconectado|não encontrado|sem permissão|vencido|recusou|não liberou/.test(msg) ? "wjc-nao" : msg ? "wjc-ok" : ""}">${esc(msg || (ultima ? `Última: ${quando(ultima.quando)} — ${ultima.texto}` : ""))}</p></section>
      <footer><button data-b="fechar" class="destaque">Fechar</button></footer>`;
    const escolher = async (c: Copia) => {
      try {
        const p = await (window as Janela).showDirectoryPicker!({ id: `wjpdm-${c}`, mode: "readwrite", startIn: c === "tablet" ? "documents" : undefined });
        await guardarPasta(c, p);
      } catch {
        return desenhar();
      }
      await desenhar("Sincronizando…");
      await desenhar(await sincronizarCofre({ publicar: true }));
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
        try {
          await nuvem?.conectar();
        } catch (e) {
          return desenhar((e as Error).message);
        }
        await desenhar("Conectado ao Google Drive. Sincronizando…");
        await desenhar(await sincronizarCofre({ pedir: false, publicar: true }));
        aoSincronizar?.();
      },
      sinc: async () => {
        const renovacao = renovarNuvem(true);
        caixa.querySelector<HTMLElement>("[data-r]")!.textContent = "Sincronizando…";
        await desenhar(await sincronizarCofre({ publicar: true, renovacao }));
        aoSincronizar?.();
      },
    };
    caixa.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => void acoes[b.dataset.b!]?.()));
    const sel = caixa.querySelector<HTMLSelectElement>("[data-disp]");
    if (sel)
      sel.onchange = () => {
        const p = lerPrefs();
        p.dispositivo = sel.value;
        localStorage.setItem("jlscad:interface", JSON.stringify(p));
      };
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

// ---------- painel lateral do cofre (GO-OUT / GO-IN em cada app) ----------

/**
 * Aba fixa na lateral direita do app que abre o painel do cofre: dados do documento aberto
 * (pasta, estado, revisão, versão, GO-OUT), botões GO-OUT / GO-IN / Desfazer GO-OUT e a lista de
 * todos os seus arquivos em GO-OUT (de todos os apps) para publicar. `salvar` grava o documento
 * aberto antes do GO-IN dele.
 */
export function instalarPainelCofre(app: ChaveApp, salvar: () => Promise<unknown>) {
  if (!document.getElementById("wjc-css")) document.head.append(Object.assign(document.createElement("style"), { id: "wjc-css", textContent: CSS }));
  const aba = document.createElement("button");
  aba.className = "wjc-aba";
  aba.title = "Cofre: GO-OUT / GO-IN e arquivos em GO-OUT";
  document.body.append(aba);
  let gaveta: HTMLElement | null = null;
  let msg = "";
  let ocupado = false;

  const meusGoOut = async (db: Armazem) => {
    const usuario = await usuarioDo(db);
    return { usuario, lista: (await db.todos<Arquivo>("arquivos")).filter((a) => !a.lixeira && a.checkout?.usuario === usuario).sort((a, b) => (b.mod ?? "").localeCompare(a.mod ?? "")) };
  };
  const contar = async () => {
    const n = (await meusGoOut(await abrirCofre())).lista.length;
    aba.innerHTML = `Cofre${n ? `<b>${n}</b>` : ""}`;
  };

  const desenhar = async () => {
    if (!gaveta) return;
    const db = await abrirCofre();
    const { usuario, lista } = await meusGoOut(db);
    const ps = await db.todos<Pasta>("pastas");
    const id = vinculo(app);
    const a = id ? await db.ler<Arquivo>("arquivos", id) : undefined;
    const atual = a && !a.lixeira ? a : undefined;
    const ultimaV = atual?.versoes[atual.versoes.length - 1];
    const meu = atual?.checkout?.usuario === usuario;
    const onde = (x: Arquivo) => caminhoDaPasta(ps, x.pasta) || "(raiz)";
    const appDe = (x: Arquivo) => APPS[extensao(x.nome)]?.app ?? extensao(x.nome).toUpperCase();
    const corpo = gaveta.querySelector<HTMLElement>(".wjc-painel")!;
    corpo.innerHTML = `
      <header><span>Cofre — ${NOME_APP[app]}</span><button data-b="fechar" title="Fechar">✕</button></header>
      <section><h3>Documento aberto</h3>${atual ? `
        <dl><dt>Arquivo</dt><dd>${esc(atual.nome)}</dd>
          <dt>Pasta</dt><dd>${esc(onde(atual))}</dd>
          <dt>Estado</dt><dd style="color:${estadoDe(atual.estado).cor}">${esc(estadoDe(atual.estado).nome)}</dd>
          <dt>Revisão</dt><dd>${esc(atual.revisao || "—")}</dd>
          <dt>Versão</dt><dd>${atual.soLocal ? "nunca publicado" : `${ultimaV?.n ?? "—"}${ultimaV ? ` (${quando(ultimaV.data)})` : ""}`}</dd>
          <dt>GO-OUT</dt><dd>${atual.checkout ? (meu ? `com você desde ${quando(atual.checkout.data)}` : `com ${esc(atual.checkout.usuario)}`) : "livre (publicado)"}</dd>
          <dt>Trabalho</dt><dd>${atual.trabalho ? `salvo em ${quando(atual.trabalho.data)} (não publicado)` : atual.soLocal ? "só no dispositivo" : "igual à última versão"}</dd></dl>
        ${atual.soLocal ? `<p><span class="wjc-tag">só no dispositivo</span> faça o GO-IN para publicar no pendrive e no Drive.</p>` : ""}
        <div class="wjc-botoes">
          ${!atual.checkout ? `<button data-b="goout" class="destaque">GO-OUT</button>` : ""}
          ${meu ? `<button data-b="goin" class="destaque">GO-IN (publicar)</button>` : ""}
          ${meu && !atual.soLocal ? `<button data-b="desfazer">Desfazer GO-OUT</button>` : ""}
          <button data-b="salvar">Salvar</button>
        </div>
        ${meu ? `<input type="text" data-com placeholder="Comentário da versão (opcional)" /><label><input type="checkbox" data-manter /> Manter em GO-OUT depois do GO-IN</label>` : ""}`
      : `<p>Este documento ainda não está no cofre. Ao salvar, você escolhe a pasta; ele fica em GO-OUT, só no dispositivo, até o GO-IN.</p>
        <div class="wjc-botoes"><button data-b="salvar" class="destaque">Salvar no cofre…</button></div>`}
      </section>
      <section><h3>Meus arquivos em GO-OUT (${lista.length})</h3>
        ${lista.length ? `<ul class="wjc-go">${lista.map((x) => `<li><input type="checkbox" data-x="${x.id}" checked aria-label="Marcar ${esc(x.nome)}" /><span>${esc(x.nome)}${x.id === atual?.id ? " <small>(aberto)</small>" : ""}<br><small>${esc(appDe(x))} · ${esc(onde(x))}${x.trabalho ? ` · salvo ${quando(x.trabalho.data)}` : ""}</small> ${x.soLocal ? `<span class="wjc-tag">só no dispositivo</span>` : ""}</span><button data-i="${x.id}">GO-IN</button></li>`).join("")}</ul>
          <div class="wjc-botoes"><button data-b="goinMarcados" class="destaque">GO-IN dos marcados</button></div>
          <p>O GO-IN cria a versão e publica no pendrive e no Google Drive.</p>`
        : "<p>Nenhum arquivo em GO-OUT com você.</p>"}
      </section>
      <section><p class="wjc-msg ${/desconectado|não encontrado|sem permissão|vencido|Sem GO-IN|Não foi|cancelado|Nenhuma cópia|conflito/.test(msg) ? "wjc-nao" : msg ? "wjc-ok" : ""}">${esc(msg || (ultima ? `Última sincronia: ${quando(ultima.quando)} — ${ultima.texto}` : ""))}</p>
        <div class="wjc-botoes"><button data-b="sinc">Sincronizar agora</button><button data-b="copias">Cópias do cofre…</button><button data-b="pdm">Abrir o WJPDM</button></div></section>`;

    const executar = async (f: () => Promise<unknown>) => {
      if (ocupado) return;
      ocupado = true;
      corpo.querySelectorAll("button").forEach((b) => b.dataset.b !== "fechar" && (b.disabled = true));
      corpo.querySelector<HTMLElement>(".wjc-msg")!.textContent = "Trabalhando…";
      try {
        const r = await f();
        msg = typeof r === "string" ? r : "";
      } catch (e) {
        msg = `Não foi possível: ${(e as Error).message}`;
      }
      ocupado = false;
      await desenhar();
      await contar();
    };
    /** GO-IN: a janela do Google precisa abrir no toque, antes de qualquer espera. */
    const publicar = (ids: string[]) => {
      const renovacao = renovarNuvem(true);
      const com = corpo.querySelector<HTMLInputElement>("[data-com]")?.value.trim() ?? "";
      const manter = !!corpo.querySelector<HTMLInputElement>("[data-manter]")?.checked;
      return executar(async () => {
        if (atual && ids.includes(atual.id)) await salvar(); // publica o que está na tela
        return goIn(ids, com, manter, renovacao);
      });
    };
    const acoes: Record<string, () => unknown> = {
      fechar: fecharPainel,
      salvar: () => executar(salvar),
      goout: () => atual && executar(() => goOut(atual.id)),
      goin: () => atual && publicar([atual.id]),
      desfazer: () => atual && confirm(`Desfazer o GO-OUT de ${atual.nome}? A cópia de trabalho é descartada e o arquivo volta à última versão publicada (o que está na tela não muda; salve de novo para retomar).`) && executar(() => desfazerGoOut(atual.id)),
      goinMarcados: () => {
        const ids = [...corpo.querySelectorAll<HTMLInputElement>("[data-x]:checked")].map((x) => x.dataset.x!);
        if (!ids.length) return void (msg = "Marque ao menos um arquivo.", desenhar());
        return publicar(ids);
      },
      sinc: () => {
        const renovacao = renovarNuvem(true); // janela do Google no toque
        return executar(() => sincronizarCofre({ publicar: true, renovacao }));
      },
      copias: () => void abrirCopias(() => void desenhar()),
      pdm: () => (location.href = new URL(`${import.meta.env.BASE_URL}pdm/`, location.href).href),
    };
    corpo.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => void acoes[b.dataset.b!]?.()));
    corpo.querySelectorAll<HTMLButtonElement>("[data-i]").forEach((b) => (b.onclick = () => void publicar([b.dataset.i!])));
  };

  function fecharPainel() {
    gaveta?.remove();
    gaveta = null;
  }
  aba.onclick = () => {
    if (gaveta) return fecharPainel();
    gaveta = document.createElement("div");
    gaveta.className = "wjc-gaveta";
    gaveta.innerHTML = `<div class="wjc-painel" role="dialog" aria-label="Cofre"></div>`;
    gaveta.addEventListener("pointerdown", (e) => e.target === gaveta && fecharPainel());
    gaveta.addEventListener("keydown", (e) => e.key === "Escape" && fecharPainel());
    document.body.append(gaveta);
    msg = "";
    void desenhar();
  };
  const atualizar = () => {
    void contar();
    if (gaveta && !ocupado) void desenhar();
  };
  ouvintes.add(atualizar);
  addEventListener("focus", atualizar);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && atualizar());
  void contar();
}
