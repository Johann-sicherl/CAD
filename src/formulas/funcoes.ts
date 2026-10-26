// Biblioteca de funções do motor de fórmulas. Nomes em português (com ou sem acento) e os
// equivalentes em inglês. Comportamento das funções de planilha de mercado, implementação nossa.

import type { Avaliador } from "./avaliar";
import { comoLogico, comoNumero, comoTexto, comparar, dataParaSerie, lerNumeroBR, numeroParaTexto, serieParaData } from "./conversao";
import { erro, ehErro, ehMatriz, ErroF, type Escalar, type No, type Valor } from "./tipos";

export interface DefFuncao {
  /** Recebe os argumentos já avaliados. */
  f?: (args: Valor[], av: Avaliador) => Valor;
  /** Recebe os nós (avaliação sob demanda: SE, SEERRO, LIN…). */
  preguicosa?: (args: No[], av: Avaliador) => Valor;
  min?: number;
  max?: number;
  categoria: string;
  sintaxe: string;
  descricao: string;
}

export const normalizarNome = (s: string) => s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// ---------- auxiliares ----------

const plano = (v: Valor): Escalar[] => (ehMatriz(v) ? v.flat() : [v]);

/** Números para agregação: dos intervalos só os números; argumentos diretos são convertidos. */
function numeros(args: Valor[]): number[] | ErroF {
  const out: number[] = [];
  for (const a of args) {
    if (ehMatriz(a)) {
      for (const x of a.flat()) {
        if (ehErro(x)) return x;
        if (typeof x === "number") out.push(x);
      }
    } else {
      if (a === null) continue;
      const n = comoNumero(a);
      if (ehErro(n)) return n;
      out.push(n);
    }
  }
  return out;
}

const num1 = (v: Valor): number | ErroF => {
  const x = ehMatriz(v) ? v[0]?.[0] ?? null : v;
  return comoNumero(x);
};
const txt1 = (v: Valor): string | ErroF => comoTexto(ehMatriz(v) ? v[0]?.[0] ?? null : v);
const log1 = (v: Valor): boolean | ErroF => comoLogico(ehMatriz(v) ? v[0]?.[0] ?? null : v);
const esc1 = (v: Valor): Escalar => (ehMatriz(v) ? v[0]?.[0] ?? null : v);
const matriz = (v: Valor): Escalar[][] => (ehMatriz(v) ? v : [[v]]);

/** Função numérica de um ou mais argumentos escalares (erros se propagam). */
function numerica(n: number, f: (...x: number[]) => number | ErroF, cat: string, sintaxe: string, descricao: string): DefFuncao {
  return {
    min: n, max: n, categoria: cat, sintaxe, descricao,
    f: (args) => {
      const xs: number[] = [];
      for (const a of args) {
        const x = num1(a);
        if (ehErro(x)) return x;
        xs.push(x);
      }
      const r = f(...xs);
      if (ehErro(r)) return r;
      return Number.isFinite(r) ? r : erro("#NÚM!");
    },
  };
}

/** Critério de CONT.SE/SOMASE: ">10", "<>x", "=abc", "ab*", 5. */
export function criterio(c: Escalar): (v: Escalar) => boolean {
  if (typeof c === "number" || typeof c === "boolean") return (v) => v === c || (typeof v === "string" && lerNumeroBR(v) === c);
  if (c === null) return (v) => v === null || v === "";
  if (ehErro(c)) return (v) => ehErro(v) && v.codigo === c.codigo;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(c)!;
  const op = m[1] ?? "=", resto = m[2];
  const n = lerNumeroBR(resto);
  if (n !== null && resto.trim() !== "") {
    return (v) => {
      const x = typeof v === "number" ? v : typeof v === "string" ? lerNumeroBR(v) : null;
      if (x === null) return op === "<>";
      return op === "=" ? x === n : op === "<>" ? x !== n : op === "<" ? x < n : op === ">" ? x > n : op === "<=" ? x <= n : x >= n;
    };
  }
  // texto com curingas * e ? (~ escapa)
  const rx = new RegExp("^" + resto.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002")
    .replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?") + "$", "is");
  if (op === "=" || op === "<>") {
    return (v) => {
      const s = v === null ? "" : typeof v === "string" ? v : comoTexto(v);
      const ok = !ehErro(s) && (resto === "" ? v === null || v === "" : rx.test(s));
      return op === "=" ? ok : !ok;
    };
  }
  return (v) => {
    if (typeof v !== "string") return false;
    const k = comparar(v, resto);
    return op === "<" ? k < 0 : op === ">" ? k > 0 : op === "<=" ? k <= 0 : k >= 0;
  };
}

/** Pares (intervalo, critério) de CONT.SES/SOMASES → máscara das posições que passam. */
function mascara(pares: Valor[], forma: Escalar[][]): boolean[] | ErroF {
  const n = forma.flat().length;
  const ok = new Array(n).fill(true);
  for (let i = 0; i + 1 < pares.length; i += 2) {
    const r = plano(pares[i]);
    if (r.length !== n) return erro("#VALOR!");
    const crit = criterio(esc1(pares[i + 1]));
    r.forEach((v, k) => {
      if (!crit(v)) ok[k] = false;
    });
  }
  return ok;
}

const media = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variancia = (xs: number[], amostra: boolean) => {
  if (xs.length < (amostra ? 2 : 1)) return NaN;
  const m = media(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - (amostra ? 1 : 0));
};
const mdc = (a: number, b: number): number => (b === 0 ? Math.abs(a) : mdc(b, a % b));
const fatorial = (n: number) => {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};
const arredondar = (x: number, d: number, modo: "perto" | "cima" | "baixo") => {
  const k = Math.pow(10, d);
  const y = Math.abs(x) * k;
  // corrige 1,005 → 1,01 (erro de representação binária)
  const z = modo === "perto" ? Math.round(Number(y.toPrecision(15))) : modo === "cima" ? Math.ceil(Number(y.toPrecision(15))) : Math.floor(Number(y.toPrecision(15)));
  return (Math.sign(x) * z) / k;
};

// ---------- procura ----------

/** Posição (0..n−1) de `alvo` em `lista`: tipo 0 = exata (com curingas em texto), 1 = maior ≤, −1 = menor ≥. */
function procurar(alvo: Escalar, lista: Escalar[], tipo: number): number {
  if (tipo === 0) {
    const crit = typeof alvo === "string" && /[*?]/.test(alvo) ? criterio("=" + alvo) : null;
    return lista.findIndex((v) => (crit ? crit(v) : comparar(v, alvo) === 0 && (v !== null || alvo === null)));
  }
  let melhor = -1;
  for (let i = 0; i < lista.length; i++) {
    const k = comparar(lista[i], alvo);
    if (tipo === 1) {
      if (k <= 0) melhor = i;
      else break;
    } else {
      if (k >= 0) melhor = i;
      else break;
    }
  }
  return melhor;
}

// ---------- texto ----------

/** Formatação de TEXTO(valor; "formato"): 0 · 0,00 · #.##0,00 · 0% · dd/mm/aaaa · hh:mm. */
export function formatarComCodigo(v: number, cod: string): string {
  const c = cod.toLowerCase();
  if (/[dmay]/.test(c) && !/^[#0.,%]+$/.test(c)) {
    const d = serieParaData(v);
    const p2 = (x: number) => String(x).padStart(2, "0");
    return cod
      .replace(/aaaa|yyyy/gi, String(d.a)).replace(/aa|yy/gi, p2(d.a % 100))
      .replace(/dd/gi, p2(d.d)).replace(/hh/gi, p2(d.h)).replace(/ss/gi, p2(d.seg))
      .replace(/mm/gi, (_, i: number) => (/h/i.test(cod.slice(0, i)) ? p2(d.min) : p2(d.m)));
  }
  const pct = cod.includes("%");
  const x = pct ? v * 100 : v;
  const dec = (cod.split(",")[1] ?? "").replace(/[^0#]/g, "").length;
  const milhar = cod.includes(".") && cod.indexOf(".") < (cod.includes(",") ? cod.indexOf(",") : Infinity);
  const s = x.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: milhar });
  return s + (pct ? "%" : "");
}

// ---------- registro ----------

const F: Record<string, DefFuncao> = {};
function def(nomes: string[], d: DefFuncao) {
  for (const n of nomes) F[normalizarNome(n)] = d;
}

// matemática
def(["SOMA", "SUM"], { categoria: "Matemática", sintaxe: "SOMA(núm1; [núm2]; …)", descricao: "Soma os números.", f: (a) => {
  const x = numeros(a);
  return ehErro(x) ? x : x.reduce((s, v) => s + v, 0);
} });
def(["PRODUTO", "PRODUCT"], { categoria: "Matemática", sintaxe: "PRODUTO(núm1; …)", descricao: "Multiplica os números.", f: (a) => {
  const x = numeros(a);
  return ehErro(x) ? x : x.reduce((s, v) => s * v, 1);
} });
def(["SOMAQUAD", "SUMSQ"], { categoria: "Matemática", sintaxe: "SOMAQUAD(núm1; …)", descricao: "Soma dos quadrados.", f: (a) => {
  const x = numeros(a);
  return ehErro(x) ? x : x.reduce((s, v) => s + v * v, 0);
} });
def(["SOMARPRODUTO", "SUMPRODUCT"], { min: 1, categoria: "Matemática", sintaxe: "SOMARPRODUTO(matriz1; [matriz2]; …)", descricao: "Soma dos produtos das posições correspondentes.", f: (a) => {
  const ms = a.map(plano);
  const n = ms[0].length;
  if (ms.some((m) => m.length !== n)) return erro("#VALOR!");
  let s = 0;
  for (let i = 0; i < n; i++) {
    let p = 1;
    for (const m of ms) {
      const v = m[i];
      if (ehErro(v)) return v;
      p *= typeof v === "number" ? v : typeof v === "boolean" ? 0 : 0;
    }
    s += p;
  }
  return s;
} });
def(["ABS"], numerica(1, Math.abs, "Matemática", "ABS(núm)", "Valor absoluto."));
def(["SINAL", "SIGN"], numerica(1, Math.sign, "Matemática", "SINAL(núm)", "1, 0 ou −1 conforme o sinal."));
def(["RAIZ", "SQRT"], numerica(1, (x) => (x < 0 ? erro("#NÚM!") : Math.sqrt(x)), "Matemática", "RAIZ(núm)", "Raiz quadrada."));
def(["POTENCIA", "POWER"], numerica(2, Math.pow, "Matemática", "POTÊNCIA(núm; expoente)", "Número elevado a uma potência."));
def(["EXP"], numerica(1, Math.exp, "Matemática", "EXP(núm)", "e elevado ao número."));
def(["LN"], numerica(1, (x) => (x <= 0 ? erro("#NÚM!") : Math.log(x)), "Matemática", "LN(núm)", "Logaritmo natural."));
def(["LOG10"], numerica(1, (x) => (x <= 0 ? erro("#NÚM!") : Math.log10(x)), "Matemática", "LOG10(núm)", "Logaritmo na base 10."));
def(["LOG"], { min: 1, max: 2, categoria: "Matemática", sintaxe: "LOG(núm; [base])", descricao: "Logaritmo (base 10 se omitida).", f: (a) => {
  const x = num1(a[0]), b = a[1] === undefined || a[1] === null ? 10 : num1(a[1]);
  if (ehErro(x)) return x;
  if (ehErro(b)) return b;
  return x <= 0 || b <= 0 || b === 1 ? erro("#NÚM!") : Math.log(x) / Math.log(b);
} });
def(["RESTO", "MOD"], numerica(2, (x, d) => (d === 0 ? erro("#DIV/0!") : x - d * Math.floor(x / d)), "Matemática", "RESTO(núm; divisor)", "Resto da divisão (com o sinal do divisor)."));
def(["INT"], numerica(1, Math.floor, "Matemática", "INT(núm)", "Arredonda para baixo até o inteiro."));
def(["TRUNCAR", "TRUNC"], { min: 1, max: 2, categoria: "Matemática", sintaxe: "TRUNCAR(núm; [dígitos])", descricao: "Corta as casas decimais.", f: (a) => {
  const x = num1(a[0]), d = a[1] === undefined ? 0 : num1(a[1]);
  if (ehErro(x)) return x;
  if (ehErro(d)) return d;
  return arredondar(x, Math.trunc(d), "baixo");
} });
for (const [nomes, modo, desc] of [
  [["ARRED", "ROUND"], "perto", "Arredonda para o número de dígitos."],
  [["ARREDONDAR.PARA.CIMA", "ROUNDUP"], "cima", "Arredonda afastando de zero."],
  [["ARREDONDAR.PARA.BAIXO", "ROUNDDOWN"], "baixo", "Arredonda aproximando de zero."],
] as const) {
  def([...nomes], numerica(2, (x, d) => arredondar(x, Math.trunc(d), modo), "Matemática", `${nomes[0]}(núm; dígitos)`, desc));
}
def(["ARREDMULTB", "MROUND"], numerica(2, (x, m) => (m === 0 ? 0 : Math.sign(x) !== Math.sign(m) && x !== 0 ? erro("#NÚM!") : Math.round(x / m) * m), "Matemática", "ARREDMULTB(núm; múltiplo)", "Arredonda para o múltiplo mais próximo."));
def(["TETO", "TETO.MAT", "CEILING", "CEILING.MATH"], { min: 1, max: 2, categoria: "Matemática", sintaxe: "TETO(núm; [múltiplo])", descricao: "Arredonda para cima até o múltiplo.", f: (a) => {
  const x = num1(a[0]), m = a[1] === undefined ? 1 : num1(a[1]);
  if (ehErro(x)) return x;
  if (ehErro(m)) return m;
  return m === 0 ? 0 : Math.ceil(x / Math.abs(m)) * Math.abs(m);
} });
def(["ARREDMULTB.BAIXO", "FLOOR", "FLOOR.MATH"], { min: 1, max: 2, categoria: "Matemática", sintaxe: "ARREDMULTB.BAIXO(núm; [múltiplo])", descricao: "Arredonda para baixo até o múltiplo.", f: (a) => {
  const x = num1(a[0]), m = a[1] === undefined ? 1 : num1(a[1]);
  if (ehErro(x)) return x;
  if (ehErro(m)) return m;
  return m === 0 ? 0 : Math.floor(x / Math.abs(m)) * Math.abs(m);
} });
def(["MDC", "GCD"], { min: 1, categoria: "Matemática", sintaxe: "MDC(núm1; …)", descricao: "Máximo divisor comum.", f: (a) => {
  const x = numeros(a);
  return ehErro(x) ? x : x.map(Math.trunc).reduce(mdc);
} });
def(["MMC", "LCM"], { min: 1, categoria: "Matemática", sintaxe: "MMC(núm1; …)", descricao: "Mínimo múltiplo comum.", f: (a) => {
  const x = numeros(a);
  return ehErro(x) ? x : x.map(Math.trunc).reduce((p, q) => (p === 0 || q === 0 ? 0 : Math.abs(p * q) / mdc(p, q)));
} });
def(["FATORIAL", "FACT"], numerica(1, (x) => (x < 0 ? erro("#NÚM!") : fatorial(Math.trunc(x))), "Matemática", "FATORIAL(núm)", "Fatorial."));
def(["COMBIN"], numerica(2, (n, k) => (k > n || k < 0 ? erro("#NÚM!") : Math.round(fatorial(n) / (fatorial(k) * fatorial(n - k)))), "Matemática", "COMBIN(n; k)", "Combinações de n tomados k a k."));
def(["PI"], { min: 0, max: 0, categoria: "Matemática", sintaxe: "PI()", descricao: "O número π.", f: () => Math.PI });
def(["ALEATORIO", "RAND"], { min: 0, max: 0, categoria: "Matemática", sintaxe: "ALEATÓRIO()", descricao: "Número aleatório entre 0 e 1.", f: () => Math.random() });
def(["ALEATORIOENTRE", "RANDBETWEEN"], numerica(2, (a, b) => Math.floor(Math.random() * (Math.floor(b) - Math.ceil(a) + 1)) + Math.ceil(a), "Matemática", "ALEATÓRIOENTRE(inferior; superior)", "Inteiro aleatório entre os limites."));
for (const [nomes, f, d] of [
  [["SEN", "SIN"], Math.sin, "Seno (radianos)."], [["COS"], Math.cos, "Cosseno (radianos)."], [["TAN"], Math.tan, "Tangente (radianos)."],
  [["ASEN", "ASIN"], Math.asin, "Arco-seno."], [["ACOS"], Math.acos, "Arco-cosseno."], [["ATAN"], Math.atan, "Arco-tangente."],
  [["SENH", "SINH"], Math.sinh, "Seno hiperbólico."], [["COSH"], Math.cosh, "Cosseno hiperbólico."], [["TANH"], Math.tanh, "Tangente hiperbólica."],
  [["GRAUS", "DEGREES"], (x: number) => (x * 180) / Math.PI, "Radianos para graus."], [["RADIANOS", "RADIANS"], (x: number) => (x * Math.PI) / 180, "Graus para radianos."],
] as const) {
  def([...nomes], numerica(1, f as (x: number) => number, "Matemática", `${nomes[0]}(núm)`, d));
}
def(["ATAN2"], numerica(2, (x, y) => (x === 0 && y === 0 ? erro("#DIV/0!") : Math.atan2(y, x)), "Matemática", "ATAN2(x; y)", "Ângulo do ponto (x; y)."));

// estatística
const agreg = (nomes: string[], f: (x: number[]) => number | ErroF, sintaxe: string, descricao: string) =>
  def(nomes, { min: 1, categoria: "Estatística", sintaxe, descricao, f: (a) => {
    const x = numeros(a);
    if (ehErro(x)) return x;
    const r = f(x);
    return ehErro(r) ? r : Number.isFinite(r) ? r : erro(x.length ? "#NÚM!" : "#DIV/0!");
  } });
agreg(["MEDIA", "AVERAGE"], (x) => (x.length ? media(x) : erro("#DIV/0!")), "MÉDIA(núm1; …)", "Média aritmética.");
agreg(["MINIMO", "MIN"], (x) => (x.length ? Math.min(...x) : 0), "MÍNIMO(núm1; …)", "Menor valor.");
agreg(["MAXIMO", "MAX"], (x) => (x.length ? Math.max(...x) : 0), "MÁXIMO(núm1; …)", "Maior valor.");
agreg(["MED", "MEDIAN"], (x) => {
  if (!x.length) return erro("#NÚM!");
  const s = [...x].sort((p, q) => p - q), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}, "MED(núm1; …)", "Mediana.");
agreg(["MODO", "MODE", "MODO.ÚNICO", "MODE.SNGL"], (x) => {
  const c = new Map<number, number>();
  for (const v of x) c.set(v, (c.get(v) ?? 0) + 1);
  let melhor: number | null = null, n = 1;
  for (const [v, k] of c) if (k > n) [melhor, n] = [v, k];
  return melhor ?? erro("#N/D");
}, "MODO(núm1; …)", "Valor mais frequente.");
agreg(["DESVPAD", "DESVPAD.A", "STDEV", "STDEV.S"], (x) => Math.sqrt(variancia(x, true)), "DESVPAD.A(núm1; …)", "Desvio padrão da amostra.");
agreg(["DESVPADP", "DESVPAD.P", "STDEVP", "STDEV.P"], (x) => Math.sqrt(variancia(x, false)), "DESVPAD.P(núm1; …)", "Desvio padrão da população.");
agreg(["VAR", "VAR.A", "VAR.S"], (x) => variancia(x, true), "VAR.A(núm1; …)", "Variância da amostra.");
agreg(["VARP", "VAR.P"], (x) => variancia(x, false), "VAR.P(núm1; …)", "Variância da população.");
def(["CONT.NUM", "COUNT"], { categoria: "Estatística", sintaxe: "CONT.NÚM(valor1; …)", descricao: "Conta os números.", f: (a) => {
  let n = 0;
  for (const v of a) {
    if (ehMatriz(v)) n += v.flat().filter((x) => typeof x === "number").length;
    else if (typeof v === "number" || (typeof v === "string" && lerNumeroBR(v) !== null) || typeof v === "boolean") n++;
  }
  return n;
} });
def(["CONT.VALORES", "COUNTA"], { categoria: "Estatística", sintaxe: "CONT.VALORES(valor1; …)", descricao: "Conta as células não vazias.", f: (a) =>
  a.reduce<number>((n, v) => n + (ehMatriz(v) ? v.flat().filter((x) => x !== null && x !== "").length : v === null ? 0 : 1), 0) });
def(["CONTAR.VAZIO", "COUNTBLANK"], { min: 1, max: 1, categoria: "Estatística", sintaxe: "CONTAR.VAZIO(intervalo)", descricao: "Conta as células vazias.", f: (a) =>
  plano(a[0]).filter((x) => x === null || x === "").length });
def(["CONT.SE", "COUNTIF"], { min: 2, max: 2, categoria: "Estatística", sintaxe: "CONT.SE(intervalo; critério)", descricao: "Conta as células que atendem ao critério.", f: (a) => {
  const c = criterio(esc1(a[1]));
  return plano(a[0]).filter(c).length;
} });
def(["CONT.SES", "COUNTIFS"], { min: 2, categoria: "Estatística", sintaxe: "CONT.SES(intervalo1; critério1; …)", descricao: "Conta onde todos os critérios são atendidos.", f: (a) => {
  const m = mascara(a, matriz(a[0]));
  return ehErro(m) ? m : m.filter(Boolean).length;
} });
def(["SOMASE", "SUMIF"], { min: 2, max: 3, categoria: "Matemática", sintaxe: "SOMASE(intervalo; critério; [intervalo_soma])", descricao: "Soma onde o critério é atendido.", f: (a) => {
  const c = criterio(esc1(a[1]));
  const r = plano(a[0]), s = plano(a[2] ?? a[0]);
  let t = 0;
  r.forEach((v, i) => {
    if (c(v) && typeof s[i] === "number") t += s[i] as number;
  });
  return t;
} });
def(["SOMASES", "SUMIFS"], { min: 3, categoria: "Matemática", sintaxe: "SOMASES(intervalo_soma; intervalo1; critério1; …)", descricao: "Soma onde todos os critérios são atendidos.", f: (a) => {
  const s = plano(a[0]);
  const m = mascara(a.slice(1), matriz(a[0]));
  if (ehErro(m)) return m;
  return s.reduce<number>((t, v, i) => t + (m[i] && typeof v === "number" ? v : 0), 0);
} });
def(["MEDIASE", "AVERAGEIF"], { min: 2, max: 3, categoria: "Estatística", sintaxe: "MÉDIASE(intervalo; critério; [intervalo_média])", descricao: "Média onde o critério é atendido.", f: (a) => {
  const c = criterio(esc1(a[1]));
  const r = plano(a[0]), s = plano(a[2] ?? a[0]);
  const xs = r.flatMap((v, i) => (c(v) && typeof s[i] === "number" ? [s[i] as number] : []));
  return xs.length ? media(xs) : erro("#DIV/0!");
} });
def(["MEDIASES", "AVERAGEIFS"], { min: 3, categoria: "Estatística", sintaxe: "MÉDIASES(intervalo_média; intervalo1; critério1; …)", descricao: "Média onde todos os critérios são atendidos.", f: (a) => {
  const s = plano(a[0]);
  const m = mascara(a.slice(1), matriz(a[0]));
  if (ehErro(m)) return m;
  const xs = s.flatMap((v, i) => (m[i] && typeof v === "number" ? [v] : []));
  return xs.length ? media(xs) : erro("#DIV/0!");
} });
for (const [nomes, ordem, d] of [[["MAIOR", "LARGE"], -1, "k-ésimo maior valor."], [["MENOR", "SMALL"], 1, "k-ésimo menor valor."]] as const) {
  def([...nomes], { min: 2, max: 2, categoria: "Estatística", sintaxe: `${nomes[0]}(matriz; k)`, descricao: d, f: (a) => {
    const x = numeros([matriz(a[0])]), k = num1(a[1]);
    if (ehErro(x)) return x;
    if (ehErro(k)) return k;
    const s = [...x].sort((p, q) => ordem * (p - q));
    return k >= 1 && k <= s.length ? s[Math.trunc(k) - 1] : erro("#NÚM!");
  } });
}
def(["ORDEM", "RANK", "ORDEM.EQ", "RANK.EQ"], { min: 2, max: 3, categoria: "Estatística", sintaxe: "ORDEM(núm; ref; [ordem])", descricao: "Posição do número na lista.", f: (a) => {
  const n = num1(a[0]), x = numeros([matriz(a[1])]), o = a[2] === undefined ? 0 : num1(a[2]);
  if (ehErro(n)) return n;
  if (ehErro(x)) return x;
  if (ehErro(o)) return o;
  if (!x.includes(n)) return erro("#N/D");
  return 1 + x.filter((v) => (o ? v < n : v > n)).length;
} });

// lógica
def(["SE", "IF"], { categoria: "Lógica", sintaxe: "SE(teste; [se_verdadeiro]; [se_falso])", descricao: "Escolhe o valor conforme o teste.", preguicosa: (n, av) => {
  if (n.length < 1 || n.length > 3) return erro("#VALOR!");
  const t = log1(av.avaliar(n[0]));
  if (ehErro(t)) return t;
  if (t) return n[1] ? av.avaliar(n[1]) ?? 0 : true;
  return n[2] ? av.avaliar(n[2]) ?? 0 : false;
} });
def(["SES", "IFS"], { categoria: "Lógica", sintaxe: "SES(teste1; valor1; [teste2; valor2]; …)", descricao: "Primeiro valor cujo teste é verdadeiro.", preguicosa: (n, av) => {
  for (let i = 0; i + 1 < n.length; i += 2) {
    const t = log1(av.avaliar(n[i]));
    if (ehErro(t)) return t;
    if (t) return av.avaliar(n[i + 1]);
  }
  return erro("#N/D");
} });
def(["SEERRO", "IFERROR"], { categoria: "Lógica", sintaxe: "SEERRO(valor; valor_se_erro)", descricao: "Valor alternativo se der erro.", preguicosa: (n, av) => {
  const v = av.avaliar(n[0]);
  return ehErro(esc1(v)) ? (n[1] ? av.avaliar(n[1]) : "") : v;
} });
def(["SENAODISP", "IFNA"], { categoria: "Lógica", sintaxe: "SENÃODISP(valor; valor_se_nd)", descricao: "Valor alternativo se der #N/D.", preguicosa: (n, av) => {
  const v = av.avaliar(n[0]);
  const e = esc1(v);
  return ehErro(e) && e.codigo === "#N/D" ? av.avaliar(n[1]) : v;
} });
const logicos = (a: Valor[]): boolean[] | ErroF => {
  const out: boolean[] = [];
  for (const v of a) {
    for (const x of plano(v)) {
      if (ehErro(x)) return x;
      if (x === null || (ehMatriz(v) && typeof x === "string")) continue;
      const b = comoLogico(x);
      if (ehErro(b)) return b;
      out.push(b);
    }
  }
  return out;
};
def(["E", "AND"], { min: 1, categoria: "Lógica", sintaxe: "E(lógico1; …)", descricao: "VERDADEIRO se todos forem verdadeiros.", f: (a) => {
  const x = logicos(a);
  return ehErro(x) ? x : x.length ? x.every(Boolean) : erro("#VALOR!");
} });
def(["OU", "OR"], { min: 1, categoria: "Lógica", sintaxe: "OU(lógico1; …)", descricao: "VERDADEIRO se algum for verdadeiro.", f: (a) => {
  const x = logicos(a);
  return ehErro(x) ? x : x.length ? x.some(Boolean) : erro("#VALOR!");
} });
def(["XOU", "XOR"], { min: 1, categoria: "Lógica", sintaxe: "XOU(lógico1; …)", descricao: "VERDADEIRO se um número ímpar for verdadeiro.", f: (a) => {
  const x = logicos(a);
  return ehErro(x) ? x : x.filter(Boolean).length % 2 === 1;
} });
def(["NAO", "NOT"], { min: 1, max: 1, categoria: "Lógica", sintaxe: "NÃO(lógico)", descricao: "Inverte o valor lógico.", f: (a) => {
  const b = log1(a[0]);
  return ehErro(b) ? b : !b;
} });
def(["VERDADEIRO", "TRUE"], { min: 0, max: 0, categoria: "Lógica", sintaxe: "VERDADEIRO()", descricao: "O valor VERDADEIRO.", f: () => true });
def(["FALSO", "FALSE"], { min: 0, max: 0, categoria: "Lógica", sintaxe: "FALSO()", descricao: "O valor FALSO.", f: () => false });
def(["PARAMETRO", "SWITCH"], { min: 3, categoria: "Lógica", sintaxe: "PARÂMETRO(expressão; valor1; resultado1; …; [padrão])", descricao: "Compara a expressão com uma lista de valores.", f: (a) => {
  const x = esc1(a[0]);
  let i = 1;
  for (; i + 1 < a.length; i += 2) if (comparar(x, esc1(a[i])) === 0) return a[i + 1];
  return i < a.length ? a[i] : erro("#N/D");
} });

// procura e referência
def(["PROCV", "VLOOKUP"], { min: 3, max: 4, categoria: "Procura", sintaxe: "PROCV(valor; tabela; coluna; [procurar_intervalo])", descricao: "Procura na 1ª coluna e devolve da coluna pedida.", f: (a) => {
  const t = matriz(a[1]), c = num1(a[2]);
  if (ehErro(c)) return c;
  const aprox = a[3] === undefined || a[3] === null ? true : log1(a[3]);
  if (ehErro(aprox)) return aprox;
  if (c < 1 || c > (t[0]?.length ?? 0)) return erro("#REF!");
  const i = procurar(esc1(a[0]), t.map((l) => l[0]), aprox ? 1 : 0);
  return i < 0 ? erro("#N/D") : t[i][Math.trunc(c) - 1];
} });
def(["PROCH", "HLOOKUP"], { min: 3, max: 4, categoria: "Procura", sintaxe: "PROCH(valor; tabela; linha; [procurar_intervalo])", descricao: "Procura na 1ª linha e devolve da linha pedida.", f: (a) => {
  const t = matriz(a[1]), l = num1(a[2]);
  if (ehErro(l)) return l;
  const aprox = a[3] === undefined || a[3] === null ? true : log1(a[3]);
  if (ehErro(aprox)) return aprox;
  if (l < 1 || l > t.length) return erro("#REF!");
  const i = procurar(esc1(a[0]), t[0], aprox ? 1 : 0);
  return i < 0 ? erro("#N/D") : t[Math.trunc(l) - 1][i];
} });
def(["PROCX", "XLOOKUP"], { min: 3, max: 6, categoria: "Procura", sintaxe: "PROCX(valor; matriz_procura; matriz_retorno; [se_não_encontrado]; [modo])", descricao: "Procura e devolve o correspondente (exata por padrão).", f: (a) => {
  const busca = plano(a[1]), ret = matriz(a[2]);
  const modo = a[4] === undefined || a[4] === null ? 0 : num1(a[4]);
  if (ehErro(modo)) return modo;
  let i = procurar(esc1(a[0]), busca, 0);
  if (i < 0 && modo !== 0) {
    // −1: exata ou próximo menor; 1: exata ou próximo maior
    let melhor = -1;
    busca.forEach((v, k) => {
      const c = comparar(v, esc1(a[0]));
      if (typeof v !== typeof esc1(a[0])) return;
      if (modo === -1 && c < 0 && (melhor < 0 || comparar(v, busca[melhor]) > 0)) melhor = k;
      if (modo === 1 && c > 0 && (melhor < 0 || comparar(v, busca[melhor]) < 0)) melhor = k;
    });
    i = melhor;
  }
  if (i < 0) return a[3] === undefined || a[3] === null ? erro("#N/D") : a[3];
  // retorno vertical (uma coluna ou várias) ou horizontal
  return ret.length === busca.length ? (ret[i].length === 1 ? ret[i][0] : [ret[i]]) : ret.map((l) => [l[i]]);
} });
def(["CORRESP", "MATCH"], { min: 2, max: 3, categoria: "Procura", sintaxe: "CORRESP(valor; matriz; [tipo])", descricao: "Posição do valor na lista.", f: (a) => {
  const t = a[2] === undefined || a[2] === null ? 1 : num1(a[2]);
  if (ehErro(t)) return t;
  const i = procurar(esc1(a[0]), plano(a[1]), Math.sign(t));
  return i < 0 ? erro("#N/D") : i + 1;
} });
def(["INDICE", "INDEX"], { min: 2, max: 3, categoria: "Procura", sintaxe: "ÍNDICE(matriz; linha; [coluna])", descricao: "Valor na linha/coluna da matriz.", f: (a) => {
  const m = matriz(a[0]);
  let l = num1(a[1]), c = a[2] === undefined || a[2] === null ? 1 : num1(a[2]);
  if (ehErro(l)) return l;
  if (ehErro(c)) return c;
  if (m.length === 1 && a[2] === undefined) [l, c] = [1, l];
  if (l === 0) return m.map((x) => [x[Math.trunc(c) - 1]]);
  if (c === 0) return [m[Math.trunc(l) - 1]];
  return m[Math.trunc(l) - 1]?.[Math.trunc(c) - 1] ?? erro("#REF!");
} });
def(["ESCOLHER", "CHOOSE"], { min: 2, categoria: "Procura", sintaxe: "ESCOLHER(índice; valor1; …)", descricao: "Escolhe um valor da lista pelo índice.", f: (a) => {
  const i = num1(a[0]);
  if (ehErro(i)) return i;
  return a[Math.trunc(i)] ?? erro("#VALOR!");
} });
def(["LIN", "ROW"], { categoria: "Procura", sintaxe: "LIN([ref])", descricao: "Número da linha.", preguicosa: (n) => {
  const x = n[0];
  return x?.t === "ref" ? x.r.lin + 1 : x?.t === "intervalo" ? Math.min(x.a.lin, x.b.lin) + 1 : erro("#VALOR!");
} });
def(["COL", "COLUMN"], { categoria: "Procura", sintaxe: "COL([ref])", descricao: "Número da coluna.", preguicosa: (n) => {
  const x = n[0];
  return x?.t === "ref" ? x.r.col + 1 : x?.t === "intervalo" ? Math.min(x.a.col, x.b.col) + 1 : erro("#VALOR!");
} });
def(["LINS", "ROWS"], { min: 1, max: 1, categoria: "Procura", sintaxe: "LINS(matriz)", descricao: "Número de linhas.", f: (a) => matriz(a[0]).length });
def(["COLS", "COLUMNS"], { min: 1, max: 1, categoria: "Procura", sintaxe: "COLS(matriz)", descricao: "Número de colunas.", f: (a) => matriz(a[0])[0]?.length ?? 0 });
def(["TRANSPOR", "TRANSPOSE"], { min: 1, max: 1, categoria: "Procura", sintaxe: "TRANSPOR(matriz)", descricao: "Troca linhas e colunas.", f: (a) => {
  const m = matriz(a[0]);
  return m[0].map((_, c) => m.map((l) => l[c]));
} });

// texto
def(["CONCAT", "CONCATENAR", "CONCATENATE"], { min: 1, categoria: "Texto", sintaxe: "CONCAT(texto1; …)", descricao: "Junta os textos.", f: (a) => {
  let s = "";
  for (const v of a) for (const x of plano(v)) {
    const t = comoTexto(x);
    if (ehErro(t)) return t;
    s += t;
  }
  return s;
} });
def(["UNIRTEXTO", "TEXTJOIN"], { min: 3, categoria: "Texto", sintaxe: "UNIRTEXTO(delimitador; ignorar_vazio; texto1; …)", descricao: "Junta os textos com um delimitador.", f: (a) => {
  const d = txt1(a[0]), ig = log1(a[1]);
  if (ehErro(d)) return d;
  if (ehErro(ig)) return ig;
  const partes: string[] = [];
  for (const v of a.slice(2)) for (const x of plano(v)) {
    const t = comoTexto(x);
    if (ehErro(t)) return t;
    if (!(ig && t === "")) partes.push(t);
  }
  return partes.join(d);
} });
const texto1 = (nomes: string[], f: (s: string) => Escalar, d: string) =>
  def(nomes, { min: 1, max: 1, categoria: "Texto", sintaxe: `${nomes[0]}(texto)`, descricao: d, f: (a) => {
    const s = txt1(a[0]);
    return ehErro(s) ? s : f(s);
  } });
texto1(["NUM.CARACT", "LEN"], (s) => [...s].length, "Número de caracteres.");
texto1(["MAIUSCULA", "UPPER"], (s) => s.toLocaleUpperCase("pt-BR"), "Tudo em maiúsculas.");
texto1(["MINUSCULA", "LOWER"], (s) => s.toLocaleLowerCase("pt-BR"), "Tudo em minúsculas.");
texto1(["PRI.MAIUSCULA", "PROPER"], (s) => s.toLocaleLowerCase("pt-BR").replace(/(^|[^\p{L}])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("pt-BR")), "Primeira letra de cada palavra em maiúscula.");
texto1(["ARRUMAR", "TRIM"], (s) => s.trim().replace(/ {2,}/g, " "), "Tira espaços extras.");
texto1(["LIMPAR", "CLEAN"], (s) => s.replace(/[\x00-\x1f]/g, ""), "Tira caracteres não imprimíveis.");
texto1(["CODIGO", "CODE"], (s) => (s.length ? s.codePointAt(0)! : erro("#VALOR!")), "Código do 1º caractere.");
def(["CARACT", "CHAR", "UNICAR", "UNICHAR"], { min: 1, max: 1, categoria: "Texto", sintaxe: "CARACT(núm)", descricao: "Caractere do código.", f: (a) => {
  const n = num1(a[0]);
  return ehErro(n) ? n : n < 1 ? erro("#VALOR!") : String.fromCodePoint(Math.trunc(n));
} });
def(["ESQUERDA", "LEFT"], { min: 1, max: 2, categoria: "Texto", sintaxe: "ESQUERDA(texto; [núm])", descricao: "Primeiros caracteres.", f: (a) => {
  const s = txt1(a[0]), n = a[1] === undefined ? 1 : num1(a[1]);
  if (ehErro(s)) return s;
  if (ehErro(n)) return n;
  return n < 0 ? erro("#VALOR!") : [...s].slice(0, Math.trunc(n)).join("");
} });
def(["DIREITA", "RIGHT"], { min: 1, max: 2, categoria: "Texto", sintaxe: "DIREITA(texto; [núm])", descricao: "Últimos caracteres.", f: (a) => {
  const s = txt1(a[0]), n = a[1] === undefined ? 1 : num1(a[1]);
  if (ehErro(s)) return s;
  if (ehErro(n)) return n;
  if (n < 0) return erro("#VALOR!");
  const cs = [...s];
  return n === 0 ? "" : cs.slice(-Math.trunc(n)).join("");
} });
def(["EXT.TEXTO", "MID"], { min: 3, max: 3, categoria: "Texto", sintaxe: "EXT.TEXTO(texto; início; núm)", descricao: "Trecho do texto.", f: (a) => {
  const s = txt1(a[0]), i = num1(a[1]), n = num1(a[2]);
  if (ehErro(s)) return s;
  if (ehErro(i)) return i;
  if (ehErro(n)) return n;
  return i < 1 || n < 0 ? erro("#VALOR!") : [...s].slice(Math.trunc(i) - 1, Math.trunc(i) - 1 + Math.trunc(n)).join("");
} });
for (const [nomes, sensivel, d] of [[["PROCURAR", "FIND"], true, "Posição do texto (diferencia maiúsculas)."], [["LOCALIZAR", "SEARCH"], false, "Posição do texto (sem diferenciar; aceita * e ?)."]] as const) {
  def([...nomes], { min: 2, max: 3, categoria: "Texto", sintaxe: `${nomes[0]}(procurado; texto; [início])`, descricao: d, f: (a) => {
    const q = txt1(a[0]), s = txt1(a[1]), i = a[2] === undefined ? 1 : num1(a[2]);
    if (ehErro(q)) return q;
    if (ehErro(s)) return s;
    if (ehErro(i)) return i;
    let k: number;
    if (sensivel) k = s.indexOf(q, Math.trunc(i) - 1);
    else {
      const rx = new RegExp(q.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."), "i");
      const m = rx.exec(s.slice(Math.trunc(i) - 1));
      k = m ? m.index + Math.trunc(i) - 1 : -1;
    }
    return k < 0 ? erro("#VALOR!") : k + 1;
  } });
}
def(["SUBSTITUIR", "SUBSTITUTE"], { min: 3, max: 4, categoria: "Texto", sintaxe: "SUBSTITUIR(texto; antigo; novo; [ocorrência])", descricao: "Troca um texto por outro.", f: (a) => {
  const s = txt1(a[0]), v = txt1(a[1]), n = txt1(a[2]);
  if (ehErro(s)) return s;
  if (ehErro(v)) return v;
  if (ehErro(n)) return n;
  if (v === "") return s;
  if (a[3] === undefined) return s.split(v).join(n);
  const k = num1(a[3]);
  if (ehErro(k)) return k;
  let idx = -1;
  for (let i = 0; i < k; i++) {
    idx = s.indexOf(v, idx + 1);
    if (idx < 0) return s;
  }
  return s.slice(0, idx) + n + s.slice(idx + v.length);
} });
def(["MUDAR", "REPLACE"], { min: 4, max: 4, categoria: "Texto", sintaxe: "MUDAR(texto; início; núm; novo)", descricao: "Troca um trecho do texto.", f: (a) => {
  const s = txt1(a[0]), i = num1(a[1]), n = num1(a[2]), nv = txt1(a[3]);
  if (ehErro(s)) return s;
  if (ehErro(i)) return i;
  if (ehErro(n)) return n;
  if (ehErro(nv)) return nv;
  return s.slice(0, i - 1) + nv + s.slice(i - 1 + n);
} });
def(["REPT"], { min: 2, max: 2, categoria: "Texto", sintaxe: "REPT(texto; vezes)", descricao: "Repete o texto.", f: (a) => {
  const s = txt1(a[0]), n = num1(a[1]);
  if (ehErro(s)) return s;
  if (ehErro(n)) return n;
  return n < 0 ? erro("#VALOR!") : s.repeat(Math.trunc(n));
} });
def(["EXATO", "EXACT"], { min: 2, max: 2, categoria: "Texto", sintaxe: "EXATO(texto1; texto2)", descricao: "Textos idênticos (diferencia maiúsculas).", f: (a) => {
  const x = txt1(a[0]), y = txt1(a[1]);
  if (ehErro(x)) return x;
  if (ehErro(y)) return y;
  return x === y;
} });
def(["TEXTO", "TEXT"], { min: 2, max: 2, categoria: "Texto", sintaxe: "TEXTO(valor; formato)", descricao: "Formata o número como texto (0,00 · #.##0 · 0% · dd/mm/aaaa).", f: (a) => {
  const v = num1(a[0]), c = txt1(a[1]);
  if (ehErro(c)) return c;
  if (ehErro(v)) return txt1(a[0]);
  return formatarComCodigo(v, c);
} });
def(["VALOR", "VALUE", "VALORNUMERICO", "NUMBERVALUE"], { min: 1, max: 3, categoria: "Texto", sintaxe: "VALOR(texto)", descricao: "Converte texto em número.", f: (a) => {
  const v = esc1(a[0]);
  if (typeof v === "number") return v;
  const n = comoNumero(v);
  return n;
} });
def(["T"], { min: 1, max: 1, categoria: "Texto", sintaxe: "T(valor)", descricao: "O texto, ou vazio se não for texto.", f: (a) => {
  const v = esc1(a[0]);
  return typeof v === "string" ? v : "";
} });

// data e hora
const agora = (av: Avaliador) => av.ctx.agora?.() ?? new Date();
const serieDe = (d: Date) => dataParaSerie(d.getFullYear(), d.getMonth() + 1, d.getDate());
def(["HOJE", "TODAY"], { min: 0, max: 0, categoria: "Data e hora", sintaxe: "HOJE()", descricao: "Data de hoje.", f: (_, av) => serieDe(agora(av)) });
def(["AGORA", "NOW"], { min: 0, max: 0, categoria: "Data e hora", sintaxe: "AGORA()", descricao: "Data e hora atuais.", f: (_, av) => {
  const d = agora(av);
  return serieDe(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
} });
def(["DATA", "DATE"], numerica(3, (a, m, d) => dataParaSerie(Math.trunc(a), Math.trunc(m), Math.trunc(d)), "Data e hora", "DATA(ano; mês; dia)", "Monta a data."));
def(["TEMPO", "TIME"], numerica(3, (h, m, s) => ((h * 3600 + m * 60 + s) / 86400) % 1, "Data e hora", "TEMPO(hora; minuto; segundo)", "Monta a hora."));
for (const [nomes, campo, d] of [
  [["DIA", "DAY"], "d", "Dia do mês."], [["MES", "MONTH"], "m", "Mês."], [["ANO", "YEAR"], "a", "Ano."],
  [["HORA", "HOUR"], "h", "Hora."], [["MINUTO", "MINUTE"], "min", "Minuto."], [["SEGUNDO", "SECOND"], "seg", "Segundo."],
] as const) {
  def([...nomes], numerica(1, (s) => serieParaData(s)[campo], "Data e hora", `${nomes[0]}(data)`, d));
}
def(["DIA.DA.SEMANA", "WEEKDAY"], { min: 1, max: 2, categoria: "Data e hora", sintaxe: "DIA.DA.SEMANA(data; [tipo])", descricao: "Dia da semana (1 = domingo, tipo 2: 1 = segunda).", f: (a) => {
  const s = num1(a[0]), t = a[1] === undefined ? 1 : num1(a[1]);
  if (ehErro(s)) return s;
  if (ehErro(t)) return t;
  const dw = ((Math.floor(s) % 7) + 7 + 6) % 7; // 0 = domingo
  return t === 2 ? ((dw + 6) % 7) + 1 : t === 3 ? (dw + 6) % 7 : dw + 1;
} });
def(["DIAS", "DAYS"], numerica(2, (f, i) => Math.floor(f) - Math.floor(i), "Data e hora", "DIAS(data_final; data_inicial)", "Dias entre as datas."));
def(["DATAM", "EDATE"], numerica(2, (s, m) => {
  const d = serieParaData(s);
  const alvo = new Date(Date.UTC(d.a, d.m - 1 + Math.trunc(m), 1));
  const ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return dataParaSerie(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, Math.min(d.d, ult));
}, "Data e hora", "DATAM(data; meses)", "Data deslocada em meses."));
def(["FIMMES", "EOMONTH"], numerica(2, (s, m) => {
  const d = serieParaData(s);
  const x = new Date(Date.UTC(d.a, d.m + Math.trunc(m), 0));
  return dataParaSerie(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}, "Data e hora", "FIMMÊS(data; meses)", "Último dia do mês."));
const util = (s: number, feriados: Set<number>) => {
  const dw = ((Math.floor(s) % 7) + 7 + 6) % 7;
  return dw !== 0 && dw !== 6 && !feriados.has(Math.floor(s));
};
const feriadosDe = (v: Valor | undefined) => new Set((v === undefined ? [] : plano(v)).filter((x): x is number => typeof x === "number").map(Math.floor));
def(["DIATRABALHOTOTAL", "NETWORKDAYS"], { min: 2, max: 3, categoria: "Data e hora", sintaxe: "DIATRABALHOTOTAL(início; fim; [feriados])", descricao: "Dias úteis entre as datas (inclusive).", f: (a) => {
  const i = num1(a[0]), f = num1(a[1]);
  if (ehErro(i)) return i;
  if (ehErro(f)) return f;
  const fer = feriadosDe(a[2]);
  const [x, y, sg] = i <= f ? [i, f, 1] : [f, i, -1];
  let n = 0;
  for (let d = Math.floor(x); d <= Math.floor(y); d++) if (util(d, fer)) n++;
  return n * sg;
} });
def(["DIATRABALHO", "WORKDAY"], { min: 2, max: 3, categoria: "Data e hora", sintaxe: "DIATRABALHO(início; dias; [feriados])", descricao: "Data depois de N dias úteis.", f: (a) => {
  const i = num1(a[0]), n = num1(a[1]);
  if (ehErro(i)) return i;
  if (ehErro(n)) return n;
  const fer = feriadosDe(a[2]);
  let d = Math.floor(i), k = Math.trunc(n);
  const passo = k >= 0 ? 1 : -1;
  while (k !== 0) {
    d += passo;
    if (util(d, fer)) k -= passo;
  }
  return d;
} });

// informação
const info = (nomes: string[], f: (v: Escalar) => boolean, d: string) =>
  def(nomes, { min: 1, max: 1, categoria: "Informação", sintaxe: `${nomes[0]}(valor)`, descricao: d, f: (a) => f(esc1(a[0])) });
info(["E.CEL.VAZIA", "ÉCÉL.VAZIA", "ISBLANK"], (v) => v === null, "VERDADEIRO se a célula estiver vazia.");
info(["ENUM", "ISNUMBER"], (v) => typeof v === "number", "VERDADEIRO se for número.");
info(["ETEXTO", "ISTEXT"], (v) => typeof v === "string", "VERDADEIRO se for texto.");
info(["ENAO.TEXTO", "ISNONTEXT"], (v) => typeof v !== "string", "VERDADEIRO se não for texto.");
info(["ELOGICO", "ISLOGICAL"], (v) => typeof v === "boolean", "VERDADEIRO se for lógico.");
info(["EERRO", "ISERR"], (v) => ehErro(v) && v.codigo !== "#N/D", "VERDADEIRO se for erro (exceto #N/D).");
info(["EERROS", "ISERROR"], (v) => ehErro(v), "VERDADEIRO se for qualquer erro.");
info(["ENAO.DISP", "ISNA"], (v) => ehErro(v) && v.codigo === "#N/D", "VERDADEIRO se for #N/D.");
info(["EPAR", "ISEVEN"], (v) => typeof v === "number" && Math.trunc(v) % 2 === 0, "VERDADEIRO se for par.");
info(["EIMPAR", "ISODD"], (v) => typeof v === "number" && Math.abs(Math.trunc(v)) % 2 === 1, "VERDADEIRO se for ímpar.");
def(["NAO.DISP", "NA"], { min: 0, max: 0, categoria: "Informação", sintaxe: "NÃO.DISP()", descricao: "O erro #N/D.", f: () => erro("#N/D") });
def(["N"], { min: 1, max: 1, categoria: "Informação", sintaxe: "N(valor)", descricao: "Valor como número (texto vira 0).", f: (a) => {
  const v = esc1(a[0]);
  return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : ehErro(v) ? v : 0;
} });
def(["TIPO", "TYPE"], { min: 1, max: 1, categoria: "Informação", sintaxe: "TIPO(valor)", descricao: "1 número, 2 texto, 4 lógico, 16 erro, 64 matriz.", f: (a) => {
  const v = a[0];
  return ehMatriz(v) ? 64 : typeof v === "number" || v === null ? 1 : typeof v === "string" ? 2 : typeof v === "boolean" ? 4 : 16;
} });

// financeiras (taxa por período)
def(["VPL", "NPV"], { min: 2, categoria: "Financeira", sintaxe: "VPL(taxa; valor1; …)", descricao: "Valor presente líquido de fluxos no fim de cada período.", f: (a) => {
  const t = num1(a[0]), x = numeros(a.slice(1));
  if (ehErro(t)) return t;
  if (ehErro(x)) return x;
  return x.reduce((s, v, i) => s + v / Math.pow(1 + t, i + 1), 0);
} });
const fin = (t: number, n: number, pgto: number, vp: number, tipo: number) => ({ t, n, pgto, vp, tipo });
def(["VF", "FV"], { min: 3, max: 5, categoria: "Financeira", sintaxe: "VF(taxa; nper; pgto; [vp]; [tipo])", descricao: "Valor futuro.", f: (a) => {
  const xs = a.map((v) => (v === null ? 0 : num1(v)));
  for (const v of xs) if (ehErro(v)) return v;
  const { t, n, pgto, vp, tipo } = fin(xs[0] as number, xs[1] as number, xs[2] as number, (xs[3] ?? 0) as number, (xs[4] ?? 0) as number);
  if (t === 0) return -(vp + pgto * n);
  const k = Math.pow(1 + t, n);
  return -(vp * k + pgto * (1 + t * tipo) * (k - 1) / t);
} });
def(["VP", "PV"], { min: 3, max: 5, categoria: "Financeira", sintaxe: "VP(taxa; nper; pgto; [vf]; [tipo])", descricao: "Valor presente.", f: (a) => {
  const xs = a.map((v) => (v === null ? 0 : num1(v)));
  for (const v of xs) if (ehErro(v)) return v;
  const [t, n, pgto, vf = 0, tipo = 0] = xs as number[];
  if (t === 0) return -(vf + pgto * n);
  const k = Math.pow(1 + t, n);
  return -(vf + pgto * (1 + t * tipo) * (k - 1) / t) / k;
} });
def(["PGTO", "PMT"], { min: 3, max: 5, categoria: "Financeira", sintaxe: "PGTO(taxa; nper; vp; [vf]; [tipo])", descricao: "Pagamento periódico de um financiamento.", f: (a) => {
  const xs = a.map((v) => (v === null ? 0 : num1(v)));
  for (const v of xs) if (ehErro(v)) return v;
  const [t, n, vp, vf = 0, tipo = 0] = xs as number[];
  if (n === 0) return erro("#NÚM!");
  if (t === 0) return -(vp + vf) / n;
  const k = Math.pow(1 + t, n);
  return -(vp * k + vf) * t / ((1 + t * tipo) * (k - 1));
} });
def(["TIR", "IRR"], { min: 1, max: 2, categoria: "Financeira", sintaxe: "TIR(valores; [estimativa])", descricao: "Taxa interna de retorno.", f: (a) => {
  const x = numeros([matriz(a[0])]);
  if (ehErro(x)) return x;
  let r = a[1] === undefined ? 0.1 : (num1(a[1]) as number);
  for (let k = 0; k < 100; k++) {
    let f = 0, df = 0;
    x.forEach((v, i) => {
      f += v / Math.pow(1 + r, i);
      df -= (i * v) / Math.pow(1 + r, i + 1);
    });
    if (Math.abs(df) < 1e-14) break;
    const nr = r - f / df;
    if (Math.abs(nr - r) < 1e-12) return nr;
    r = nr;
  }
  return erro("#NÚM!");
} });

// engenharia: conversão de unidades
const UNIDADES: Record<string, [string, number]> = {
  m: ["comp", 1], mm: ["comp", 1e-3], cm: ["comp", 1e-2], km: ["comp", 1e3], in: ["comp", 0.0254], pol: ["comp", 0.0254], ft: ["comp", 0.3048], yd: ["comp", 0.9144], mi: ["comp", 1609.344],
  kg: ["massa", 1], g: ["massa", 1e-3], t: ["massa", 1000], lbm: ["massa", 0.45359237], ozm: ["massa", 0.028349523125],
  N: ["forca", 1], kN: ["forca", 1e3], kgf: ["forca", 9.80665], lbf: ["forca", 4.4482216152605], dyn: ["forca", 1e-5],
  Pa: ["pressao", 1], kPa: ["pressao", 1e3], MPa: ["pressao", 1e6], GPa: ["pressao", 1e9], bar: ["pressao", 1e5], psi: ["pressao", 6894.757293168], atm: ["pressao", 101325], mmHg: ["pressao", 133.322368421],
  J: ["energia", 1], kJ: ["energia", 1e3], cal: ["energia", 4.1868], kcal: ["energia", 4186.8], Wh: ["energia", 3600], kWh: ["energia", 3.6e6],
  W: ["potencia", 1], kW: ["potencia", 1e3], HP: ["potencia", 745.69987158227], cv: ["potencia", 735.49875],
  s: ["tempo", 1], min: ["tempo", 60], h: ["tempo", 3600], dia: ["tempo", 86400], d: ["tempo", 86400],
  l: ["volume", 1e-3], L: ["volume", 1e-3], ml: ["volume", 1e-6], m3: ["volume", 1], gal: ["volume", 0.003785411784],
  m2: ["area", 1], mm2: ["area", 1e-6], cm2: ["area", 1e-4], ha: ["area", 1e4],
  "N.m": ["torque", 1], Nm: ["torque", 1], "kgf.m": ["torque", 9.80665],
  rad: ["angulo", 1], grau: ["angulo", Math.PI / 180], deg: ["angulo", Math.PI / 180],
};
def(["CONVERTER", "CONVERT"], { min: 3, max: 3, categoria: "Engenharia", sintaxe: "CONVERTER(núm; de; para)", descricao: "Converte unidades (mm, in, kg, lbf, MPa, psi, kW, °C…).", f: (a) => {
  const n = num1(a[0]), de = txt1(a[1]), para = txt1(a[2]);
  if (ehErro(n)) return n;
  if (ehErro(de)) return de;
  if (ehErro(para)) return para;
  const temp: Record<string, [(x: number) => number, (k: number) => number]> = {
    C: [(x) => x + 273.15, (k) => k - 273.15], "°C": [(x) => x + 273.15, (k) => k - 273.15],
    F: [(x) => ((x - 32) * 5) / 9 + 273.15, (k) => ((k - 273.15) * 9) / 5 + 32], "°F": [(x) => ((x - 32) * 5) / 9 + 273.15, (k) => ((k - 273.15) * 9) / 5 + 32],
    K: [(x) => x, (k) => k],
  };
  if (temp[de] && temp[para]) return temp[para][1](temp[de][0](n));
  const u1 = UNIDADES[de], u2 = UNIDADES[para];
  if (!u1 || !u2 || u1[0] !== u2[0]) return erro("#N/D");
  return (n * u1[1]) / u2[1];
} });

export const FUNCOES: Record<string, DefFuncao> = F;

/** Nomes (em português, como exibidos) para a lista de funções e o autocompletar. */
export function listaDeFuncoes(): { nome: string; def: DefFuncao }[] {
  const vistos = new Set<DefFuncao>();
  const out: { nome: string; def: DefFuncao }[] = [];
  for (const d of Object.values(F)) {
    if (vistos.has(d)) continue;
    vistos.add(d);
    out.push({ nome: d.sintaxe.split("(")[0], def: d });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export { numeroParaTexto, ErroF };
