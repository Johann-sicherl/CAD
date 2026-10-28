// WJFlow: solver D3Q19 em WebGPU (compute shader) e desenho de um plano de corte.
// Mesmo algoritmo de src/flow/lbm.ts (referência em CPU): populações deslocadas, passo "pull",
// bounce-back, células EQ, BGK + Smagorinsky + força de Guo.
//
// Kernel enxuto (medido no TCL Tab A1 Plus: a Adreno 613 era limitada por cálculo e registradores,
// não por memória):
// - uma célula por thread, despacho 3D (x, y, z vêm do índice da thread, sem divisões);
// - 19 variáveis escalares desenroladas, sem arrays (arrays privados vão para a memória lenta);
// - equilíbrio calculado na hora da colisão; o tensor do Smagorinsky sai dos momentos de 2ª
//   ordem (Σcc·f̃ − δρ/3·δ − ρuu, exato no D3Q19), sem guardar os 19 valores de equilíbrio;
// - bit 7 do tipo marca célula com vizinho sólido: só essas consultam as 18 vizinhas;
// - células sólidas não são regravadas (o valor delas não muda);
// - código da força de Guo só entra quando o caso tem força.
//
// Precisão de armazenamento (a conta é sempre em f32):
// - fp32: f[i·n + c];
// - fp16: palavra u32 k·n + c com o par de direções opostas (2k−1, 2k); a palavra 0 guarda só a
//   direção 0. Valores guardados × ESCALA_FP16 e convertidos por meiaBits (ao par mais próximo):
//   a Adreno 613 trunca e zera subnormais no pack2x16float (ver lbm.ts).

import { CX, CY, CZ, EQ, ESCALA_FP16, FLUIDO, Q, SAIDA, SOLIDO, W, equilibrio, meiaParaFloat, opp, smagorinsky, type Precisao } from "./lbm";

export interface ConfigGpu {
  nx: number;
  ny: number;
  nz: number;
  tau: number;
  cs: number;
  u: [number, number, number];
  precisao: Precisao;
  tipo: Uint8Array;
  /** Compila o termo de força de Guo (canal com força, disco atuador). */
  forca?: boolean;
  /** Threads por grupo em x (padrão 64). */
  grupo?: number;
  /** Zona esponja e camadas absorventes (ver lbm.ts). */
  esponja?: { x0: number; dtau: number; sigma?: number; entrada?: number };
  /** Colisão regularizada (ver lbm.ts): estável com τ → ½. */
  regularizado?: boolean;
}

/** O que o corte mostra. */
export type Grandeza = "velocidade" | "ux" | "cp" | "vorticidade";
export const GRANDEZAS: [Grandeza, string][] = [
  ["velocidade", "Velocidade |u| / U∞"],
  ["ux", "Velocidade na direção do ar (negativa = recirculação)"],
  ["cp", "Coeficiente de pressão Cp"],
  ["vorticidade", "Vorticidade (giro do ar)"],
];
/** Plano do corte: 0 = lateral (x-y, vista de lado), 1 = superior (x-z, vista de cima). */
export type Plano = 0 | 1;

// constantes da especificação WebGPU (os tipos do TypeScript não trazem os objetos globais)
const USO = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as const;
const ESTAGIO_COMPUTE = 4;
const MAPA_LEITURA = 1;
const VIZINHO_SOLIDO = 128;
const num = (v: number) => {
  const s = String(Math.fround(v));
  return /[.e]/.test(s) ? s : `${s}.0`;
};
/** Palavras u32 por célula num buffer. */
const palavras = (p: Precisao) => (p === "fp32" ? Q : 10);

/** Expressão WGSL que lê a população i da célula `c` (em f32, já sem a escala). */
function carregar(precisao: Precisao, i: number, c: string): string {
  if (precisao === "fp32") return `fa[${i}u * p.n + ${c}]`;
  const k = (i + 1) >> 1;
  const metade = i !== 0 && i % 2 === 0 ? "y" : "x";
  return `(unpack2x16float(fa[${k}u * p.n + ${c}]).${metade} * ${num(1 / ESCALA_FP16)})`;
}

/** Comandos WGSL que gravam f0..f18 (variáveis `${v}0`…) na célula `c` do buffer de saída. */
function gravar(precisao: Precisao, v: string, c: string): string {
  if (precisao === "fp32") return Array.from({ length: Q }, (_, i) => `fb[${i}u * p.n + ${c}] = ${v}${i};`).join(" ");
  const S = num(ESCALA_FP16);
  const L = [`fb[${c}] = meiaBits(${v}0 * ${S});`];
  for (let k = 1; k < 10; k++) L.push(`fb[${k}u * p.n + ${c}] = meiaBits(${v}${2 * k - 1} * ${S}) | (meiaBits(${v}${2 * k} * ${S}) << 16u);`);
  return L.join("\n  ");
}

/** Código WGSL comum: parâmetros, buffers, tipo da célula e conversão FP16. */
function wgslBase(precisao: Precisao, leituraEscrita: boolean): string {
  const tipo = precisao === "fp32" ? "f32" : "u32";
  return `
struct P { nx: u32, ny: u32, nz: u32, n: u32, tau: f32, smag: f32, ux: f32, uy: f32, uz: f32, esX0: u32, gxf: f32, gyf: f32, gzf: f32, corte: u32, escala: f32, esDt: f32, plano: u32, grandeza: u32, escalaVort: f32, esSig: f32, esEnt: u32, pad1: u32, pad2: u32, pad3: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> tipo: array<u32>;
@group(0) @binding(2) var<storage, read> fa: array<${tipo}>;
${leituraEscrita ? `@group(0) @binding(3) var<storage, read_write> fb: array<${tipo}>;` : ""}
fn tipoDe(c: u32) -> u32 { return (tipo[c >> 2u] >> ((c & 3u) * 8u)) & 255u; }
${precisao === "fp16" && leituraEscrita ? `fn meiaBits(v: f32) -> u32 {
  let u = bitcast<u32>(v);
  let s = (u >> 16u) & 0x8000u;
  let e = i32((u >> 23u) & 0xffu) - 112;
  if (e <= 0) { return s; }
  if (e >= 31) { return s | 0x7bffu; }
  let m = u & 0x7fffffu;
  var h = (u32(e) << 10u) | (m >> 13u);
  let resto = m & 0x1fffu;
  if (resto > 0x1000u || (resto == 0x1000u && (h & 1u) == 1u)) { h += 1u; }
  return s | min(h, 0x7bffu);
}` : ""}
`;
}

/** Soma WGSL Σ coef(i)·f_i só com os termos não nulos (coef ∈ {−1, 0, 1}). */
function soma(coef: (i: number) => number): string {
  const t: string[] = [];
  for (let i = 0; i < Q; i++) {
    const k = coef(i);
    if (k) t.push(`${k > 0 ? "+" : "-"} f${i}`);
  }
  return t.join(" ").replace(/^\+ /, "") || "0.0";
}

/** Expressão c_i·u. */
const cu = (i: number, [a, b, c] = ["ux", "uy", "uz"]) =>
  [CX[i] ? `${CX[i] > 0 ? "+" : "-"}${a}` : "", CY[i] ? `${CY[i] > 0 ? "+" : "-"}${b}` : "", CZ[i] ? `${CZ[i] > 0 ? "+" : "-"}${c}` : ""].join("").replace(/^\+/, "") || "0.0";

/** Linhas WGSL com e0..e18 = f̃ᵉᵠ(δρ = 0, u) para as variáveis ux, uy, uz (ou `u`) já definidas. */
function linhasEquilibrio(e = "e", u: [string, string, string] = ["ux", "uy", "uz"]): string {
  const L = [`  let ${e}uu = 1.5 * (${u[0]} * ${u[0]} + ${u[1]} * ${u[1]} + ${u[2]} * ${u[2]});`];
  for (let i = 0; i < Q; i++) L.push(`  let ${e}${i} = ${num(W[i])} * (3.0 * (${cu(i, u)}) + 4.5 * (${cu(i, u)}) * (${cu(i, u)}) - ${e}uu);`);
  return L.join("\n");
}

function wgslPasso(precisao: Precisao, forca: boolean, grupo: number, regularizado: boolean): string {
  const L: string[] = [];
  L.push(`${wgslBase(precisao, true)}
@compute @workgroup_size(${grupo})
fn passo(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = g.x; let y = g.y; let z = g.z;
  if (x >= p.nx) { return; }
  let c = x + p.nx * (y + p.ny * z);
  let t = tipoDe(c);
  if ((t & 3u) == ${SAIDA}u) {
    // saída: equilíbrio com ρ = 1 e a velocidade da célula anterior em x (passo anterior)
    let cv = c - 1u;
${Array.from({ length: Q }, (_, i) => `    let f${i} = ${carregar(precisao, i, "cv")};`).join("\n")}
    let ir = 1.0 / (1.0 + ${soma(() => 1)});
    let ux = (${soma((i) => CX[i])}) * ir; let uy = (${soma((i) => CY[i])}) * ir; let uz = (${soma((i) => CZ[i])}) * ir;
${linhasEquilibrio()}
    ${gravar(precisao, "e", "c")}
    return;
  }
  if ((t & 3u) == ${EQ}u) {
    // borda do túnel: equilíbrio com a velocidade do ar atual (a partida é suave)
    let ux = p.ux; let uy = p.uy; let uz = p.uz;
${linhasEquilibrio()}
    ${gravar(precisao, "e", "c")}
    return;
  }
  if ((t & 3u) != ${FLUIDO}u) { return; }
  let nb = (t & ${VIZINHO_SOLIDO}u) != 0u;
  let nxy = i32(p.nx * p.ny);
  let ic = i32(c);
  let xp = select(1, 1 - i32(p.nx), x + 1u == p.nx); let xm = select(-1, i32(p.nx) - 1, x == 0u);
  let yp = select(i32(p.nx), i32(p.nx) - nxy, y + 1u == p.ny); let ym = select(-i32(p.nx), nxy - i32(p.nx), y == 0u);
  let zp = select(nxy, nxy - i32(p.n), z + 1u == p.nz); let zm = select(-nxy, i32(p.n) - nxy, z == 0u);
  var f0 = ${carregar(precisao, 0, "c")};`);
  const desl = (v: number, o: string) => (v === 1 ? `${o}m` : v === -1 ? `${o}p` : "");
  for (let i = 1; i < Q; i++) {
    const d = [desl(CX[i], "x"), desl(CY[i], "y"), desl(CZ[i], "z")].filter(Boolean).join(" + ");
    L.push(`  let s${i} = u32(ic + ${d});
  var f${i} = ${carregar(precisao, i, `s${i}`)};
  if (nb) { if ((tipoDe(s${i}) & 3u) == ${SOLIDO}u) { f${i} = ${carregar(precisao, opp(i), "c")}; } }`);
  }
  const fx = forca ? " + 0.5 * p.gxf" : "", fy = forca ? " + 0.5 * p.gyf" : "", fz = forca ? " + 0.5 * p.gzf" : "";
  L.push(`  let dr = ${soma(() => 1)};
  let rho = 1.0 + dr;
  let ir = 1.0 / rho;
  let ux = (${soma((i) => CX[i])}${fx}) * ir;
  let uy = (${soma((i) => CY[i])}${fy}) * ir;
  let uz = (${soma((i) => CZ[i])}${fz}) * ir;
  let uu = 1.5 * (ux * ux + uy * uy + uz * uz);
  var tau = p.tau;
  if (x > p.esX0) {
    let se = f32(x - p.esX0) / f32(p.nx - 1u - p.esX0);
    tau += p.esDt * se * se;
  }
  // Π de não equilíbrio = Σcc·f̃ − δρ/3·δ − ρuu (exato no D3Q19)
  let tr = dr * ${num(1 / 3)};
  let xx = ${soma((i) => CX[i] * CX[i])} - tr - rho * ux * ux;
  let yy = ${soma((i) => CY[i] * CY[i])} - tr - rho * uy * uy;
  let zz = ${soma((i) => CZ[i] * CZ[i])} - tr - rho * uz * uz;
  let xy = ${soma((i) => CX[i] * CY[i])} - rho * ux * uy;
  let xz = ${soma((i) => CX[i] * CZ[i])} - rho * ux * uz;
  let yz = ${soma((i) => CY[i] * CZ[i])} - rho * uy * uz;
  if (p.smag > 0.0) {
    let pi = sqrt(xx * xx + yy * yy + zz * zz + 2.0 * (xy * xy + xz * xz + yz * yz));
    tau = 0.5 * (tau + sqrt(tau * tau + p.smag * pi * ir));
  }
  let w = 1.0 / tau;`);
  if (forca) L.push(`  let kf = 1.0 - 0.5 * w;`);
  if (regularizado) L.push(`  let kr = 1.0 - w; let t3 = (xx + yy + zz) * ${num(1 / 3)}; let vol = (w - 1.0) * t3;${forca ? " let jnx = -0.5 * p.gxf; let jny = -0.5 * p.gyf; let jnz = -0.5 * p.gzf;" : ""}`);
  const qpi = (i: number) => {
    const t: string[] = [];
    if (CX[i]) t.push("xx");
    if (CY[i]) t.push("yy");
    if (CZ[i]) t.push("zz");
    if (CX[i] && CY[i]) t.push(`${CX[i] * CY[i] > 0 ? "" : "-"}2.0 * xy`);
    if (CX[i] && CZ[i]) t.push(`${CX[i] * CZ[i] > 0 ? "" : "-"}2.0 * xz`);
    if (CY[i] && CZ[i]) t.push(`${CY[i] * CZ[i] > 0 ? "" : "-"}2.0 * yz`);
    return `(${[...t, "-t3"].join(" + ").replace(/\+ -/g, "- ")})`;
  };
  const cj = (i: number) => [CX[i] ? `${CX[i] > 0 ? "+" : "-"}jnx` : "", CY[i] ? `${CY[i] > 0 ? "+" : "-"}jny` : "", CZ[i] ? `${CZ[i] > 0 ? "+" : "-"}jnz` : ""].join("").replace(/^\+/, "") || "0.0";
  for (let i = 0; i < Q; i++) {
    const colisao = regularizado
      ? `f${i} = ${num(W[i])} * (dr + rho * (3.0 * e + 4.5 * e * e - uu)) + ${num(W[i])} * (${forca ? `kr * 3.0 * (${cj(i)}) + ` : ""}4.5 * (kr * ${qpi(i)}${[" - vol", "", " + vol"][CX[i] ** 2 + CY[i] ** 2 + CZ[i] ** 2]}));`
      : `f${i} += w * (${num(W[i])} * (dr + rho * (3.0 * e + 4.5 * e * e - uu)) - f${i});`;
    L.push(`  { let e = ${cu(i)}; ${colisao}${forca ? ` f${i} += kf * ${num(W[i])} * ((3.0 * (${num(CX[i])} - ux) + 9.0 * e * ${num(CX[i])}) * p.gxf + (3.0 * (${num(CY[i])} - uy) + 9.0 * e * ${num(CY[i])}) * p.gyf + (3.0 * (${num(CZ[i])} - uz) + 9.0 * e * ${num(CZ[i])}) * p.gzf);` : ""} }`);
  }
  L.push(`  // camadas absorventes nas pontas do túnel: puxa para o equilíbrio da corrente livre
  var sg = 0.0;
  if (p.esEnt > 0u && x <= p.esEnt) { let se = f32(p.esEnt + 1u - x) / f32(p.esEnt); sg = p.esSig * se * se; }
  else if (x > p.esX0) { let se = f32(x - p.esX0) / f32(p.nx - 1u - p.esX0); sg = p.esSig * se * se; }
  if (sg > 0.0) {
${linhasEquilibrio("a", ["p.ux", "p.uy", "p.uz"])}
${Array.from({ length: Q }, (_, i) => `    f${i} -= sg * (f${i} - a${i});`).join("\n")}
  }
  ${gravar(precisao, "f", "c")}
}
@compute @workgroup_size(${grupo})
fn iniciar(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.nx) { return; }
  let c = g.x + p.nx * (g.y + p.ny * g.z);
  if ((tipoDe(c) & 3u) == ${SOLIDO}u) { return; }
  let ux = p.ux; let uy = p.uy; let uz = p.uz;
${linhasEquilibrio()}
  ${gravar(precisao, "e", "c")}
}`);
  return L.join("\n");
}

/**
 * Força nos sólidos por troca de momento, só nas células da lista (fluido com vizinho sólido):
 * F += 2·f̃ⱼ*·cⱼ por ligação; soma por grupo de 64 na memória do grupo; a CPU soma os grupos.
 */
function wgslForca(precisao: Precisao): string {
  const L = [`${wgslBase(precisao, false)}
@group(0) @binding(3) var<storage, read> lista: array<u32>;
@group(0) @binding(4) var<storage, read_write> parciais: array<vec4<f32>>;
var<workgroup> acc: array<vec3<f32>, 64>;
@compute @workgroup_size(64)
fn forca(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  var F = vec3<f32>(0.0);
  if (g.x < arrayLength(&lista)) {
    let c = lista[g.x];
    let x = c % p.nx; let yz = c / p.nx; let y = yz % p.ny; let z = yz / p.ny;`];
  for (let i = 1; i < Q; i++) {
    const ex = (v: number, o: string, nn: string) => (v === 0 ? o : `((${o} + p.${nn} ${v > 0 ? "- 1u" : "+ 1u"}) % p.${nn})`);
    L.push(`    if ((tipoDe(${ex(CX[i], "x", "nx")} + p.nx * (${ex(CY[i], "y", "ny")} + p.ny * ${ex(CZ[i], "z", "nz")})) & 3u) == ${SOLIDO}u) { F -= 2.0 * ${carregar(precisao, opp(i), "c")} * vec3<f32>(${num(CX[i])}, ${num(CY[i])}, ${num(CZ[i])}); }`);
  }
  L.push(`  }
  acc[li] = F;
  workgroupBarrier();
  for (var st = 32u; st > 0u; st = st >> 1u) {
    if (li < st) { acc[li] = acc[li] + acc[li + st]; }
    workgroupBarrier();
  }
  if (li == 0u) { parciais[wg.x] = vec4<f32>(acc[0], 0.0); }
}`);
  return L.join("\n");
}

/** Campo macroscópico por célula (ux, uy, uz, δρ) para a vista 3D; sólido = 0. */
function wgslMacro(precisao: Precisao): string {
  return `${wgslBase(precisao, false)}
@group(0) @binding(3) var<storage, read_write> saida: array<vec4<f32>>;
@compute @workgroup_size(64)
fn campoMacro(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) ng: vec3<u32>) {
  let c = g.x + g.y * ng.x * 64u;
  if (c >= p.n) { return; }
  if ((tipoDe(c) & 3u) == ${SOLIDO}u) { saida[c] = vec4<f32>(0.0); return; }
${Array.from({ length: Q }, (_, i) => `  let f${i} = ${carregar(precisao, i, "c")};`).join("\n")}
  let dr = ${soma(() => 1)};
  let ir = 1.0 / (1.0 + dr);
  saida[c] = vec4<f32>((${soma((i) => CX[i])}) * ir, (${soma((i) => CY[i])}) * ir, (${soma((i) => CZ[i])}) * ir, dr);
}`;
}

/**
 * Desenho do corte (uma célula por pixel; o navegador suaviza ao ampliar). Plano 0: x-y em
 * z = corte (vista de lado); plano 1: x-z em y = corte (vista de cima). Sólido em cinza.
 */
function wgslDesenho(precisao: Precisao): string {
  return `${wgslBase(precisao, false)}
struct S { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> S {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var s: S;
  s.pos = vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
  s.uv = vec2<f32>(xy.x, 1.0 - xy.y);
  return s;
}
fn cor(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.18, 0.30, 0.75); let b = vec3<f32>(0.20, 0.70, 0.85); let c = vec3<f32>(0.40, 0.80, 0.35);
  let d = vec3<f32>(0.98, 0.82, 0.25); let e = vec3<f32>(0.85, 0.22, 0.18);
  let s = clamp(t, 0.0, 1.0) * 4.0;
  if (s < 1.0) { return mix(a, b, s); }
  if (s < 2.0) { return mix(b, c, s - 1.0); }
  if (s < 3.0) { return mix(c, d, s - 2.0); }
  return mix(d, e, s - 3.0);
}
fn divergente(t: f32) -> vec3<f32> {
  let s = clamp(t, -1.0, 1.0);
  if (s < 0.0) { return mix(vec3<f32>(0.97, 0.97, 0.97), vec3<f32>(0.17, 0.33, 0.78), -s); }
  return mix(vec3<f32>(0.97, 0.97, 0.97), vec3<f32>(0.84, 0.19, 0.15), s);
}
fn idx(x: u32, y: u32, z: u32) -> u32 { return x + p.nx * (y + p.ny * z); }
fn vel(c: u32) -> vec4<f32> {
  if ((tipoDe(c) & 3u) == ${SOLIDO}u) { return vec4<f32>(0.0); }
${Array.from({ length: Q }, (_, i) => `  let f${i} = ${carregar(precisao, i, "c")};`).join("\n")}
  let dr = ${soma(() => 1)};
  let ir = 1.0 / (1.0 + dr);
  return vec4<f32>((${soma((i) => CX[i])}) * ir, (${soma((i) => CY[i])}) * ir, (${soma((i) => CZ[i])}) * ir, dr);
}
@fragment fn fs(s: S) -> @location(0) vec4<f32> {
  let x = min(u32(s.uv.x * f32(p.nx)), p.nx - 1u);
  var y = p.corte; var z = p.corte;
  if (p.plano == 0u) { y = p.ny - 1u - min(u32(s.uv.y * f32(p.ny)), p.ny - 1u); }
  else { z = min(u32(s.uv.y * f32(p.nz)), p.nz - 1u); }
  let c = idx(x, y, z);
  if ((tipoDe(c) & 3u) == ${SOLIDO}u) { return vec4<f32>(0.54, 0.58, 0.62, 1.0); }
  let v = vel(c);
  if (v.x != v.x || abs(v.x) > 1.0) { return vec4<f32>(0.9, 0.1, 0.9, 1.0); }
  switch p.grandeza {
    case 1u: { return vec4<f32>(divergente(v.x * p.escala / 1.5), 1.0); }
    case 2u: { return vec4<f32>(divergente(v.w * p.escala * p.escala / 1.5 / 1.5), 1.0); }
    case 3u: {
      let xa = max(x, 1u) - 1u; let xb = min(x + 1u, p.nx - 1u);
      var w = 0.0;
      if (p.plano == 0u) {
        let ya = max(y, 1u) - 1u; let yb = min(y + 1u, p.ny - 1u);
        w = 0.5 * (vel(idx(xb, y, z)).y - vel(idx(xa, y, z)).y) - 0.5 * (vel(idx(x, yb, z)).x - vel(idx(x, ya, z)).x);
      } else {
        let za = max(z, 1u) - 1u; let zb = min(z + 1u, p.nz - 1u);
        w = 0.5 * (vel(idx(x, y, zb)).x - vel(idx(x, y, za)).x) - 0.5 * (vel(idx(xb, y, z)).z - vel(idx(xa, y, z)).z);
      }
      return vec4<f32>(divergente(w * p.escalaVort), 1.0);
    }
    default: { return vec4<f32>(cor(length(v.xyz) * p.escala / 1.5), 1.0); }
  }
}`;
}

/** Erro amigável quando o aparelho não tem WebGPU. */
export async function abrirGpu(): Promise<{ adaptador: GPUAdapter; device: GPUDevice }> {
  if (!("gpu" in navigator) || !navigator.gpu) throw new Error("Este navegador não tem WebGPU (precisa do Chrome 121+ no Android 12+).");
  const adaptador = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adaptador) throw new Error("O Chrome não liberou a GPU deste aparelho para WebGPU (driver fora da lista de suportados).");
  const device = await adaptador.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adaptador.limits.maxStorageBufferBindingSize,
      maxBufferSize: adaptador.limits.maxBufferSize,
    },
  });
  return { adaptador, device };
}

/** Maior malha cujos buffers cabem nos limites do aparelho. */
export function cabe(device: GPUDevice, n: number, precisao: Precisao): boolean {
  const bytes = palavras(precisao) * n * 4;
  return bytes <= device.limits.maxStorageBufferBindingSize && bytes <= device.limits.maxBufferSize;
}

export class LbmGpu {
  readonly n: number;
  readonly cfg: ConfigGpu;
  private device: GPUDevice;
  private uniforme: GPUBuffer;
  private buffers: GPUBuffer[];
  private tipos: GPUBuffer;
  private pPasso: GPUComputePipeline;
  private pIniciar: GPUComputePipeline;
  private grupos: GPUBindGroup[];
  private despacho: [number, number, number];
  private atual = 0;
  private desenho?: { pipe: GPURenderPipeline; grupos: GPUBindGroup[]; ctx: GPUCanvasContext; canvas: HTMLCanvasElement };
  private campoGpu?: { pipe: GPUComputePipeline; grupos: GPUBindGroup[]; saida: GPUBuffer; leitura: GPUBuffer; ocupado: boolean };
  private medicao?: { pipe: GPUComputePipeline; grupos: GPUBindGroup[]; parciais: GPUBuffer; leitura: GPUBuffer; nGrupos: number; ocupada: boolean };
  private g: [number, number, number] = [0, 0, 0];
  private corte = { plano: 0 as Plano, indice: 0, grandeza: "velocidade" as Grandeza, escala: 1, escalaVort: 1 };
  passos = 0;

  constructor(device: GPUDevice, cfg: ConfigGpu) {
    this.device = device;
    this.cfg = cfg;
    this.n = cfg.nx * cfg.ny * cfg.nz;
    const tamGrupo = cfg.grupo ?? 64;
    this.despacho = [Math.ceil(cfg.nx / tamGrupo), cfg.ny, cfg.nz];
    const tam = palavras(cfg.precisao) * this.n * 4;
    this.buffers = [0, 1].map(() => device.createBuffer({ size: tam, usage: USO.STORAGE | USO.COPY_SRC }));
    this.tipos = device.createBuffer({ size: Math.ceil(this.n / 4) * 4, usage: USO.STORAGE | USO.COPY_DST });
    const tipos = marcarVizinhos(cfg);
    device.queue.writeBuffer(this.tipos, 0, tipos);
    this.uniforme = device.createBuffer({ size: 96, usage: USO.UNIFORM | USO.COPY_DST });
    this.corte.indice = Math.floor(cfg.nz / 2);
    this.escreverUniforme();
    const modulo = device.createShaderModule({ code: wgslPasso(cfg.precisao, !!cfg.forca, tamGrupo, !!cfg.regularizado) });
    const C = ESTAGIO_COMPUTE;
    const leitura = { type: "read-only-storage" } as const;
    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: "uniform" } },
        { binding: 1, visibility: C, buffer: leitura },
        { binding: 2, visibility: C, buffer: leitura },
        { binding: 3, visibility: C, buffer: { type: "storage" } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    this.pPasso = device.createComputePipeline({ layout, compute: { module: modulo, entryPoint: "passo" } });
    this.pIniciar = device.createComputePipeline({ layout, compute: { module: modulo, entryPoint: "iniciar" } });
    const grupo = (de: number) =>
      device.createBindGroup({
        layout: bgl,
        entries: [
          { binding: 0, resource: { buffer: this.uniforme } },
          { binding: 1, resource: { buffer: this.tipos } },
          { binding: 2, resource: { buffer: this.buffers[de] } },
          { binding: 3, resource: { buffer: this.buffers[1 - de] } },
        ],
      });
    this.grupos = [grupo(0), grupo(1)];
    // partida: equilíbrio da corrente livre nos dois buffers
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pIniciar);
    for (const de of [0, 1]) {
      pass.setBindGroup(0, this.grupos[de]);
      pass.dispatchWorkgroups(...this.despacho);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
    this.prepararForca(tipos);
  }

  private escreverUniforme() {
    const { nx, ny, nz, tau, cs, u, esponja } = this.cfg;
    const b = new ArrayBuffer(96);
    const ui = new Uint32Array(b);
    const fl = new Float32Array(b);
    ui[0] = nx; ui[1] = ny; ui[2] = nz; ui[3] = this.n;
    fl[4] = tau; fl[5] = smagorinsky(cs); fl[6] = u[0]; fl[7] = u[1]; fl[8] = u[2];
    ui[9] = esponja ? esponja.x0 : nx; fl[15] = esponja?.dtau ?? 0;
    fl[19] = esponja?.sigma ?? 0; ui[20] = esponja?.entrada ?? 0;
    fl[10] = this.g[0]; fl[11] = this.g[1]; fl[12] = this.g[2];
    const k = this.corte;
    ui[13] = k.indice; fl[14] = k.escala; ui[16] = k.plano; ui[17] = GRANDEZAS.findIndex(([g]) => g === k.grandeza); fl[18] = k.escalaVort;
    this.device.queue.writeBuffer(this.uniforme, 0, b);
  }

  /** Velocidade do ar nas bordas do túnel (partida suave: sobe de 0 até U∞). */
  definirVelocidade(u: [number, number, number]) {
    this.cfg.u = u;
    this.escreverUniforme();
  }

  /** Força de corpo uniforme (unidades de rede); o kernel precisa ter sido criado com `forca`. */
  definirForca(g: [number, number, number]) {
    this.g = g;
    this.escreverUniforme();
  }

  /**
   * Corte desenhado: plano, índice da fatia, grandeza e escalas de cor (escala = 1/U∞ na rede;
   * escalaVort = 1/ω de saturação). Ajusta o tamanho do canvas (uma célula por pixel).
   */
  definirCorte(o: Partial<{ plano: Plano; indice: number; grandeza: Grandeza; escala: number; escalaVort: number }>) {
    Object.assign(this.corte, o);
    const max = (this.corte.plano === 0 ? this.cfg.nz : this.cfg.ny) - 1;
    this.corte.indice = Math.max(0, Math.min(max, Math.round(this.corte.indice)));
    if (this.desenho) {
      const [w, h] = this.tamanhoCorte();
      if (this.desenho.canvas.width !== w || this.desenho.canvas.height !== h) Object.assign(this.desenho.canvas, { width: w, height: h });
    }
    this.escreverUniforme();
  }

  tamanhoCorte(): [number, number] {
    return [this.cfg.nx, this.corte.plano === 0 ? this.cfg.ny : this.cfg.nz];
  }

  /** Lista das células junto aos sólidos e o pipeline da troca de momento. */
  private prepararForca(tipos: Uint8Array) {
    const lista: number[] = [];
    for (let c = 0; c < this.n; c++) if (tipos[c] === (FLUIDO | VIZINHO_SOLIDO)) lista.push(c);
    if (!lista.length) return;
    const d = this.device;
    const bLista = d.createBuffer({ size: lista.length * 4, usage: USO.STORAGE | USO.COPY_DST });
    d.queue.writeBuffer(bLista, 0, new Uint32Array(lista));
    const nGrupos = Math.ceil(lista.length / 64);
    const parciais = d.createBuffer({ size: nGrupos * 16, usage: USO.STORAGE | USO.COPY_SRC });
    const leitura = d.createBuffer({ size: nGrupos * 16, usage: USO.COPY_DST | USO.MAP_READ });
    const modulo = d.createShaderModule({ code: wgslForca(this.cfg.precisao) });
    const pipe = d.createComputePipeline({ layout: "auto", compute: { module: modulo, entryPoint: "forca" } });
    const grupos = [0, 1].map((i) =>
      d.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniforme } },
          { binding: 1, resource: { buffer: this.tipos } },
          { binding: 2, resource: { buffer: this.buffers[i] } },
          { binding: 3, resource: { buffer: bLista } },
          { binding: 4, resource: { buffer: parciais } },
        ],
      }),
    );
    this.medicao = { pipe, grupos, parciais, leitura, nGrupos, ocupada: false };
  }

  /**
   * Campo macroscópico atual (ux, uy, uz, δρ por célula, unidades de rede) copiado para a CPU:
   * 16 bytes por célula (16 MB com 1 M células). Null se uma leitura anterior ainda está em curso.
   */
  async campo(): Promise<Float32Array | null> {
    const d = this.device;
    if (!this.campoGpu) {
      const tam = this.n * 16;
      const saida = d.createBuffer({ size: tam, usage: USO.STORAGE | USO.COPY_SRC });
      const leitura = d.createBuffer({ size: tam, usage: USO.COPY_DST | USO.MAP_READ });
      const modulo = d.createShaderModule({ code: wgslMacro(this.cfg.precisao) });
      const pipe = d.createComputePipeline({ layout: "auto", compute: { module: modulo, entryPoint: "campoMacro" } });
      const grupos = [0, 1].map((i) =>
        d.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniforme } },
            { binding: 1, resource: { buffer: this.tipos } },
            { binding: 2, resource: { buffer: this.buffers[i] } },
            { binding: 3, resource: { buffer: saida } },
          ],
        }),
      );
      this.campoGpu = { pipe, grupos, saida, leitura, ocupado: false };
    }
    const k = this.campoGpu;
    if (k.ocupado) return null;
    k.ocupado = true;
    const total = Math.ceil(this.n / 64);
    const gx = Math.min(total, 65535), gy = Math.ceil(total / gx);
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(k.pipe);
    pass.setBindGroup(0, k.grupos[this.atual]);
    pass.dispatchWorkgroups(gx, gy);
    pass.end();
    enc.copyBufferToBuffer(k.saida, 0, k.leitura, 0, this.n * 16);
    d.queue.submit([enc.finish()]);
    try {
      await k.leitura.mapAsync(MAPA_LEITURA);
      const r = new Float32Array(k.leitura.getMappedRange().slice(0));
      k.leitura.unmap();
      return r;
    } finally {
      k.ocupado = false;
    }
  }

  /**
   * Força do ar sobre os sólidos no estado atual (unidades de rede, por passo), por troca de
   * momento. Null se não houver sólido ou se uma leitura anterior ainda estiver em curso.
   */
  async forca(): Promise<[number, number, number] | null> {
    const m = this.medicao;
    if (!m || m.ocupada) return null;
    m.ocupada = true;
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(m.pipe);
    pass.setBindGroup(0, m.grupos[this.atual]);
    pass.dispatchWorkgroups(m.nGrupos);
    pass.end();
    enc.copyBufferToBuffer(m.parciais, 0, m.leitura, 0, m.nGrupos * 16);
    this.device.queue.submit([enc.finish()]);
    try {
      await m.leitura.mapAsync(MAPA_LEITURA);
      const v = new Float32Array(m.leitura.getMappedRange());
      let fx = 0, fy = 0, fz = 0;
      for (let k = 0; k < m.nGrupos; k++) {
        fx += v[4 * k];
        fy += v[4 * k + 1];
        fz += v[4 * k + 2];
      }
      m.leitura.unmap();
      return [fx, fy, fz];
    } finally {
      m.ocupada = false;
    }
  }

  /** Grava k passos num só envio (os despachos de um passe são ordenados entre si). */
  avancar(k: number) {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pPasso);
    for (let s = 0; s < k; s++) {
      pass.setBindGroup(0, this.grupos[this.atual]);
      pass.dispatchWorkgroups(...this.despacho);
      this.atual = 1 - this.atual;
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.passos += k;
  }

  esperar(): Promise<void> {
    return this.device.queue.onSubmittedWorkDone();
  }

  /** Lê as populações (deslocadas) para a CPU, já em f32. Só para malhas pequenas (verificação). */
  async ler(): Promise<Float32Array> {
    const src = this.buffers[this.atual];
    const copia = this.device.createBuffer({ size: src.size, usage: USO.COPY_DST | USO.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, copia, 0, src.size);
    this.device.queue.submit([enc.finish()]);
    await copia.mapAsync(MAPA_LEITURA);
    const bruto = copia.getMappedRange().slice(0);
    copia.destroy();
    if (this.cfg.precisao === "fp32") return new Float32Array(bruto);
    const h = new Uint16Array(bruto);
    const n = this.n;
    const out = new Float32Array(Q * n);
    const v = (j: number) => meiaParaFloat(h[j]) / ESCALA_FP16;
    for (let c = 0; c < n; c++) {
      out[c] = v(2 * c);
      for (let k = 1; k < 10; k++) {
        out[(2 * k - 1) * n + c] = v(2 * (k * n + c));
        out[2 * k * n + c] = v(2 * (k * n + c) + 1);
      }
    }
    return out;
  }

  /** Liga o desenho do plano central (z = nz/2) num canvas. */
  ligarCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!ctx) throw new Error("Canvas sem contexto WebGPU");
    const formato = navigator.gpu.getPreferredCanvasFormat();
    const [w, h] = this.tamanhoCorte();
    Object.assign(canvas, { width: w, height: h });
    ctx.configure({ device: this.device, format: formato, alphaMode: "opaque" });
    const modulo = this.device.createShaderModule({ code: wgslDesenho(this.cfg.precisao) });
    const pipe = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module: modulo, entryPoint: "vs" },
      fragment: { module: modulo, entryPoint: "fs", targets: [{ format: formato }] },
      primitive: { topology: "triangle-list" },
    });
    const grupos = [0, 1].map((i) =>
      this.device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniforme } },
          { binding: 1, resource: { buffer: this.tipos } },
          { binding: 2, resource: { buffer: this.buffers[i] } },
        ],
      }),
    );
    this.desenho = { pipe, grupos, ctx, canvas };
  }

  desenhar() {
    if (!this.desenho) return;
    const { pipe, grupos, ctx } = this.desenho;
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 1, g: 1, b: 1, a: 1 } }] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, grupos[this.atual]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  destruir() {
    this.campoGpu?.saida.destroy();
    this.campoGpu?.leitura.destroy();
    this.medicao?.parciais.destroy();
    this.medicao?.leitura.destroy();
    for (const b of this.buffers) b.destroy();
    this.tipos.destroy();
    this.uniforme.destroy();
  }
}

/** Tipo por célula (1 byte; 4 por palavra) com o bit 7 marcando quem tem vizinho sólido. */
function marcarVizinhos(cfg: ConfigGpu): Uint8Array {
  const { nx, ny, nz, tipo } = cfg;
  const t = new Uint8Array(Math.ceil((nx * ny * nz) / 4) * 4);
  t.set(tipo);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const c = x + nx * (y + ny * z);
        if (tipo[c] !== FLUIDO) continue;
        for (let i = 1; i < Q; i++) {
          const s = ((x - CX[i] + nx) % nx) + nx * (((y - CY[i] + ny) % ny) + ny * ((z - CZ[i] + nz) % nz));
          if (tipo[s] === SOLIDO) {
            t[c] |= VIZINHO_SOLIDO;
            break;
          }
        }
      }
    }
  }
  return t;
}

/** f̃ᵉᵠ da corrente livre, para conferir células EQ na verificação. */
export const eqLivre = (i: number, u: [number, number, number]) => equilibrio(i, 0, u[0], u[1], u[2]);
