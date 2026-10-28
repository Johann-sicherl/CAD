// WJFlow: solver D3Q19 em WebGPU (compute shader) e desenho de um plano de corte.
// Mesmo algoritmo de src/flow/lbm.ts (referência em CPU): populações deslocadas, passo "pull",
// bounce-back, células EQ, BGK + Smagorinsky + força de Guo. O WGSL é gerado com as 19 direções
// desenroladas (sem índices dinâmicos em constantes, que alguns drivers móveis tratam mal).
//
// Precisão de armazenamento (a conta é sempre em f32):
// - fp32: f[i·n + c];
// - fp16: duas células vizinhas em x na mesma palavra u32, f[i·n/2 + c/2], guardadas multiplicadas
//   por ESCALA_FP16. A conversão para FP16 é nossa (meiaBits, ao par mais próximo): a Adreno 613
//   trunca e zera subnormais no pack2x16float, e o erro se acumulava a cada passo (ver lbm.ts).
//   Cada thread cuida de um par de células (nx par), então nunca duas threads escrevem a mesma palavra.

import { CX, CY, CZ, EQ, ESCALA_FP16, Q, SOLIDO, W, equilibrio, meiaParaFloat, opp, smagorinsky, type Precisao } from "./lbm";

export interface ConfigGpu {
  nx: number;
  ny: number;
  nz: number;
  tau: number;
  cs: number;
  u: [number, number, number];
  precisao: Precisao;
  tipo: Uint8Array;
}

const GRUPO = 64;
// constantes da especificação WebGPU (os tipos do TypeScript não trazem os objetos globais)
const USO = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as const;
const ESTAGIO_COMPUTE = 4;
const MAPA_LEITURA = 1;
const num = (v: number) => {
  const s = String(Math.fround(v));
  return /[.e]/.test(s) ? s : `${s}.0`;
};

/** Código WGSL comum: parâmetros, leitura de população e equilíbrio. */
function wgslBase(precisao: Precisao, leituraEscrita: boolean): string {
  const tipo = precisao === "fp32" ? "f32" : "u32";
  const ld = precisao === "fp32"
    ? `fn ld(i: u32, c: u32) -> f32 { return fa[i * p.n + c]; }`
    : `fn ld(i: u32, c: u32) -> f32 {
  let v = unpack2x16float(fa[i * (p.n / 2u) + (c >> 1u)]);
  return select(v.x, v.y, (c & 1u) == 1u) * ${num(1 / ESCALA_FP16)};
}
fn meiaBits(v: f32) -> u32 {
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
}`;
  return `
struct P { nx: u32, ny: u32, nz: u32, n: u32, tau: f32, smag: f32, ux: f32, uy: f32, uz: f32, gx: u32, gxf: f32, gyf: f32, gzf: f32, z: u32, escala: f32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> tipo: array<u32>;
@group(0) @binding(2) var<storage, read> fa: array<${tipo}>;
${leituraEscrita ? `@group(0) @binding(3) var<storage, read_write> fb: array<${tipo}>;` : ""}
${ld}
fn tipoDe(c: u32) -> u32 { return (tipo[c >> 2u] >> ((c & 3u) * 8u)) & 255u; }
`;
}

/** Corpo que calcula as 19 populações pós-colisão da célula c em r0..r18. */
function wgslCelula(): string {
  const L: string[] = [];
  L.push(`fn celula(c: u32) -> array<f32, 19> {
  var f: array<f32, 19>;
  let t = tipoDe(c);
  if (t == ${SOLIDO}u) { return f; }
  if (t == ${EQ}u) { return eq(0.0, p.ux, p.uy, p.uz); }
  let x = c % p.nx; let yz = c / p.nx; let y = yz % p.ny; let z = yz / p.ny;
  let xp = select(x + 1u, 0u, x + 1u == p.nx); let xm = select(x - 1u, p.nx - 1u, x == 0u);
  let yp = select(y + 1u, 0u, y + 1u == p.ny); let ym = select(y - 1u, p.ny - 1u, y == 0u);
  let zp = select(z + 1u, 0u, z + 1u == p.nz); let zm = select(z - 1u, p.nz - 1u, z == 0u);`);
  const eixo = (v: number, o: string) => (v === 1 ? `${o}m` : v === -1 ? `${o}p` : o);
  for (let i = 0; i < Q; i++) {
    if (i === 0) {
      L.push(`  f[0] = ld(0u, c);`);
      continue;
    }
    L.push(`  { let s = ${eixo(CX[i], "x")} + p.nx * (${eixo(CY[i], "y")} + p.ny * ${eixo(CZ[i], "z")});
    if (tipoDe(s) == ${SOLIDO}u) { f[${i}] = ld(${opp(i)}u, c); } else { f[${i}] = ld(${i}u, s); } }`);
  }
  const soma = (comp: readonly number[]) =>
    comp.map((v, i) => (v === 1 ? `+ f[${i}]` : v === -1 ? `- f[${i}]` : "")).filter(Boolean).join(" ").replace(/^\+ /, "");
  L.push(`  var dr = 0.0;
  for (var i = 0u; i < 19u; i++) { dr += f[i]; }
  let rho = 1.0 + dr;
  let ux = (${soma(CX)} + 0.5 * p.gxf) / rho;
  let uy = (${soma(CY)} + 0.5 * p.gyf) / rho;
  let uz = (${soma(CZ)} + 0.5 * p.gzf) / rho;
  let fe = eq(dr, ux, uy, uz);
  var tau = p.tau;
  if (p.smag > 0.0) {
    var xx = 0.0; var yy = 0.0; var zz = 0.0; var xy = 0.0; var xz = 0.0; var yz2 = 0.0;`);
  for (let i = 1; i < Q; i++) {
    const d = `(f[${i}] - fe[${i}])`;
    const termos: string[] = [];
    if (CX[i]) termos.push(`xx += ${d};`);
    if (CY[i]) termos.push(`yy += ${d};`);
    if (CZ[i]) termos.push(`zz += ${d};`);
    if (CX[i] && CY[i]) termos.push(`xy ${CX[i] * CY[i] > 0 ? "+" : "-"}= ${d};`);
    if (CX[i] && CZ[i]) termos.push(`xz ${CX[i] * CZ[i] > 0 ? "+" : "-"}= ${d};`);
    if (CY[i] && CZ[i]) termos.push(`yz2 ${CY[i] * CZ[i] > 0 ? "+" : "-"}= ${d};`);
    L.push(`    ${termos.join(" ")}`);
  }
  L.push(`    let pi = sqrt(xx * xx + yy * yy + zz * zz + 2.0 * (xy * xy + xz * xz + yz2 * yz2));
    tau = 0.5 * (tau + sqrt(tau * tau + p.smag * pi / rho));
  }
  let w = 1.0 / tau;
  let forca = p.gxf != 0.0 || p.gyf != 0.0 || p.gzf != 0.0;`);
  for (let i = 0; i < Q; i++) {
    const cu = `(${num(CX[i])} * ux + ${num(CY[i])} * uy + ${num(CZ[i])} * uz)`;
    L.push(`  f[${i}] = f[${i}] + w * (fe[${i}] - f[${i}]);
  if (forca) { let cu${i} = ${cu}; f[${i}] += (1.0 - 0.5 * w) * ${num(W[i])} * ((3.0 * (${num(CX[i])} - ux) + 9.0 * cu${i} * ${num(CX[i])}) * p.gxf + (3.0 * (${num(CY[i])} - uy) + 9.0 * cu${i} * ${num(CY[i])}) * p.gyf + (3.0 * (${num(CZ[i])} - uz) + 9.0 * cu${i} * ${num(CZ[i])}) * p.gzf); }`);
  }
  L.push(`  return f;
}`);
  return L.join("\n");
}

function wgslEq(): string {
  const L = [`fn eq(dr: f32, ux: f32, uy: f32, uz: f32) -> array<f32, 19> {
  var e: array<f32, 19>;
  let rho = 1.0 + dr;
  let uu = 1.5 * (ux * ux + uy * uy + uz * uz);`];
  for (let i = 0; i < Q; i++) {
    const cu = [CX[i] ? `${CX[i] > 0 ? "" : "-"}ux` : "", CY[i] ? `${CY[i] > 0 ? "+" : "-"}uy` : "", CZ[i] ? `${CZ[i] > 0 ? "+" : "-"}uz` : ""].join("").replace(/^\+/, "") || "0.0";
    L.push(`  { let cu = ${cu}; e[${i}] = ${num(W[i])} * (dr + rho * (3.0 * cu + 4.5 * cu * cu - uu)); }`);
  }
  L.push("  return e;\n}");
  return L.join("\n");
}

function wgslPasso(precisao: Precisao): string {
  const gravar = precisao === "fp32"
    ? `for (var i = 0u; i < 19u; i++) { fb[i * p.n + c0] = a[i]; fb[i * p.n + c0 + 1u] = b[i]; }`
    : `for (var i = 0u; i < 19u; i++) { fb[i * (p.n / 2u) + k] = meiaBits(a[i] * ${num(ESCALA_FP16)}) | (meiaBits(b[i] * ${num(ESCALA_FP16)}) << 16u); }`;
  return `${wgslBase(precisao, true)}
${wgslEq()}
${wgslCelula()}
@compute @workgroup_size(${GRUPO})
fn passo(@builtin(global_invocation_id) g: vec3<u32>) {
  let k = g.x + g.y * p.gx * ${GRUPO}u;
  if (k >= p.n / 2u) { return; }
  let c0 = 2u * k;
  let a = celula(c0);
  let b = celula(c0 + 1u);
  ${gravar}
}
@compute @workgroup_size(${GRUPO})
fn iniciar(@builtin(global_invocation_id) g: vec3<u32>) {
  let k = g.x + g.y * p.gx * ${GRUPO}u;
  if (k >= p.n / 2u) { return; }
  let c0 = 2u * k;
  var a: array<f32, 19>; var b: array<f32, 19>;
  if (tipoDe(c0) != ${SOLIDO}u) { a = eq(0.0, p.ux, p.uy, p.uz); }
  if (tipoDe(c0 + 1u) != ${SOLIDO}u) { b = eq(0.0, p.ux, p.uy, p.uz); }
  ${gravar}
}`;
}

/** Desenho do plano z = p.z: módulo da velocidade / |u∞| em escala de cor; sólido em cinza. */
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
@fragment fn fs(s: S) -> @location(0) vec4<f32> {
  let x = min(u32(s.uv.x * f32(p.nx)), p.nx - 1u);
  let y = min(u32((1.0 - s.uv.y) * f32(p.ny)), p.ny - 1u);
  let c = x + p.nx * (y + p.ny * p.z);
  if (tipoDe(c) == ${SOLIDO}u) { return vec4<f32>(0.54, 0.58, 0.62, 1.0); }
  var dr = 0.0; var jx = 0.0; var jy = 0.0; var jz = 0.0;
${Array.from({ length: Q }, (_, i) => `  { let v = ld(${i}u, c); dr += v; jx += ${num(CX[i])} * v; jy += ${num(CY[i])} * v; jz += ${num(CZ[i])} * v; }`).join("\n")}
  let u = length(vec3<f32>(jx, jy, jz)) / (1.0 + dr);
  if (u != u || u > 1.0) { return vec4<f32>(0.9, 0.1, 0.9, 1.0); }
  return vec4<f32>(cor(u * p.escala), 1.0);
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
  const bytes = Q * n * (precisao === "fp32" ? 4 : 2);
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
  private gx: number;
  private gy: number;
  private atual = 0;
  private desenho?: { pipe: GPURenderPipeline; grupos: GPUBindGroup[]; ctx: GPUCanvasContext };
  passos = 0;

  constructor(device: GPUDevice, cfg: ConfigGpu) {
    if (cfg.nx % 2) throw new Error("nx precisa ser par");
    this.device = device;
    this.cfg = cfg;
    this.n = cfg.nx * cfg.ny * cfg.nz;
    const pares = this.n / 2;
    const gruposTotal = Math.ceil(pares / GRUPO);
    this.gx = Math.min(gruposTotal, 65535);
    this.gy = Math.ceil(gruposTotal / this.gx);
    const tam = Q * this.n * (cfg.precisao === "fp32" ? 4 : 2);
    this.buffers = [0, 1].map(() => device.createBuffer({ size: tam, usage: USO.STORAGE | USO.COPY_SRC }));
    // tipo: 1 byte por célula, 4 por palavra
    const tipos = new Uint8Array(Math.ceil(this.n / 4) * 4);
    tipos.set(cfg.tipo);
    this.tipos = device.createBuffer({ size: tipos.byteLength, usage: USO.STORAGE | USO.COPY_DST });
    device.queue.writeBuffer(this.tipos, 0, tipos);
    this.uniforme = device.createBuffer({ size: 64, usage: USO.UNIFORM | USO.COPY_DST });
    this.escreverParametros();
    const modulo = device.createShaderModule({ code: wgslPasso(cfg.precisao) });
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
      pass.dispatchWorkgroups(this.gx, this.gy);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  /** Atualiza τ, Cs, u∞ e força (pode mudar durante a simulação). */
  escreverParametros(g: [number, number, number] = [0, 0, 0], escalaCor = 1) {
    const { nx, ny, nz, tau, cs, u } = this.cfg;
    const b = new ArrayBuffer(64);
    const ui = new Uint32Array(b);
    const fl = new Float32Array(b);
    ui[0] = nx; ui[1] = ny; ui[2] = nz; ui[3] = this.n;
    fl[4] = tau; fl[5] = smagorinsky(cs); fl[6] = u[0]; fl[7] = u[1]; fl[8] = u[2];
    ui[9] = this.gx ?? 0; fl[10] = g[0]; fl[11] = g[1]; fl[12] = g[2];
    ui[13] = Math.floor(nz / 2); fl[14] = escalaCor;
    this.device.queue.writeBuffer(this.uniforme, 0, b);
  }

  /** Grava k passos num só envio (os despachos de um passe são ordenados entre si). */
  avancar(k: number) {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pPasso);
    for (let s = 0; s < k; s++) {
      pass.setBindGroup(0, this.grupos[this.atual]);
      pass.dispatchWorkgroups(this.gx, this.gy);
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
    const out = new Float32Array(Q * this.n);
    for (let j = 0; j < out.length; j++) out[j] = meiaParaFloat(h[j]) / ESCALA_FP16;
    return out;
  }

  /** Liga o desenho do plano central (z = nz/2) num canvas. */
  ligarCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!ctx) throw new Error("Canvas sem contexto WebGPU");
    const formato = navigator.gpu.getPreferredCanvasFormat();
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
    this.desenho = { pipe, grupos, ctx };
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
    for (const b of this.buffers) b.destroy();
    this.tipos.destroy();
    this.uniforme.destroy();
  }
}

/** f̃ᵉᵠ da corrente livre, para conferir células EQ na verificação. */
export const eqLivre = (i: number, u: [number, number, number]) => equilibrio(i, 0, u[0], u[1], u[2]);
