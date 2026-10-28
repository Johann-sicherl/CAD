// WJFlow: geometria da peça e do túnel (puro, testado em Node: scripts/teste-flow.ts).
// - Malha de triângulos vinda do WJCAD (mm) ou de STL (formato aberto, binário ou texto).
// - Orientação: a peça gira para o ar correr no +X do túnel (Y continua para cima quando dá).
// - Túnel ajustado ao corpo: montante, jusante e bloqueio fixos; a célula sai do orçamento de
//   células do modo (rascunho/padrão/qualidade).
// - Voxelização por paridade de raios em X (um raio por coluna y-z, triângulos agrupados por
//   coluna): célula sólida quando o centro dela está dentro da peça.
// - Propriedades do ar pela temperatura e altitude (gás ideal, atmosfera padrão, Sutherland).

import { EQ, SAIDA, SOLIDO } from "./lbm";

export type Vec3 = [number, number, number];

/** Malha de triângulos: 3 coordenadas por vértice; 3 índices por triângulo. */
export interface Malha {
  vertices: Float32Array;
  triangulos: Uint32Array;
}

/** Para onde o ar corre, nos eixos da peça (WJCAD: Y para cima). */
export type Direcao = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";
export const DIRECOES: [Direcao, string][] = [
  ["+x", "+X (da esquerda para a direita na vista Frontal)"],
  ["-x", "−X"],
  ["+z", "+Z (de trás para a frente)"],
  ["-z", "−Z (da frente para trás)"],
  ["+y", "+Y (de baixo para cima)"],
  ["-y", "−Y (de cima para baixo)"],
];

// ---------------------------------------------------------------------------------------------
// STL

/** Lê STL binário ou em texto (ASCII). */
export function lerStl(dados: ArrayBuffer): Malha {
  const bytes = new Uint8Array(dados);
  if (dados.byteLength >= 84) {
    const n = new DataView(dados).getUint32(80, true);
    if (84 + n * 50 === dados.byteLength) return stlBinario(dados, n);
  }
  const texto = new TextDecoder().decode(bytes);
  if (!/^\s*solid/i.test(texto) || !/facet/i.test(texto)) throw new Error("O arquivo não é um STL válido.");
  const nums = [...texto.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g)];
  if (!nums.length || nums.length % 3) throw new Error("STL em texto incompleto (vértices faltando).");
  const v = new Float32Array(nums.length * 3);
  nums.forEach((m, i) => {
    v[3 * i] = +m[1];
    v[3 * i + 1] = +m[2];
    v[3 * i + 2] = +m[3];
  });
  return { vertices: v, triangulos: Uint32Array.from({ length: nums.length }, (_, i) => i) };
}

function stlBinario(dados: ArrayBuffer, n: number): Malha {
  const dv = new DataView(dados);
  const v = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12; // pula a normal
    for (let k = 0; k < 9; k++) v[t * 9 + k] = dv.getFloat32(o + 4 * k, true);
  }
  return { vertices: v, triangulos: Uint32Array.from({ length: n * 3 }, (_, i) => i) };
}

/** STL binário (exportar a peça orientada, testes). */
export function escreverStl(m: Malha): ArrayBuffer {
  const n = m.triangulos.length / 3;
  const b = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(b);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 3; k++) {
      const vi = m.triangulos[3 * t + k];
      for (let e = 0; e < 3; e++) dv.setFloat32(o + 12 * k + 4 * e, m.vertices[3 * vi + e], true);
    }
  }
  return b;
}

// ---------------------------------------------------------------------------------------------
// orientação e caixa

export function caixa(m: Malha): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const v = m.vertices;
  for (let i = 0; i < v.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      if (v[i + e] < min[e]) min[e] = v[i + e];
      if (v[i + e] > max[e]) max[e] = v[i + e];
    }
  }
  return { min, max };
}

/**
 * Gira a peça para o ar correr no +X do túnel. Rotações próprias (mantêm o sentido das faces):
 * X do túnel = direção do ar; Y do túnel = Y da peça (ou Z dela, se o ar for vertical).
 */
export function paraTunel(m: Malha, d: Direcao): Malha {
  const f: Record<Direcao, (x: number, y: number, z: number) => Vec3> = {
    "+x": (x, y, z) => [x, y, z],
    "-x": (x, y, z) => [-x, y, -z],
    "+z": (x, y, z) => [z, y, -x],
    "-z": (x, y, z) => [-z, y, x],
    "+y": (x, y, z) => [y, z, x],
    "-y": (x, y, z) => [-y, z, -x],
  };
  const g = f[d];
  const v = new Float32Array(m.vertices.length);
  for (let i = 0; i < v.length; i += 3) v.set(g(m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]), i);
  return { vertices: v, triangulos: m.triangulos };
}

// ---------------------------------------------------------------------------------------------
// túnel

export interface OpcoesDominio {
  /** Orçamento de células (o túnel inteiro). */
  celulas: number;
  /** Comprimentos do corpo antes e depois dele. */
  montante?: number;
  jusante?: number;
  /** Área frontal da caixa da peça / seção do túnel (≤ 5 % dispensa correção). */
  bloqueio?: number;
}

export interface Dominio {
  nx: number;
  ny: number;
  nz: number;
  /** Tamanho da célula, na unidade da malha. */
  dx: number;
  /** Centro da célula (0, 0, 0), na unidade da malha. */
  origem: Vec3;
  tipo: Uint8Array;
  /** Área frontal da peça voxelizada (células projetadas no plano y-z). */
  areaFrontal: number;
  /** Comprimento da peça na direção do ar (unidade da malha) e em células. */
  comprimento: number;
  celulasNoCorpo: number;
  /** Colunas com número ímpar de cruzamentos (malha aberta ou com falhas). */
  colunasSuspeitas: number;
  celulasSolidas: number;
}

/** Monta o túnel em volta da peça (já orientada: ar em +X) e voxeliza. */
export function montarDominio(m: Malha, o: OpcoesDominio): Dominio {
  const { min, max } = caixa(m);
  const L = Math.max(max[0] - min[0], 1e-9), H = max[1] - min[1], Wd = max[2] - min[2];
  const montante = o.montante ?? 1.5, jusante = o.jusante ?? 4, bloqueio = o.bloqueio ?? 0.05;
  const lado = Math.max(Math.sqrt((Math.max(H, 1e-9) * Math.max(Wd, 1e-9)) / bloqueio), 2 * Math.max(H, Wd), 0.6 * L);
  const Lx = (montante + 1 + jusante) * L;
  const dx = Math.cbrt((Lx * lado * lado) / o.celulas);
  const nx = Math.max(8, Math.round(Lx / dx)), ny = Math.max(8, Math.round(lado / dx)), nz = ny;
  const origem: Vec3 = [
    min[0] - montante * L + 0.5 * dx,
    (min[1] + max[1]) / 2 - (ny / 2 - 0.5) * dx,
    (min[2] + max[2]) / 2 - (nz / 2 - 0.5) * dx,
  ];
  const { tipo, suspeitas, solidas, area } = voxelizar(m, nx, ny, nz, dx, origem);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const c = x + nx * (y + ny * z);
        if (x === nx - 1) tipo[c] = SAIDA;
        else if (x === 0 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1) tipo[c] = EQ;
      }
    }
  }
  return { nx, ny, nz, dx, origem, tipo, areaFrontal: area, comprimento: L, celulasNoCorpo: L / dx, colunasSuspeitas: suspeitas, celulasSolidas: solidas };
}

/**
 * Marca como sólida a célula cujo centro está dentro da malha: para cada coluna (y, z), um raio
 * em +X cruza os triângulos; entre cruzamentos ímpar e par é dentro. O raio sai levemente
 * deslocado do centro para não passar exatamente por arestas e vértices.
 */
export function voxelizar(m: Malha, nx: number, ny: number, nz: number, dx: number, origem: Vec3) {
  const tipo = new Uint8Array(nx * ny * nz);
  const v = m.vertices, t = m.triangulos;
  const cruz: number[][] = Array.from({ length: ny * nz }, () => []);
  const dy = 1.37e-5 * dx, dz = 2.71e-5 * dx;
  for (let k = 0; k < t.length; k += 3) {
    const a = 3 * t[k], b = 3 * t[k + 1], c = 3 * t[k + 2];
    const ay = v[a + 1], az = v[a + 2], by = v[b + 1], bz = v[b + 2], cy = v[c + 1], cz = v[c + 2];
    const det = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
    if (det === 0) continue; // triângulo de perfil: o raio não o atravessa
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - origem[1]) / dx));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - origem[1]) / dx));
    const k0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - origem[2]) / dx));
    const k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - origem[2]) / dx));
    for (let kk = k0 - 1; kk <= k1 + 1; kk++) {
      if (kk < 0 || kk >= nz) continue;
      for (let jj = j0 - 1; jj <= j1 + 1; jj++) {
        if (jj < 0 || jj >= ny) continue;
        const py = origem[1] + jj * dx + dy, pz = origem[2] + kk * dx + dz;
        // coordenadas baricêntricas no plano y-z
        const l1 = ((py - ay) * (cz - az) - (cy - ay) * (pz - az)) / det;
        const l2 = ((by - ay) * (pz - az) - (py - ay) * (bz - az)) / det;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        cruz[jj + ny * kk].push(v[a] + l1 * (v[b] - v[a]) + l2 * (v[c] - v[a]));
      }
    }
  }
  let suspeitas = 0, solidas = 0, area = 0;
  for (let kk = 0; kk < nz; kk++) {
    for (let jj = 0; jj < ny; jj++) {
      const xs = cruz[jj + ny * kk];
      if (!xs.length) continue;
      if (xs.length % 2) suspeitas++;
      xs.sort((p, q) => p - q);
      let algum = false;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const i0 = Math.max(0, Math.ceil((xs[i] - origem[0]) / dx));
        const i1 = Math.min(nx - 1, Math.floor((xs[i + 1] - origem[0]) / dx));
        for (let x = i0; x <= i1; x++) {
          tipo[x + nx * (jj + ny * kk)] = SOLIDO;
          solidas++;
          algum = true;
        }
      }
      if (algum) area++;
    }
  }
  return { tipo, suspeitas, solidas, area };
}

// ---------------------------------------------------------------------------------------------
// formas de teste e validação

/** Esfera fechada (UV) de raio r e centro c. */
export function esfera(r: number, c: Vec3 = [0, 0, 0], nLat = 24, nLon = 48): Malha {
  const v: number[] = [];
  for (let i = 0; i <= nLat; i++) {
    const th = (Math.PI * i) / nLat;
    for (let j = 0; j < nLon; j++) {
      const ph = (2 * Math.PI * j) / nLon;
      v.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph));
    }
  }
  const t: number[] = [];
  const id = (i: number, j: number) => i * nLon + (j % nLon);
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      // sentido anti-horário visto de fora: normais para fora (regra do STL)
      if (i > 0) t.push(id(i, j), id(i, j + 1), id(i + 1, j));
      if (i < nLat - 1) t.push(id(i, j + 1), id(i + 1, j + 1), id(i + 1, j));
    }
  }
  return { vertices: new Float32Array(v), triangulos: new Uint32Array(t) };
}

// ---------------------------------------------------------------------------------------------
// ar

export interface PropriedadesAr {
  /** K */
  T: number;
  /** Pa */
  p: number;
  /** kg/m³ */
  rho: number;
  /** Pa·s */
  mu: number;
  /** m²/s */
  nu: number;
  /** m/s */
  som: number;
}

/** Ar seco pela temperatura (°C) e altitude (m): atmosfera padrão para a pressão, Sutherland para μ. */
export function propriedadesAr(tC = 20, altitude = 0): PropriedadesAr {
  const T = tC + 273.15;
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
  const rho = p / (287.05 * T);
  const mu = 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4);
  return { T, p, rho, mu, nu: mu / rho, som: Math.sqrt(1.4 * 287.05 * T) };
}
