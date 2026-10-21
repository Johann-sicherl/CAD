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
  novoEsboco,
  ROTULO_TIPO,
  validarDocumento,
  type Documento,
  type Feature,
  type FeatureEsboco,
  type Plano,
  type SuporteEsboco,
  type Vec3,
} from "./model";
import { renderizarPropriedades } from "./propriedades";
import { Viewport, type EstiloExibicao, type IdReferencia, type Vista } from "./viewport";
import { EditorEsboco, type Ferramenta, type Hospedeiro } from "./esboco/editor";
import { renderizarPainelEsboco } from "./esboco/painel";
import { eixoXParaNormal, escalar, referencial } from "./esboco/referencial";
import { SolverEsboco } from "./esboco/solver";
import { construirCamada, descartarCamada } from "./esboco/visual";
import wasmPlaneGcs from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";

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
/** Esboço em edição (null = modo peça). */
let editor: EditorEsboco | null = null;
/** Esperando o usuário tocar um plano/face para começar um esboço. */
let aguardandoSuporte = false;
let ferramentaPendente: Ferramenta | null = null;

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
  if (aguardandoSuporte) estado = "Novo esboço: toque um plano na árvore ou uma face plana da peça";
  if (editor) estado = `Editando ${editor.esb.nome} · ${editor.textoDefinicao}`;
  const st = $("st-estado");
  st.textContent = estado;
  st.classList.toggle("com-erro", !editor && nErros > 0);
  st.dataset.definicao = editor && editor.esb.geos.length ? editor.estado.definicao : "";
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
  regenerar(final ? 0 : 250);
  renderizarArvore();
  if (!editor) desenharEsbocos();
}

function restaurar(json: string) {
  doc = JSON.parse(json);
  if (selecao?.tipo === "feature" && !doc.features.some((f) => f.id === idSelecionado())) selecao = null;
  if (editor) {
    const e = doc.features.find((f): f is FeatureEsboco => f.id === editor!.esb.id && f.tipo === "esboco");
    if (e) editor.reatar(e);
    else sairEsboco();
  }
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
    const sairDoEsboco = aba.id === "sketch" && c.id === "esboco" && editor;
    b.innerHTML = sairDoEsboco ? `${ICONES.concluir}<span>Sair do esboço</span>` : `${ICONES[c.icone]}<span>${c.rotulo}</span>`;
    if (c.fase) {
      b.setAttribute("aria-disabled", "true");
      b.insertAdjacentHTML("beforeend", `<em class="selo">F${c.fase}</em>`);
    }
    if (aba.id === "sketch" && editor) {
      const ativo = c.id === editor.ferramenta || (c.id === "construcao" && editor.construcao);
      b.setAttribute("aria-pressed", String(ativo));
    }
    if (sairDoEsboco) b.classList.add("cmd-sair");
    b.onclick = () => executarComando(c, aba.id, b);
    faixa.appendChild(b);
  }
  faixa.scrollLeft = 0;
}

function executarComando(c: Comando, aba: IdAba, botao: HTMLElement) {
  if (c.fase) {
    avisar(`${c.rotulo}: previsto para a Fase ${c.fase} do roteiro.`);
    return;
  }
  if (aba === "sketch") {
    void comandoEsboco(c, botao);
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
  const tipo = tipoPorComando[c.id] as Exclude<Feature["tipo"], "esboco"> | undefined;
  if (!tipo) return;
  // perfil: esboço em edição, esboço selecionado ou o último esboço ainda sem uso
  let perfil: FeatureEsboco | null = null;
  if (tipo === "extrusao" || tipo === "revolucao") {
    const sel = doc.features.find((x) => x.id === idSelecionado());
    perfil = editor?.esb ?? (sel?.tipo === "esboco" ? sel : null) ?? ultimoEsbocoLivre();
  }
  if (editor) sairEsboco();
  const qtd = doc.features.filter((f) => f.tipo === tipo).length + 1;
  const f = novaFeature(tipo, qtd);
  const cortar = c.id === "corte" || c.id === "corte-revolucao";
  if (perfil && (f.tipo === "extrusao" || f.tipo === "revolucao")) {
    f.esboco = perfil.id;
    if (cortar) {
      f.operacao = "cortar";
      f.nome = f.tipo === "extrusao" ? `Corte${qtd}` : `CorteRevolução${qtd}`;
    }
    // corte entra no material: contra a normal do esboço
    if (f.tipo === "extrusao") f.profundidade = cortar ? -10 : 10;
  } else if (f.tipo === "extrusao" && c.id === "corte") {
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
  esboco: "esboco",
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
      if (aguardandoSuporte && id !== "origem") {
        void criarEsboco({ tipo: "plano", plano: id, deslocamento: 0 });
        return;
      }
      if (editor) return avisar("Saia do esboço para selecionar outros itens da árvore.");
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
    const nomeEsboco = "esboco" in f && f.esboco ? doc.features.find((x) => x.id === f.esboco)?.nome : undefined;
    const extra = nomeEsboco ? ` · ${nomeEsboco}` : f.id === editor?.esb.id ? " · editando" : "";
    li.classList.toggle("editando", f.id === editor?.esb.id);
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
    li.querySelector("small")!.textContent = `${ROTULO_TIPO[f.tipo]}${op}${extra}`;
    li.title = errosPorFeature.get(f.id) ?? "";
    if (f.tipo === "esboco") li.ondblclick = () => !editor && void editarEsboco(f);
    li.onclick = (ev) => {
      const mover = (ev.target as HTMLElement).closest<HTMLElement>("[data-mover]");
      if (mover) {
        moverFeature(i, Number(mover.dataset.mover));
        return;
      }
      if (editor) {
        if (f.id !== editor.esb.id) avisar("Saia do esboço para selecionar outros itens da árvore.");
        return;
      }
      selecionar(f.id === idSelecionado() ? null : { tipo: "feature", id: f.id });
    };
    lista.appendChild(li);
  });

  if (!doc.features.length) {
    lista.insertAdjacentHTML("beforeend", `<li class="dica">Nenhuma feature ainda. Escolha um plano e toque Esboço na aba Sketch.</li>`);
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

  if (!editor) desenharEsbocos();
  renderizarPainel();
}

function renderizarPainel() {
  const painel = $("propriedades");
  if (editor) {
    const ed = editor;
    renderizarPainelEsboco(
      painel,
      ed,
      sairEsboco,
      (nome) => {
        ed.esb.nome = nome;
        alterou(true);
        atualizarStatus();
      },
      (ancora) => abrirPopover(ancora, ed.relacoesPossiveis().map((r) => ({ rotulo: r.rotulo, acao: r.aplicar }))),
    );
    return;
  }
  if (selecao?.tipo === "ref") {
    renderizarPainelReferencia(painel, selecao.id);
    return;
  }
  const f = doc.features.find((x) => x.id === idSelecionado()) ?? null;
  if (f?.tipo === "esboco") {
    renderizarPainelEsbocoFechado(painel, f);
    return;
  }
  const indice = f ? doc.features.indexOf(f) : 0;
  const esbocos = doc.features.slice(0, indice).filter((x) => x.tipo === "esboco").map((x) => ({ id: x.id, nome: x.nome }));
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
    esbocos,
  );
}

/** Esboço selecionado fora da edição: resumo e botão para editar. */
function renderizarPainelEsbocoFechado(painel: HTMLElement, f: FeatureEsboco) {
  painel.classList.remove("vazio");
  const onde = f.suporte.tipo === "plano" ? `Plano ${NOME_PLANO[f.suporte.plano]}` : "Face plana da peça";
  const usadoPor = doc.features.filter((x) => "esboco" in x && x.esboco === f.id).map((x) => x.nome);
  painel.innerHTML = `
    <div class="prop-cabecalho">
      <span class="prop-tipo">Esboço</span>
      <input class="prop-nome" />
    </div>
    <p class="dica">Em: ${onde}<br>${f.geos.filter((g) => !g.construcao).length} entidades · ${f.restricoes.length} relações/cotas<br>
    ${usadoPor.length ? `Usado por: ${usadoPor.join(", ")}` : "Ainda não usado: toque Extrusão ou Revolução na aba Features."}</p>
    <div class="prop-rodape coluna">
      <button data-r="editar" class="destaque">${ICONES.esboco}Editar esboço</button>
      <button data-r="sup">${f.suprimida ? "Reativar" : "Suprimir"}</button>
      <button data-r="exc" class="perigo">Excluir</button>
    </div>`;
  const nome = painel.querySelector<HTMLInputElement>(".prop-nome")!;
  nome.value = f.nome;
  nome.onchange = () => {
    f.nome = nome.value.trim() || f.nome;
    alterou(true);
  };
  painel.querySelector<HTMLElement>('[data-r="editar"]')!.onclick = () => void editarEsboco(f);
  painel.querySelector<HTMLElement>('[data-r="sup"]')!.onclick = () => {
    f.suprimida = !f.suprimida;
    alterou(true);
    renderizarTudo();
  };
  painel.querySelector<HTMLElement>('[data-r="exc"]')!.onclick = () => {
    doc.features = doc.features.filter((x) => x.id !== f.id);
    selecao = null;
    alterou(true);
    renderizarTudo();
  };
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
    ${id !== "origem" ? `<div class="prop-rodape coluna"><button data-r="esboco" class="destaque">${ICONES.esboco}Novo esboço neste plano</button></div>` : ""}`;
  painel.querySelector<HTMLElement>('[data-r="esboco"]')?.addEventListener("click", () =>
    void criarEsboco({ tipo: "plano", plano: id as Plano, deslocamento: 0 }));
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
  if (editor && editor.teclado(e)) {
    e.preventDefault();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) desfazer();
  else if (ctrl && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) refazerPasso();
  else if (ctrl && e.key.toLowerCase() === "s") ACOES.salvar.fazer();
  else if (e.key === "f" && !ctrl) viewport.enquadrar();
  else if (e.key === "Escape") {
    fecharPopover();
    if (aguardandoSuporte) {
      aguardandoSuporte = false;
      ferramentaPendente = null;
    }
    selecionar(null);
  } else return;
  e.preventDefault();
});

// ---------- esboço ----------
let solver: Promise<SolverEsboco> | null = null;
const obterSolver = () => (solver ??= SolverEsboco.criar(() => wasmPlaneGcs));

function ultimoEsbocoLivre(): FeatureEsboco | null {
  const usados = new Set(doc.features.flatMap((f) => ("esboco" in f && f.esboco ? [f.esboco] : [])));
  const livres = doc.features.filter((f): f is FeatureEsboco => f.tipo === "esboco" && !f.suprimida && !usados.has(f.id));
  return livres[livres.length - 1] ?? null;
}

async function comandoEsboco(c: Comando, botao: HTMLElement) {
  switch (c.id) {
    case "esboco":
      if (editor) sairEsboco();
      else await iniciarEsboco();
      return;
    case "relacao": {
      if (!editor) return avisar("Relações: abra um esboço primeiro.");
      const ops = editor.relacoesPossiveis();
      if (!ops.length) return avisar("Selecione entidades para relacionar (ex.: duas linhas → Paralelo).");
      abrirPopover(botao, ops.map((o) => ({ rotulo: o.rotulo, acao: o.aplicar })));
      return;
    }
    case "construcao":
      if (!editor) return avisar("Construção: abra um esboço primeiro.");
      if (editor.geosSelecionadas().length) editor.alternarConstrucaoSelecao();
      else {
        editor.construcao = !editor.construcao;
        avisar(editor.construcao ? "Próximas entidades serão de construção." : "Próximas entidades serão normais.");
        renderizarAbas();
        renderizarPainel();
      }
      return;
    default:
      if (!editor && !(await iniciarEsboco(c.id as Ferramenta))) return;
      editor!.definirFerramenta(c.id as Ferramenta);
  }
}

/** Abre o esboço selecionado, ou começa um no plano selecionado; senão pede plano/face. */
async function iniciarEsboco(ferramenta?: Ferramenta): Promise<boolean> {
  const f = doc.features.find((x) => x.id === idSelecionado());
  if (f?.tipo === "esboco") {
    await editarEsboco(f);
    return true;
  }
  if (f && "esboco" in f && f.esboco) {
    const e = doc.features.find((x): x is FeatureEsboco => x.id === f.esboco && x.tipo === "esboco");
    if (e) {
      await editarEsboco(e);
      return true;
    }
  }
  if (selecao?.tipo === "ref" && selecao.id !== "origem") {
    await criarEsboco({ tipo: "plano", plano: selecao.id, deslocamento: 0 });
    return true;
  }
  aguardandoSuporte = true;
  ferramentaPendente = ferramenta ?? null;
  avisar("Toque um plano na árvore ou uma face plana da peça para esboçar.");
  atualizarStatus();
  return false;
}

async function criarEsboco(suporte: SuporteEsboco) {
  aguardandoSuporte = false;
  const n = doc.features.filter((x) => x.tipo === "esboco").length + 1;
  const esb = novoEsboco(n, suporte);
  doc.features.push(esb);
  selecao = { tipo: "feature", id: esb.id };
  alterou(true);
  await editarEsboco(esb);
  if (ferramentaPendente) editor?.definirFerramenta(ferramentaPendente);
  ferramentaPendente = null;
}

async function editarEsboco(esb: FeatureEsboco) {
  if (editor) sairEsboco();
  let s: SolverEsboco;
  try {
    s = await obterSolver();
  } catch (e) {
    avisar("Não foi possível carregar o solver de esboço: " + (e as Error).message);
    return;
  }
  limparEsbocos();
  selecao = { tipo: "feature", id: esb.id };
  const host: Hospedeiro = {
    viewport,
    solver: s,
    overlay: $("overlay-esboco"),
    alterou: (final) => alterou(final),
    atualizarInterface: () => {
      renderizarAbas();
      renderizarPainel();
      atualizarStatus();
    },
    avisar,
  };
  editor = new EditorEsboco(host, esb);
  prefs.aba = "sketch";
  salvarPrefs();
  renderizarAbas();
  renderizarTudo();
}

function sairEsboco() {
  if (!editor) return;
  const id = editor.esb.id;
  editor.fechar();
  editor = null;
  instalarToqueCurto();
  selecao = { tipo: "feature", id };
  renderizarAbas();
  renderizarTudo();
  regenerar();
}

/** Fora do esboço: toque numa face plana quando se está escolhendo onde esboçar. */
function instalarToqueCurto() {
  viewport.aoToqueCurto = (e) => {
    if (!aguardandoSuporte) return;
    const face = viewport.picarFace(e.clientX, e.clientY);
    if (!face) {
      avisar("Isso não é uma face plana. Toque uma face plana ou um plano na árvore.");
      return;
    }
    // origem do esboço = projeção da origem do modelo no plano da face
    const n = face.normal;
    const d = escalar(face.origem, n);
    const origem = n.map((v) => v * d) as Vec3;
    void criarEsboco({ tipo: "face", origem, normal: n, eixoX: eixoXParaNormal(n) });
  };
}
instalarToqueCurto();

// esboços visíveis fora da edição: os que ainda não viraram feature e o selecionado
let camadasEsbocos: ReturnType<typeof construirCamada>[] = [];
function limparEsbocos() {
  for (const c of camadasEsbocos) {
    viewport.grupoEsboco.remove(c);
    descartarCamada(c);
  }
  camadasEsbocos = [];
}
function desenharEsbocos() {
  limparEsbocos();
  const usados = new Set(doc.features.flatMap((f) => ("esboco" in f && f.esboco ? [f.esboco] : [])));
  const { w, h } = viewport.tamanho();
  for (const f of doc.features) {
    if (f.tipo !== "esboco" || f.suprimida) continue;
    if (usados.has(f.id) && f.id !== idSelecionado()) continue;
    const ref = referencial(f.suporte);
    const c = construirCamada(f, { ref, mmPx: viewport.mmPorPixel(ref), resolucao: { w, h }, editando: false });
    viewport.grupoEsboco.add(c);
    camadasEsbocos.push(c);
  }
  viewport.pedirRender();
}

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
