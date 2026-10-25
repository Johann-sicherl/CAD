// Conversões de tipo das fórmulas (padrão brasileiro: vírgula decimal, VERDADEIRO/FALSO) e
// datas como número de série (dias desde 30/12/1899, como as planilhas de mercado).

import { erro, ehErro, type ErroF, type Escalar } from "./tipos";

export function lerNumeroBR(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  // 1.234,56 · 1234,56 · 1234.56 (sem milhar) · 12% · R$ 10
  let x = t.replace(/^R\$\s*/, "");
  const pct = x.endsWith("%");
  if (pct) x = x.slice(0, -1).trim();
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, "").replace(",", ".");
  else if (/^[-+]?\d*,\d+(e[-+]?\d+)?$/i.test(x) || /^[-+]?\d+,$/.test(x)) x = x.replace(",", ".");
  else if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(x)) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/** Número no padrão brasileiro, sem formatação extra (até 15 dígitos significativos). */
export function numeroParaTexto(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-9 && n !== 0) ? n.toExponential(9).replace(/\.?0+e/, "e") : String(Number(n.toPrecision(15)));
  return s.replace(".", ",");
}

export function comoTexto(v: Escalar): string | ErroF {
  if (ehErro(v)) return v;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  if (typeof v === "number") return numeroParaTexto(v);
  return v;
}

export function comoNumero(v: Escalar): number | ErroF {
  if (ehErro(v)) return v;
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const n = lerNumeroBR(v);
  if (n !== null) return n;
  const d = lerData(v);
  return d ?? erro("#VALOR!");
}

export function comoLogico(v: Escalar): boolean | ErroF {
  if (ehErro(v)) return v;
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const u = v.toUpperCase();
  if (u === "VERDADEIRO" || u === "TRUE") return true;
  if (u === "FALSO" || u === "FALSE") return false;
  return erro("#VALOR!");
}

// ---------- datas (número de série: dias desde 30/12/1899, como as planilhas de mercado) ----------

const BASE = Date.UTC(1899, 11, 30);
export const dataParaSerie = (a: number, m: number, d: number) => (Date.UTC(a, m - 1, d) - BASE) / 86400000;
export function serieParaData(s: number): { a: number; m: number; d: number; h: number; min: number; seg: number } {
  const ms = BASE + Math.round(s * 86400000);
  const x = new Date(ms);
  return { a: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes(), seg: x.getUTCSeconds() };
}
/** "25/12/2026", "25/12/2026 14:30", "14:30" → número de série (ou null). */
export function lerData(s: string): number | null {
  const t = s.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    let a = Number(m[3]);
    if (a < 100) a += a < 30 ? 2000 : 1900;
    const d = Number(m[1]), me = Number(m[2]);
    if (me < 1 || me > 12 || d < 1 || d > 31) return null;
    const h = m[4] ? (Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0)) / 86400 : 0;
    return dataParaSerie(a, me, d) + h;
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400;
  return null;
}

/** Ordem entre tipos nas comparações: números < texto < lógicos. */
export function comparar(a: Escalar, b: Escalar): number {
  const tipo = (v: Escalar) => (typeof v === "number" || v === null ? 0 : typeof v === "string" ? 1 : 2);
  const ta = tipo(a), tb = tipo(b);
  // vazio compara como 0 com números e como "" com texto
  if (a === null && tb === 1) return comparar("", b);
  if (b === null && ta === 1) return comparar(a, "");
  if (ta !== tb) return ta - tb;
  if (ta === 0) return ((a as number) ?? 0) - ((b as number) ?? 0);
  if (ta === 1) return (a as string).localeCompare(b as string, "pt-BR", { sensitivity: "base" });
  return Number(a) - Number(b);
}

