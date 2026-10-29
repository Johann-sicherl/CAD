// Escrita à mão (S Pen ou dedo) com transcrição ao vivo para texto digitado.
// Reconhecedores, na ordem:
//  1. o do próprio navegador (Handwriting Recognition API, quando o aparelho tem: offline);
//  2. o serviço de escrita à mão do Google (online: os traços vão para o Google, o texto volta).
// Sem nenhum dos dois (sem internet), o campo de texto continua valendo: no Galaxy Tab, a
// "S Pen para texto" do próprio tablet escreve direto nele.

export type Traco = [number[], number[], number[]]; // xs, ys, tempos (ms)

export interface Reconhecedor {
  nome: string;
  reconhecer(tracos: Traco[], largura: number, altura: number): Promise<string[]>;
}

// ---------- 1. reconhecedor do navegador ----------

interface PontoNativo {
  x: number;
  y: number;
  t: number;
}
type NavComEscrita = Navigator & {
  createHandwritingRecognizer?(o: { languages: string[] }): Promise<{
    startDrawing(o: { recognitionType?: string; inputType?: string; alternatives?: number }): {
      addStroke(s: unknown): void;
      getPrediction(): Promise<{ text: string }[]>;
      clear(): void;
    };
  }>;
  queryHandwritingRecognizer?(o: { languages: string[] }): Promise<unknown>;
};

async function reconhecedorNativo(): Promise<Reconhecedor | null> {
  const nav = navigator as NavComEscrita;
  const Traco = (globalThis as unknown as { HandwritingStroke?: new () => { addPoint(p: PontoNativo): void } }).HandwritingStroke;
  if (!nav.createHandwritingRecognizer || !nav.queryHandwritingRecognizer || !Traco) return null;
  for (const lingua of ["pt-BR", "pt"]) {
    try {
      if (!(await nav.queryHandwritingRecognizer({ languages: [lingua] }))) continue;
      const r = await nav.createHandwritingRecognizer({ languages: [lingua] });
      return {
        nome: "reconhecimento do aparelho",
        async reconhecer(tracos) {
          const d = r.startDrawing({ recognitionType: "text", inputType: "stylus", alternatives: 4 });
          for (const [xs, ys, ts] of tracos) {
            const s = new Traco();
            xs.forEach((x, k) => s.addPoint({ x, y: ys[k], t: ts[k] }));
            d.addStroke(s);
          }
          const p = await d.getPrediction();
          d.clear();
          return p.map((x) => x.text);
        },
      };
    } catch {
      /* tenta a próxima língua / o online */
    }
  }
  return null;
}

// ---------- 2. serviço online do Google ----------

const URL_GOOGLE = "https://inputtools.google.com/request?ime=handwriting&app=wjtaskplan&cs=1&oe=UTF-8";

const reconhecedorGoogle: Reconhecedor = {
  nome: "reconhecimento online do Google",
  async reconhecer(tracos, largura, altura) {
    const r = await fetch(URL_GOOGLE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options: "enable_pre_space", requests: [{ writing_guide: { writing_area_width: Math.round(largura), writing_area_height: Math.round(altura) }, ink: tracos, language: "pt_BR" }] }),
    });
    const j = (await r.json()) as [string, [string, string[]][]];
    if (j[0] !== "SUCCESS") throw new Error("o serviço de escrita não respondeu");
    return j[1]?.[0]?.[1] ?? [];
  },
};

let escolhido: Promise<Reconhecedor | null> | null = null;
let online = true;
/** Liga/desliga o uso do serviço online (Configurações). */
export function permitirOnline(v: boolean) {
  online = v;
  escolhido = null;
}
/** Reconhecedor disponível neste aparelho (o do navegador primeiro; o online, se permitido). */
export function reconhecedor(): Promise<Reconhecedor | null> {
  return (escolhido ??= reconhecedorNativo().then((n) => n ?? (online ? reconhecedorGoogle : null)));
}

// ---------- área de escrita ----------

export interface AreaEscrita {
  /** apaga a tinta (o texto já transcrito continua no campo) */
  limpar(): void;
  desfazer(): void;
  vazia(): boolean;
  /** troca o texto reconhecido por uma alternativa */
  escolher(alternativa: string): void;
  /** termina o reconhecimento pendente (antes do OK) */
  concluir(): Promise<void>;
}

/**
 * Liga um <canvas> de escrita a um campo de texto. A cada pausa na escrita, a tinta toda é
 * reconhecida e o campo mostra `texto já confirmado + reconhecido`; as alternativas vão para
 * `aoAlternativas`. Quando a caneta está em uso, o toque do dedo/palma na área é ignorado.
 */
export function areaEscrita(tela: HTMLCanvasElement, campo: HTMLInputElement, aoAlternativas: (a: string[]) => void, aoSituacao: (s: string) => void): AreaEscrita {
  const ctx = tela.getContext("2d")!;
  const tracos: Traco[] = [];
  let atual: Traco | null = null;
  let t0 = 0;
  let caneta = false;
  let pausa = 0;
  let agendado = false;
  let pendente: Promise<void> = Promise.resolve();
  let seq = 0;
  /** texto antes da tinta atual (digitado ou de tintas já confirmadas) */
  let base = campo.value;
  let reconhecido = "";

  const ajustar = () => {
    const r = tela.getBoundingClientRect();
    const k = devicePixelRatio || 1;
    tela.width = Math.round(r.width * k);
    tela.height = Math.round(r.height * k);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    desenhar();
  };
  const desenhar = () => {
    const r = tela.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    // pauta (linha de base) para ajudar a escrever reto
    ctx.strokeStyle = "#d5dbe1";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(12, r.height * 0.72);
    ctx.lineTo(r.width - 12, r.height * 0.72);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#1e2730";
    ctx.lineWidth = 2.6;
    ctx.lineCap = ctx.lineJoin = "round";
    for (const [xs, ys] of tracos) {
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let k = 1; k < xs.length; k++) ctx.lineTo(xs[k], ys[k]);
      if (xs.length === 1) ctx.lineTo(xs[0] + 0.1, ys[0]);
      ctx.stroke();
    }
  };
  const mostrar = () => {
    campo.value = (base && reconhecido && !/\s$/.test(base) ? `${base} ` : base) + reconhecido;
  };

  const reconhecer = async () => {
    const n = ++seq;
    if (!tracos.length) {
      reconhecido = "";
      mostrar();
      aoAlternativas([]);
      return;
    }
    const r = await reconhecedor();
    if (!r) return aoSituacao("Sem reconhecimento de escrita neste aparelho: digite ou use a S Pen direto no campo.");
    if (r === reconhecedorGoogle && !navigator.onLine) return aoSituacao("Sem internet: o reconhecimento online não está disponível. Escreva direto no campo (S Pen para texto) ou digite.");
    aoSituacao("Reconhecendo…");
    try {
      const alts = await r.reconhecer(tracos, tela.clientWidth, tela.clientHeight);
      if (n !== seq) return; // chegou tinta nova: vale o próximo resultado
      reconhecido = (alts[0] ?? "").trim();
      mostrar();
      aoAlternativas(alts.slice(0, 5).map((a) => a.trim()).filter((a, k, v) => a && v.indexOf(a) === k));
      aoSituacao(`Transcrito pelo ${r.nome}.`);
    } catch {
      if (n === seq) aoSituacao("Não foi possível reconhecer agora (sem internet?). Escreva direto no campo ou digite.");
    }
  };
  const agendar = () => {
    clearTimeout(pausa);
    agendado = true;
    pausa = window.setTimeout(() => {
      agendado = false;
      pendente = reconhecer();
    }, 450);
  };

  const ponto = (e: PointerEvent): [number, number] => {
    const r = tela.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  tela.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "pen") caneta = true;
    else if (caneta && e.pointerType === "touch") return; // palma da mão com a caneta em uso
    if (e.button > 0) return;
    e.preventDefault();
    tela.setPointerCapture(e.pointerId);
    clearTimeout(pausa);
    if (!tracos.length) {
      t0 = e.timeStamp;
      base = campo.value; // o que foi digitado antes de começar a escrever fica
      reconhecido = "";
    }
    const [x, y] = ponto(e);
    atual = [[x], [y], [Math.round(e.timeStamp - t0)]];
    tracos.push(atual);
    desenhar();
  });
  tela.addEventListener("pointermove", (e) => {
    if (!atual || !tela.hasPointerCapture(e.pointerId)) return;
    const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
    const [xs, ys, ts] = atual;
    const r = tela.getBoundingClientRect();
    for (const c of evs.length ? evs : [e]) {
      xs.push(c.clientX - r.left);
      ys.push(c.clientY - r.top);
      ts.push(Math.round(c.timeStamp - t0));
    }
    // só o trecho novo (sem redesenhar tudo a cada ponto)
    const k = xs.length;
    ctx.beginPath();
    ctx.moveTo(xs[Math.max(0, k - evs.length - 1)], ys[Math.max(0, k - evs.length - 1)]);
    for (let j = Math.max(0, k - evs.length); j < k; j++) ctx.lineTo(xs[j], ys[j]);
    ctx.stroke();
  });
  const soltar = () => {
    if (!atual) return;
    atual = null;
    agendar();
  };
  tela.addEventListener("pointerup", soltar);
  tela.addEventListener("pointercancel", soltar);
  // digitou no campo: o texto digitado vira a base e a tinta é descartada
  campo.addEventListener("input", () => {
    seq++;
    tracos.length = 0;
    base = campo.value;
    reconhecido = "";
    aoAlternativas([]);
    desenhar();
  });

  new ResizeObserver(ajustar).observe(tela);
  return {
    limpar() {
      // confirma o texto atual e libera a área para continuar escrevendo
      seq++;
      clearTimeout(pausa);
      base = campo.value;
      reconhecido = "";
      tracos.length = 0;
      aoAlternativas([]);
      desenhar();
    },
    desfazer() {
      tracos.pop();
      desenhar();
      agendar();
    },
    vazia: () => !tracos.length,
    escolher(a) {
      reconhecido = a;
      mostrar();
    },
    concluir() {
      if (agendado) {
        clearTimeout(pausa);
        agendado = false;
        pendente = reconhecer();
      }
      return pendente;
    },
  };
}
