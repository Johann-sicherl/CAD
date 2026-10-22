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
  op.padraoCircularEsboco(e4, [cc.id], { x: 0, y: 0 }, 6, 360);
  verdade("padrão circular de esboço: 6 círculos", e4.geos.filter((g) => g.tipo === "circulo").length === 6);
  op.padraoLinearEsboco(e4, [cc.id], 3, 10, 90);
  verdade("padrão linear de esboço: +2", e4.geos.filter((g) => g.tipo === "circulo").length === 8);
  op.transformar(e4, [cc.id], op.girar({ x: 0, y: 0 }, 90), false);
  const centro = e4.pontos.find((p) => p.id === (cc as { c: string }).c)!;
  verdade("girar 90° move o centro para (0; 20)", Math.abs(centro.x) < 1e-9 && Math.abs(centro.y - 20) < 1e-9);
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`);
  process.exit(1);
}
console.log("\nesboço: tudo certo");
