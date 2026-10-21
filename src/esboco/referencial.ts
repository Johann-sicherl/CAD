// Referencial do plano de esboço: origem, eixos X/Y do esboço e normal, em coordenadas do mundo.
// Mesma convenção dos planos nomeados do kernel (replicad), para o esboço na tela e o sólido
// gerado coincidirem: Superior (XY) olha de cima; Frontal (XZ) e Lateral (YZ) têm o Y do esboço = Z.

import type { SuporteEsboco, Vec3 } from "../model";

export interface Referencial {
  origem: Vec3;
  x: Vec3;
  y: Vec3;
  normal: Vec3;
}

const BASES: Record<"XY" | "XZ" | "YZ", { x: Vec3; normal: Vec3 }> = {
  XY: { x: [1, 0, 0], normal: [0, 0, 1] },
  XZ: { x: [1, 0, 0], normal: [0, -1, 0] },
  YZ: { x: [0, 1, 0], normal: [1, 0, 0] },
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

export function referencial(s: SuporteEsboco): Referencial {
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
 * para que o "para cima" do esboço numa face vertical seja o Z do modelo.
 */
export function eixoXParaNormal(n: Vec3): Vec3 {
  const z: Vec3 = [0, 0, 1];
  const x = cruz(z, n);
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
