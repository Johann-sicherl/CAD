// WJTaskPlan: regras puras (testadas em Node, scripts/teste-tarefas.ts) — pastas em árvore,
// tarefas com estados editáveis e histórico datado, painel (quantidades e tempo de atendimento),
// prazos e alertas, e a mescla das cópias (aparelho, pasta do dispositivo, pendrive, Google Drive):
// registro por registro, a alteração mais recente vence; exclusões viajam como "exclusoes".

export type TipoEstado = "inicio" | "andamento" | "fim";

export interface Estado {
  id: string;
  nome: string;
  cor: string;
  /** início (tarefa nova), andamento ou fim (conta como concluída) */
  tipo: TipoEstado;
  ordem: number;
  atualizado: string;
}

export interface PastaTarefas {
  id: string;
  nome: string;
  pai: string | null;
  ordem: number;
  atualizado: string;
}

export interface Mudanca {
  estado: string;
  quando: string;
}

export interface Tarefa {
  id: string;
  pasta: string;
  titulo: string;
  /** data e hora de criação (ISO) */
  criada: string;
  estado: string;
  /** cada troca de estado, com data e hora (a primeira é a criação) */
  historico: Mudanca[];
  /** prazo de conclusão (AAAA-MM-DD); null = sem prazo */
  prazo: string | null;
  ordem: number;
  atualizado: string;
}

export interface Config {
  /** dias de antecedência do alerta de prazo ao abrir */
  diasAlerta: number;
  atualizado: string;
}

export interface Exclusao {
  id: string;
  quando: string;
}

export interface Base {
  formato: "wjtaskplan";
  versao: 1;
  estados: Estado[];
  pastas: PastaTarefas[];
  tarefas: Tarefa[];
  config: Config;
  exclusoes: Exclusao[];
}

export const DIAS_EXCLUSAO = 30;
const ANTIGO = "2000-01-01T00:00:00.000Z";
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function baseNova(): Base {
  return {
    formato: "wjtaskplan",
    versao: 1,
    // estados de fábrica com data antiga: qualquer edição feita em outro aparelho vence
    estados: [
      { id: "novo", nome: "Novo", cor: "#5b7da3", tipo: "inicio", ordem: 0, atualizado: ANTIGO },
      { id: "execucao", nome: "Em execução", cor: "#c98a12", tipo: "andamento", ordem: 1, atualizado: ANTIGO },
      { id: "concluido", nome: "Concluído", cor: "#2e8b57", tipo: "fim", ordem: 2, atualizado: ANTIGO },
    ],
    pastas: [{ id: "geral", nome: "Geral", pai: null, ordem: 0, atualizado: ANTIGO }],
    tarefas: [],
    config: { diasAlerta: 2, atualizado: ANTIGO },
    exclusoes: [],
  };
}

/** Confere e completa uma base lida (arquivo de outra cópia ou de versão antiga). */
export function validarBase(x: unknown): Base {
  const b = x as Partial<Base> | null;
  if (!b || b.formato !== "wjtaskplan") throw new Error("arquivo do WJTaskPlan inválido");
  const n = baseNova();
  return {
    formato: "wjtaskplan",
    versao: 1,
    estados: Array.isArray(b.estados) && b.estados.length ? b.estados : n.estados,
    pastas: Array.isArray(b.pastas) ? b.pastas : [],
    tarefas: (Array.isArray(b.tarefas) ? b.tarefas : []).map((t) => ({ ...t, prazo: t.prazo || null, historico: Array.isArray(t.historico) ? t.historico : [] })),
    config: { ...n.config, ...(b.config ?? {}) },
    exclusoes: Array.isArray(b.exclusoes) ? b.exclusoes : [],
  };
}

// ---------- estados ----------

export const estadosOrdenados = (b: Base) => [...b.estados].sort((x, y) => x.ordem - y.ordem);
export const estadoDe = (b: Base, id: string) => b.estados.find((e) => e.id === id);
/** Estado de uma tarefa nova: o primeiro do tipo início. */
export const estadoInicial = (b: Base) => estadosOrdenados(b).find((e) => e.tipo === "inicio") ?? estadosOrdenados(b)[0];
const ehFim = (b: Base, id: string) => estadoDe(b, id)?.tipo === "fim";

// ---------- pastas ----------

export const filhas = (b: Base, pai: string | null) => b.pastas.filter((p) => p.pai === pai).sort((x, y) => x.ordem - y.ordem || x.nome.localeCompare(y.nome));

/** A pasta e todas as subpastas (ids). */
export function descendentes(b: Base, id: string): Set<string> {
  const r = new Set([id]);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const p of b.pastas) if (p.pai && r.has(p.pai) && !r.has(p.id)) (r.add(p.id), (mudou = true));
  }
  return r;
}

/** Caminho "Pai / Filha / Neta". */
export function caminhoPasta(b: Base, id: string): string {
  const nomes: string[] = [];
  const vistos = new Set<string>();
  for (let p = b.pastas.find((x) => x.id === id); p && !vistos.has(p.id); p = b.pastas.find((x) => x.id === p!.pai)) {
    vistos.add(p.id);
    nomes.unshift(p.nome);
  }
  return nomes.join(" / ");
}

export function criarPasta(b: Base, nome: string, pai: string | null, agora: string): PastaTarefas {
  const p: PastaTarefas = { id: uid(), nome: nome.trim() || "Nova pasta", pai, ordem: filhas(b, pai).length, atualizado: agora };
  b.pastas.push(p);
  return p;
}

/**
 * Move a pasta para dentro de `novoPai` (null = raiz), na posição `indice` entre as irmãs.
 * Recusa mover para dentro dela mesma ou de uma subpasta (devolve false).
 */
export function moverPasta(b: Base, id: string, novoPai: string | null, indice: number, agora: string): boolean {
  const p = b.pastas.find((x) => x.id === id);
  if (!p || (novoPai && descendentes(b, id).has(novoPai))) return false;
  const irmas = filhas(b, novoPai).filter((x) => x.id !== id);
  irmas.splice(Math.max(0, Math.min(indice, irmas.length)), 0, p);
  if (p.pai !== novoPai) (p.pai = novoPai), (p.atualizado = agora);
  irmas.forEach((x, k) => {
    if (x.ordem !== k || x === p) (x.ordem = k), (x.atualizado = agora);
  });
  return true;
}

/** Exclui a pasta, as subpastas e as tarefas delas (registra as exclusões para a sincronia). */
export function excluirPasta(b: Base, id: string, agora: string): { pastas: number; tarefas: number } {
  const ids = descendentes(b, id);
  const tarefas = b.tarefas.filter((t) => ids.has(t.pasta));
  b.pastas = b.pastas.filter((p) => !ids.has(p.id));
  b.tarefas = b.tarefas.filter((t) => !ids.has(t.pasta));
  for (const x of [...ids, ...tarefas.map((t) => t.id)]) b.exclusoes.push({ id: x, quando: agora });
  return { pastas: ids.size, tarefas: tarefas.length };
}

// ---------- tarefas ----------

export function criarTarefa(b: Base, pasta: string, titulo: string, prazo: string | null, agora: string): Tarefa {
  const e = estadoInicial(b);
  const t: Tarefa = { id: uid(), pasta, titulo: titulo.trim(), criada: agora, estado: e.id, historico: [{ estado: e.id, quando: agora }], prazo, ordem: b.tarefas.filter((x) => x.pasta === pasta).length, atualizado: agora };
  b.tarefas.push(t);
  return t;
}

/** Troca o estado e guarda a data e hora da troca. */
export function mudarEstado(t: Tarefa, estado: string, agora: string) {
  if (t.estado === estado) return;
  t.estado = estado;
  t.historico.push({ estado, quando: agora });
  t.atualizado = agora;
}

export function excluirTarefa(b: Base, id: string, agora: string) {
  b.tarefas = b.tarefas.filter((t) => t.id !== id);
  b.exclusoes.push({ id, quando: agora });
}

/** Remove um estado: as tarefas nele passam para `destino` (com registro no histórico). */
export function excluirEstado(b: Base, id: string, destino: string, agora: string): boolean {
  const e = estadoDe(b, id);
  if (!e || id === destino || !estadoDe(b, destino)) return false;
  const restantes = b.estados.filter((x) => x.id !== id);
  if (!restantes.some((x) => x.tipo === "inicio") || !restantes.some((x) => x.tipo === "fim")) return false;
  for (const t of b.tarefas) if (t.estado === id) mudarEstado(t, destino, agora);
  b.estados = restantes;
  b.exclusoes.push({ id: `estado:${id}`, quando: agora });
  return true;
}

/** Quando a tarefa foi concluída (última entrada num estado de fim), se está concluída. */
export function concluidaEm(b: Base, t: Tarefa): string | null {
  if (!ehFim(b, t.estado)) return null;
  // início do trecho final em "fim" (troca entre dois estados de fim não reinicia a contagem)
  let j = t.historico.length;
  while (j > 0 && ehFim(b, t.historico[j - 1].estado)) j--;
  return t.historico[j]?.quando ?? t.atualizado;
}

/** Início da execução: primeira entrada num estado de andamento. */
export function iniciadaEm(b: Base, t: Tarefa): string | null {
  return t.historico.find((h) => estadoDe(b, h.estado)?.tipo === "andamento")?.quando ?? null;
}

// ---------- datas e prazos ----------

export const diaLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const diaUTC = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
/** Dias de `de` até `ate` (AAAA-MM-DD). */
export const diasEntre = (de: string, ate: string) => Math.round((diaUTC(ate) - diaUTC(de)) / 86400000);

export interface Alerta {
  tarefa: Tarefa;
  /** dias até o prazo (negativo = atrasada) */
  dias: number;
}

/** Tarefas não concluídas com prazo vencido ou a até `diasAlerta` dias (mais urgentes primeiro). */
export function alertas(b: Base, hoje: string, diasAlerta = b.config.diasAlerta): Alerta[] {
  return b.tarefas
    .filter((t) => t.prazo && !ehFim(b, t.estado))
    .map((t) => ({ tarefa: t, dias: diasEntre(hoje, t.prazo!) }))
    .filter((a) => a.dias <= diasAlerta)
    .sort((x, y) => x.dias - y.dias || x.tarefa.titulo.localeCompare(y.tarefa.titulo));
}

// ---------- painel ----------

export interface Estatistica {
  n: number;
  media: number;
  mediana: number;
  min: number;
  max: number;
}

function estatistica(v: number[]): Estatistica | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return { n: s.length, media: s.reduce((a, b) => a + b, 0) / s.length, mediana: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, min: s[0], max: s[s.length - 1] };
}

export interface Painel {
  total: number;
  /** quantidade por estado (id → n) */
  porEstado: Record<string, number>;
  /** quantidade por tipo de estado */
  porTipo: Record<TipoEstado, number>;
  atrasadas: number;
  vencendo: number;
  /** tempo de atendimento (criação → conclusão), em ms */
  atendimento: Estatistica | null;
  /** tempo de execução (início da execução → conclusão), em ms */
  execucao: Estatistica | null;
  concluidas7: number;
  concluidas30: number;
}

/** Indicadores das tarefas (já filtradas pela pasta escolhida). */
export function painel(b: Base, tarefas: Tarefa[], agora: Date): Painel {
  const hoje = diaLocal(agora);
  const porEstado: Record<string, number> = Object.fromEntries(b.estados.map((e) => [e.id, 0]));
  const porTipo: Record<TipoEstado, number> = { inicio: 0, andamento: 0, fim: 0 };
  const atend: number[] = [], exec: number[] = [];
  let atrasadas = 0, vencendo = 0, c7 = 0, c30 = 0;
  for (const t of tarefas) {
    porEstado[t.estado] = (porEstado[t.estado] ?? 0) + 1;
    const tipo = estadoDe(b, t.estado)?.tipo ?? "inicio";
    porTipo[tipo]++;
    const fim = concluidaEm(b, t);
    if (fim) {
      const ms = Date.parse(fim);
      atend.push(Math.max(0, ms - Date.parse(t.criada)));
      const ini = iniciadaEm(b, t);
      if (ini) exec.push(Math.max(0, ms - Date.parse(ini)));
      const idade = agora.getTime() - ms;
      if (idade <= 7 * 86400000) c7++;
      if (idade <= 30 * 86400000) c30++;
    } else if (t.prazo) {
      const d = diasEntre(hoje, t.prazo);
      if (d < 0) atrasadas++;
      else if (d <= b.config.diasAlerta) vencendo++;
    }
  }
  return { total: tarefas.length, porEstado, porTipo, atrasadas, vencendo, atendimento: estatistica(atend), execucao: estatistica(exec), concluidas7: c7, concluidas30: c30 };
}

/** "3 d 4 h", "5 h 10 min", "12 min". */
export function duracao(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  const d = Math.floor(h / 24);
  return `${d} d${h % 24 ? ` ${h % 24} h` : ""}`;
}

// ---------- tabela legível (CSV) ----------

/** Tabela das tarefas em CSV (separador ";", abre no WJPlan e em planilhas). */
export function tabelaCSV(b: Base): string {
  const c = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const dh = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "");
  const linhas = [["Pasta", "Tarefa", "Estado", "Criada", "Prazo", "Concluída", "Tempo de atendimento"].join(";")];
  for (const t of b.tarefas) {
    const fim = concluidaEm(b, t);
    linhas.push([caminhoPasta(b, t.pasta), t.titulo, estadoDe(b, t.estado)?.nome ?? t.estado, dh(t.criada), t.prazo ?? "", dh(fim), fim ? duracao(Date.parse(fim) - Date.parse(t.criada)) : ""].map(c).join(";"));
  }
  return `﻿${linhas.join("\r\n")}\r\n`;
}

// ---------- sincronia (mescla das cópias) ----------

function mesclarLista<T extends { id: string; atualizado: string }>(listas: T[][], excl: Map<string, string>, prefixo = ""): T[] {
  const m = new Map<string, T>();
  for (const l of listas) for (const x of l) {
    const y = m.get(x.id);
    if (!y || x.atualizado > y.atualizado) m.set(x.id, x);
  }
  // excluída depois da última alteração: some; alterada depois da exclusão: volta
  return [...m.values()].filter((x) => {
    const q = excl.get(prefixo + x.id);
    return !q || x.atualizado > q;
  });
}

/**
 * Junta as cópias: em cada pasta, tarefa e estado vale a alteração mais recente; exclusões
 * vencem alterações anteriores a elas e são esquecidas depois de 30 dias. Tarefas cuja pasta
 * sumiu vão para a primeira pasta da raiz (nada se perde).
 */
export function mesclar(entrada: Base[], agora: string): Base {
  const bases = entrada.map((b) => structuredClone(b));
  const excl = new Map<string, string>();
  const limite = new Date(Date.parse(agora) - DIAS_EXCLUSAO * 86400000).toISOString();
  for (const b of bases) for (const e of b.exclusoes) if (e.quando >= limite && (excl.get(e.id) ?? "") < e.quando) excl.set(e.id, e.quando);
  const r: Base = {
    formato: "wjtaskplan",
    versao: 1,
    estados: mesclarLista(bases.map((b) => b.estados), excl, "estado:"),
    pastas: mesclarLista(bases.map((b) => b.pastas), excl),
    tarefas: mesclarLista(bases.map((b) => b.tarefas), excl),
    config: bases.map((b) => b.config).reduce((a, c) => (c.atualizado > a.atualizado ? c : a)),
    exclusoes: [...excl].map(([id, quando]) => ({ id, quando })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  if (!r.estados.length) r.estados = baseNova().estados;
  if (!r.pastas.length) r.pastas = baseNova().pastas;
  // pasta com pai excluído sobe para a raiz; ciclos (movimentos cruzados em dois aparelhos) também
  const ids = new Set(r.pastas.map((p) => p.id));
  for (const p of r.pastas) if (p.pai && !ids.has(p.pai)) p.pai = null;
  for (const p of r.pastas) {
    const vistos = new Set<string>();
    for (let q: PastaTarefas | undefined = p; q?.pai; q = r.pastas.find((x) => x.id === q!.pai)) {
      if (vistos.has(q.id)) {
        p.pai = null;
        break;
      }
      vistos.add(q.id);
    }
  }
  const raiz = filhas(r, null)[0];
  for (const t of r.tarefas) if (!ids.has(t.pasta)) t.pasta = raiz.id;
  const est = new Set(r.estados.map((e) => e.id));
  for (const t of r.tarefas) if (!est.has(t.estado)) t.estado = estadoInicial(r).id;
  r.pastas.sort((a, b) => a.id.localeCompare(b.id));
  r.tarefas.sort((a, b) => a.criada.localeCompare(b.criada) || a.id.localeCompare(b.id));
  return r;
}
