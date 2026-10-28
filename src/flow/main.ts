// WJFlow: escoamento de ar na peça do WJCAD (fase A1 de docs/global/wjflow.md).
// Estudo (peça, ar, malha) → túnel voxelizado num worker → LBM D3Q19 na GPU (gpu.ts) com a
// força medida por troca de momento → Cd/Cl/Cs com média na última travessia e cortes ao vivo.
// Teste do aparelho (autoverificação e desempenho) em flow/aparelho/.

import "./flow.css";
import { $, baixar, Casca, escapar, escolherArquivo, registrarOffline, salvarArquivo } from "../comum/casca";
import { Armazem } from "../comum/armazem";
import { registrarMetrica } from "../comum/diagnostico";
import { abrirGpu, cabe, GRANDEZAS, LbmGpu, type Grandeza, type Plano } from "./gpu";
import { coeficientes, desserializar, estudoNovo, forcaReal, Historico, MODOS, serializar, TUNEIS, U_REDE, UNIDADES, type Estudo, type Modo, type Preparo, type Tunel, type Unidade } from "./estudo";
import { DIRECOES, esfera, lerStl, propriedadesAr, type Direcao, type Malha } from "./geometria";
import { SOLIDO, bytesPorCelula } from "./lbm";

const CHAVE_COFRE = "wjflow:estudo";
const CHAVE_MLUPS = "wjflow:mlups";
const CS = 0.1; // constante de Smagorinsky (LES)

let estudo: Estudo = estudoNovo();
let malha: Malha | null = null;
let preparo: Preparo | null = null;
let preparando: Promise<Preparo | null> | null = null;
let erroPreparo = "";
let gpu: Awaited<ReturnType<typeof abrirGpu>> | null = null;
let erroGpu = "";
interface Simulacao {
  s: LbmGpu;
  hist: Historico;
  rodando: boolean;
  quadro: number;
  porQuadro: number;
  tMedida: number;
  pMedida: number;
  ritmo: number;
  instavel: boolean;
}
let sim: Simulacao | null = null;
let ultimosResultados = 0;
const corte = { plano: 0 as Plano, indice: -1, grandeza: "velocidade" as Grandeza };

const fmt = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const sig = (v: number, s = 3) => (Math.abs(v) >= 1e-3 && Math.abs(v) < 1e5 ? fmt(v, Math.max(0, s - 1 - Math.floor(Math.log10(Math.abs(v) || 1)))) : v.toExponential(2).replace(".", ","));
const minutos = (s: number) => (s < 90 ? `${fmt(s)} s` : `${fmt(s / 60, 1)} min`);
const mlupsDoAparelho = () => {
  const v = Number(localStorage.getItem(CHAVE_MLUPS));
  return v > 0 ? v : 30;
};

// ---------------------------------------------------------------------------------------------
// armazenamento: autosave no IndexedDB (o .wjflow leva a peça, grande demais para o localStorage)

let banco: Promise<Armazem> | null = null;
const db = () => (banco ??= Armazem.abrir("wjflow", ["estudos"]));
let autosaveT = 0;
function autosave() {
  clearTimeout(autosaveT);
  autosaveT = window.setTimeout(() => {
    void db().then((b) => b.por("estudos", { id: "autosave", texto: serializar(estudo, malha) } as { id: string })).catch(() => {});
  }, 500);
}

async function carregarInicial() {
  // aberto pelo WJPDM: o cofre deixou o arquivo no localStorage
  const doCofre = localStorage.getItem(CHAVE_COFRE);
  if (doCofre) {
    localStorage.removeItem(CHAVE_COFRE);
    try {
      return abrirTexto(doCofre);
    } catch (e) {
      casca.avisar((e as Error).message, 6000);
    }
  }
  if (location.hash === "#peca-do-cad") {
    history.replaceState(null, "", location.pathname + location.search);
    if (await pecaDoCad(false)) return;
  }
  try {
    const a = await (await db()).ler<{ texto: string }>("estudos", "autosave");
    if (a) abrirTexto(a.texto, false);
  } catch {
    /* sem autosave */
  }
  atualizarTudo();
}

function abrirTexto(texto: string, guardar = true) {
  const r = desserializar(texto);
  pararSimulacao();
  estudo = r.estudo;
  malha = r.malha;
  invalidar(false);
  if (guardar) autosave();
}

/** Peça mandada pelo WJCAD (menu Arquivo → Abrir no WJFlow). */
async function pecaDoCad(avisarSeFaltar = true): Promise<boolean> {
  const p = await (await db()).ler<{ nome: string; vertices: Float32Array; triangulos: Uint32Array }>("estudos", "do-cad").catch(() => undefined);
  if (!p) {
    if (avisarSeFaltar) casca.avisar("Nenhuma peça recebida do WJCAD. No WJCAD, use o menu Arquivo → Abrir no WJFlow.", 6000);
    return false;
  }
  usarPeca({ vertices: p.vertices, triangulos: p.triangulos }, p.nome, "wjcad", "mm");
  return true;
}

function usarPeca(m: Malha, nome: string, origem: Estudo["peca"]["origem"], unidade: Unidade) {
  pararSimulacao();
  malha = m;
  estudo.peca = { nome, origem, unidade };
  delete estudo.referencia;
  if (estudo.nome === estudoNovo().nome || !estudo.nome) estudo.nome = `Escoamento — ${nome}`;
  invalidar();
  casca.avisar(`Peça carregada: ${nome} (${fmt(m.triangulos.length / 3)} triângulos).`);
}

async function importarStl() {
  const a = await escolherArquivo(true);
  if (!a?.dados) return;
  try {
    usarPeca(lerStl(a.dados), a.nome.replace(/\.[^.]+$/, ""), "stl", estudo.peca.unidade);
  } catch (e) {
    casca.avisar((e as Error).message, 6000);
  }
}

/** Esfera em Re = 100: Cd de referência 1,09 (Schiller–Naumann). */
function validacaoEsfera() {
  const d = 0.1;
  const ar = propriedadesAr(20, 0);
  usarPeca(esfera(d / 2, [0, 0, 0], 32, 64), "Esfera de validação (Re 100)", "validacao", "m");
  Object.assign(estudo, { velocidade: +((100 * ar.nu) / d).toPrecision(5), temperatura: 20, altitude: 0, direcao: "+x", modo: "padrao", tunel: "amplo", travessias: 4, areaReferencia: undefined });
  estudo.referencia = { cd: (24 / 100) * (1 + 0.15 * 100 ** 0.687), fonte: "Schiller–Naumann (1933), esfera em Re 100" };
  estudo.nome = "Validação — esfera Re 100";
  invalidar();
}

// ---------------------------------------------------------------------------------------------
// preparo do túnel (worker)

function invalidar(guardar = true) {
  pararSimulacao(true);
  preparo = null;
  erroPreparo = "";
  if (guardar) {
    delete estudo.resultado;
    autosave();
  }
  atualizarTudo();
  agendarPreparo();
}

let preparoT = 0;
function agendarPreparo() {
  clearTimeout(preparoT);
  if (!malha) return;
  preparoT = window.setTimeout(() => void prepararAgora(), 250);
}

function prepararAgora(): Promise<Preparo | null> {
  if (preparo) return Promise.resolve(preparo);
  if (!malha) return Promise.resolve(null);
  if (preparando) return preparando;
  const pedido = JSON.stringify(estudo);
  casca.definirStatus("Montando o túnel e voxelizando a peça…");
  preparando = new Promise<Preparo | null>((ok) => {
    const w = new Worker(new URL("./preparo-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ preparo?: Preparo; erro?: string }>) => {
      w.terminate();
      preparando = null;
      if (JSON.stringify(estudo) !== pedido) return ok(prepararAgora()); // mudou no meio: refaz
      preparo = e.data.preparo ?? null;
      erroPreparo = e.data.erro ?? "";
      atualizarTudo();
      ok(preparo);
    };
    w.postMessage({ estudo, malha });
  });
  return preparando;
}

// ---------------------------------------------------------------------------------------------
// simulação

async function calcular() {
  if (sim?.rodando) return;
  if (!malha) return casca.avisar("Carregue uma peça: do WJCAD, de um arquivo STL ou a esfera de validação.", 5000);
  if (!gpu) {
    try {
      gpu = await abrirGpu();
    } catch (e) {
      erroGpu = (e as Error).message;
      return casca.avisar(erroGpu, 7000);
    }
  }
  const p = await prepararAgora();
  if (!p) return casca.avisar(erroPreparo || "Não foi possível montar o túnel.", 6000);
  if (!sim) {
    const { nx, ny, nz, tipo } = p.dominio;
    if (!cabe(gpu.device, nx * ny * nz, p.precisao)) return casca.avisar("Esta malha não cabe na memória de GPU liberada para o navegador. Use um modo menor.", 7000);
    const s = new LbmGpu(gpu.device, { nx, ny, nz, tau: p.tau, cs: CS, u: [U_REDE, 0, 0], precisao: p.precisao, tipo, esponja: p.esponja });
    s.ligarCanvas($<HTMLCanvasElement>("#fl-gpu"));
    sim = { s, hist: new Historico(), rodando: false, quadro: 0, porQuadro: 2, tMedida: performance.now(), pMedida: 0, ritmo: 0, instavel: false };
    aplicarCorte();
    delete estudo.resultado;
  }
  sim.rodando = true;
  sim.tMedida = performance.now();
  sim.pMedida = sim.s.passos;
  telaAtiva(true);
  void manterTelaAcesa();
  sim.quadro = requestAnimationFrame(laco);
  casca.renderizar();
}

function laco() {
  const m = sim;
  const p = preparo;
  if (!m || !m.rodando || !p) return;
  const t0 = performance.now();
  const k = Math.min(m.porQuadro, p.passosTotal - m.s.passos);
  m.s.avancar(k);
  m.s.desenhar();
  void m.s.forca().then((f) => {
    if (sim !== m) return;
    if (f) {
      if (!f.every(Number.isFinite)) m.instavel = true;
      else m.hist.adicionar(m.s.passos, f);
    }
    const agora = performance.now();
    // passos por quadro para ~25 quadros/s sem travar a interface
    const dt = agora - t0;
    m.porQuadro = Math.max(1, Math.min(80, Math.round(m.porQuadro * (dt < 34 ? 1.2 : dt > 50 ? 0.8 : 1))));
    if (agora - m.tMedida > 1500) {
      m.ritmo = (m.s.passos - m.pMedida) / ((agora - m.tMedida) / 1000);
      m.tMedida = agora;
      m.pMedida = m.s.passos;
      if (m.ritmo > 0) localStorage.setItem(CHAVE_MLUPS, String(Math.round((m.ritmo * m.s.n) / 1e6)));
    }
    if (agora - ultimosResultados > 250) {
      ultimosResultados = agora;
      atualizarResultados();
    }
    if (m.instavel) return concluir("O cálculo ficou instável (valores infinitos). Tente o modo Qualidade (malha mais fina) ou uma velocidade menor.");
    if (m.s.passos >= p.passosTotal) return concluir();
    if (m.rodando) m.quadro = requestAnimationFrame(laco);
  });
}

function concluir(erro?: string) {
  const m = sim!;
  const p = preparo!;
  m.rodando = false;
  telaAtiva(false);
  const media = m.hist.media(p.inicioMedia) ?? m.hist.forcas.at(-1);
  if (media) {
    const [cd, cl, cs] = coeficientes(media, p);
    estudo.resultado = { cd, cl, cs, forca: forcaReal(media, p), area: p.areaRef, re: p.re, travessias: m.s.passos / p.passosTravessia, data: new Date().toISOString(), instavel: !!erro || undefined };
    autosave();
  }
  navigator.vibrate?.(200);
  casca.avisar(erro ?? "Cálculo concluído. Resultados com média na última travessia.", 7000);
  atualizarResultados();
  casca.renderizar();
}

function pausar() {
  if (!sim?.rodando) return;
  sim.rodando = false;
  cancelAnimationFrame(sim.quadro);
  telaAtiva(false);
  atualizarResultados();
  casca.renderizar();
}

function pararSimulacao(descartar = true) {
  if (!sim) return;
  sim.rodando = false;
  cancelAnimationFrame(sim.quadro);
  if (descartar) {
    sim.s.destruir();
    sim = null;
    telaAtiva(false);
  }
}

function recomecar() {
  pararSimulacao(true);
  delete estudo.resultado;
  atualizarTudo();
  void calcular();
}

let travaTela: WakeLockSentinel | null = null;
async function manterTelaAcesa() {
  travaTela = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
}
function telaAtiva(rodando: boolean) {
  if (!rodando) {
    void travaTela?.release().catch(() => {});
    travaTela = null;
  }
}

// ---------------------------------------------------------------------------------------------
// corte

function aplicarCorte() {
  const p = preparo;
  if (!p) return;
  const max = (corte.plano === 0 ? p.dominio.nz : p.dominio.ny) - 1;
  if (corte.indice < 0 || corte.indice > max) corte.indice = Math.floor(max / 2);
  const ind = $<HTMLInputElement>("#fl-indice");
  ind.max = String(max);
  ind.value = String(corte.indice);
  sim?.s.definirCorte({ plano: corte.plano, indice: corte.indice, grandeza: corte.grandeza, escala: 1 / U_REDE, escalaVort: p.dominio.celulasNoCorpo / (8 * U_REDE) });
  sim?.s.desenhar();
  desenharPrevia();
  legenda();
}

function legenda() {
  const seq = "linear-gradient(90deg, #2e4dbf, #33b3d9, #66cc59, #fad140, #d9382e)";
  const div = "linear-gradient(90deg, #2b54c7, #f7f7f7, #d6301f)";
  const L: Record<Grandeza, [string, string, string]> = {
    velocidade: ["0", "1,5 × U∞", seq],
    ux: ["−1,5 U∞ (contra o ar)", "+1,5 U∞", div],
    cp: ["Cp −1,5 (sucção)", "Cp +1,5 (pressão)", div],
    vorticidade: ["giro horário", "giro anti-horário", div],
  };
  const [a, b, g] = L[corte.grandeza];
  $("#fl-leg-min").textContent = a;
  $("#fl-leg-max").textContent = b;
  $("#fl-leg-barra").style.background = g;
}

/** Antes de calcular: a peça voxelizada no plano do corte (cinza) dentro do túnel. */
function desenharPrevia() {
  const cv = $<HTMLCanvasElement>("#fl-previa");
  const gpuCv = $<HTMLCanvasElement>("#fl-gpu");
  const comSim = !!sim;
  gpuCv.hidden = !comSim;
  cv.hidden = comSim;
  const vazio = $("#fl-vazio");
  if (!malha) {
    vazio.innerHTML = `Carregue uma peça para começar:<br><b>Peça do WJCAD</b> (no WJCAD: menu Arquivo → Abrir no WJFlow), <b>Importar STL</b> ou a <b>Esfera de validação</b>.`;
    cv.width = 0;
    return;
  }
  if (!preparo) {
    vazio.textContent = erroPreparo || "Montando o túnel…";
    return;
  }
  vazio.textContent = "";
  if (comSim) return;
  const { nx, ny, nz, tipo } = preparo.dominio;
  const h = corte.plano === 0 ? ny : nz;
  cv.width = nx;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(nx, h);
  const esp = preparo.esponja.x0;
  for (let r = 0; r < h; r++) {
    for (let x = 0; x < nx; x++) {
      const y = corte.plano === 0 ? ny - 1 - r : corte.indice;
      const z = corte.plano === 0 ? corte.indice : r;
      const c = x + nx * (y + ny * z);
      const o = 4 * (r * nx + x);
      const solido = (tipo[c] & 3) === SOLIDO;
      const cor = solido ? [138, 147, 158] : x > esp ? [232, 236, 241] : [248, 250, 252];
      img.data.set([...cor, 255], o);
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------------------------
// painel do estudo

function campo(rotulo: string, html: string) {
  return `<label class="fl-campo"><span>${rotulo}</span>${html}</label>`;
}

function renderizarPainel() {
  const e = estudo;
  const desab = sim?.rodando ? " disabled" : "";
  const opcoes = (lista: [string, string][], v: string) => lista.map(([k, r]) => `<option value="${k}"${k === v ? " selected" : ""}>${escapar(r)}</option>`).join("");
  const p = preparo;
  const ar = propriedadesAr(e.temperatura, e.altitude);
  let info = "";
  if (p) {
    const { nx, ny, nz } = p.dominio;
    const n = nx * ny * nz;
    const tempo = (p.passosTotal * n) / (mlupsDoAparelho() * 1e6);
    info = `<h3>Túnel</h3><dl class="fl-info">
      <dt>Malha</dt><dd>${nx} × ${ny} × ${nz} = ${fmt(n / 1e6, 2)} M células</dd>
      <dt>Célula</dt><dd>${sig(p.dx * 1000)} mm · ${fmt(p.dominio.celulasNoCorpo, 0)} células no comprimento da peça</dd>
      <dt>Memória da GPU</dt><dd>${fmt((n * bytesPorCelula(p.precisao)) / 1048576)} MB (${p.precisao.toUpperCase()})</dd>
      <dt>Reynolds</dt><dd>${sig(p.re)} (comprimento ${sig(p.comprimento * 1000)} mm)</dd>
      <dt>Mach</dt><dd>${fmt(p.mach, 3)}</dd>
      <dt>Passos</dt><dd>${fmt(p.passosTotal)} (${e.travessias} travessias de ${fmt(p.passosTravessia)})</dd>
      <dt>Tempo estimado</dt><dd>~${minutos(tempo)} a ${fmt(mlupsDoAparelho())} MLUPS</dd>
      <dt>Área de referência</dt><dd>${sig(p.areaRef * 1e4)} cm² ${e.areaReferencia ? "(informada)" : "(frontal)"}</dd>
    </dl>
    ${p.mach > 0.3 ? `<p class="fl-alerta">Mach acima de 0,3: o ar se comprime e o resultado (ar incompressível) perde validade.</p>` : ""}
    ${p.dominio.colunasSuspeitas > 0 ? `<p class="fl-alerta">A malha da peça parece aberta (${p.dominio.colunasSuspeitas} colunas com cruzamento ímpar): confira se o sólido é fechado.</p>` : ""}
    ${p.dominio.celulasNoCorpo < 20 ? `<p class="fl-alerta">Poucas células na peça: use um modo de malha maior para ver detalhes.</p>` : ""}
    ${p.reCelula > 1000 ? `<p class="fl-alerta">Camada limite muito fina para esta malha (Re da célula ${sig(p.reCelula)}): o padrão do escoamento é confiável; o Cd absoluto, aproximado (ver especificação §3.3).</p>` : ""}`;
  } else if (erroPreparo) info = `<p class="fl-alerta">${escapar(erroPreparo)}</p>`;
  $("#fl-painel").innerHTML = `
    <h3>Peça</h3>
    <div class="fl-peca">${malha ? `<strong>${escapar(e.peca.nome)}</strong><br>${fmt(malha.triangulos.length / 3)} triângulos · origem: ${e.peca.origem === "wjcad" ? "WJCAD" : e.peca.origem === "stl" ? "STL" : "validação"}` : "Nenhuma peça carregada."}</div>
    ${campo("Unidade da peça", `<select data-c="unidade"${desab}>${opcoes((Object.keys(UNIDADES) as Unidade[]).map((u) => [u, u === "pol" ? "polegada" : u]), e.peca.unidade)}</select>`)}
    ${campo("Direção do ar", `<select data-c="direcao"${desab}>${opcoes(DIRECOES, e.direcao)}</select>`)}
    <h3>Ar</h3>
    ${campo("Velocidade (m/s)", `<input data-c="velocidade" type="number" min="0.001" step="any" value="${e.velocidade}"${desab}>`)}
    ${campo("Temperatura (°C)", `<input data-c="temperatura" type="number" step="any" value="${e.temperatura}"${desab}>`)}
    ${campo("Altitude (m)", `<input data-c="altitude" type="number" step="any" value="${e.altitude}"${desab}>`)}
    <dl class="fl-info"><dt>Densidade</dt><dd>${fmt(ar.rho, 3)} kg/m³</dd><dt>Viscosidade</dt><dd>${sig(ar.nu * 1e6)}·10⁻⁶ m²/s</dd></dl>
    <h3>Cálculo</h3>
    ${campo("Malha", `<select data-c="modo"${desab}>${opcoes((Object.keys(MODOS) as Modo[]).map((m) => [m, MODOS[m].nome]), e.modo)}</select>`)}
    ${campo("Túnel", `<select data-c="tunel"${desab}>${opcoes((Object.keys(TUNEIS) as Tunel[]).map((t) => [t, TUNEIS[t].nome]), e.tunel ?? "padrao")}</select>`)}
    ${campo("Travessias", `<input data-c="travessias" type="number" min="1" max="20" step="1" value="${e.travessias}"${desab}>`)}
    ${campo("Área de referência (cm²)", `<input data-c="area" type="number" min="0" step="any" placeholder="frontal" value="${e.areaReferencia ? e.areaReferencia * 1e4 : ""}"${desab}>`)}
    ${info}`;
  $("#fl-painel").querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-c]").forEach((x) => {
    x.onchange = () => {
      const v = x.value;
      switch (x.dataset.c) {
        case "unidade": e.peca.unidade = v as Unidade; break;
        case "direcao": e.direcao = v as Direcao; break;
        case "velocidade": e.velocidade = Math.max(1e-6, +v || e.velocidade); break;
        case "temperatura": e.temperatura = +v; break;
        case "altitude": e.altitude = +v; break;
        case "modo": e.modo = v as Modo; break;
        case "tunel": e.tunel = v as Tunel; break;
        case "travessias": e.travessias = Math.max(1, Math.min(20, Math.round(+v) || 3)); break;
        case "area": e.areaReferencia = +v > 0 ? +v / 1e4 : undefined; break;
      }
      delete e.referencia;
      invalidar();
    };
  });
}

// ---------------------------------------------------------------------------------------------
// resultados

function atualizarResultados() {
  const alvo = $("#fl-resultados");
  const p = preparo;
  const r = estudo.resultado;
  const m = sim;
  const cartoes: string[] = [];
  if (m && p) {
    const frac = Math.min(1, m.s.passos / p.passosTotal);
    const restante = m.ritmo > 0 ? (p.passosTotal - m.s.passos) / m.ritmo : NaN;
    cartoes.push(`<div class="fl-progresso">${m.rodando ? "Calculando" : frac >= 1 ? "Concluído" : "Pausado"} · travessia ${fmt(m.s.passos / p.passosTravessia, 2)} de ${estudo.travessias} · ${fmt(100 * frac)} %${m.rodando && Number.isFinite(restante) ? ` · faltam ~${minutos(restante)}` : ""}${m.ritmo ? ` · ${fmt(m.ritmo, 1)} passos/s (${fmt((m.ritmo * m.s.n) / 1e6, 1)} MLUPS)` : ""}<div class="barra"><i style="width:${100 * frac}%"></i></div></div>`);
  }
  const ultima = m?.hist.forcas.at(-1);
  const media = m && p ? m.hist.media(p.inicioMedia) : null;
  const mostrar = media ?? (r ? null : ultima);
  if (p && (mostrar || r)) {
    const c = mostrar ? coeficientes(mostrar, p) : [r!.cd, r!.cl, r!.cs];
    const fN = mostrar ? forcaReal(mostrar, p) : r!.forca;
    const tipo = media || r ? "média da última travessia" : "instantâneo (a média começa na última travessia)";
    const ref = estudo.referencia;
    cartoes.push(
      `<div class="fl-cartao"><small>Cd · arrasto</small><b>${fmt(c[0], 3)}</b><em>${tipo}${ref ? ` · referência ${fmt(ref.cd, 2)} (${fmt((100 * (c[0] - ref.cd)) / ref.cd, 1)} %)` : ""}</em></div>`,
      `<div class="fl-cartao"><small>Cl · sustentação (+Y)</small><b>${fmt(c[1], 3)}</b></div>`,
      `<div class="fl-cartao"><small>Cs · lateral (+Z)</small><b>${fmt(c[2], 3)}</b></div>`,
      `<div class="fl-cartao"><small>Força de arrasto</small><b>${sig(fN[0])} N</b><em>sustentação ${sig(fN[1])} N · lateral ${sig(fN[2])} N</em></div>`,
    );
  } else if (r && !p) {
    cartoes.push(`<div class="fl-cartao"><small>Último resultado salvo</small><b>Cd ${fmt(r.cd, 3)}</b><em>Cl ${fmt(r.cl, 3)} · Re ${sig(r.re)}</em></div>`);
  }
  if (m && m.hist.passos.length > 1 && p) cartoes.push(`<div class="fl-cartao fl-grafico"><small>Cd ao longo do cálculo (faixa clara: média)</small><canvas id="fl-graf"></canvas></div>`);
  alvo.innerHTML = cartoes.join("");
  if (m && p && m.hist.passos.length > 1) grafico($<HTMLCanvasElement>("#fl-graf"), m.hist, p);
}

function grafico(cv: HTMLCanvasElement, h: Historico, p: Preparo) {
  const w = (cv.width = cv.clientWidth * devicePixelRatio);
  const hh = (cv.height = 120 * devicePixelRatio);
  const ctx = cv.getContext("2d")!;
  const cds = h.forcas.map((f) => coeficientes(f, p)[0]);
  // escala robusta: ignora o pico da partida impulsiva
  const meio = cds.slice(Math.floor(cds.length / 4));
  let lo = Math.min(...meio), hi = Math.max(...meio);
  if (hi - lo < 1e-6) (hi += 0.5), (lo -= 0.5);
  const pad = 0.1 * (hi - lo);
  lo -= pad;
  hi += pad;
  const X = (ps: number) => (ps / p.passosTotal) * w;
  const Y = (v: number) => hh - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * hh;
  ctx.fillStyle = "rgba(47,127,208,0.08)";
  ctx.fillRect(X(p.inicioMedia), 0, w - X(p.inicioMedia), hh);
  if (estudo.referencia) {
    ctx.strokeStyle = "#2e8b57";
    ctx.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]);
    ctx.beginPath();
    ctx.moveTo(0, Y(estudo.referencia.cd));
    ctx.lineTo(w, Y(estudo.referencia.cd));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = "#2f7fd0";
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.beginPath();
  cds.forEach((v, i) => (i ? ctx.lineTo(X(h.passos[i]), Y(v)) : ctx.moveTo(X(h.passos[i]), Y(v))));
  ctx.stroke();
  ctx.fillStyle = "#5e6b78";
  ctx.font = `${11 * devicePixelRatio}px system-ui`;
  ctx.fillText(fmt(hi, 2), 4, 12 * devicePixelRatio);
  ctx.fillText(fmt(lo, 2), 4, hh - 4);
}

function textoResultados(): string {
  const e = estudo, r = e.resultado, p = preparo;
  const L = [`WJFlow — ${e.nome}`, `Peça: ${e.peca.nome} (${e.peca.origem}), ar em ${e.direcao}, ${sig(e.velocidade)} m/s, ${e.temperatura} °C, ${e.altitude} m`];
  if (p) L.push(`Túnel: ${p.dominio.nx}×${p.dominio.ny}×${p.dominio.nz}, célula ${sig(p.dx * 1000)} mm, ${fmt(p.dominio.celulasNoCorpo)} células na peça, Re ${sig(p.re)}, Mach ${fmt(p.mach, 3)}`);
  if (r) {
    L.push(`Cd ${fmt(r.cd, 4)} · Cl ${fmt(r.cl, 4)} · Cs ${fmt(r.cs, 4)} (área de referência ${sig(r.area * 1e4)} cm²)`);
    L.push(`Forças: arrasto ${sig(r.forca[0])} N · sustentação ${sig(r.forca[1])} N · lateral ${sig(r.forca[2])} N`);
    if (e.referencia) L.push(`Referência: Cd ${fmt(e.referencia.cd, 3)} — ${e.referencia.fonte} (diferença ${fmt((100 * (r.cd - e.referencia.cd)) / e.referencia.cd, 1)} %)`);
    if (r.instavel) L.push("Atenção: o cálculo ficou instável antes do fim.");
  } else L.push("Sem resultado (calcule o estudo).");
  if (sim) L.push(`Ritmo: ${fmt(sim.ritmo, 1)} passos/s, ${fmt((sim.ritmo * sim.s.n) / 1e6, 1)} MLUPS`);
  return L.join("\n");
}

// ---------------------------------------------------------------------------------------------
// casca

function atualizarTudo() {
  renderizarPainel();
  aplicarCorte();
  desenharPrevia();
  atualizarResultados();
  casca.renderizar();
  casca.definirStatus(
    sim?.rodando ? "Calculando…" : preparo ? `Pronto · ${preparo.dominio.nx}×${preparo.dominio.ny}×${preparo.dominio.nz}` : malha ? "Montando o túnel…" : "Sem peça",
  );
}

const casca: Casca = new Casca({
  app: "WJFlow",
  icone: "",
  extensao: "wjflow",
  nomeDoc: () => estudo.nome,
  renomear: (n) => {
    estudo.nome = n;
    autosave();
    casca.renderizar();
  },
  novo: () => {
    pararSimulacao();
    estudo = estudoNovo();
    malha = null;
    invalidar();
  },
  abrir: () =>
    void escolherArquivo().then((a) => {
      if (!a?.texto) return;
      try {
        abrirTexto(a.texto);
      } catch (e) {
        casca.avisar((e as Error).message, 6000);
      }
    }),
  salvar: () => {
    casca.avisar("Salvando no cofre…");
    salvarArquivo(serializar(estudo, malha), estudo.nome, "wjflow");
  },
  abas: [
    {
      id: "estudo", rotulo: "Estudo", grupos: [
        [
          { id: "cad", rotulo: "Peça do WJCAD", icone: "peca", dica: "Última peça mandada pelo WJCAD (menu Arquivo → Abrir no WJFlow)", acao: () => void pecaDoCad() },
          { id: "stl", rotulo: "Importar STL", icone: "importar", acao: () => void importarStl() },
        ],
        [{ id: "val", rotulo: "Esfera de validação", icone: "validar", dica: "Esfera em Re 100: compara o Cd com a referência da literatura", acao: validacaoEsfera }],
        [{ id: "aparelho", rotulo: "Teste do aparelho", icone: "aparelho", dica: "Autoverificação da GPU e medição de desempenho", acao: () => (location.href = "aparelho/") }],
      ],
    },
    {
      id: "calcular", rotulo: "Calcular", grupos: [
        [
          { id: "rodar", rotulo: "Calcular", icone: "rodar", dica: "Calcular (ou continuar depois de pausar)", acao: () => void calcular(), desabilitado: () => !!sim?.rodando || !malha },
          { id: "pausar", rotulo: "Pausar", icone: "pausar", acao: pausar, desabilitado: () => !sim?.rodando },
          { id: "recomecar", rotulo: "Recomeçar", icone: "recomecar", acao: recomecar, desabilitado: () => !sim },
        ],
      ],
    },
    {
      id: "resultados", rotulo: "Resultados", grupos: [
        [
          { id: "copiar", rotulo: "Copiar resultados", icone: "copiar", acao: () => void navigator.clipboard.writeText(textoResultados()).then(() => casca.avisar("Resultados copiados.")) },
          { id: "csv", rotulo: "Histórico (CSV)", icone: "exportar", dica: "Forças e coeficientes ao longo do cálculo", acao: () => (sim && preparo ? baixar(sim.hist.csv(preparo), estudo.nome, "csv", "text/csv") : casca.avisar("Calcule o estudo primeiro.")) },
        ],
      ],
    },
  ],
});

// controles do corte
$<HTMLSelectElement>("#fl-grandeza").innerHTML = GRANDEZAS.map(([g, r]) => `<option value="${g}">${escapar(r)}</option>`).join("");
$<HTMLSelectElement>("#fl-plano").onchange = (e) => {
  corte.plano = +(e.target as HTMLSelectElement).value as Plano;
  corte.indice = -1;
  aplicarCorte();
};
$<HTMLSelectElement>("#fl-grandeza").onchange = (e) => {
  corte.grandeza = (e.target as HTMLSelectElement).value as Grandeza;
  aplicarCorte();
};
$<HTMLInputElement>("#fl-indice").oninput = (e) => {
  corte.indice = +(e.target as HTMLInputElement).value;
  aplicarCorte();
};
addEventListener("resize", () => sim && preparo && atualizarResultados());

registrarMetrica("WJFlow", () => (sim ? `${fmt(sim.ritmo, 1)} passos/s · ${fmt((sim.ritmo * sim.s.n) / 1e6, 1)} MLUPS · passo ${fmt(sim.s.passos)}` : "parado"));
registrarOffline();
void carregarInicial();
