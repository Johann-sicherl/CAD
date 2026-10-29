// Onde ficam os dados do WJTaskPlan: banco do aparelho (IndexedDB "wjtaskplan") e, com a mesma
// lógica do cofre do WJPDM, numa pasta IRMÃ do cofre em cada cópia:
//   pendrive e pasta padrão do dispositivo:  <raiz>/WJTaskPlan/tarefas.json (+ tarefas.csv, tabela legível)
//   Google Drive:                           Meu Drive/WJTaskPlan/tarefas.json (+ tarefas.csv)
// As raízes e o acesso ao Google são os mesmos do cofre (📁 Cópias do cofre). A mescla (a alteração
// mais recente vence, registro por registro) está em regras.ts.

import { Armazem } from "../comum/armazem";
import { pastaDa } from "../comum/cofre";
import { driveGoogle, nuvemGoogle } from "../comum/drive";
import { permissao, type PastaDisco } from "../comum/repositorios";
import { baseNova, mesclar, tabelaCSV, validarBase, type Base } from "./regras";

const PASTA = "WJTaskPlan";
const ARQUIVO = "tarefas.json";
const TABELA = "tarefas.csv";

let db: Promise<Armazem> | null = null;
const banco = () => (db ??= Armazem.abrir("wjtaskplan", ["base"]));

export async function lerLocal(): Promise<Base> {
  try {
    const r = await (await banco()).ler<{ id: string; base: Base }>("base", "base");
    return r ? validarBase(r.base) : baseNova();
  } catch {
    return baseNova();
  }
}

export async function gravarLocal(b: Base) {
  await (await banco()).por("base", { id: "base", base: b } as { id: string });
}

interface Copia {
  nome: string;
  ler(): Promise<Base | null>;
  gravar(b: Base): Promise<void>;
}

function copiaPasta(nome: string, raiz: PastaDisco): Copia {
  const pasta = () => raiz.getDirectoryHandle(PASTA, { create: true });
  const escrever = async (n: string, dados: string) => {
    const w = await (await (await pasta()).getFileHandle(n, { create: true })).createWritable();
    await w.write(dados);
    await w.close();
  };
  return {
    nome,
    async ler() {
      try {
        return validarBase(JSON.parse(await (await (await (await pasta()).getFileHandle(ARQUIVO)).getFile()).text()));
      } catch (e) {
        if ((e as Error).name === "NotFoundError") return null;
        throw e;
      }
    },
    async gravar(b) {
      await escrever(ARQUIVO, JSON.stringify(b));
      await escrever(TABELA, tabelaCSV(b));
    },
  };
}

function copiaDrive(): Copia {
  const d = driveGoogle();
  return {
    nome: "Google Drive",
    async ler() {
      const t = await d.lerArquivo([PASTA], ARQUIVO);
      return t ? validarBase(JSON.parse(t)) : null;
    },
    async gravar(b) {
      await d.gravarArquivo([PASTA], ARQUIVO, new Blob([JSON.stringify(b)], { type: "application/json" }));
      await d.gravarArquivo([PASTA], TABELA, new Blob([tabelaCSV(b)], { type: "text/csv" }));
    },
  };
}

let fila: Promise<unknown> = Promise.resolve();

/**
 * Iguala o aparelho com as cópias conectadas. `pedir`: pode mostrar o "Permitir" das pastas e a
 * janela do Google (só logo depois de um toque). Devolve a base mesclada e um resumo.
 */
export function sincronizarTarefas(pedir: boolean): Promise<{ base: Base; texto: string; mudou: boolean }> {
  // a renovação do Google precisa sair já, enquanto o toque do usuário ainda vale
  const renovacao = pedir ? nuvemGoogle.renovar().catch(() => false) : Promise.resolve(nuvemGoogle.conectado());
  const tarefa = fila.then(async () => {
    const copias: Copia[] = [];
    const fora: string[] = [];
    for (const [c, rot] of [["tablet", "pasta do dispositivo"], ["pendrive", "pendrive"]] as const) {
      const p = await pastaDa(c);
      if (!p) continue;
      if (await permissao(p, pedir).catch(() => false)) copias.push(copiaPasta(rot, p));
      else fora.push(`${rot} sem permissão`);
    }
    if (navigator.onLine && ((await renovacao) || nuvemGoogle.conectado())) copias.push(copiaDrive());
    else if (localStorage.getItem("wjgoogle:autorizado") === "1") fora.push("Google Drive com acesso vencido");

    const local = await lerLocal();
    const lidas: { c: Copia; b: Base | null }[] = [];
    for (const c of copias) {
      try {
        lidas.push({ c, b: await c.ler() });
      } catch {
        fora.push(`${c.nome} desconectado`);
      }
    }
    const base = mesclar([local, ...lidas.flatMap((x) => (x.b ? [x.b] : []))], new Date().toISOString());
    const s = JSON.stringify(base);
    const mudou = s !== JSON.stringify(local);
    if (mudou) await gravarLocal(base);
    const ok: string[] = [];
    for (const { c, b } of lidas) {
      try {
        if (!b || JSON.stringify(b) !== s) await c.gravar(base);
        ok.push(c.nome);
      } catch {
        fora.push(`${c.nome} desconectado`);
      }
    }
    const partes = [ok.length ? `Igual em: ${ok.join(", ")}` : "Só neste aparelho (escolha as cópias em Configurações)"];
    if (fora.length) partes.push(fora.join(", "));
    return { base, texto: `${partes.join(" · ")}.`, mudou };
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}
