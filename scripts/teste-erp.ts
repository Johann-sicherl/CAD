// Teste das regras do WJERP em Node: estoque (custo médio, kardex), parcelas, numeração e MRP.
import { calcularEstoque, mrp, niveis, parcelas, proximoNumero, saldoDe, type ItemErp, type Movimento } from "../src/erp/regras";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = typeof esperado === "number" && typeof obtido === "number" ? Math.abs(obtido - esperado) < 1e-6 : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}

// --- estoque com custo médio móvel ---
const mv = (id: string, data: string, tipo: Movimento["tipo"], qtd: number, custo?: number, extra: Partial<Movimento> = {}): Movimento => ({ id, data, tipo, item: "chapa", armazem: "A1", qtd, custo, ...extra });
const movs = [
  mv("1", "2026-10-01", "entrada", 100, 10),
  mv("2", "2026-10-02", "entrada", 50, 13),
  mv("3", "2026-10-03", "saida", 30),
  mv("4", "2026-10-04", "transferencia", 20, undefined, { destino: "A2" }),
  mv("5", "2026-10-05", "ajuste", -5),
];
const e = calcularEstoque(movs);
igual("custo médio após 2 entradas", e.medio.get("chapa"), 11);
igual("saldo A1", saldoDe(e.saldos, "chapa", "A1"), 95);
igual("saldo A2", saldoDe(e.saldos, "chapa", "A2"), 20);
igual("saldo total", saldoDe(e.saldos, "chapa"), 115);
igual("valor total", e.totalItem.get("chapa")!.valor, 1265);
igual("kardex linhas", e.kardex.length, 5);
igual("kardex saldo após saída", e.kardex[2].saldoQtd, 120);
let erro = "";
try {
  calcularEstoque([...movs, mv("6", "2026-10-06", "saida", 200)]);
} catch (x) {
  erro = (x as Error).message;
}
igual("saldo insuficiente bloqueia", /insuficiente/.test(erro), true);
igual("ordem por data", calcularEstoque([mv("b", "2026-10-02", "saida", 10), mv("a", "2026-10-01", "entrada", 10, 5)]).totalItem.get("chapa")!.qtd, 0);

// --- parcelas e numeração ---
const p = parcelas(1000, "30/60/90", "2026-10-25");
igual("parcelas", p.map((x) => `${x.vencimento}=${x.valor}`).join(" "), "2026-11-24=333.33 2026-12-24=333.33 2027-01-23=333.34");
igual("à vista", parcelas(50, "0", "2026-10-25").map((x) => `${x.vencimento}=${x.valor}`).join(), "2026-10-25=50");
igual("numeração", proximoNumero("PV", ["PV000003", "PC000009", "PVx"]), "PV000004");

// --- MRP ---
const it = (id: string, politica: ItemErp["politica"], bom: ItemErp["bom"] = [], extra: Partial<ItemErp> = {}): ItemErp => ({ id, codigo: id, descricao: id, unidade: "pç", politica, bom, ...extra });
const itens = [
  it("conj", "fabricar", [{ item: "sub", qtd: 2 }, { item: "paraf", qtd: 8 }], { prazo: 5 }),
  it("sub", "fabricar", [{ item: "chapa", qtd: 1.5 }, { item: "paraf", qtd: 4 }], { prazo: 3 }),
  it("chapa", "comprar", [], { prazo: 10, lote: 50 }),
  it("paraf", "comprar", [], { minimo: 100 }),
];
const nv = niveis(itens);
igual("níveis", typeof nv === "string" ? nv : itens.map((i) => nv.get(i.id)).join(","), "0,1,2,2");
const saldos: Record<string, number> = { conj: 1, sub: 2, chapa: 10, paraf: 50 };
const s = mrp(itens, (i) => saldos[i] ?? 0, (i) => (i === "paraf" ? 20 : 0), [{ item: "conj", qtd: 5, data: "2026-12-01" }]);
const txt = typeof s === "string" ? s : s.map((x) => `${x.item}:${x.tipo}:${x.qtd}@${x.inicio}`).join(" ");
// conj: 5-1=4 → sub 8-2=6 → chapa 9-10 → 0 (sem compra); paraf 32+24+100(mín)-70=86
igual("MRP", txt, "conj:fabricar:4@2026-11-26 sub:fabricar:6@2026-11-23 paraf:comprar:86@2026-11-23");
saldos.chapa = 0;
const s2 = mrp(itens, (i) => saldos[i] ?? 0, () => 0, [{ item: "conj", qtd: 5, data: "2026-12-01" }]);
igual("lote mínimo da chapa", typeof s2 === "string" ? s2 : s2.find((x) => x.item === "chapa")?.qtd, 50);
itens[2].bom.push({ item: "conj", qtd: 1 });
igual("ciclo", typeof mrp(itens, () => 0, () => 0, []), "string");

console.log(falhas ? `\nerp: ${falhas} falha(s)` : "\nerp: tudo certo");
if (falhas) process.exit(1);
