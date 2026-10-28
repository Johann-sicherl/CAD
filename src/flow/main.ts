// WJFlow — protótipo de medição (fase A0 de docs/global/wjflow.md).
// 1) Autoverificação: o shader da GPU tem de dar o mesmo resultado da referência em CPU (lbm.ts).
// 2) Medição: passos/s e MLUPS (milhões de células atualizadas por segundo) em malhas crescentes,
//    em FP32 e FP16, para dimensionar o túnel neste aparelho.
// 3) Túnel ao vivo: esfera no túnel, plano central colorido pela velocidade.

import "./flow.css";
import { LbmCpu, Q, bytesPorCelula, tunelEsfera, type Precisao } from "./lbm";
import { LbmGpu, abrirGpu, cabe } from "./gpu";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const saida = $<HTMLPreElement>("af-saida");
const estado = $<HTMLParagraphElement>("af-estado");
const U = 0.05; // velocidade do ar na rede (Mach de rede ≈ 0,087)
const MALHAS: [number, number, number][] = [[64, 32, 32], [128, 64, 64], [160, 80, 80], [192, 96, 96], [256, 128, 128], [320, 160, 160]];
const relatorio: string[] = [];
let gpu: Awaited<ReturnType<typeof abrirGpu>> | null = null;
let erroGpu = "";
let ocupado = false;

const fmt = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const mb = (b: number) => `${fmt(b / 1048576)} MB`;
function escrever(linha: string) {
  relatorio.push(linha);
  saida.textContent = relatorio.join("\n");
  saida.scrollTop = saida.scrollHeight;
}
const pausa = () => new Promise((r) => setTimeout(r, 0));

async function mostrarAparelho() {
  const dl = $<HTMLDListElement>("af-aparelho");
  const linhas: [string, string][] = [];
  const nav = navigator as Navigator & { deviceMemory?: number };
  try {
    gpu = await abrirGpu();
    const i = gpu.adaptador.info;
    const l = gpu.device.limits;
    linhas.push(
      ["WebGPU", "disponível ✓"],
      ["GPU", [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(" · ") || "(o navegador não informa)"],
      ["Maior buffer", `${mb(l.maxStorageBufferBindingSize)} por vínculo, ${mb(l.maxBufferSize)} por buffer`],
      ["FP16 em shader", gpu.adaptador.features.has("shader-f16") ? "sim" : "não (o armazenamento FP16 funciona mesmo assim)"],
    );
    gpu.device.lost.then((x) => escrever(`!! GPU perdida: ${x.message || x.reason}`));
  } catch (e) {
    erroGpu = (e as Error).message;
    linhas.push(["WebGPU", `indisponível — ${erroGpu}`]);
  }
  linhas.push(
    ["Memória do aparelho", nav.deviceMemory ? `≈ ${nav.deviceMemory} GB (valor arredondado pelo navegador)` : "(não informada)"],
    ["Núcleos de CPU", String(navigator.hardwareConcurrency || "?")],
    ["Navegador", navigator.userAgent],
  );
  dl.innerHTML = linhas.map(([k, v]) => `<dt>${k}</dt><dd>${v.replace(/[<>&]/g, "")}</dd>`).join("");
  for (const [k, v] of linhas) relatorio.push(`${k}: ${v}`);
  relatorio.push("");
  saida.textContent = relatorio.join("\n");
  const sel = $<HTMLSelectElement>("af-malha");
  sel.innerHTML = MALHAS.slice(0, 5).map(([x, y, z], k) => `<option value="${k}"${k === 1 ? " selected" : ""}>${x}×${y}×${z} (${fmt((x * y * z) / 1e6, 1)} M células)</option>`).join("");
  if (!gpu) for (const b of ["af-verificar", "af-medir", "af-vivo"]) $<HTMLButtonElement>(b).disabled = true;
}

/** Roda uma tarefa exclusiva (um teste por vez), com os botões travados. */
async function exclusivo(f: () => Promise<void>) {
  if (ocupado) return;
  ocupado = true;
  pararVivo();
  document.querySelectorAll<HTMLButtonElement>(".af-botoes button").forEach((b) => (b.disabled = true));
  try {
    await f();
  } catch (e) {
    escrever(`!! erro: ${(e as Error).message}`);
  } finally {
    ocupado = false;
    document.querySelectorAll<HTMLButtonElement>(".af-botoes button").forEach((b) => (b.disabled = !gpu && b.id !== "af-cpu" && b.id !== "af-copiar"));
  }
}

/** Compara GPU × CPU no mesmo caso: túnel com esfera (LES) e canal com força (Guo). */
async function verificar() {
  const casos: { nome: string; nx: number; ny: number; nz: number; tau: number; cs: number; u: [number, number, number]; g: [number, number, number]; tipo: Uint8Array; passos: number }[] = [
    { nome: "túnel com esfera + LES", nx: 32, ny: 16, nz: 16, tau: 0.56, cs: 0.1, u: [U, 0, 0], g: [0, 0, 0], tipo: tunelEsfera(32, 16, 16, 6, 10), passos: 60 },
    { nome: "canal periódico com força", nx: 16, ny: 12, nz: 8, tau: 0.8, cs: 0, u: [0, 0, 0], g: [2e-5, 0, 0], tipo: canal(16, 12, 8), passos: 60 },
  ];
  escrever("== Autoverificação (GPU × referência em CPU) ==");
  let ok = true;
  for (const prec of ["fp32", "fp16"] as Precisao[]) {
    for (const c of casos) {
      const cpu = new LbmCpu({ nx: c.nx, ny: c.ny, nz: c.nz, tau: c.tau, cs: c.cs, u: c.u, g: c.g }, c.tipo);
      const g = new LbmGpu(gpu!.device, { nx: c.nx, ny: c.ny, nz: c.nz, tau: c.tau, cs: c.cs, u: c.u, precisao: prec, tipo: c.tipo });
      g.escreverParametros(c.g);
      for (let k = 0; k < c.passos; k++) cpu.passo();
      g.avancar(c.passos);
      const f = await g.ler();
      g.destruir();
      let erro = 0, ref = 0;
      for (let j = 0; j < f.length; j++) {
        if (!Number.isFinite(f[j])) erro = Infinity;
        erro = Math.max(erro, Math.abs(f[j] - cpu.f[j]));
        ref = Math.max(ref, Math.abs(cpu.f[j]));
      }
      // FP32: só arredondamento; FP16: 11 bits de mantissa e arredondamento que varia entre drivers.
      // Um driver com defeito erra na ordem do próprio valor, muito acima destes limites.
      const lim = prec === "fp32" ? 1e-5 * ref + 1e-7 : 1e-2 * ref + 1e-6;
      const passou = erro <= lim;
      ok &&= passou;
      escrever(`${passou ? "ok   " : "FALHA"} ${prec} · ${c.nome}: diferença máx. ${erro.toExponential(2)} (limite ${lim.toExponential(1)})`);
      await pausa();
    }
  }
  escrever(ok ? "Autoverificação: a GPU deste aparelho calcula igual à referência ✓\n" : "Autoverificação FALHOU: o driver desta GPU não calcula igual à referência.\n");
}

function canal(nx: number, ny: number, nz: number): Uint8Array {
  const t = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    t[x + nx * (0 + ny * z)] = 1;
    t[x + nx * (ny - 1 + ny * z)] = 1;
  }
  return t;
}

/** Passos/s sustentados: lotes de ~150 ms até `ms` milissegundos. */
async function cronometrar(s: LbmGpu, ms: number): Promise<number> {
  const t0 = performance.now();
  s.avancar(4);
  await s.esperar();
  const est = Math.max(1, performance.now() - t0) / 4;
  const lote = Math.max(2, Math.min(200, Math.round(150 / est)));
  let passos = 0;
  const t1 = performance.now();
  while (performance.now() - t1 < ms) {
    s.avancar(lote);
    await s.esperar();
    passos += lote;
  }
  return passos / ((performance.now() - t1) / 1000);
}

async function medir() {
  const dev = gpu!.device;
  escrever("== Desempenho (esfera no túnel, BGK + LES, u = 0,05) ==");
  escrever("malha              células  prec.  memória   passos/s   MLUPS   1 travessia");
  const resultados: { celulas: number; prec: Precisao; mlups: number }[] = [];
  externo: for (const [nx, ny, nz] of MALHAS) {
    const n = nx * ny * nz;
    for (const prec of ["fp32", "fp16"] as Precisao[]) {
      const mem = n * bytesPorCelula(prec);
      const nome = `${nx}×${ny}×${nz}`.padEnd(16);
      if (!cabe(dev, n, prec)) {
        escrever(`${nome} ${fmt(n / 1e6, 2).padStart(7)} M ${prec}   não cabe nos limites da GPU`);
        continue;
      }
      dev.pushErrorScope("out-of-memory");
      const s = new LbmGpu(dev, { nx, ny, nz, tau: 0.53, cs: 0.1, u: [U, 0, 0], precisao: prec, tipo: tunelEsfera(nx, ny, nz, ny / 4) });
      const semMemoria = await dev.popErrorScope();
      if (semMemoria) {
        s.destruir();
        escrever(`${nome} ${fmt(n / 1e6, 2).padStart(7)} M ${prec}   sem memória na GPU`);
        continue;
      }
      const pps = await cronometrar(s, n > 2e6 ? 3000 : 2000);
      const verif = await s.ler().then((f) => f.slice(0, Q * 64).every(Number.isFinite)).catch(() => true);
      s.destruir();
      const mlups = (pps * n) / 1e6;
      resultados.push({ celulas: n, prec, mlups });
      const travessia = nx / U / pps;
      escrever(`${nome} ${fmt(n / 1e6, 2).padStart(7)} M ${prec}  ${mb(mem).padStart(8)}  ${fmt(pps, 1).padStart(8)}  ${fmt(mlups, 1).padStart(6)}   ${fmt(travessia, 0).padStart(5)} s${verif ? "" : "  (instável: NaN)"}`);
      await pausa();
      if (travessia > 600) break externo; // malhas maiores seriam lentas demais para uso
    }
  }
  const melhor = resultados.reduce((a, b) => (b.mlups > a.mlups ? b : a), resultados[0]);
  if (melhor) escrever(`Pico: ${fmt(melhor.mlups, 1)} MLUPS (${melhor.prec}, ${fmt(melhor.celulas / 1e6, 2)} M células).`);
  escrever("1 travessia = tempo para o ar cruzar o túnel uma vez; um resultado estável pede de 2 a 4.\n");
}

function baseCpu(): Promise<void> {
  return new Promise((resolve) => {
    escrever("== Base em CPU (1 thread, JavaScript, 64×32×32) ==");
    const w = new Worker(new URL("./cpu-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ celulas: number; passos: number; segundos: number; mlups: number }>) => {
      escrever(`${fmt(e.data.passos)} passos em ${fmt(e.data.segundos, 1)} s → ${fmt(e.data.mlups, 2)} MLUPS por núcleo\n`);
      w.terminate();
      resolve();
    };
    w.onerror = (e) => {
      escrever(`!! erro no worker: ${e.message}`);
      w.terminate();
      resolve();
    };
    w.postMessage({ nx: 64, ny: 32, nz: 32, ms: 3000 });
  });
}

// --- túnel ao vivo ---
let vivo: { s: LbmGpu; quadro: number; porQuadro: number; t0: number; p0: number } | null = null;

function pararVivo() {
  if (!vivo) return;
  cancelAnimationFrame(vivo.quadro);
  vivo.s.destruir();
  vivo = null;
  $<HTMLButtonElement>("af-vivo").textContent = "Iniciar";
}

function iniciarVivo() {
  if (vivo) return pararVivo();
  const [nx, ny, nz] = MALHAS[+$<HTMLSelectElement>("af-malha").value];
  const prec = $<HTMLSelectElement>("af-precisao").value as Precisao;
  const re = +$<HTMLSelectElement>("af-re").value;
  const d = Math.round(ny / 4);
  const nu = (U * d) / re;
  const tau = 3 * nu + 0.5;
  const cs = re > 300 ? 0.1 : 0;
  if (!cabe(gpu!.device, nx * ny * nz, prec)) {
    estado.textContent = "Essa malha não cabe nos limites da GPU deste aparelho.";
    return;
  }
  const s = new LbmGpu(gpu!.device, { nx, ny, nz, tau, cs, u: [U, 0, 0], precisao: prec, tipo: tunelEsfera(nx, ny, nz, d) });
  const canvas = $<HTMLCanvasElement>("af-canvas");
  canvas.width = nx * 4;
  canvas.height = ny * 4;
  s.ligarCanvas(canvas);
  s.escreverParametros([0, 0, 0], 1 / (1.5 * U));
  vivo = { s, quadro: 0, porQuadro: 2, t0: performance.now(), p0: 0 };
  $<HTMLButtonElement>("af-vivo").textContent = "Parar";
  let ultimo = performance.now();
  const laco = () => {
    if (!vivo) return;
    const v = vivo;
    v.s.avancar(v.porQuadro);
    v.s.desenhar();
    void v.s.esperar().then(() => {
      if (vivo !== v) return;
      const agora = performance.now();
      // ajusta os passos por quadro para ~30 quadros/s sem travar a interface
      const dt = agora - ultimo;
      ultimo = agora;
      v.porQuadro = Math.max(1, Math.min(60, Math.round(v.porQuadro * (dt < 28 ? 1.15 : dt > 40 ? 0.85 : 1))));
      const seg = (agora - v.t0) / 1000;
      if (seg > 1) {
        const pps = (v.s.passos - v.p0) / seg;
        estado.textContent = `Re ${fmt(re)} · τ₀ = ${fmt(tau, 4)}${cs ? " + LES" : ""} · ${fmt(pps, 0)} passos/s · ${fmt((pps * v.s.n) / 1e6, 1)} MLUPS · ${fmt((v.s.passos * U) / nx, 2)} travessias`;
        v.t0 = agora;
        v.p0 = v.s.passos;
      }
      v.quadro = requestAnimationFrame(laco);
    });
  };
  vivo.quadro = requestAnimationFrame(laco);
}

$("af-verificar").onclick = () => void exclusivo(verificar);
$("af-medir").onclick = () => void exclusivo(medir);
$("af-cpu").onclick = () => void exclusivo(baseCpu);
$("af-vivo").onclick = () => (ocupado ? undefined : iniciarVivo());
$("af-copiar").onclick = async () => {
  try {
    await navigator.clipboard.writeText(relatorio.join("\n"));
    $("af-copiar").textContent = "Copiado ✓";
  } catch {
    getSelection()?.selectAllChildren(saida);
    $("af-copiar").textContent = "Selecionado: copie";
  }
  setTimeout(() => ($("af-copiar").textContent = "Copiar resultados"), 2000);
};

void mostrarAparelho();
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
