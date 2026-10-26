// Teste do motor de fórmulas (@wj/formulas) e da pasta do WJPlan em Node.
import { Calculadora, chave, interpretarEntrada, pastaVazia, type Pasta } from "../src/formulas/pasta";
import { ajustarReferencias, deslocarReferencias } from "../src/formulas/sintaxe";
import { dataParaSerie } from "../src/formulas/conversao";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = typeof esperado === "number" && typeof obtido === "number"
    ? Math.abs(obtido - esperado) <= 1e-9 * Math.max(1, Math.abs(esperado))
    : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}

const p: Pasta = pastaVazia();
p.folhas.push({ nome: "Custos 2026", celulas: {} });
const pos = (a1: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, c - 1] as const;
};
const pôr = (a1: string, e: string, folha = 0) => {
  const [l, c] = pos(a1);
  p.folhas[folha].celulas[chave(l, c)] = { e };
};
// dados
const dados: [string, string][] = [
  ["A1", "Item"], ["B1", "Qtd"], ["C1", "Preço"],
  ["A2", "Parafuso"], ["B2", "10"], ["C2", "0,5"],
  ["A3", "Porca"], ["B3", "20"], ["C3", "0,25"],
  ["A4", "Arruela"], ["B4", "5"], ["C4", "0,1"],
  ["A5", "Chapa"], ["B5", "2"], ["C5", "120"],
];
for (const [a, e] of dados) pôr(a, e);
pôr("A1", "100", 1); // 'Custos 2026'!A1
const calc = new Calculadora(p);
calc.agora = () => new Date(2026, 9, 25, 14, 30);
const f = (formula: string) => calc.avaliarNaFolha("Planilha1", formula);

igual("aritmética e precedência", f("=1+2*3^2"), 19);
igual("menos unário antes da potência", f("=-2^2"), 4);
igual("porcentagem", f("=50%*200"), 100);
igual("vírgula decimal", f("=1,5+2,25"), 3.75);
igual("concatenação", f('="A"&1&VERDADEIRO'), "A1VERDADEIRO");
igual("comparação de texto sem diferenciar maiúsculas", f('="abc"="ABC"'), true);
igual("divisão por zero", f("=1/0"), "#DIV/0!");
igual("função desconhecida", f("=XPTO(1)"), "#NOME?");
igual("SOMA de intervalo", f("=SOMA(B2:B5)"), 37);
igual("SOMARPRODUTO", f("=SOMARPRODUTO(B2:B5;C2:C5)"), 10 * 0.5 + 20 * 0.25 + 5 * 0.1 + 2 * 120);
igual("MÉDIA com acento", f("=MÉDIA(B2:B5)"), 9.25);
igual("MEDIA sem acento e AVERAGE", f("=MEDIA(B2:B5)=AVERAGE(B2:B5)"), true);
igual("MÁXIMO / MÍNIMO", f("=MÁXIMO(B2:B5)-MÍNIMO(B2:B5)"), 18);
igual("CONT.NÚM / CONT.VALORES", f("=CONT.NÚM(A1:C5)*100+CONT.VALORES(A1:C5)"), 8 * 100 + 15);
igual("CONT.SE com operador", f('=CONT.SE(B2:B5;">=10")'), 2);
igual("CONT.SE com curinga", f('=CONT.SE(A2:A5;"P*")'), 2);
igual("SOMASE", f('=SOMASE(A2:A5;"Porca";B2:B5)'), 20);
igual("SOMASES", f('=SOMASES(B2:B5;C2:C5;"<1";B2:B5;">5")'), 30);
igual("PROCV exato", f('=PROCV("Chapa";A2:C5;3;FALSO)'), 120);
igual("PROCV não encontrado", f('=PROCV("Mola";A2:C5;3;0)'), "#N/D");
igual("PROCX", f('=PROCX("Porca";A2:A5;C2:C5)'), 0.25);
igual("PROCX com padrão", f('=PROCX("Mola";A2:A5;C2:C5;"—")'), "—");
igual("ÍNDICE + CORRESP", f('=ÍNDICE(B2:B5;CORRESP("Arruela";A2:A5;0))'), 5);
igual("SE aninhado", f('=SE(B5>5;"muito";SE(B5>1;"pouco";"nada"))'), "pouco");
igual("SEERRO", f('=SEERRO(1/0;"erro")'), "erro");
igual("E / OU / NÃO", f("=E(1;VERDADEIRO)&OU(0;0)&NÃO(0)"), "VERDADEIROFALSOVERDADEIRO");
igual("ARRED meio", f("=ARRED(2,345;2)"), 2.35);
igual("ARRED 1,005 (binário)", f("=ARRED(1,005;2)"), 1.01);
igual("ARREDONDAR.PARA.CIMA", f("=ARREDONDAR.PARA.CIMA(2,341;2)"), 2.35);
igual("RESTO negativo", f("=RESTO(-3;2)"), 1);
igual("texto: ESQUERDA/DIREITA/EXT.TEXTO", f('=ESQUERDA("Parafuso";4)&DIREITA("Parafuso";4)&EXT.TEXTO("Parafuso";3;2)'), "ParafusoAf".replace("Af", "ra"));
igual("NÚM.CARACT e MAIÚSCULA", f('=NÚM.CARACT("ação")&MAIÚSCULA("ação")'), "4AÇÃO");
igual("SUBSTITUIR", f('=SUBSTITUIR("a-b-c";"-";"/")'), "a/b/c");
igual("LOCALIZAR com curinga", f('=LOCALIZAR("f*o";"Parafuso")'), 5);
igual("TEXTO número", f('=TEXTO(1234,5;"#.##0,00")'), "1.234,50");
igual("TEXTO porcentagem", f('=TEXTO(0,125;"0,0%")'), "12,5%");
igual("DATA e TEXTO de data", f('=TEXTO(DATA(2026;12;25);"dd/mm/aaaa")'), "25/12/2026");
igual("HOJE", f("=HOJE()"), dataParaSerie(2026, 10, 25));
igual("DIATRABALHOTOTAL (out/2026)", f("=DIATRABALHOTOTAL(DATA(2026;10;1);DATA(2026;10;31))"), 22);
igual("DIATRABALHO", f("=TEXTO(DIATRABALHO(DATA(2026;10;23);1);\"dd/mm\")"), "26/10");
igual("FIMMÊS", f('=DIA(FIMMÊS(DATA(2028;2;10);0))'), 29);
igual("referência a outra folha com espaço", f("='Custos 2026'!A1*2"), 200);
igual("CONVERTER mm → pol", f('=CONVERTER(25,4;"mm";"in")'), 1);
igual("CONVERTER MPa → psi", f('=ARRED(CONVERTER(1;"MPa";"psi");2)'), 145.04);
igual("CONVERTER °C → °F", f('=CONVERTER(100;"C";"F")'), 212);
igual("PGTO (financiamento 12x 1% a.m.)", f("=ARRED(PGTO(1%;12;-10000);2)"), 888.49);
igual("VPL (fluxos no fim de cada período)", f("=ARRED(VPL(10%;-1000;500;700);2)"), 30.05);
pôr("G1", "-1000"); pôr("G2", "500"); pôr("G3", "700");
calc.invalidar();
igual("TIR", f("=ARRED(TIR(G1:G3);4)"), 0.1232);
igual("DESVPAD.A", f("=ARRED(DESVPAD.A(2;4;4;4;5;5;7;9);4)"), 2.1381);
igual("coluna inteira", f("=SOMA(B:B)"), 37);

// fórmulas em células e dependências
pôr("D2", "=B2*C2");
pôr("D6", "=SOMA(D2:D5)");
pôr("D3", "=B3*C3"); pôr("D4", "=B4*C4"); pôr("D5", "=B5*C5");
calc.invalidar();
igual("cadeia de fórmulas", calc.valor("Planilha1", 5, 3), 250.5);
pôr("B5", "3");
calc.invalidar();
igual("recálculo após mudar B5", calc.valor("Planilha1", 5, 3), 370.5);
pôr("E1", "=E2"); pôr("E2", "=E1+1");
calc.invalidar();
igual("referência circular", calc.valor("Planilha1", 0, 4), "#CICLO!");
pôr("E3", "=Z99");
calc.invalidar();
igual("fórmula apontando para vazio vale 0", calc.valor("Planilha1", 2, 4), 0);
p.nomes = { Imposto: "=0,18" };
igual("nome definido", f("=100*Imposto"), 18);

// entradas
igual("entrada número BR", interpretarEntrada("1.234,5").valor, 1234.5);
igual("entrada porcentagem", interpretarEntrada("12%").valor, 0.12);
igual("entrada data", interpretarEntrada("25/12/2026").valor, dataParaSerie(2026, 12, 25));
igual("entrada moeda", interpretarEntrada("R$ 10,50").formato, "moeda");
igual("entrada texto forçado", interpretarEntrada("'0123").valor, "0123");

// copiar/colar com referências relativas
igual("deslocar relativas", deslocarReferencias("=A1+$B$2+C$3+$D4", 2, 1), "=B3+$B$2+D$3+$D6");
igual("deslocar para fora vira #REF!", deslocarReferencias("=A1", -1, 0), "=#REF!");
igual("deslocar com folha", deslocarReferencias("='Custos 2026'!A1:B2", 1, 0), "='Custos 2026'!A2:B3");
igual("deslocar colunas inteiras", deslocarReferencias("=SOMA(B:B)", 5, 1), "=SOMA(C:C)");

// inserir/excluir linhas e colunas
igual("inserir 2 linhas na 3", ajustarReferencias("=A1+A3+$A$5+SOMA(A2:A6)", "P", "P", "lin", 2, 2), "=A1+A5+$A$7+SOMA(A2:A8)");
igual("excluir a linha 3", ajustarReferencias("=A1+A3+A5+SOMA(A2:A6)", "P", "P", "lin", 2, -1), "=A1+#REF!+A4+SOMA(A2:A5)");
igual("inserir coluna B", ajustarReferencias("=A1+B1+C1", "P", "P", "col", 1, 1), "=A1+C1+D1");
igual("outra folha não muda", ajustarReferencias("=Q!A3+A3", "P", "Q", "lin", 0, 1), "=Q!A4+A3");

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`);
  process.exit(1);
}
console.log("\nfórmulas: tudo certo");
