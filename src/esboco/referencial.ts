// Referencial do plano de esboço: origem, eixos X/Y do esboço e normal, em coordenadas do mundo.
// Y para cima (como nos CADs profissionais): Frontal (XY) visto de +Z, Superior (XZ) visto de cima
// (+Y, com o −Z do mundo para cima no esboço), Lateral (YZ) visto de +X (o −Z fica à direita).

import type { SuporteEsboco, Vec3 } from "../model";

export interface Referencial {
  origem: Vec3;
  x: Vec3;
  y: Vec3;
  normal: Vec3;
}

const BASES: Record<"XY" | "XZ" | "YZ", { x: Vec3; normal: Vec3 }> = {
  XY: { x: [1, 0, 0], normal: [0, 0, 1] }, // Frontal: y do esboço = +Y
  XZ: { x: [1, 0, 0], normal: [0, 1, 0] }, // Superior: y do esboço = −Z
  YZ: { x: [0, 0, -1], normal: [1, 0, 0] }, // Lateral: y do esboço = +Y
};

export const cruz = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const escalar = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const normalizar = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/**
 * Planos de referência resolvidos na última regeneração (o kernel calcula; a interface registra
 * aqui para desenhar e esboçar neles). Chave = id do recurso de plano.
 */
export const planosResolvidos = new Map<string, Referencial>();

export function referencial(s: SuporteEsboco, planos: Map<string, Referencial> = planosResolvidos): Referencial {
  if (s.tipo === "planoRef") {
    const r = planos.get(s.id);
    if (!r) throw new Error("O plano de referência deste esboço não existe ou vem depois dele.");
    return r;
  }
  if (s.tipo === "plano") {
    const b = BASES[s.plano];
    const origem = b.normal.map((v) => v * s.deslocamento) as Vec3;
    return { origem, x: b.x, y: cruz(b.normal, b.x), normal: b.normal };
  }
  const normal = normalizar(s.normal);
  const x = normalizar(s.eixoX);
  return { origem: s.origem, x, y: cruz(normal, x), normal };
}

/**
 * Eixo X do esboço para uma face plana com normal `n`: horizontal sempre que possível,
 * para que o "para cima" do esboço numa face vertical seja o Y do modelo.
 */
export function eixoXParaNormal(n: Vec3): Vec3 {
  const y: Vec3 = [0, 1, 0];
  const x = cruz(y, n);
  return Math.hypot(...x) < 1e-6 ? [1, 0, 0] : normalizar(x);
}

export function paraMundo(r: Referencial, u: number, v: number): Vec3 {
  return [
    r.origem[0] + r.x[0] * u + r.y[0] * v,
    r.origem[1] + r.x[1] * u + r.y[1] * v,
    r.origem[2] + r.x[2] * u + r.y[2] * v,
  ];
}

export function paraPlano(r: Referencial, p: Vec3): { x: number; y: number } {
  const d: Vec3 = [p[0] - r.origem[0], p[1] - r.origem[1], p[2] - r.origem[2]];
  return { x: escalar(d, r.x), y: escalar(d, r.y) };
}
