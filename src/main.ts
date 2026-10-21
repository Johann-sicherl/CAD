import "./style.css";
import { ClienteKernel } from "./kernel/cliente";
import type { ResultadoRegeneracao } from "./kernel/regenerar";
import {
  documentoExemplo,
  documentoVazio,
  novaFeature,
  ROTULO_TIPO,
  validarDocumento,
  type Documento,
  type Feature,
} from "./model";
import { renderizarPropriedades } from "./propriedades";
import { Viewport, type Vista } from "./viewport";

const CHAVE_AUTOSAVE = "cad-tablet:documento";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- estado ----------
let doc: Documento = carregarAutosave() ?? documentoExemplo();
let selecionada: string | null = null;
let errosPorFeature = new Map<string, string>();
const historico: string[] = [];
const refazer: string[] = [];
let primeiraRegeneracao = true;

const viewport = new Viewport($("viewport"));
const kernel = new ClienteKernel(aoRegenerar);

kernel.pronto
  .then(() => {
    $("carregando").remove();
    $("st-kernel").textContent = "Kernel: OpenCascade pronto";
    regenerar();
  })
  .catch((e) => {
    $("carregando").textContent = "Falha ao carregar o kernel: " + e.message;
    $("st-kernel").textContent = "Kernel: erro";
  });

// ---------- regeneração ----------
let temporizador: number | undefined;
function regenerar(atraso = 0) {
  clearTimeout(temporizador);
  temporizador = window.setTimeout(() => kernel.regenerar(doc.features), atraso);
}

function aoRegenerar(r: ResultadoRegeneracao, ms: number) {
  viewport.mostrarMalha(r.malha);
  if (primeiraRegeneracao && r.malha) {
    viewport.enquadrar(false);
    primeiraRegeneracao = false;
  }
  errosPorFeature = new Map(r.erros.map((e) => [e.id, e.mensagem]));
  $("st-volume").textContent =
    r.volume !== null ? `Volume: ${(r.volume / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm³` : "";
  $("st-tempo").textContent = `Regeneração: ${ms.toFixed(0)} ms`;
  renderizarArvore();
  // Atualiza só a mensagem de erro do painel, sem recriar os campos (não perde o foco)
  const painel = $("propriedades");
  const msgErro = selecionada ? errosPorFeature.get(selecionada) : undefined;
  let el = painel.querySelector<HTMLElement>(".prop-erro");
  if (msgErro && !el) {
    el = document.createElement("p");
    el.className = "prop-erro";
    painel.querySelector(".prop-cabecalho")?.after(el);
  }
  if (el) msgErro ? (el.textContent = msgErro) : el.remove();
}

// ---------- histórico (desfazer/refazer) ----------
function registrarPasso() {
  historico.push(JSON.stringify(doc));
  if (historico.length > 100) historico.shift();
  refazer.length = 0;
}

function alterou(final: boolean) {
  if (final) registrarPasso();
  salvarAutosave();
  regenerar(final ? 0 : 120);
  renderizarArvore();
}

function restaurar(json: string) {
  doc = JSON.parse(json);
  if (selecionada && !doc.features.some((f) => f.id === selecionada)) selecionada = null;
  $<HTMLInputElement>("nome-doc").value = doc.nome;
  salvarAutosave();
  renderizarTudo();
  regenerar();
}

$("btn-desfazer").onclick = () => {
  if (historico.length < 2) return;
  refazer.push(historico.pop()!);
  restaurar(historico[historico.length - 1]);
};
$("btn-refazer").onclick = () => {
  const p = refazer.pop();
  if (!p) return;
  historico.push(p);
  restaurar(p);
};

// ---------- árvore de features ----------
function renderizarArvore() {
  const lista = $("arvore");
  lista.innerHTML = "";
  doc.features.forEach((f, i) => {
    const li = document.createElement("li");
    li.className = "item";
    li.classList.toggle("ativo", f.id === selecionada);
    li.classList.toggle("suprimida", f.suprimida);
    li.classList.toggle("com-erro", errosPorFeature.has(f.id));
    const op = "operacao" in f && f.operacao === "cortar" ? " (corte)" : "";
    li.innerHTML = `
      <span class="item-num">${i + 1}</span>
      <span class="item-texto"><strong></strong><small>${ROTULO_TIPO[f.tipo]}${op}</small></span>
      <span class="item-mover">
        <button data-mover="-1" aria-label="Subir">▲</button>
        <button data-mover="1" aria-label="Descer">▼</button>
      </span>`;
    li.querySelector("strong")!.textContent = f.nome;
    li.onclick = (ev) => {
      const mover = (ev.target as HTMLElement).closest<HTMLElement>("[data-mover]");
      if (mover) {
        moverFeature(i, Number(mover.dataset.mover));
        return;
      }
      selecionar(f.id === selecionada ? null : f.id);
    };
    lista.appendChild(li);
  });
  if (!doc.features.length) {
    lista.innerHTML = `<li class="dica">Nenhuma feature ainda. Comece com uma Extrusão.</li>`;
  }
}

function moverFeature(i: number, delta: number) {
  const j = i + delta;
  if (j < 0 || j >= doc.features.length) return;
  [doc.features[i], doc.features[j]] = [doc.features[j], doc.features[i]];
  alterou(true);
}

function selecionar(id: string | null) {
  selecionada = id;
  renderizarTudo();
}

function renderizarTudo() {
  renderizarArvore();
  const f = doc.features.find((x) => x.id === selecionada) ?? null;
  renderizarPropriedades(
    $("propriedades"),
    f,
    f ? errosPorFeature.get(f.id) : undefined,
    (_f, final) => alterou(final),
    (fx: Feature) => {
      doc.features = doc.features.filter((x) => x.id !== fx.id);
      selecionada = null;
      alterou(true);
      renderizarTudo();
    },
  );
}

// ---------- ferramentas ----------
document.querySelectorAll<HTMLButtonElement>("[data-nova]").forEach((b) => {
  b.onclick = () => {
    const tipo = b.dataset.nova as Feature["tipo"];
    const qtd = doc.features.filter((f) => f.tipo === tipo).length + 1;
    const f = novaFeature(tipo, qtd);
    if (f.tipo === "extrusao" && b.dataset.op === "cortar") {
      f.operacao = "cortar";
      f.nome = `Corte${qtd}`;
      f.perfil = { tipo: "circulo", diametro: 10 };
      f.deslocamento = alturaTopo();
      f.profundidade = -10;
    } else if (f.tipo === "extrusao" && doc.features.length) {
      f.deslocamento = alturaTopo(); // nova extrusão nasce em cima da peça
    }
    doc.features.push(f);
    selecionada = f.id;
    alterou(true);
    renderizarTudo();
  };
});

/** Estimativa da face superior em Z para posicionar novas extrusões no plano XY. */
function alturaTopo(): number {
  let z = 0;
  for (const f of doc.features) {
    if (f.suprimida || f.tipo !== "extrusao" || f.plano !== "XY" || f.operacao !== "adicionar") continue;
    z = Math.max(z, f.deslocamento + Math.max(0, f.profundidade), f.deslocamento);
  }
  return z;
}

document.querySelectorAll<HTMLButtonElement>("[data-vista]").forEach((b) => {
  b.onclick = () => viewport.definirVista(b.dataset.vista as Vista);
});
$("btn-enquadrar").onclick = () => viewport.enquadrar();

// ---------- arquivos ----------
const nomeDoc = $<HTMLInputElement>("nome-doc");
nomeDoc.value = doc.nome;
nomeDoc.onchange = () => {
  doc.nome = nomeDoc.value.trim() || "Peça";
  alterou(true);
};

$("btn-novo").onclick = () => {
  if (doc.features.length && !confirm("Descartar a peça atual e começar uma nova?")) return;
  doc = documentoVazio();
  selecionada = null;
  nomeDoc.value = doc.nome;
  alterou(true);
  renderizarTudo();
};

$("btn-salvar").onclick = () => baixar(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }), "cadt");

$("btn-abrir").onclick = () => $<HTMLInputElement>("arquivo").click();
$<HTMLInputElement>("arquivo").onchange = async (ev) => {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  if (!arq) return;
  try {
    doc = validarDocumento(JSON.parse(await arq.text()));
    selecionada = null;
    primeiraRegeneracao = true;
    nomeDoc.value = doc.nome;
    alterou(true);
    renderizarTudo();
  } catch (e) {
    alert((e as Error).message);
  }
  (ev.target as HTMLInputElement).value = "";
};

async function exportar(formato: "step" | "stl") {
  try {
    baixar(await kernel.exportar(formato), formato);
  } catch (e) {
    alert("Não foi possível exportar: " + (e as Error).message);
  }
}
$("btn-step").onclick = () => exportar("step");
$("btn-stl").onclick = () => exportar("stl");

function baixar(blob: Blob, extensao: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.nome.replace(/[\\/:*?"<>|]/g, "_")}.${extensao}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- autosave ----------
function salvarAutosave() {
  try {
    localStorage.setItem(CHAVE_AUTOSAVE, JSON.stringify(doc));
  } catch {
    /* armazenamento indisponível: segue sem autosave */
  }
}

function carregarAutosave(): Documento | null {
  try {
    const t = localStorage.getItem(CHAVE_AUTOSAVE);
    return t ? validarDocumento(JSON.parse(t)) : null;
  } catch {
    return null;
  }
}

// ---------- início ----------
registrarPasso();
renderizarTudo();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
