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
// - células sólidas e EQ não são regravadas (o valor delas não muda);
// - código da força de Guo só entra quando o caso tem força.
//
// Precisão de armazenamento (a conta é sempre em f32):
// - fp32: f[i·n + c];
// - fp16: palavra u32 k·n + c com o par de direções opostas (2k−1, 2k); a palavra 0 guarda só a
//   direção 0. Valores guardados × ESCALA_FP16 e convertidos por meiaBits (ao par mais próximo):
//   a Adreno 613 trunca e zera subnormais no pack2x16float (ver lbm.ts).

import { CX, CY, CZ, ESCALA_FP16, FLUIDO, Q, SOLIDO, W, equilibrio, meiaParaFloat, opp, smagorinsky, type Precisao } from "./lbm";

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
}

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
struct P { nx: u32, ny: u32, nz: u32, n: u32, tau: f32, smag: f32, ux: f32, uy: f32, uz: f32, pad0: u32, gxf: f32, gyf: f32, gzf: f32, z: u32, escala: f32, pad: u32 };
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
const cu = (i: number) =>
  [CX[i] ? `${CX[i] > 0 ? "+" : "-"}ux` : "", CY[i] ? `${CY[i] > 0 ? "+" : "-"}uy` : "", CZ[i] ? `${CZ[i] > 0 ? "+" : "-"}uz` : ""].join("").replace(/^\+/, "") || "0.0";

function wgslPasso(precisao: Precisao, forca: boolean, grupo: number): string {
  const L: string[] = [];
  L.push(`${wgslBase(precisao, true)}
@compute @workgroup_size(${grupo})
fn passo(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = g.x; let y = g.y; let z = g.z;
  if (x >= p.nx) { return; }
  let c = x + p.nx * (y + p.ny * z);
  let t = tipoDe(c);
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
  if (p.smag > 0.0) {
    // Π de não equilíbrio = Σcc·f̃ − δρ/3·δ − ρuu (exato no D3Q19)
    let tr = dr * ${num(1 / 3)};
    let xx = ${soma((i) => CX[i] * CX[i])} - tr - rho * ux * ux;
    let yy = ${soma((i) => CY[i] * CY[i])} - tr - rho * uy * uy;
    let zz = ${soma((i) => CZ[i] * CZ[i])} - tr - rho * uz * uz;
    let xy = ${soma((i) => CX[i] * CY[i])} - rho * ux * uy;
    let xz = ${soma((i) => CX[i] * CZ[i])} - rho * ux * uz;
    let yz = ${soma((i) => CY[i] * CZ[i])} - rho * uy * uz;
    let pi = sqrt(xx * xx + yy * yy + zz * zz + 2.0 * (xy * xy + xz * xz + yz * yz));
    tau = 0.5 * (tau + sqrt(tau * tau + p.smag * pi * ir));
  }
  let w = 1.0 / tau;`);
  if (forca) L.push(`  let kf = 1.0 - 0.5 * w;`);
  for (let i = 0; i < Q; i++) {
    L.push(`  { let e = ${cu(i)}; f${i} += w * (${num(W[i])} * (dr + rho * (3.0 * e + 4.5 * e * e - uu)) - f${i});${forca ? ` f${i} += kf * ${num(W[i])} * ((3.0 * (${num(CX[i])} - ux) + 9.0 * e * ${num(CX[i])}) * p.gxf + (3.0 * (${num(CY[i])} - uy) + 9.0 * e * ${num(CY[i])}) * p.gyf + (3.0 * (${num(CZ[i])} - uz) + 9.0 * e * ${num(CZ[i])}) * p.gzf);` : ""} }`);
  }
  L.push(`  ${gravar(precisao, "f", "c")}
}
@compute @workgroup_size(${grupo})
fn iniciar(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.nx) { return; }
  let c = g.x + p.nx * (g.y + p.ny * g.z);
  if ((tipoDe(c) & 3u) == ${SOLIDO}u) { return; }
  let ux = p.ux; let uy = p.uy; let uz = p.uz;
  let uu = 1.5 * (ux * ux + uy * uy + uz * uz);`);
  for (let i = 0; i < Q; i++) L.push(`  let e${i} = ${num(W[i])} * (3.0 * (${cu(i)}) + 4.5 * (${cu(i)}) * (${cu(i)}) - uu);`);
  L.push(`  ${gravar(precisao, "e", "c")}
}`);
  return L.join("\n");
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
  if ((tipoDe(c) & 3u) == ${SOLIDO}u) { return vec4<f32>(0.54, 0.58, 0.62, 1.0); }
${Array.from({ length: Q }, (_, i) => `  let f${i} = ${carregar(precisao, i, "c")};`).join("\n")}
  let dr = ${soma(() => 1)};
  let j = vec3<f32>(${soma((i) => CX[i])}, ${soma((i) => CY[i])}, ${soma((i) => CZ[i])});
  let u = length(j) / (1.0 + dr);
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
  private desenho?: { pipe: GPURenderPipeline; grupos: GPUBindGroup[]; ctx: GPUCanvasContext };
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
    device.queue.writeBuffer(this.tipos, 0, marcarVizinhos(cfg));
    this.uniforme = device.createBuffer({ size: 64, usage: USO.UNIFORM | USO.COPY_DST });
    this.escreverParametros();
    const modulo = device.createShaderModule({ code: wgslPasso(cfg.precisao, !!cfg.forca, tamGrupo) });
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
  }

  /** Atualiza τ, Cs, u∞ e força (pode mudar durante a simulação). */
  escreverParametros(g: [number, number, number] = [0, 0, 0], escalaCor = 1) {
    const { nx, ny, nz, tau, cs, u } = this.cfg;
    const b = new ArrayBuffer(64);
    const ui = new Uint32Array(b);
    const fl = new Float32Array(b);
    ui[0] = nx; ui[1] = ny; ui[2] = nz; ui[3] = this.n;
    fl[4] = tau; fl[5] = smagorinsky(cs); fl[6] = u[0]; fl[7] = u[1]; fl[8] = u[2];
    fl[10] = g[0]; fl[11] = g[1]; fl[12] = g[2];
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
