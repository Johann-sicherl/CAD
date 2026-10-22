// Teste dos recursos da Fase 3 em Node: condições finais, direção 2, inclinação, recurso fino,
// filete/chanfro por aresta, casca, inclinação de faces, nervura, furo ISO, padrões, espelho,
// planos/eixos de referência. Volumes conferidos com conta de mão.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import {
  documentoExemplo, novaFeature, novoEsboco, type Feature, type FeatureEsboco, type FeatureExtrusao, type Referencia,
} from "../src/model";
import { regenerar } from "../src/kernel/regenerar";
import { medidasFuro } from "../src/kernel/furos";
import { topologia } from "../src/kernel/topologia";
import * as op from "../src/esboco/operacoes";
import { ORIGEM } from "../src/esboco/geometria";
import { absorvidosDe, excluirRecursos, filhosDe } from "../src/dependencias";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));

let falhas = 0;
function confere(nome: string, obtido: number | null | undefined, esperado: number, tol = 2e-3) {
  const v = obtido ?? NaN;
  const ok = Math.abs(v - esperado) <= tol * Math.max(1, Math.abs(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${v.toFixed(2)} (esperado ${esperado.toFixed(2)})`);
}
function semErros(nome: string, r: ReturnType<typeof regenerar>) {
  if (r.erros.length) {
    falhas++;
    console.log(`FALHA ${nome}: ${r.erros.map((e) => e.mensagem).join(" | ")}`);
  }
}

/** Esboço com retângulo centrado W×H no plano dado. */
function retangulo(w: number, h: number, plano: "XY" | "XZ" | "YZ" = "XY", cx = 0, cy = 0): FeatureEsboco {
  const e = novoEsboco(1, { tipo: "plano", plano, deslocamento: 0 });
  op.retangulo(e, op.ponto(e, { x: cx - w / 2, y: cy - h / 2 }), op.ponto(e, { x: cx + w / 2, y: cy + h / 2 }));
  return e;
}
function circulo(r: number, cx = 0, cy = 0, plano: "XY" | "XZ" | "YZ" = "XY"): FeatureEsboco {
  const e = novoEsboco(2, { tipo: "plano", plano, deslocamento: 0 });
  op.circulo(e, op.ponto(e, { x: cx, y: cy }), r);
  return e;
}
const ext = (esb: FeatureEsboco, prof: number, mod: Partial<FeatureExtrusao> = {}): FeatureExtrusao => ({
  ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: esb.id, profundidade: prof, ...mod,
});
/** Referência à face plana da peça cuja normal e centro batem com o pedido. */
function face(feats: Feature[], normal: [number, number, number], perto: [number, number, number]): Referencia {
  const r = regenerar(feats);
  const fs = r.topologia!.faces.filter((f) => f.normal && f.normal.every((v, i) => Math.abs(v - normal[i]) < 1e-6));
  fs.sort((a, b) => Math.hypot(...a.centro.map((v, i) => v - perto[i])) - Math.hypot(...b.centro.map((v, i) => v - perto[i])));
  return { tipo: "face", ass: fs[0] };
}
function arestasRetas(feats: Feature[], filtro: (a: { a: number[]; b: number[] }) => boolean): Referencia[] {
  const r = regenerar(feats);
  return r.topologia!.arestas.filter((a) => a.geom === "linha" && filtro(a)).map((ass) => ({ tipo: "aresta", ass }));
}

// ---------- extrusão: condições finais ----------
const base = retangulo(40, 20);
const bloco = ext(base, 10);
{
  confere("cego 10", regenerar([base, bloco]).volume, 40 * 20 * 10);
  confere("plano médio 10", regenerar([base, ext(base, 10, { condicao: { tipo: "planoMedio", dist: 0 } })]).volume, 8000);
  const d2 = ext(base, 10, { direcao2: { ativa: true, condicao: { tipo: "cego", dist: 5 } } });
  confere("direção 2 (+5)", regenerar([base, d2]).volume, 40 * 20 * 15);
  const desl = ext(base, 10, { de: { tipo: "deslocamento", dist: 5, inverter: false } });
  const r = regenerar([base, desl]);
  confere("início deslocado: volume", r.volume, 8000);
  confere("início deslocado: z mín", Math.min(...r.topologia!.vertices.map((v) => v[2])), 5);
  // corte passante, até o próximo e até o vértice num bloco 40×20×10
  const furo = circulo(4);
  const passante = ext(furo, 1, { operacao: "cortar", condicao: { tipo: "passanteAmbos", dist: 0 } });
  confere("corte passante (ambos)", regenerar([base, bloco, furo, passante]).volume, 8000 - Math.PI * 16 * 10);
  const furoTopo = { ...circulo(4), suporte: { tipo: "plano" as const, plano: "XY" as const, deslocamento: 10 } };
  const proximo = ext(furoTopo, 1, { operacao: "cortar", inverter: true, condicao: { tipo: "proximo", dist: 0 } });
  confere("corte até o próximo", regenerar([base, bloco, furoTopo, proximo]).volume, 8000 - Math.PI * 16 * 10);
  const vert = ext(base, 1, { condicao: { tipo: "vertice", dist: 0, ref: { tipo: "vertice", p: [0, 0, 7] } } });
  confere("até o vértice z=7", regenerar([base, vert]).volume, 40 * 20 * 7);
  const sup = ext(circulo(3), 1, { condicao: { tipo: "superficie", dist: 0, ref: { tipo: "plano", id: "pl" } } });
  const pl = { ...(novaFeature("planoRef", 1) as any), id: "pl", ref1: { tipo: "plano", id: "XY" }, distancia: 25 };
  const c3 = sup.esboco ? null : null; void c3;
  const ec = circulo(3);
  confere("até a superfície (plano a 25)", regenerar([pl, ec, { ...sup, esboco: ec.id }]).volume, Math.PI * 9 * 25);
  // sentido vem da referência: superfície/vértice abaixo do esboço, sem inverter (mesmo com inverter ligado)
  const plAbaixo = { ...pl, id: "plb", distancia: 15, inverter: true };
  const supAbaixo = { ...sup, esboco: ec.id, inverter: false, condicao: { tipo: "superficie", dist: 0, ref: { tipo: "plano", id: "plb" } } };
  confere("até a superfície abaixo, sem inverter", regenerar([plAbaixo, ec, supAbaixo]).volume, Math.PI * 9 * 15);
  confere("até a superfície acima, com inverter ligado", regenerar([pl, ec, { ...sup, esboco: ec.id, inverter: true }]).volume, Math.PI * 9 * 25);
  const vAbaixo = ext(base, 1, { condicao: { tipo: "vertice", dist: 0, ref: { tipo: "vertice", p: [0, 0, -6] } } });
  confere("até o vértice abaixo (z=−6), sem inverter", regenerar([base, vAbaixo]).volume, 40 * 20 * 6);
  const dsAbaixo = { ...supAbaixo, condicao: { tipo: "deslocSuperficie", dist: 5, inverterDesloc: false, ref: { tipo: "plano", id: "plb" } } };
  confere("deslocamento da superfície abaixo (−15 + 5)", regenerar([plAbaixo, ec, dsAbaixo]).volume, Math.PI * 9 * 10);
  const inc = ext(base, 10, { inclinacao: { ativa: true, angulo: 5, paraFora: false } });
  const vi = regenerar([base, inc]).volume ?? 0;
  if (!(vi < 8000 && vi > 7000)) { falhas++; console.log("FALHA inclinação para dentro", vi); } else console.log("ok   inclinação 5° para dentro:", vi.toFixed(1));
  const fino = ext(base, 10, { fino: { ativo: true, tipo: "uma", t1: 2, t2: 2, inverter: true } });
  confere("recurso fino 2 para dentro", regenerar([base, fino]).volume, (40 * 20 - 36 * 16) * 10);
  const aberta = novoEsboco(3, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.linha(aberta, op.ponto(aberta, { x: 0, y: 0 }), op.ponto(aberta, { x: 30, y: 0 }));
  confere("fino em perfil aberto (plano médio)", regenerar([aberta, ext(aberta, 5, { fino: { ativo: true, tipo: "medio", t1: 2, t2: 2, inverter: false } })]).volume, 30 * 2 * 5);
  // contornos selecionados: retângulo + círculo separado, usa só o círculo
  const dois = retangulo(10, 10);
  op.circulo(dois, op.ponto(dois, { x: 30, y: 0 }), 3);
  confere("contornos selecionados (só o 1)", regenerar([dois, ext(dois, 2, { contornos: ["0"] })]).volume, Math.PI * 9 * 2);
  confere("lado do corte invertido", regenerar([base, bloco, furo, ext(furo, 10, { operacao: "cortar", inverterLadoCorte: true })]).volume, Math.PI * 16 * 10);
}

// ---------- revolução ----------
{
  const e = novoEsboco(4, { tipo: "plano", plano: "XZ", deslocamento: 0 });
  op.retangulo(e, op.ponto(e, { x: 10, y: 0 }), op.ponto(e, { x: 20, y: 10 }));
  const linha = op.linha(e, op.ponto(e, { x: 0, y: 0 }, ORIGEM), op.ponto(e, { x: 0, y: 20 }), true);
  const rev = { ...(novaFeature("revolucao", 1) as any), esboco: e.id, angulo: 90, eixo: { tipo: "linhaEsboco", esboco: e.id, geo: linha.id } };
  const quarto = Math.PI * (400 - 100) * 10 / 4;
  confere("revolução 90°", regenerar([e, rev]).volume, quarto);
  confere("revolução 90° + direção 2 45°", regenerar([e, { ...rev, direcao2: { ativa: true, angulo: 45 } }]).volume, quarto * 1.5);
  confere("revolução plano médio", regenerar([e, { ...rev, planoMedio: true }]).volume, quarto);
}

// ---------- filete, chanfro, casca, inclinação ----------
{
  const feats: Feature[] = [base, bloco];
  const verticais = arestasRetas(feats, (a) => Math.abs(a.a[2] - a.b[2]) > 5); // 4 arestas de 10
  const fil = { ...(novaFeature("filete", 1) as any), raio: 2, itens: verticais };
  confere("filete r2 nas 4 verticais", regenerar([...feats, fil]).volume, 8000 - 4 * (4 - Math.PI) * 10);
  const topo = face(feats, [0, 0, 1], [0, 0, 10]);
  const filFace = { ...fil, itens: [topo], raio: 1 };
  const vf = regenerar([...feats, filFace]);
  semErros("filete por face", vf);
  const ch = { ...(novaFeature("chanfro", 1) as any), distancia: 1, itens: verticais };
  confere("chanfro 1 nas verticais", regenerar([...feats, ch]).volume, 8000 - 4 * 0.5 * 10);
  const chA = { ...ch, assimetrico: true, distancia2: 2 };
  confere("chanfro assimétrico 1×2", regenerar([...feats, chA]).volume, 8000 - 4 * 1 * 10);
  const casca = { ...(novaFeature("casca", 1) as any), espessura: 1, faces: [topo] };
  confere("casca 1 sem o topo", regenerar([...feats, casca]).volume, 8000 - 38 * 18 * 9);
  const fechada = { ...casca, faces: [] };
  confere("casca fechada 1 (oca, sem faces)", regenerar([...feats, fechada]).volume, 8000 - 38 * 18 * 8);
  confere("casca fechada 1 para fora", regenerar([...feats, { ...fechada, paraFora: true }]).volume,
    // caixa 42×22×12 com arestas e cantos arredondados (r = 1) menos a original
    40 * 20 * 10 + 2 * (40 * 20 + 40 * 10 + 20 * 10) + Math.PI * (40 + 20 + 10) + (4 / 3) * Math.PI - 8000);
  const lados = [face(feats, [1, 0, 0], [20, 0, 5]), face(feats, [-1, 0, 0], [-20, 0, 5])];
  const incl = { ...(novaFeature("inclinacao", 1) as any), angulo: 3, faces: lados, planoNeutro: { tipo: "plano", id: "XY" } };
  const vd = regenerar([...feats, incl]);
  semErros("inclinação de faces", vd);
  console.log("     inclinação 3° nos lados: volume", vd.volume?.toFixed(1));
}

// ---------- nervura ----------
{
  // L: base 40×20×5 + parede 5×20×30; nervura diagonal no plano frontal
  const b1 = retangulo(40, 20);
  const e1 = ext(b1, 5);
  const p = retangulo(5, 20, "XY", -17.5, 0);
  const e2 = ext(p, 30);
  const s = novoEsboco(5, { tipo: "plano", plano: "XZ", deslocamento: 0 });
  op.linha(s, op.ponto(s, { x: -15, y: 25 }), op.ponto(s, { x: 15, y: 5 }));
  const nerv = { ...(novaFeature("nervura", 1) as any), esboco: s.id, espessura: 4, inverterMaterial: false };
  const v0 = regenerar([b1, e1, p, e2]).volume!;
  const r = regenerar([b1, e1, p, e2, s, nerv]);
  semErros("nervura", r);
  const ganho = (r.volume ?? 0) - v0;
  // triângulo de catetos 30 (x) × 20 (z) × 4 de espessura
  confere("nervura (volume acrescentado)", ganho, 0.5 * 30 * 20 * 4, 0.02);
}

// ---------- furo ISO ----------
{
  const feats: Feature[] = [base, bloco];
  const topo = face(feats, [0, 0, 1], [0, 0, 10]);
  const pos = novoEsboco(6, { tipo: "face", origem: [0, 0, 10], normal: [0, 0, 1], eixoX: [1, 0, 0] });
  op.pontoSolto(pos, op.ponto(pos, { x: -10, y: 0 }));
  op.pontoSolto(pos, op.ponto(pos, { x: 10, y: 0 }));
  void topo;
  const furo = { ...(novaFeature("furo", 1) as any), esboco: pos.id, tamanho: "M6", tipoFuro: "simples", condicao: { tipo: "passante", profundidade: 0, anguloPonta: 118 } };
  const d = medidasFuro(furo).diametro;
  confere("furo M6 normal passante ×2 (Ø6,6)", regenerar([...feats, pos, furo]).volume, 8000 - 2 * Math.PI * (d / 2) ** 2 * 10);
  const reb = { ...furo, tipoFuro: "rebaixado" };
  const m = medidasFuro(reb);
  confere("furo rebaixado M6 ×2", regenerar([...feats, pos, reb]).volume,
    8000 - 2 * (Math.PI * (m.diamRebaixo / 2) ** 2 * m.profRebaixo + Math.PI * (m.diametro / 2) ** 2 * (10 - m.profRebaixo)));
  const ros = { ...furo, tipoFuro: "roscado", condicao: { tipo: "cego", profundidade: 6, anguloPonta: 118 } };
  confere("broca de rosca M6 = 5,0", medidasFuro(ros).diametro, 5);
  semErros("furo roscado cego", regenerar([...feats, pos, ros]));
}

// ---------- padrões, espelho, referências ----------
{
  const pino = circulo(2, -15, 0);
  const corte = ext(pino, 10, { operacao: "cortar", inverter: false });
  const feats: Feature[] = [base, bloco, pino, { ...corte, de: { tipo: "deslocamento", dist: 0, inverter: false } }];
  const v1 = 8000 - Math.PI * 4 * 10;
  confere("semente do padrão", regenerar(feats).volume, v1);
  const arestaX = arestasRetas(feats, (a) => Math.abs(a.a[1] - a.b[1]) < 1e-6 && Math.abs(a.a[2] - a.b[2]) < 1e-6)[0];
  const lin = { ...(novaFeature("padraoLinear", 1) as any), recursos: [corte.id], dir1: { ref: { tipo: "eixo", id: "X" }, inverter: false, espacamento: 10, instancias: 4 } };
  void arestaX;
  confere("padrão linear ×4", regenerar([...feats, lin]).volume, 8000 - 4 * Math.PI * 4 * 10);
  confere("padrão linear pulando 1", regenerar([...feats, { ...lin, pular: ["2,0"] }]).volume, 8000 - 3 * Math.PI * 4 * 10);
  const circ = { ...(novaFeature("padraoCircular", 1) as any), recursos: [corte.id], eixo: { tipo: "eixo", id: "Z" }, instancias: 2, angulo: 360, igual: true };
  confere("padrão circular ×2", regenerar([...feats, circ]).volume, 8000 - 2 * Math.PI * 4 * 10);
  const esp = { ...(novaFeature("espelhar", 1) as any), recursos: [corte.id], plano: { tipo: "plano", id: "YZ" } };
  confere("espelhar no plano lateral", regenerar([...feats, esp]).volume, 8000 - 2 * Math.PI * 4 * 10);
  const espCorpo = { ...(novaFeature("espelhar", 1) as any), corpo: true, plano: face([base, bloco], [1, 0, 0], [20, 0, 5]) };
  confere("espelhar corpo na face lateral", regenerar([base, bloco, espCorpo]).volume, 16000);
  const eixo = { ...(novaFeature("eixoRef", 1) as any), id: "ex", modo: "doisPlanos", ref1: { tipo: "plano", id: "XZ" }, ref2: { tipo: "plano", id: "YZ" } };
  const r = regenerar([eixo]);
  const e = r.referencias.find((x) => x.id === "ex");
  confere("eixo de 2 planos ∥ Z", e && e.tipo === "eixo" ? Math.abs(e.dir[2]) : 0, 1);
  const planoAng = { ...(novaFeature("planoRef", 1) as any), id: "pa", modo: "angulo", ref1: { tipo: "plano", id: "XZ" }, ref2: { tipo: "eixo", id: "Z" }, angulo: 90 };
  const pa = regenerar([planoAng]).referencias.find((x) => x.id === "pa");
  confere("plano a 90° do frontal em Z: |nx|", pa && pa.tipo === "plano" ? Math.abs(pa.ref.normal[0]) : 0, 1);
}

// ---------- referência persistente sobrevive a mudança de cota ----------
{
  const b = retangulo(40, 20);
  const blocoA = ext(b, 10);
  const topo = face([b, blocoA], [0, 0, 1], [0, 0, 10]);
  const casca = { ...(novaFeature("casca", 1) as any), espessura: 1, faces: [topo] };
  const blocoB = { ...blocoA, profundidade: 12 };
  confere("casca segue a face após mudar a altura", regenerar([b, blocoB, casca]).volume, 40 * 20 * 12 - 38 * 18 * 11, 0.01);
  void topologia;
}

// ---------- avaliar ----------
{
  const { massa, medir, verificar } = await import("../src/kernel/avaliar");
  const { pecaAtual } = await import("../src/kernel/regenerar");
  const r = regenerar([base, bloco]);
  const mp = massa(pecaAtual());
  confere("massa: volume", mp.volume, 8000);
  confere("massa: área", mp.area, 2 * (40 * 20 + 40 * 10 + 20 * 10));
  confere("massa: Izz (densidade 1)", mp.inercia[2], (8000 * (40 * 40 + 20 * 20)) / 12);
  confere("massa: produto Ixy ≈ 0", mp.inercia[3], 0, 1e-6);
  confere("massa: principal menor = Ixx", mp.principais[0], (8000 * (20 * 20 + 10 * 10)) / 12);
  const topo = r.topologia!;
  const faces = topo.faces.filter((f) => f.normal && Math.abs(f.normal[2]) > 0.99);
  const m = medir(pecaAtual(), faces.map((ass) => ({ tipo: "face", ass })) as never);
  const dist = m.linhas.find((l) => l.rotulo === "Distância mínima")?.valor ?? "";
  confere("medir: distância entre topo e base", parseFloat(dist.replace(",", ".")), 10);
  const v = verificar(pecaAtual());
  if (!v.valida || v.faces !== 6 || v.arestas !== 12) { falhas++; console.log("FALHA verificar", v); } else console.log("ok   verificar: válida, 6 faces, 12 arestas");
}

// ---------- excluir pai leva os filhos ----------
{
  const e1 = retangulo(40, 20);
  const x1 = ext(e1, 10);
  const pl = { ...(novaFeature("planoRef", 1) as any), id: "plx", ref1: { tipo: "plano", id: "XY" }, distancia: 10 };
  const e2 = { ...circulo(3), id: "e2x", suporte: { tipo: "planoRef" as const, id: "plx" } };
  const x2 = ext(e2, 5);
  const pad = { ...(novaFeature("padraoLinear", 1) as any), recursos: [x2.id] };
  const feats: Feature[] = [e1, x1, pl, e2, x2, pad];
  const f1 = filhosDe(feats, pl.id).map((f) => f.id);
  const ok1 = f1.length === 3 && [e2.id, x2.id, pad.id].every((i) => f1.includes(i));
  if (!ok1) falhas++;
  console.log(`${ok1 ? "ok  " : "FALHA"} filhos do plano: esboço, extrusão e padrão (${f1.length})`);
  const f2 = filhosDe(feats, e1.id).map((f) => f.id);
  const ok2 = f2.length === 1 && f2[0] === x1.id;
  if (!ok2) falhas++;
  console.log(`${ok2 ? "ok  " : "FALHA"} filho do esboço: a extrusão`);
  const abs = absorvidosDe(feats, new Set([x1.id]));
  const ok3 = abs.length === 1 && abs[0].id === e1.id;
  if (!ok3) falhas++;
  console.log(`${ok3 ? "ok  " : "FALHA"} esboço absorvido pela extrusão`);
  const doc = { formato: "jlscad", versao: 2, nome: "t", features: [...feats], retrocesso: 5, equacoes: { [`${x2.id}.profundidade`]: "=2" } } as any;
  excluirRecursos(doc, new Set([pl.id, ...f1]));
  const ok4 = doc.features.length === 2 && doc.retrocesso === undefined && !Object.keys(doc.equacoes).length;
  if (!ok4) falhas++;
  console.log(`${ok4 ? "ok  " : "FALHA"} excluir: sobra base, retrocesso e equações ajustados`);
}

// ---------- faces de cada recurso (destaque na árvore) ----------
{
  const d = documentoExemplo();
  const r = regenerar(d.features);
  const n = d.features.map((f) => r.facesPorRecurso[f.id]?.length ?? 0);
  const ok = n[0] === 6 && n[1] === 2 && n[2] === 1;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} faces por recurso (base 6, ressalto 2, furo 1): ${n.join(", ")}`);
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`);
  process.exit(1);
}
console.log("\nrecursos: tudo certo");
