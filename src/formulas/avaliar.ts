// Avaliador de fórmulas: percorre a árvore sintática com um Contexto que fornece as células.
// Conversões de tipo como nas planilhas de mercado (texto numérico vira número em contas,
// VERDADEIRO = 1, vazio = 0 ou ""), erros se propagam, matrizes operam elemento a elemento.

import { comoNumero, comoTexto, comparar } from "./conversao";
import { FUNCOES, normalizarNome } from "./funcoes";
import { analisar } from "./sintaxe";
import { erro, ehErro, ehMatriz, type ErroF, type Contexto, type Escalar, type No, type RefCelula, type Valor } from "./tipos";

/** Limite do intervalo ao que existe na folha (A:A não percorre 1 milhão de linhas vazias). */
export interface ContextoComDimensao extends Contexto {
  dimensao?(folha: string): { lins: number; cols: number };
}

// ---------- avaliação ----------

export class Avaliador {
  constructor(public ctx: ContextoComDimensao) {}

  /** Valor final de uma fórmula de célula (matriz → canto superior esquerdo). */
  formula(texto: string): Escalar {
    let no: No;
    try {
      no = analisar(texto);
    } catch {
      return erro("#NOME?");
    }
    return this.escalar(this.avaliar(no));
  }

  escalar(v: Valor): Escalar {
    if (!ehMatriz(v)) return v;
    return v[0]?.[0] ?? null;
  }

  celula(r: RefCelula): Escalar {
    return this.ctx.celula(r.folha ?? this.ctx.folha, r.lin, r.col);
  }

  intervalo(a: RefCelula, b: RefCelula): Escalar[][] | ErroF {
    const folha = a.folha ?? this.ctx.folha;
    let l0 = Math.min(a.lin, b.lin), l1 = Math.max(a.lin, b.lin);
    let c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
    const dim = this.ctx.dimensao?.(folha);
    if (dim) {
      // intervalos enormes (A:A) ficam no pedaço usado da folha
      if (l1 - l0 > 5000) l1 = Math.max(l0, Math.min(l1, dim.lins - 1));
      if (c1 - c0 > 500) c1 = Math.max(c0, Math.min(c1, dim.cols - 1));
    }
    if ((l1 - l0 + 1) * (c1 - c0 + 1) > 5_000_000) return erro("#NÚM!");
    const out: Escalar[][] = [];
    for (let l = l0; l <= l1; l++) {
      const linha: Escalar[] = [];
      for (let c = c0; c <= c1; c++) linha.push(this.ctx.celula(folha, l, c));
      out.push(linha);
    }
    return out;
  }

  avaliar(no: No): Valor {
    switch (no.t) {
      case "num":
        return no.v;
      case "texto":
        return no.v;
      case "logico":
        return no.v;
      case "erro":
        return erro(no.v);
      case "ref":
        return this.celula(no.r);
      case "intervalo":
        return this.intervalo(no.a, no.b);
      case "matriz":
        return no.linhas.map((l) => l.map((x) => this.escalar(this.avaliar(x))));
      case "nome": {
        if (no.nome === "") return null; // argumento omitido
        const def = this.ctx.nome?.(no.nome);
        return def ? this.avaliar(def) : erro("#NOME?");
      }
      case "un": {
        return mapear1(this.avaliar(no.x), (v) => {
          const n = comoNumero(v);
          return ehErro(n) ? n : no.op === "-" ? -n : n;
        });
      }
      case "pct":
        return mapear1(this.avaliar(no.x), (v) => {
          const n = comoNumero(v);
          return ehErro(n) ? n : n / 100;
        });
      case "bin":
        return mapear2(this.avaliar(no.a), this.avaliar(no.b), (a, b) => binario(no.op, a, b));
      case "func": {
        const nome = normalizarNome(no.nome);
        const f = FUNCOES[nome];
        if (!f) {
          const ext = this.ctx.externa?.(no.nome, no.args.map((x) => this.avaliar(x)));
          return ext === undefined ? erro("#NOME?") : ext;
        }
        if (f.preguicosa) return f.preguicosa(no.args, this);
        if (f.min !== undefined && no.args.length < f.min) return erro("#VALOR!");
        if (f.max !== undefined && no.args.length > f.max) return erro("#VALOR!");
        return f.f!(no.args.map((x) => this.avaliar(x)), this);
      }
    }
  }
}

function mapear1(v: Valor, f: (x: Escalar) => Escalar): Valor {
  return ehMatriz(v) ? v.map((l) => l.map(f)) : f(v);
}

function mapear2(a: Valor, b: Valor, f: (x: Escalar, y: Escalar) => Escalar): Valor {
  if (!ehMatriz(a) && !ehMatriz(b)) return f(a, b);
  const A = ehMatriz(a) ? a : [[a]], B = ehMatriz(b) ? b : [[b]];
  const ls = Math.max(A.length, B.length), cs = Math.max(A[0]?.length ?? 0, B[0]?.length ?? 0);
  const pega = (M: Escalar[][], l: number, c: number): Escalar => {
    const ll = M.length === 1 ? 0 : l, cc = M[0].length === 1 ? 0 : c;
    return M[ll]?.[cc] ?? erro("#N/D");
  };
  return Array.from({ length: ls }, (_, l) => Array.from({ length: cs }, (_, c) => f(pega(A, l, c), pega(B, l, c))));
}

function binario(op: string, a: Escalar, b: Escalar): Escalar {
  if (ehErro(a)) return a;
  if (ehErro(b)) return b;
  switch (op) {
    case "&": {
      const x = comoTexto(a), y = comoTexto(b);
      if (ehErro(x)) return x;
      if (ehErro(y)) return y;
      return x + y;
    }
    case "=":
      return comparar(a, b) === 0;
    case "<>":
      return comparar(a, b) !== 0;
    case "<":
      return comparar(a, b) < 0;
    case ">":
      return comparar(a, b) > 0;
    case "<=":
      return comparar(a, b) <= 0;
    case ">=":
      return comparar(a, b) >= 0;
  }
  const x = comoNumero(a), y = comoNumero(b);
  if (ehErro(x)) return x;
  if (ehErro(y)) return y;
  switch (op) {
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      return y === 0 ? erro("#DIV/0!") : x / y;
    case "^": {
      const r = Math.pow(x, y);
      return Number.isFinite(r) ? r : erro("#NÚM!");
    }
  }
  return erro("#VALOR!");
}

