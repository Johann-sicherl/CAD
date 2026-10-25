// Exibição dos valores da planilha conforme o formato da célula (padrão brasileiro).

import { serieParaData } from "../formulas/conversao";
import type { Formato } from "../formulas/pasta";
import { ehErro, type Escalar } from "../formulas/tipos";

const p2 = (x: number) => String(x).padStart(2, "0");

export function textoData(s: number, comHora = false, soHora = false): string {
  const d = serieParaData(s);
  const h = `${p2(d.h)}:${p2(d.min)}${d.seg ? `:${p2(d.seg)}` : ""}`;
  if (soHora) return h;
  return `${p2(d.d)}/${p2(d.m)}/${d.a}${comHora ? ` ${h}` : ""}`;
}

/** Número "geral": até 10 dígitos visíveis, sem zeros à direita. */
function geral(n: number): string {
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e11 || a < 1e-9) return n.toExponential(4).replace(".", ",").replace(/0+e/, "e").replace(",e", "e");
  const casas = Math.max(0, 10 - Math.floor(Math.log10(a)) - 1);
  return Number(n.toFixed(Math.min(casas, 10))).toLocaleString("pt-BR", { maximumFractionDigits: 10, useGrouping: false });
}

/** Texto exibido e alinhamento padrão (número à direita, texto à esquerda, lógico/erro ao centro). */
export function exibir(v: Escalar, f: Formato | undefined): { texto: string; alinhar: "esquerda" | "centro" | "direita" } {
  if (v === null) return { texto: "", alinhar: "esquerda" };
  if (ehErro(v)) return { texto: v.codigo, alinhar: "centro" };
  if (typeof v === "boolean") return { texto: v ? "VERDADEIRO" : "FALSO", alinhar: "centro" };
  if (typeof v === "string") return { texto: v, alinhar: "esquerda" };
  const tipo = f?.tipo ?? "geral";
  const casas = f?.casas;
  const fmt = (x: number, c: number, milhar = f?.milhar ?? false) => x.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c, useGrouping: milhar });
  switch (tipo) {
    case "numero":
      return { texto: fmt(v, casas ?? 2), alinhar: "direita" };
    case "moeda":
      return { texto: (v < 0 ? "-R$ " : "R$ ") + fmt(Math.abs(v), casas ?? 2, true), alinhar: "direita" };
    case "porcentagem":
      return { texto: fmt(v * 100, casas ?? 0) + "%", alinhar: "direita" };
    case "cientifico":
      return { texto: v.toExponential(casas ?? 2).replace(".", ","), alinhar: "direita" };
    case "data":
      return { texto: textoData(v), alinhar: "direita" };
    case "hora":
      return { texto: textoData(v, false, true), alinhar: "direita" };
    case "dataHora":
      return { texto: textoData(v, true), alinhar: "direita" };
    case "texto":
      return { texto: geral(v), alinhar: "esquerda" };
    default:
      return { texto: casas !== undefined ? fmt(v, casas) : f?.milhar ? fmt(v, 0) : geral(v), alinhar: "direita" };
  }
}
