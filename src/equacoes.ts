// Equações e variáveis globais: campos numéricos aceitam "=expressão" usando variáveis
// (ex.: "=largura/2"), números e funções matemáticas. Avaliado antes de cada regeneração.

import type { Documento, Variavel } from "./model";
import { ehCota } from "./model";
import { gravar } from "./ui/formulario";

const FUNCOES: Record<string, string> = {
  sin: "Math.sin(Math.PI/180*", cos: "Math.cos(Math.PI/180*", tan: "Math.tan(Math.PI/180*",
  sqrt: "Math.sqrt(", abs: "Math.abs(", min: "Math.min(", max: "Math.max(", round: "Math.round(",
  floor: "Math.floor(", ceil: "Math.ceil(", int: "Math.trunc(",
};

/**
 * Avalia expressão com vírgula ou ponto decimal. Trigonométricas em graus (como em CAD).
 * `if(cond; a; b)` também é aceito. Retorna NaN se inválida.
 */
export function avaliarExpressao(texto: string, vars: Map<string, number>): number {
  let t = texto.trim().replace(/^=/, "").trim();
  if (!t) return NaN;
  // vírgula decimal (12,5) vira ponto; separador de argumentos é ";"
  t = t.replace(/(\d),(\d)/g, "$1.$2").replace(/;/g, ",");
  let erro = false;
  const js = t.replace(/[A-Za-z_À-ſ][\wÀ-ſ]*\s*\(?/g, (tok) => {
    const nome = tok.replace(/[\s(]/g, "");
    const abre = tok.trimEnd().endsWith("(");
    if (abre) {
      if (nome === "if") return "__se(";
      if (FUNCOES[nome]) return FUNCOES[nome];
      erro = true;
      return tok;
    }
    if (nome === "pi") return String(Math.PI);
    const v = vars.get(nome);
    if (v === undefined) {
      erro = true;
      return "0";
    }
    return `(${v})`;
  });
  if (erro || !/^[\d\s.+\-*/(),<>=!&|?:_A-Za-z]*$/.test(js)) return NaN;
  // trigonométricas abriram dois parênteses ("Math.sin(Math.PI/180*"): fecha o extra
  const ajustado = js.replace(/Math\.(sin|cos|tan)\(Math\.PI\/180\*([^()]*(?:\([^()]*\))*[^()]*)\)/g, "Math.$1(Math.PI/180*($2))");
  try {
    const f = new Function("__se", `"use strict"; return (${ajustado});`);
    const v = Number(f((c: unknown, a: number, b: number) => (c ? a : b)));
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/** Valores das variáveis globais (podem depender umas das outras, em qualquer ordem). */
export function resolverVariaveis(vars: Variavel[] = []): { valores: Map<string, number>; erros: string[] } {
  const valores = new Map<string, number>();
  const pendentes = [...vars];
  for (let passada = 0; passada < vars.length + 1 && pendentes.length; passada++) {
    for (let i = pendentes.length - 1; i >= 0; i--) {
      const v = avaliarExpressao(pendentes[i].expr, valores);
      if (Number.isFinite(v)) {
        valores.set(pendentes[i].nome, v);
        pendentes.splice(i, 1);
      }
    }
  }
  return { valores, erros: pendentes.map((p) => p.nome) };
}

/**
 * Aplica as equações do documento nos campos dos recursos e nas cotas dos esboços.
 * Devolve os ids de esboços cujas cotas mudaram (precisam ser resolvidos de novo).
 */
export function aplicarEquacoes(doc: Documento): { esbocosAlterados: string[]; erros: string[] } {
  const { valores, erros } = resolverVariaveis(doc.variaveis);
  const alterados: string[] = [];
  for (const [chave, expr] of Object.entries(doc.equacoes ?? {})) {
    const i = chave.indexOf(".");
    const f = doc.features.find((x) => x.id === chave.slice(0, i));
    if (!f) continue;
    const v = avaliarExpressao(expr, valores);
    if (Number.isFinite(v)) gravar(f, chave.slice(i + 1), v);
    else erros.push(chave);
  }
  for (const f of doc.features) {
    if (f.tipo !== "esboco") continue;
    for (const r of f.restricoes) {
      if (!ehCota(r) || !r.expr) continue;
      const v = avaliarExpressao(r.expr, valores);
      if (Number.isFinite(v) && Math.abs(v - r.valor) > 1e-9) {
        r.valor = v;
        if (!alterados.includes(f.id)) alterados.push(f.id);
      }
    }
  }
  return { esbocosAlterados: alterados, erros };
}
