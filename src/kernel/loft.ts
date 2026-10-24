// Loft (ressalto/corte): transição entre dois ou mais perfis, na ordem da lista.
// Sem curvas-guia nem linha de centro: loft exato pelos contornos dos perfis (OpenCascade
// ThruSections). Restrições de início/fim: seção extra junto ao perfil, na direção pedida.
// Com curvas-guia ou linha de centro: os contornos são reamostrados e geramos seções
// intermediárias (deformadas pelas guias / dispostas ao longo da linha de centro).
// Campos e comportamento: docs/funcional/features.md §5.

import { assembleWire, cast, getOC, isShape3D, makeBSplineApproximation, type Face, type Shape3D, type Wire } from "replicad";
import type { FeatureLoft, Vec3 } from "../model";
import { cruz, normalizar } from "../esboco/referencial";
import { amostrasDaGuia, encadear, estacoes, type Trecho } from "./varredura";

const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const vec = (p: { x: number; y: number; z: number }): Vec3 => [p.x, p.y, p.z];

/** Um perfil do loft: as faces planas do esboço (com furos) e o plano dele. */
export interface PerfilLoft {
  faces: Face[];
  normal: Vec3;
}

export interface EntradaLoft {
  f: FeatureLoft;
  perfis: PerfilLoft[];
  guias: Trecho[][];
  linhaCentro: Trecho[] | null;
  /** Direção das restrições "Vetor de direção" (já resolvidas da referência), se houver. */
  vetorInicio: Vec3 | null;
  vetorFim: Vec3 | null;
}

/** Contornos de um perfil: [externo, furos...] de cada região. */
function contornos(p: PerfilLoft): Wire[][] {
  return p.faces.map((fa) => [fa.clone().outerWire(), ...fa.clone().innerWires()]);
}

/** ThruSections com as opções do painel (microtolerância, anel fechado). */
function loftExato(wires: Wire[], micro: boolean): Shape3D {
  const oc = getOC();
  const b = new oc.BRepOffsetAPI_ThruSections(true, false, micro ? 1e-8 : 1e-6);
  b.CheckCompatibility(true);
  for (const w of wires) b.AddWire(w.wrapped);
  b.Build();
  const s = cast(b.Shape());
  b.delete();
  if (!isShape3D(s)) throw new Error("Não foi possível fazer o loft entre esses perfis.");
  return s;
}

// ---------- reamostragem dos contornos ----------

/** Pontos igualmente espaçados ao longo de um contorno fechado + índices dos cantos. */
function reamostrar(w: Wire, n: number): { pts: Vec3[]; cantos: number[]; vivos: number[] } {
  const arestas = w.edges;
  const comp = arestas.map((e) => e.length);
  const total = comp.reduce((a, b) => a + b, 0);
  const pts: Vec3[] = [];
  const cantos: number[] = [];
  const vivos: number[] = [];
  let acum = 0;
  arestas.forEach((e, k) => {
    const ini = Math.round((acum / total) * n);
    acum += comp[k];
    const fim = Math.round((acum / total) * n);
    cantos.push(ini % n);
    // canto vivo: tangentes diferentes na junção com a aresta anterior
    const ant = arestas[(k + arestas.length - 1) % arestas.length];
    const t0 = normalizar(vec(ant.tangentAt(1))), t1 = normalizar(vec(e.tangentAt(0)));
    if (esc(t0, t1) < Math.cos((30 * Math.PI) / 180)) vivos.push(ini % n);
    for (let i = ini; i < fim; i++) pts.push(vec(e.pointAt((i - ini) / Math.max(1, fim - ini))));
  });
  return { pts: pts.slice(0, n), cantos, vivos };
}

/** Normal de um polígono (Newell). */
function normalPoligono(pts: Vec3[]): Vec3 {
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n = soma(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return normalizar(n);
}

const centro = (pts: Vec3[]): Vec3 => mul(pts.reduce(soma, [0, 0, 0] as Vec3), 1 / pts.length);

/** Gira a lista para começar no índice `k`. */
const rodar = <T>(a: T[], k: number): T[] => [...a.slice(k), ...a.slice(0, k)];

/** Seção fechada suave (B-spline) pelos pontos. */
function fioSuave(pts: Vec3[]): Wire {
  const e = makeBSplineApproximation([...pts, pts[0]], { tolerance: 1e-3, degMax: 3, smoothing: null });
  return assembleWire([e]);
}

// ---------- loft ----------

const N = 48; // pontos por contorno reamostrado
const SECOES_POR_VAO = 6;

export function lofting(ent: EntradaLoft): Shape3D {
  const { f } = ent;
  if (ent.perfis.length < 2) throw new Error("O loft precisa de pelo menos dois perfis.");
  if (f.fecharLoft && ent.perfis.length < 3) throw new Error("Fechar loft precisa de pelo menos três perfis.");
  const cs = ent.perfis.map(contornos);
  // todos os perfis com a mesma estrutura: mesmas regiões e mesmos furos
  const assinatura = (c: Wire[][]) => c.map((r) => r.length).join(",");
  if (cs.some((c) => assinatura(c) !== assinatura(cs[0]))) {
    throw new Error("Os perfis precisam ter o mesmo número de regiões e de furos.");
  }
  const reamostrado = ent.guias.length > 0 || !!ent.linhaCentro;
  let res: Shape3D | null = null;
  cs[0].forEach((regiao, ri) => {
    const solidoDo = (li: number) => {
      const loops = cs.map((c) => c[ri][li]);
      return reamostrado ? loftReamostrado(ent, loops) : loftDosContornos(ent, loops);
    };
    let s = solidoDo(0);
    for (let li = 1; li < regiao.length; li++) s = s.cut(solidoDo(li));
    res = res ? res.fuse(s) : s;
  });
  if (!res) throw new Error("Não foi possível fazer o loft.");
  return f.mesclarFacesTangentes ? (res as Shape3D).simplify() : res;
}

/** Comprimento padrão da tangência: fração da distância até o perfil vizinho. */
function passoTangente(a: Vec3, b: Vec3, fator: number) {
  return Math.max(1e-3, 0.15 * dist(a, b) * Math.max(0.05, fator));
}

/** Loft pelos contornos exatos + seções extras das restrições de início/fim. */
function loftDosContornos(ent: EntradaLoft, loops: Wire[]): Shape3D {
  const { f } = ent;
  const fios = loops.map((w) => w.clone());
  const centros = loops.map((w) => {
    const b = w.boundingBox as unknown as { center: Vec3 };
    return b.center;
  });
  const extra = (i: number, viz: number, dir: Vec3 | null): Wire | null => {
    if (!dir) return null;
    const d = passoTangente(centros[i], centros[viz], i === 0 ? f.restricaoInicio.comprimento : f.restricaoFim.comprimento);
    return loops[i].clone().translate(mul(dir, d));
  };
  const n = loops.length;
  const di = f.fecharLoft ? null : direcaoRestricao(ent, "inicio", ent.perfis[0].normal, sub(centros[1], centros[0]));
  const df = f.fecharLoft ? null : direcaoRestricao(ent, "fim", ent.perfis[n - 1].normal, sub(centros[n - 1], centros[n - 2]));
  const ini = extra(0, 1, di);
  const fim = extra(n - 1, n - 2, df ? mul(df, -1) : null);
  const lista = [fios[0], ...(ini ? [ini] : []), ...fios.slice(1, -1), ...(fim ? [fim] : []), fios[n - 1]];
  if (f.fecharLoft) lista.push(loops[0].clone());
  return loftExato(lista, f.microtolerancia);
}

/**
 * Direção da restrição (para fora do perfil, no sentido do loft), ou null se "Nenhuma".
 * `normal` = normal do plano do perfil; `sentido` = vetor do perfil para o vizinho.
 */
function direcaoRestricao(ent: EntradaLoft, qual: "inicio" | "fim", normal: Vec3, sentido: Vec3): Vec3 | null {
  const r = qual === "inicio" ? ent.f.restricaoInicio : ent.f.restricaoFim;
  if (r.tipo === "nenhuma") return null;
  let d = r.tipo === "normal" ? normal : (qual === "inicio" ? ent.vetorInicio : ent.vetorFim);
  if (!d) throw new Error("Restrição \"Vetor de direção\": escolha a referência (aresta, eixo ou plano).");
  d = normalizar(d);
  if (esc(d, sentido) < 0) d = mul(d, -1); // sempre para o lado do loft
  return r.inverter ? mul(d, -1) : d;
}

/** Loft por seções reamostradas: interpolação entre perfis, guias e linha de centro. */
function loftReamostrado(ent: EntradaLoft, loops: Wire[]): Shape3D {
  const { f } = ent;
  const amostras = loops.map((w) => reamostrar(w, N));
  // mesmo sentido de giro em todos (em relação ao loft) e início alinhado
  const cs = amostras.map((a) => centro(a.pts));
  const eixo = normalizar(sub(cs[cs.length - 1], cs[0]));
  for (const a of amostras) {
    if (esc(normalPoligono(a.pts), eixo) < 0) {
      a.pts = [a.pts[0], ...a.pts.slice(1).reverse()];
      a.cantos = a.cantos.map((k) => (N - k) % N);
      a.vivos = a.vivos.map((k) => (N - k) % N);
    }
  }
  // ponto de início: o mais perto da 1ª guia (se houver); nos demais, o mais perto do anterior
  const guias = ent.guias.map((g) => amostrasDaGuia(encadear(g, cs[0]).trechos));
  const ref0 = guias[0]?.[0] ?? amostras[0].pts[0];
  const alinhar = (a: (typeof amostras)[number], alvo: Vec3) => {
    let k = 0;
    a.pts.forEach((p, i) => { if (dist(p, alvo) < dist(a.pts[k], alvo)) k = i; });
    a.pts = rodar(a.pts, k);
    a.cantos = a.cantos.map((c) => (c - k + N) % N);
    a.vivos = a.vivos.map((c) => (c - k + N) % N);
  };
  alinhar(amostras[0], ref0);
  for (let i = 1; i < amostras.length; i++) alinhar(amostras[i], guias[0]?.length ? guias[0][0] : amostras[i - 1].pts[0]);

  // seções: interpolação linear ponto a ponto entre perfis vizinhos
  const pares = amostras.map((_, i) => i).slice(0, f.fecharLoft ? amostras.length : -1);
  let secoes: Vec3[][] = [];
  pares.forEach((i) => {
    const a = amostras[i].pts, b = amostras[(i + 1) % amostras.length].pts;
    for (let s = 0; s < SECOES_POR_VAO; s++) secoes.push(a.map((p, k) => lerp(p, b[k], s / SECOES_POR_VAO)));
  });
  secoes.push(f.fecharLoft ? amostras[0].pts : amostras[amostras.length - 1].pts);

  if (ent.linhaCentro) secoes = aoLongoDaLinhaDeCentro(ent, amostras.map((a) => a.pts));

  // curvas-guia: deslocam cada seção para tocar a guia, com a influência escolhida
  if (guias.length) {
    const kGuia = guias.map((g) => {
      let k = 0;
      amostras[0].pts.forEach((p, i) => { if (dist(p, g[0]) < dist(amostras[0].pts[k], g[0])) k = i; });
      return k;
    });
    const pesos = pesosDaInfluencia(f.influenciaGuias, kGuia, amostras[0]);
    secoes = secoes.map((sec, si) => {
      if (si === 0 || si === secoes.length - 1) return sec;
      const c = centro(sec);
      const prox = secoes[Math.min(si + 1, secoes.length - 1)], ant = secoes[si - 1];
      const n = normalizar(sub(centro(prox), centro(ant)));
      const desloc = guias.map((g, gi) => {
        const q = cortePlano(g, sec[kGuia[gi]], n) ?? cortePlano(g, c, n);
        return q ? sub(q, sec[kGuia[gi]]) : ([0, 0, 0] as Vec3);
      });
      return sec.map((p, j) => desloc.reduce((acc, d, gi) => soma(acc, mul(d, pesos[gi][j])), p));
    });
  }
  return loftExato(secoes.map(fioSuave), f.microtolerancia);
}

/** Peso de cada guia em cada ponto do contorno, conforme o tipo de influência. */
function pesosDaInfluencia(tipo: FeatureLoft["influenciaGuias"], kGuia: number[], a: { cantos: number[]; vivos: number[] }): number[][] {
  const distCirc = (i: number, j: number) => Math.min(Math.abs(i - j), N - Math.abs(i - j));
  /** Limites [antes, depois] do trecho de influência da guia g (índices, sentido crescente). */
  const limites = (k: number, marcas: number[]): [number, number] => {
    const outros = marcas.filter((m) => m !== k);
    if (!outros.length) return [k - N / 2, k + N / 2];
    const depois = Math.min(...outros.map((m) => ((m - k + N) % N) || N));
    const antes = Math.min(...outros.map((m) => ((k - m + N) % N) || N));
    return [k - antes, k + depois];
  };
  const p = kGuia.map((k) => {
    const marcas = tipo === "global" ? [] : tipo === "proximaGuia" ? kGuia : tipo === "proximaArestaViva" ? a.vivos : a.cantos;
    const [lo, hi] = tipo === "global" ? [k - N / 2, k + N / 2] : limites(k, marcas);
    return Array.from({ length: N }, (_, j) => {
      if (tipo === "global") return kGuia.length === 1 ? 1 : 1 / (1 + distCirc(j, k));
      // posição de j relativa a k, no sentido crescente (pode dar a volta)
      let d = j - k;
      if (d > N / 2) d -= N;
      if (d < -N / 2) d += N;
      const lim = d >= 0 ? hi - k : k - lo;
      return lim <= 0 ? 0 : Math.max(0, 1 - Math.abs(d) / lim);
    });
  });
  // várias guias: normaliza onde a soma passa de 1
  for (let j = 0; j < N; j++) {
    const s = p.reduce((acc, g) => acc + g[j], 0);
    if (s > 1) for (const g of p) g[j] /= s;
  }
  return p;
}

/** Onde o plano (ponto p, normal n) corta a polilinha — o corte mais próximo de p. */
function cortePlano(linha: Vec3[], p: Vec3, n: Vec3): Vec3 | null {
  let melhor: Vec3 | null = null;
  for (let i = 0; i + 1 < linha.length; i++) {
    const da = esc(sub(linha[i], p), n), db = esc(sub(linha[i + 1], p), n);
    if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
    const q = soma(linha[i], mul(sub(linha[i + 1], linha[i]), da / (da - db)));
    if (!melhor || dist(q, p) < dist(melhor, p)) melhor = q;
  }
  return melhor;
}

/**
 * Linha de centro: as seções seguem a curva (normais a ela), com a forma interpolada entre
 * os perfis conforme a posição de cada perfil ao longo da curva.
 */
function aoLongoDaLinhaDeCentro(ent: EntradaLoft, perfis: Vec3[][]): Vec3[][] {
  const { trechos } = encadear(ent.linhaCentro!, centro(perfis[0]));
  const est = estacoes(trechos, 24);
  // comprimento acumulado ao longo da linha
  const s: number[] = [0];
  for (let i = 1; i < est.length; i++) s.push(s[i - 1] + dist(est[i].p, est[i - 1].p));
  // cada perfil: estação mais próxima do seu centro e forma em coordenadas locais (n, b)
  const locais = perfis.map((pts) => {
    const c = centro(pts);
    let k = 0;
    est.forEach((e, i) => { if (dist(e.p, c) < dist(est[k].p, c)) k = i; });
    const e = est[k], b = cruz(e.t, e.n);
    return { s: s[k], forma: pts.map((p) => [esc(sub(p, e.p), e.n), esc(sub(p, e.p), b)] as [number, number]) };
  });
  const n = Math.max(2, Math.round(ent.f.secoesLinhaCentro));
  const s0 = locais[0].s, s1 = locais[locais.length - 1].s;
  const out: Vec3[][] = [];
  for (let i = 0; i <= n; i++) {
    const si = s0 + ((s1 - s0) * i) / n;
    // estação da linha de centro nessa posição
    let k = 0;
    while (k + 1 < s.length && s[k + 1] < si) k++;
    const u = s[k + 1] !== undefined && s[k + 1] > s[k] ? (si - s[k]) / (s[k + 1] - s[k]) : 0;
    const e0 = est[k], e1 = est[Math.min(k + 1, est.length - 1)];
    const p = lerp(e0.p, e1.p, u), nn = normalizar(lerp(e0.n, e1.n, u)), t = normalizar(lerp(e0.t, e1.t, u));
    const b = cruz(t, nn);
    // forma: entre os dois perfis vizinhos
    let j = 0;
    while (j + 1 < locais.length - 1 && locais[j + 1].s < si) j++;
    const a = locais[j], c = locais[j + 1];
    const w = c.s > a.s ? Math.min(1, Math.max(0, (si - a.s) / (c.s - a.s))) : 0;
    out.push(a.forma.map(([x, y], q) => {
      const xx = x + (c.forma[q][0] - x) * w, yy = y + (c.forma[q][1] - y) * w;
      return soma(p, soma(mul(nn, xx), mul(b, yy)));
    }));
  }
  return out;
}

