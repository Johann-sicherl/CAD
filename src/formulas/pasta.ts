// Pasta de trabalho do WJPlan (.wjpl) e o cálculo das células.
// Cálculo sob demanda com memória: cada célula é calculada quando alguém pede o valor dela
// (a grade pede só as visíveis); uma alteração limpa a memória. Referência circular → #CICLO!.

import { Avaliador, type ContextoComDimensao } from "./avaliar";
import { lerData, lerNumeroBR } from "./conversao";
import { analisar } from "./sintaxe";
import { erro, type Escalar, type No } from "./tipos";

export type TipoFormato = "geral" | "numero" | "moeda" | "porcentagem" | "data" | "hora" | "dataHora" | "cientifico" | "texto";

export interface Formato {
  tipo?: TipoFormato;
  casas?: number;
  milhar?: boolean;
  negrito?: boolean;
  italico?: boolean;
  sublinhado?: boolean;
  riscado?: boolean;
  cor?: string;
  fundo?: string;
  alinhar?: "esquerda" | "centro" | "direita";
  quebrar?: boolean;
  borda?: boolean;
  tamanho?: number;
}

export interface Celula {
  /** O que o usuário digitou ("=SOMA(A1:A3)", "12,5", "texto"). */
  e: string;
  f?: Formato;
}

export interface Folha {
  nome: string;
  /** Chave "lin,col" (a partir de 0). */
  celulas: Record<string, Celula>;
  larguras?: Record<number, number>;
  alturas?: Record<number, number>;
  /** Painéis congelados: linhas/colunas fixas no topo/à esquerda. */
  congelar?: { lin: number; col: number };
}

export interface Pasta {
  formato: "wjpl";
  versao: 1;
  nome: string;
  folhas: Folha[];
  ativa: number;
  /** Nomes definidos: nome → fórmula ("=Dados!$A$1:$A$10" ou "=0,18"). */
  nomes?: Record<string, string>;
}

export const chave = (lin: number, col: number) => `${lin},${col}`;

export function pastaVazia(nome = "Pasta1"): Pasta {
  return { formato: "wjpl", versao: 1, nome, folhas: [{ nome: "Planilha1", celulas: {} }], ativa: 0 };
}

export function validarPasta(d: unknown): Pasta {
  const p = d as Pasta;
  if (!p || p.formato !== "wjpl" || !Array.isArray(p.folhas) || !p.folhas.length) throw new Error("Arquivo não é uma pasta do WJPlan (.wjpl).");
  for (const f of p.folhas) f.celulas ??= {};
  p.ativa = Math.min(Math.max(0, p.ativa ?? 0), p.folhas.length - 1);
  return p;
}

/** O que a entrada digitada vale (sem calcular fórmulas) e o formato que ela sugere. */
export function interpretarEntrada(e: string): { valor: Escalar; formato?: TipoFormato } {
  if (e === "") return { valor: null };
  if (e.startsWith("'")) return { valor: e.slice(1), formato: "texto" };
  const u = e.trim().toUpperCase();
  if (u === "VERDADEIRO" || u === "TRUE") return { valor: true };
  if (u === "FALSO" || u === "FALSE") return { valor: false };
  const t = e.trim();
  const n = lerNumeroBR(t);
  if (n !== null) return { valor: n, formato: t.endsWith("%") ? "porcentagem" : /^R\$/.test(t) ? "moeda" : undefined };
  const d = lerData(t);
  if (d !== null) return { valor: d, formato: t.includes("/") ? (t.includes(":") ? "dataHora" : "data") : "hora" };
  return { valor: e };
}

export class Calculadora {
  private memo = new Map<string, Escalar>();
  private calculando = new Set<string>();
  private arvores = new Map<string, No | null>();
  private dims = new Map<string, { lins: number; cols: number }>();
  agora?: () => Date;

  constructor(public pasta: Pasta) {}

  /** Depois de qualquer alteração: limpa os valores guardados. */
  invalidar() {
    this.memo.clear();
    this.dims.clear();
  }

  folha(nome: string): Folha | undefined {
    const n = nome.toLowerCase();
    return this.pasta.folhas.find((f) => f.nome.toLowerCase() === n);
  }

  dimensao(nome: string): { lins: number; cols: number } {
    let d = this.dims.get(nome);
    if (!d) {
      const f = this.folha(nome);
      d = { lins: 0, cols: 0 };
      for (const k of Object.keys(f?.celulas ?? {})) {
        const [l, c] = k.split(",").map(Number);
        d.lins = Math.max(d.lins, l + 1);
        d.cols = Math.max(d.cols, c + 1);
      }
      this.dims.set(nome, d);
    }
    return d;
  }

  /** Valor calculado da célula. */
  valor(nomeFolha: string, lin: number, col: number): Escalar {
    const f = this.folha(nomeFolha);
    if (!f) return erro("#REF!");
    const k = `${f.nome}!${lin},${col}`;
    if (this.memo.has(k)) return this.memo.get(k)!;
    const c = f.celulas[chave(lin, col)];
    if (!c || c.e === "") return null;
    if (!c.e.startsWith("=") || c.e.length === 1) {
      const v = c.f?.tipo === "texto" ? c.e : interpretarEntrada(c.e).valor;
      this.memo.set(k, v);
      return v;
    }
    if (this.calculando.has(k)) return erro("#CICLO!");
    this.calculando.add(k);
    let v: Escalar;
    try {
      v = this.avaliarNaFolha(f.nome, c.e);
    } finally {
      this.calculando.delete(k);
    }
    if (typeof v === "number" && !Number.isFinite(v)) v = erro("#NÚM!");
    if (v === null) v = 0; // fórmula que aponta para célula vazia mostra 0
    this.memo.set(k, v);
    return v;
  }

  /** Avalia uma fórmula qualquer como se estivesse na folha dada (barra de status, testes). */
  avaliarNaFolha(nomeFolha: string, formula: string): Escalar {
    let arv = this.arvores.get(formula);
    if (arv === undefined) {
      try {
        arv = analisar(formula);
      } catch {
        arv = null;
      }
      this.arvores.set(formula, arv);
    }
    if (!arv) return erro("#NOME?");
    const ctx: ContextoComDimensao = {
      folha: nomeFolha,
      celula: (fl, l, c) => this.valor(fl, l, c),
      dimensao: (fl) => this.dimensao(fl),
      nome: (n) => {
        const def = Object.entries(this.pasta.nomes ?? {}).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1];
        if (!def) return undefined;
        try {
          return analisar(def);
        } catch {
          return { t: "erro", v: "#NOME?" };
        }
      },
      agora: this.agora,
    };
    const av = new Avaliador(ctx);
    return av.escalar(av.avaliar(arv));
  }
}
