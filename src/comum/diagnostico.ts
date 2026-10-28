// Diagnóstico do aparelho (ferramenta do Johann): janela flutuante com memória, processamento,
// GPU, armazenamento, rede, bateria e métricas de cada app. Vale para todas as páginas do
// WJProMaster. Fica escondida de quem não ligou o modo diagnóstico neste aparelho:
//   abrir qualquer página com ?diag=1 liga (fica guardado), ?diag=0 desliga.
// Custo zero com a janela fechada: a coleta (1×/s, quadros e tarefas longas) só roda com ela
// aberta e para quando a aba sai de vista.
// O navegador não deixa ler a RAM real, o uso de cada núcleo nem temperaturas (privacidade);
// a janela mostra o que a página pode medir e diz quando algo não está disponível.

const CHAVE = "wj:diagnostico";
const metricas = new Map<string, () => string | null>();

/** Métrica própria de um app (ex.: tempo de reconstrução do WJCAD), lida 1×/s com a janela aberta. */
export function registrarMetrica(nome: string, ler: () => string | null) {
  metricas.set(nome, ler);
}

/** Lê ?diag=1 / ?diag=0 da URL (e tira o parâmetro dela) e devolve se o modo está ligado. */
export function diagnosticoAtivo(): boolean {
  try {
    const u = new URL(location.href);
    const d = u.searchParams.get("diag");
    if (d !== null) {
      if (d === "0") localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, "1");
      u.searchParams.delete("diag");
      history.replaceState(history.state, "", u.href);
    }
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

const ICONE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M6 13h3l2-4 2.5 7 2-3H18" stroke="#2f7fd0"/></svg>`;

/**
 * Botão da barra superior (null quando o modo diagnóstico está desligado neste aparelho).
 * `classe`: estilo de botão da própria página; sem ela, usa um estilo neutro.
 */
export function botaoDiagnostico(classe = ""): HTMLButtonElement | null {
  if (!diagnosticoAtivo()) return null;
  estilo();
  const b = document.createElement("button");
  b.className = classe || "wj-diag-bt";
  b.title = "Diagnóstico do aparelho";
  b.setAttribute("aria-label", "Diagnóstico do aparelho");
  b.innerHTML = ICONE;
  b.onclick = () => (painel ? fechar() : abrir());
  if (lerJson<{ aberto?: boolean }>("aberto")?.aberto) queueMicrotask(abrir);
  return b;
}

// ---------------------------------------------------------------------------------------------

interface Pressao { state: string }
interface ObservadorPressao { observe(fonte: string, o?: { sampleInterval?: number }): Promise<void>; disconnect(): void }
type NavExtra = Navigator & {
  deviceMemory?: number;
  connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  getBattery?: () => Promise<{ level: number; charging: boolean; chargingTime: number; dischargingTime: number }>;
  userAgentData?: { mobile: boolean; platform: string; getHighEntropyValues(h: string[]): Promise<Record<string, unknown>> };
};
const nav = navigator as NavExtra;

let painel: HTMLElement | null = null;
let corpo: HTMLElement;
let relogio = 0;
let quadro = 0;
let observadorTarefas: PerformanceObserver | null = null;
let observadorPressao: ObservadorPressao | null = null;
const estado = {
  quadros: 0,
  tQuadros: performance.now(),
  fps: 0,
  piorQuadro: 0,
  piorQuadroJanela: 0,
  atraso: 0,
  tarefas: [] as { fim: number; ms: number }[],
  pressao: "",
  memoriaPagina: "" as string,
  medindoMemoria: false,
  ultimaMedida: -Infinity,
  fixos: [] as [string, string][],
  armazenamento: "",
  bateria: "",
};

const fmt = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const mb = (b: number) => (b >= 1073741824 ? `${fmt(b / 1073741824, 2)} GB` : `${fmt(b / 1048576, b < 10485760 ? 1 : 0)} MB`);
const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

function lerJson<T>(k: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(`${CHAVE}:${k}`) ?? "null") as T;
  } catch {
    return null;
  }
}
function gravarJson(k: string, v: unknown) {
  try {
    localStorage.setItem(`${CHAVE}:${k}`, JSON.stringify(v));
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

function abrir() {
  if (painel) return;
  painel = document.createElement("section");
  painel.className = "wj-diag";
  painel.setAttribute("role", "dialog");
  painel.setAttribute("aria-label", "Diagnóstico do aparelho");
  painel.innerHTML = `<header><strong>Diagnóstico</strong><span></span><button data-a="copiar" title="Copiar tudo">Copiar</button><button data-a="fechar" title="Fechar">✕</button></header><div class="wj-diag-corpo">Medindo…</div>`;
  corpo = painel.querySelector(".wj-diag-corpo")!;
  painel.querySelector<HTMLElement>('[data-a="fechar"]')!.onclick = fechar;
  painel.querySelector<HTMLElement>('[data-a="copiar"]')!.onclick = (e) => void copiar(e.currentTarget as HTMLElement);
  arrastavel(painel, painel.querySelector("header")!);
  document.body.append(painel);
  const pos = lerJson<{ x: number; y: number }>("pos");
  posicionar(pos?.x ?? innerWidth - painel.offsetWidth - 12, pos?.y ?? 64);
  gravarJson("aberto", { aberto: true });
  void coletarFixos();
  iniciarColeta();
  document.addEventListener("visibilitychange", aoMudarVisibilidade);
}

function fechar() {
  pararColeta();
  document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  painel?.remove();
  painel = null;
  gravarJson("aberto", { aberto: false });
}

function aoMudarVisibilidade() {
  if (document.hidden) pararColeta();
  else iniciarColeta();
}

function iniciarColeta() {
  if (relogio) return;
  estado.tQuadros = performance.now();
  estado.quadros = 0;
  let ultimo = performance.now();
  const laco = (t: number) => {
    estado.quadros++;
    const dt = t - ultimo;
    if (dt > 0 && dt < 5000) estado.piorQuadroJanela = Math.max(estado.piorQuadroJanela, dt);
    ultimo = t;
    quadro = requestAnimationFrame(laco);
  };
  quadro = requestAnimationFrame(laco);
  // atraso da thread da interface: quanto um temporizador de 200 ms chega atrasado
  let esperado = performance.now() + 200;
  let piorAtraso = 0;
  const tique = () => {
    const agora = performance.now();
    piorAtraso = Math.max(piorAtraso, agora - esperado);
    esperado = agora + 200;
    if (agora - estado.tQuadros >= 1000) {
      estado.fps = (estado.quadros * 1000) / (agora - estado.tQuadros);
      estado.piorQuadro = estado.piorQuadroJanela;
      estado.piorQuadroJanela = 0;
      estado.quadros = 0;
      estado.tQuadros = agora;
      estado.atraso = Math.max(0, piorAtraso);
      piorAtraso = 0;
      void atualizar();
    }
  };
  relogio = window.setInterval(tique, 200);
  try {
    observadorTarefas = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) estado.tarefas.push({ fim: e.startTime + e.duration, ms: e.duration });
    });
    observadorTarefas.observe({ type: "longtask", buffered: true });
  } catch {
    observadorTarefas = null;
  }
  const PO = (window as unknown as { PressureObserver?: new (cb: (r: Pressao[]) => void) => ObservadorPressao }).PressureObserver;
  if (PO && !observadorPressao) {
    observadorPressao = new PO((r) => (estado.pressao = r.at(-1)?.state ?? ""));
    observadorPressao.observe("cpu", { sampleInterval: 1000 }).catch(() => (estado.pressao = "indisponível"));
  }
  void atualizar();
}

function pararColeta() {
  clearInterval(relogio);
  cancelAnimationFrame(quadro);
  relogio = 0;
  observadorTarefas?.disconnect();
  observadorTarefas = null;
  observadorPressao?.disconnect();
  observadorPressao = null;
}

/** Dados que não mudam (ou mudam pouco): aparelho, GPU, sistema. Lidos uma vez ao abrir. */
async function coletarFixos() {
  const f: [string, string][] = [];
  const ua = nav.userAgentData;
  if (ua) {
    try {
      const h = await ua.getHighEntropyValues(["model", "platformVersion", "fullVersionList"]);
      const chrome = (h.fullVersionList as { brand: string; version: string }[] | undefined)?.find((b) => /Chrom|Edge/.test(b.brand));
      f.push(["Aparelho", `${h.model || "(modelo não informado)"} · ${ua.platform} ${h.platformVersion ?? ""}`.trim()]);
      if (chrome) f.push(["Navegador", `${chrome.brand} ${chrome.version}`]);
    } catch {
      f.push(["Aparelho", ua.platform]);
    }
  }
  f.push(["Núcleos (lógicos)", `${navigator.hardwareConcurrency || "?"} · uso por núcleo: o navegador não informa`]);
  f.push(["RAM informada", nav.deviceMemory ? `≈ ${nav.deviceMemory} GB (o navegador arredonda e limita; não é a RAM real)` : "não informada"]);
  f.push(["Tela", `${screen.width}×${screen.height} · densidade ${fmt(devicePixelRatio, 2)} · janela ${innerWidth}×${innerHeight}`]);
  f.push(["Isolamento de origem", crossOriginIsolated ? "sim (várias threads no kernel)" : "não (kernel numa thread só)"]);
  try {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    const a = gpu ? await gpu.requestAdapter() : null;
    if (a) {
      const i = a.info;
      f.push(["GPU (WebGPU)", [i.vendor, i.architecture, i.description].filter(Boolean).join(" · ") || "disponível"]);
      f.push(["Limites da GPU", `${mb(a.limits.maxStorageBufferBindingSize)} por vínculo · ${mb(a.limits.maxBufferSize)} por buffer`]);
    } else f.push(["GPU (WebGPU)", gpu ? "sem adaptador liberado" : "indisponível neste navegador"]);
  } catch {
    f.push(["GPU (WebGPU)", "erro ao consultar"]);
  }
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) f.push(["GPU (WebGL)", String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))]);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* sem WebGL */
  }
  try {
    const sw = navigator.serviceWorker?.controller ? "ativo" : "não";
    const cache = (await caches.keys()).find((k) => k.startsWith("jlscad-"));
    f.push(["Modo offline", `service worker ${sw}${cache ? ` · versão ${cache.slice(7)}` : ""}`]);
  } catch {
    /* sem cache */
  }
  estado.fixos = f;
  void atualizar();
}

/** Coletas lentas: armazenamento, bateria e memória da página (a cada ~10 s). */
async function coletarLentos() {
  const agora = performance.now();
  if (agora - estado.ultimaMedida < 10000) return;
  estado.ultimaMedida = agora;
  try {
    const e = (await navigator.storage.estimate()) as StorageEstimate & { usageDetails?: Record<string, number> };
    const det = e.usageDetails ? Object.entries(e.usageDetails).map(([k, v]) => `${k === "indexedDB" ? "IndexedDB" : k === "caches" ? "cache offline" : k} ${mb(v)}`).join(" · ") : "";
    const persistente = (await navigator.storage.persisted?.()) ? " · protegido contra limpeza" : "";
    estado.armazenamento = `${mb(e.usage ?? 0)} usados de ${mb(e.quota ?? 0)} liberados ao site${persistente}${det ? `\n${det}` : ""}`;
  } catch {
    estado.armazenamento = "indisponível";
  }
  try {
    const b = await nav.getBattery?.();
    if (b) {
      const t = b.charging ? (Number.isFinite(b.chargingTime) && b.chargingTime > 0 ? ` · cheia em ${fmt(b.chargingTime / 60)} min` : "") : Number.isFinite(b.dischargingTime) ? ` · ${fmt(b.dischargingTime / 3600, 1)} h restantes` : "";
      estado.bateria = `${fmt(b.level * 100)} % · ${b.charging ? "carregando" : "na bateria"}${t}`;
    } else estado.bateria = "indisponível";
  } catch {
    estado.bateria = "indisponível";
  }
  const medir = (performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number; breakdown: { bytes: number; types: string[] }[] }> }).measureUserAgentSpecificMemory;
  if (crossOriginIsolated && medir && !estado.medindoMemoria) {
    estado.medindoMemoria = true;
    medir.call(performance).then((r) => {
      const porTipo = new Map<string, number>();
      for (const p of r.breakdown) for (const t of p.types.length ? p.types : ["outros"]) porTipo.set(t, (porTipo.get(t) ?? 0) + p.bytes / (p.types.length || 1));
      const det = [...porTipo].filter(([, v]) => v > 1048576).map(([t, v]) => `${t} ${mb(v)}`).join(" · ");
      estado.memoriaPagina = `${mb(r.bytes)}${det ? ` (${det})` : ""}`;
    }).catch(() => (estado.memoriaPagina = "indisponível")).finally(() => (estado.medindoMemoria = false));
  }
}

async function atualizar() {
  if (!painel) return;
  void coletarLentos();
  const agora = performance.now();
  estado.tarefas = estado.tarefas.filter((t) => agora - t.fim < 10000);
  const pm = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const con = nav.connection;
  const secoes: [string, [string, string][]][] = [
    ["Processamento", [
      ["Quadros", `${fmt(estado.fps)} por segundo · pior quadro ${fmt(estado.piorQuadro)} ms`],
      ["Atraso da interface", `${fmt(estado.atraso)} ms${estado.atraso > 100 ? " (engasgando)" : estado.atraso > 30 ? " (ocupada)" : " (folgada)"}`],
      ["Travamentos > 50 ms", estado.tarefas.length ? `${estado.tarefas.length} nos últimos 10 s · maior ${fmt(Math.max(...estado.tarefas.map((t) => t.ms)))} ms` : "nenhum nos últimos 10 s"],
      ["Pressão da CPU", estado.pressao ? traduzirPressao(estado.pressao) : "indisponível neste navegador/aparelho"],
    ]],
    ["Memória desta página", [
      ["Total medido", estado.memoriaPagina || (crossOriginIsolated ? "medindo… (o Chrome mede na próxima coleta de lixo, até ~20 s)" : "precisa de isolamento de origem")],
      ...(pm ? [["Heap JavaScript", `${mb(pm.usedJSHeapSize)} em uso · ${mb(pm.totalJSHeapSize)} reservados · limite ${mb(pm.jsHeapSizeLimit)}`] as [string, string]] : []),
    ]],
    ["Este app", [...metricas].map(([n, ler]) => {
      let v: string | null = null;
      try {
        v = ler();
      } catch {
        v = "erro";
      }
      return [n, v ?? "—"] as [string, string];
    })],
    ["Aparelho e navegador", estado.fixos],
    ["Armazenamento", [["No aparelho", estado.armazenamento || "medindo…"]]],
    ["Rede e energia", [
      ["Rede", `${navigator.onLine ? "online" : "OFFLINE"}${con ? ` · ${con.effectiveType ?? "?"} · ~${fmt(con.downlink ?? 0, 1)} Mb/s · latência ~${fmt(con.rtt ?? 0)} ms${con.saveData ? " · economia de dados" : ""}` : ""}`],
      ["Bateria", estado.bateria || "medindo…"],
    ]],
  ];
  corpo.innerHTML = secoes.filter(([, l]) => l.length).map(([t, l]) => `<h4>${t}</h4><dl>${l.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v).replace(/\n/g, "<br>")}</dd>`).join("")}</dl>`).join("");
  painel.querySelector("header span")!.textContent = new Date().toLocaleTimeString("pt-BR");
}

function traduzirPressao(s: string) {
  return ({ nominal: "normal", fair: "moderada", serious: "alta (pode estar esquentando)", critical: "crítica (o aparelho vai reduzir a velocidade)" } as Record<string, string>)[s] ?? s;
}

async function copiar(b: HTMLElement) {
  const texto = [`Diagnóstico WJProMaster — ${document.title} — ${new Date().toLocaleString("pt-BR")}`, corpo.innerText].join("\n");
  try {
    await navigator.clipboard.writeText(texto);
    b.textContent = "Copiado ✓";
  } catch {
    getSelection()?.selectAllChildren(corpo);
    b.textContent = "Selecionado";
  }
  setTimeout(() => (b.textContent = "Copiar"), 1800);
}

function posicionar(x: number, y: number) {
  if (!painel) return;
  const px = Math.max(4, Math.min(x, innerWidth - painel.offsetWidth - 4));
  const py = Math.max(4, Math.min(y, innerHeight - 48));
  painel.style.left = `${px}px`;
  painel.style.top = `${py}px`;
}

/** Arrastar pela barra de título (mouse, dedo ou caneta); a posição fica guardada. */
function arrastavel(alvo: HTMLElement, alca: HTMLElement) {
  alca.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = alvo.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    alca.setPointerCapture(e.pointerId);
    const mover = (m: PointerEvent) => posicionar(m.clientX - dx, m.clientY - dy);
    const soltar = () => {
      alca.removeEventListener("pointermove", mover);
      const q = alvo.getBoundingClientRect();
      gravarJson("pos", { x: q.left, y: q.top });
    };
    alca.addEventListener("pointermove", mover);
    alca.addEventListener("pointerup", soltar, { once: true });
    alca.addEventListener("pointercancel", soltar, { once: true });
  });
}

let estiloPronto = false;
function estilo() {
  if (estiloPronto) return;
  estiloPronto = true;
  const s = document.createElement("style");
  s.textContent = `
.wj-diag-bt { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; min-height: 40px; padding: 0 8px; border: 1px solid #d5dbe1; border-radius: 8px; background: #fff; color: #1e2730; cursor: pointer; }
.wj-diag-bt:hover { background: #f5f7f9; }
.wj-diag { position: fixed; z-index: 2147483000; width: min(340px, calc(100vw - 8px)); max-height: min(72vh, calc(100vh - 16px)); display: flex; flex-direction: column; background: rgba(255,255,255,0.97); color: #1e2730; border: 1px solid #b9c2cc; border-radius: 12px; box-shadow: 0 6px 24px rgba(30,45,60,0.22); font: 12.5px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.wj-diag header { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; border-bottom: 1px solid #d5dbe1; cursor: move; touch-action: none; user-select: none; }
.wj-diag header span { flex: 1; color: #5e6b78; font-variant-numeric: tabular-nums; }
.wj-diag header button { min-height: 32px; min-width: 32px; padding: 0 8px; border: 1px solid #d5dbe1; border-radius: 6px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
.wj-diag-corpo { overflow: auto; padding: 4px 12px 10px; }
.wj-diag h4 { margin: 8px 0 3px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #2f7fd0; }
.wj-diag dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0; }
.wj-diag dt { color: #5e6b78; }
.wj-diag dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }`;
  document.head.append(s);
}
