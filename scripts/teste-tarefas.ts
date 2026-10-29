// Teste das regras do WJTaskPlan em Node: árvore de pastas (mover, ciclos, excluir), estados com
// histórico datado, tempo de atendimento, painel, alertas de prazo e mescla das cópias.
import {
  alertas, baseNova, caminhoPasta, concluidaEm, criarPasta, criarTarefa, descendentes, diasEntre, duracao, excluirEstado, excluirPasta, excluirTarefa,
  filhas, mesclar, moverPasta, mudarEstado, painel, tabelaCSV, validarBase, type Base,
} from "../src/tarefas/regras";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = typeof esperado === "number" && typeof obtido === "number" ? Math.abs(obtido - esperado) < 1e-6 : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}
const T = (d: number, h = 0) => new Date(Date.UTC(2026, 9, d, h)).toISOString();

// --- pastas ---
const b = baseNova();
const obra = criarPasta(b, "Obra", null, T(1));
const projeto = criarPasta(b, "Projeto", obra.id, T(1));
const detalhe = criarPasta(b, "Detalhamento", projeto.id, T(1));
igual("raiz: Geral, Obra", filhas(b, null).map((p) => p.nome).join(), "Geral,Obra");
igual("caminho", caminhoPasta(b, detalhe.id), "Obra / Projeto / Detalhamento");
igual("descendentes de Obra", descendentes(b, obra.id).size, 3);
igual("não move para dentro de uma subpasta", moverPasta(b, obra.id, detalhe.id, 0, T(2)), false);
igual("move Detalhamento para a raiz, no topo", moverPasta(b, detalhe.id, null, 0, T(2)), true);
igual("ordem na raiz", filhas(b, null).map((p) => p.nome).join(), "Detalhamento,Geral,Obra");
moverPasta(b, detalhe.id, null, 9, T(2));
igual("move para o fim", filhas(b, null).map((p) => p.nome).join(), "Geral,Obra,Detalhamento");
moverPasta(b, detalhe.id, obra.id, 0, T(2));
igual("dentro de Obra, antes de Projeto", filhas(b, obra.id).map((p) => p.nome).join(), "Detalhamento,Projeto");

// --- tarefas e estados ---
const t1 = criarTarefa(b, projeto.id, "  Revisar desenho da base ", "2026-10-10", T(3, 8));
igual("título aparado", t1.titulo, "Revisar desenho da base");
igual("estado inicial", t1.estado, "novo");
igual("histórico com a criação", t1.historico.length, 1);
mudarEstado(t1, "execucao", T(4, 8));
mudarEstado(t1, "execucao", T(4, 9));
igual("mesmo estado não repete", t1.historico.length, 2);
mudarEstado(t1, "concluido", T(5, 20));
igual("concluída em", concluidaEm(b, t1), T(5, 20));
igual("duração", duracao(Date.parse(T(5, 20)) - Date.parse(T(3, 8))), "2 d 12 h");
b.estados.push({ id: "aprovado", nome: "Aprovado", cor: "#000", tipo: "fim", ordem: 3, atualizado: T(1) });
mudarEstado(t1, "aprovado", T(6));
igual("fim → fim não reinicia a conclusão", concluidaEm(b, t1), T(5, 20));
const t2 = criarTarefa(b, obra.id, "Comprar chapa", "2026-10-07", T(3));
const t3 = criarTarefa(b, "geral", "Sem prazo", null, T(3));
const t4 = criarTarefa(b, detalhe.id, "Atrasada", "2026-10-02", T(1));
mudarEstado(t4, "execucao", T(2));

// --- alertas e painel ---
igual("dias entre", diasEntre("2026-10-05", "2026-10-07"), 2);
igual("alertas com 2 dias", alertas(b, "2026-10-05", 2).map((a) => `${a.tarefa.titulo}:${a.dias}`).join(), "Atrasada:-3,Comprar chapa:2");
igual("alertas com 1 dia", alertas(b, "2026-10-05", 1).map((a) => a.tarefa.titulo).join(), "Atrasada");
igual("concluída não alerta", alertas(b, "2026-10-20", 0).some((a) => a.tarefa.id === t1.id), false);
const pn = painel(b, b.tarefas, new Date(T(7)));
igual("total", pn.total, 4);
igual("por estado novo", pn.porEstado.novo, 2);
igual("por estado execução", pn.porEstado.execucao, 1);
igual("por tipo fim", pn.porTipo.fim, 1);
igual("atrasadas no dia 7", pn.atrasadas, 1);
igual("atendimento médio", pn.atendimento!.media, Date.parse(T(5, 20)) - Date.parse(T(3, 8)));
igual("execução média", pn.execucao!.media, Date.parse(T(5, 20)) - Date.parse(T(4, 8)));
igual("concluídas em 7 dias", pn.concluidas7, 1);
igual("csv tem cabeçalho e 4 linhas", tabelaCSV(b).trim().split("\r\n").length, 5);
void t3;

// --- excluir estado e pasta ---
igual("não exclui o único início", excluirEstado(b, "novo", "execucao", T(8)), false);
igual("exclui estado e passa as tarefas", excluirEstado(b, "execucao", "novo", T(8)), true);
igual("tarefa voltou para novo", t4.estado, "novo");
const r = excluirPasta(b, obra.id, T(9));
igual("excluir Obra leva subpastas e tarefas", `${r.pastas}/${r.tarefas}`, "3/3");
igual("sobrou Geral", b.pastas.map((p) => p.nome).join(), "Geral");

// --- mescla das cópias ---
const a: Base = baseNova();
const p1 = criarPasta(a, "Casa", null, T(1));
const x = criarTarefa(a, p1.id, "Pintar", null, T(1));
const c: Base = validarBase(JSON.parse(JSON.stringify(a)));
// aparelho A muda o título depois; cópia C muda o estado antes → vale a de A (mais recente)
mudarEstado(c.tarefas[0], "execucao", T(2));
x.titulo = "Pintar a sala";
x.atualizado = T(3);
const y = criarTarefa(c, p1.id, "Lixar", null, T(2));
let m = mesclar([a, c], T(4));
igual("une tarefas novas das duas", m.tarefas.length, 2);
igual("mais recente vence", m.tarefas.find((t) => t.id === x.id)!.titulo, "Pintar a sala");
// exclusão em C depois da última alteração some com a tarefa nas duas
excluirTarefa(c, y.id, T(5));
m = mesclar([a, c, m], T(6));
igual("exclusão propaga", m.tarefas.some((t) => t.id === y.id), false);
// alteração posterior à exclusão traz de volta
const yv = { ...y, titulo: "Lixar (de novo)", atualizado: T(7) };
m = mesclar([{ ...a, tarefas: [...a.tarefas, yv] }, m], T(8));
igual("alterada depois da exclusão volta", m.tarefas.some((t) => t.id === y.id), true);
// exclusões vencidas (30 dias) são esquecidas
igual("exclusão antiga esquecida", mesclar([c], "2026-12-30T00:00:00.000Z").exclusoes.length, 0);
// pasta excluída em outra cópia: tarefas vão para a primeira pasta da raiz
const d = validarBase(JSON.parse(JSON.stringify(m)));
excluirPasta(d, p1.id, T(9));
const semPasta = { ...m, tarefas: [...m.tarefas, { ...x, id: "nova", atualizado: T(10) }] };
m = mesclar([semPasta, d], T(11));
igual("tarefa órfã vai para a raiz", m.tarefas.find((t) => t.id === "nova")!.pasta, "geral");
// movimentos cruzados (A dentro de B num aparelho, B dentro de A no outro) não criam ciclo
const e1 = baseNova();
const pa = criarPasta(e1, "A", null, T(1)), pb = criarPasta(e1, "B", null, T(1));
const e2 = validarBase(JSON.parse(JSON.stringify(e1)));
moverPasta(e1, pa.id, pb.id, 0, T(2));
moverPasta(e2, pb.id, pa.id, 0, T(3));
m = mesclar([e1, e2], T(4));
const semCiclo = m.pastas.every((p) => {
  const vistos = new Set<string>();
  for (let q: typeof p | undefined = p; q; q = m.pastas.find((z) => z.id === q!.pai)) {
    if (vistos.has(q.id)) return false;
    vistos.add(q.id);
  }
  return true;
});
igual("sem ciclo após movimentos cruzados", semCiclo, true);
igual("mescla não altera as entradas", e1.pastas.find((p) => p.id === pa.id)!.pai, pb.id);
let erro = "";
try {
  validarBase({ formato: "outro" });
} catch (z) {
  erro = (z as Error).message;
}
igual("arquivo inválido recusado", /inválido/.test(erro), true);

if (falhas) {
  console.error(`\n${falhas} falha(s) nas regras do WJTaskPlan`);
  process.exit(1);
}
console.log("\nWJTaskPlan: regras ok");
