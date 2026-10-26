// Chapa metálica (implementação própria — o OpenCascade não tem chapa).
//
// A peça de chapa é uma árvore de PAREDES planas de espessura t ligadas por DOBRAS cilíndricas.
// Cada parede tem um quadro local (u, v, n) com u × v = n; a face de referência fica em z = 0 e
// o material vai de z = 0 até z = s·t (s = ±1). A forma da parede é um desenho 2D em (u, v).
// Uma dobra parte de uma aresta reta da parede-mãe (ponto e0, direção e, normal externa d, tudo
// em coordenadas locais da mãe), gira o ângulo θ em torno de um eixo paralelo à aresta e cria a
// parede-filha, cujo quadro local tem u = e e v = d (já girado).
//
// Planificado: a filha é posta no plano da mãe, a uma distância BA = θ·(r + K·t) da aresta
// (comprimento da linha neutra), sem girar. O 3D e o planificado saem da mesma árvore.

import { draw, drawCircle, drawRectangle, Plane, type Drawing, type Shape3D } from "replicad";
import type { Vec3 } from "../model";
import type { P2 } from "../esboco/geometria";

export interface ParamChapa {
  /** Espessura (mm). */
  t: number;
  /** Raio interno de dobra padrão (mm). */
  r: number;
  /** Fator K (posição da linha neutra: 0 = face interna, 0,5 = meio). */
  k: number;
}

interface Quadro {
  o: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

/** Local → planificado: origem e eixos (u, v) no plano do planificado. */
interface Plano2 {
  o: P2;
  u: P2;
  v: P2;
}

/**
 * Corte por plano (canto automático entre flanges vizinhas): fica o lado em que
 * m·(x − p) ≥ 0. No 3D corta pelo plano; no planificado, perpendicular à chapa pela face que
 * tira mais (a peça dobrada não colide).
 */
export interface Corte {
  p: Vec3;
  m: Vec3;
  /** Canto que gerou o corte ("idDobraA|idDobraB"): o Fechar canto troca os cortes desse canto. */
  canto?: string;
}

/**
 * Alívio (recorte na região da dobra), nas coordenadas locais da parede-mãe — as mesmas do
 * planificado em volta da dobra. `poli` serve para o 3D (fatias da dobra); `desenho`, exato, para
 * o planificado.
 */
export interface Alivio {
  poli: P2[];
  desenho: Drawing;
  /** Fatias de ângulo no 3D da dobra (padrão 8; cortes que atravessam a dobra usam mais). */
  n?: number;
}

/** Canto entre duas dobras da mesma parede cujas pontas se encontram (abas vizinhas). */
export interface Canto {
  a: Dobra;
  b: Dobra;
  /** Encontro das linhas de início das dobras (coordenadas locais da mãe). */
  c: P2;
  /** Ponta de cada dobra que fica no canto (s0 ou s1). */
  pontaA: "s0" | "s1";
  pontaB: "s0" | "s1";
  /** Posição do canto ao longo de cada dobra. */
  sa: number;
  sb: number;
}

export interface Parede {
  id: string;
  q: Quadro;
  /** Lado do material: +1 = para +n, −1 = para −n. */
  s: 1 | -1;
  plano: Plano2;
  forma: Drawing;
  /** Contornos (em coordenadas locais) usados para achar arestas tocadas no modelo. */
  contornos: P2[][];
  cortes?: Corte[];
}

export interface Dobra {
  id: string;
  pai: string;
  e0: P2;
  e: P2;
  d: P2;
  s0: number;
  s1: number;
  /** Ângulo (radianos). */
  theta: number;
  r: number;
  /** A dobra vai para o lado do material da mãe (+s·n). */
  paraMaterial: boolean;
  /** Comprimento da linha neutra no planificado. */
  ba: number;
  /** Para cima (+) ou para baixo (−) visto do planificado. */
  sentidoPlano: 1 | -1;
  cortes?: Corte[];
  /** Parede criada pela dobra (ausente na bainha enrolada, que é só dobra). */
  filha?: string;
  alivios?: Alivio[];
}

// ---------- vetores ----------

const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(...a) || 1));
const s2 = (a: P2, b: P2): P2 => ({ x: a.x + b.x, y: a.y + b.y });
const m2 = (a: P2, k: number): P2 => ({ x: a.x * k, y: a.y * k });

/** Gira o vetor x em torno do eixo unitário k pelo ângulo φ (Rodrigues). */
function girar(x: Vec3, k: Vec3, phi: number): Vec3 {
  const c = Math.cos(phi), s = Math.sin(phi);
  return soma(soma(mul(x, c), mul(cruz(k, x), s)), mul(k, esc(k, x) * (1 - c)));
}

/** Ponto local (x, y, z) da parede no espaço. */
export function local3(q: Quadro, p: P2, z = 0): Vec3 {
  return soma(q.o, soma(mul(q.u, p.x), soma(mul(q.v, p.y), mul(q.n, z))));
}
const lin3 = (q: Quadro, v: P2): Vec3 => soma(mul(q.u, v.x), mul(q.v, v.y));
const plano2 = (p: Plano2, x: P2): P2 => s2(p.o, s2(m2(p.u, x.x), m2(p.v, x.y)));
const lin2 = (p: Plano2, x: P2): P2 => s2(m2(p.u, x.x), m2(p.v, x.y));

/**
 * Aplica a um desenho a transformação x' = M·x + t, com M ortogonal (giro ou reflexão).
 * O replicad só tem espelho, giro e translação: a reflexão vira espelho em X + giro.
 */
export function transformarDesenho(D: Drawing, a: number, b: number, c: number, d: number, tx: number, ty: number): Drawing {
  let r = D.clone();
  if (a * d - b * c < 0) {
    // espelho (x, y) → (−x, y); o resto [[−a, b], [−c, d]] é um giro
    r = r.mirror([0, 1], [0, 0], "plane");
    a = -a;
    c = -c;
  }
  const ang = (Math.atan2(c, a) * 180) / Math.PI;
  if (Math.abs(ang) > 1e-9) r = r.rotate(ang, [0, 0]);
  return r.translate(tx, ty);
}

/** Polígono fechado como desenho (pontos repetidos seguidos são ignorados). */
function poligonoDesenho(pts: P2[]): Drawing {
  const q = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-9);
  if (q.length > 1 && Math.hypot(q[0].x - q[q.length - 1].x, q[0].y - q[q.length - 1].y) < 1e-9) q.pop();
  let d = draw([q[0].x, q[0].y]);
  for (const p of q.slice(1)) d = d.lineTo([p.x, p.y]);
  return d.close();
}

const GRANDE = 1e4; // mm: maior que qualquer peça de chapa

/** Semiplano a·x + b·y + c < 0 (o lado removido) como desenho. */
function semiplano(a: number, b: number, c: number): Drawing {
  const l = Math.hypot(a, b);
  const na = a / l, nb = b / l, cn = c / l;
  const q0 = { x: -cn * na, y: -cn * nb };
  const dir = { x: -nb, y: na }, fora = { x: -na, y: -nb };
  const p = (s: number, f: number) => ({ x: q0.x + dir.x * s + fora.x * f, y: q0.y + dir.y * s + fora.y * f });
  return poligonoDesenho([p(-GRANDE, 0), p(GRANDE, 0), p(GRANDE, GRANDE), p(-GRANDE, GRANDE)]);
}

/** Meio-espaço removido por um corte (m·(x − p) < 0). */
function semiespaco(c: Corte): Shape3D {
  const x = unit(Math.abs(c.m[0]) < 0.9 ? cruz(c.m, [1, 0, 0]) : cruz(c.m, [0, 1, 0]));
  const sk = drawRectangle(2 * GRANDE, 2 * GRANDE).sketchOnPlane(new Plane(c.p, x, c.m)) as unknown as { extrude(d: number): Shape3D };
  return sk.extrude(-GRANDE);
}

/** Retângulo [x0, x1] × [y0, y1] como desenho. */
export function retanguloDesenho(x0: number, x1: number, y0: number, y1: number): Drawing {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  return drawRectangle(w, h).translate((x0 + x1) / 2, (y0 + y1) / 2);
}

/** Movimento rígido levando o quadro `de` para o quadro `para` (pontos e vetores). */
function movimento(de: Quadro, para: Quadro) {
  const vet = (x: Vec3): Vec3 => soma(mul(para.u, esc(x, de.u)), soma(mul(para.v, esc(x, de.v)), mul(para.n, esc(x, de.n))));
  return { vet, pt: (x: Vec3): Vec3 => soma(para.o, vet(sub(x, de.o))) };
}
type Movimento = ReturnType<typeof movimento>;
const moverCortes = (cs: Corte[] | undefined, M: Movimento) => cs?.map((c) => ({ ...c, p: M.pt(c.p), m: M.vet(c.m) }));
const moverQuadro = (q: Quadro, M: Movimento): Quadro => ({ o: M.pt(q.o), u: M.vet(q.u), v: M.vet(q.v), n: M.vet(q.n) });

export class ModeloChapa {
  paredes: Parede[] = [];
  dobras: Dobra[] = [];
  /** Dobras mostradas planas (Desdobrar); vazio = chapa dobrada. */
  planas = new Set<string>();
  /** Quadros e cortes da chapa dobrada, guardados no Desdobrar para o Dobrar voltar exatamente. */
  private dobrada: { paredes: Map<string, { q: Quadro; cortes?: Corte[] }>; dobras: Map<string, Corte[] | undefined> } | null = null;
  /** Sinal do planificado de cada parede (reflexão em relação à raiz). */
  private orient = new Map<string, 1 | -1>();

  constructor(public p: ParamChapa) {}

  parede(id: string): Parede | undefined {
    return this.paredes.find((x) => x.id === id);
  }

  /** Parede inicial (flange base): quadro do esboço, planificado = coordenadas locais dela. */
  raiz(id: string, q: Quadro, s: 1 | -1, forma: Drawing, contornos: P2[][]): Parede {
    const w: Parede = { id, q, s, plano: { o: { x: 0, y: 0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 } }, forma, contornos };
    this.paredes.push(w);
    this.orient.set(id, 1);
    return w;
  }

  /**
   * Dobra a partir da aresta da mãe (e0 já com o recuo aplicado; e unitário ao longo da aresta;
   * d unitário apontando para fora da mãe). Cria a parede-filha com `forma` nas coordenadas
   * locais dela (u ao longo de e a partir de e0, v saindo da dobra). Sem forma: só a dobra
   * (bainha enrolada, por exemplo). Devolve a filha.
   */
  dobrar(o: {
    pai: Parede; idDobra: string; idFilha: string; e0: P2; e: P2; d: P2; s0: number; s1: number;
    theta: number; r: number; paraMaterial: boolean; forma: Drawing | null; contornos: P2[][];
  }): Parede {
    const { pai: P, theta, r } = o;
    const t = this.p.t;
    const E0 = local3(P.q, o.e0);
    const e3 = unit(lin3(P.q, o.e)), d3 = unit(lin3(P.q, o.d));
    // eixo da dobra: além da face de cima (para o material) ou abaixo da de referência
    const zA = o.paraMaterial ? P.s * (t + r) : -P.s * r;
    const A = soma(E0, mul(P.q.n, zA));
    const b3 = mul(P.q.n, o.paraMaterial ? P.s : -P.s); // para onde a filha sobe
    const phi = esc(cruz(e3, d3), b3) >= 0 ? theta : -theta;
    const oC = soma(A, girar(sub(E0, A), e3, phi));
    const vC = girar(d3, e3, phi);
    const nC = unit(cruz(e3, vC));
    const sC: 1 | -1 = esc(nC, mul(girar(P.q.n, e3, phi), P.s)) >= 0 ? 1 : -1;
    // planificado: a filha começa a BA da aresta, no plano da mãe
    const ba = theta * (r + this.p.k * t);
    const plano: Plano2 = { o: plano2(P.plano, s2(o.e0, m2(o.d, ba))), u: lin2(P.plano, o.e), v: lin2(P.plano, o.d) };
    const oriP = this.orient.get(P.id)!;
    // a base local (e, d) pode ser espelhada em relação a (u, v) da mãe
    const espelhoLocal: 1 | -1 = o.e.x * o.d.y - o.e.y * o.d.x >= 0 ? 1 : -1;
    this.orient.set(o.idFilha, (oriP * espelhoLocal) as 1 | -1);
    this.dobras.push({
      id: o.idDobra, pai: P.id, e0: o.e0, e: o.e, d: o.d, s0: o.s0, s1: o.s1, theta, r, paraMaterial: o.paraMaterial, ba,
      sentidoPlano: ((o.paraMaterial ? P.s : -P.s) * oriP) as 1 | -1, filha: o.forma ? o.idFilha : undefined,
    });
    const filha: Parede = { id: o.idFilha, q: { o: oC, u: e3, v: vC, n: nC }, s: sC, plano, forma: o.forma ?? retanguloDesenho(0, 0, 0, 0), contornos: o.forma ? o.contornos : [] };
    if (o.forma) this.paredes.push(filha);
    return filha;
  }

  /**
   * Dobra esboçada: divide a parede pela faixa da dobra (de `a` até `a + BA` a partir da linha
   * p0 + s·e, medido ao longo de `d`, que aponta para o lado que se move). O lado fixo fica com o
   * que está antes da faixa; o resto vira a parede-filha, que no planificado volta exatamente
   * ao lugar original (a chapa planificada não muda de tamanho).
   */
  dobrarPorLinha(o: {
    pai: Parede; idDobra: string; idFilha: string; p0: P2; e: P2; d: P2; a: number;
    theta: number; r: number; paraMaterial: boolean;
  }): Parede {
    const W = o.pai, { e, d } = o;
    const ba = o.theta * (o.r + this.p.k * this.p.t);
    const e0 = s2(o.p0, m2(d, o.a));
    const e1 = s2(e0, m2(d, ba));
    const coord = (q: P2) => ({ x: (q.x - e0.x) * e.x + (q.y - e0.y) * e.y, y: (q.x - e0.x) * d.x + (q.y - e0.y) * d.y });
    // vão da dobra: onde os contornos cruzam o meio da faixa
    let s0 = Infinity, s1 = -Infinity;
    for (const c of W.contornos) {
      for (let i = 0; i < c.length; i++) {
        const p = coord(c[i]), q = coord(c[(i + 1) % c.length]);
        const ym = ba / 2;
        if ((p.y - ym) * (q.y - ym) > 0 || Math.abs(q.y - p.y) < 1e-12) continue;
        const x = p.x + ((ym - p.y) / (q.y - p.y)) * (q.x - p.x);
        s0 = Math.min(s0, x);
        s1 = Math.max(s1, x);
      }
    }
    if (!Number.isFinite(s0) || s1 - s0 < 1e-6) throw new Error("A linha da dobra precisa atravessar a parede da chapa.");
    const esc2 = (u: P2, v: P2) => u.x * v.x + u.y * v.y;
    // filha: o que passa da faixa, nas coordenadas dela (x ao longo de e, y a partir do fim da dobra)
    const formaFilha = transformarDesenho(W.forma.cut(semiplano(d.x, d.y, -esc2(d, e1))), e.x, e.y, d.x, d.y, -esc2(e, e0), -esc2(d, e0) - ba);
    const contFilha = W.contornos
      .map((c) => recortarPoligono(c, (q) => esc2(d, q) - esc2(d, e1)))
      .filter((c) => c.length >= 3)
      .map((c) => c.map((q) => ({ x: coord(q).x, y: coord(q).y - ba })));
    // mãe: só o que fica antes da faixa
    W.forma = W.forma.cut(semiplano(-d.x, -d.y, esc2(d, e0)));
    W.contornos = W.contornos.map((c) => recortarPoligono(c, (q) => esc2(d, e0) - esc2(d, q))).filter((c) => c.length >= 3);
    return this.dobrar({
      pai: W, idDobra: o.idDobra, idFilha: o.idFilha, e0, e, d, s0, s1, theta: o.theta, r: o.r,
      paraMaterial: o.paraMaterial, forma: formaFilha, contornos: contFilha,
    });
  }

  /** Corta um pedaço da parede (recuo da dobra, alívio, corte na chapa). */
  recortar(id: string, D: Drawing) {
    const w = this.parede(id);
    if (w) w.forma = w.forma.cut(D);
  }

  /** Soma um pedaço à parede (aba) e guarda o contorno para achar arestas depois. */
  somar(id: string, D: Drawing, contornos: P2[][]) {
    const w = this.parede(id);
    if (!w) return;
    w.forma = w.forma.fuse(D);
    w.contornos.push(...contornos);
  }

  // ---------- sólido 3D ----------

  solido(): Shape3D {
    const t = this.p.t;
    const partes: Shape3D[] = [];
    for (const w of this.paredes) {
      const sk = w.forma.sketchOnPlane(new Plane(w.q.o, w.q.u, w.q.n)) as unknown as { extrude(d: number): Shape3D };
      partes.push(cortar(sk.extrude(w.s * t), w.cortes));
    }
    for (const b of this.dobras) partes.push(this.planas.has(b.id) ? this.solidoDobraPlana(b) : cortar(this.solidoDobra(b), b.cortes));
    if (!partes.length) throw new Error("A chapa ficou vazia.");
    return partes.slice(1).reduce((acc, x) => acc.fuse(x), partes[0]);
  }

  /** Geometria da dobra: aresta da mãe (E0, e3, d3), eixo (A, e3) e ângulo com sinal. */
  private geomDobra(b: Dobra) {
    const P = this.parede(b.pai)!;
    const t = this.p.t;
    const E0 = local3(P.q, b.e0);
    const e3 = unit(lin3(P.q, b.e)), d3 = unit(lin3(P.q, b.d));
    const zA = b.paraMaterial ? P.s * (t + b.r) : -P.s * b.r;
    const A = soma(E0, mul(P.q.n, zA));
    const b3 = mul(P.q.n, b.paraMaterial ? P.s : -P.s);
    const phi = esc(cruz(e3, d3), b3) >= 0 ? b.theta : -b.theta;
    return { P, E0, e3, d3, A, phi };
  }

  /**
   * Trecho [lo, hi] (ao longo da aresta) da dobra que sobra depois dos cortes no ângulo ψ,
   * conferido nas duas faces da chapa (fica o menor).
   */
  private faixaDobra(b: Dobra, psi: number): [number, number] {
    const g = this.geomDobra(b);
    let lo = b.s0, hi = b.s1;
    for (const c of b.cortes ?? []) {
      for (const z of [0, g.P.s * this.p.t]) {
        const X = soma(g.A, girar(sub(soma(g.E0, mul(g.P.q.n, z)), g.A), g.e3, psi));
        const k = esc(c.m, sub(X, c.p)), a = esc(c.m, g.e3);
        if (Math.abs(a) < 1e-12) {
          if (k < 0) hi = lo;
          continue;
        }
        if (a > 0) lo = Math.max(lo, -k / a);
        else hi = Math.min(hi, -k / a);
      }
    }
    if (hi < lo) lo = hi = (lo + hi) / 2;
    return [lo, hi];
  }

  /** Forma da parede no planificado: cortes perpendiculares à chapa pela face que tira mais. */
  private formaPlana(w: Parede): Drawing {
    let D = w.forma;
    for (const c of w.cortes ?? []) {
      for (const z of [0, w.s * this.p.t]) {
        const a = esc(c.m, w.q.u), b = esc(c.m, w.q.v), k = esc(c.m, sub(soma(w.q.o, mul(w.q.n, z)), c.p));
        if (Math.hypot(a, b) < 1e-9) continue;
        D = D.cut(semiplano(a, b, k));
      }
    }
    return D;
  }

  private solidoDobra(b: Dobra): Shape3D {
    const t = this.p.t;
    const { P, E0, e3, d3, A, phi } = this.geomDobra(b);
    // seção da chapa na aresta (retângulo largura × espessura) girada em torno do eixo
    const yN = esc(P.q.n, cruz(d3, e3)); // ±1: n no eixo y do plano
    const fatia = (lo: number, hi: number, psi0: number, psi1: number): Shape3D => {
      const sec = retanguloDesenho(0, hi - lo, 0, P.s * t * yN);
      const sk = sec.sketchOnPlane(new Plane(soma(E0, mul(e3, lo)), e3, d3)) as unknown as { revolve(e: Vec3, o: { origin: Vec3; angle: number }): Shape3D };
      const x = sk.revolve(e3, { origin: A, angle: ((psi1 - psi0) * 180) / Math.PI });
      return Math.abs(psi0) > 1e-12 ? x.rotate((psi0 * 180) / Math.PI, A, e3) : x;
    };
    if (!b.alivios?.length) return fatia(b.s0, b.s1, 0, phi);
    // com alívio: em cada fatia de ângulo tira o trecho (ao longo da aresta) que cai dentro do
    // alívio na posição correspondente do planificado. Só os trechos atingidos (um por alívio) são
    // fatiados; fatias seguidas iguais (alívio retangular ou rasgado) viram uma revolução só.
    const N = Math.max(8, ...b.alivios.map((al) => al.n ?? 8));
    const hs = Array.from({ length: N }, (_, i) => (b.ba * (i + 0.5)) / N);
    const regioes: [number, number][] = [];
    for (const al of b.alivios) {
      let ra = Infinity, rb = -Infinity;
      for (const h of hs) {
        let cur = b.s0;
        for (const [lo, hi] of [...this.trechosLivres({ ...b, alivios: [al] }, h), [b.s1, b.s1] as [number, number]]) {
          if (lo > cur + 1e-9) (ra = Math.min(ra, cur)), (rb = Math.max(rb, lo));
          cur = Math.max(cur, hi);
        }
      }
      if (rb > ra) regioes.push([ra, rb]);
    }
    regioes.sort((x, y) => x[0] - y[0]);
    const juntas: [number, number][] = [];
    for (const r of regioes) {
      const u = juntas[juntas.length - 1];
      if (u && r[0] <= u[1] + 1e-9) u[1] = Math.max(u[1], r[1]);
      else juntas.push([...r]);
    }
    if (!juntas.length) return fatia(b.s0, b.s1, 0, phi);
    const partes: Shape3D[] = [];
    // trechos fora dos alívios: dobra inteira
    let cur = b.s0;
    for (const [ra, rb] of juntas) {
      if (ra > cur + 1e-6) partes.push(fatia(cur, ra, 0, phi));
      cur = Math.max(cur, rb);
    }
    if (b.s1 > cur + 1e-6) partes.push(fatia(cur, b.s1, 0, phi));
    const livres = hs.map((h) => this.trechosLivres(b, h));
    const iguais = (x: [number, number][], y: [number, number][]) => x.length === y.length && x.every((v, k) => Math.abs(v[0] - y[k][0]) < 1e-6 && Math.abs(v[1] - y[k][1]) < 1e-6);
    for (const [ra, rb] of juntas) {
      const recorte = (ls: [number, number][]) => ls.map(([lo, hi]): [number, number] => [Math.max(lo, ra), Math.min(hi, rb)]).filter(([lo, hi]) => hi - lo > 1e-6);
      for (let i = 0; i < N; ) {
        const ls = recorte(livres[i]);
        let j = i + 1;
        while (j < N && iguais(recorte(livres[j]), ls)) j++;
        for (const [lo, hi] of ls) partes.push(fatia(lo, hi, (phi * i) / N, (phi * j) / N));
        i = j;
      }
    }
    if (!partes.length) throw new Error("O alívio de canto tirou a dobra inteira (diminua o tamanho).");
    // união em árvore (pares), mais rápida que somar uma a uma
    let lista = partes;
    while (lista.length > 1) {
      const prox: Shape3D[] = [];
      for (let k = 0; k < lista.length; k += 2) prox.push(k + 1 < lista.length ? lista[k].fuse(lista[k + 1]) : lista[k]);
      lista = prox;
    }
    return lista[0];
  }

  /** Trechos [lo, hi] da dobra, na altura h da faixa do planificado, fora dos alívios. */
  private trechosLivres(b: Dobra, h: number): [number, number][] {
    let livres: [number, number][] = [[b.s0, b.s1]];
    for (const al of b.alivios ?? []) {
      // linha X(s) = e0 + h·d + s·e cruzando o polígono do alívio: trechos dentro (par a par)
      const o = s2(b.e0, m2(b.d, h)), cruzes: number[] = [];
      const c = al.poli;
      for (let i = 0; i < c.length; i++) {
        const p = c[i], q = c[(i + 1) % c.length];
        const fp = (p.x - o.x) * b.d.x + (p.y - o.y) * b.d.y, fq = (q.x - o.x) * b.d.x + (q.y - o.y) * b.d.y;
        if ((fp > 0) === (fq > 0)) continue;
        const k = fp / (fp - fq);
        const X = { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
        cruzes.push((X.x - o.x) * b.e.x + (X.y - o.y) * b.e.y);
      }
      cruzes.sort((x, y) => x - y);
      for (let k = 0; k + 1 < cruzes.length; k += 2) {
        const [a, z] = [cruzes[k], cruzes[k + 1]];
        livres = livres.flatMap(([lo, hi]): [number, number][] => {
          if (z <= lo || a >= hi) return [[lo, hi]];
          const r: [number, number][] = [];
          if (a > lo + 1e-6) r.push([lo, a]);
          if (z < hi - 1e-6) r.push([z, hi]);
          return r;
        });
      }
    }
    return livres;
  }

  // ---------- planificado ----------

  /**
   * Região plana da dobra (faixa de largura BA, com cortes de canto e alívios) e as linhas de
   * dobra, nas coordenadas locais da parede-mãe — as mesmas do planificado em volta da dobra.
   */
  private regiaoPlana(b: Dobra): { desenho: Drawing; linhas: [P2, P2][] } {
    const ponto = (s: number, h: number) => s2(b.e0, s2(m2(b.e, s), m2(b.d, h)));
    if (b.alivios?.length || b.cortes?.length) {
      // contorno por amostras do ângulo (linha neutra), aparado pelos cortes de canto
      const N = 16, esq: P2[] = [], dir: P2[] = [];
      const phi = this.geomDobra(b).phi;
      for (let i = 0; i <= N; i++) {
        const [lo, hi] = this.faixaDobra(b, (phi * i) / N);
        esq.push(ponto(lo, (b.ba * i) / N));
        dir.push(ponto(hi, (b.ba * i) / N));
      }
      let R = poligonoDesenho([...esq, ...dir.reverse()]);
      for (const al of b.alivios ?? []) R = R.cut(al.desenho);
      // linha de dobra só onde há material
      const [lo, hi] = this.faixaDobra(b, phi / 2);
      const linhas = this.trechosLivres({ ...b, s0: lo, s1: hi }, b.ba / 2).map(([a, z]): [P2, P2] => [ponto(a, b.ba / 2), ponto(z, b.ba / 2)]);
      return { desenho: R, linhas };
    }
    const c0 = ponto(b.s0, 0);
    return {
      desenho: transformarDesenho(retanguloDesenho(0, b.s1 - b.s0, 0, b.ba), b.e.x, b.d.x, b.e.y, b.d.y, c0.x, c0.y),
      linhas: [[ponto(b.s0, b.ba / 2), ponto(b.s1, b.ba / 2)]],
    };
  }

  /** Desenho do planificado (coordenadas locais da parede raiz) e linhas de dobra. */
  planificado(): { desenho: Drawing; dobras: { a: P2; b: P2; cima: boolean; angulo: number; raio: number }[] } {
    let D: Drawing | null = null;
    const juntar = (x: Drawing) => (D = D ? D.fuse(x) : x);
    for (const w of this.paredes) {
      const p = w.plano;
      juntar(transformarDesenho(this.formaPlana(w), p.u.x, p.v.x, p.u.y, p.v.y, p.o.x, p.o.y));
    }
    const linhas: { a: P2; b: P2; cima: boolean; angulo: number; raio: number }[] = [];
    for (const b of this.dobras) {
      const P = this.parede(b.pai)!.plano;
      const { desenho, linhas: ls } = this.regiaoPlana(b);
      juntar(transformarDesenho(desenho, P.u.x, P.v.x, P.u.y, P.v.y, P.o.x, P.o.y));
      for (const [a, z] of ls) linhas.push({ a: plano2(P, a), b: plano2(P, z), cima: b.sentidoPlano > 0, angulo: (b.theta * 180) / Math.PI, raio: b.r });
    }
    if (!D) throw new Error("A chapa ficou vazia.");
    return { desenho: D, dobras: linhas };
  }

  // ---------- desdobrar / dobrar (cortes que atravessam dobras) ----------

  /** Dobra desdobrada no 3D: a faixa plana continua o plano da mãe. */
  private solidoDobraPlana(b: Dobra): Shape3D {
    const P = this.parede(b.pai)!;
    const sk = this.regiaoPlana(b).desenho.sketchOnPlane(new Plane(P.q.o, P.q.u, P.q.n)) as unknown as { extrude(d: number): Shape3D };
    return sk.extrude(P.s * this.p.t);
  }

  /** Linhas de dobra das dobras planas (no 3D, sobre a face de cima), para mostrar onde dobram. */
  linhasDasPlanas(): Vec3[][] {
    const r: Vec3[][] = [];
    for (const b of this.dobras) {
      if (!this.planas.has(b.id)) continue;
      const P = this.parede(b.pai)!;
      const z = P.s * this.p.t * 1.001;
      for (const [a, c] of this.regiaoPlana(b).linhas) r.push([local3(P.q, a, z), local3(P.q, c, z)]);
    }
    return r;
  }

  /** Paredes abaixo de uma parede (ela inclusive), seguindo as dobras. */
  private ramo(id: string): Set<string> {
    const r = new Set<string>([id]);
    for (const b of this.dobras) if (r.has(b.pai) && b.filha) r.add(b.filha);
    return r;
  }

  /**
   * Desdobra as dobras pedidas (as já desdobradas continuam): cada filha volta ao plano da mãe,
   * a BA da aresta, e leva junto tudo o que vem depois dela. A parede `fixa` não sai do lugar.
   */
  desdobrar(ids: string[], fixa?: string) {
    const todas = new Set([...this.planas, ...ids]);
    this.dobrarDeVolta();
    this.dobrada = {
      paredes: new Map(this.paredes.map((w) => [w.id, { q: w.q, cortes: w.cortes }])),
      dobras: new Map(this.dobras.map((b) => [b.id, b.cortes])),
    };
    const mover = (alvo: Set<string>, M: Movimento) => {
      for (const w of this.paredes) {
        if (!alvo.has(w.id)) continue;
        w.q = moverQuadro(w.q, M);
        w.cortes = moverCortes(w.cortes, M);
      }
      for (const b of this.dobras) if (alvo.has(b.pai)) b.cortes = moverCortes(b.cortes, M);
    };
    const fixaAntes = fixa ? this.parede(fixa)?.q : undefined;
    // dobras em ordem de criação: a mãe sempre já está no lugar novo
    for (const b of this.dobras) {
      if (!todas.has(b.id) || !b.filha) continue;
      const P = this.parede(b.pai)!, F = this.parede(b.filha)!;
      const E0 = local3(P.q, b.e0);
      const e3 = unit(lin3(P.q, b.e)), d3 = unit(lin3(P.q, b.d));
      const plana: Quadro = { o: soma(E0, mul(d3, b.ba)), u: e3, v: d3, n: cruz(e3, d3) };
      mover(this.ramo(F.id), movimento(F.q, plana));
    }
    this.planas = new Set([...todas].filter((id) => this.dobras.some((b) => b.id === id)));
    // a face fixa volta para onde estava (o resto da chapa se move em volta dela)
    const W = fixa ? this.parede(fixa) : undefined;
    if (W && fixaAntes) mover(new Set(this.paredes.map((w) => w.id)), movimento(W.q, fixaAntes));
  }

  /** Dobra de volta tudo o que estava desdobrado (os cortes feitos no plano ficam nas dobras). */
  dobrarDeVolta() {
    if (!this.dobrada) return;
    for (const w of this.paredes) {
      const g = this.dobrada.paredes.get(w.id);
      if (g) (w.q = g.q), (w.cortes = g.cortes);
    }
    for (const b of this.dobras) if (this.dobrada.dobras.has(b.id)) b.cortes = this.dobrada.dobras.get(b.id);
    this.dobrada = null;
    this.planas.clear();
  }

  /** Corte (desenho e contornos nas coordenadas locais da mãe) numa dobra desdobrada. */
  cortarDobraPlana(b: Dobra, desenho: Drawing, contornos: P2[][]) {
    const dentro = (q: P2) => {
      const x = q.x - b.e0.x, y = q.y - b.e0.y;
      const s = x * b.e.x + y * b.e.y, h = x * b.d.x + y * b.d.y;
      return s > b.s0 - 1e-6 && s < b.s1 + 1e-6 && h > -1e-6 && h < b.ba + 1e-6;
    };
    // só os contornos que tocam a faixa; amostras finas no 3D (o corte pode ser curvo)
    for (const c of contornos) {
      const toca = c.some(dentro) || recortarPoligono(recortarPoligono(c, (q) => (q.x - b.e0.x) * b.d.x + (q.y - b.e0.y) * b.d.y), (q) => b.ba - ((q.x - b.e0.x) * b.d.x + (q.y - b.e0.y) * b.d.y)).length >= 3;
      if (toca) (b.alivios ??= []).push({ poli: c, desenho, n: 24 });
    }
  }

  /** Dobra cuja face cilíndrica tem este eixo (ponto e direção). */
  dobraDoEixo(ponto: Vec3, dir: Vec3): Dobra | undefined {
    let melhor: Dobra | undefined, dist = Infinity;
    for (const b of this.dobras) {
      const g = this.geomDobra(b);
      if (Math.abs(esc(unit(dir), g.e3)) < 0.999) continue;
      const r = sub(ponto, g.A);
      const dd = Math.hypot(...sub(r, mul(g.e3, esc(r, g.e3))));
      if (dd < dist) (dist = dd), (melhor = b);
    }
    return dist < 1e-3 * Math.max(1, this.p.t) + 1e-4 ? melhor : undefined;
  }

  /** Parede com uma face plana (de cima ou de baixo) no plano dado e que contém o ponto. */
  paredeDaFace(centro: Vec3, normal: Vec3): Parede | undefined {
    const t = this.p.t;
    for (const w of this.paredes) {
      if (Math.abs(Math.abs(esc(normal, w.q.n)) - 1) > 1e-6) continue;
      const r = sub(centro, w.q.o);
      const z = esc(r, w.q.n);
      if (Math.abs(z) > 1e-4 && Math.abs(z - w.s * t) > 1e-4) continue;
      const p = { x: esc(r, w.q.u), y: esc(r, w.q.v) };
      if (w.contornos.some((c) => dentroDoPoligono(p, c))) return w;
    }
    return undefined;
  }

  /** Sólido do planificado, deitado no plano da parede raiz. */
  solidoPlanificado(): { solido: Shape3D; linhas3D: Vec3[][] } {
    const raiz = this.paredes[0];
    const { desenho, dobras } = this.planificado();
    const sk = desenho.sketchOnPlane(new Plane(raiz.q.o, raiz.q.u, raiz.q.n)) as unknown as { extrude(d: number): Shape3D };
    const z = raiz.s * this.p.t * 1.001; // linhas de dobra sobre a face de cima
    return { solido: sk.extrude(raiz.s * this.p.t), linhas3D: dobras.map((l) => [local3(raiz.q, l.a, z), local3(raiz.q, l.b, z)]) };
  }

  // ---------- cantos entre abas ----------

  /**
   * Cantos: pares de dobras da mesma parede (com parede-filha), não paralelas, cujas linhas de
   * início se cruzam perto de uma ponta de cada uma (abas vizinhas, do mesmo recurso ou não).
   */
  cantos(): Canto[] {
    const r: Canto[] = [];
    const t = this.p.t;
    const ds = this.dobras.filter((b) => b.filha);
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const a = ds[i], b = ds[j];
        if (a.pai !== b.pai) continue;
        const cr = a.e.x * b.e.y - a.e.y * b.e.x;
        if (Math.abs(cr) < 0.05) continue;
        // e0a + sa·ea = e0b + sb·eb
        const dx = b.e0.x - a.e0.x, dy = b.e0.y - a.e0.y;
        const sa = (dx * b.e.y - dy * b.e.x) / cr, sb = (dx * a.e.y - dy * a.e.x) / cr;
        const tol = a.ba + b.ba + 2 * (t + a.r + b.r);
        const perto = (s: number, d: Dobra): "s0" | "s1" | null => {
          const d0 = Math.abs(s - d.s0), d1 = Math.abs(s - d.s1);
          return Math.min(d0, d1) > tol ? null : d0 < d1 ? "s0" : "s1";
        };
        const pa = perto(sa, a), pb = perto(sb, b);
        if (!pa || !pb) continue;
        // as duas abas saem para o lado de fora do canto (cada uma além da linha da outra)
        const meioA = s2(a.e0, m2(a.e, (a.s0 + a.s1) / 2)), meioB = s2(b.e0, m2(b.e, (b.s0 + b.s1) / 2));
        const ladoB = (meioA.x - b.e0.x) * b.d.x + (meioA.y - b.e0.y) * b.d.y;
        const ladoA = (meioB.x - a.e0.x) * a.d.x + (meioB.y - a.e0.y) * a.d.y;
        if (ladoA > 1e-6 || ladoB > 1e-6) continue;
        r.push({ a, b, c: s2(a.e0, m2(a.e, sa)), pontaA: pa, pontaB: pb, sa, sb });
      }
    }
    return r;
  }

  /**
   * Estende a dobra e a parede-filha, pela ponta do canto, até `ate` (posição ao longo da dobra):
   * o Fechar canto estende tudo além do canto e depois apara pelos planos do canto.
   */
  estender(b: Dobra, ponta: "s0" | "s1", ate: number) {
    const velho = b[ponta];
    const novo = ponta === "s1" ? Math.max(velho, ate) : Math.min(velho, ate);
    if (Math.abs(novo - velho) < 1e-9) return;
    b[ponta] = novo;
    const f = b.filha && this.parede(b.filha);
    if (!f) return;
    const H = Math.max(0, ...f.contornos.flat().map((p) => p.y));
    if (H < 1e-9) return;
    f.forma = f.forma.fuse(retanguloDesenho(Math.min(velho, novo), Math.max(velho, novo), 0, H));
    f.contornos = f.contornos.map((c) => c.map((p) => (Math.abs(p.x - velho) < 1e-6 ? { x: novo, y: p.y } : p)));
  }

  /**
   * Alívio de canto: recorte (polígono para o 3D, desenho exato para o planificado) em
   * coordenadas da parede-mãe. Tira da mãe, das duas dobras e das paredes-filhas.
   */
  aliviar(k: Canto, poli: P2[], desenho: Drawing) {
    const mae = this.parede(k.a.pai)!;
    mae.forma = mae.forma.cut(desenho);
    for (const b of [k.a, k.b]) {
      (b.alivios ??= []).push({ poli, desenho });
      const f = b.filha && this.parede(b.filha);
      // filha: x ao longo de e a partir de e0, y a partir do fim da dobra (BA)
      if (f) f.forma = f.forma.cut(transformarDesenho(desenho, b.e.x, b.e.y, b.d.x, b.d.y, -(b.e0.x * b.e.x + b.e0.y * b.e.y), -(b.e0.x * b.d.x + b.e0.y * b.d.y) - b.ba));
    }
  }

  // ---------- arestas tocadas no modelo ----------

  /**
   * Parede e aresta do contorno que contêm o segmento 3D (a, b) tocado no modelo. `noTopo`: a
   * aresta está na face de cima (z = s·t) e não na de referência.
   */
  acharAresta(a: Vec3, b: Vec3, tol = 1e-3): { parede: Parede; contorno: P2[]; p: P2; q: P2; noTopo: boolean; ta: number; tb: number } | null {
    const t = this.p.t;
    for (const w of this.paredes) {
      const loc = (x: Vec3) => {
        const r = sub(x, w.q.o);
        return { x: esc(r, w.q.u), y: esc(r, w.q.v), z: esc(r, w.q.n) };
      };
      const la = loc(a), lb = loc(b);
      const naFace = (z: number) => Math.abs(la.z - z) < tol && Math.abs(lb.z - z) < tol;
      const noTopo = naFace(w.s * t);
      if (!noTopo && !naFace(0)) continue;
      for (const c of w.contornos) {
        for (let i = 0; i < c.length; i++) {
          const p = c[i], q = c[(i + 1) % c.length];
          const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy);
          if (L < 1e-9) continue;
          const dist = (x: { x: number; y: number }) => Math.abs((x.x - p.x) * dy - (x.y - p.y) * dx) / L;
          const par = (x: { x: number; y: number }) => ((x.x - p.x) * dx + (x.y - p.y) * dy) / (L * L);
          const ta = par(la), tb = par(lb);
          if (dist(la) < tol && dist(lb) < tol && ta > -1e-4 && ta < 1 + 1e-4 && tb > -1e-4 && tb < 1 + 1e-4) {
            return { parede: w, contorno: c, p, q, noTopo, ta: Math.min(ta, tb), tb: Math.max(ta, tb) };
          }
        }
      }
    }
    return null;
  }
}

/** Recorta um polígono no semiplano f(q) ≥ 0 (Sutherland–Hodgman). */
export function recortarPoligono(c: P2[], f: (q: P2) => number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < c.length; i++) {
    const p = c[i], q = c[(i + 1) % c.length];
    const fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const k = fp / (fp - fq);
      out.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
    }
  }
  return out;
}

/** Ponto dentro do polígono (par-ímpar). */
function dentroDoPoligono(p: P2, c: P2[]): boolean {
  let dentro = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    if ((c[i].y > p.y) !== (c[j].y > p.y) && p.x < ((c[j].x - c[i].x) * (p.y - c[i].y)) / (c[j].y - c[i].y) + c[i].x) dentro = !dentro;
  }
  return dentro;
}

/** Aplica os cortes de canto a um sólido. */
function cortar(x: Shape3D, cortes: Corte[] | undefined): Shape3D {
  for (const c of cortes ?? []) x = x.cut(semiespaco(c));
  return x;
}

/** Normal externa (no plano) da aresta p→q de um contorno com área assinada `area`. */
export function normalExterna(p: P2, q: P2, area: number): P2 {
  const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1;
  // anti-horário: o lado de fora fica à direita do sentido do contorno
  return area >= 0 ? { x: dy / L, y: -dx / L } : { x: -dy / L, y: dx / L };
}

export function areaContorno(c: P2[]): number {
  let a = 0;
  for (let i = 0; i < c.length; i++) {
    const p = c[i], q = c[(i + 1) % c.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Recuo da dobra (quanto a mãe encolhe) pela posição da flange, como no "canto vivo virtual". */
export function recuo(posicao: "materialInterno" | "materialExterno" | "dobraExterna", theta: number, r: number, t: number): number {
  const tg = theta <= Math.PI / 2 + 1e-9 ? Math.tan(theta / 2) : 1;
  if (posicao === "materialInterno") return (r + t) * tg;
  if (posicao === "materialExterno") return r * tg;
  return 0;
}

/** Comprimento reto da flange (depois da dobra) conforme a medição escolhida. */
export function comprimentoReto(medicao: "externoVirtual" | "internoVirtual" | "tangente", L: number, theta: number, r: number, t: number): number {
  const tg = theta <= Math.PI / 2 + 1e-9 ? Math.tan(theta / 2) : 1;
  if (medicao === "externoVirtual") return Math.max(0, L - (r + t) * tg);
  if (medicao === "internoVirtual") return Math.max(0, L - r * tg);
  return Math.max(0, L);
}

/** Polígono convexo/qualquer como desenho fechado (para alívios e quebra de canto). */
export function desenhoDoPoligono(pts: P2[]): Drawing {
  return poligonoDesenho(pts);
}

/** Círculo como desenho e como polígono (48 lados, para o 3D da dobra). */
export function circuloAlivio(c: P2, r: number): { poli: P2[]; desenho: Drawing } {
  const poli = Array.from({ length: 48 }, (_, i) => ({ x: c.x + r * Math.cos((i * Math.PI) / 24), y: c.y + r * Math.sin((i * Math.PI) / 24) }));
  return { poli, desenho: drawCircle(r).translate(c.x, c.y) };
}
