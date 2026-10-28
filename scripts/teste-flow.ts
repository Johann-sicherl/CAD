// Teste do núcleo do WJFlow em Node: propriedades da rede D3Q19 e casos com solução exata
// (Taylor–Green, Poiseuille), conservação de massa, LES e conversão de unidades.
import { AR, CX, CY, CZ, EQ, ESCALA_FP16, LbmCpu, Q, SOLIDO, W, bytesPorCelula, equilibrio, escalar, meia, opp, reynolds, tunelEsfera } from "../src/flow/lbm";

let falhas = 0;
function perto(nome: string, obtido: number, esperado: number, tol: number) {
  const ok = Math.abs(obtido - esperado) <= tol;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${obtido.toPrecision(6)}${ok ? "" : ` (esperado ${esperado} ± ${tol})`}`);
}

// --- rede D3Q19: isotropia até a 2ª ordem e opostas ---
perto("Σw = 1", W.reduce((a, b) => a + b, 0), 1, 1e-12);
let m1 = 0, m2 = 0, m2xy = 0, m4 = 0, errOpp = 0;
for (let i = 0; i < Q; i++) {
  m1 += Math.abs(W[i] * CX[i]) + Math.abs(W[i] * CY[i]);
  m2 += W[i] * CX[i] * CX[i];
  m2xy += W[i] * CX[i] * CY[i];
  m4 += W[i] * CX[i] ** 2 * CY[i] ** 2;
  const o = opp(i);
  errOpp += Math.abs(CX[i] + CX[o]) + Math.abs(CY[i] + CY[o]) + Math.abs(CZ[i] + CZ[o]);
}
perto("Σw·c = 0 (sem termos ímpares)", Math.abs(W.reduce((a, w, i) => a + w * CX[i], 0)), 0, 1e-12);
perto("Σw·cx² = cs² = 1/3", m2, 1 / 3, 1e-12);
perto("Σw·cx·cy = 0", m2xy, 0, 1e-12);
perto("Σw·cx²·cy² = cs⁴ = 1/9", m4, 1 / 9, 1e-12);
perto("opostas corretas", errOpp, 0, 0);
void m1;

// --- equilíbrio devolve ρ e u exatos ---
{
  const [dr, ux, uy, uz] = [0.02, 0.05, -0.03, 0.01];
  let r = 0, jx = 0, jy = 0, jz = 0;
  for (let i = 0; i < Q; i++) {
    const v = equilibrio(i, dr, ux, uy, uz);
    r += v;
    jx += CX[i] * v;
    jy += CY[i] * v;
    jz += CZ[i] * v;
  }
  perto("equilíbrio: δρ", r, dr, 1e-12);
  perto("equilíbrio: ρux", jx, (1 + dr) * ux, 1e-12);
  perto("equilíbrio: ρuy", jy, (1 + dr) * uy, 1e-12);
  perto("equilíbrio: ρuz", jz, (1 + dr) * uz, 1e-12);
}

// --- Taylor–Green 2D (periódico): u decai com exp(−2νk²t), confirma ν = cs²(τ − ½) ---
function taylorGreen(tau: number, cs: number, passos: number): { medido: number; teorico: number } {
  const L = 32, u0 = 0.02, k = (2 * Math.PI) / L;
  const s = new LbmCpu({ nx: L, ny: L, nz: 2, tau, cs });
  for (let z = 0; z < 2; z++) {
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const ux = -u0 * Math.cos(k * (x + 0.5)) * Math.sin(k * (y + 0.5));
        const uy = u0 * Math.sin(k * (x + 0.5)) * Math.cos(k * (y + 0.5));
        const p = -0.25 * u0 * u0 * (Math.cos(2 * k * (x + 0.5)) + Math.cos(2 * k * (y + 0.5)));
        s.definir(x + L * (y + L * z), 1 + 3 * p, ux, uy, 0);
      }
    }
  }
  const energia = () => {
    let e = 0;
    for (let c = 0; c < s.n; c++) {
      const m = s.macro(c);
      e += m.ux * m.ux + m.uy * m.uy;
    }
    return Math.sqrt(e / s.n);
  };
  const e0 = energia();
  for (let t = 0; t < passos; t++) s.passo();
  const nu = (tau - 0.5) / 3;
  return { medido: energia() / e0, teorico: Math.exp(-2 * nu * k * k * passos) };
}
{
  const tg = taylorGreen(0.8, 0, 400);
  perto("Taylor–Green τ=0,8: decaimento / teórico", tg.medido / tg.teorico, 1, 0.01);
  const tg2 = taylorGreen(0.55, 0, 400);
  perto("Taylor–Green τ=0,55: decaimento / teórico", tg2.medido / tg2.teorico, 1, 0.01);
  const les = taylorGreen(0.55, 0.17, 400);
  perto("LES de Smagorinsky dissipa mais que o BGK puro", les.medido < tg2.medido ? 1 : 0, 1, 0);
}

// --- Poiseuille plano com força de corpo e paredes por bounce-back ---
{
  const ny = 21, tau = 0.9, gx = 1e-6;
  const tipo = new Uint8Array(2 * ny * 1);
  for (let x = 0; x < 2; x++) {
    tipo[x] = SOLIDO;
    tipo[x + 2 * (ny - 1)] = SOLIDO;
  }
  const s = new LbmCpu({ nx: 2, ny, nz: 1, tau, g: [gx, 0, 0] }, tipo);
  for (let t = 0; t < 12000; t++) s.passo();
  const nu = (tau - 0.5) / 3;
  // paredes no meio do caminho: y = 0,5 e y = ny − 1,5 → H = ny − 2
  const H = ny - 2;
  let erroMax = 0;
  const umax = (gx / (2 * nu)) * (H / 2) ** 2;
  for (let y = 1; y < ny - 1; y++) {
    const yy = y - 0.5;
    const teor = (gx / (2 * nu)) * yy * (H - yy);
    erroMax = Math.max(erroMax, Math.abs(s.macro(2 * y).ux - teor) / umax);
  }
  perto("Poiseuille: erro máx. / u_máx", erroMax, 0, 0.01);
}

// --- túnel com esfera: massa estável, nada vira NaN, esteira atrás da esfera ---
{
  const nx = 48, ny = 24, nz = 24, d = 8;
  const s = new LbmCpu({ nx, ny, nz, tau: 0.53, cs: 0.1, u: [0.05, 0, 0] }, tunelEsfera(nx, ny, nz, d));
  for (let t = 0; t < 300; t++) s.passo();
  let nan = 0;
  for (const v of s.f) if (!Number.isFinite(v)) nan++;
  perto("túnel: sem NaN", nan, 0, 0);
  const cy = Math.round((ny - 1) / 2), cz = Math.round((nz - 1) / 2);
  const atras = s.macro(Math.round(nx / 4) + 7 + nx * (cy + ny * cz)).ux;
  perto("túnel: esteira mais lenta que a corrente livre", atras < 0.05 * 0.7 ? 1 : 0, 1, 0);
  const t = tunelEsfera(nx, ny, nz, d);
  perto("túnel: borda EQ", t[0] === EQ ? 1 : 0, 1, 0);
}

// --- conservação de massa em caixa fechada periódica com obstáculo ---
{
  const n = 16;
  const tipo = new Uint8Array(n * n * n);
  for (let z = 6; z < 10; z++) for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) tipo[x + n * (y + n * z)] = SOLIDO;
  const s = new LbmCpu({ nx: n, ny: n, nz: n, tau: 0.6, u: [0.04, 0.01, 0] }, tipo);
  const m0 = s.massa();
  for (let t = 0; t < 200; t++) s.passo();
  perto("massa conservada (erro relativo)", Math.abs(s.massa() - m0) / m0, 0, 1e-5);
}

// --- armazenamento FP16 em GPU que zera subnormais (Adreno 613, medido no tablet do Johann) ---
{
  // canal da autoverificação: populações ~10⁻⁴, metade delas na faixa subnormal do FP16
  const canal = () => {
    const t = new Uint8Array(16 * 12 * 8);
    for (let z = 0; z < 8; z++) for (let x = 0; x < 16; x++) {
      t[x + 16 * (0 + 12 * z)] = SOLIDO;
      t[x + 16 * (11 + 12 * z)] = SOLIDO;
    }
    return new LbmCpu({ nx: 16, ny: 12, nz: 8, tau: 0.8, g: [2e-5, 0, 0] }, t);
  };
  const erroFp16 = (escala: number) => {
    const ref = canal(), s = canal();
    let e = 0, m = 0;
    for (let t = 0; t < 60; t++) {
      ref.passo();
      s.passo();
      for (let j = 0; j < s.f.length; j++) s.f[j] = meia(s.f[j] * escala, true) / escala;
    }
    for (let j = 0; j < s.f.length; j++) {
      e = Math.max(e, Math.abs(s.f[j] - ref.f[j]));
      m = Math.max(m, Math.abs(ref.f[j]));
    }
    return e / m;
  };
  perto("FP16 com zeramento, sem escala: perde o escoamento (reproduz a falha do tablet)", erroFp16(1) > 0.5 ? 1 : 0, 1, 0);
  perto("FP16 com zeramento, escala 2¹⁴: erro relativo", erroFp16(ESCALA_FP16), 0, 1e-3);
  perto("FP16: arredondamento de 1/3", meia(1 / 3), 0.333251953125, 0);
}

// --- unidades: carro de 4 m a 30 m/s com 200 células no comprimento ---
{
  const e = escalar(4, 30, 200);
  perto("Re do carro", e.re, 30 * 4 / AR.nu, 1);
  perto("Δx do carro (m)", e.dx, 0.02, 1e-12);
  perto("Δt do carro (s)", e.dt, (0.05 * 0.02) / 30, 1e-15);
  perto("τ₀ do carro ≈ ½ (exige LES)", e.tau, 0.5 + (3 * AR.nu * e.dt) / (e.dx * e.dx), 1e-12);
  perto("passos por comprimento", e.passosPorL, 4000, 0);
  perto("Re de tubo 50 mm a 10 m/s", reynolds(10, 0.05), 32982, 1);
  perto("bytes por célula FP32", bytesPorCelula("fp32"), 156, 0);
  perto("bytes por célula FP16", bytesPorCelula("fp16"), 80, 0);
}

if (falhas) {
  console.log(`\n${falhas} falha(s) no WJFlow`);
  process.exit(1);
}
console.log("\nWJFlow: todos os testes passaram");
