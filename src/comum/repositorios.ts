// Cópias do cofre do WJPDM no navegador: o banco do aparelho (IndexedDB, cópia de trabalho de
// todos os apps) e pastas de disco (pendrive, pasta padrão do tablet). O Google Drive entra com a
// mesma interface (Repositorio) quando o acesso ao Google estiver configurado.
//
// Pasta de disco:  <raiz>/WJPDM/<pastas>/<arquivo>   ← arquivo atual, abre em qualquer computador
//                  <raiz>/WJPDM/.wjpdm/indice.json   ← pastas, cartões, estados, versões, histórico
//                  <raiz>/WJPDM/.wjpdm/blobs/<id>    ← conteúdo de cada versão (nunca muda)

import { Armazem } from "./armazem";
import { blobAtual, caminhoDoArquivo, caminhosDasPastas, indiceVazio, type Indice, type MetaCofre, type Repositorio } from "../pdm/sincronia";
import type { Arquivo, Item, Pasta, ReferenciaArquivo } from "../pdm/regras";

// ---------- banco do aparelho ----------

export class RepositorioAparelho implements Repositorio {
  nome = "aparelho";
  constructor(private db: Armazem) {}
  async lerIndice(): Promise<Indice> {
    return {
      ...indiceVazio(),
      meta: (await this.db.ler<MetaCofre>("meta", "meta")) ?? null,
      pastas: await this.db.todos<Pasta>("pastas"),
      arquivos: await this.db.todos<Arquivo>("arquivos"),
      itens: await this.db.todos<Item>("itens"),
      referencias: await this.db.todos<ReferenciaArquivo>("referencias"),
      exclusoes: await this.db.todos("exclusoes"),
    };
  }
  async gravarIndice(i: Indice) {
    const iguala = async <T extends { id: string }>(loja: string, lista: T[]) => {
      const novos = new Set(lista.map((x) => x.id));
      for (const id of await this.db.chaves(loja)) if (!novos.has(id)) await this.db.apagar(loja, id);
      for (const x of lista) await this.db.por(loja, x);
    };
    if (i.meta) await this.db.por("meta", i.meta);
    await iguala("pastas", i.pastas);
    await iguala("arquivos", i.arquivos);
    await iguala("itens", i.itens);
    await iguala("referencias", i.referencias ?? []);
    await iguala("exclusoes", i.exclusoes);
  }
  async listarBlobs() {
    return new Set(await this.db.chaves("blobs"));
  }
  lerBlob(id: string) {
    return this.db.blob(id);
  }
  gravarBlob(id: string, b: Blob) {
    return this.db.porBlob(id, b);
  }
  apagarBlob(id: string) {
    return this.db.apagar("blobs", id);
  }
}

// ---------- pasta de disco (pendrive, tablet) ----------

type Permissao = "granted" | "denied" | "prompt";
export interface PastaDisco extends FileSystemDirectoryHandle {
  queryPermission?(o: { mode: "readwrite" }): Promise<Permissao>;
  requestPermission?(o: { mode: "readwrite" }): Promise<Permissao>;
}

/** Permissão de escrita; `pedir` mostra o "Permitir" do navegador (precisa de um toque recente). */
export async function permissao(p: PastaDisco, pedir: boolean): Promise<boolean> {
  if (typeof p.queryPermission !== "function") return true; // pasta interna do navegador
  if ((await p.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return pedir && (await p.requestPermission?.({ mode: "readwrite" })) === "granted";
}

const nomeSeguro = (n: string) => n.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "_") || "_";
const semAcentos = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_");

/** Pasta/arquivo pelo nome; se o sistema recusar acentos, usa o nome sem acento. */
async function subpasta(d: FileSystemDirectoryHandle, nome: string, criar = true) {
  try {
    return await d.getDirectoryHandle(nomeSeguro(nome), { create: criar });
  } catch (e) {
    if ((e as Error).name === "NotFoundError" && !criar) throw e;
    return d.getDirectoryHandle(semAcentos(nomeSeguro(nome)), { create: criar });
  }
}
async function arquivoEm(d: FileSystemDirectoryHandle, nome: string, criar = true) {
  try {
    return await d.getFileHandle(nomeSeguro(nome), { create: criar });
  } catch (e) {
    if ((e as Error).name === "NotFoundError" && !criar) throw e;
    return d.getFileHandle(semAcentos(nomeSeguro(nome)), { create: criar });
  }
}
async function escrever(d: FileSystemDirectoryHandle, nome: string, dados: Blob | string) {
  const s = await (await arquivoEm(d, nome)).createWritable();
  await s.write(dados);
  await s.close();
}
async function lerTexto(d: FileSystemDirectoryHandle, nome: string): Promise<string | null> {
  try {
    return await (await (await d.getFileHandle(nome)).getFile()).text();
  } catch (e) {
    if ((e as Error).name === "NotFoundError") return null;
    throw e;
  }
}

type Visiveis = Record<string, { caminho: string[]; blob: string }>;

export class RepositorioPasta implements Repositorio {
  private dirs?: Promise<{ cofre: FileSystemDirectoryHandle; sis: FileSystemDirectoryHandle; blobs: FileSystemDirectoryHandle }>;
  /** `publicado`: pendrive (só o que passou por GO-IN); a pasta do dispositivo recebe tudo. */
  constructor(public nome: string, private raiz: PastaDisco, public publicado = false) {}

  private pastas() {
    return (this.dirs ??= (async () => {
      const cofre = await this.raiz.getDirectoryHandle("WJPDM", { create: true });
      const sis = await cofre.getDirectoryHandle(".wjpdm", { create: true });
      const blobs = await sis.getDirectoryHandle("blobs", { create: true });
      return { cofre, sis, blobs };
    })());
  }
  async lerIndice(): Promise<Indice | null> {
    const t = await lerTexto((await this.pastas()).sis, "indice.json");
    if (!t) return null;
    const i = JSON.parse(t) as Indice;
    if (i.formato !== "wjpdm-indice") throw new Error("índice do cofre inválido");
    return i;
  }
  async gravarIndice(i: Indice) {
    await escrever((await this.pastas()).sis, "indice.json", JSON.stringify(i));
  }
  async listarBlobs() {
    const r = new Set<string>();
    for await (const k of (await this.pastas()).blobs.keys()) r.add(k);
    return r;
  }
  async lerBlob(id: string) {
    try {
      return await (await (await this.pastas()).blobs.getFileHandle(id)).getFile();
    } catch {
      return undefined;
    }
  }
  async gravarBlob(id: string, b: Blob) {
    await escrever((await this.pastas()).blobs, id, b);
  }
  async apagarBlob(id: string) {
    await (await this.pastas()).blobs.removeEntry(id);
  }

  /** Arquivos legíveis: grava o que mudou, apaga o que saiu ou mudou de lugar; pastas iguais às do cofre. */
  async gravarVisiveis(i: Indice, lerBlob: (id: string) => Promise<Blob | undefined>) {
    const { cofre, sis } = await this.pastas();
    const antes: Visiveis = JSON.parse((await lerTexto(sis, "visiveis.json")) ?? "{}");
    // pastas do cofre (também as vazias): cria as novas
    const pastasAntes: string[][] = JSON.parse((await lerTexto(sis, "pastas.json")) ?? "[]");
    const pastasAgora = caminhosDasPastas(i);
    const chave = (c: string[]) => JSON.stringify(c);
    const tinha = new Set(pastasAntes.map(chave)), tem = new Set(pastasAgora.map(chave));
    for (const c of pastasAgora) {
      if (tinha.has(chave(c))) continue;
      let d: FileSystemDirectoryHandle = cofre;
      for (const n of c) d = await subpasta(d, n);
    }
    const agora: Visiveis = {};
    const igual = (a: string[], b: string[]) => a.length === b.length && a.every((x, k) => x === b[k]);
    for (const a of i.arquivos) {
      const blob = blobAtual(a);
      if (a.lixeira || !blob) continue;
      const caminho = caminhoDoArquivo(i, a);
      agora[a.id] = { caminho, blob };
      const v = antes[a.id];
      if (v && v.blob === blob && igual(v.caminho, caminho)) continue;
      const dados = await lerBlob(blob);
      if (!dados) continue;
      let d: FileSystemDirectoryHandle = cofre;
      for (const n of caminho.slice(0, -1)) d = await subpasta(d, n);
      await escrever(d, caminho[caminho.length - 1], dados);
    }
    // o que saiu (lixeira, destruído) ou mudou de lugar/nome
    for (const [id, v] of Object.entries(antes)) {
      const novo = agora[id];
      if (novo && igual(novo.caminho, v.caminho)) continue;
      try {
        let d: FileSystemDirectoryHandle = cofre;
        for (const n of v.caminho.slice(0, -1)) d = await subpasta(d, n, false);
        const nome = v.caminho[v.caminho.length - 1];
        await d.removeEntry(nomeSeguro(nome)).catch(() => d.removeEntry(semAcentos(nomeSeguro(nome))));
      } catch {
        /* já não existia */
      }
    }
    // pastas excluídas ou renomeadas no cofre: apaga do disco (as mais fundas primeiro). Sem
    // "recursive": o que alguém pôs à mão lá dentro (fora do cofre) não é apagado.
    for (const c of pastasAntes.filter((x) => !tem.has(chave(x))).sort((a, b) => b.length - a.length)) {
      try {
        let d: FileSystemDirectoryHandle = cofre;
        for (const n of c.slice(0, -1)) d = await subpasta(d, n, false);
        const n = c[c.length - 1];
        await d.removeEntry(nomeSeguro(n)).catch(() => d.removeEntry(semAcentos(nomeSeguro(n))));
      } catch {
        /* já não existia ou tem arquivos de fora do cofre */
      }
    }
    await escrever(sis, "visiveis.json", JSON.stringify(agora));
    await escrever(sis, "pastas.json", JSON.stringify(pastasAgora));
  }
}
