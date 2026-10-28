// Locais de salvamento do WJProMaster (todas as faces): pendrive, Google Drive e pasta do aparelho.
// Regra (definida pelo Johann): salvar grava no pendrive E no Drive; se um estiver desconectado,
// segue com o outro; se os dois faltarem, abre a janela "Salvar como" começando na pasta do
// aparelho usada da última vez. Pastas escolhidas ficam guardadas (IndexedDB) por face.
// Pastas do disco/pendrive usam a API de acesso a arquivos do navegador (Chrome/Edge no
// computador; Chrome no Android a partir da versão 132). Sem ela, o arquivo é baixado.

import { Armazem } from "./armazem";

export type ChaveApp = "cad" | "plan" | "word" | "cron" | "apn" | "pdm" | "erp";
export const NOME_APP: Record<ChaveApp, string> = {
  cad: "WJCAD", plan: "WJPlan", word: "WJWrite", cron: "WJCronProject", apn: "WJApresentation", pdm: "WJPDM", erp: "WJERP",
};
type Lugar = "pendrive" | "aparelho";

/** Destino na nuvem (Google Drive): entra quando o cliente OAuth estiver configurado. */
export interface DestinoNuvem {
  nome: string;
  /** Conectado e autorizado (sem abrir janela de login). */
  conectado(): boolean;
  /** Situação para mostrar na tela de locais. */
  situacao(): string;
  conectar?(): Promise<void>;
  salvar(app: ChaveApp, arquivo: string, dados: Blob): Promise<void>;
}
let nuvem: DestinoNuvem | null = null;
export function registrarNuvem(d: DestinoNuvem) {
  nuvem = d;
}

// ---------- API de arquivos do navegador (tipos que o TypeScript ainda não traz) ----------
type Permissao = "granted" | "denied" | "prompt";
interface Pasta extends FileSystemDirectoryHandle {
  queryPermission?(o: { mode: "readwrite" }): Promise<Permissao>;
  requestPermission?(o: { mode: "readwrite" }): Promise<Permissao>;
}
type Janela = typeof window & {
  showDirectoryPicker?(o?: { id?: string; mode?: "readwrite"; startIn?: Pasta | string }): Promise<Pasta>;
  showSaveFilePicker?(o?: { id?: string; suggestedName?: string; startIn?: Pasta | string }): Promise<FileSystemFileHandle>;
};
const w = window as Janela;
export const temPastas = () => typeof w.showDirectoryPicker === "function";

// ---------- pastas guardadas ----------
let banco: Promise<Armazem> | null = null;
const db = () => (banco ??= Armazem.abrir("wjlocais", ["pastas"]));
async function lerPasta(app: ChaveApp, lugar: Lugar): Promise<Pasta | undefined> {
  try {
    return (await (await db()).ler<{ id: string; pasta: Pasta }>("pastas", `${app}:${lugar}`))?.pasta;
  } catch {
    return undefined;
  }
}
async function guardarPasta(app: ChaveApp, lugar: Lugar, pasta: Pasta | null) {
  const a = await db();
  if (pasta) await a.por("pastas", { id: `${app}:${lugar}`, pasta } as { id: string });
  else await a.apagar("pastas", `${app}:${lugar}`);
}

/** Permissão de escrita (pede de novo se o navegador esqueceu: um toque em "Permitir"). */
async function podeEscrever(p: Pasta): Promise<boolean> {
  if (typeof p.queryPermission !== "function") return true; // pasta sem controle de permissão (ex.: interna do navegador)
  if ((await p.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await p.requestPermission?.({ mode: "readwrite" })) === "granted";
}

const semAcentos = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_");

async function gravarNaPasta(p: Pasta, arquivo: string, dados: Blob) {
  if (!(await podeEscrever(p))) throw new Error("permissão negada");
  let f: FileSystemFileHandle;
  try {
    f = await p.getFileHandle(arquivo, { create: true });
  } catch (e) {
    // alguns sistemas de arquivos recusam acentos ("Peça"): tenta "Peca"
    if (semAcentos(arquivo) === arquivo || (e as Error).name === "NotFoundError") throw e;
    f = await p.getFileHandle(semAcentos(arquivo), { create: true });
  }
  const s = await f.createWritable();
  await s.write(dados);
  await s.close();
}

const nomeSeguro = (n: string) => n.replace(/[\\/:*?"<>|]/g, "_");

function baixar(arquivo: string, dados: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(dados);
  a.download = arquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- salvar ----------

/**
 * Salva nos locais da face: pendrive e Drive; sem os dois, janela "Salvar como" (começa na
 * última pasta do aparelho). Devolve a frase para o aviso ("Salvo no pendrive e no Drive").
 */
export async function salvarNosLocais(app: ChaveApp, arquivo: string, dados: Blob): Promise<string> {
  arquivo = nomeSeguro(arquivo);
  const ok: string[] = [], falhas: string[] = [];
  const pen = await lerPasta(app, "pendrive");
  if (pen) {
    try {
      await gravarNaPasta(pen, arquivo, dados);
      ok.push(`no pendrive (${pen.name})`);
    } catch {
      falhas.push("pendrive desconectado");
    }
  }
  if (nuvem?.conectado() && navigator.onLine) {
    try {
      await nuvem.salvar(app, arquivo, dados);
      ok.push(`no ${nuvem.nome}`);
    } catch {
      falhas.push(`${nuvem.nome} sem conexão`);
    }
  }
  if (ok.length) return `Salvo ${ok.join(" e ")}${falhas.length ? ` (${falhas.join(", ")})` : ""}.`;
  // nenhum dos dois: o usuário escolhe onde (no aparelho)
  if (typeof w.showSaveFilePicker === "function") {
    const inicio = await lerPasta(app, "aparelho");
    let f: FileSystemFileHandle;
    try {
      f = await w.showSaveFilePicker({ id: `wj-${app}`, suggestedName: arquivo, startIn: inicio ?? "documents" });
    } catch {
      return "Salvamento cancelado.";
    }
    const s = await f.createWritable();
    await s.write(dados);
    await s.close();
    return `Salvo no aparelho (${f.name})${falhas.length ? ` — ${falhas.join(", ")}` : ""}.`;
  }
  baixar(arquivo, dados);
  return `Arquivo baixado (${arquivo})${falhas.length ? ` — ${falhas.join(", ")}` : ""}.`;
}

// ---------- tela "Locais de salvamento" ----------

const CSS = `
.wjl-fundo{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:rgba(20,30,40,.35);padding:12px}
.wjl-janela{width:min(560px,100%);max-height:calc(100% - 24px);overflow:auto;background:#fff;color:#1d2733;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:15px system-ui,sans-serif}
.wjl-janela header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #dfe5ec;font-weight:700}
.wjl-janela section{padding:12px 16px;border-bottom:1px solid #eef1f5}
.wjl-janela h3{margin:0 0 4px;font-size:15px}
.wjl-janela p{margin:4px 0 8px;color:#55606d;font-size:13px}
.wjl-botoes{display:flex;flex-wrap:wrap;gap:8px}
.wjl-janela button{min-height:44px;padding:0 14px;border:1px solid #c9d3de;border-radius:8px;background:#f6f8fa;font:inherit;cursor:pointer}
.wjl-janela button.destaque{background:#2f7fd0;border-color:#2f7fd0;color:#fff}
.wjl-janela .ok{color:#24883f;font-weight:600}.wjl-janela .nao{color:#b3401f;font-weight:600}
.wjl-janela footer{display:flex;justify-content:flex-end;padding:12px 16px}`;

/** Tela de locais de salvamento da face (pendrive, Drive, aparelho). */
export async function abrirLocais(app: ChaveApp) {
  if (!document.getElementById("wjl-css")) document.head.append(Object.assign(document.createElement("style"), { id: "wjl-css", textContent: CSS }));
  const fundo = document.createElement("div");
  fundo.className = "wjl-fundo";
  const fechar = () => fundo.remove();
  fundo.addEventListener("pointerdown", (e) => e.target === fundo && fechar());
  fundo.addEventListener("keydown", (e) => e.key === "Escape" && fechar());
  document.body.append(fundo);

  const desenhar = async () => {
    const pen = await lerPasta(app, "pendrive"), ap = await lerPasta(app, "aparelho");
    fundo.innerHTML = `<div class="wjl-janela" role="dialog" aria-modal="true">
      <header><span>Locais de salvamento — ${NOME_APP[app]}</span><button data-b="fechar" title="Fechar">✕</button></header>
      <section><h3>Pendrive</h3>
        <p>${pen ? `Pasta: <b>${pen.name}</b>` : "Nenhuma pasta escolhida."} Conecte o pendrive (USB-C no tablet) e escolha a pasta desta face.</p>
        <div class="wjl-botoes">${temPastas() ? `<button data-b="pen" class="destaque">Escolher pasta…</button>${pen ? `<button data-b="testar">Testar pendrive</button><button data-b="tirar">Remover</button>` : ""}` : "<p class='nao'>Este navegador não permite escolher pastas: use o Chrome atualizado.</p>"}</div>
        <p data-r></p></section>
      <section><h3>Google Drive</h3><p>${nuvem ? nuvem.situacao() : "Aguardando a configuração do acesso ao Google (cliente OAuth)."}</p>
        ${nuvem?.conectar && !nuvem.conectado() ? `<div class="wjl-botoes"><button data-b="drive" class="destaque">Conectar ao Google Drive</button></div>` : ""}</section>
      <section><h3>Aparelho (quando pendrive e Drive faltarem)</h3>
        <p>Abre a janela "Salvar como" para você escolher o lugar${ap ? `, começando em <b>${ap.name}</b>` : ""}.</p>
        ${temPastas() ? `<div class="wjl-botoes"><button data-b="ap">Pasta inicial…</button></div>` : ""}</section>
      <section><p>Salvar (💾 ou Ctrl+S) grava no pendrive e no Drive ao mesmo tempo; se um estiver desconectado, grava no outro.</p></section>
      <footer><button data-b="fechar" class="destaque">Fechar</button></footer></div>`;
    const r = fundo.querySelector<HTMLElement>("[data-r]")!;
    const acoes: Record<string, () => Promise<void>> = {
      fechar: async () => fechar(),
      pen: async () => {
        try {
          await guardarPasta(app, "pendrive", await w.showDirectoryPicker!({ id: `wj-pen-${app}`, mode: "readwrite" }));
        } catch {
          return;
        }
        await desenhar();
      },
      ap: async () => {
        try {
          await guardarPasta(app, "aparelho", await w.showDirectoryPicker!({ id: `wj-ap-${app}`, mode: "readwrite", startIn: "documents" }));
        } catch {
          return;
        }
        await desenhar();
      },
      tirar: async () => {
        await guardarPasta(app, "pendrive", null);
        await desenhar();
      },
      testar: async () => {
        const p = (await lerPasta(app, "pendrive"))!;
        try {
          await gravarNaPasta(p, ".wjpromaster-teste", new Blob([new Date().toISOString()]));
          await p.removeEntry(".wjpromaster-teste");
          r.className = "ok";
          r.textContent = `Pendrive ok: gravou e apagou um arquivo de teste em "${p.name}".`;
        } catch (e) {
          r.className = "nao";
          r.textContent = `Não consegui gravar em "${p.name}": pendrive desconectado ou sem permissão (${(e as Error).name ?? e}).`;
        }
      },
      drive: async () => {
        await nuvem?.conectar?.();
        await desenhar();
      },
    };
    fundo.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => void acoes[b.dataset.b!]?.()));
    fundo.querySelector<HTMLElement>("footer button")?.focus();
  };
  await desenhar();
}
