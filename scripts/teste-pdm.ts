// Teste das regras do cofre do WJPDM em Node.
import {
  aplicarTransicao, bloqueioDaTransicao, bloqueioDoCheckout, explodirBOM, nomeLivre, ondeEUsado, proximaRevisao, proximoCodigo, TRANSICOES,
  type Arquivo, type Item,
} from "../src/pdm/regras";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}

igual("revisão inicial", proximaRevisao(""), "A");
igual("A → B", proximaRevisao("A"), "B");
igual("Z → AA", proximaRevisao("Z"), "AA");
igual("AZ → BA", proximaRevisao("AZ"), "BA");
igual("ZZ → AAA", proximaRevisao("ZZ"), "AAA");
igual("numérica 09 → 10", proximaRevisao("09"), "10");
igual("código pela máscara", proximoCodigo("12-####", ["12-0001", "12-0006", "13-0099", "12-abc"]), "12-0007");
igual("primeiro código", proximoCodigo("PR-###-A", []), "PR-001-A");
igual("nome livre", nomeLivre("suporte.wjcad", ["Suporte.wjcad", "suporte (2).wjcad"]), "suporte (3).wjcad");

const t = (id: string) => TRANSICOES.find((x) => x.id === id)!;
const a: Arquivo = {
  id: "1", nome: "suporte.wjcad", pasta: "r", revisao: "", estado: "trabalho", cartao: {}, historico: [],
  versoes: [{ n: 1, blob: "b1", tamanho: 10, autor: "Johann", data: "2026-10-25T10:00:00", comentario: "", revisao: "", estado: "trabalho" }],
};
igual("enviar exige código e descrição", /Código, Descrição/.test(bloqueioDaTransicao(a, t("enviar")) ?? ""), true);
a.cartao = { codigo: "12-0001", descricao: "Suporte do motor" };
a.checkout = { usuario: "Ana", data: "2026-10-25T09:00:00" };
igual("check-out de outro bloqueia transição", /Ana/.test(bloqueioDaTransicao(a, t("enviar")) ?? ""), true);
igual("check-out de outro bloqueia check-out", /Ana/.test(bloqueioDoCheckout(a, "Johann") ?? ""), true);
delete a.checkout;
igual("pode enviar", bloqueioDaTransicao(a, t("enviar")), null);
aplicarTransicao(a, t("enviar"), "Johann", "2026-10-25T11:00:00");
igual("em revisão bloqueia check-out", bloqueioDoCheckout(a, "Johann") !== null, true);
aplicarTransicao(a, t("aprovar"), "Ana", "2026-10-25T12:00:00");
igual("liberado na revisão A", `${a.estado} ${a.revisao} ${a.versoes[0].revisao}`, "liberado A A");
igual("liberado bloqueia check-out", /nova revisão/.test(bloqueioDoCheckout(a, "Johann") ?? ""), true);
igual("não pode aprovar de novo", bloqueioDaTransicao(a, t("aprovar")) !== null, true);
aplicarTransicao(a, t("alterar"), "Johann", "2026-10-26T08:00:00");
igual("nova revisão volta a trabalho", `${a.estado} ${a.revisao}`, "trabalho A");
igual("pode fazer check-out", bloqueioDoCheckout(a, "Johann"), null);
aplicarTransicao(a, t("enviar"), "Johann", "2026-10-26T09:00:00");
aplicarTransicao(a, t("aprovar"), "Ana", "2026-10-26T10:00:00");
igual("segunda liberação: revisão B", a.revisao, "B");
igual("histórico", a.historico.length, 5);

// lista de materiais
const it = (id: string, codigo: string, bom: Item["bom"] = []): Item => ({ id, codigo, descricao: codigo, tipo: "fabricado", unidade: "pç", bom });
const itens = [
  it("conj", "10-0001", [{ item: "sub", qtd: 2 }, { item: "paraf", qtd: 4 }]),
  it("sub", "11-0001", [{ item: "chapa", qtd: 1 }, { item: "paraf", qtd: 2 }]),
  it("chapa", "12-0001"),
  it("paraf", "90-0001"),
];
const ex = explodirBOM(itens, "conj");
igual("explosão", Array.isArray(ex) ? ex.map((l) => `${l.nivel}:${l.item.codigo}×${l.total}`).join(" ") : ex, "1:11-0001×2 2:12-0001×2 2:90-0001×4 1:90-0001×4");
igual("onde é usado", ondeEUsado(itens, "paraf").map((x) => `${x.nivel}:${x.item.codigo}`).join(" "), "1:10-0001 1:11-0001");
itens[2].bom.push({ item: "conj", qtd: 1 });
igual("ciclo na lista", typeof explodirBOM(itens, "conj"), "string");

console.log(falhas ? `\npdm: ${falhas} falha(s)` : "\npdm: tudo certo");
if (falhas) process.exit(1);
