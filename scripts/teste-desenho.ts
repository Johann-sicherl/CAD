// Teste do Desenho: projeção das vistas no kernel (src/kernel/projecao.ts) — medidas de cada
// vista, linhas ocultas, círculos vistos de frente, montagem (sólidos posicionados) — e o modelo
// do desenho (src/desenho/modelo.ts): formatos ABNT, posição das vistas no 1º/3º diedro, escala.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { documentoExemplo } from "../src/model";
import { regenerar, pecaAtual } from "../src/kernel/regenerar";
import { posicionar, projetar } from "../src/kernel/projecao";
import {
  afastarDaMae, areaUtil, cameraProjetada, escalaQueCabe, CAMERAS, desenhoVazio, excluirVistas, ladoDoPonto, layoutTresVistas, lerEscala, moverVista, orientacaoDe,
  posicaoProjetada, preencherPropriedades, retanguloLegenda, rotuloEscala, validarDesenho, caixaNaFolha, type VistaDesenho,
} from "../src/desenho/modelo";

const require = createRequire(import.meta.url);
const OC = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") });
setOC(OC as never);

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const dims = (c: { x0: number; y0: number; x1: number; y1: number }) => [r1(c.x1 - c.x0), r1(c.y1 - c.y0)];

// peça exemplo: base 80×50×12 (plano Superior), ressalto Ø30×18, furo Ø14 passante
regenerar(documentoExemplo().features);
const peca = pecaAtual()!;
const fr = projetar([peca], "frontal");
igual("frontal: 80 de largura, 30 de altura", dims(fr.caixa), [80, 30]);
igual("frontal: o furo aparece em linhas ocultas", fr.ocultas.length > 0, true);
const sup = projetar([peca], "superior");
igual("superior: 80 × 50", dims(sup.caixa), [80, 50]);
igual("superior: círculos do ressalto e do furo vistos de frente", sup.circulos.map((c) => r1(c.r)).sort((a, b) => a - b), [7, 15]);
const esq = projetar([peca], "esquerda");
igual("lateral esquerda: 50 × 30", dims(esq.caixa), [50, 30]);
const iso = projetar([peca], "iso");
igual("isométrica tem linhas", iso.visiveis.length > 10, true);
{
  // sem emenda do cilindro: nenhuma linha vertical visível no meio do ressalto na lateral
  const meio = (esq.caixa.x0 + esq.caixa.x1) / 2;
  const noMeio = (ls: [number, number][][]) => ls.filter((l) => l.length === 2 && Math.abs(l[0][0] - l[1][0]) < 1e-6 && Math.abs(l[0][0] - meio) < 3).length;
  igual("lateral: sem as linhas de emenda dos cilindros (visíveis e ocultas)", [noMeio(esq.visiveis), noMeio(esq.ocultas)], [0, 0]);
  igual("lateral: o furo continua em linhas ocultas (x = ±7)", esq.ocultas.filter((l) => l.length === 2 && Math.abs(Math.abs(l[0][0] - meio) - 7) < 1e-6).length, 2);
  igual("frontal: o furo continua em linhas ocultas (x = ±7)", fr.ocultas.filter((l) => l.length === 2 && Math.abs(Math.abs(l[0][0]) - 7) < 1e-6 && Math.abs(l[0][0] - l[1][0]) < 1e-6).length >= 2, true);
}
// orientação: na frontal o ressalto fica em cima (y maior) e centrado em x
const topoFr = Math.max(...fr.visiveis.flat().map((p) => p[1]));
igual("frontal: Y do modelo para cima (topo do ressalto em y = 30)", r1(topoFr), 30);

// montagem: duas cópias posicionadas (a segunda girada 90° em Y e deslocada 100 em X)
{
  const q = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] as [number, number, number, number];
  const a = posicionar(peca, { pos: [0, 0, 0], rot: [0, 0, 0, 1] });
  const b = posicionar(peca, { pos: [100, 0, 0], rot: q });
  const m = projetar([a, b], "frontal");
  igual("montagem frontal: largura vai de −40 a 125 (2ª girada: 50 de largura)", [r1(m.caixa.x0), r1(m.caixa.x1)], [-40, 125]);
  const s2 = projetar([a, b], "superior");
  igual("montagem superior: profundidade da 2ª girada = 80", r1(s2.caixa.y1 - s2.caixa.y0), 80);
  igual("o sólido guardado não é consumido", r1(projetar([peca], "frontal").caixa.x1), 40);
}

{
  // vista de seção: corte no plano Z = 0 visto de frente; a região cortada é base + ressalto − furo
  const sec = projetar([peca], "frontal", 0.2, { p: [0, 0, 0], n: [0, 0, 1] });
  const area = (l: [number, number][]) => Math.abs(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const total = (sec.cortes ?? []).reduce((s, c) => s + c.lacos.map(area).reduce((a, b) => a + b, 0), 0);
  igual("seção A-A: área cortada = 80×12 + 30×18 − 14×30 = 1080", Math.round(total), 1080);
  igual("seção: metade de trás com a mesma silhueta frontal", dims(sec.caixa), [80, 30]);
  igual("seção: duas regiões cortadas (o furo divide o meio)", sec.cortes?.length, 2);
  igual("o sólido guardado continua inteiro depois da seção", r1(projetar([peca], "superior").caixa.y1 - projetar([peca], "superior").caixa.y0), 50);
  let erro = "";
  try { projetar([peca], "frontal", 0.2, { p: [0, 0, 500], n: [0, 0, -1] }); } catch (e) { erro = (e as Error).message; }
  igual("plano fora do modelo: mensagem clara", erro, "O plano de corte não passa pelo modelo.");
}

// ---------- modelo do desenho ----------
igual("1º diedro: à direita da frontal fica a lateral esquerda", orientacaoDe(cameraProjetada(CAMERAS.frontal, "direita", 1)), "esquerda");
igual("1º diedro: abaixo da frontal fica a superior", orientacaoDe(cameraProjetada(CAMERAS.frontal, "abaixo", 1)), "superior");
igual("1º diedro: acima fica a inferior", orientacaoDe(cameraProjetada(CAMERAS.frontal, "acima", 1)), "inferior");
igual("3º diedro: à direita fica a lateral direita", orientacaoDe(cameraProjetada(CAMERAS.frontal, "direita", 3)), "direita");
igual("3º diedro: acima fica a superior", orientacaoDe(cameraProjetada(CAMERAS.frontal, "acima", 3)), "superior");
igual("projetada da projetada: à direita da lateral esquerda (1º) fica a posterior", orientacaoDe(cameraProjetada(CAMERAS.esquerda, "direita", 1)), "posterior");
{
  const c = cameraProjetada(CAMERAS.frontal, "diagonal", 1, { dx: 1, dy: 1 });
  const o = c.olho.map((v) => Math.round(v * 1000) / 1000);
  igual("diagonal = isométrica (olha de (1, 1, 1))", o, [0.577, 0.577, 0.577]);
}
igual("lado do ponto: à direita da caixa", ladoDoPonto({ x0: 0, y0: 0, x1: 10, y1: 10 }, 30, 5), "direita");
igual("lado do ponto: abaixo", ladoDoPonto({ x0: 0, y0: 0, x1: 10, y1: 10 }, 5, -20), "abaixo");
igual("lado do ponto: diagonal", ladoDoPonto({ x0: 0, y0: 0, x1: 10, y1: 10 }, 30, -20), "diagonal");
igual("escalas: rótulos", [rotuloEscala(1), rotuloEscala(0.5), rotuloEscala(2), rotuloEscala(0.04)], ["1:1", "1:2", "2:1", "1:25"]);
igual("escalas: leitura", [lerEscala("1:5"), lerEscala("2:1"), lerEscala("0,5"), lerEscala("x")], [0.2, 2, 0.5, null]);
igual("legenda A3: 175 × 44 no canto inferior direito", (() => { const r = retanguloLegenda("A3"); return [r.x1 - r.x0, r.y1 - r.y0, r.x1, r.y0]; })(), [175, 44, 413, 7]);
igual("legenda A4 retrato: largura útil (178)", (() => { const r = retanguloLegenda("A4R"); return r.x1 - r.x0; })(), 178);
{
  // três vistas da peça exemplo no A3, 1º diedro: escala normalizada, alinhamentos e sem invadir a legenda
  const area = areaUtil("A3");
  const lat = projetar([peca], cameraProjetada(CAMERAS.frontal, "direita", 1));
  igual("a lateral calculada pela câmera projetada mede como a esquerda", dims(lat.caixa), [50, 30]);
  const L = layoutTresVistas({ frontal: fr.caixa, superior: sup.caixa, lateral: lat.caixa }, area, 1);
  igual("três vistas: escala 2:1 cabe no A3 (80+50 de largura, 30+50 de altura)", L.escala, 2);
  igual("três vistas: superior alinhada em x com a frontal", L.superior[0], L.frontal[0]);
  igual("três vistas: lateral alinhada em y com a frontal", L.lateral[1], L.frontal[1]);
  const vF = { x: L.frontal[0], y: L.frontal[1] } as VistaDesenho, vS = { x: L.superior[0], y: L.superior[1] } as VistaDesenho, vL = { x: L.lateral[0], y: L.lateral[1] } as VistaDesenho;
  const cF = caixaNaFolha(vF, 2, fr.caixa), cS = caixaNaFolha(vS, 2, sup.caixa), cL = caixaNaFolha(vL, 2, lat.caixa);
  igual("1º diedro: superior abaixo da frontal, lateral à direita", [cS.y1 < cF.y0, cL.x0 > cF.x1], [true, true]);
  igual("três vistas dentro da área útil", [cF, cS, cL].every((c) => c.x0 >= area.x0 && c.x1 <= area.x1 && c.y0 >= area.y0 && c.y1 <= area.y1), true);
  const L3 = layoutTresVistas({ frontal: fr.caixa, superior: sup.caixa, lateral: lat.caixa }, area, 3);
  const cF3 = caixaNaFolha({ x: L3.frontal[0], y: L3.frontal[1] } as VistaDesenho, 2, fr.caixa), cS3 = caixaNaFolha({ x: L3.superior[0], y: L3.superior[1] } as VistaDesenho, 2, sup.caixa);
  igual("3º diedro: superior acima da frontal", cS3.y0 > cF3.y1, true);
  const pp = posicaoProjetada(vF, cF, lat.caixa, 2, "direita");
  igual("vista projetada à direita: mesma altura da mãe e 20 mm afastada", [pp[1] === vF.y, r1(pp[0] + lat.caixa.x0 * 2 - cF.x1)], [true, 20]);
}
{
  // documento: mover em cascata, excluir solta as filhas, validar ida e volta
  const d = desenhoVazio("D");
  d.modelos.push({ id: "m", nome: "P", tipo: "peca", doc: documentoExemplo() });
  const f = d.folhas[0];
  const v = (id: string, x: number, y: number, mae?: string, lado?: VistaDesenho["lado"]): VistaDesenho => ({ id, nome: id, modelo: "m", camera: CAMERAS.frontal, x, y, estilo: "ocultas", ...(mae ? { mae, lado } : {}) });
  f.vistas.push(v("F", 100, 200), v("S", 100, 100, "F", "abaixo"), v("L", 250, 200, "F", "direita"));
  moverVista(f, "F", 120, 210);
  igual("mover a mãe leva a de baixo em x e a do lado em y", [f.vistas[1].x, f.vistas[1].y, f.vistas[2].x, f.vistas[2].y], [120, 100, 250, 210]);
  moverVista(f, "S", 999, 80);
  igual("a de baixo só anda na vertical", [f.vistas[1].x, f.vistas[1].y], [120, 80]);
  const ida = validarDesenho(JSON.parse(JSON.stringify(d)));
  igual("validar: ida e volta", [ida.folhas[0].vistas.length, ida.folhas[0].vistas[2].mae, ida.modelos.length], [3, "F", 1]);
  excluirVistas(f, ["F"]);
  igual("excluir a mãe solta as projetadas", f.vistas.map((x) => x.mae ?? "-"), ["-", "-"]);
  igual("escala que cabe: 80 × 50 em 100 × 100 até 2:1 → 1:1", escalaQueCabe({ x0: 0, y0: 0, x1: 80, y1: 50 }, 100, 100, 2), 1);
  igual("escala que cabe: limitada pela folha (máx 0,5)", escalaQueCabe({ x0: 0, y0: 0, x1: 10, y1: 10 }, 500, 500, 0.5), 0.5);
  igual("afastar da mãe: acima e encostada sobe até 10 mm de vão", afastarDaMae({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 0, y0: 5, x1: 10, y1: 20 }, "acima"), [0, 15]);
  igual("afastar da mãe: já longe não mexe", afastarDaMae({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 40, y0: 0, x1: 50, y1: 10 }, "direita"), [0, 0]);
  igual("propriedades na nota", preencherPropriedades("Material: {material} {x}", { material: "Aço" }), "Material: Aço {x}");
  let erro = "";
  try { validarDesenho({ formato: "wjasm" }); } catch (e) { erro = (e as Error).message; }
  igual("arquivo que não é desenho é recusado", erro.includes("inválido"), true);
}

console.log(falhas ? `\ndesenho: ${falhas} falha(s)` : "\ndesenho: tudo certo");
if (falhas) process.exit(1);
