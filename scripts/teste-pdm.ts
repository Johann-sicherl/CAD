// Teste das regras do cofre do WJPDM em Node.
import {
  aplicarTransicao, bloqueioDaTransicao, bloqueioDoCheckout, copiaDoFluxo, estadoDe, explodirBOM, FLUXO_PADRAO, fluxoAtual, nomeLivre, ondeEUsado,
  proximaRevisao, proximaRevisaoNoEsquema, proximoCodigo, transicoesDe, trocarReferencias, usarFluxo, validarFluxo, type Arquivo, type Item,
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

// revisão por fase (esquema com prefixo)
igual("protótipo começa em P1", proximaRevisaoNoEsquema("", "P1"), "P1");
igual("P1 → P2", proximaRevisaoNoEsquema("P1", "P1"), "P2");
igual("P9 → P10", proximaRevisaoNoEsquema("P9", "P1"), "P10");
igual("pré-série recomeça em 01", proximaRevisaoNoEsquema("P3", "01"), "01");
igual("01 → 02", proximaRevisaoNoEsquema("01", "01"), "02");
igual("série recomeça em A", proximaRevisaoNoEsquema("07", "A"), "A");
igual("A → B na série", proximaRevisaoNoEsquema("A", "A"), "B");
igual("prefixo longo PS-01 → PS-02", proximaRevisaoNoEsquema("PS-01", "PS-01"), "PS-02");
igual("sem esquema: A, B…", proximaRevisaoNoEsquema("B"), "C");

// fluxo de fábrica: Protótipo → Pré-série → Série (desenvolvimento, produção, revisão)
const t = (id: string) => fluxoAtual().transicoes.find((x) => x.id === id)!;
igual("9 estados + obsoleto", FLUXO_PADRAO.estados.length, 10);
igual("fluxo de fábrica válido", validarFluxo(FLUXO_PADRAO).join(" "), "");
const a: Arquivo = {
  id: "1", nome: "suporte.wjcad", pasta: "r", revisao: "", estado: "trabalho", cartao: {}, historico: [],
  versoes: [{ n: 1, blob: "b1", tamanho: 10, autor: "Johann", data: "2026-10-25T10:00:00", comentario: "", revisao: "", estado: "trabalho" }],
};
igual("estado inicial", estadoDe(a.estado).nome, "Protótipo em desenvolvimento");
igual("enviar exige código e descrição", /Código, Descrição/.test(bloqueioDaTransicao(a, t("enviar")) ?? ""), true);
a.cartao = { codigo: "12-0001", descricao: "Suporte do motor" };
a.checkout = { usuario: "Ana", data: "2026-10-25T09:00:00" };
igual("check-out de outro bloqueia transição", /Ana/.test(bloqueioDaTransicao(a, t("enviar")) ?? ""), true);
igual("check-out de outro bloqueia check-out", /Ana/.test(bloqueioDoCheckout(a, "Johann") ?? ""), true);
delete a.checkout;
igual("pode enviar", bloqueioDaTransicao(a, t("enviar")), null);
aplicarTransicao(a, t("enviar"), "Johann", "2026-10-25T11:00:00");
igual("em revisão trava o GO-OUT", bloqueioDoCheckout(a, "Johann") !== null, true);
aplicarTransicao(a, t("aprovar"), "Ana", "2026-10-25T12:00:00");
igual("protótipo em produção na P1", `${estadoDe(a.estado).nome} ${a.revisao} ${a.versoes[0].revisao}`, "Protótipo em produção P1 P1");
igual("em produção trava o GO-OUT", bloqueioDoCheckout(a, "Johann") !== null, true);
igual("não pode aprovar de novo", bloqueioDaTransicao(a, t("aprovar")) !== null, true);
igual("saídas da produção", transicoesDe(a).map((x) => x.t.id).join(","), "revisar,avancar,obsoleto");
aplicarTransicao(a, t("revisar"), "Johann", "2026-10-26T08:00:00", "furo fora de posição");
aplicarTransicao(a, t("rejeitar"), "Johann", "2026-10-26T08:10:00");
igual("devolvido ao desenvolvimento, revisão mantida", `${a.estado} ${a.revisao}`, "trabalho P1");
igual("pode fazer GO-OUT", bloqueioDoCheckout(a, "Johann"), null);
aplicarTransicao(a, t("enviar"), "Johann", "2026-10-26T09:00:00");
aplicarTransicao(a, t("aprovar"), "Ana", "2026-10-26T10:00:00");
igual("segunda aprovação: P2", a.revisao, "P2");
aplicarTransicao(a, t("avancar"), "Johann", "2026-10-27T08:00:00");
igual("avançou para pré-série em desenvolvimento", estadoDe(a.estado).nome, "Pré-série em desenvolvimento");
aplicarTransicao(a, t("pre-enviar"), "Johann", "2026-10-27T09:00:00");
aplicarTransicao(a, t("pre-aprovar"), "Ana", "2026-10-27T10:00:00");
igual("pré-série recomeça a revisão em 01", a.revisao, "01");
aplicarTransicao(a, t("pre-avancar"), "Johann", "2026-10-28T08:00:00");
aplicarTransicao(a, t("serie-enviar"), "Johann", "2026-10-28T09:00:00");
aplicarTransicao(a, t("serie-aprovar"), "Ana", "2026-10-28T10:00:00");
igual("série em produção na revisão A", `${estadoDe(a.estado).nome} ${a.revisao}`, "Série em produção A");
igual("histórico (12 transições)", a.historico.length, 12);

// fluxo editado: estado novo, transição nova; validação
const f = copiaDoFluxo(FLUXO_PADRAO);
f.estados.push({ id: "homologacao", nome: "Em homologação", cor: "#884ea0", bloqueado: true });
f.transicoes.push({ id: "homologar", nome: "Homologar no cliente", de: ["serie-prod"], para: "homologacao" });
usarFluxo(f);
igual("transição criada aparece", transicoesDe(a).some((x) => x.t.id === "homologar"), true);
aplicarTransicao(a, t("homologar"), "Johann", "2026-10-29T08:00:00");
igual("estado criado", estadoDe(a.estado).nome, "Em homologação");
const sem = copiaDoFluxo(f);
sem.estados = sem.estados.filter((e) => e.id !== "homologacao");
igual("não remove estado em uso", /homologacao/.test(validarFluxo(sem, [a.estado]).join(" ")), true);
igual("transição para estado inexistente é erro", validarFluxo(sem).length > 0, true);
usarFluxo(sem);
igual("fluxo inválido: volta ao de fábrica", fluxoAtual() === FLUXO_PADRAO, true);
usarFluxo(null);

// tabela de referências: troca as do pai, soma repetidas, iguais não regravam
{
  const r1 = trocarReferencias([], "M", [{ filho: "A", tipo: "componente", quantidade: 1 }, { filho: "A", tipo: "componente", quantidade: 1 }, { filho: "B", tipo: "componente", quantidade: 4 }], "t1");
  igual("soma instâncias da mesma peça", r1.gravar.map((x) => `${x.filho}×${x.quantidade}`).join(" "), "A×2 B×4");
  const r2 = trocarReferencias(r1.gravar, "M", [{ filho: "A", tipo: "componente", quantidade: 2 }, { filho: "C", tipo: "componente", quantidade: 1 }], "t2");
  igual("mantém iguais, grava novas, tira as que saíram", `${r2.gravar.map((x) => x.filho).join(",")} | ${r2.sair.join(",")}`, "C | M>B>");
}

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
