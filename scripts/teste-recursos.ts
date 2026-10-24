// Teste dos recursos da Fase 3 em Node: condições finais, direção 2, inclinação, recurso fino,
// filete/chanfro por aresta, casca, inclinação de faces, nervura, furo ISO, padrões, espelho,
// planos/eixos de referência. Volumes conferidos com conta de mão.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import {
  documentoExemplo, novaFeature, novoEsboco, validarDocumento, type Feature, type FeatureEsboco, type FeatureExtrusao, type Referencia,
} from "../src/model";
import { regenerar } from "../src/kernel/regenerar";
import { medidasFuro } from "../src/kernel/furos";
import { topologia } from "../src/kernel/topologia";
import * as op from "../src/esboco/operacoes";
import { ORIGEM } from "../src/esboco/geometria";
import { absorvidosDe, excluirRecursos, filhosDe } from "../src/dependencias";
import {
  ativarConfiguracao, configurarParametro, definirSupressao, definirValorNaConfiguracao, excluirConfiguracao, listarParametros,
  novaConfiguracao, prepararConfiguracoes,
} from "../src/configuracoes";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));

let falhas = 0;
function confere(nome: string, obtido: number | null | undefined, esperado: number, tol = 2e-3) {
  const v = obtido ?? NaN;
  const ok = Math.abs(v - esperado) <= tol * Math.max(1, Math.abs(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${v.toFixed(2)} (esperado ${esperado.toFixed(2)})`);
}
function verdade(nome: string, v: boolean) {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}`);
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
  // L (Y para cima): base 40×20×5 no Superior + parede 5×20×30; nervura diagonal no Frontal
  const b1 = retangulo(40, 20, "XZ");
  const e1 = ext(b1, 5);
  const p = retangulo(5, 20, "XZ", -17.5, 0);
  const e2 = ext(p, 30);
  const s = novoEsboco(5, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.linha(s, op.ponto(s, { x: -15, y: 25 }), op.ponto(s, { x: 15, y: 5 }));
  const nerv = { ...(novaFeature("nervura", 1) as any), esboco: s.id, espessura: 4, inverterMaterial: false };
  const v0 = regenerar([b1, e1, p, e2]).volume!;
  const r = regenerar([b1, e1, p, e2, s, nerv]);
  semErros("nervura", r);
  const ganho = (r.volume ?? 0) - v0;
  // triângulo de catetos 30 (x) × 20 (y) × 4 de espessura
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

// ---------- arquivo antigo (Z para cima) aberto com Y para cima ----------
{
  const e = retangulo(40, 20, "XY");
  const x = ext(e, 10);
  const antes = regenerar([e, x]);
  const d = validarDocumento(JSON.parse(JSON.stringify({ formato: "cad-tablet", versao: 2, nome: "antigo", features: [e, x] })));
  const sup = (d.features[0] as FeatureEsboco).suporte;
  const depois = regenerar(d.features);
  const ys = depois.topologia!.vertices.map((v) => v[1]);
  const ok = sup.tipo === "plano" && sup.plano === "XZ" && Math.abs((depois.volume ?? 0) - (antes.volume ?? 0)) < 1e-6
    && Math.abs(Math.max(...ys) - Math.min(...ys) - 10) < 1e-6 && d.versao === 3;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} migração: esboço vai para o Superior e a altura fica em Y`);
}

// ---------- varredura ----------
{
  const circ = (r: number, plano: "XY" | "XZ" | "YZ" = "XZ", cx = 0, cy = 0, desl = 0) => {
    const e = novoEsboco(1, { tipo: "plano", plano, deslocamento: desl });
    op.circulo(e, op.ponto(e, { x: cx, y: cy }), r);
    return e;
  };
  const linhas = (pts: [number, number][], plano: "XY" | "XZ" | "YZ" = "XY") => {
    const e = novoEsboco(2, { tipo: "plano", plano, deslocamento: 0 });
    const ids = pts.map((p) => op.ponto(e, { x: p[0], y: p[1] }));
    for (let i = 0; i + 1 < ids.length; i++) op.linha(e, ids[i], ids[i + 1]);
    return e;
  };
  const sw = (o: object) => ({ ...(novaFeature("varredura", 1) as any), ...o });
  const esb = (e: FeatureEsboco) => ({ tipo: "esboco", id: e.id });
  const A = Math.PI * 25;
  const p = circ(5), L = linhas([[0, 0], [0, 50], [40, 50]]);
  confere("varredura: perfil de esboço em L (canto vivo)", regenerar([p, L, sw({ perfil: esb(p), trajetoria: [esb(L)] })]).volume, A * 90);
  confere("varredura: perfil circular Ø10 em L", regenerar([L, sw({ tipoPerfil: "circular", diametro: 10, trajetoria: [esb(L)] })]).volume, A * 90);
  const arco = novoEsboco(3, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.arco(arco, op.ponto(arco, { x: 30, y: 0 }), op.ponto(arco, { x: 30, y: 30 }), op.ponto(arco, { x: 0, y: 0 }));
  confere("varredura: arco R30 (Pappus)", regenerar([p, arco, sw({ perfil: esb(p), trajetoria: [esb(arco)] })]).volume, A * (Math.PI / 2) * 30);
  const reta = linhas([[0, 0], [0, 50]]);
  confere("varredura: recurso fino 1 para dentro (tubo)", regenerar([p, reta, sw({ perfil: esb(p), trajetoria: [esb(reta)], fino: { ativo: true, tipo: "uma", t1: 1, t2: 1, inverter: true } })]).volume, Math.PI * (25 - 16) * 50);
  confere("varredura: circular fino plano médio 2 (tubo)", regenerar([reta, sw({ tipoPerfil: "circular", diametro: 10, trajetoria: [esb(reta)], fino: { ativo: true, tipo: "medio", t1: 2, t2: 2, inverter: false } })]).volume, Math.PI * (36 - 16) * 50);
  const guia = linhas([[5, 0], [10, 50]]);
  confere("varredura: curva-guia (tronco de cone)", regenerar([p, reta, guia, sw({ perfil: esb(p), trajetoria: [esb(reta)], guias: [esb(guia)] })]).volume, (Math.PI / 3) * 50 * (25 + 50 + 100));
  const tang = regenerar([p, reta, guia, sw({ perfil: esb(p), trajetoria: [esb(reta)], guias: [esb(guia)], tangenciaInicio: "trajetoria", tangenciaFim: "trajetoria" })]);
  semErros("varredura: tangência início/fim", tang);
  const guiaL = linhas([[5, 0], [5, 45], [40, 45]]);
  const separadas = regenerar([p, L, guiaL, sw({ perfil: esb(p), trajetoria: [esb(L)], guias: [esb(guiaL)], mesclarFacesSuaves: false })]);
  semErros("varredura: guia em L com faces separadas", separadas);
  // corte: canal semicircular R2 no topo de um bloco 40×10×20 (Y para cima)
  const b = retangulo(40, 20, "XZ");
  const blocoY = ext(b, 10);
  const canal = linhas([[-20, 10], [20, 10]]);
  const pc = circ(2, "YZ", 0, 10, -20);
  const corte = sw({ operacao: "cortar", perfil: esb(pc), trajetoria: [esb(canal)] });
  confere("corte por varredura: canal R2", regenerar([b, blocoY, canal, pc, corte]).volume, 8000 - (Math.PI * 4 / 2) * 40);
  // trajetória por aresta do modelo: quarto de cilindro R2 tirado da aresta superior frontal (z = 10)
  const aresta = arestasRetas([b, blocoY], (a) => Math.abs(a.a[1] - 10) < 1e-6 && Math.abs(a.b[1] - 10) < 1e-6 && Math.abs(a.a[2] - 10) < 1e-6 && Math.abs(a.b[2] - 10) < 1e-6);
  const pa = circ(2, "YZ", -10, 10, -20);
  confere("corte por varredura: trajetória = aresta do modelo", regenerar([b, blocoY, pa, sw({ operacao: "cortar", perfil: esb(pa), trajetoria: aresta })]).volume, 8000 - (Math.PI * 4 / 4) * 40);
}

// ---------- loft ----------
{
  const quad = (l: number, y: number) => {
    const e = novoEsboco(1, { tipo: "plano", plano: "XZ", deslocamento: y });
    op.retangulo(e, op.ponto(e, { x: -l / 2, y: -l / 2 }), op.ponto(e, { x: l / 2, y: l / 2 }));
    return e;
  };
  const circ = (r: number, y: number) => {
    const e = novoEsboco(2, { tipo: "plano", plano: "XZ", deslocamento: y });
    op.circulo(e, op.ponto(e, { x: 0, y: 0 }), r);
    return e;
  };
  const lf = (o: object) => ({ ...(novaFeature("loft", 1) as any), ...o });
  const E = (e: FeatureEsboco) => ({ tipo: "esboco", id: e.id });
  const qa = quad(20, 0), qb = quad(10, 30);
  confere("loft: tronco de pirâmide 20→10, h30", regenerar([qa, qb, lf({ perfis: [E(qa), E(qb)] })]).volume, (30 / 3) * (400 + 100 + 200));
  const ca = circ(10, 0), cb = circ(5, 30);
  confere("loft: tronco de cone", regenerar([ca, cb, lf({ perfis: [E(ca), E(cb)] })]).volume, (Math.PI / 3) * 30 * (100 + 50 + 25));
  const cc = circ(8, 30);
  semErros("loft: quadrado → círculo", regenerar([qa, cc, lf({ perfis: [E(qa), E(cc)] })]));
  const norm = regenerar([qa, cc, lf({ perfis: [E(qa), E(cc)], restricaoInicio: { tipo: "normal", comprimento: 1, inverter: false }, restricaoFim: { tipo: "normal", comprimento: 1, inverter: false } })]);
  semErros("loft: restrição normal ao perfil", norm);
  semErros("loft: restrição vetor de direção", regenerar([qa, cc, lf({ perfis: [E(qa), E(cc)], restricaoInicio: { tipo: "vetor", ref: { tipo: "eixo", id: "Y" }, comprimento: 1, inverter: false } })]));
  semErros("loft: recurso fino", regenerar([qa, cc, lf({ perfis: [E(qa), E(cc)], fino: { ativo: true, tipo: "uma", t1: 1, t2: 1, inverter: true } })]));
  // cilindro R10 com guia que estufa até R18 no meio: volume maior que o cilindro
  const c1 = circ(10, 0), c2 = circ(10, 30);
  const g = novoEsboco(3, { tipo: "plano", plano: "XY", deslocamento: 0 });
  const g0 = op.ponto(g, { x: 10, y: 0 }), g1 = op.ponto(g, { x: 18, y: 15 }), g2 = op.ponto(g, { x: 10, y: 30 });
  op.linha(g, g0, g1);
  op.linha(g, g1, g2);
  const vg = regenerar([c1, c2, g, lf({ perfis: [E(c1), E(c2)], guias: [E(g)], influenciaGuias: "proximaGuia" })]);
  const okG = !vg.erros.length && (vg.volume ?? 0) > Math.PI * 100 * 30 * 1.05;
  if (!okG) falhas++;
  console.log(`${okG ? "ok  " : "FALHA"} loft: curva-guia estufa o perfil (${vg.volume?.toFixed(0)} > cilindro ${(Math.PI * 100 * 30).toFixed(0)})`);
  const lc = novoEsboco(4, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.linha(lc, op.ponto(lc, { x: 0, y: 0 }), op.ponto(lc, { x: 0, y: 30 }));
  confere("loft: linha de centro reta (cilindro)", regenerar([c1, c2, lc, lf({ perfis: [E(c1), E(c2)], linhaCentro: [E(lc)], secoesLinhaCentro: 10 })]).volume, Math.PI * 100 * 30);
  const q3 = quad(14, 20), q4 = quad(20, 40);
  semErros("loft: 3 perfis", regenerar([qa, q3, q4, lf({ perfis: [E(qa), E(q3), E(q4)] })]));
  semErros("loft: fechar loft (anel)", regenerar([qa, q3, q4, lf({ perfis: [E(qa), E(q3), E(q4)], fecharLoft: false })]));
  const corteL = lf({ operacao: "cortar", perfis: [E(circ(5, 0)), E(circ(5, 10))] });
  void corteL;
}

// ---------- curvas 3D (hélice, pontos XYZ, pontos de referência, composta, projetada) ----------
{
  const curva = (o: object) => ({ ...(novaFeature("curva", 1) as any), ...o });
  const sw = (o: object) => ({ ...(novaFeature("varredura", 1) as any), ...o });
  const esb = (e: FeatureEsboco) => ({ tipo: "esboco", id: e.id }) as Referencia;
  const comp = (pl: number[][]) => pl.reduce((t, p, k) => (k ? t + Math.hypot(p[0] - pl[k - 1][0], p[1] - pl[k - 1][1], p[2] - pl[k - 1][2]) : 0), 0);
  const linhasDe = (r: ReturnType<typeof regenerar>, id: string) => (r.referencias.find((x) => x.id === id) as { linhas: number[][][] } | undefined)?.linhas ?? [];

  // hélice: círculo R10 no plano Superior (normal +Y), passo 5, 4 voltas → sobe 20 em Y
  const base = circulo(10, 0, 0, "XZ");
  const h = curva({ modo: "helice", base: esb(base), definicao: "passoRevolucao", passo: 5, revolucoes: 4 });
  const rh = regenerar([base, h]);
  semErros("hélice", rh);
  const lh = linhasDe(rh, h.id).flat();
  confere("hélice: comprimento 4·√((2π·10)² + 5²)", comp(lh), 4 * Math.hypot(2 * Math.PI * 10, 5), 5e-3);
  confere("hélice: altura final", lh[lh.length - 1][1], 20);
  confere("hélice: raio constante", Math.hypot(lh[37][0], lh[37][2]), 10);
  // mola: perfil circular Ø2 varrido ao longo da hélice ≈ π·1²·comprimento
  const mola = regenerar([base, h, sw({ tipoPerfil: "circular", diametro: 2, trajetoria: [{ tipo: "curva", id: h.id }] })]);
  semErros("mola (varredura na hélice)", mola);
  confere("mola: volume ≈ π·1²·comprimento da hélice", mola.volume, Math.PI * 4 * Math.hypot(2 * Math.PI * 10, 5), 1e-2);
  const hc = curva({ modo: "helice", base: esb(base), definicao: "alturaRevolucao", altura: 20, revolucoes: 2, conica: { ativa: true, angulo: 10, paraFora: true } });
  const lc = linhasDe(regenerar([base, hc]), hc.id).flat();
  confere("hélice cônica: raio no topo = 10 + 20·tan 10°", Math.hypot(lc[lc.length - 1][0], lc[lc.length - 1][2]), 10 + 20 * Math.tan(Math.PI / 18));
  const esp = curva({ modo: "helice", base: esb(base), definicao: "espiral", passo: 3, revolucoes: 2 });
  const le = linhasDe(regenerar([base, esp]), esp.id).flat();
  confere("espiral: raio final 10 + 2·3", Math.hypot(le[le.length - 1][0], le[le.length - 1][2]), 16);
  confere("espiral: plana", Math.max(...le.map((p) => Math.abs(p[1]))), 0);

  // curva por pontos XYZ como trajetória: reta (0,0,0)→(0,30,0), perfil Ø4 no plano Superior
  const xyz = curva({ modo: "xyz", pontosTexto: "0; 0; 0\n0; 30; 0" });
  confere("curva XYZ como trajetória da varredura", regenerar([xyz, sw({ tipoPerfil: "circular", diametro: 4, trajetoria: [{ tipo: "curva", id: xyz.id }] })]).volume, Math.PI * 4 * 30);
  const xyz3 = curva({ modo: "xyz", pontosTexto: "0;0;0\n10;20;5\n30,5\t25\t-5\n40; 40; 0" });
  const l3 = linhasDe(regenerar([xyz3]), xyz3.id);
  const fimDe = (pl: number[][]) => pl[pl.length - 1];
  confere("curva XYZ passa pelo 3º ponto (x)", fimDe(l3[1])[0], 30.5);
  confere("curva XYZ passa pelo 3º ponto (z)", fimDe(l3[1])[2], -5);
  verdade("curva XYZ: tabela inválida vira erro", regenerar([curva({ modo: "xyz", pontosTexto: "1; 2" })]).erros.length === 1);

  // curva composta de dois esboços que se tocam (L) = mesma varredura que o esboço em L único
  const e1 = novoEsboco(3, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.linha(e1, op.ponto(e1, { x: 0, y: 0 }), op.ponto(e1, { x: 0, y: 50 }));
  const e2 = novoEsboco(4, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.linha(e2, op.ponto(e2, { x: 0, y: 50 }), op.ponto(e2, { x: 40, y: 50 }));
  const cmp = curva({ modo: "composta", itens: [esb(e2), esb(e1)] });
  confere("curva composta como trajetória (L 50 + 40)", regenerar([e1, e2, cmp, sw({ tipoPerfil: "circular", diametro: 10, trajetoria: [{ tipo: "curva", id: cmp.id }] })]).volume, Math.PI * 25 * 90);
  const e3 = novoEsboco(5, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.linha(e3, op.ponto(e3, { x: 100, y: 0 }), op.ponto(e3, { x: 120, y: 0 }));
  verdade("curva composta com vão vira erro", regenerar([e1, e3, curva({ modo: "composta", itens: [esb(e1), esb(e3)] })]).erros.length === 1);

  // pontos de referência: cantos de um bloco
  const blocoE = retangulo(40, 40, "XZ");
  const bloco = ext(blocoE, 20);
  const pr = curva({ modo: "pontosRef", pontos: [[-20, 20, -20], [20, 20, -20], [20, 20, 20]].map((p) => ({ tipo: "vertice", p })) });
  const lpr = linhasDe(regenerar([blocoE, bloco, pr]), pr.id);
  confere("curva por pontos de referência: termina no último vértice", fimDe(lpr[lpr.length - 1])[2], 20);

  // projetada: círculo R10 no plano Superior (y = 0) projetado na face de cima do bloco (y = 20)
  const cp = circulo(10, 0, 0, "XZ");
  const topo = face([blocoE, bloco], [0, 1, 0], [0, 20, 0]);
  const proj = curva({ modo: "projetada", projecao: "esbocoEmFaces", esboco: esb(cp), faces: [topo] });
  const rp = regenerar([blocoE, bloco, cp, proj]);
  semErros("curva projetada em face", rp);
  const lp = linhasDe(rp, proj.id).flat();
  confere("curva projetada: na face de cima (y = 20)", Math.min(...lp.map((p) => p[1])), 20);
  confere("curva projetada: raio 10", Math.hypot(lp[5][0], lp[5][2]), 10);

  // esboço em esboço: cilindro R10 (círculo no Frontal) × plano y = 5 (linha no Lateral)
  const s1 = circulo(10, 0, 0, "XY");
  const s2 = novoEsboco(6, { tipo: "plano", plano: "YZ", deslocamento: 0 });
  op.linha(s2, op.ponto(s2, { x: -30, y: 5 }), op.ponto(s2, { x: 30, y: 5 }));
  const cx = curva({ modo: "projetada", projecao: "esbocoEmEsboco", esboco: esb(s1), esboco2: esb(s2) });
  const rx = regenerar([s1, s2, cx]);
  semErros("esboço em esboço", rx);
  const lx = linhasDe(rx, cx.id).flat();
  confere("esboço em esboço: y = 5", Math.max(...lx.map((p) => Math.abs(p[1] - 5))) + 5, 5);
  confere("esboço em esboço: |x| = √(100 − 25)", Math.abs(lx[0][0]), Math.sqrt(75));
}

// ---------- configurações da peça ----------
{
  const doc = documentoExemplo();
  const vol = () => regenerar(doc.features.filter((f) => !f.suprimida)).volume ?? 0;
  const base = doc.features.find((f) => f.nome === "Base") as FeatureExtrusao;
  const furo = doc.features.find((f) => f.nome === "Furo central")!;
  const v0 = vol();
  const padrao = prepararConfiguracoes(doc);
  verdade("configuração Padrão criada e ativa", doc.configAtiva === padrao.id && padrao.nome === "Padrão");
  configurarParametro(doc, `${base.id}.profundidade`);
  const longa = novaConfiguracao(doc, "Longa");
  definirValorNaConfiguracao(doc, longa, `${base.id}.profundidade`, base.profundidade * 2);
  definirSupressao(doc, longa, furo.id, true);
  verdade("editar a configuração inativa não mexe na peça", vol() === v0);
  ativarConfiguracao(doc, longa.id);
  confere("ativar Longa: profundidade dobra", base.profundidade, (padrao.valores[`${base.id}.profundidade`] ?? 0) * 2);
  verdade("ativar Longa: furo suprimido", !!furo.suprimida);
  verdade("Longa tem mais volume", vol() > v0);
  // mudar ao vivo na ativa e voltar: o valor fica guardado na Longa
  base.profundidade = 33;
  ativarConfiguracao(doc, padrao.id);
  verdade("voltar à Padrão: valores e supressão originais", vol() === v0 && !furo.suprimida);
  confere("valor ao vivo da Longa foi guardado", longa.valores[`${base.id}.profundidade`], 33);
  // cota de esboço configurada (chave esboço#cota) e lista de parâmetros
  const ps = listarParametros(doc);
  verdade("lista de parâmetros inclui valores de recursos", ps.some((p) => p.chave === `${base.id}.profundidade` && p.rotulo === "D1@Base"));
  const e = novoEsboco(9, { tipo: "plano", plano: "XY", deslocamento: 0 });
  const l = op.linha(e, op.ponto(e, { x: 0, y: 0 }), op.ponto(e, { x: 10, y: 0 }));
  const cota = op.restringir(e, { tipo: "distancia", a: l.id, valor: 10 });
  doc.features.push(e);
  configurarParametro(doc, `${e.id}#${cota}`);
  definirValorNaConfiguracao(doc, longa, `${e.id}#${cota}`, 25);
  const alterados = ativarConfiguracao(doc, longa.id);
  verdade("cota configurada: esboço marcado para resolver", alterados.includes(e.id));
  confere("cota configurada: valor da Longa", (e.restricoes.find((r) => r.id === cota) as { valor: number }).valor, 25);
  // excluir a ativa volta para a primeira
  excluirConfiguracao(doc, longa.id);
  verdade("excluir a ativa: volta para a Padrão", doc.configAtiva === padrao.id && doc.configuracoes!.length === 1 && !furo.suprimida);
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`);
  process.exit(1);
}
console.log("\nrecursos: tudo certo");
