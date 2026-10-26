// Regras do WJERP (puras, testadas em scripts/teste-erp.ts): estoque com custo médio móvel e kardex,
// parcelas de títulos pela condição de pagamento, numeração e MRP que explode a estrutura do item
// (a mesma lista de materiais do WJPDM) abatendo saldo, ordens e pedidos em aberto.

export type TipoMov = "entrada" | "saida" | "transferencia" | "ajuste";

export interface Movimento {
  id: string;
  data: string;
  tipo: TipoMov;
  item: string;
  armazem: string;
  /** destino (transferência) */
  destino?: string;
  /** quantidade (ajuste aceita negativo) */
  qtd: number;
  /** custo unitário (entradas e ajustes positivos) */
  custo?: number;
  doc?: string;
  obs?: string;
}

export interface LinhaBOM {
  item: string;
  qtd: number;
}

export interface ItemErp {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  politica: "fabricar" | "comprar";
  bom: LinhaBOM[];
  minimo?: number;
  /** lote mínimo de reposição */
  lote?: number;
  /** dias de reposição */
  prazo?: number;
  preco?: number;
  custoPadrao?: number;
}

export interface Saldo {
  qtd: number;
  valor: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const chave = (item: string, arm: string) => `${item}|${arm}`;

/** Ordena movimentos por data (estável). */
export const emOrdem = (m: Movimento[]) => m.map((x, i) => [x, i] as const).sort((a, b) => (a[0].data < b[0].data ? -1 : a[0].data > b[0].data ? 1 : a[1] - b[1])).map(([x]) => x);

/**
 * Saldos por item/armazém e custo médio móvel por item (empresa toda).
 * Saídas e transferências saem pelo custo médio do momento. Lança erro se o saldo ficar negativo
 * (a menos que `permitirNegativo`).
 */
export function calcularEstoque(movs: Movimento[], permitirNegativo = false) {
  const saldos = new Map<string, Saldo>();
  const medio = new Map<string, number>();
  const totalItem = new Map<string, Saldo>();
  const kardex: { m: Movimento; armazem: string; qtd: number; custo: number; saldoQtd: number; saldoValor: number; medio: number }[] = [];
  const somar = (item: string, arm: string, q: number, v: number) => {
    const s = saldos.get(chave(item, arm)) ?? { qtd: 0, valor: 0 };
    s.qtd = r6(s.qtd + q);
    s.valor = r2(s.valor + v);
    saldos.set(chave(item, arm), s);
    const t = totalItem.get(item) ?? { qtd: 0, valor: 0 };
    t.qtd = r6(t.qtd + q);
    t.valor = r2(t.valor + v);
    totalItem.set(item, t);
    return t;
  };
  for (const m of emOrdem(movs)) {
    const cm = medio.get(m.item) ?? 0;
    const entrada = m.tipo === "entrada" || (m.tipo === "ajuste" && m.qtd > 0);
    if (entrada) {
      const c = m.custo ?? cm;
      const t = somar(m.item, m.armazem, Math.abs(m.qtd), Math.abs(m.qtd) * c);
      if (t.qtd > 0) medio.set(m.item, r6(t.valor / t.qtd));
      kardex.push({ m, armazem: m.armazem, qtd: Math.abs(m.qtd), custo: c, saldoQtd: t.qtd, saldoValor: t.valor, medio: medio.get(m.item) ?? c });
      continue;
    }
    const q = Math.abs(m.qtd);
    const s = saldos.get(chave(m.item, m.armazem))?.qtd ?? 0;
    if (!permitirNegativo && q > s + 1e-9) throw new Error(`Saldo insuficiente: ${s} disponível(is) no armazém para ${m.doc ?? "o movimento"} (${q}).`);
    if (m.tipo === "transferencia") {
      somar(m.item, m.armazem, -q, -q * cm);
      const t = somar(m.item, m.destino!, q, q * cm);
      kardex.push({ m, armazem: m.armazem, qtd: -q, custo: cm, saldoQtd: t.qtd, saldoValor: t.valor, medio: cm });
      continue;
    }
    const t = somar(m.item, m.armazem, -q, -q * cm);
    // zera arredondamento quando o item acaba
    if (Math.abs(t.qtd) < 1e-9) {
      for (const [k, v] of saldos) if (k.startsWith(`${m.item}|`)) v.valor = 0;
      t.valor = 0;
    }
    kardex.push({ m, armazem: m.armazem, qtd: -q, custo: cm, saldoQtd: t.qtd, saldoValor: t.valor, medio: cm });
  }
  return { saldos, medio, totalItem, kardex };
}

export const saldoDe = (saldos: Map<string, Saldo>, item: string, arm?: string) =>
  arm ? saldos.get(chave(item, arm))?.qtd ?? 0 : [...saldos].filter(([k]) => k.startsWith(`${item}|`)).reduce((s, [, v]) => s + v.qtd, 0);

/** Parcelas de um total pela condição "30/60/90" (dias); centavos exatos, a última absorve a sobra. */
export function parcelas(total: number, condicao: string, emissao: string): { vencimento: string; valor: number }[] {
  const dias = condicao.split(/[/;, ]+/).map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0);
  if (!dias.length) dias.push(0);
  const cent = Math.round(total * 100);
  const base = Math.floor(cent / dias.length);
  const d0 = Date.UTC(+emissao.slice(0, 4), +emissao.slice(5, 7) - 1, +emissao.slice(8, 10));
  return dias.map((d, i) => ({
    vencimento: new Date(d0 + d * 86400000).toISOString().slice(0, 10),
    valor: (i === dias.length - 1 ? cent - base * (dias.length - 1) : base) / 100,
  }));
}

/** Próximo número sequencial: ("PV", ["PV000003"]) → "PV000004". */
export function proximoNumero(prefixo: string, usados: string[], digitos = 6) {
  let max = 0;
  for (const u of usados) if (u.startsWith(prefixo) && /^\d+$/.test(u.slice(prefixo.length))) max = Math.max(max, Number(u.slice(prefixo.length)));
  return `${prefixo}${String(max + 1).padStart(digitos, "0")}`;
}

/** Nível mais baixo de cada item nas estruturas (para o MRP processar pais antes dos filhos). */
export function niveis(itens: ItemErp[]): Map<string, number> | string {
  const porId = new Map(itens.map((i) => [i.id, i]));
  const nivel = new Map<string, number>(itens.map((i) => [i.id, 0]));
  const visitar = (id: string, n: number, caminho: string[]): string | null => {
    const it = porId.get(id);
    if (!it) return null;
    for (const l of it.bom) {
      if (caminho.includes(l.item)) return `Estrutura circular: ${[...caminho, l.item].map((x) => porId.get(x)?.codigo ?? "?").join(" → ")}.`;
      if ((nivel.get(l.item) ?? 0) < n + 1) nivel.set(l.item, n + 1);
      const e = visitar(l.item, n + 1, [...caminho, l.item]);
      if (e) return e;
    }
    return null;
  };
  for (const i of itens) {
    const e = visitar(i.id, nivel.get(i.id) ?? 0, [i.id]);
    if (e) return e;
  }
  return nivel;
}

export interface Sugestao {
  item: string;
  tipo: "fabricar" | "comprar";
  qtd: number;
  necessidade: number;
  disponivel: number;
  /** data em que precisa estar pronto */
  data: string;
  /** data sugerida para começar/pedir (data − prazo) */
  inicio: string;
}

/**
 * MRP: demanda independente (pedidos de venda em aberto) + estoque mínimo, explodida pela estrutura.
 * Disponível = saldo + a receber (compras/OPs em aberto) − empenhos já considerados.
 */
export function mrp(
  itens: ItemErp[],
  saldo: (item: string) => number,
  aReceber: (item: string) => number,
  demandas: { item: string; qtd: number; data: string }[],
): Sugestao[] | string {
  const nv = niveis(itens);
  if (typeof nv === "string") return nv;
  const porId = new Map(itens.map((i) => [i.id, i]));
  const bruta = new Map<string, { qtd: number; data: string }>();
  const somar = (item: string, qtd: number, data: string) => {
    const b = bruta.get(item) ?? { qtd: 0, data };
    b.qtd = r6(b.qtd + qtd);
    if (data < b.data) b.data = data;
    bruta.set(item, b);
  };
  for (const d of demandas) somar(d.item, d.qtd, d.data);
  const sug: Sugestao[] = [];
  const ordem = [...itens].sort((a, b) => (nv.get(a.id) ?? 0) - (nv.get(b.id) ?? 0));
  const menosDias = (data: string, dias: number) => new Date(Date.UTC(+data.slice(0, 4), +data.slice(5, 7) - 1, +data.slice(8, 10)) - dias * 86400000).toISOString().slice(0, 10);
  for (const it of ordem) {
    const b = bruta.get(it.id);
    const minimo = it.minimo ?? 0;
    const necessidade = (b?.qtd ?? 0) + minimo;
    const disponivel = saldo(it.id) + aReceber(it.id);
    let liquida = r6(necessidade - disponivel);
    if (liquida <= 1e-9) continue;
    if (it.lote && liquida < it.lote) liquida = it.lote;
    const data = b?.data ?? new Date().toISOString().slice(0, 10);
    const tipo = it.politica === "fabricar" && it.bom.length ? "fabricar" : "comprar";
    const inicio = menosDias(data, it.prazo ?? 0);
    sug.push({ item: it.id, tipo, qtd: liquida, necessidade, disponivel, data, inicio });
    if (tipo === "fabricar") for (const l of it.bom) if (porId.has(l.item)) somar(l.item, liquida * l.qtd, inicio);
  }
  return sug;
}
