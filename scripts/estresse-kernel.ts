// Testador de estresse do kernel (Node): para cada tipo de recurso, monta uma peça de base,
// preenche as seleções obrigatórias e percorre o painel do comando inteiro — cada opção de cada
// lista, cada caixa de seleção, cada caixa opcional e valores extremos em cada número
// (0, negativo, minúsculo, enorme, expressão inválida) —, regenerando a peça a cada mudança.
// Depois monta uma peça longa com todos os recursos juntos, suprime cada um e embaralha a ordem.
//   pnpm estresse            (completo)
//   pnpm estresse rapido     (menos valores por campo)
// Confere: a regeneração nunca estoura; mensagem de erro sempre legível (nada de "undefined",
// "TypeError", objeto cru…); sem erro → volume finito e positivo; tempo por regeneração.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { novaFeature, novoEsboco, type Feature, type FeatureEsboco, type Referencia } from "../src/model";
import { regenerar } from "../src/kernel/regenerar";
import { esquemaDe, type DadosEsquema } from "../src/ui/esquemas";
import { gravar, ler, type Campo } from "../src/ui/formulario";
import { aninhamento, encontrarLacos } from "../src/esboco/geometria";
import * as op from "../src/esboco/operacoes";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));

const rapido = process.argv.includes("rapido");
const TEMPO_LENTO = 8000; // ms por regeneração
const achados: string[] = [];
const lentos: string[] = [];
let regeneracoes = 0;
const ruim = /undefined|null\b|NaN|TypeError|ReferenceError|is not a function|Cannot read|\[object|WebAssembly\.|RuntimeError/;

function achar(msg: string) {
  if (!achados.includes(msg)) achados.push(msg);
}

/** Regenera e confere as regras; devolve o resultado (ou null se estourou). */
function rodar(onde: string, feats: Feature[], alvo?: string, opcoes: { planificar?: boolean } = {}) {
  const t0 = performance.now();
  let r: ReturnType<typeof regenerar>;
  try {
    r = regenerar(JSON.parse(JSON.stringify(feats)), 0.1, opcoes);
  } catch (e) {
    achar(`ESTOUROU ${onde}: ${(e as Error).message}`);
    return null;
  }
  regeneracoes++;
  const ms = performance.now() - t0;
  if (ms > TEMPO_LENTO) lentos.push(`${(ms / 1000).toFixed(1)} s ${onde}`);
  for (const e of r.erros) if (ruim.test(e.mensagem) || !e.mensagem.trim()) achar(`MENSAGEM ${onde}: "${e.mensagem}"`);
  const falhou = alvo && r.erros.some((e) => e.id === alvo);
  if (!falhou && r.malha && !(Number.isFinite(r.volume ?? 0) && (r.volume ?? 1) >= 0)) achar(`VOLUME ${onde}: ${r.volume}`);
  const geraSolido = feats.some((f) => !f.suprimida && !["esboco", "planoRef", "eixoRef", "curva"].includes(f.tipo));
  if (!r.malha && !r.erros.length && geraSolido) achar(`SEM PEÇA ${onde} (e nenhum recurso com erro)`);
  return r;
}

// ---------- peças de base ----------
const face = (z: number) => ({ tipo: "face", origem: [0, 0, z], normal: [0, 0, 1], eixoX: [1, 0, 0] }) as any;
let n = 1;
function esb(suporte: any, desenhar: (e: FeatureEsboco) => void): FeatureEsboco {
  const e = novoEsboco(n++, suporte);
  desenhar(e);
  return e;
}
const P = (e: FeatureEsboco, x: number, y: number) => op.ponto(e, { x, y });

// sólido: bloco 100 × 60 × 30 (Frontal, para +Z)
const sBloco = esb({ tipo: "plano", plano: "XY", deslocamento: 0 }, (e) => void op.retangulo(e, P(e, -50, -30), P(e, 50, 30)));
const bloco = { ...(novaFeature("extrusao", 1) as any), nome: "Bloco", esboco: sBloco.id, profundidade: 30 };
const sRet = esb(face(30), (e) => void op.retangulo(e, P(e, -15, -10), P(e, 15, 10)));
const sCirc = esb(face(30), (e) => void op.circulo(e, P(e, 30, 15), 6));
const sCirc2 = esb({ tipo: "plano", plano: "XY", deslocamento: 60 }, (e) => void op.circulo(e, P(e, 30, 15), 4));
const sAberto = esb({ tipo: "plano", plano: "YZ", deslocamento: 0 }, (e) => void op.linha(e, P(e, -20, 45), P(e, 20, 45)));
const sRev = esb({ tipo: "plano", plano: "XY", deslocamento: 0 }, (e) => {
  op.retangulo(e, P(e, 60, 0), P(e, 70, 20));
  op.linha(e, P(e, 0, -10), P(e, 0, 40), true);
});
const sTraj = esb({ tipo: "plano", plano: "YZ", deslocamento: 30 }, (e) => void op.linha(e, P(e, 15, 30), P(e, 15, 80)));
const sPontos = esb(face(30), (e) => {
  op.pontoSolto(e, P(e, -30, -15));
  op.pontoSolto(e, P(e, 30, -15));
});
const sLinhaChapa = esb(face(2), (e) => void op.linha(e, P(e, 60, -10), P(e, 60, 60)));
const sFurosChapa = esb(face(2), (e) => void op.circulo(e, P(e, 20, 20), 4));
const solidos: Feature[] = [sBloco, bloco, sRet, sCirc, sCirc2, sAberto, sRev, sTraj, sPontos];

// chapa: placa 100 × 50 × 2 e duas abas que se encontram num canto
const sPlaca = esb({ tipo: "plano", plano: "XY", deslocamento: 0 }, (e) => void op.retangulo(e, P(e, 0, 0), P(e, 100, 50)));
const placa = { ...(novaFeature("flangeBase", 1) as any), esboco: sPlaca.id };
const rPlaca = regenerar([sPlaca, placa]);
const borda = (fn: (p: number[]) => boolean) => rPlaca.topologia!.arestas.find((a) => a.geom === "linha" && fn(a.a) && fn(a.b))!;
const abas = {
  ...(novaFeature("flangeAresta", 1) as any),
  arestas: [borda((p) => Math.abs(p[1] - 50) < 1e-6 && Math.abs(p[2] - 2) < 1e-6), borda((p) => Math.abs(p[0] - 100) < 1e-6 && Math.abs(p[2] - 2) < 1e-6)].map((ass) => ({ tipo: "aresta", ass })),
};
const chapas: Feature[] = [sPlaca, placa, abas, sLinhaChapa, sFurosChapa];

const CHAPA = new Set(["flangeAresta", "bainha", "abaChapa", "corteChapa", "dobraEsboco", "junta", "meiaEsquadria", "fecharCanto", "alivioCanto", "quebrarCanto", "desdobrar", "dobrar"]);

// ---------- dados do painel (como na interface) ----------
function dados(base: Feature[]): DadosEsquema {
  return {
    esbocosAntes: base.filter((x) => x.tipo === "esboco").map((x) => [x.id, x.nome]),
    recursosAntes: base.filter((x) => x.tipo !== "esboco").map((x) => [x.id, x.nome]),
    linhasEsboco: (id) => {
      const e = base.find((x) => x.id === id);
      return e?.tipo === "esboco" ? e.geos.filter((g) => g.tipo === "linha").map((g, i) => [g.id, `Linha ${i + 1}`]) : [];
    },
    contornos: (id) => {
      const e = base.find((x) => x.id === id);
      if (e?.tipo !== "esboco") return [];
      try {
        const ls = encontrarLacos(e);
        aninhamento(ls);
        return ls.map((_, i) => [String(i), `Contorno ${i + 1}`]);
      } catch {
        return [];
      }
    },
    editarPosicoesFuro: () => {},
  };
}

/** Escolhas automáticas para os campos de seleção, por tipo aceito. */
function candidatos(base: Feature[], tipo: string): Referencia[] {
  const r = regenerar(base);
  const topo = r.topologia;
  if (!topo) return [];
  if (base === chapas) {
    // chapa: bordas livres e face de cima da placa (z = 2), longe das abas
    const livre = (a: { a: number[]; b: number[] }) => [a.a, a.b].every((p) => Math.abs(p[2] - 2) < 1e-6) && [a.a, a.b].every((p) => Math.abs(p[1]) < 1e-6 || Math.abs(p[0]) < 1e-6);
    if (tipo === "aresta") return topo.arestas.filter((a) => a.geom === "linha" && livre(a)).slice(0, 2).map((ass) => ({ tipo: "aresta", ass }));
    if (tipo === "face") return topo.faces.filter((f) => f.geom === "plano" && f.normal && f.normal[2] > 0.99 && Math.abs(f.centro[2] - 2) < 1e-6).map((ass) => ({ tipo: "face", ass }));
    if (tipo === "vertice") return [{ tipo: "vertice", p: [0, 0, 2] }];
  }
  const zMax = Math.max(...topo.faces.map((f) => f.centro[2]));
  switch (tipo) {
    case "face": {
      const fs = topo.faces.filter((f) => f.geom === "plano" && f.normal && f.normal[2] > 0.99 && Math.abs(f.centro[2] - zMax) < 1e-6);
      const cil = topo.faces.filter((f) => f.geom === "cilindro");
      return [...fs, ...cil].map((ass) => ({ tipo: "face", ass }));
    }
    case "aresta": {
      const as = topo.arestas.filter((a) => a.geom === "linha" && Math.abs(a.a[2] - zMax) < 1e-6 && Math.abs(a.b[2] - zMax) < 1e-6);
      return as.slice(0, 2).map((ass) => ({ tipo: "aresta", ass }));
    }
    case "vertice":
      return topo.vertices.filter((v) => Math.abs(v[2] - zMax) < 1e-6).slice(0, 1).map((p) => ({ tipo: "vertice", p }));
    case "plano":
      return [{ tipo: "plano", id: "XY" }, { tipo: "plano", id: "YZ" }];
    case "eixo":
      return [{ tipo: "eixo", id: "Z" }];
    case "esboco":
      return [sCirc, sCirc2, sTraj].filter((e) => base.includes(e)).map((e) => ({ tipo: "esboco", id: e.id }));
    default:
      return [];
  }
}

/** Preenche o que o comando exige para funcionar (como a seleção prévia da interface). */
function preencher(f: any, base: Feature[]) {
  const d = dados(base);
  const esq = esquemaDe(f, d);
  if ("esboco" in f || ["extrusao", "revolucao", "nervura", "furo", "abaChapa", "corteChapa", "dobraEsboco", "junta", "meiaEsquadria"].includes(f.tipo)) {
    f.esboco = {
      extrusao: sRet.id, revolucao: sRev.id, nervura: sAberto.id, furo: sPontos.id, abaChapa: sFurosChapa.id, corteChapa: sFurosChapa.id,
      dobraEsboco: sLinhaChapa.id, junta: sLinhaChapa.id, meiaEsquadria: undefined,
    }[f.tipo as string] ?? f.esboco;
  }
  if (f.tipo === "varredura") {
    f.tipoPerfil = "circular";
    f.trajetoria = [{ tipo: "esboco", id: sTraj.id }];
  }
  if (f.tipo === "loft") f.perfis = [{ tipo: "esboco", id: sCirc.id }, { tipo: "esboco", id: sCirc2.id }];
  if (f.tipo === "curva") f.base = { tipo: "esboco", id: sCirc.id };
  if (["padraoLinear", "padraoCircular", "espelhar"].includes(f.tipo)) f.recursos = [bloco.id];
  for (const cx of esq.caixas) {
    for (const c of cx.campos) {
      if (c.t !== "refs" || /guias|linhaCentro/.test(c.cam)) continue; // opcionais
      const v = ler(f, c.cam);
      if (v && (!Array.isArray(v) || v.length)) continue;
      const cand = c.aceita.flatMap((t) => candidatos(base, t));
      if (!cand.length) continue;
      gravar(f, c.cam, c.multiplo ? cand.slice(0, 2) : cand[0]);
    }
  }
}

/** Valores de teste de um campo numérico. */
function valores(c: Extract<Campo<any>, { t: "num" }>, atual: number): number[] {
  const vs = [0, -5, 0.001, atual * 2.5, 1e5, NaN];
  if (c.min !== undefined) vs.push(c.min);
  if (c.max !== undefined) vs.push(c.max, c.max + 1);
  return rapido ? vs.slice(0, 4) : vs;
}

/** Percorre o painel inteiro do recurso `f0` sobre a peça `base`. */
function varrerRecurso(f0: any, base: Feature[]) {
  const d = dados(base);
  const nome = `${f0.tipo}`;
  const baseR = rodar(`${nome} (padrão)`, [...base, f0], f0.id);
  if (baseR?.erros.some((e) => e.id === f0.id)) console.log(`  · ${nome} padrão com erro: ${baseR.erros.find((e) => e.id === f0.id)!.mensagem}`);
  let n0 = regeneracoes;
  const caixas = esquemaDe(f0, d).caixas;
  for (const cx of caixas) {
    const variantes: [string, (f: any) => void][] = [];
    if (cx.opcional) variantes.push([`[${cx.titulo}] ligada`, (f) => gravar(f, cx.opcional!, !ler(f, cx.opcional!))]);
    for (const c of cx.campos) {
      const rot = `${cx.titulo} › ${"rot" in c ? c.rot : c.t}`;
      if (c.t === "sel") {
        const ops = typeof c.opcoes === "function" ? c.opcoes(f0) : c.opcoes;
        for (const [v, r] of ops) variantes.push([`${rot} = ${r}`, (f) => (c.aoMudar ? c.aoMudar(f, v) : gravar(f, c.cam, v))]);
      } else if (c.t === "check" || c.t === "inverter") {
        variantes.push([`${rot} alternado`, (f) => gravar(f, c.cam, !ler(f, c.cam))]);
      } else if (c.t === "num") {
        const atual = Number(ler(f0, c.cam) ?? 1);
        for (const v of valores(c, atual)) variantes.push([`${rot} = ${v}`, (f) => gravar(f, c.cam, v)]);
      } else if (c.t === "lista") {
        const ops = c.opcoes(f0);
        if (ops.length) variantes.push([`${rot} = 1º`, (f) => gravar(f, c.cam, [ops[0][0]])]);
      } else if (c.t === "refs") {
        variantes.push([`${rot} vazio`, (f) => gravar(f, c.cam, c.multiplo ? [] : undefined)]);
      } else if (c.t === "texto") {
        for (const t of ["", "lixo ; ; ;", "0;0;0\n0;0;0"]) variantes.push([`${rot} = ${JSON.stringify(t)}`, (f) => gravar(f, c.cam, t)]);
      }
    }
    for (const [rot, mudar] of variantes) {
      const f = JSON.parse(JSON.stringify(f0));
      try {
        if (cx.opcional) gravar(f, cx.opcional, true);
        mudar(f);
      } catch (e) {
        achar(`ESTOUROU ao mudar ${nome} › ${rot}: ${(e as Error).message}`);
        continue;
      }
      const r = rodar(`${nome} › ${rot}`, [...base, f], f.id);
      // chapa: o planificado também precisa aguentar
      if (r && CHAPA.has(f.tipo) && !rapido) rodar(`${nome} › ${rot} (planificado)`, [...base, f], f.id, { planificar: true });
    }
  }
  console.log(`  ${nome}: ${regeneracoes - n0 + 1} regenerações`);
}

// ---------- 1. cada recurso, o painel inteiro ----------
const TIPOS = [
  "extrusao", "revolucao", "varredura", "loft", "filete", "chanfro", "casca", "inclinacao", "nervura", "furo",
  "padraoLinear", "padraoCircular", "espelhar", "planoRef", "eixoRef", "curva",
  "converterChapa", "flangeBase",
  ...CHAPA,
] as const;
const t0 = performance.now();
console.log("1. painel de cada recurso");
for (const tipo of TIPOS) {
  const base = CHAPA.has(tipo) ? chapas : tipo === "flangeBase" ? [sPlaca] : solidos;
  const f = novaFeature(tipo as any, 9) as any;
  if (tipo === "flangeBase") f.esboco = sPlaca.id;
  if (tipo === "extrusao") {
    // corte também: o mesmo painel com operação cortar
    const c = novaFeature("extrusao", 9) as any;
    c.operacao = "cortar";
    preencher(c, base);
    varrerRecurso(c, base);
  }
  try {
    preencher(f, base);
  } catch (e) {
    achar(`ESTOUROU preenchendo ${tipo}: ${(e as Error).message}`);
    continue;
  }
  varrerRecurso(f, base);
}

// ---------- 2. peça longa com tudo junto, supressões e ordem ----------
console.log("2. peça com todos os recursos");
const longa: Feature[] = [...solidos];
for (const tipo of ["extrusao", "filete", "chanfro", "furo", "padraoLinear", "padraoCircular", "espelhar", "nervura", "revolucao", "varredura", "loft", "planoRef", "eixoRef", "curva", "casca"] as const) {
  const f = novaFeature(tipo as any, 9) as any;
  preencher(f, longa);
  longa.push(f);
}
const rl = rodar("peça longa", longa);
console.log(`  peça longa: ${rl?.erros.length ?? "?"} recurso(s) com erro: ${rl?.erros.map((e) => longa.find((f) => f.id === e.id)?.tipo + ": " + e.mensagem).join(" | ")}`);
for (const f of longa) {
  if (f.tipo === "esboco") continue;
  rodar(`peça longa sem ${f.tipo}`, longa.map((x) => (x === f ? { ...x, suprimida: true } : x)));
}
// embaralha (determinístico): recursos fora de ordem não podem derrubar a regeneração
let semente = 7;
const aleat = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
for (let k = 0; k < (rapido ? 3 : 10); k++) {
  const ordem = [...longa].sort(() => aleat() - 0.5);
  rodar(`peça longa embaralhada #${k + 1}`, ordem);
}
// chapa com todos os recursos de chapa
const chapaLonga: Feature[] = [...chapas];
for (const tipo of ["bainha", "abaChapa", "corteChapa", "fecharCanto", "alivioCanto", "quebrarCanto", "desdobrar", "dobrar"] as const) {
  const f = novaFeature(tipo as any, 9) as any;
  preencher(f, chapaLonga);
  chapaLonga.push(f);
}
const rc = rodar("chapa longa", chapaLonga);
console.log(`  chapa longa: ${rc?.erros.map((e) => chapaLonga.find((f) => f.id === e.id)?.tipo + ": " + e.mensagem).join(" | ") || "sem erros"}`);
rodar("chapa longa planificada", chapaLonga, undefined, { planificar: true });
for (const f of chapaLonga) if (f.tipo !== "esboco") rodar(`chapa longa sem ${f.tipo}`, chapaLonga.map((x) => (x === f ? { ...x, suprimida: true } : x)));

// ---------- relatório ----------
console.log(`\n${regeneracoes} regenerações em ${((performance.now() - t0) / 1000).toFixed(0)} s`);
if (lentos.length) console.log(`\nLentas (> ${TEMPO_LENTO / 1000} s):\n  ${lentos.join("\n  ")}`);
console.log(`\n${achados.length} achado(s)`);
for (const a of achados) console.log(`  ${a}`);
process.exit(achados.length ? 1 : 0);
