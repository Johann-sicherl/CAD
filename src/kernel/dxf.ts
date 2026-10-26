// DXF (R12, mm) do planificado da chapa: contorno em LINE/ARC, linhas de dobra em camadas
// separadas (para cima / para baixo) e notas de dobra. Também o resumo da lista de corte.
// O contorno vem do desenho 2D do replicad (toSVGPaths: Y invertido, como no SVG).

import type { Drawing } from "replicad";
import type { P2 } from "../esboco/geometria";
import type { ParamChapa } from "./chapa";

export interface ResumoPlanificado {
  largura: number;
  altura: number;
  /** Comprimento total de corte (contorno externo + recortes internos), mm. */
  comprimentoCorte: number;
  /** Área da chapa planificada (mm²). */
  area: number;
  dobras: number;
  recortes: number;
  espessura: number;
  raio: number;
  fatorK: number;
}

type Entidade = { tipo: "linha"; a: P2; b: P2 } | { tipo: "arco"; c: P2; r: number; a0: number; a1: number; p0: P2; p1: P2 };

const num = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6)));

/** Lê os caminhos SVG do replicad (M, L, A, C, Q, Z) em entidades (Y de volta para cima). */
function entidadesDoCaminho(d: string): { ents: Entidade[]; pol: P2[] }[] {
  const toks = d.match(/[MLACQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const laços: { ents: Entidade[]; pol: P2[] }[] = [];
  let atual: { ents: Entidade[]; pol: P2[] } | null = null;
  let i = 0, cur: P2 = { x: 0, y: 0 }, ini: P2 = { x: 0, y: 0 };
  const n = () => Number(toks[i++]);
  const pt = (): P2 => {
    const x = n(), y = n();
    return { x, y: -y };
  };
  const linha = (b: P2) => {
    if (Math.hypot(b.x - cur.x, b.y - cur.y) > 1e-9) atual!.ents.push({ tipo: "linha", a: cur, b });
    atual!.pol.push(b);
    cur = b;
  };
  while (i < toks.length) {
    const c = toks[i++].toUpperCase();
    if (c === "M") {
      cur = ini = pt();
      atual = { ents: [], pol: [cur] };
      laços.push(atual);
    } else if (c === "L") linha(pt());
    else if (c === "Z") linha(ini);
    else if (c === "A") {
      const r = n();
      n(); // ry (= rx: arcos de círculo)
      n(); // rotação
      const grande = n() === 1, sweep = n() === 1;
      const b = pt();
      // com o Y invertido, sweep = 1 vira sentido horário
      const ccw = !sweep;
      const mx = (cur.x + b.x) / 2, my = (cur.y + b.y) / 2;
      const dx = b.x - cur.x, dy = b.y - cur.y, h = Math.hypot(dx, dy) / 2;
      const dist = Math.sqrt(Math.max(0, r * r - h * h));
      const nx = -dy / (2 * h || 1), ny = dx / (2 * h || 1);
      const sg = ccw !== grande ? 1 : -1;
      const centro = { x: mx + sg * nx * dist, y: my + sg * ny * dist };
      const angA = Math.atan2(cur.y - centro.y, cur.x - centro.x), angB = Math.atan2(b.y - centro.y, b.x - centro.x);
      // DXF: arco sempre anti-horário do ângulo inicial ao final
      const [a0, a1, p0, p1] = ccw ? [angA, angB, cur, b] : [angB, angA, b, cur];
      atual!.ents.push({ tipo: "arco", c: centro, r, a0, a1, p0, p1 });
      // polígono (para área): amostra o arco no sentido percorrido
      let varr = angB - angA;
      if (ccw && varr < 0) varr += 2 * Math.PI;
      if (!ccw && varr > 0) varr -= 2 * Math.PI;
      for (let k = 1; k <= 16; k++) atual!.pol.push({ x: centro.x + r * Math.cos(angA + (varr * k) / 16), y: centro.y + r * Math.sin(angA + (varr * k) / 16) });
      cur = b;
    } else if (c === "C" || c === "Q") {
      // curvas livres (splines): viram segmentos de reta
      const ps = c === "C" ? [cur, pt(), pt(), pt()] : [cur, pt(), pt()];
      for (let k = 1; k <= 16; k++) {
        const s = k / 16, u = 1 - s;
        const p = c === "C"
          ? { x: u ** 3 * ps[0].x + 3 * u * u * s * ps[1].x + 3 * u * s * s * ps[2].x + s ** 3 * ps[3].x, y: u ** 3 * ps[0].y + 3 * u * u * s * ps[1].y + 3 * u * s * s * ps[2].y + s ** 3 * ps[3].y }
          : { x: u * u * ps[0].x + 2 * u * s * ps[1].x + s * s * ps[2].x, y: u * u * ps[0].y + 2 * u * s * ps[1].y + s * s * ps[2].y };
        linha(p);
      }
    }
  }
  return laços;
}

/** Laços de um desenho 2D: entidades (retas e arcos) e polígono amostrado de cada um. */
export function lacosDoDesenho(D: Drawing): { ents: Entidade[]; pol: P2[] }[] {
  return (D.toSVGPaths().flat() as string[]).flatMap(entidadesDoCaminho);
}

const comprimentoEnt = (e: Entidade) => {
  if (e.tipo === "linha") return Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
  let v = e.a1 - e.a0;
  while (v <= 0) v += 2 * Math.PI;
  return e.r * v;
};

const areaPol = (p: P2[]) => p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0) / 2;

export function dxfDoPlanificado(
  desenho: Drawing,
  dobras: { a: P2; b: P2; cima: boolean; angulo: number; raio: number }[],
  nome: string,
  p: ParamChapa,
  nDobras: number,
): { dxf: string; resumo: ResumoPlanificado } {
  const caminhos = desenho.toSVGPaths().flat() as string[];
  const lacos = caminhos.flatMap(entidadesDoCaminho);
  const out: string[] = [];
  const g = (code: number, v: string | number) => out.push(String(code), typeof v === "number" ? String(num(v)) : v);
  // cabeçalho mínimo + camadas
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$INSUNITS"); g(70, 4);
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LAYER"); g(70, 4);
  for (const [nomeCamada, cor, tipo] of [["CONTORNO", 7, "CONTINUOUS"], ["DOBRA_CIMA", 3, "CONTINUOUS"], ["DOBRA_BAIXO", 1, "CONTINUOUS"], ["NOTAS", 8, "CONTINUOUS"]] as const) {
    g(0, "LAYER"); g(2, nomeCamada); g(70, 0); g(62, cor); g(6, tipo);
  }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  let corte = 0;
  for (const l of lacos) {
    for (const e of l.ents) {
      corte += comprimentoEnt(e);
      if (e.tipo === "linha") {
        g(0, "LINE"); g(8, "CONTORNO"); g(10, e.a.x); g(20, e.a.y); g(30, 0); g(11, e.b.x); g(21, e.b.y); g(31, 0);
      } else {
        g(0, "ARC"); g(8, "CONTORNO"); g(10, e.c.x); g(20, e.c.y); g(30, 0); g(40, e.r);
        g(50, (e.a0 * 180) / Math.PI); g(51, (e.a1 * 180) / Math.PI);
      }
    }
  }
  for (const d of dobras) {
    const camada = d.cima ? "DOBRA_CIMA" : "DOBRA_BAIXO";
    g(0, "LINE"); g(8, camada); g(10, d.a.x); g(20, d.a.y); g(30, 0); g(11, d.b.x); g(21, d.b.y); g(31, 0);
    const m = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
    const ang = (Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x) * 180) / Math.PI;
    const txt = `${d.cima ? "CIMA" : "BAIXO"} ${Number(d.angulo.toFixed(1))} R${Number(d.raio.toFixed(2))}`;
    g(0, "TEXT"); g(8, "NOTAS"); g(10, m.x); g(20, m.y + 1); g(30, 0); g(40, Math.max(1.5, p.t)); g(1, txt);
    g(50, ang > 90 || ang < -90 ? ang + 180 : ang);
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  const bb = desenho.boundingBox.bounds as [[number, number], [number, number]];
  // área: laço externo (maior) menos os recortes
  const areas = lacos.map((l) => Math.abs(areaPol(l.pol))).sort((a, b) => b - a);
  const area = areas.length ? areas[0] - areas.slice(1).reduce((s, a) => s + a, 0) : 0;
  return {
    dxf: `999\n${nome} — planificado (WJCAD)\n${out.join("\n")}\n`,
    resumo: {
      largura: bb[1][0] - bb[0][0], altura: bb[1][1] - bb[0][1], comprimentoCorte: corte, area, dobras: nDobras,
      recortes: Math.max(0, lacos.length - 1), espessura: p.t, raio: p.r, fatorK: p.k,
    },
  };
}
