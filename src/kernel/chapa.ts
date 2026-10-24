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

import { drawRectangle, Plane, type Drawing, type Shape3D } from "replicad";
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

export interface Parede {
  id: string;
  q: Quadro;
  /** Lado do material: +1 = para +n, −1 = para −n. */
  s: 1 | -1;
  plano: Plano2;
  forma: Drawing;
  /** Contornos (em coordenadas locais) usados para achar arestas tocadas no modelo. */
  contornos: P2[][];
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

/** Retângulo [x0, x1] × [y0, y1] como desenho. */
export function retanguloDesenho(x0: number, x1: number, y0: number, y1: number): Drawing {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  return drawRectangle(w, h).translate((x0 + x1) / 2, (y0 + y1) / 2);
}

export class ModeloChapa {
  paredes: Parede[] = [];
  dobras: Dobra[] = [];
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
      sentidoPlano: ((o.paraMaterial ? P.s : -P.s) * oriP) as 1 | -1,
    });
    const filha: Parede = { id: o.idFilha, q: { o: oC, u: e3, v: vC, n: nC }, s: sC, plano, forma: o.forma ?? retanguloDesenho(0, 0, 0, 0), contornos: o.forma ? o.contornos : [] };
    if (o.forma) this.paredes.push(filha);
    return filha;
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
      partes.push(sk.extrude(w.s * t));
    }
    for (const b of this.dobras) partes.push(this.solidoDobra(b));
    if (!partes.length) throw new Error("A chapa ficou vazia.");
    return partes.slice(1).reduce((acc, x) => acc.fuse(x), partes[0]);
  }

  private solidoDobra(b: Dobra): Shape3D {
    const P = this.parede(b.pai)!;
    const t = this.p.t;
    const E0 = local3(P.q, b.e0);
    const e3 = unit(lin3(P.q, b.e)), d3 = unit(lin3(P.q, b.d));
    const zA = b.paraMaterial ? P.s * (t + b.r) : -P.s * b.r;
    const A = soma(E0, mul(P.q.n, zA));
    const b3 = mul(P.q.n, b.paraMaterial ? P.s : -P.s);
    const phi = esc(cruz(e3, d3), b3) >= 0 ? b.theta : -b.theta;
    // seção da chapa na aresta (retângulo largura × espessura) girada em torno do eixo
    const plano = new Plane(soma(E0, mul(e3, b.s0)), e3, d3);
    const yN = esc(P.q.n, cruz(d3, e3)); // ±1: n no eixo y do plano
    const sec = retanguloDesenho(0, b.s1 - b.s0, 0, P.s * t * yN);
    const sk = sec.sketchOnPlane(plano) as unknown as { revolve(e: Vec3, o: { origin: Vec3; angle: number }): Shape3D };
    return sk.revolve(e3, { origin: A, angle: (phi * 180) / Math.PI });
  }

  // ---------- planificado ----------

  /** Desenho do planificado (coordenadas locais da parede raiz) e linhas de dobra. */
  planificado(): { desenho: Drawing; dobras: { a: P2; b: P2; cima: boolean; angulo: number; raio: number }[] } {
    let D: Drawing | null = null;
    const juntar = (x: Drawing) => (D = D ? D.fuse(x) : x);
    for (const w of this.paredes) {
      const p = w.plano;
      juntar(transformarDesenho(w.forma, p.u.x, p.v.x, p.u.y, p.v.y, p.o.x, p.o.y));
    }
    const linhas: { a: P2; b: P2; cima: boolean; angulo: number; raio: number }[] = [];
    for (const b of this.dobras) {
      const P = this.parede(b.pai)!;
      const ponto = (s: number, h: number) => plano2(P.plano, s2(b.e0, s2(m2(b.e, s), m2(b.d, h))));
      const c = [ponto(b.s0, 0), ponto(b.s1, 0), ponto(b.s1, b.ba), ponto(b.s0, b.ba)];
      // região da dobra no planificado (retângulo de largura BA)
      const minx = Math.min(...c.map((q) => q.x)), maxx = Math.max(...c.map((q) => q.x));
      const miny = Math.min(...c.map((q) => q.y)), maxy = Math.max(...c.map((q) => q.y));
      const e = lin2(P.plano, b.e);
      if (Math.abs(e.x) < 1e-9 || Math.abs(e.y) < 1e-9) juntar(retanguloDesenho(minx, maxx, miny, maxy));
      else {
        const ang = (Math.atan2(e.y, e.x) * 180) / Math.PI;
        juntar(retanguloDesenho(0, b.s1 - b.s0, 0, b.ba).rotate(ang, [0, 0]).translate(c[0].x, c[0].y));
      }
      linhas.push({ a: ponto(b.s0, b.ba / 2), b: ponto(b.s1, b.ba / 2), cima: b.sentidoPlano > 0, angulo: (b.theta * 180) / Math.PI, raio: b.r });
    }
    if (!D) throw new Error("A chapa ficou vazia.");
    return { desenho: D, dobras: linhas };
  }

  /** Sólido do planificado, deitado no plano da parede raiz. */
  solidoPlanificado(): { solido: Shape3D; linhas3D: Vec3[][] } {
    const raiz = this.paredes[0];
    const { desenho, dobras } = this.planificado();
    const sk = desenho.sketchOnPlane(new Plane(raiz.q.o, raiz.q.u, raiz.q.n)) as unknown as { extrude(d: number): Shape3D };
    const z = raiz.s * this.p.t * 1.001; // linhas de dobra sobre a face de cima
    return { solido: sk.extrude(raiz.s * this.p.t), linhas3D: dobras.map((l) => [local3(raiz.q, l.a, z), local3(raiz.q, l.b, z)]) };
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
