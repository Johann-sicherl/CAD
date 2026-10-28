// Sincronia entre as cópias do cofre do WJPDM (banco do aparelho, pendrive, pasta do tablet,
// Google Drive). Regras definidas pelo Johann (28/10/2026):
// - o que falta numa cópia é copiado; registro alterado nas duas: a alteração MAIS RECENTE vence;
// - a versão que perdeu um conflito não some: vai para a lixeira do cofre (30 dias);
// - exclusões se propagam pela lixeira; a lixeira se esvazia sozinha após 30 dias.
// Tudo puro e testável em Node (scripts/teste-sincronia.ts); quem lê e grava cada cópia é um
// Repositorio.

import type { Arquivo, Item, Pasta } from "./regras";
import { extensao } from "./regras";

export interface MetaCofre {
  id: "meta";
  nome: string;
  usuario: string;
  mascara: string;
  mod?: string;
}

/** Registro destruído (saiu da lixeira): some de todas as cópias. */
export interface Exclusao {
  id: string;
  tipo: "arquivo" | "pasta" | "item";
  data: string;
}

/** Índice do cofre: tudo menos o conteúdo dos arquivos (blobs). */
export interface Indice {
  formato: "wjpdm-indice";
  versao: 1;
  meta: MetaCofre | null;
  pastas: Pasta[];
  arquivos: Arquivo[];
  itens: Item[];
  exclusoes: Exclusao[];
}

export const indiceVazio = (): Indice => ({ formato: "wjpdm-indice", versao: 1, meta: null, pastas: [], arquivos: [], itens: [], exclusoes: [] });

/** Uma cópia do cofre (banco do aparelho, pasta do pendrive/tablet, Drive). */
export interface Repositorio {
  nome: string;
  /**
   * Cópia de publicação (pendrive, Drive): recebe só o que passou por GO-IN — sem cópias de
   * trabalho e sem arquivos que nunca foram publicados. A pasta do dispositivo recebe tudo.
   */
  publicado?: boolean;
  lerIndice(): Promise<Indice | null>;
  gravarIndice(i: Indice): Promise<void>;
  listarBlobs(): Promise<Set<string>>;
  lerBlob(id: string): Promise<Blob | undefined>;
  gravarBlob(id: string, b: Blob): Promise<void>;
  apagarBlob?(id: string): Promise<void>;
  /** Arquivos visíveis (pastas com nomes legíveis), para abrir o cofre em qualquer computador. */
  gravarVisiveis?(i: Indice, lerBlob: (id: string) => Promise<Blob | undefined>): Promise<void>;
}

const DIA = 86400000;
export const DIAS_LIXEIRA = 30;
const mod = (x: { mod?: string }) => x.mod ?? "";

/** Blobs que o arquivo usa (versões e cópia de trabalho). */
export const blobsDoArquivo = (a: Arquivo) => [...a.versoes.map((v) => v.blob), ...(a.trabalho ? [a.trabalho.blob] : [])];

/** Conteúdo atual do arquivo: a cópia de trabalho ou a última versão. */
export const blobAtual = (a: Arquivo) => a.trabalho?.blob ?? a.versoes[a.versoes.length - 1]?.blob;

/**
 * O perdedor tem uma versão publicada que o vencedor não tem (seria perdida)? A cópia de trabalho e
 * o rascunho de um arquivo nunca publicado (soLocal) são substituídos a cada salvar: a cópia mais
 * antiga deles é só um salvar anterior, não um conflito.
 */
function perderiaConteudo(vencedor: Arquivo, perdedor: Arquivo): boolean {
  if (perdedor.soLocal) return false;
  const tem = new Set(blobsDoArquivo(vencedor));
  return perdedor.versoes.some((v) => !tem.has(v.blob));
}

/** Cópia do perdedor na lixeira, com id fixo (todas as cópias do cofre geram a mesma). */
function copiaDeConflito(p: Arquivo): Arquivo {
  const ext = extensao(p.nome);
  const base = ext ? p.nome.slice(0, -(ext.length + 1)) : p.nome;
  const dia = mod(p).slice(0, 10) || "sem data";
  return {
    ...JSON.parse(JSON.stringify(p)),
    id: `${p.id}~${mod(p)}`,
    nome: `${base} (conflito ${dia})${ext ? `.${ext}` : ""}`,
    checkout: undefined,
    lixeira: true,
    lixeiraData: mod(p),
    historico: [...p.historico, { data: mod(p), usuario: "WJPDM", texto: "Versão mais antiga de um conflito entre cópias do cofre (guardada na lixeira)" }],
  };
}

/**
 * Junta os índices de todas as cópias. Por registro (id): fica o de alteração mais recente;
 * exclusão mais nova que o registro o remove. Arquivos em conflito (o perdedor tinha conteúdo
 * que o vencedor não tem) geram uma cópia na lixeira. Lixeira com mais de 30 dias vira exclusão.
 */
export function mesclar(indices: Indice[], agora: string): { indice: Indice; conflitos: string[] } {
  const r = indiceVazio();
  const conflitos: string[] = [];
  // exclusões: a mais recente de cada id
  const exc = new Map<string, Exclusao>();
  for (const i of indices) for (const e of i.exclusoes ?? []) if (!exc.has(e.id) || exc.get(e.id)!.data < e.data) exc.set(e.id, e);
  // meta: a mais recente
  for (const i of indices) if (i.meta && (!r.meta || mod(i.meta) > mod(r.meta))) r.meta = i.meta;

  const juntar = <T extends { id: string; mod?: string }>(lista: (i: Indice) => T[], aoEscolher?: (v: T, outros: T[]) => void): T[] => {
    const grupos = new Map<string, T[]>();
    for (const i of indices) for (const x of lista(i) ?? []) grupos.set(x.id, [...(grupos.get(x.id) ?? []), x]);
    const out: T[] = [];
    for (const [id, g] of grupos) {
      const v = g.reduce((a, b) => (mod(b) > mod(a) ? b : a));
      const e = exc.get(id);
      if (e && e.data >= mod(v)) continue; // destruído depois da última alteração
      if (e) exc.delete(id); // recriado/alterado depois da exclusão: vale o registro
      aoEscolher?.(v, g.filter((x) => x !== v));
      out.push(v);
    }
    return out;
  };

  r.pastas = juntar((i) => i.pastas);
  r.itens = juntar((i) => i.itens);
  const extras: Arquivo[] = [];
  r.arquivos = juntar(
    (i) => i.arquivos,
    (v, outros) => {
      for (const o of outros) {
        if (mod(o) === mod(v) || !perderiaConteudo(v, o)) continue;
        const c = copiaDeConflito(o);
        if (!extras.some((x) => x.id === c.id)) {
          extras.push(c);
          conflitos.push(v.nome);
        }
      }
    },
  );
  for (const c of extras) {
    const e = exc.get(c.id);
    if (!(e && e.data >= mod(c)) && !r.arquivos.some((x) => x.id === c.id)) r.arquivos.push(c);
  }
  // lixeira vencida (30 dias): vira exclusão em todas as cópias
  const limite = new Date(Date.parse(agora) - DIAS_LIXEIRA * DIA).toISOString();
  r.arquivos = r.arquivos.filter((a) => {
    if (a.lixeira && a.lixeiraData && a.lixeiraData < limite) {
      exc.set(a.id, { id: a.id, tipo: "arquivo", data: agora });
      return false;
    }
    return true;
  });
  r.exclusoes = [...exc.values()];
  return { indice: r, conflitos };
}

/** O que uma cópia de publicação recebe: só versões que passaram por GO-IN. */
export function vistaPublicada(i: Indice): Indice {
  return { ...i, arquivos: i.arquivos.filter((a) => !a.soLocal).map((a) => (a.trabalho ? { ...a, trabalho: undefined } : a)) };
}

/** Todos os blobs que o índice usa. */
export function blobsDoIndice(i: Indice): Set<string> {
  return new Set(i.arquivos.flatMap(blobsDoArquivo));
}

/** Caminho legível do arquivo no cofre (nomes das pastas + nome do arquivo). */
export function caminhoDoArquivo(i: Indice, a: Arquivo): string[] {
  const nomes: string[] = [];
  const porId = new Map(i.pastas.map((p) => [p.id, p]));
  let p = porId.get(a.pasta);
  const vistos = new Set<string>();
  while (p && !vistos.has(p.id)) {
    vistos.add(p.id);
    nomes.unshift(p.nome);
    p = p.pai ? porId.get(p.pai) : undefined;
  }
  return [...nomes, a.nome];
}

export interface ResultadoSincronia {
  indice: Indice;
  conflitos: string[];
  /** blobs copiados entre as cópias */
  copiados: number;
  /** blobs que nenhuma cópia tem (arquivo incompleto) */
  faltando: string[];
  /** cópias que falharam (desconectadas no meio) */
  falhas: { repo: string; erro: string }[];
}

/**
 * Iguala as cópias: junta os índices, copia os blobs que faltam em cada uma, grava os arquivos
 * visíveis e o índice comum. Uma cópia que falhar (pendrive arrancado) não impede as outras.
 */
export async function sincronizar(repos: Repositorio[], agora: string): Promise<ResultadoSincronia> {
  const falhas: { repo: string; erro: string }[] = [];
  const vivos: Repositorio[] = [], indices: Indice[] = [];
  for (const r of repos) {
    try {
      indices.push((await r.lerIndice()) ?? indiceVazio());
      vivos.push(r);
    } catch (e) {
      falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
    }
  }
  const { indice, conflitos } = mesclar(indices, agora);
  const vista = (r: Repositorio) => (r.publicado ? vistaPublicada(indice) : indice);
  const precisaDe = new Map(repos.map((r) => [r, blobsDoIndice(vista(r))]));
  const tem = new Map<Repositorio, Set<string>>();
  for (const r of [...vivos]) {
    try {
      tem.set(r, await r.listarBlobs());
    } catch (e) {
      falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
      vivos.splice(vivos.indexOf(r), 1);
    }
  }
  let copiados = 0;
  const faltando: string[] = [];
  const todos = new Set(vivos.flatMap((r) => [...precisaDe.get(r)!]));
  for (const id of todos) {
    const sem = vivos.filter((r) => precisaDe.get(r)!.has(id) && !tem.get(r)!.has(id));
    if (!sem.length) continue;
    const fonte = vivos.find((r) => tem.get(r)!.has(id));
    const b = fonte && (await fonte.lerBlob(id).catch(() => undefined));
    if (!b) {
      faltando.push(id);
      continue;
    }
    for (const r of sem) {
      try {
        await r.gravarBlob(id, b);
        tem.get(r)!.add(id);
        copiados++;
      } catch (e) {
        if (!falhas.some((f) => f.repo === r.nome)) falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
      }
    }
  }
  for (const r of vivos) {
    if (falhas.some((f) => f.repo === r.nome)) continue;
    try {
      const v = vista(r);
      await r.gravarVisiveis?.(v, (id) => r.lerBlob(id));
      await r.gravarIndice(v);
      // blobs que nenhum arquivo usa mais (destruídos): liberam espaço
      const precisa = precisaDe.get(r)!;
      if (r.apagarBlob) for (const id of tem.get(r)!) if (!precisa.has(id)) await r.apagarBlob(id).catch(() => {});
    } catch (e) {
      falhas.push({ repo: r.nome, erro: (e as Error).message ?? String(e) });
    }
  }
  return { indice, conflitos, copiados, faltando, falhas };
}
