// Teste do esboço em Node: solver PlaneGCS, operações (aparar, offset, espelhar)
// e geração de sólidos a partir de esboços no kernel.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { novaFeature, novoEsboco, type FeatureEsboco, type FeatureExtrusao, type FeatureRevolucao } from "../src/model";
import { regenerar } from "../src/kernel/regenerar";
import { SolverEsboco } from "../src/esboco/solver";
import * as op from "../src/esboco/operacoes";
import { encontrarLacos, ORIGEM, EIXO_H, EIXO_V } from "../src/esboco/geometria";
import { atualizarExternas, criarExterna, podarExternas, projetar } from "../src/esboco/externas";
import { referencial } from "../src/esboco/referencial";
import { ajustarTextoCota, PASSO_COTA_PX } from "../src/esboco/cotas";

const require = createRequire(import.meta.url);
const OC = await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") });
setOC(OC);
const solver = await SolverEsboco.criar();

let falhas = 0;
function confere(nome: string, obtido: number, esperado: number, tol = 1e-3) {
  const ok = Math.abs(obtido - esperado) <= tol * Math.max(1, Math.abs(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${obtido.toFixed(3)} (esperado ${esperado.toFixed(3)})`);
}
function verdade(nome: string, v: boolean) {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}`);
}

const plano = (p: "XY" | "XZ" | "YZ" = "XY", d = 0) => novoEsboco(1, { tipo: "plano", plano: p, deslocamento: d });
const extrusao = (esb: FeatureEsboco, prof: number, cortar = false): FeatureExtrusao => ({
  ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: esb.id, profundidade: prof, operacao: cortar ? "cortar" : "adicionar",
});

// 1. Retângulo 60×40 com canto na origem, furo Ø20 no centro: tudo cotado → totalmente definido
{
  const e = plano();
  const a = op.ponto(e, { x: 1, y: 2 }), c = op.ponto(e, { x: 50, y: 35 });
  const [l1, l2] = op.retangulo(e, a, c);
  op.restringir(e, { tipo: "coincidente", a, b: ORIGEM });
  op.restringir(e, { tipo: "distancia", a: l1.id, valor: 60 });
  op.restringir(e, { tipo: "distancia", a: l2.id, valor: 40 });
  const cc = op.ponto(e, { x: 25, y: 18 });
  const furo = op.circulo(e, cc, 8);
  op.restringir(e, { tipo: "diametro", a: furo.id, valor: 20 });
  op.restringir(e, { tipo: "distanciaH", a, b: cc, valor: 30 });
  op.restringir(e, { tipo: "distanciaV", a, b: cc, valor: 20 });
  const r = solver.resolver(e);
  verdade("retângulo com furo totalmente definido", r.definicao === "definido" && r.gl === 0);
  verdade("análise por entidade: nada livre", solver.livres(e).size === 0);
  const sol = regenerar([e, extrusao(e, 10)]);
  confere("volume placa com furo", sol.volume ?? 0, 60 * 40 * 10 - Math.PI * 100 * 10);

  // cota extra conflitante
  e.restricoes.push({ id: "x", tipo: "distanciaH", a, b: cc, valor: 10 });
  verdade("cota conflitante detectada", solver.resolver(e).conflitantes.includes("x"));
}

// 2. Rasgo: comprimento entre centros 40, raio 6 → área = 40·12 + π·36
{
  const e = plano();
  const c1 = op.ponto(e, { x: 0, y: 0 }, ORIGEM), c2 = op.ponto(e, { x: 38, y: 1 });
  const geos = op.rasgo(e, c1, c2, 5);
  op.restringir(e, { tipo: "horizontal", a: c1, b: c2 });
  op.restringir(e, { tipo: "distancia", a: c1, b: c2, valor: 40 });
  op.restringir(e, { tipo: "raio", a: geos[1].id, valor: 6 });
  const r = solver.resolver(e);
  verdade(`rasgo resolvido (${r.definicao}, ${r.gl} GL)`, r.ok && r.definicao === "definido");
  const sol = regenerar([e, extrusao(e, 5)]);
  confere("volume rasgo", sol.volume ?? 0, (40 * 12 + Math.PI * 36) * 5);
}

// 3. Polígono hexagonal de circunraio 10 → área = 3√3/2 · r²
{
  const e = plano("XZ", 0);
  const c = op.ponto(e, { x: 0, y: 0 }, ORIGEM);
  const g = op.poligono(e, c, { x: 9, y: 0 }, 6);
  op.restringir(e, { tipo: "raio", a: g[0].id, valor: 10 });
  solver.resolver(e);
  const sol = regenerar([e, extrusao(e, 4)]);
  confere("volume hexágono", sol.volume ?? 0, ((3 * Math.sqrt(3)) / 2) * 100 * 4);
}

// 4. Revolução: retângulo 10×20 afastado 10 do eixo (linha de construção vertical) → tubo
{
  const e = plano("XZ");
  const a = op.ponto(e, { x: 10, y: 0 }), c = op.ponto(e, { x: 20, y: 20 });
  op.retangulo(e, a, c);
  const o = op.ponto(e, { x: 0, y: 0 }, ORIGEM), t = op.ponto(e, { x: 0, y: 30 });
  op.linha(e, o, t, true);
  const rev: FeatureRevolucao = { ...(novaFeature("revolucao", 1) as FeatureRevolucao), esboco: e.id };
  const sol = regenerar([e, rev]);
  confere("volume revolução", sol.volume ?? 0, Math.PI * (400 - 100) * 20);
}

// 5. Aparar: duas linhas em cruz; aparar um braço deixa 3 segmentos
{
  const e = plano();
  const h = op.linha(e, op.ponto(e, { x: -10, y: 0 }), op.ponto(e, { x: 10, y: 0 }));
  op.linha(e, op.ponto(e, { x: 0, y: -10 }), op.ponto(e, { x: 0, y: 10 }));
  op.aparar(e, h.id, { x: 5, y: 0 });
  const comp = e.geos.map((g) => (g.tipo === "linha" ? Math.hypot(...[g.p1, g.p2].map((id) => e.pontos.find((p) => p.id === id)!).reduce((d, p, i) => (i ? [p.x - d[0], p.y - d[1]] : [p.x, p.y]), [0, 0] as number[])) : 0));
  verdade("aparar linha em cruz", e.geos.length === 2 && Math.abs(comp[0] - 10) < 1e-9);
  // círculo cortado por linha vira arco
  const e2 = plano();
  const ci = op.circulo(e2, op.ponto(e2, { x: 0, y: 0 }), 10);
  op.linha(e2, op.ponto(e2, { x: -20, y: 5 }), op.ponto(e2, { x: 20, y: 5 }));
  op.aparar(e2, ci.id, { x: 0, y: 10 });
  verdade("aparar círculo vira arco", e2.geos.find((g) => g.id === ci.id)?.tipo === "arco");
}

// 6. Offset de retângulo 20×10 para fora em 2 → 24×14
{
  const e = plano();
  const ls = op.retangulo(e, op.ponto(e, { x: 0, y: 0 }), op.ponto(e, { x: 20, y: 10 }));
  const novas = op.deslocar(e, ls.map((l) => l.id), 2);
  const e2: FeatureEsboco = { ...e, geos: e.geos.filter((g) => novas.includes(g.id)) };
  const area = encontrarLacos(e2)[0].poligono;
  let A = 0;
  for (let i = 0; i < area.length; i++) A += area[i].x * area[(i + 1) % area.length].y - area[(i + 1) % area.length].x * area[i].y;
  confere("offset para fora", Math.abs(A / 2), 24 * 14);
  verdade("offset resolve sem conflito", solver.resolver(e).conflitantes.length === 0);
}

// 7. Espelhar meio perfil em torno do eixo V e extrudar: retângulo 2×(10×10)
{
  const e = plano();
  const p0 = op.ponto(e, { x: 0, y: 0 }), p1 = op.ponto(e, { x: 10, y: 0 }), p2 = op.ponto(e, { x: 10, y: 10 }), p3 = op.ponto(e, { x: 0, y: 10 });
  const ids = [op.linha(e, p0, p1), op.linha(e, p1, p2), op.linha(e, p2, p3)].map((g) => g.id);
  op.espelhar(e, ids, EIXO_V);
  const r = solver.resolver(e);
  verdade("espelhar resolve", r.ok && r.conflitantes.length === 0);
  const sol = regenerar([e, extrusao(e, 1)]);
  confere("volume espelhado", sol.volume ?? 0, 200);
  void EIXO_H;
}

// 8. Arrasto: ponto livre segue o dedo; ponto fixado na origem não sai
{
  const e = plano();
  const a = op.ponto(e, { x: 0, y: 0 }), b = op.ponto(e, { x: 10, y: 0 });
  op.linha(e, a, b);
  op.restringir(e, { tipo: "coincidente", a, b: ORIGEM });
  solver.resolver(e, { pontos: [{ id: b, x: 20, y: 5 }] });
  const pb = e.pontos.find((p) => p.id === b)!, pa = e.pontos.find((p) => p.id === a)!;
  verdade("arrasto move ponto livre", Math.abs(pb.x - 20) < 1e-6 && Math.abs(pb.y - 5) < 1e-6);
  verdade("origem continua presa", Math.hypot(pa.x, pa.y) < 1e-9);
}

// 9. Perfil aberto dá erro claro
{
  const e = plano();
  op.linha(e, op.ponto(e, { x: 0, y: 0 }), op.ponto(e, { x: 10, y: 0 }));
  const sol = regenerar([e, extrusao(e, 3)]);
  verdade(`perfil aberto → erro "${sol.erros[0]?.mensagem}"`, /aberto/.test(sol.erros[0]?.mensagem ?? ""));
}

// 10. Ferramentas da Fase 3: retângulo pelo centro, filete/chanfro de esboço, círculo perimetral,
//     arco tangente, estender, padrões e girar
{
  const e = plano();
  const c = op.ponto(e, { x: 0, y: 0 }, ORIGEM);
  const ls = op.retanguloCentro(e, c, { x: 20, y: 10 });
  const r = solver.resolver(e);
  verdade("retângulo pelo centro resolve", r.ok && r.conflitantes.length === 0);
  const canto = (ls[1] as { p1: string }).p1;
  verdade("filete de esboço no canto", !!op.fileteEsboco(e, canto, 3, true));
  verdade("chanfro de esboço no canto oposto", !!op.chanfroEsboco(e, (ls[3] as { p1: string }).p1, 2));
  const r2 = solver.resolver(e);
  verdade(`filete/chanfro resolvem (${r2.definicao})`, r2.ok && r2.conflitantes.length === 0);
  const sol = regenerar([e, extrusao(e, 1)]);
  confere("área com filete r3 e chanfro 2", sol.volume ?? 0, 40 * 20 - (9 - (Math.PI * 9) / 4) - 2);

  const e2 = plano();
  const ci = op.circulo3Pontos(e2, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 });
  confere("círculo perimetral: raio", ci?.r ?? 0, 10);
  const l = op.linha(e2, op.ponto(e2, { x: 30, y: 0 }), op.ponto(e2, { x: 40, y: 0 }));
  const at = op.arcoTangente(e2, l.p2, { x: 40, y: 20 });
  confere("arco tangente: raio", at?.r ?? 0, 10);
  verdade("arco tangente resolve", solver.resolver(e2).conflitantes.length === 0);

  const e3 = plano();
  const h = op.linha(e3, op.ponto(e3, { x: 0, y: 0 }), op.ponto(e3, { x: 5, y: 0 }));
  op.linha(e3, op.ponto(e3, { x: 20, y: -5 }), op.ponto(e3, { x: 20, y: 5 }));
  op.estender(e3, h.id, { x: 5, y: 0 });
  const p2 = e3.pontos.find((p) => p.id === h.p2)!;
  confere("estender até a linha vertical", p2.x, 20);

  const e4 = plano();
  const cc = op.circulo(e4, op.ponto(e4, { x: 20, y: 0 }), 2);
  op.padraoCircularEsboco(e4, [cc.id], { centro: { x: 0, y: 0 }, n: 6, angulo: 360 });
  verdade("padrão circular de esboço: 6 círculos", e4.geos.filter((g) => g.tipo === "circulo").length === 6);
  op.padraoLinearEsboco(e4, [cc.id], { n1: 3, esp1: 10, ang1: 90 });
  verdade("padrão linear de esboço: +2", e4.geos.filter((g) => g.tipo === "circulo").length === 8);
  op.transformar(e4, [cc.id], op.girar({ x: 0, y: 0 }, 90), false);
  const centro = e4.pontos.find((p) => p.id === (cc as { c: string }).c)!;
  verdade("girar 90° move o centro para (0; 20)", Math.abs(centro.x) < 1e-9 && Math.abs(centro.y - 20) < 1e-9);
}

// 11. Referências do modelo 3D: aresta/vértice projetados no plano do esboço, fixos
{
  const e = plano("XY", 10);
  const r = referencial(e.suporte);
  const aresta = { tipo: "aresta" as const, ass: { geom: "linha" as const, a: [-40, -25, 10] as [number, number, number], b: [40, -25, 10] as [number, number, number], meio: [0, -25, 10] as [number, number, number], comprimento: 80 } };
  const pr = projetar(aresta, r);
  verdade("aresta reta projeta como linha", pr?.tipo === "linha");
  const ext = criarExterna(e, pr!, aresta);
  verdade("referência é construção e externa", !!ext.construcao && !!ext.externa);
  // linha do esboço colinear com a aresta do modelo
  const l = op.linha(e, op.ponto(e, { x: -10, y: -20 }), op.ponto(e, { x: 10, y: -18 }));
  op.restringir(e, { tipo: "colinear", a: l.id, b: ext.id });
  verdade("colinear com a aresta resolve", solver.resolver(e).conflitantes.length === 0);
  confere("linha foi para y = −25", e.pontos.find((p) => p.id === l.p1)!.y, -25);
  const pe = e.pontos.find((p) => p.id === (ext as { p1: string }).p1)!;
  confere("referência não se mexe", pe.x, -40);
  const circ = { tipo: "aresta" as const, ass: { geom: "circulo" as const, a: [20, 0, 10] as [number, number, number], b: [20, 0, 10] as [number, number, number], meio: [-10, 0, 10] as [number, number, number], comprimento: 2 * Math.PI * 10, centro: [10, 0, 10] as [number, number, number], eixo: [0, 0, 1] as [number, number, number], raio: 10 } };
  verdade("círculo paralelo projeta como círculo", projetar(circ, r)?.tipo === "circulo");
  const inclinado = { ...circ, ass: { ...circ.ass, eixo: [1, 0, 0] as [number, number, number] } };
  verdade("círculo inclinado não projeta (elipse)", projetar(inclinado, r) === null);
  // peça mudou: a aresta foi para y = −30
  const topo = { vertices: [], arestas: [{ ...aresta.ass, a: [-40, -30, 10] as [number, number, number], b: [40, -30, 10] as [number, number, number], meio: [0, -30, 10] as [number, number, number] }] };
  const res = atualizarExternas(e, topo, r);
  verdade("atualizar: 1 referência mudou", res.mudaram === 1 && res.perdidas === 0);
  solver.resolver(e);
  confere("linha acompanhou a aresta (y = −30)", e.pontos.find((p) => p.id === l.p1)!.y, -30);
  // referência sem uso some ao podar
  const v = criarExterna(e, { tipo: "ponto", p: { x: 5, y: 5 } }, { tipo: "vertice", p: [5, 5, 10] });
  verdade("vértice vira ponto", v.tipo === "ponto");
  podarExternas(e, new Set());
  verdade("podar: vértice sem uso removido, aresta usada fica", !e.geos.some((g) => g.id === v.id) && e.geos.some((g) => g.id === ext.id));
}

// 12. Distanciador automático das cotas (mmPx = 0,1 → passo de 2,6 mm)
{
  const e = plano();
  const l = op.linha(e, op.ponto(e, { x: 0, y: 0 }), op.ponto(e, { x: 40, y: 0 }));
  const c = { id: "c", tipo: "distancia" as const, a: l.id, valor: 40 };
  const passo = PASSO_COTA_PX * 0.1;
  const perto = ajustarTextoCota(c, e, { x: 12, y: 0.8 }, 0.1);
  confere("cota perto da linha vai para 1 passo", perto.y, passo);
  confere("texto centrado na linha", perto.x, 20);
  confere("perto de 2 passos encaixa", ajustarTextoCota(c, e, { x: 30, y: -2 * passo - 0.3 }, 0.1).y, -2 * passo);
  confere("longe dos encaixes fica livre", ajustarTextoCota(c, e, { x: 30, y: 2.5 * passo }, 0.1).y, 2.5 * passo);
  const ci = op.circulo(e, op.ponto(e, { x: 100, y: 0 }), 10);
  const d = ajustarTextoCota({ id: "d", tipo: "diametro", a: ci.id, valor: 20 }, e, { x: 111, y: 0 }, 0.1);
  confere("diâmetro: 1 passo fora do círculo", d.x, 110 + passo);
}

// 13. Subfunções dos menus ▾: linha de ponto médio, paralelogramo, retângulo pelo centro por
// 3 pontos e rasgo em arco (área conferida pela extrusão de 1 mm)
{
  const e = plano();
  const m = op.ponto(e, { x: 5, y: 5 });
  const l = op.linhaPontoMedio(e, m, { x: 15, y: 5 });
  verdade("linha de ponto médio resolve", solver.resolver(e).conflitantes.length === 0);
  const p1 = e.pontos.find((p) => p.id === l.p1)!;
  confere("linha de ponto médio: ponta oposta em x = −5", p1.x, -5);

  const e2 = plano();
  op.paralelogramo(e2, op.ponto(e2, { x: 0, y: 0 }), op.ponto(e2, { x: 20, y: 0 }), { x: 25, y: 10 });
  verdade("paralelogramo resolve", solver.resolver(e2).conflitantes.length === 0);
  confere("paralelogramo: área base × altura", regenerar([e2, extrusao(e2, 1)]).volume ?? 0, 20 * 10);

  const e3 = plano();
  op.retanguloCentro3Pontos(e3, op.ponto(e3, { x: 0, y: 0 }), { x: 0, y: 5 }, { x: 8, y: 5 });
  verdade("retângulo pelo centro (3 pontos) resolve", solver.resolver(e3).conflitantes.length === 0);
  confere("retângulo pelo centro (3 pontos): 16 × 10", regenerar([e3, extrusao(e3, 1)]).volume ?? 0, 16 * 10);

  const e4 = plano();
  const c = op.ponto(e4, { x: 0, y: 0 });
  verdade("rasgo em arco criado", op.rasgoArco(e4, c, 20, 0, Math.PI / 2, 3).length === 4);
  verdade("rasgo em arco resolve", solver.resolver(e4).conflitantes.length === 0);
  // faixa anular de 90° (r 17..23) + duas meias-pontas de raio 3 (= um círculo)
  confere("rasgo em arco: área", regenerar([e4, extrusao(e4, 1)]).volume ?? 0, (Math.PI / 2) * (23 * 23 - 17 * 17) / 2 + Math.PI * 9);
}

// 14. Offset de entidades: bidirecional com tampas em arco (vira um rasgo) e um só lado com
// tampas em linha (retângulo); "geometria base" vira construção
{
  const e = plano();
  const l = op.linha(e, op.ponto(e, { x: 0, y: 0 }), op.ponto(e, { x: 40, y: 0 }));
  const novas = op.deslocar(e, [l.id], 3, { bidirecional: true, tampar: "arcos", baseConstrucao: true });
  verdade("offset bidirecional: 2 linhas + 2 arcos", novas.length === 4);
  verdade("geometria base vira construção", !!e.geos.find((g) => g.id === l.id)?.construcao);
  verdade("offset bidirecional resolve", solver.resolver(e).conflitantes.length === 0);
  confere("offset bidirecional com arcos: área do rasgo", regenerar([e, extrusao(e, 1)]).volume ?? 0, 40 * 6 + Math.PI * 9);

  const e2 = plano();
  const l2 = op.linha(e2, op.ponto(e2, { x: 0, y: 0 }), op.ponto(e2, { x: 40, y: 0 }));
  op.deslocar(e2, [l2.id], 3, { tampar: "linhas", cotar: false });
  verdade("offset sem cota", !e2.restricoes.some((r) => r.tipo === "distancia"));
  verdade("offset com tampas em linha resolve", solver.resolver(e2).conflitantes.length === 0);
  confere("offset com tampas em linha: 40 × 3", regenerar([e2, extrusao(e2, 1)]).volume ?? 0, 40 * 3);

  const e3 = plano();
  const ci = op.circulo(e3, op.ponto(e3, { x: 0, y: 0 }), 10);
  op.deslocar(e3, [ci.id], 2, { bidirecional: true, construcao: true });
  verdade("círculo bidirecional: r 8 e 12 de construção",
    e3.geos.filter((g) => g.tipo === "circulo" && g.construcao).map((g) => (g as { r: number }).r).sort().join() === "12,8");
}

// 15. Aparar: canto (duas linhas viram um L), dentro/fora entre dois limites e manter o
// trecho aparado como construção
{
  const e = plano();
  const h = op.linha(e, op.ponto(e, { x: 0, y: 0 }), op.ponto(e, { x: 30, y: 0 }));
  const v = op.linha(e, op.ponto(e, { x: 20, y: -10 }), op.ponto(e, { x: 20, y: 5 }));
  verdade("canto entre duas linhas", op.canto(e, h.id, { x: 5, y: 0 }, v.id, { x: 20, y: 3 }));
  const pts = new Map(e.pontos.map((p) => [p.id, p]));
  const comprimento = (l: { p1: string; p2: string }) => Math.hypot(pts.get(l.p2)!.x - pts.get(l.p1)!.x, pts.get(l.p2)!.y - pts.get(l.p1)!.y);
  confere("canto: horizontal até x = 20", comprimento(e.geos.find((g) => g.id === h.id) as never), 20);
  confere("canto: vertical de y = 0 a 5", comprimento(e.geos.find((g) => g.id === v.id) as never), 5);
  verdade("canto: ponto compartilhado", (e.geos.find((g) => g.id === h.id) as { p2: string }).p2 === (e.geos.find((g) => g.id === v.id) as { p1: string }).p1);

  const linhas = (fora: boolean, construcao: boolean) => {
    const e2 = plano();
    const b1 = op.linha(e2, op.ponto(e2, { x: 10, y: -5 }), op.ponto(e2, { x: 10, y: 5 }));
    const b2 = op.linha(e2, op.ponto(e2, { x: 30, y: -5 }), op.ponto(e2, { x: 30, y: 5 }));
    const alvo = op.linha(e2, op.ponto(e2, { x: 0, y: 0 }), op.ponto(e2, { x: 40, y: 0 }));
    const ok = op.apararEntre(e2, alvo.id, [b1.id, b2.id], !fora, construcao);
    const m = new Map(e2.pontos.map((p) => [p.id, p]));
    const soma = (c: boolean) => e2.geos.filter((g) => g.tipo === "linha" && !!g.construcao === c && g.id !== b1.id && g.id !== b2.id)
      .reduce((t, g) => t + Math.hypot(m.get((g as { p2: string }).p2)!.x - m.get((g as { p1: string }).p1)!.x, m.get((g as { p2: string }).p2)!.y - m.get((g as { p1: string }).p1)!.y), 0);
    return { ok, normal: soma(false), construcao: soma(true) };
  };
  const dentro = linhas(false, false);
  verdade("aparar dentro", dentro.ok);
  confere("aparar dentro: sobra 10 + 10", dentro.normal, 20);
  const fora = linhas(true, true);
  confere("aparar fora: sobra o trecho de 20 entre os limites", fora.normal, 20);
  confere("aparar fora: pontas viram construção (10 + 10)", fora.construcao, 20);

  const e3 = plano();
  const l = op.linha(e3, op.ponto(e3, { x: 0, y: 0 }), op.ponto(e3, { x: 10, y: 0 }));
  op.aparar(e3, l.id, { x: 5, y: 0 }, { construcao: true });
  verdade("aparar sem cortes com construção: vira construção", !!e3.geos.find((g) => g.id === l.id)?.construcao);
}

// 16. Padrões de esboço: linear 3 × 2 pulando (2, 2) com cota de espaçamento; circular sem
// espaçamento igual (passo de 30°) pulando a 3ª instância
{
  const e = plano();
  const c = op.circulo(e, op.ponto(e, { x: 0, y: 0 }), 2);
  const novas = op.padraoLinearEsboco(e, [c.id], { n1: 3, esp1: 10, ang1: 0, n2: 2, esp2: 15, ang2: 90, pular: [[2, 2]], cotar1: true, cotar2: true });
  verdade("linear 3 × 2 menos 1 pulada = 4 cópias", novas.length === 4);
  verdade("linear: cotas de espaçamento H e V", e.restricoes.some((r) => r.tipo === "distanciaH" && r.valor === 10) && e.restricoes.some((r) => r.tipo === "distanciaV" && r.valor === 15));
  const centros = e.geos.filter((g) => g.tipo === "circulo").map((g) => e.pontos.find((p) => p.id === (g as { c: string }).c)!);
  verdade("linear: (2, 2) ficou de fora", !centros.some((p) => Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - 15) < 1e-9));
  verdade("linear resolve", solver.resolver(e).conflitantes.length === 0);

  const e2 = plano();
  const c2 = op.circulo(e2, op.ponto(e2, { x: 20, y: 0 }), 2);
  const n2 = op.padraoCircularEsboco(e2, [c2.id], { centro: { x: 0, y: 0 }, n: 4, angulo: 30, igual: false, pular: [3], centroId: ORIGEM, cotarRaio: true });
  verdade("circular: 4 instâncias menos a 3ª = 2 cópias", n2.length === 2);
  const ult = e2.geos.find((g) => g.id === n2[1]) as { c: string };
  const q = e2.pontos.find((p) => p.id === ult.c)!;
  confere("circular: 4ª instância a 90°", (Math.atan2(q.y, q.x) * 180) / Math.PI, 90);
  verdade("circular: cota do raio", e2.restricoes.some((r) => r.tipo === "distancia" && r.a === ORIGEM && Math.abs((r as { valor: number }).valor - 20) < 1e-9));
}

// 17. Elipse, elipse parcial e parábola: solver, cotas pelos eixos e área do perfil
{
  const e = plano();
  const c = op.ponto(e, { x: 10, y: 5 });
  const [el, eixoM, eixoN] = op.elipse(e, c, { x: 30, y: 5 }, 8);
  verdade("elipse resolve", solver.resolver(e).conflitantes.length === 0);
  confere("elipse: área π·a·b", regenerar([e, extrusao(e, 1)]).volume ?? 0, Math.PI * 20 * 8);
  // centro e eixos cotados → totalmente definida
  op.restringir(e, { tipo: "distanciaH", a: ORIGEM, b: c, valor: 10 });
  op.restringir(e, { tipo: "distanciaV", a: ORIGEM, b: c, valor: 5 });
  op.restringir(e, { tipo: "horizontal", a: eixoM.id });
  op.restringir(e, { tipo: "distancia", a: eixoM.id, valor: 50 });
  op.restringir(e, { tipo: "distancia", a: eixoN.id, valor: 20 });
  const r = solver.resolver(e);
  verdade("elipse cotada pelos eixos: totalmente definida", r.ok && r.definicao === "definido");
  confere("elipse: diâmetro maior vira 50", regenerar([e, extrusao(e, 1)]).volume ?? 0, Math.PI * 25 * 10);
  // ponto sobre a elipse
  const q = op.ponto(e, { x: 10, y: 20 });
  op.pontoSolto(e, q);
  op.restringir(e, { tipo: "coincidente", a: q, b: el.id });
  solver.resolver(e);
  const qq = e.pontos.find((p) => p.id === q)!;
  confere("ponto sobre a elipse", ((qq.x - 10) / 25) ** 2 + ((qq.y - 5) / 10) ** 2, 1);

  // meia elipse fechada por uma linha (anti-horário de +a até −a: metade de cima)
  const e2 = plano();
  const c2 = op.ponto(e2, { x: 0, y: 0 });
  const [ae] = op.arcoElipse(e2, c2, { x: 20, y: 0 }, 10, { x: 20, y: 0 }, { x: -20, y: 0 });
  const a2 = ae as Extract<typeof ae, { tipo: "arcoElipse" }>;
  op.linha(e2, a2.fim, a2.ini);
  verdade("elipse parcial resolve", solver.resolver(e2).conflitantes.length === 0);
  confere("meia elipse: área π·a·b/2", regenerar([e2, extrusao(e2, 1)]).volume ?? 0, (Math.PI * 20 * 10) / 2);
  const e3 = plano();
  const c3 = op.ponto(e3, { x: 0, y: 0 });
  const [ae3] = op.arcoElipse(e3, c3, { x: 20, y: 0 }, 10, { x: 0, y: 10 }, { x: 0, y: -10 });
  const a3 = ae3 as Extract<typeof ae3, { tipo: "arcoElipse" }>;
  op.linha(e3, a3.fim, a3.ini);
  confere("elipse parcial de 90° a 270° (lado esquerdo)", regenerar([e3, extrusao(e3, 1)]).volume ?? 0, (Math.PI * 20 * 10) / 2);
  const e3b = plano();
  const c3b = op.ponto(e3b, { x: 0, y: 0 });
  // de t = −0,5 até t = −π/2 no sentido anti-horário (mais de meia volta), fechada pela corda
  const P = (t: number) => ({ x: 20 * Math.cos(t), y: 10 * Math.sin(t) });
  const [ae3b] = op.arcoElipse(e3b, c3b, { x: 20, y: 0 }, 10, P(-0.5), P(-Math.PI / 2));
  const a3b = ae3b as Extract<typeof ae3b, { tipo: "arcoElipse" }>;
  op.linha(e3b, a3b.fim, a3b.ini);
  const [p0, p1] = [P(-0.5), P(-Math.PI / 2)];
  // área = setor em parâmetro excêntrico (½·a·b·Δt) + parcela da corda (½·(x1·y0 − x0·y1))
  confere("elipse parcial maior que meia volta", regenerar([e3b, extrusao(e3b, 1)]).volume ?? 0,
    0.5 * 20 * 10 * (1.5 * Math.PI + 0.5) + 0.5 * (p1.x * p0.y - p0.x * p1.y));

  // parábola foco (0,1), vértice (0,0), de x = −2 a 2, fechada pela corda y = 1: área 2/3·4·1
  const e4 = plano();
  const f = op.ponto(e4, { x: 0, y: 1 });
  op.pontoSolto(e4, f, true);
  const pb = op.parabola(e4, f, { x: 0, y: 0 }, { x: 2, y: 1 }, { x: -2, y: 1 });
  op.linha(e4, pb.fim, pb.ini);
  verdade("parábola resolve", solver.resolver(e4).conflitantes.length === 0);
  confere("segmento de parábola: 2/3 · base · altura", regenerar([e4, extrusao(e4, 1)]).volume ?? 0, (2 / 3) * 4 * 1);
  // espelhar e copiar elipse parcial mantém a forma (o solver não vira a elipse)
  const novas = op.espelhar(e2, [ae.id], EIXO_V);
  verdade("elipse parcial espelhada resolve", solver.resolver(e2).conflitantes.length === 0 && novas.length === 1);
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`);
  process.exit(1);
}
console.log("\nesboço: tudo certo");
