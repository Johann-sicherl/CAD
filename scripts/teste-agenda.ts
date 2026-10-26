// Teste do motor de agendamento do WJCronProject (@wj/agenda) em Node.
import {
  calcular, calendarioPadrao, codigosEAP, formatarPredecessoras, iso, lerDataBR, lerDuracao, lerPredecessoras, pascoa,
  type Projeto, type Tarefa,
} from "../src/agenda/agenda";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = typeof esperado === "number" && typeof obtido === "number" ? Math.abs(obtido - esperado) <= 1e-9 : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}

const tarefa = (id: string, dur: number, extra: Partial<Tarefa> = {}): Tarefa => ({ id, nome: id, nivel: 1, dur, pred: [], pct: 0, recursos: [], ...extra });
const fs = (de: string, lat = 0) => ({ de, tipo: "TI" as const, lat, latUn: "d" as const });
const projeto = (tarefas: Tarefa[], extra: Partial<Projeto> = {}): Projeto => ({
  formato: "wjcron", versao: 1, nome: "Teste", inicio: "2026-10-26", calendario: calendarioPadrao(), tarefas, recursos: [], ...extra,
});

// --- calendário ---
igual("Páscoa 2027", iso(pascoa(2027)), "2027-03-28");
igual("Páscoa 2026", iso(pascoa(2026)), "2026-04-05");
igual("data BR", lerDataBR("2/11/2026"), "2026-11-02");
igual("data inválida", lerDataBR("31/02/2026"), null);
igual("duração 2 sem", lerDuracao("2 sem"), 10);
igual("duração 4h", lerDuracao("4h"), 0.5);
igual("duração 1,5", lerDuracao("1,5"), 1.5);

// --- vínculos básicos (26/10/2026 é segunda; 02/11 é Finados) ---
{
  const p = projeto([
    tarefa("A", 5),
    tarefa("B", 3, { pred: [fs("A")] }),
    tarefa("C", 2, { pred: [{ de: "A", tipo: "II", lat: 2, latUn: "d" }] }),
    tarefa("D", 2, { pred: [{ de: "B", tipo: "TT", lat: 0, latUn: "d" }] }),
    tarefa("E", 1, { pred: [{ de: "A", tipo: "TI", lat: -50, latUn: "%" }] }),
    tarefa("M", 0, { marco: true, pred: [fs("B")] }),
  ]);
  const r = calcular(p);
  const c = (id: string) => r.t.get(id)!;
  igual("A início", c("A").inicio, "2026-10-26");
  igual("A término", c("A").termino, "2026-10-30");
  igual("B pula Finados: início", c("B").inicio, "2026-11-03");
  igual("B término", c("B").termino, "2026-11-05");
  igual("C II+2d início", c("C").inicio, "2026-10-28");
  igual("D TT término = B", c("D").termino, "2026-11-05");
  igual("D início", c("D").inicio, "2026-11-04");
  igual("E TI-50% início (2,5 dias)", c("E").inicio, "2026-10-28");
  igual("marco no término de B", c("M").termino, "2026-11-05");
  igual("A crítica", c("A").critica, true);
  igual("B crítica", c("B").critica, true);
  igual("C não crítica", c("C").critica, false);
  igual("C folga total", c("C").folgaTotal, 4);
  igual("C folga livre", c("C").folgaLivre, 4);
  igual("término do projeto", r.termino, "2026-11-05");
  igual("sem erros", r.erros.length, 0);
}

// --- resumo, restrições, ALAP ---
{
  const p = projeto([
    tarefa("F1", 0, { nome: "Fase 1" }),
    tarefa("a", 3, { nivel: 2 }),
    tarefa("b", 4, { nivel: 2, pred: [fs("a")] }),
    tarefa("F2", 0, { nome: "Fase 2", pred: [fs("F1")] }),
    tarefa("c", 2, { nivel: 2 }),
    tarefa("d", 1, { nivel: 2, restricao: "SNET", dataRestricao: "2026-11-16" }),
    tarefa("e", 1, { nivel: 2, restricao: "ALAP" }),
  ]);
  const r = calcular(p);
  const c = (id: string) => r.t.get(id)!;
  igual("EAP", codigosEAP(p.tarefas).join(" "), "1 1.1 1.2 2 2.1 2.2 2.3");
  igual("resumo F1", c("F1").resumo, true);
  igual("F1 início", c("F1").inicio, "2026-10-26");
  igual("F1 término (7 dias úteis com Finados)", c("F1").termino, "2026-11-04");
  igual("F2 depois de F1: c início", c("c").inicio, "2026-11-05");
  igual("d não antes de 16/11", c("d").inicio, "2026-11-16");
  igual("e o mais tarde possível", c("e").inicio, "2026-11-16");
  igual("F2 término", c("F2").termino, "2026-11-16");
}

// --- restrição impossível e ciclo ---
{
  const p = projeto([tarefa("A", 5), tarefa("B", 5, { pred: [fs("A")], restricao: "FNLT", dataRestricao: "2026-11-03" })]);
  const r = calcular(p);
  igual("FNLT gera folga negativa", r.t.get("B")!.conflito, true);
  igual("aviso de restrição", r.erros.length, 1);
  const q = calcular(projeto([tarefa("A", 1, { pred: [fs("B")] }), tarefa("B", 1, { pred: [fs("A")] })]));
  igual("ciclo detectado", /circular/.test(q.erros[0] ?? ""), true);
}

// --- recursos ---
{
  const p = projeto([
    tarefa("A", 2, { recursos: [{ r: "joao", un: 100 }, { r: "aco", un: 10 }] }),
    tarefa("B", 3, { recursos: [{ r: "joao", un: 50 }] }),
  ], {
    recursos: [
      { id: "joao", nome: "João", tipo: "trabalho", max: 100, taxa: 100, custoUso: 0 },
      { id: "aco", nome: "Aço", tipo: "material", max: 0, taxa: 12.5, custoUso: 0, unidade: "kg" },
    ],
  });
  const r = calcular(p);
  igual("trabalho A (2 d × 8 h)", r.t.get("A")!.trabalho, 16);
  igual("custo A (16 h × 100 + 10 kg × 12,5)", r.t.get("A")!.custo, 1725);
  igual("trabalho B (3 d × 8 h × 50%)", r.t.get("B")!.trabalho, 12);
  igual("João superalocado", r.superalocados.has("joao"), true);
  igual("custo do projeto", r.custo, 2925);
}

// --- texto das predecessoras ---
{
  const ids = ["x", "y", "z"];
  const v = lerPredecessoras("1;2II+2d; 3FF-25%", (n) => ids[n - 1]);
  igual("lê predecessoras", JSON.stringify(v), JSON.stringify([
    { de: "x", tipo: "TI", lat: 0, latUn: "d" }, { de: "y", tipo: "II", lat: 2, latUn: "d" }, { de: "z", tipo: "TT", lat: -25, latUn: "%" },
  ]));
  igual("formata predecessoras", formatarPredecessoras(v as never, (id) => ids.indexOf(id) + 1), "1;2II+2d;3TT-25%");
  igual("predecessora inexistente", typeof lerPredecessoras("9", (n) => ids[n - 1]), "string");
}

console.log(falhas ? `\nagenda: ${falhas} falha(s)` : "\nagenda: tudo certo");
if (falhas) process.exit(1);
