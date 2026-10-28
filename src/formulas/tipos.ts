// Motor de fórmulas do WJProMaster (@wj/formulas): tipos comuns.
// Usado pelo WJPlan e, depois, pelas outras faces (equações do WJCAD, campos do WJWrite,
// campos personalizados do WJCronProject, regras do WJERP). Lógica pura, testada em Node.

/** Erro de fórmula (#DIV/0!, #N/D…). */
export class ErroF {
  constructor(public readonly codigo: CodigoErro) {}
  toString() {
    return this.codigo;
  }
}

export type CodigoErro = "#DIV/0!" | "#N/D" | "#NOME?" | "#REF!" | "#VALOR!" | "#NÚM!" | "#NULO!" | "#CICLO!";

export const erro = (c: CodigoErro) => new ErroF(c);

/** Valor de uma célula: vazio = null. */
export type Escalar = number | string | boolean | ErroF | null;
/** Resultado de uma expressão: escalar ou matriz (linhas × colunas). */
export type Valor = Escalar | Escalar[][];

export const ehMatriz = (v: Valor): v is Escalar[][] => Array.isArray(v);
export const ehErro = (v: unknown): v is ErroF => v instanceof ErroF;

/** Referência a uma célula (linha/coluna a partir de 0). */
export interface RefCelula {
  folha?: string;
  lin: number;
  col: number;
  absLin: boolean;
  absCol: boolean;
}

/** Nó da árvore sintática. */
export type No =
  | { t: "num"; v: number }
  | { t: "texto"; v: string }
  | { t: "logico"; v: boolean }
  | { t: "erro"; v: CodigoErro }
  | { t: "ref"; r: RefCelula }
  | { t: "intervalo"; a: RefCelula; b: RefCelula }
  | { t: "nome"; nome: string }
  | { t: "func"; nome: string; args: No[] }
  | { t: "un"; op: "-" | "+"; x: No }
  | { t: "pct"; x: No }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">="; a: No; b: No }
  | { t: "matriz"; linhas: No[][] };

/** De onde o avaliador lê as células e os nomes definidos. */
export interface Contexto {
  folha: string;
  /** Valor (já calculado) da célula; folha inexistente → #REF!. */
  celula(folha: string, lin: number, col: number): Escalar;
  /** Nome definido (constante, intervalo ou fórmula), se houver. */
  nome?(nome: string): No | undefined;
  /** Funções vinculadas ao ecossistema (WJ.ITEM, WJ.CAD…): devolve undefined se não existir. */
  externa?(nome: string, args: Valor[]): Valor | undefined;
  agora?(): Date;
}

export const LIMITE_LINHAS = 1048576;
export const LIMITE_COLUNAS = 16384;

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function colunaParaIndice(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 26 → "AA". */
export function indiceParaColuna(i: number): string {
  let s = "";
  i++;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** Endereço A1 (sem folha). */
export function enderecoA1(lin: number, col: number, absLin = false, absCol = false) {
  return `${absCol ? "$" : ""}${indiceParaColuna(col)}${absLin ? "$" : ""}${lin + 1}`;
}
