import "./style.css";
import { ABAS, type Comando, type IdAba } from "./comandos";
import { ICONES, type NomeIcone } from "./icones";
import { ClienteKernel } from "./kernel/cliente";
import type { ResultadoRegeneracao } from "./kernel/regenerar";
import {
  documentoExemplo,
  documentoVazio,
  NOME_PLANO,
  novaFeature,
  ROTULO_TIPO,
  validarDocumento,
  type Documento,
  type Feature,
  type Plano,
} from "./model";
import { renderizarPropriedades } from "./propriedades";
import { Viewport, type EstiloExibicao, type IdReferencia, type Vista } from "./viewport";

const CHAVE_AUTOSAVE = "cad-tablet:documento";
const CHAVE_PREFS = "cad-tablet:interface";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- preferências de interface (só deste aparelho) ----------
interface Prefs {
  aba: IdAba;
  estilo: EstiloExibicao;
  refsVisiveis: Record<IdReferencia, boolean>;
}
const prefs: Prefs = {
  aba: "features",
  estilo: "sombreado-arestas",
  refsVisiveis: { XZ: true, XY: true, YZ: true, origem: true },
  ...lerJSON<Partial<Prefs>>(CHAVE_PREFS),
};
const salvarPrefs = () => gravarJSON(CHAVE_PREFS, prefs);

// ---------- estado ----------
type Selecao = { tipo: "feature"; id: string } | { tipo: "ref"; id: IdReferencia } | null;

let doc: Documento = carregarAutosave() ?? documentoExemplo();
let selecao: Selecao = null;
let errosPorFeature = new Map<string, string>();
const historico: string[] = [];
const refazer: string[] = [];
let primeiraRegeneracao = true;
let estadoKernel: "iniciando" | "pronto" | "regenerando" | "erro" = "iniciando";

const viewport = new Viewport($("viewport"));
const kernel = new ClienteKernel(aoRegenerar);

viewport.definirEstilo(prefs.estilo);
for (const [id, vis] of Object.entries(prefs.refsVisiveis)) {
  viewport.definirVisibilidadeReferencia(id as IdReferencia, vis);
}

kernel.pronto
  .then(() => {
    $("carregando").remove();
    estadoKernel = "pronto";
    atualizarStatus();
    regenerar();
  })
  .catch((e) => {
    $("carregando").textContent = "Falha ao carregar o kernel: " + e.message;
    estadoKernel = "erro";
    atualizarStatus();
  });

const idSelecionado = () => (selecao?.tipo === "feature" ? selecao.id : null);

// ---------- regeneração ----------
let temporizador: number | undefined;
function regenerar(atraso = 0) {
  clearTimeout(temporizador);
  temporizador = window.setTimeout(() => {
    if (estadoKernel === "pronto") estadoKernel = "regenerando";
    atualizarStatus();
    kernel.regenerar(doc.features);
  }, atraso);
}

function aoRegenerar(r: ResultadoRegeneracao, ms: number) {
  estadoKernel = "pronto";
  viewport.mostrarMalha(r.malha);
  if (primeiraRegeneracao && r.malha) {
    viewport.enquadrar(false);
    primeiraRegeneracao = false;
  }
  errosPorFeature = new Map(r.erros.map((e) => [e.id, e.mensagem]));
  $("st-volume").textContent =
    r.volume !== null ? `Volume: ${(r.volume / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm³` : "";
  $("st-tempo").textContent = `Regeneração: ${ms.toFixed(0)} ms`;
  atualizarStatus();
  renderizarArvore();
  // Atualiza só a mensagem de erro do painel, sem recriar os campos (não perde o foco)
  const painel = $("propriedades");
  const id = idSelecionado();
  const msgErro = id ? errosPorFeature.get(id) : undefined;
  let el = painel.querySelector<HTMLElement>(".prop-erro");
  if (msgErro && !el) {
    el = document.createElement("p");
    el.className = "prop-erro";
    painel.querySelector(".prop-cabecalho")?.after(el);
  }
  if (el) msgErro ? (el.textContent = msgErro) : el.remove();
}

function atualizarStatus() {
  const k = $("st-kernel");
  k.textContent = {
    iniciando: "Kernel: iniciando…",
    pronto: "Kernel: pronto",
    regenerando: "Regenerando…",
    erro: "Kernel: erro",
  }[estadoKernel];
  k.dataset.estado = estadoKernel;

  const nErros = errosPorFeature.size;
  let estado = "Editando peça";
  if (selecao?.tipo === "ref") estado = `Selecionado: ${rotuloReferencia(selecao.id)}`;
  else if (selecao?.tipo === "feature") {
    const f = doc.features.find((x) => x.id === selecao!.id);
    if (f) estado = `Editando: ${f.nome}`;
  }
  if (nErros) estado += ` · ${nErros} feature${nErros > 1 ? "s" : ""} com erro`;
  const st = $("st-estado");
  st.textContent = estado;
  st.classList.toggle("com-erro", nErros > 0);
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
  if (selecao?.tipo === "feature" && !doc.features.some((f) => f.id === idSelecionado())) selecao = null;
  $<HTMLInputElement>("nome-doc").value = doc.nome;
  salvarAutosave();
  renderizarTudo();
  regenerar();
}

function desfazer() {
  if (historico.length < 2) return;
  refazer.push(historico.pop()!);
  restaurar(historico[historico.length - 1]);
}
function refazerPasso() {
  const p = refazer.pop();
  if (!p) return;
  historico.push(p);
  restaurar(p);
}
$("btn-desfazer").onclick = desfazer;
$("btn-refazer").onclick = refazerPasso;

// ---------- abas e linha de comandos ----------
function renderizarAbas() {
  const abas = $("abas");
  abas.innerHTML = "";
  for (const a of ABAS) {
    const b = document.createElement("button");
    b.className = "aba";
    b.role = "tab";
    b.textContent = a.rotulo;
    b.setAttribute("aria-selected", String(a.id === prefs.aba));
    b.onclick = () => {
      prefs.aba = a.id;
      salvarPrefs();
      renderizarAbas();
    };
    abas.appendChild(b);
  }

  const faixa = $("faixa-comandos");
  faixa.innerHTML = "";
  const aba = ABAS.find((a) => a.id === prefs.aba) ?? ABAS[0];
  let grupo = aba.comandos[0]?.grupo;
  for (const c of aba.comandos) {
    if (c.grupo !== grupo) {
      faixa.appendChild(Object.assign(document.createElement("span"), { className: "sep" }));
      grupo = c.grupo;
    }
    const b = document.createElement("button");
    b.className = "cmd";
    b.title = c.fase ? `${c.dica} — chega na Fase ${c.fase}` : c.dica;
    b.innerHTML = `${ICONES[c.icone]}<span>${c.rotulo}</span>`;
    if (c.fase) {
      b.setAttribute("aria-disabled", "true");
      b.insertAdjacentHTML("beforeend", `<em class="selo">F${c.fase}</em>`);
    }
    b.onclick = () => executarComando(c);
    faixa.appendChild(b);
  }
  faixa.scrollLeft = 0;
}

function executarComando(c: Comando) {
  if (c.fase) {
    avisar(`${c.rotulo}: previsto para a Fase ${c.fase} do roteiro.`);
    return;
  }
  const tipoPorComando: Record<string, Feature["tipo"]> = {
    extrusao: "extrusao",
    corte: "extrusao",
    revolucao: "revolucao",
    "corte-revolucao": "revolucao",
    filete: "filete",
    chanfro: "chanfro",
  };
  const tipo = tipoPorComando[c.id];
  if (!tipo) return;
  const qtd = doc.features.filter((f) => f.tipo === tipo).length + 1;
  const f = novaFeature(tipo, qtd);
  if (f.tipo === "extrusao" && c.id === "corte") {
    f.operacao = "cortar";
    f.nome = `Corte${qtd}`;
    f.perfil = { tipo: "circulo", diametro: 10 };
    f.deslocamento = alturaTopo();
    f.profundidade = -10;
  } else if (f.tipo === "extrusao" && doc.features.length) {
    f.deslocamento = alturaTopo(); // nova extrusão nasce em cima da peça
  } else if (f.tipo === "revolucao" && c.id === "corte-revolucao") {
    f.operacao = "cortar";
    f.nome = `CorteRevolução${qtd}`;
    f.raioInterno = 0;
    f.largura = 10;
    f.altura = Math.max(10, alturaTopo());
  }
  doc.features.push(f);
  selecao = { tipo: "feature", id: f.id };
  alterou(true);
  renderizarTudo();
}

/** Estimativa da face superior em Z para posicionar novas extrusões no plano Superior. */
function alturaTopo(): number {
  let z = 0;
  for (const f of doc.features) {
    if (f.suprimida || f.tipo !== "extrusao" || f.plano !== "XY" || f.operacao !== "adicionar") continue;
    z = Math.max(z, f.deslocamento + Math.max(0, f.profundidade), f.deslocamento);
  }
  return z;
}

// ---------- árvore do modelo ----------
const REFERENCIAS: IdReferencia[] = ["XZ", "XY", "YZ", "origem"];
const rotuloReferencia = (id: IdReferencia) => (id === "origem" ? "Origem" : `Plano ${NOME_PLANO[id]}`);

const ICONE_FEATURE: Record<Feature["tipo"], NomeIcone> = {
  extrusao: "extrusao",
  revolucao: "revolucao",
  filete: "filete",
  chanfro: "chanfro",
};

function renderizarArvore() {
  const lista = $("arvore");
  lista.innerHTML = "";

  const raiz = document.createElement("li");
  raiz.className = "raiz";
  raiz.innerHTML = `${ICONES.peca}<strong></strong>`;
  raiz.querySelector("strong")!.textContent = doc.nome;
  lista.appendChild(raiz);

  for (const id of REFERENCIAS) {
    const li = document.createElement("li");
    li.className = "item ref";
    li.classList.toggle("ativo", selecao?.tipo === "ref" && selecao.id === id);
    li.classList.toggle("oculta", !prefs.refsVisiveis[id]);
    const vis = prefs.refsVisiveis[id];
    li.innerHTML = `
      <span class="item-ic">${id === "origem" ? ICONES.origem : ICONES.plano}</span>
      <span class="item-texto"><strong>${rotuloReferencia(id)}</strong></span>
      <button class="item-olho" aria-label="${vis ? "Ocultar" : "Mostrar"}">${vis ? ICONES.olho : ICONES.olhoFechado}</button>`;
    li.onclick = (ev) => {
      if ((ev.target as HTMLElement).closest(".item-olho")) {
        alternarReferencia(id);
        return;
      }
      selecionar(selecao?.tipo === "ref" && selecao.id === id ? null : { tipo: "ref", id });
    };
    lista.appendChild(li);
  }

  doc.features.forEach((f, i) => {
    const li = document.createElement("li");
    li.className = "item";
    li.classList.toggle("ativo", f.id === idSelecionado());
    li.classList.toggle("suprimida", f.suprimida);
    li.classList.toggle("com-erro", errosPorFeature.has(f.id));
    li.classList.toggle("corte", "operacao" in f && f.operacao === "cortar");
    const op = "operacao" in f && f.operacao === "cortar" ? " · corte" : "";
    const icone: NomeIcone =
      f.tipo === "extrusao" && f.operacao === "cortar" ? "corte"
      : f.tipo === "revolucao" && f.operacao === "cortar" ? "corteRevolucao"
      : ICONE_FEATURE[f.tipo];
    li.innerHTML = `
      <span class="item-ic">${ICONES[icone]}</span>
      <span class="item-texto"><strong></strong><small>${ROTULO_TIPO[f.tipo]}${op}</small></span>
      <span class="item-mover">
        <button data-mover="-1" aria-label="Subir">▲</button>
        <button data-mover="1" aria-label="Descer">▼</button>
      </span>`;
    li.querySelector("strong")!.textContent = f.nome;
    li.title = errosPorFeature.get(f.id) ?? "";
    li.onclick = (ev) => {
      const mover = (ev.target as HTMLElement).closest<HTMLElement>("[data-mover]");
      if (mover) {
        moverFeature(i, Number(mover.dataset.mover));
        return;
      }
      selecionar(f.id === idSelecionado() ? null : { tipo: "feature", id: f.id });
    };
    lista.appendChild(li);
  });

  if (!doc.features.length) {
    lista.insertAdjacentHTML("beforeend", `<li class="dica">Nenhuma feature ainda. Comece com uma Extrusão na aba Features.</li>`);
  }
}

function alternarReferencia(id: IdReferencia) {
  prefs.refsVisiveis[id] = !prefs.refsVisiveis[id];
  salvarPrefs();
  viewport.definirVisibilidadeReferencia(id, prefs.refsVisiveis[id]);
  renderizarTudo();
}

function moverFeature(i: number, delta: number) {
  const j = i + delta;
  if (j < 0 || j >= doc.features.length) return;
  [doc.features[i], doc.features[j]] = [doc.features[j], doc.features[i]];
  alterou(true);
}

function selecionar(s: Selecao) {
  selecao = s;
  renderizarTudo();
}

function renderizarTudo() {
  renderizarArvore();
  viewport.destacarReferencia(selecao?.tipo === "ref" ? selecao.id : null);
  atualizarStatus();
  renderizarBarraVistas();

  const painel = $("propriedades");
  if (selecao?.tipo === "ref") {
    renderizarPainelReferencia(painel, selecao.id);
    return;
  }
  const f = doc.features.find((x) => x.id === idSelecionado()) ?? null;
  renderizarPropriedades(
    painel,
    f,
    f ? errosPorFeature.get(f.id) : undefined,
    (_f, final) => {
      alterou(final);
      atualizarStatus();
    },
    (fx: Feature) => {
      doc.features = doc.features.filter((x) => x.id !== fx.id);
      selecao = null;
      alterou(true);
      renderizarTudo();
    },
  );
}

function renderizarPainelReferencia(painel: HTMLElement, id: IdReferencia) {
  painel.classList.remove("vazio");
  const descricao: Record<IdReferencia, string> = {
    XZ: "Plano XZ, normal ao eixo Y. Vista de frente da peça.",
    XY: "Plano XY, normal ao eixo Z (para cima). Vista de cima da peça.",
    YZ: "Plano YZ, normal ao eixo X. Vista lateral da peça.",
    origem: "Ponto (0, 0, 0) e direções dos eixos X, Y e Z.",
  };
  const vis = prefs.refsVisiveis[id];
  painel.innerHTML = `
    <div class="prop-cabecalho">
      <span class="prop-tipo">${id === "origem" ? "Origem" : "Plano de referência"}</span>
      <div class="prop-nome fixo">${rotuloReferencia(id)}</div>
    </div>
    <p class="dica">${descricao[id]}</p>
    <div class="prop-rodape coluna">
      ${id !== "origem" ? `<button data-r="normal">${ICONES.normalA}Vista normal ao plano</button>` : ""}
      <button data-r="vis">${vis ? ICONES.olhoFechado : ICONES.olho}${vis ? "Ocultar" : "Mostrar"} no modelo</button>
    </div>
    ${id !== "origem" ? `<p class="dica">Esboçar neste plano chega na Fase 2 (aba Sketch).</p>` : ""}`;
  painel.querySelector<HTMLElement>('[data-r="normal"]')?.addEventListener("click", () => viewport.vistaNormalA(id as Plano));
  painel.querySelector<HTMLElement>('[data-r="vis"]')!.onclick = () => alternarReferencia(id);
}

// ---------- barra de vistas (flutuante no viewport) ----------
const VISTAS: [Vista, string][] = [
  ["iso", "Isométrica"],
  ["frontal", "Frontal"],
  ["traseira", "Traseira"],
  ["superior", "Superior"],
  ["inferior", "Inferior"],
  ["esquerda", "Esquerda"],
  ["direita", "Direita"],
];
const ESTILOS: [EstiloExibicao, string, NomeIcone][] = [
  ["sombreado-arestas", "Sombreado com arestas", "estiloSombreadoArestas"],
  ["sombreado", "Sombreado", "estiloSombreado"],
  ["arestas", "Só arestas", "estiloArestas"],
];

/** Plano associado à seleção atual (plano de referência ou plano do esboço da feature). */
function planoDaSelecao(): Plano | null {
  if (selecao?.tipo === "ref") return selecao.id === "origem" ? null : selecao.id;
  const f = doc.features.find((x) => x.id === idSelecionado());
  return f && "plano" in f ? f.plano : null;
}

function renderizarBarraVistas() {
  const barra = $("barra-vistas");
  barra.innerHTML = "";
  const botao = (icone: NomeIcone, titulo: string, acao: (b: HTMLButtonElement) => void, desabilitado = false) => {
    const b = document.createElement("button");
    b.className = "btn-ic";
    b.title = titulo;
    b.setAttribute("aria-label", titulo);
    b.innerHTML = ICONES[icone];
    b.disabled = desabilitado;
    b.onclick = () => acao(b);
    barra.appendChild(b);
    return b;
  };
  const sep = () => barra.appendChild(Object.assign(document.createElement("span"), { className: "sep" }));

  botao("enquadrar", "Enquadrar (toque duplo no modelo)", () => viewport.enquadrar());
  botao("vistaIso", "Isométrica", () => viewport.definirVista("iso"));
  botao("vistas", "Orientação da vista", (b) =>
    abrirPopover(b, VISTAS.map(([v, r]) => ({ rotulo: r, acao: () => viewport.definirVista(v) }))),
  );
  const plano = planoDaSelecao();
  botao("normalA", plano ? `Normal ao plano ${NOME_PLANO[plano]}` : "Normal a (selecione um plano)", () => plano && viewport.vistaNormalA(plano), !plano);
  sep();
  const estiloAtual = ESTILOS.find((e) => e[0] === prefs.estilo)!;
  botao(estiloAtual[2], `Estilo: ${estiloAtual[1]}`, (b) =>
    abrirPopover(
      b,
      ESTILOS.map(([e, r, ic]) => ({
        rotulo: r,
        icone: ic,
        marcado: e === prefs.estilo,
        acao: () => {
          prefs.estilo = e;
          salvarPrefs();
          viewport.definirEstilo(e);
          renderizarBarraVistas();
        },
      })),
    ),
  );
  const algumPlano = (["XZ", "XY", "YZ"] as const).some((p) => prefs.refsVisiveis[p]);
  botao(algumPlano ? "plano" : "olhoFechado", algumPlano ? "Ocultar planos" : "Mostrar planos", () => {
    for (const p of ["XZ", "XY", "YZ"] as const) {
      prefs.refsVisiveis[p] = !algumPlano;
      viewport.definirVisibilidadeReferencia(p, !algumPlano);
    }
    salvarPrefs();
    renderizarTudo();
  });
}

interface ItemPopover {
  rotulo: string;
  icone?: NomeIcone;
  marcado?: boolean;
  acao: () => void;
}

let popoverAberto: HTMLElement | null = null;
function fecharPopover() {
  popoverAberto?.remove();
  popoverAberto = null;
}

function abrirPopover(ancora: HTMLElement, itens: ItemPopover[]) {
  const reabrir = popoverAberto?.dataset.ancora !== ancora.title;
  fecharPopover();
  if (!reabrir) return;
  const p = document.createElement("div");
  p.className = "popover";
  p.dataset.ancora = ancora.title;
  for (const it of itens) {
    const b = document.createElement("button");
    b.innerHTML = `${it.icone ? ICONES[it.icone] : ""}<span>${it.rotulo}</span>${it.marcado ? "<b>✓</b>" : ""}`;
    b.onclick = () => {
      fecharPopover();
      it.acao();
    };
    p.appendChild(b);
  }
  document.body.appendChild(p);
  const r = ancora.getBoundingClientRect();
  const largura = p.offsetWidth;
  p.style.top = `${r.bottom + 6}px`;
  p.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - largura - 8))}px`;
  popoverAberto = p;
}

document.addEventListener("pointerdown", (e) => {
  const alvo = e.target as HTMLElement;
  const ehAncora = alvo.closest("button")?.title === popoverAberto?.dataset.ancora;
  if (popoverAberto && !popoverAberto.contains(alvo) && !ehAncora) fecharPopover();
  const menu = $("menu-arquivo");
  if (!menu.hidden && !alvo.closest(".menu-wrap")) fecharMenu();
});

// ---------- aviso flutuante ----------
let tempoAviso: number | undefined;
function avisar(texto: string) {
  const el = $("aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(tempoAviso);
  tempoAviso = window.setTimeout(() => (el.hidden = true), 2600);
}

// ---------- arquivo ----------
const nomeDoc = $<HTMLInputElement>("nome-doc");
nomeDoc.value = doc.nome;
nomeDoc.onchange = () => {
  doc.nome = nomeDoc.value.trim() || "Peça";
  nomeDoc.value = doc.nome;
  alterou(true);
};

const ACOES: Record<string, { rotulo: string; icone: NomeIcone; fazer: () => void }> = {
  novo: { rotulo: "Nova peça", icone: "nova", fazer: novaPeca },
  abrir: { rotulo: "Abrir…", icone: "abrir", fazer: () => $<HTMLInputElement>("arquivo").click() },
  salvar: {
    rotulo: "Salvar (.cadt)",
    icone: "salvar",
    fazer: () => baixar(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }), "cadt"),
  },
  step: { rotulo: "Exportar STEP", icone: "exportar", fazer: () => exportar("step") },
  stl: { rotulo: "Exportar STL", icone: "exportar", fazer: () => exportar("stl") },
};

document.querySelectorAll<HTMLButtonElement>("[data-acao]").forEach((b) => {
  const a = ACOES[b.dataset.acao!];
  if (b.classList.contains("btn-ic")) b.innerHTML = ICONES[a.icone];
  else if (b.role === "menuitem") b.innerHTML = `${ICONES[a.icone]}<span>${a.rotulo}</span>`;
  b.onclick = () => {
    fecharMenu();
    a.fazer();
  };
});
$("btn-desfazer").innerHTML = ICONES.desfazer;
$("btn-refazer").innerHTML = ICONES.refazer;

const btnMenu = $("btn-menu");
btnMenu.innerHTML = ICONES.menu;
btnMenu.onclick = () => {
  const menu = $("menu-arquivo");
  menu.hidden = !menu.hidden;
  btnMenu.setAttribute("aria-expanded", String(!menu.hidden));
};
function fecharMenu() {
  $("menu-arquivo").hidden = true;
  btnMenu.setAttribute("aria-expanded", "false");
}

function novaPeca() {
  if (doc.features.length && !confirm("Descartar a peça atual e começar uma nova?")) return;
  doc = documentoVazio();
  selecao = null;
  nomeDoc.value = doc.nome;
  alterou(true);
  renderizarTudo();
}

$<HTMLInputElement>("arquivo").onchange = async (ev) => {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  if (!arq) return;
  try {
    doc = validarDocumento(JSON.parse(await arq.text()));
    selecao = null;
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

function baixar(blob: Blob, extensao: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.nome.replace(/[\\/:*?"<>|]/g, "_")}.${extensao}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- atalhos de teclado (teclado do tablet ou externo) ----------
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, select, textarea")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) desfazer();
  else if (ctrl && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) refazerPasso();
  else if (ctrl && e.key.toLowerCase() === "s") ACOES.salvar.fazer();
  else if (e.key === "f" && !ctrl) viewport.enquadrar();
  else if (e.key === "Escape") {
    fecharPopover();
    selecionar(null);
  } else return;
  e.preventDefault();
});

// ---------- persistência local ----------
function salvarAutosave() {
  gravarJSON(CHAVE_AUTOSAVE, doc);
}

function carregarAutosave(): Documento | null {
  const d = lerJSON<unknown>(CHAVE_AUTOSAVE);
  try {
    return d ? validarDocumento(d) : null;
  } catch {
    return null;
  }
}

function lerJSON<T>(chave: string): T | null {
  try {
    const t = localStorage.getItem(chave);
    return t ? (JSON.parse(t) as T) : null;
  } catch {
    return null;
  }
}

function gravarJSON(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* armazenamento indisponível: segue sem salvar */
  }
}

// ---------- início ----------
registrarPasso();
renderizarAbas();
renderizarTudo();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
