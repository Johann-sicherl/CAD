// Teste do núcleo do WJFlow em Node: propriedades da rede D3Q19 e casos com solução exata
// (Taylor–Green, Poiseuille), conservação de massa, LES e conversão de unidades.
import { cpNaSuperficie, imagemDoCorte, linhaDeCorrente, sementes, velocidadeEm, type Campo } from "../src/flow/campo";
import { coeficientes, compactar, desserializar, estudoNovo, forcaReal, preparar, serializar, U_REDE } from "../src/flow/estudo";
import { caixa, escreverStl, esfera, lerStl, montarDominio, paraTunel, propriedadesAr, voxelizar } from "../src/flow/geometria";
import { AR, CX, CY, CZ, EQ, SAIDA, ESCALA_FP16, LbmCpu, Q, SOLIDO, W, bytesPorCelula, equilibrio, escalar, meia, meiaBits, meiaParaFloat, opp, reynolds, tunelEsfera } from "../src/flow/lbm";

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
function taylorGreen(tau: number, cs: number, passos: number, regularizado = false): { medido: number; teorico: number } {
  const L = 32, u0 = 0.02, k = (2 * Math.PI) / L;
  const s = new LbmCpu({ nx: L, ny: L, nz: 2, tau, cs, regularizado });
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
  const reg = taylorGreen(0.55, 0, 400, true);
  perto("Taylor–Green regularizado τ=0,55: decaimento / teórico (mesma viscosidade)", reg.medido / reg.teorico, 1, 0.01);
  const les = taylorGreen(0.55, 0.17, 400);
  perto("LES de Smagorinsky dissipa mais que o BGK puro", les.medido < tg2.medido ? 1 : 0, 1, 0);
}

// --- onda de pressão (acústica) com τ ≈ ½: o BGK quase não amortece; o regularizado com ω_b = 1, sim
{
  const onda = (regularizado: boolean) => {
    const L = 32;
    const s = new LbmCpu({ nx: L, ny: 2, nz: 2, tau: 0.5001, regularizado });
    for (let c = 0; c < s.n; c++) s.definir(c, 1 + 0.001 * Math.cos((2 * Math.PI * (c % L)) / L), 0, 0, 0);
    const amp = () => {
      let m = 0;
      for (let c = 0; c < L; c++) m = Math.max(m, Math.abs(s.macro(c).rho - 1));
      return m;
    };
    const a0 = amp();
    let maxDepois = 0;
    for (let t = 0; t < 600; t++) {
      s.passo();
      if (t > 500) maxDepois = Math.max(maxDepois, amp());
    }
    return maxDepois / a0;
  };
  perto("acústica: BGK com τ ≈ ½ mantém a onda (sem amortecimento)", onda(false) > 0.9 ? 1 : 0, 1, 0);
  perto("acústica: regularizado com ω_b = 1 amortece a onda", onda(true) < 0.5 ? 1 : 0, 1, 0);
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
  const sr = new LbmCpu({ nx: 2, ny, nz: 1, tau, g: [gx, 0, 0], regularizado: true }, tipo);
  for (let t = 0; t < 12000; t++) sr.passo();
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
  let erroReg = 0;
  for (let y = 1; y < ny - 1; y++) {
    const yy = y - 0.5;
    erroReg = Math.max(erroReg, Math.abs(sr.macro(2 * y).ux - (gx / (2 * nu)) * yy * (H - yy)) / umax);
  }
  perto("Poiseuille regularizado: erro máx. / u_máx", erroReg, 0, 0.01);
  // troca de momento: em regime, a força nas paredes iguala a força de corpo total no fluido
  const nFluido = 2 * (ny - 2);
  const [fx, fy] = s.forcaNosSolidos();
  perto("troca de momento: força nas paredes / força de corpo total", fx / (gx * nFluido), 1, 1e-3);
  perto("troca de momento: sem força lateral", Math.abs(fy) / (gx * nFluido), 0, 1e-6);
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
  const erroFp16 = (escala: number, truncar = false, caso = canal) => {
    const ref = caso(), s = caso();
    let e = 0, m = 0;
    for (let t = 0; t < 60; t++) {
      ref.passo();
      s.passo();
      for (let j = 0; j < s.f.length; j++) s.f[j] = meia(s.f[j] * escala, true, truncar) / escala;
    }
    for (let j = 0; j < s.f.length; j++) {
      e = Math.max(e, Math.abs(s.f[j] - ref.f[j]));
      m = Math.max(m, Math.abs(ref.f[j]));
    }
    return e / m;
  };
  const esfera = () => new LbmCpu({ nx: 32, ny: 16, nz: 16, tau: 0.56, cs: 0.1, u: [0.05, 0, 0] }, tunelEsfera(32, 16, 16, 6, 10));
  perto("FP16 com zeramento, sem escala: perde o escoamento (1ª falha do tablet)", erroFp16(1) > 0.5 ? 1 : 0, 1, 0);
  perto("FP16 com zeramento, escala 2¹⁴: erro relativo", erroFp16(ESCALA_FP16), 0, 1e-3);
  // 2ª falha do tablet: o pack2x16float da Adreno trunca; o erro sistemático acumula (1,7 %)
  perto("FP16 truncado, esfera: erro relativo acima do limite (2ª falha do tablet)", erroFp16(ESCALA_FP16, true, esfera) > 1e-2 ? 1 : 0, 1, 0);
  perto("FP16 ao par mais próximo, esfera: erro relativo", erroFp16(ESCALA_FP16, false, esfera), 0, 3e-3);
  // conversão inteira do shader (meiaBits) = arredondamento IEEE ao par mais próximo
  let difBits = 0;
  const amostra = new Float32Array(1);
  for (let k = 0; k < 1_000_000; k++) {
    amostra[0] = (Math.random() < 0.5 ? -1 : 1) * 2 ** (-30 + 33 * Math.random());
    const v = amostra[0];
    if (meiaParaFloat(meiaBits(v)) !== Math.min(meia(v, true), 65504) && !(Math.abs(v) > 65504)) difBits++;
  }
  for (const v of [0, -0, 1, 1 / 3, 65504, 1e9, 2 ** -14, 2 ** -15, 1 + 2 ** -11, 1 + 3 * 2 ** -11]) {
    const esperado = Math.abs(v) > 65504 ? 65504 * Math.sign(v) : meia(v, true);
    if (meiaParaFloat(meiaBits(v)) !== esperado) difBits++;
  }
  perto("meiaBits (shader) = FP16 IEEE ao par mais próximo em 1 milhão de valores", difBits, 0, 0);
  perto("FP16: arredondamento de 1/3", meia(1 / 3), 0.333251953125, 0);
}

// --- túnel com saída e zona esponja ---
{
  const nx = 48, ny = 24, nz = 24;
  const tipo = tunelEsfera(nx, ny, nz, 8);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) tipo[nx - 1 + nx * (y + ny * z)] = SAIDA;
  const s = new LbmCpu({ nx, ny, nz, tau: 0.52, cs: 0.1, u: [0.05, 0, 0], esponja: { x0: 36, dtau: 0.5 } }, tipo);
  for (let t = 0; t < 400; t++) s.passo();
  let nan = 0;
  for (const v of s.f) if (!Number.isFinite(v)) nan++;
  perto("saída + esponja: sem NaN", nan, 0, 0);
  const cy = Math.round((ny - 1) / 2), cz = Math.round((nz - 1) / 2);
  perto("saída: ar sai com a velocidade da corrente (±20 %)", s.macro(nx - 2 + nx * (cy + ny * cz)).ux / 0.05, 1, 0.2);
  perto("esponja: τ cresce até τ₀ + Δτ na saída", s.tauEm(nx - 1), 1.02, 1e-12);
  const [fx] = s.forcaNosSolidos();
  perto("esfera: arrasto no sentido do ar", fx > 0 ? 1 : 0, 1, 0);
}

// --- camadas absorventes: partida brusca num túnel vazio (entrada EQ, saída SAIDA) ---
{
  const tunelVazio = (sigma: number) => {
    const nx = 96, ny = 2, nz = 2;
    const tipo = new Uint8Array(nx * ny * nz);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      tipo[nx * (y + ny * z)] = EQ;
      tipo[nx - 1 + nx * (y + ny * z)] = SAIDA;
    }
    const s = new LbmCpu({ nx, ny, nz, tau: 0.5001, u: [0.05, 0, 0], regularizado: true, esponja: { x0: 84, dtau: 0.5, sigma, entrada: 8 } }, tipo);
    for (let c = 0; c < s.n; c++) if (tipo[c] === 0) s.definir(c, 1, 0, 0, 0); // ar parado: partida brusca
    let pico = 0;
    for (let t = 0; t < 3000; t++) {
      s.passo();
      if (t > 2000) for (let x = 10; x < 80; x++) pico = Math.max(pico, Math.abs(s.macro(x).rho - 1));
    }
    return pico;
  };
  const sem = tunelVazio(0), com = tunelVazio(0.1);
  perto("camadas absorventes: onda de pressão residual 10× menor", com < sem / 10 ? 1 : 0, 1, 0);
  console.log(`     (δρ residual: sem camadas ${sem.toExponential(2)}, com camadas ${com.toExponential(2)})`);
}

// --- geometria: STL, orientação, voxelização, túnel, ar ---
{
  const e = esfera(10, [0, 0, 0]);
  const lida = lerStl(escreverStl(e));
  perto("STL binário: mesmo número de triângulos", lida.triangulos.length, e.triangulos.length, 0);
  perto("STL binário: mesmo vértice", lida.vertices[4], e.vertices[3 * e.triangulos[1] + 1], 1e-6);
  const txt = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;
  perto("STL texto: 1 triângulo", lerStl(new TextEncoder().encode(txt).buffer as ArrayBuffer).triangulos.length, 3, 0);
  // esfera r = 10 numa grade de 1: volume voxelizado ≈ 4/3·π·r³ (a malha de facetas é ~1 % menor)
  const vx = voxelizar(e, 32, 32, 32, 1, [-15.5, -15.5, -15.5]);
  perto("voxelização: volume da esfera / exato", vx.solidas / ((4 / 3) * Math.PI * 1000), 0.99, 0.02);
  perto("voxelização: malha fechada (sem colunas suspeitas)", vx.suspeitas, 0, 0);
  perto("voxelização: área frontal / π·r²", vx.area / (Math.PI * 100), 1, 0.04);
  // orientação: caixa 4 × 2 × 1 (x, y, z)
  const caixaM = { vertices: new Float32Array([0, 0, 0, 4, 2, 1]), triangulos: new Uint32Array(0) };
  const ext = (d: "+z" | "+y" | "-x") => {
    const { min, max } = caixa(paraTunel(caixaM, d));
    return max.map((v, i) => Math.round(v - min[i])).join("×");
  };
  perto("ar em +Z: comprimento no túnel = Z da peça", ext("+z") === "1×2×4" ? 1 : 0, 1, 0);
  perto("ar em +Y: comprimento no túnel = Y da peça", ext("+y") === "2×1×4" ? 1 : 0, 1, 0);
  perto("ar em −X: mesmas medidas", ext("-x") === "4×2×1" ? 1 : 0, 1, 0);
  // túnel automático com 200 mil células em volta de uma esfera de 50 mm
  const d = montarDominio(esfera(25), { celulas: 200_000 });
  perto("túnel: células ≈ orçamento", (d.nx * d.ny * d.nz) / 200_000, 1, 0.08);
  perto("túnel: bloqueio ≤ 5 %", (d.areaFrontal / (d.ny * d.nz)) <= 0.05 ? 1 : 0, 1, 0);
  perto("túnel: entrada EQ e saída SAIDA", d.tipo[0] === EQ && d.tipo[d.nx - 1 + d.nx * (Math.floor(d.ny / 2) + d.ny * Math.floor(d.nz / 2))] === SAIDA ? 1 : 0, 1, 0);
  perto("túnel: montante de 1,5 comprimento", (Math.round(d.nx / 6.5 * 1.5)), Math.round((-25 - d.origem[0]) / d.dx + 0.5), 1);
  // ar
  const ar = propriedadesAr(20, 0);
  perto("ar a 20 °C: ρ (kg/m³)", ar.rho, 1.204, 0.002);
  perto("ar a 20 °C: ν (m²/s)", ar.nu, 1.506e-5, 0.01e-5);
  perto("ar a 1000 m: pressão (Pa)", propriedadesAr(15, 1000).p, 89875, 5);
}

// --- estudo: preparo em unidades reais, conversão de forças, arquivo .wjflow ---
{
  const e = { ...estudoNovo(), modo: "rascunho" as const, velocidade: 20 };
  const peca = esfera(25); // 50 mm
  const p = preparar(e, peca);
  perto("estudo: Re da esfera de 50 mm a 20 m/s", p.re, (20 * 0.05) / p.ar.nu, 1);
  perto("estudo: Δt = u_rede·Δx/U", p.dt, (U_REDE * p.dx) / 20, 1e-15);
  perto("estudo: área frontal ≈ π·r²", p.areaRef / (Math.PI * 0.025 ** 2), 1, 0.06);
  perto("estudo: média na última travessia", p.passosTotal - p.inicioMedia, p.passosTravessia, 0);
  // a mesma força dá o mesmo Cd na rede e em unidades reais (consistência da conversão)
  const fRede: [number, number, number] = [0.5 * 0.5 * U_REDE ** 2 * p.areaRefCelulas, 0, 0]; // Cd = 0,5
  const fN = forcaReal(fRede, p);
  perto("estudo: Cd na rede", coeficientes(fRede, p)[0], 0.5, 1e-12);
  perto("estudo: Cd com a força em N (½ρU²A)", fN[0] / (0.5 * p.ar.rho * 20 * 20 * p.areaRef), 0.5, 1e-9);
  // arquivo: estudo + peça compactada (vértices repetidos do STL viram um só)
  const stl = lerStl(escreverStl(peca));
  const c = compactar(stl);
  perto("compactar: vértices únicos da esfera", c.vertices.length / 3, 24 * 48 - 48 * 2 + 2 + 48 * 2 - 2, 48 * 2);
  const volta = desserializar(serializar({ ...e, nome: "Esfera" }, stl));
  perto("arquivo .wjflow: mesmo número de triângulos", volta.malha!.triangulos.length, stl.triangulos.length, 0);
  perto("arquivo .wjflow: mesmo nome", volta.estudo.nome === "Esfera" ? 1 : 0, 1, 0);
  const vt = volta.malha!.triangulos, vv = volta.malha!.vertices;
  perto("arquivo .wjflow: mesma geometria", vv[3 * vt[7] + 2], stl.vertices[3 * 7 + 2], 0);
}

// --- pós-processamento 3D: linhas de corrente, Cp na superfície, imagem do corte ---
{
  const nx = 40, ny = 20, nz = 20, n = nx * ny * nz, U = 0.05;
  const campoCom = (f: (x: number, y: number, z: number) => [number, number, number, number], tipo = new Uint8Array(n)): Campo => {
    const dados = new Float32Array(4 * n);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) dados.set(f(x, y, z), 4 * (x + nx * (y + ny * z)));
    return { nx, ny, nz, dados, tipo, u: U };
  };
  // ar uniforme: linha reta até a saída
  const reto = campoCom(() => [U, 0, 0, 0]);
  const l1 = linhaDeCorrente(reto, [1, 7.3, 9.1]);
  const fim = l1.pontos.slice(-3);
  perto("linha de corrente reta: chega à saída", fim[0], nx - 1, 0.5);
  perto("linha de corrente reta: y constante", fim[1], 7.3, 1e-9);
  perto("linha de corrente: rapidez = 1 (U∞)", l1.rapidez[0], 1, 1e-6);
  // bloco sólido no caminho: a linha para antes dele
  const tipoBloco = new Uint8Array(n);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 20; x < 23; x++) tipoBloco[x + nx * (y + ny * z)] = SOLIDO;
  const lb = linhaDeCorrente(campoCom(() => [U, 0, 0, 0], tipoBloco), [1, 10, 10]);
  perto("linha de corrente: para na peça", lb.pontos[lb.pontos.length - 3] < 20 ? 1 : 0, 1, 0);
  // rotação de corpo rígido em torno de (20, 10): a linha fica no círculo (RK2)
  const giro = campoCom((x, y) => [-(y - 10) * 0.005, (x - 20) * 0.005, 0, 0]);
  const lg = linhaDeCorrente(giro, [26, 10, 10], { passo: 0.25, maximo: Math.PI * 6 });
  let desvio = 0;
  for (let i = 0; i < lg.pontos.length; i += 3) desvio = Math.max(desvio, Math.abs(Math.hypot(lg.pontos[i] - 20, lg.pontos[i + 1] - 10) - 6));
  perto("linha de corrente em rotação: fica no círculo (desvio em células)", desvio, 0, 0.05);
  perto("velocidade interpolada no meio de 4 células", velocidadeEm(giro, 20.5, 10.5, 10)![0], -0.5 * 0.005, 1e-9);
  perto("sementes: grade 3 × 3", sementes(2, 0, 9, 0, 9, 3).length, 9, 0);
  // Cp na superfície: δρ uniforme que vale Cp = 1 → todos os vértices da esfera leem 1
  const esf = esfera(5, [20, 10, 10], 12, 24);
  const vx = voxelizar(esf, nx, ny, nz, 1, [0, 0, 0]);
  const campoCp = campoCom(() => [0, 0, 0, 1.5 * U * U], vx.tipo);
  const cps = cpNaSuperficie(campoCp, esf, (p) => p);
  let ruins = 0;
  for (const v of cps) if (!(Math.abs(v - 1) < 1e-6)) ruins++;
  perto("Cp na superfície: todos os vértices acham o fluido e leem Cp = 1", ruins, 0, 0);
  const img = imagemDoCorte(campoCp, 0, 10, "cp", 1);
  perto("imagem do corte: tamanho nx × ny", img.rgba.length, 4 * nx * ny, 0);
  const meio = 4 * ((ny - 1 - 10) * nx + 20);
  perto("imagem do corte: centro da esfera em cinza", img.rgba[meio], Math.round(0.54 * 255), 1);
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
  perto("bytes por célula FP32", bytesPorCelula("fp32"), 153, 0);
  perto("bytes por célula FP16", bytesPorCelula("fp16"), 81, 0);
}

if (falhas) {
  console.log(`\n${falhas} falha(s) no WJFlow`);
  process.exit(1);
}
console.log("\nWJFlow: todos os testes passaram");
