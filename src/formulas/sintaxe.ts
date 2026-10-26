// Léxico e analisador de fórmulas no padrão brasileiro: argumentos separados por ";",
// vírgula decimal (1,5), referências A1 / $A$1 / Folha!A1 / 'Minha folha'!A1:B9, colunas e
// linhas inteiras (A:A, 1:3), texto entre aspas ("" = aspas), erros literais (#N/D).
// Precedência (como nas planilhas de mercado): comparação < & < + − < * / < ^ < − unário < %.

import { colunaParaIndice, enderecoA1, LIMITE_COLUNAS, LIMITE_LINHAS, type CodigoErro, type No, type RefCelula } from "./tipos";

type Token =
  | { t: "num"; v: number; i: number; f: number }
  | { t: "texto"; v: string; i: number; f: number }
  | { t: "erro"; v: CodigoErro; i: number; f: number }
  | { t: "ref"; r: RefCelula; i: number; f: number }
  | { t: "colunas"; a: RefCelula; b: RefCelula; i: number; f: number }
  | { t: "ident"; v: string; i: number; f: number }
  | { t: "op"; v: string; i: number; f: number };

const ERROS: CodigoErro[] = ["#DIV/0!", "#N/D", "#NOME?", "#REF!", "#VALOR!", "#NÚM!", "#NULO!", "#CICLO!"];

const RX = {
  folhaAspas: /'((?:[^']|'')+)'!/y,
  folha: /([A-Za-zÀ-ÿ_][\wÀ-ÿ.]*)!/y,
  faixaColunas: /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w(À-ÿ])/y,
  faixaLinhas: /(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w(])/y,
  celula: /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(À-ÿ.])/y,
  numero: /(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?/y,
  texto: /"((?:[^"]|"")*)"/y,
  erro: /#(?:DIV\/0!|N\/D|NOME\?|REF!|VALOR!|NÚM!|NULO!|CICLO!)/y,
  ident: /[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*/y,
  op: /<=|>=|<>|[-+*/^&=<>%();:]/y,
};

const casar = (rx: RegExp, s: string, i: number) => {
  rx.lastIndex = i;
  return rx.exec(s);
};

/** Separa a fórmula (sem o "=") em tokens, com posições para reescrever referências. */
export function tokens(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    const ini = i;
    // prefixo de folha
    let folha: string | undefined;
    let m = casar(RX.folhaAspas, s, i);
    if (m) {
      folha = m[1].replace(/''/g, "'");
      i += m[0].length;
    } else if ((m = casar(RX.folha, s, i))) {
      folha = m[1];
      i += m[0].length;
    }
    if ((m = casar(RX.faixaColunas, s, i))) {
      const a: RefCelula = { folha, lin: 0, col: colunaParaIndice(m[2]), absLin: true, absCol: !!m[1] };
      const b: RefCelula = { folha, lin: LIMITE_LINHAS - 1, col: colunaParaIndice(m[4]), absLin: true, absCol: !!m[3] };
      i += m[0].length;
      out.push({ t: "colunas", a, b, i: ini, f: i });
      continue;
    }
    if ((m = casar(RX.faixaLinhas, s, i))) {
      const a: RefCelula = { folha, lin: Number(m[2]) - 1, col: 0, absLin: !!m[1], absCol: true };
      const b: RefCelula = { folha, lin: Number(m[4]) - 1, col: LIMITE_COLUNAS - 1, absLin: !!m[3], absCol: true };
      i += m[0].length;
      out.push({ t: "colunas", a, b, i: ini, f: i });
      continue;
    }
    if ((m = casar(RX.celula, s, i))) {
      const col = colunaParaIndice(m[2]), lin = Number(m[4]) - 1;
      if (col < LIMITE_COLUNAS && lin >= 0 && lin < LIMITE_LINHAS) {
        i += m[0].length;
        out.push({ t: "ref", r: { folha, lin, col, absLin: !!m[3], absCol: !!m[1] }, i: ini, f: i });
        continue;
      }
    }
    if (folha !== undefined) throw new Error(`Referência inválida depois de "${folha}!"`);
    if ((m = casar(RX.numero, s, i))) {
      i += m[0].length;
      out.push({ t: "num", v: Number(m[0].replace(",", ".")), i: ini, f: i });
      continue;
    }
    if ((m = casar(RX.texto, s, i))) {
      i += m[0].length;
      out.push({ t: "texto", v: m[1].replace(/""/g, '"'), i: ini, f: i });
      continue;
    }
    if ((m = casar(RX.erro, s, i))) {
      i += m[0].length;
      out.push({ t: "erro", v: m[0] as CodigoErro, i: ini, f: i });
      continue;
    }
    if ((m = casar(RX.ident, s, i))) {
      i += m[0].length;
      out.push({ t: "ident", v: m[0], i: ini, f: i });
      continue;
    }
    if ((m = casar(RX.op, s, i))) {
      i += m[0].length;
      out.push({ t: "op", v: m[0], i: ini, f: i });
      continue;
    }
    throw new Error(`Caractere inesperado "${ch}"`);
  }
  return out;
}

/** Analisa a fórmula (com ou sem "=" no começo). Erro de sintaxe → exceção com mensagem. */
export function analisar(formula: string): No {
  const s = formula.startsWith("=") ? formula.slice(1) : formula;
  const tk = tokens(s);
  let p = 0;
  const olhar = () => tk[p];
  const ehOp = (v: string) => tk[p]?.t === "op" && (tk[p] as { v: string }).v === v;
  const esperar = (v: string) => {
    if (!ehOp(v)) throw new Error(`Esperava "${v}"`);
    p++;
  };

  const comparacao = (): No => {
    let a = concatenacao();
    while (["=", "<>", "<", ">", "<=", ">="].some(ehOp)) {
      const op = (tk[p++] as { v: string }).v as "=";
      a = { t: "bin", op, a, b: concatenacao() };
    }
    return a;
  };
  const concatenacao = (): No => {
    let a = aditivo();
    while (ehOp("&")) {
      p++;
      a = { t: "bin", op: "&", a, b: aditivo() };
    }
    return a;
  };
  const aditivo = (): No => {
    let a = multiplicativo();
    while (ehOp("+") || ehOp("-")) {
      const op = (tk[p++] as { v: string }).v as "+";
      a = { t: "bin", op, a, b: multiplicativo() };
    }
    return a;
  };
  const multiplicativo = (): No => {
    let a = potencia();
    while (ehOp("*") || ehOp("/")) {
      const op = (tk[p++] as { v: string }).v as "*";
      a = { t: "bin", op, a, b: potencia() };
    }
    return a;
  };
  const potencia = (): No => {
    let a = unario();
    while (ehOp("^")) {
      p++;
      a = { t: "bin", op: "^", a, b: unario() };
    }
    return a;
  };
  const unario = (): No => {
    if (ehOp("-") || ehOp("+")) {
      const op = (tk[p++] as { v: string }).v as "-";
      return { t: "un", op, x: unario() };
    }
    return porcento();
  };
  const porcento = (): No => {
    let x = primario();
    while (ehOp("%")) {
      p++;
      x = { t: "pct", x };
    }
    return x;
  };
  const primario = (): No => {
    const k = olhar();
    if (!k) throw new Error("Fórmula incompleta");
    if (k.t === "num") {
      p++;
      return { t: "num", v: k.v };
    }
    if (k.t === "texto") {
      p++;
      return { t: "texto", v: k.v };
    }
    if (k.t === "erro") {
      p++;
      return { t: "erro", v: k.v };
    }
    if (k.t === "colunas") {
      p++;
      return { t: "intervalo", a: k.a, b: k.b };
    }
    if (k.t === "ref") {
      p++;
      if (ehOp(":") && tk[p + 1]?.t === "ref") {
        p++;
        const b = (tk[p++] as { r: RefCelula }).r;
        return { t: "intervalo", a: k.r, b: { ...b, folha: b.folha ?? k.r.folha } };
      }
      return { t: "ref", r: k.r };
    }
    if (k.t === "ident") {
      p++;
      if (ehOp("(")) {
        p++;
        const args: No[] = [];
        if (!ehOp(")")) {
          for (;;) {
            // argumento omitido (SE(A1;;2)) vale vazio
            if (ehOp(";") || ehOp(")")) args.push({ t: "nome", nome: "" });
            else args.push(comparacao());
            if (ehOp(";")) {
              p++;
              continue;
            }
            break;
          }
        }
        esperar(")");
        return { t: "func", nome: k.v.toUpperCase(), args };
      }
      const u = k.v.toUpperCase();
      if (u === "VERDADEIRO" || u === "TRUE") return { t: "logico", v: true };
      if (u === "FALSO" || u === "FALSE") return { t: "logico", v: false };
      return { t: "nome", nome: k.v };
    }
    if (k.t === "op" && k.v === "(") {
      p++;
      const x = comparacao();
      esperar(")");
      return x;
    }
    throw new Error(`Inesperado: "${s.slice(k.i, k.f)}"`);
  };

  const raiz = comparacao();
  if (p < tk.length) throw new Error(`Sobrou: "${s.slice(tk[p].i)}"`);
  return raiz;
}

const textoFolha = (f: string | undefined) => (f === undefined ? "" : /^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*$/.test(f) ? `${f}!` : `'${f.replace(/'/g, "''")}'!`);

/**
 * Copiar/colar e preencher: desloca as referências relativas da fórmula. Referência que sai da
 * planilha vira #REF!.
 */
export function deslocarReferencias(formula: string, dLin: number, dCol: number): string {
  if (!formula.startsWith("=")) return formula;
  const s = formula.slice(1);
  let tk: Token[];
  try {
    tk = tokens(s);
  } catch {
    return formula;
  }
  const mover = (r: RefCelula) => ({ ...r, lin: r.absLin ? r.lin : r.lin + dLin, col: r.absCol ? r.col : r.col + dCol });
  const valida = (r: RefCelula) => r.lin >= 0 && r.col >= 0 && r.lin < LIMITE_LINHAS && r.col < LIMITE_COLUNAS;
  let out = "", ult = 0;
  for (const k of tk) {
    if (k.t !== "ref" && k.t !== "colunas") continue;
    out += s.slice(ult, k.i);
    ult = k.f;
    if (k.t === "ref") {
      const r = mover(k.r);
      out += valida(r) ? textoFolha(r.folha) + enderecoA1(r.lin, r.col, r.absLin, r.absCol) : "#REF!";
    } else {
      const a = mover(k.a), b = mover(k.b);
      const colunas = k.a.lin === 0 && k.b.lin === LIMITE_LINHAS - 1;
      if (!valida(a) || !valida(b)) out += "#REF!";
      else if (colunas) {
        const c = (r: RefCelula) => `${r.absCol ? "$" : ""}${enderecoA1(0, r.col).replace(/\d+$/, "")}`;
        out += `${textoFolha(a.folha)}${c(a)}:${c(b)}`;
      } else out += `${textoFolha(a.folha)}${a.absLin ? "$" : ""}${a.lin + 1}:${b.absLin ? "$" : ""}${b.lin + 1}`;
    }
  }
  return "=" + out + s.slice(ult);
}

/**
 * Inserir/excluir linhas ou colunas: ajusta as referências (relativas e absolutas) que apontam
 * para a folha alterada. n > 0 insere n a partir de `pos`; n < 0 exclui −n a partir de `pos`
 * (referência excluída vira #REF!; intervalo encolhe).
 */
export function ajustarReferencias(formula: string, folhaDaFormula: string, folhaAlvo: string, eixo: "lin" | "col", pos: number, n: number): string {
  if (!formula.startsWith("=")) return formula;
  const s = formula.slice(1);
  let tk: Token[];
  try {
    tk = tokens(s);
  } catch {
    return formula;
  }
  const alvo = folhaAlvo.toLowerCase();
  const naFolha = (r: RefCelula) => (r.folha ?? folhaDaFormula).toLowerCase() === alvo;
  const idx = (r: RefCelula) => (eixo === "lin" ? r.lin : r.col);
  const com = (r: RefCelula, v: number): RefCelula => (eixo === "lin" ? { ...r, lin: v } : { ...r, col: v });
  const mover = (v: number): number | null => {
    if (n > 0) return v >= pos ? v + n : v;
    if (v >= pos && v < pos - n) return null;
    return v >= pos - n ? v + n : v;
  };
  let out = "", ult = 0;
  for (const k of tk) {
    if (k.t !== "ref" && k.t !== "colunas") continue;
    out += s.slice(ult, k.i);
    ult = k.f;
    if (k.t === "ref") {
      if (!naFolha(k.r)) {
        out += s.slice(k.i, k.f);
        continue;
      }
      const v = mover(idx(k.r));
      out += v === null ? "#REF!" : textoFolha(k.r.folha) + enderecoA1(com(k.r, v).lin, com(k.r, v).col, k.r.absLin, k.r.absCol);
      continue;
    }
    // intervalo (colunas/linhas inteiras não mudam no eixo inteiro)
    const inteiro = (eixo === "lin" && k.a.lin === 0 && k.b.lin === LIMITE_LINHAS - 1) || (eixo === "col" && k.a.col === 0 && k.b.col === LIMITE_COLUNAS - 1);
    if (!naFolha(k.a) || inteiro) {
      out += s.slice(k.i, k.f);
      continue;
    }
    let a0 = Math.min(idx(k.a), idx(k.b)), a1 = Math.max(idx(k.a), idx(k.b));
    if (n > 0) {
      if (a0 >= pos) a0 += n;
      if (a1 >= pos) a1 += n;
    } else {
      const fimEx = pos - n; // exclui [pos, fimEx)
      const enc = (v: number) => (v >= fimEx ? v + n : v >= pos ? pos : v);
      if (a0 >= pos && a1 < fimEx) {
        out += "#REF!";
        continue;
      }
      a0 = enc(a0);
      a1 = a1 >= fimEx ? a1 + n : a1 >= pos ? pos - 1 : a1;
    }
    const ra = com(k.a, a0), rb = com(k.b, a1);
    const colunas = k.a.lin === 0 && k.b.lin === LIMITE_LINHAS - 1;
    const linhas = k.a.col === 0 && k.b.col === LIMITE_COLUNAS - 1;
    if (colunas) {
      const c = (r: RefCelula) => `${r.absCol ? "$" : ""}${enderecoA1(0, r.col).replace(/\d+$/, "")}`;
      out += `${textoFolha(k.a.folha)}${c(ra)}:${c(rb)}`;
    } else if (linhas) out += `${textoFolha(k.a.folha)}${ra.absLin ? "$" : ""}${ra.lin + 1}:${rb.absLin ? "$" : ""}${rb.lin + 1}`;
    else out += `${textoFolha(k.a.folha)}${enderecoA1(ra.lin, ra.col, ra.absLin, ra.absCol)}:${enderecoA1(rb.lin, rb.col, rb.absLin, rb.absCol)}`;
  }
  return "=" + out + s.slice(ult);
}

/** Referências e intervalos citados na fórmula (para colorir na grade). */
export function referenciasDaFormula(formula: string): { a: RefCelula; b: RefCelula; i: number; f: number }[] {
  if (!formula.startsWith("=")) return [];
  try {
    return tokens(formula.slice(1)).flatMap((k) => {
      if (k.t === "ref") return [{ a: k.r, b: k.r, i: k.i + 1, f: k.f + 1 }];
      if (k.t === "colunas") return [{ a: k.a, b: k.b, i: k.i + 1, f: k.f + 1 }];
      return [];
    });
  } catch {
    return [];
  }
}

export { ERROS };
