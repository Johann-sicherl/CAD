import "./style.css";
import { ABAS, type Comando, type IdAba } from "./comandos";
import { ICONES, type NomeIcone } from "./icones";
import { ClienteKernel } from "./kernel/cliente";
import type { InfoReferencia, ResultadoRegeneracao } from "./kernel/regenerar";
import type { PropriedadesMassa } from "./kernel/avaliar";
import {
  documentoExemplo,
  documentoVazio,
  ehCota,
  esbocosAbsorvidos,
  MATERIAIS,
  NOME_PLANO,
  novaFeature,
  novoEsboco,
  ROTULO_TIPO,
  TABELA_CHAPA,
  validarDocumento,
  type Documento,
  type Feature,
  type FeatureEsboco,
  type FeatureCurva,
  type FeatureExtrusao,
  type FeatureFuro,
  type FeatureBaseChapa,
  ehBaseChapa,
  type Plano,
  type Referencia,
  type SuporteEsboco,
  type Vec3,
} from "./model";
import { Viewport, type Entidade, type EstiloExibicao, type IdReferencia, type TipoEntidade, type Vista } from "./viewport";
import { EditorEsboco, type Ferramenta, type Hospedeiro } from "./esboco/editor";
import { renderizarPainelEsboco } from "./esboco/painel";
import { eixoXParaNormal, escalar, paraMundo, planosResolvidos, referencial } from "./esboco/referencial";
import { desenharCota, textoCota } from "./esboco/cotas";
import { CotasNoModelo, type RotuloModelo } from "./ui/cotasModelo";
import { abrirCopias, abrirDoCofre, desligar, instalarPainelCofre, salvarNoCofre, sincronizarAoAbrir } from "./comum/cofre";
import { botaoDiagnostico, registrarMetrica } from "./comum/diagnostico";
import { Armazem } from "./comum/armazem";
import {
  ativarConfiguracao, capturarAtiva, configurarParametro, definirSupressao, definirValorNaConfiguracao, desconfigurarParametro,
  excluirConfiguracao, limparConfiguracoes, listarParametros, novaConfiguracao, PARAMETROS_RECURSO, prepararConfiguracoes,
  valorNaConfiguracao,
} from "./configuracoes";
import type * as THREE from "three";
import { SolverEsboco } from "./esboco/solver";
import { construirCamada, descartarCamada } from "./esboco/visual";
import { aninhamento, encontrarLacos } from "./esboco/geometria";
import * as op from "./esboco/operacoes";
import wasmPlaneGcs from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { esquemaDe, esquemaParametrosChapa, type DadosEsquema } from "./ui/esquemas";
import { ler, renderizarFormulario, type ContextoFormulario, type Esquema, type TipoSel } from "./ui/formulario";
import { aplicarEquacoes, avaliarExpressao, resolverVariaveis } from "./equacoes";
import type { Analise } from "./analises";
import { absorvidosDe, excluirRecursos, filhosDe } from "./dependencias";

const CHAVE_AUTOSAVE = "jlscad:documento";
const CHAVE_PREFS = "jlscad:interface";
// nome antigo do programa: traz o que estava guardado neste aparelho
try {
  for (const k of ["documento", "interface"]) {
    const antigo = localStorage.getItem(`cad-tablet:${k}`);
    if (antigo && !localStorage.getItem(`jlscad:${k}`)) localStorage.setItem(`jlscad:${k}`, antigo);
    localStorage.removeItem(`cad-tablet:${k}`);
  }
} catch {
  /* armazenamento indisponível */
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- preferências de interface (só deste aparelho) ----------
interface Prefs {
  aba: IdAba;
  estilo: EstiloExibicao;
  refsVisiveis: Record<IdReferencia, boolean>;
  refsOcultas: string[]; // planos/eixos de referência criados pelo usuário e ocultos
  /** Escolhido na janela inicial: adapta a interface só para esse tipo de operador. */
  dispositivo?: Dispositivo;
  /** Botões com menu ▾: última subfunção usada de cada um (id do botão → id da subfunção). */
  ultimoMenu?: Record<string, string>;
  /** Barra de vistas aberta (recolhida, só a setinha aparece). */
  barraVistasAberta?: boolean;
  /** Ocultar/mostrar itens: tipos ocultos de uma vez e "ocultar todos os tipos". */
  tiposOcultos?: TipoItem[];
  ocultarTudo?: boolean;
  /** Filtro de seleção: só estes tipos podem ser tocados no modelo (vazio = desligado). */
  filtroSelecao?: TipoFiltro[];
  filtroAnterior?: TipoFiltro[];
  /** Toque longo (caneta/dedo parado) abre o menu de contexto: tempo em ms (0 = desligado). */
  toqueLongoMs?: number;
  /** Comandos com caixa flutuante perto da peça (padrão: celular e tablet). */
  caixaFlutuante?: boolean;
  /** Onde a caixa flutuante foi largada pela última vez (px dentro do viewport). */
  posCaixaFlutuante?: { x: number; y: number };
}
type TipoFiltro = "face" | "aresta" | "vertice" | "plano" | "eixo" | "curva";
type TipoItem = "planos" | "eixos" | "origem" | "esbocos";
type Dispositivo = "celular" | "tablet" | "computador";
const prefs: Prefs = {
  aba: "features",
  estilo: "sombreado-arestas",
  refsVisiveis: { XZ: true, XY: true, YZ: true, origem: true },
  refsOcultas: [],
  ...lerJSON<Partial<Prefs>>(CHAVE_PREFS),
};
const salvarPrefs = () => gravarJSON(CHAVE_PREFS, prefs);

/** O tipo de item está oculto pela barra de vistas (por tipo ou por "ocultar todos os tipos")? */
const tipoOculto = (t: TipoItem) => !!prefs.ocultarTudo || (prefs.tiposOcultos ?? []).includes(t);

/** Planos padrão e origem: visibilidade de cada um (árvore) combinada com a dos tipos. */
function aplicarVisibilidadeRefs() {
  for (const id of Object.keys(prefs.refsVisiveis) as IdReferencia[]) {
    viewport.definirVisibilidadeReferencia(id, prefs.refsVisiveis[id] && !tipoOculto(id === "origem" ? "origem" : "planos"));
  }
}

// ---------- estado ----------
/** Item selecionado na árvore (recurso ou plano principal). */
type Selecao = { tipo: "feature"; id: string } | { tipo: "ref"; id: IdReferencia } | null;

interface ComandoAtivo {
  f: Feature;
  novo: boolean;
  snapshot: string;
  campo: { cam: string; aceita: TipoSel[]; multiplo: boolean } | null;
  aba?: string;
  recolhidas: Set<string>;
  /** "chapa": item "Chapa metálica" da árvore (só os parâmetros globais da flange base). */
  modo?: "chapa";
}

type FerramentaAvaliar =
  | { tipo: "medir"; refs: Referencia[] }
  | { tipo: "secao"; plano: Plano; desloc: number; inverter: boolean }
  | { tipo: "analise"; analise: Analise; plano: Plano };

/** Sem documento aberto o app mostra só a área de trabalho limpa (Novo / Abrir). */
let aberto = false;
let doc: Documento = documentoVazio();
/** Tempo (ms) da última reconstrução, para a janela de diagnóstico. */
let ultimaReconstrucao: number | null = null;
/** Malha triangulada da peça na última reconstrução (vai para o WJFlow). */
let ultimaMalha: ResultadoRegeneracao["malha"] = null;
let selecao: Selecao = null;
/** Outros itens da seleção múltipla da árvore (Ctrl/Shift); `selecao` é o último tocado. */
let selExtras: NonNullable<Selecao>[] = [];
function definirSel(s: Selecao) {
  selecao = s;
  selExtras = [];
}
/** Todos os itens selecionados na árvore, na ordem em que foram tocados. */
function selArvore(): NonNullable<Selecao>[] {
  const existe = (s: NonNullable<Selecao>) => s.tipo === "ref" || doc.features.some((f) => f.id === s.id);
  const lista = selExtras.filter(existe);
  if (selecao && existe(selecao)) lista.push(selecao);
  return lista;
}
/** Faces/arestas/vértices selecionados no modelo (pré-seleção para comandos). */
let selPeca: Referencia[] = [];
/** Ponto tocado na última face selecionada (posição inicial de furo). */
let pontoTocado: Vec3 | null = null;
let errosPorFeature = new Map<string, string>();
let tempos: { id: string; ms: number }[] = [];
let referenciasKernel: InfoReferencia[] = [];
/** Faces da peça final de cada recurso (destaque ao selecionar na árvore). */
let facesPorRecurso: Record<string, number[]> = {};
const historico: string[] = [];
const refazer: string[] = [];
let primeiraRegeneracao = true;
let estadoKernel: "iniciando" | "pronto" | "regenerando" | "erro" = "iniciando";
let editor: EditorEsboco | null = null;
/** Ao entrar no esboço guarda o documento para "descartar alterações". */
let snapshotEsboco: string | null = null;
/** Esboço aberto a partir das posições do furo: ao sair, volta ao painel do furo. */
let voltarParaFuro: string | null = null;
/** Comando de chapa (aba, corte, flange base) esperando o esboço: abre ao sair dele. */
let recursoAposEsboco: string | null = null;
/** Arestas escolhidas antes de abrir o esboço do perfil (meia-esquadria): voltam ao comando. */
let arestasAposEsboco: Referencia[] = [];
let comando: ComandoAtivo | null = null;
let avaliacao: FerramentaAvaliar | null = null;
/** Esperando o usuário tocar um plano/face para começar um esboço ou furo. */
let aguardando: { para: "esboco" | "furo"; ferramenta?: Ferramenta } | null = null;

const viewport = new Viewport($("viewport"));
const kernel = new ClienteKernel(aoRegenerar);

viewport.definirEstilo(prefs.estilo);
aplicarVisibilidadeRefs();
aplicarMaterial();

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
const featureSelecionada = () => doc.features.find((x) => x.id === idSelecionado());
const ativas = () => doc.features.slice(0, doc.retrocesso ?? doc.features.length);

// ---------- regeneração ----------
let temporizador: number | undefined;
function regenerar(atraso = 0) {
  clearTimeout(temporizador);
  temporizador = window.setTimeout(async () => {
    const { esbocosAlterados } = aplicarEquacoes(doc);
    if (esbocosAlterados.length) {
      const s = await obterSolver();
      for (const id of esbocosAlterados) {
        const e = doc.features.find((f) => f.id === id);
        if (e?.tipo === "esboco") s.resolver(e);
      }
    }
    if (estadoKernel === "pronto") estadoKernel = "regenerando";
    atualizarStatus();
    kernel.regenerar(ativas(), planificado, previaAtiva() ? comando!.f.id : undefined);
  }, atraso);
}

/** Prévia ligada: há um comando aberto e o recurso não pediu para escondê-la. */
function previaAtiva() {
  return !!comando && (comando.f as { mostrarPrevia?: boolean }).mostrarPrevia !== false;
}

function aoRegenerar(r: ResultadoRegeneracao, ms: number) {
  estadoKernel = "pronto";
  viewport.mostrarMalha(r.malha, r.topologia);
  ultimaMalha = r.malha;
  viewport.mostrarPrevia(previaAtiva() ? r.previaRemovido : null);
  if (primeiraRegeneracao && r.malha) {
    viewport.enquadrar(false);
    primeiraRegeneracao = false;
  }
  errosPorFeature = new Map(r.erros.map((e) => [e.id, e.mensagem]));
  tempos = r.tempos;
  referenciasKernel = r.referencias;
  facesPorRecurso = r.facesPorRecurso ?? {};
  planosResolvidos.clear();
  for (const ri of r.referencias) if (ri.tipo === "plano") planosResolvidos.set(ri.id, ri.ref);
  $("st-volume").textContent =
    r.volume !== null ? `Volume: ${(r.volume / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm³` : "";
  $("st-tempo").textContent = `Reconstrução: ${ms.toFixed(0)} ms`;
  ultimaReconstrucao = ms;
  atualizarStatus();
  renderizarArvore();
  if (!editor) desenharEsbocos();
  atualizarDestaques();
  if (comando) {
    const msg = errosPorFeature.get(comando.f.id);
    const el = $("painel-comando").querySelector<HTMLElement>(".prop-erro");
    if (msg && !el) renderizarComando();
    else if (el) msg ? (el.textContent = msg) : el.remove();
  }
  if (avaliacao?.tipo === "analise") mostrarLegendaAnalise();
  // cotas abertas sobre o modelo: refeitas na peça nova (posições mudam com os valores)
  if (recursoComCotas === TODAS_AS_COTAS) mostrarTodasAsCotas();
  else if (recursoComCotas) {
    const f = doc.features.find((x) => x.id === recursoComCotas);
    if (f) mostrarCotasNoModelo(f);
    else fecharCotasNoModelo();
  }
  atualizarAlcas();
}

function atualizarStatus() {
  // filtro de seleção ligado: aviso fixo na barra de status (toque desliga)
  const fs = $("st-filtro");
  fs.hidden = !filtroLigado();
  if (filtroLigado()) fs.textContent = `Filtro: ${prefs.filtroSelecao!.map((x) => TIPOS_FILTRO.find((y) => y[0] === x)![1].toLowerCase()).join(", ")} ✕`;
  const k = $("st-kernel");
  k.textContent = {
    iniciando: "Kernel: iniciando…",
    pronto: "Kernel: pronto",
    regenerando: "Reconstruindo…",
    erro: "Kernel: erro",
  }[estadoKernel];
  k.dataset.estado = estadoKernel;

  const nErros = errosPorFeature.size;
  let estado = aberto ? "Editando peça" : "Nenhum documento aberto";
  if (comando) estado = `${ROTULO_TIPO[comando.f.tipo]}: ${comando.f.nome}`;
  else if (selecao?.tipo === "ref") estado = `Selecionado: ${rotuloReferencia(selecao.id)}`;
  else if (selecao?.tipo === "feature") {
    const f = featureSelecionada();
    if (f) estado = `Selecionado: ${f.nome}`;
  }
  if (selPeca.length) estado = `${selPeca.length} entidade${selPeca.length > 1 ? "s" : ""} selecionada${selPeca.length > 1 ? "s" : ""}`;
  if (nErros) estado += ` · ${nErros} recurso${nErros > 1 ? "s" : ""} com erro`;
  if (doc.retrocesso !== undefined) estado += " · retrocedido";
  if (aguardando) estado = aguardando.para === "furo" ? "Furo: toque a face plana onde ficam os furos" : "Novo esboço: toque um plano na árvore ou uma face plana";
  if (editor) estado = `Editando ${editor.esb.nome} · ${editor.textoDefinicao}`;
  const st = $("st-estado");
  st.textContent = estado;
  st.classList.toggle("com-erro", !editor && nErros > 0);
  st.dataset.definicao = editor && editor.esb.geos.length ? editor.estado.definicao : "";
  const mat = doc.material ? MATERIAIS[doc.material] : undefined;
  $("st-material").textContent = !aberto ? "" : mat ? `${mat.nome} (${mat.densidade.toLocaleString("pt-BR")} g/cm³)` : "Material não especificado";
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
  if (selecao?.tipo === "feature" && !doc.features.some((f) => f.id === idSelecionado())) definirSel(null);
  if (comando) fecharComando();
  if (editor) {
    const e = doc.features.find((f): f is FeatureEsboco => f.id === editor!.esb.id && f.tipo === "esboco");
    if (e) editor.reatar(e);
    else sairEsboco();
  }
  $<HTMLInputElement>("nome-doc").value = doc.nome;
  aplicarMaterial();
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
const mapaAnalise: Record<Analise["tipo"], string> = {
  inclinacao: "analise-inclinacao", espessura: "analise-espessura", zebra: "zebra", curvatura: "curvatura",
};

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
    // botão com menu ▾: mostra (e executa) a última subfunção usada
    const atual = c.itens ? c.itens.find((i) => i.id === prefs.ultimoMenu?.[c.id]) ?? c.itens[0] : c;
    const b = botaoComando(atual, aba.id);
    if (c.itens) {
      // rótulo curto do grupo (cabe na faixa); o ícone e a dica são da subfunção atual
      const span = b.querySelector("span");
      if (span && !b.classList.contains("cmd-sair")) span.textContent = c.rotulo;
      b.title = `${atual.rotulo} — ${b.title}`;
    }
    if (!c.itens) {
      faixa.appendChild(b);
      continue;
    }
    const caixa = document.createElement("span");
    caixa.className = "cmd-menu";
    const seta = document.createElement("button");
    seta.className = "cmd-seta";
    seta.title = `${c.rotulo}: outras opções`;
    seta.setAttribute("aria-label", seta.title);
    seta.textContent = "▾";
    seta.onclick = () => abrirPopover(seta, c.itens!.map((it) => ({
      rotulo: it.emBreve ? `${it.rotulo} (em breve)` : it.rotulo,
      icone: it.icone,
      marcado: it.id === atual.id,
      acao: () => {
        // ações de um toque (Selecionar tudo) não viram o padrão do botão
        if (!it.emBreve && it.id !== "selecionarTudo") {
          prefs.ultimoMenu = { ...prefs.ultimoMenu, [c.id]: it.id };
          salvarPrefs();
          renderizarAbas();
        }
        executarComando(it, aba.id, seta);
      },
    })));
    caixa.append(b, seta);
    faixa.appendChild(caixa);
  }
}

/** Botão da faixa de comandos (estado "pressionado" da ferramenta/variante de esboço ativa). */
function botaoComando(c: Comando, aba: IdAba): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "cmd";
  b.title = c.fase ? `${c.dica} — chega na Fase ${c.fase}` : c.emBreve ? `${c.dica} — em breve` : c.dica;
  const sairDoEsboco = aba === "sketch" && c.id === "esboco" && editor;
  b.innerHTML = sairDoEsboco ? `${ICONES.concluir}<span>Sair do esboço</span>` : `${ICONES[c.icone]}<span>${c.rotulo}</span>`;
  if (c.fase || c.emBreve) {
    b.setAttribute("aria-disabled", "true");
    b.insertAdjacentHTML("beforeend", `<em class="selo">${c.fase ? `F${c.fase}` : "breve"}</em>`);
  }
  if (aba === "sketch" && editor) {
    const [ferr, variante] = c.id.split(":");
    const ativo = (ferr === editor.ferramenta && (!variante || editor.variante(ferr) === variante))
      || (c.id === "construcao" && editor.construcao);
    b.setAttribute("aria-pressed", String(ativo));
  }
  if (aba === "avaliar" && avaliacao) {
    const ativo = (c.id === "medir" && avaliacao.tipo === "medir") || (c.id === "vista-secao" && avaliacao.tipo === "secao") ||
      (avaliacao.tipo === "analise" && c.id === mapaAnalise[avaliacao.analise.tipo]);
    b.setAttribute("aria-pressed", String(ativo));
  }
  if (aba === "chapa" && c.id === "planificar") b.setAttribute("aria-pressed", String(planificado));
  if (sairDoEsboco) b.classList.add("cmd-sair");
  b.onclick = () => executarComando(c, aba, b);
  return b;
}

function executarComando(c: Comando, aba: IdAba, botao: HTMLElement) {
  if (c.fase) {
    avisar(`${c.rotulo}: previsto para a Fase ${c.fase} do roteiro.`);
    return;
  }
  if (c.emBreve) {
    avisar(`${c.rotulo}: em breve.`);
    return;
  }
  esconderBarraContexto();
  if (aba === "sketch") return void comandoEsboco(c, botao);
  if (aba === "avaliar") return comandoAvaliar(c.id);
  if (aba === "chapa" && ["planificar", "dxf", "material"].includes(c.id)) return comandoChapa(c.id);
  if (editor) sairEsboco();
  if (planificado) alternarPlanificado(false);
  if (comando) confirmarComando();
  criarRecurso(c.id);
}

// ---------- criação de recursos ----------

const TIPO_POR_COMANDO: Record<string, Exclude<Feature["tipo"], "esboco">> = {
  extrusao: "extrusao", corte: "extrusao", revolucao: "revolucao", "corte-revolucao": "revolucao",
  filete: "filete", chanfro: "chanfro", casca: "casca", nervura: "nervura", inclinacao: "inclinacao",
  furo: "furo", "padrao-linear": "padraoLinear", "padrao-circular": "padraoCircular", espelhar: "espelhar",
  plano: "planoRef", eixo: "eixoRef", varredura: "varredura", "corte-varredura": "varredura",
  loft: "loft", "corte-loft": "loft",
  "flange-base": "flangeBase", "flange-aresta": "flangeAresta", bainha: "bainha", "aba-chapa": "abaChapa", "corte-chapa": "corteChapa", dobra: "dobraEsboco", junta: "junta", "meia-esquadria": "meiaEsquadria",
  "fechar-canto": "fecharCanto", "alivio-canto": "alivioCanto", "quebrar-canto": "quebrarCanto",
  desdobrar: "desdobrar", dobrar: "dobrar", "converter-chapa": "converterChapa",
  helice: "curva", "curva-xyz": "curva", "curva-pontos": "curva", "curva-composta": "curva", "curva-projetada": "curva",
};

/** Modo de curva de cada item do menu Curvas ▾. */
const MODO_CURVA: Record<string, FeatureCurva["modo"]> = {
  helice: "helice", "curva-xyz": "xyz", "curva-pontos": "pontosRef", "curva-composta": "composta", "curva-projetada": "projetada",
};

function ultimoEsbocoLivre(): FeatureEsboco | null {
  const usados = new Set(doc.features.flatMap(esbocosAbsorvidos));
  const livres = ativas().filter((f): f is FeatureEsboco => f.tipo === "esboco" && !f.suprimida && !usados.has(f.id));
  return livres[livres.length - 1] ?? null;
}

function inserirFeature(f: Feature) {
  const pos = doc.retrocesso ?? doc.features.length;
  doc.features.splice(pos, 0, f);
  if (doc.retrocesso !== undefined) doc.retrocesso++;
}

function nomeNovo(tipo: Feature["tipo"]) {
  return doc.features.filter((f) => f.tipo === tipo).length + 1;
}

function criarRecurso(id: string) {
  // com a chapa já criada, a Flange base vira Aba (como nos CADs profissionais)
  if (id === "flange-base" && ativas().some((x) => ehBaseChapa(x) && !x.suprimida)) id = "aba-chapa";
  const tipo = TIPO_POR_COMANDO[id];
  if (!tipo) return;
  if (tipo === "furo") return iniciarFuro();
  const f = novaFeature(tipo, nomeNovo(tipo));
  // pré-seleção: itens da árvore (Ctrl/Shift soma) e geometria tocada no modelo
  const naArvore = selArvore();
  const featsSel = naArvore.flatMap((s) => (s.tipo === "feature" ? doc.features.filter((x) => x.id === s.id) : []));
  const esbocoSel = featsSel.find((x): x is FeatureEsboco => x.tipo === "esboco");
  const sel = esbocoSel ?? featureSelecionada();
  const faces = selPeca.filter((r) => r.tipo === "face");
  const itens = selPeca.filter((r) => r.tipo === "face" || r.tipo === "aresta");
  const planosArvore: Referencia[] = naArvore.flatMap((s): Referencia[] =>
    s.tipo === "ref" ? (s.id === "origem" ? [] : [{ tipo: "plano", id: s.id }])
      : featsSel.some((x) => x.id === s.id && x.tipo === "planoRef") ? [{ tipo: "plano", id: s.id }] : []);
  const eixosArvore: Referencia[] = featsSel.filter((x) => x.tipo === "eixoRef").map((x) => ({ tipo: "eixo", id: x.id }));
  const facesPlanas = faces.filter((r) => r.tipo === "face" && r.ass.geom === "plano");
  const planoSel: Referencia | undefined = planosArvore[0] ?? facesPlanas[0] ?? faces[0];
  const repetir = featsSel.filter((x) => REPETIVEIS.includes(x.tipo)).map((x) => x.id);
  switch (f.tipo) {
    case "extrusao":
    case "revolucao": {
      const perfil = (sel?.tipo === "esboco" ? sel : null) ?? ultimoEsbocoLivre();
      if (perfil) f.esboco = perfil.id;
      if (f.tipo === "revolucao") {
        // eixo pré-selecionado: eixo de referência na árvore ou aresta do modelo
        const ax = eixosArvore[0] ?? selPeca.find((r) => r.tipo === "aresta");
        if (ax) f.eixo = ax;
      }
      if (id === "corte" || id === "corte-revolucao") {
        f.operacao = "cortar";
        f.nome = f.tipo === "extrusao" ? `Corte${nomeNovo("extrusao")}` : `CorteRevolução${nomeNovo("revolucao")}`;
        if (f.tipo === "extrusao") {
          f.inverter = true; // corte entra no material: contra a normal do esboço
          if (!perfil) {
            f.perfil = { tipo: "circulo", diametro: 10 };
            f.deslocamento = 30;
          }
        }
      }
      if (!perfil) avisar("Sem esboço livre: usando perfil rápido. Para perfil próprio, crie um esboço (aba Sketch).");
      break;
    }
    case "varredura": {
      if (id === "corte-varredura") {
        f.operacao = "cortar";
        f.nome = `CorteVarredura${nomeNovo("varredura")}`;
      }
      // pré-seleção na ordem tocada: 1º esboço fechado = perfil, o próximo = trajetória,
      // os demais = curvas-guia; sem esboço de trajetória, arestas do modelo selecionadas
      const esbs = featsSel.filter((x): x is FeatureEsboco => x.tipo === "esboco");
      const fechado = (e: FeatureEsboco) => {
        try {
          return encontrarLacos(e).length > 0;
        } catch {
          return false;
        }
      };
      const perfil = esbs.find(fechado);
      if (perfil) f.perfil = { tipo: "esboco", id: perfil.id };
      const resto = esbs.filter((e) => e !== perfil);
      const arestas = selPeca.filter((r) => r.tipo === "aresta");
      if (resto.length) f.trajetoria = [{ tipo: "esboco", id: resto[0].id }];
      else if (arestas.length) f.trajetoria = arestas;
      f.guias = resto.slice(1).map((e) => ({ tipo: "esboco", id: e.id }));
      break;
    }
    case "loft": {
      if (id === "corte-loft") {
        f.operacao = "cortar";
        f.nome = `CorteLoft${nomeNovo("loft")}`;
      }
      // esboços selecionados (Ctrl/Shift, na ordem tocada) viram os perfis
      f.perfis = featsSel.filter((x) => x.tipo === "esboco").map((x) => ({ tipo: "esboco", id: x.id }));
      break;
    }
    case "filete":
    case "chanfro":
      f.itens = itens;
      break;
    case "casca":
      f.faces = faces;
      break;
    case "inclinacao":
      // plano neutro: plano escolhido na árvore; faces: as tocadas no modelo
      f.faces = faces;
      f.planoNeutro = planosArvore[0] ?? { tipo: "plano", id: "XZ" }; // Superior
      break;
    case "flangeBase":
    case "abaChapa":
    case "corteChapa":
    case "dobraEsboco":
    case "junta": {
      const perfil = (sel?.tipo === "esboco" ? sel : null) ?? ultimoEsbocoLivre();
      if (!perfil) {
        // sem esboço: pede o plano/face, abre o esboço e, ao sair dele, volta para este comando
        recursoAposEsboco = id;
        definirSel(null);
        void iniciarEsboco().then((abriu) => {
          const oque = f.tipo === "dobraEsboco" || f.tipo === "junta" ? "a linha da dobra" : "o contorno fechado";
          avisar(abriu
            ? `${ROTULO_TIPO[f.tipo]}: desenhe ${oque}. Ao sair do esboço, o comando abre com ele.`
            : `${ROTULO_TIPO[f.tipo]}: toque uma face plana da chapa (ou um plano) para desenhar ${oque}.`);
        });
        return;
      }
      f.esboco = perfil.id;
      break;
    }
    case "nervura": {
      const perfil = (sel?.tipo === "esboco" ? sel : null) ?? ultimoEsbocoLivre();
      if (perfil) f.esboco = perfil.id;
      break;
    }
    case "flangeAresta":
    case "bainha":
      f.arestas = selPeca.filter((r) => r.tipo === "aresta");
      break;
    case "quebrarCanto":
      f.arestas = selPeca.filter((r) => r.tipo === "aresta" || r.tipo === "vertice");
      break;
    case "converterChapa":
      // seleção feita antes: 1ª face = face fixa, arestas = dobras
      f.faceFixa = faces[0];
      f.arestas = selPeca.filter((r) => r.tipo === "aresta");
      break;
    case "desdobrar":
      f.faceFixa = faces.find((r) => r.tipo === "face" && r.ass.geom === "plano");
      f.dobras = faces.filter((r) => r.tipo === "face" && r.ass.geom === "cilindro");
      if (f.dobras.length) f.todas = false;
      break;
    case "meiaEsquadria": {
      f.arestas = selPeca.filter((r) => r.tipo === "aresta");
      const perfil = (sel?.tipo === "esboco" ? sel : null) ?? ultimoEsbocoLivre();
      if (!perfil) {
        const a0 = f.arestas[0];
        if (!a0 || a0.tipo !== "aresta" || a0.ass.geom !== "linha") {
          return avisar("Flange de meia-esquadria: selecione a aresta reta da chapa onde o perfil começa (Ctrl/Shift soma as outras) e toque o comando de novo.");
        }
        // como nos CADs profissionais: esboço num plano perpendicular à aresta, na ponta dela
        const p = a0.ass.a, q = a0.ass.b;
        const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        const n: Vec3 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L, (q[2] - p[2]) / L];
        recursoAposEsboco = id;
        arestasAposEsboco = f.arestas;
        definirSel(null);
        limparSelPeca();
        void suporteEscolhido({ tipo: "face", origem: p, normal: n, eixoX: eixoXParaNormal(n) }, null).then(() =>
          avisar("Meia-esquadria: desenhe o perfil aberto (linhas) começando na origem do esboço, que está na ponta da aresta. Ao sair do esboço, o comando abre."));
        return;
      }
      f.esboco = perfil.id;
      break;
    }
    case "padraoLinear":
    case "padraoCircular":
    case "espelhar":
      // recursos já selecionados entram direto na lista (vários com Ctrl/Shift)
      f.recursos = repetir;
      if (f.tipo === "padraoLinear") {
        const dir = selPeca.find((r) => r.tipo === "aresta") ?? eixosArvore[0] ?? planosArvore[0];
        if (dir) f.dir1.ref = dir;
      }
      if (f.tipo === "padraoCircular") {
        const ax = eixosArvore[0] ?? selPeca.find((r) => r.tipo === "aresta" || r.tipo === "face");
        if (ax) f.eixo = ax;
      }
      if (f.tipo === "espelhar") f.plano = planoSel ?? { tipo: "plano", id: "YZ" };
      break;
    case "planoRef": {
      const planos = [...planosArvore, ...facesPlanas];
      f.ref1 = planos[0] ?? { tipo: "plano", id: "XZ" }; // Superior
      // dois planos: plano médio; plano + aresta/eixo: em ângulo
      const linha = selPeca.find((r) => r.tipo === "aresta") ?? eixosArvore[0];
      if (planos.length >= 2) {
        f.modo = "medio";
        f.ref2 = planos[1];
      } else if (linha) {
        f.modo = "angulo";
        f.ref2 = linha;
      }
      break;
    }
    case "eixoRef": {
      const planos = [...planosArvore, ...facesPlanas];
      const vertices = selPeca.filter((x) => x.tipo === "vertice");
      const r = selPeca.find((x) => x.tipo !== "vertice" && !(x.tipo === "face" && x.ass.geom === "plano"));
      if (planos.length >= 2) {
        f.modo = "doisPlanos";
        f.ref1 = planos[0];
        f.ref2 = planos[1];
      } else if (vertices.length >= 2) {
        f.modo = "doisPontos";
        f.ref1 = vertices[0];
        f.ref2 = vertices[1];
      } else if (r) {
        f.ref1 = r;
        if (r.tipo === "face") f.modo = r.ass.geom === "cilindro" ? "cilindro" : "aresta";
      }
      break;
    }
    case "curva": {
      f.modo = MODO_CURVA[id];
      // pré-seleção: esboço (base da hélice / esboço a projetar), vértices, arestas e faces tocados
      const esb = esbocoSel ?? ultimoEsbocoLivre();
      if (f.modo === "helice" && esb) f.base = { tipo: "esboco", id: esb.id };
      if (f.modo === "projetada") {
        if (esbocoSel) f.esboco = { tipo: "esboco", id: esbocoSel.id };
        f.faces = faces;
      }
      if (f.modo === "pontosRef") f.pontos = selPeca.filter((x) => x.tipo === "vertice");
      if (f.modo === "composta") {
        f.itens = [
          ...featsSel.flatMap((x): Referencia[] => (x.tipo === "esboco" ? [{ tipo: "esboco", id: x.id }] : x.tipo === "curva" ? [{ tipo: "curva", id: x.id }] : [])),
          ...selPeca.filter((x) => x.tipo === "aresta"),
        ];
      }
      break;
    }
  }
  limparSelPeca();
  inserirFeature(f);
  abrirComando(f, true);
}

/** Tipos de recurso que padrões e espelhar sabem repetir. */
const REPETIVEIS: Feature["tipo"][] = ["extrusao", "revolucao", "varredura", "loft", "furo", "nervura", "padraoLinear", "padraoCircular", "espelhar"];

/**
 * Com um padrão/espelhar aberto, tocar um recurso (anterior) na árvore o põe ou tira da lista
 * "Recursos", sem precisar ativar a caixa — como nos CADs profissionais.
 */
function alternarRecursoNoComando(x: Feature): boolean {
  const c = comando;
  if (!c || editor || !("recursos" in c.f) || x.id === c.f.id) return false;
  if (!REPETIVEIS.includes(x.tipo) || doc.features.indexOf(x) > doc.features.indexOf(c.f)) return false;
  const lista = c.f.recursos;
  const i = lista.indexOf(x.id);
  if (i >= 0) lista.splice(i, 1);
  else lista.push(x.id);
  salvarAutosave();
  regenerar(80);
  renderizarComando();
  renderizarArvore();
  return true;
}

// ---------- painel de comando ----------

function dadosEsquema(f: Feature): DadosEsquema {
  const idx = doc.features.indexOf(f);
  const antes = doc.features.slice(0, idx < 0 ? undefined : idx);
  return {
    esbocosAntes: antes.filter((x) => x.tipo === "esboco").map((x) => [x.id, x.nome]),
    recursosAntes: antes.filter((x) => REPETIVEIS.includes(x.tipo)).map((x) => [x.id, x.nome]),
    linhasEsboco: (id) => {
      const e = doc.features.find((x) => x.id === id);
      if (e?.tipo !== "esboco") return [];
      let n = 0, nc = 0;
      return e.geos.filter((g) => g.tipo === "linha").map((g) => [g.id, g.construcao ? `Linha de centro ${++nc}` : `Linha ${++n}`]);
    },
    contornos: (id) => {
      const e = doc.features.find((x) => x.id === id);
      if (e?.tipo !== "esboco") return [];
      try {
        const ls = encontrarLacos(e);
        const prof = aninhamento(ls);
        return ls.map((_, i) => [String(i), `Contorno ${i + 1}${prof[i] % 2 ? " (furo)" : ""}`]);
      } catch {
        return [];
      }
    },
    editarPosicoesFuro: (fu) => {
      const e = doc.features.find((x): x is FeatureEsboco => x.id === fu.esboco && x.tipo === "esboco");
      if (!e) return avisar("O esboço de posições não existe mais.");
      voltarParaFuro = fu.id;
      confirmarComando();
      void editarEsboco(e, "ponto");
    },
  };
}

/** Esquema do painel do comando ativo (o item "Chapa metálica" mostra só os parâmetros da chapa). */
function esquemaComando(c: { f: Feature; modo?: "chapa" }): Esquema<Feature> {
  return c.modo === "chapa" ? esquemaParametrosChapa() : (esquemaDe(c.f, dadosEsquema(c.f)) as Esquema<Feature>);
}

function abrirComando(f: Feature, novo: boolean, modo?: "chapa") {
  if (editor) sairEsboco();
  fecharCotasNoModelo();
  fecharAvaliacao();
  comando = {
    f, novo, snapshot: JSON.stringify(doc), campo: null, recolhidas: new Set(),
    aba: f.tipo === "furo" ? "Tipo" : undefined, modo,
  };
  // campo de seleção ativo: o primeiro vazio
  const esq = esquemaComando(comando);
  for (const cx of esq.caixas) {
    if (cx.aba && cx.aba !== comando.aba) continue;
    if (cx.vis && !cx.vis(f)) continue;
    for (const c of cx.campos) {
      if (c.t !== "refs" || (c.vis && !c.vis(f))) continue;
      const v = ler(f, c.cam);
      if (!v || (Array.isArray(v) && !v.length)) {
        comando.campo = { cam: c.cam, aceita: c.aceita, multiplo: c.multiplo };
        break;
      }
    }
    if (comando.campo) break;
  }
  definirSel({ tipo: "feature", id: f.id });
  mostrarPainel("comando");
  renderizarComando();
  // celular: comando começa pedindo geometria → modelo livre para tocar
  if (comando.campo) recolherGavetaParaSelecionar();
  regenerar();
  atualizarStatus();
  renderizarArvore();
}

function renderizarComando() {
  if (!comando) return;
  const c = comando;
  const esq = esquemaComando(c);
  const ctx: ContextoFormulario = {
    erro: errosPorFeature.get(c.f.id),
    aoMudar: (final) => {
      salvarAutosave();
      regenerarPrevia(final ? 80 : 300);
      if (final) renderizarComando();
      renderizarArvore();
    },
    ok: confirmarComando,
    cancelar: cancelarComando,
    campoAtivo: c.campo?.cam ?? null,
    ativarCampo: (cam, aceita, multiplo) => {
      c.campo = cam ? { cam, aceita, multiplo } : null;
      renderizarComando();
      // celular: campo de seleção ativo → recolhe a gaveta para tocar no modelo
      if (cam) recolherGavetaParaSelecionar();
    },
    rotuloRef,
    realcarRef: (r) => atualizarDestaques(r),
    equacao: (cam) => doc.equacoes?.[`${c.f.id}.${cam}`],
    definirEquacao: (cam, expr) => {
      const k = `${c.f.id}.${cam}`;
      doc.equacoes ??= {};
      if (expr) doc.equacoes[k] = expr;
      else delete doc.equacoes[k];
    },
    avaliar: (t) => avaliarExpressao(t, resolverVariaveis(doc.variaveis).valores),
    abaAtiva: c.aba,
    mudarAba: (a) => {
      c.aba = a;
      renderizarComando();
    },
    recolhidas: c.recolhidas,
  };
  renderizarFormulario($("painel-comando"), c.f, esq, ctx);
  const apareceu = renderizarCaixaFlutuante(esq, ctx);
  atualizarDestaques();
  atualizarAlcas();
  if (apareceu) posicionarCaixaFlutuante();
}

// ---------- caixa flutuante do comando (celular/tablet: opções perto da peça) ----------

/** Comandos com caixa flutuante (piloto: extrusão) e as caixas do painel que ela repete. */
const CAIXAS_FLUTUANTES: Partial<Record<Feature["tipo"], string[]>> = { extrusao: ["Direção 1", "Direção 2"] };

const caixaFlutuante = Object.assign(document.createElement("div"), { className: "caixa-flutuante", hidden: true });
$("viewport").parentElement!.appendChild(caixaFlutuante);

function caixasFlutuantesDoComando(): string[] | undefined {
  return comando && !comando.modo && caixaFlutuanteLigada() ? CAIXAS_FLUTUANTES[comando.f.tipo] : undefined;
}

/** Desenha a caixa com as opções principais do comando; true se ela acabou de aparecer. */
function renderizarCaixaFlutuante(esq: Esquema<Feature>, ctx: ContextoFormulario): boolean {
  const titulos = caixasFlutuantesDoComando();
  if (!comando || !titulos) {
    esconderCaixaFlutuante();
    return false;
  }
  const estava = !caixaFlutuante.hidden;
  renderizarFormulario(caixaFlutuante, comando.f, { titulo: esq.titulo, caixas: esq.caixas.filter((x) => titulos.includes(x.titulo)) }, ctx);
  const cab = caixaFlutuante.querySelector<HTMLElement>(".pc-cabecalho")!;
  cab.classList.add("cf-alca");
  cab.title = "Arraste para mudar a caixa de lugar";
  if (prefs.dispositivo === "celular") {
    const tudo = document.createElement("button");
    tudo.className = "cf-tudo";
    tudo.textContent = "☰";
    tudo.title = "Todas as opções (painel completo)";
    tudo.onclick = () => abrirGaveta(true);
    cab.insertBefore(tudo, cab.querySelector(".pc-ok"));
  }
  arrastarCaixaFlutuante(cab);
  caixaFlutuante.hidden = false;
  $("canto-confirmacao").hidden = true; // ✓/✕ já estão na caixa
  return !estava;
}

function esconderCaixaFlutuante() {
  if (!caixaFlutuante.hidden && comando) $("canto-confirmacao").hidden = false;
  caixaFlutuante.hidden = true;
  caixaFlutuante.innerHTML = "";
}

/** Na posição largada da última vez; sem ela, ao lado da peça na tela (sem cobri-la), na altura da seta. */
function posicionarCaixaFlutuante() {
  if (prefs.posCaixaFlutuante) return colocarCaixaFlutuante(prefs.posCaixaFlutuante.x, prefs.posCaixaFlutuante.y);
  const area = caixaFlutuante.parentElement!.getBoundingClientRect();
  const w = caixaFlutuante.offsetWidth, h = caixaFlutuante.offsetHeight;
  const peca = viewport.retanguloDaPeca();
  const alca = posicaoDaAlca ? viewport.mundoParaTela(posicaoDaAlca) : null;
  const y = (alca?.y ?? (peca ? (peca.y0 + peca.y1) / 2 : 64)) - h / 2;
  // direita da peça (abaixo do canto ✓/✕), senão esquerda, senão canto inferior direito
  const direita = Math.max(peca?.x1 ?? 0, alca?.x ?? 0) + 24;
  const esquerda = Math.min(peca?.x0 ?? area.width, alca?.x ?? area.width) - 24 - w;
  if (direita + w <= area.width - 70) colocarCaixaFlutuante(direita, y);
  else if (esquerda >= 6) colocarCaixaFlutuante(esquerda, y);
  else colocarCaixaFlutuante(area.width - w - 12, area.height - h - 12);
}

function colocarCaixaFlutuante(x: number, y: number) {
  const area = caixaFlutuante.parentElement!.getBoundingClientRect();
  const w = caixaFlutuante.offsetWidth, h = caixaFlutuante.offsetHeight;
  x = Math.max(6, Math.min(x, area.width - w - 6));
  y = Math.max(56, Math.min(y, area.height - h - 6));
  caixaFlutuante.style.left = `${x}px`;
  caixaFlutuante.style.top = `${y}px`;
  return { x, y };
}

/** O cabeçalho arrasta a caixa (dedo, caneta ou mouse); a posição fica guardada nas preferências. */
function arrastarCaixaFlutuante(cab: HTMLElement) {
  cab.onpointerdown = (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    cab.setPointerCapture(e.pointerId);
    const x0 = caixaFlutuante.offsetLeft - e.clientX, y0 = caixaFlutuante.offsetTop - e.clientY;
    cab.onpointermove = (m) => colocarCaixaFlutuante(x0 + m.clientX, y0 + m.clientY);
    cab.onpointerup = cab.onpointercancel = () => {
      cab.onpointermove = cab.onpointerup = cab.onpointercancel = null;
      prefs.posCaixaFlutuante = { x: caixaFlutuante.offsetLeft, y: caixaFlutuante.offsetTop };
      salvarPrefs();
    };
  };
}

function confirmarComando() {
  if (!comando) return;
  const f = comando.f;
  // como nos CADs profissionais, o OK só vale com a seleção obrigatória feita
  if ((f.tipo === "flangeBase" || f.tipo === "abaChapa" || f.tipo === "corteChapa" || f.tipo === "dobraEsboco" || f.tipo === "junta") && !f.esboco) {
    return avisar(`${ROTULO_TIPO[f.tipo]}: escolha o esboço (ou ✕ e desenhe um numa face da chapa).`);
  }
  if ((f.tipo === "flangeAresta" || f.tipo === "bainha") && !f.arestas.length) {
    return avisar(`${ROTULO_TIPO[f.tipo]}: toque nas arestas da chapa.`);
  }
  if (f.tipo === "converterChapa" && (!f.faceFixa || !f.arestas.length)) {
    return avisar("Converter em chapa: escolha a face fixa e as arestas de dobra do sólido.");
  }
  if (f.tipo === "desdobrar" && !f.todas && !f.dobras.length) {
    return avisar("Desdobrar: toque nas faces curvas das dobras (ou marque Coletar todas as dobras).");
  }
  if (f.tipo === "quebrarCanto" && !f.arestas.length) {
    return avisar("Quebrar canto: toque nas arestas da espessura (ou nos vértices) dos cantos da chapa.");
  }
  if (f.tipo === "meiaEsquadria" && (!f.esboco || !f.arestas.length)) {
    return avisar("Flange de meia-esquadria: escolha o esboço do perfil e as arestas.");
  }
  fecharComando();
  registrarPasso();
  salvarAutosave();
  definirSel({ tipo: "feature", id: f.id });
  renderizarTudo();
  regenerar();
}

function cancelarComando() {
  if (!comando) return;
  doc = JSON.parse(comando.snapshot);
  const novo = comando.novo;
  fecharComando();
  if (novo) definirSel(null);
  salvarAutosave();
  renderizarTudo();
  regenerar();
}

function fecharComando() {
  comando = null;
  esconderCaixaFlutuante();
  cotasDoComando.limpar();
  viewport.mostrarPrevia(null);
  viewport.mostrarAlcas([]);
  mostrarPainel(editor ? "esboco" : "arvore");
  atualizarDestaques();
}

/** Mostra árvore ou painel no lado esquerdo; durante comandos a árvore flutua no viewport. */
function mostrarPainel(modo: "arvore" | "comando" | "esboco") {
  const emComando = modo !== "arvore";
  $("arvore").hidden = emComando;
  $("painel-comando").hidden = !emComando;
  $("arvore-flutuante").hidden = !emComando;
  $("arvore-mini").hidden = true;
  $("canto-confirmacao").hidden = !emComando;
  if (!emComando) $("painel-comando").innerHTML = "";
  // celular: o painel do comando abre a gaveta (menos com a caixa flutuante); esboço e árvore deixam o modelo livre
  abrirGaveta(modo === "comando" && !caixasFlutuantesDoComando());
}

$("st-filtro").onclick = () => {
  prefs.filtroAnterior = prefs.filtroSelecao;
  alternarFiltro("limpar");
};
$("cc-ok").onclick = () => (editor ? sairEsboco() : avaliacao && !comando ? fecharAvaliacaoMantendo() : confirmarComando());
$("cc-cancelar").onclick = () => (editor ? descartarEsboco() : avaliacao && !comando ? fecharAvaliacao() : cancelarComando());
$("btn-arvore-flutuante").innerHTML = ICONES.peca;
$("btn-arvore-flutuante").onclick = () => {
  const mini = $("arvore-mini");
  mini.hidden = !mini.hidden;
  if (!mini.hidden) renderizarArvore();
};

// ---------- referências ↔ entidades na tela ----------

function rotuloReferencia(id: IdReferencia) {
  return id === "origem" ? "Origem" : `Plano ${NOME_PLANO[id]}`;
}

function rotuloRef(r: Referencia, i: number): string {
  switch (r.tipo) {
    case "face": return `Face<${i + 1}>`;
    case "aresta": return `Aresta<${i + 1}>`;
    case "vertice": return `Vértice<${i + 1}>`;
    case "plano": return ["XY", "XZ", "YZ"].includes(r.id) ? `Plano ${NOME_PLANO[r.id as Plano]}` : doc.features.find((f) => f.id === r.id)?.nome ?? "Plano?";
    case "eixo": return ["X", "Y", "Z"].includes(r.id) ? `Eixo ${r.id}` : doc.features.find((f) => f.id === r.id)?.nome ?? "Eixo?";
    case "esboco": return doc.features.find((f) => f.id === r.id)?.nome ?? "Esboço?";
    case "linhaEsboco": return "Linha do esboço";
    case "recurso": return doc.features.find((f) => f.id === r.id)?.nome ?? "Recurso?";
    case "curva": return doc.features.find((f) => f.id === r.id)?.nome ?? "Curva?";
  }
}

const d3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function entidadeDeRef(r: Referencia): Entidade | null {
  const t = viewport.topologia;
  if (!t) return null;
  let melhor = -1, dm = Infinity;
  if (r.tipo === "face") {
    t.faces.forEach((f, i) => {
      if (f.geom !== r.ass.geom) return;
      const d = d3(f.centro, r.ass.centro) + Math.abs(f.area - r.ass.area) / Math.max(1, Math.sqrt(r.ass.area));
      if (d < dm) { dm = d; melhor = i; }
    });
    return melhor >= 0 && dm < Math.max(2, 0.25 * Math.sqrt(r.ass.area)) ? { tipo: "face", indice: melhor } : null;
  }
  if (r.tipo === "aresta") {
    t.arestas.forEach((a, i) => {
      const d = d3(a.meio, r.ass.meio) + Math.abs(a.comprimento - r.ass.comprimento) * 0.5;
      if (d < dm) { dm = d; melhor = i; }
    });
    return melhor >= 0 && dm < Math.max(1, 0.3 * r.ass.comprimento) ? { tipo: "aresta", indice: melhor } : null;
  }
  if (r.tipo === "vertice") {
    t.vertices.forEach((v, i) => {
      const d = d3(v, r.p);
      if (d < dm) { dm = d; melhor = i; }
    });
    return melhor >= 0 && dm < 1e-3 ? { tipo: "vertice", indice: melhor } : null;
  }
  return null;
}

function refDeEntidade(e: Entidade): Referencia | null {
  const t = viewport.topologia;
  if (!t) return null;
  if (e.tipo === "face") return { tipo: "face", ass: t.faces[e.indice] };
  if (e.tipo === "aresta") return { tipo: "aresta", ass: t.arestas[e.indice] };
  return { tipo: "vertice", p: t.vertices[e.indice] };
}

const mesmaRef = (a: Referencia, b: Referencia) => JSON.stringify(a) === JSON.stringify(b);

/** Refs que o comando ativo usa (para pintar no modelo). */
function refsDoComando(): Referencia[] {
  if (!comando) return [];
  const esq = esquemaComando(comando);
  const out: Referencia[] = [];
  for (const cx of esq.caixas) {
    if (cx.vis && !cx.vis(comando.f)) continue;
    for (const c of cx.campos) {
      if (c.t !== "refs" || (c.vis && !c.vis(comando.f))) continue;
      const v = ler(comando.f, c.cam);
      if (Array.isArray(v)) out.push(...(v as Referencia[]));
      else if (v) out.push(v as Referencia);
    }
  }
  return out;
}

function refsDestacadas(): Referencia[] {
  return comando ? refsDoComando() : avaliacao?.tipo === "medir" ? avaliacao.refs : selPeca;
}

function atualizarDestaques(realce: Referencia | null = null) {
  const refs = refsDestacadas();
  const ents = refs.map(entidadeDeRef).filter((e): e is Entidade => !!e);
  viewport.destacarEntidades(ents, realce ? entidadeDeRef(realce) : null, facesDosSelecionados(), facesDaPrevia());
  // planos de referência usados pelo comando aparecem destacados
  const planoUsado = refs.find((r): r is Extract<Referencia, { tipo: "plano" }> => r.tipo === "plano");
  const principal = planoUsado && ["XY", "XZ", "YZ"].includes(planoUsado.id) ? (planoUsado.id as Plano) : null;
  viewport.destacarReferencia(principal ?? (selecao?.tipo === "ref" ? selecao.id : null));
  mostrarReferenciasExtras(planoUsado && !principal ? planoUsado.id : undefined);
}

/** Faces dos recursos selecionados na árvore (fora de comandos): mostram onde eles estão. */
/** Faces criadas pelo recurso em edição (prévia em âmbar, antes do OK). */
function facesDaPrevia(): Entidade[] {
  if (!previaAtiva()) return [];
  return (facesPorRecurso[comando!.f.id] ?? []).map((indice) => ({ tipo: "face" as const, indice }));
}

function facesDosSelecionados(): Entidade[] {
  if (comando || editor) return [];
  const ids = new Set(selArvore().filter((s) => s.tipo === "feature").map((s) => s.id));
  // esboço selecionado: destaca o recurso que o consome
  for (const f of doc.features) if (esbocosAbsorvidos(f).some((e) => ids.has(e))) ids.add(f.id);
  return [...ids].flatMap((id) => (facesPorRecurso[id] ?? []).map((indice) => ({ tipo: "face" as const, indice })));
}

function mostrarReferenciasExtras(destaque?: string) {
  const sel = destaque ?? idSelecionado();
  const tipo = new Map(referenciasKernel.map((r) => [r.id, r.tipo]));
  viewport.mostrarReferenciasExtras(
    referenciasKernel,
    (id) => !prefs.refsOcultas.includes(id) && !tipoOculto(tipo.get(id) === "eixo" ? "eixos" : "planos"),
    sel ?? null,
  );
}

// ---------- toques no modelo ----------

function filtroEntidades(aceita: TipoSel[]): Set<TipoEntidade> {
  const s = new Set<TipoEntidade>();
  if (aceita.includes("face") || aceita.includes("plano")) s.add("face");
  if (aceita.includes("aresta") || aceita.includes("eixo")) s.add("aresta");
  if (aceita.includes("vertice")) s.add("vertice");
  return s;
}

const TODAS: Set<TipoEntidade> = new Set(["face", "aresta", "vertice"]);

// ---------- filtro de seleção ----------

const TIPOS_FILTRO: [TipoFiltro, string, NomeIcone, string][] = [
  ["face", "Faces", "face", "X"], ["aresta", "Arestas", "aresta", "E"], ["vertice", "Vértices", "vertice", "V"],
  ["plano", "Planos", "plano", ""], ["eixo", "Eixos", "eixoRef", ""], ["curva", "Curvas 3D", "helice", ""],
];
const filtroLigado = () => !!prefs.filtroSelecao?.length;
/** Tira do conjunto pedido os tipos que o filtro de seleção bloqueia. */
function filtrar(s: Set<TipoEntidade>): Set<TipoEntidade> {
  if (!filtroLigado()) return s;
  return new Set([...s].filter((t) => prefs.filtroSelecao!.includes(t)));
}
const refPermitida = (tipo: "plano" | "eixo" | "curva") => !filtroLigado() || prefs.filtroSelecao!.includes(tipo);

function alternarFiltro(t: TipoFiltro | "limpar") {
  if (t === "limpar") prefs.filtroSelecao = [];
  else {
    const l = new Set(prefs.filtroSelecao ?? []);
    if (l.has(t)) l.delete(t);
    else l.add(t);
    prefs.filtroSelecao = [...l];
  }
  salvarPrefs();
  renderizarBarraVistas();
  atualizarStatus();
  const lig = prefs.filtroSelecao!;
  avisar(lig.length ? `Filtro de seleção: só ${lig.map((x) => TIPOS_FILTRO.find((y) => y[0] === x)![1].toLowerCase()).join(", ")}` : "Filtro de seleção desligado: tudo pode ser selecionado.");
}

function abrirFiltroSelecao(b: HTMLElement) {
  abrirPopover(b, [
    ...TIPOS_FILTRO.map(([t, r, ic, k]) => ({
      rotulo: `${r}${k ? `  ·  ${k}` : ""}`,
      icone: ic,
      marcado: !!prefs.filtroSelecao?.includes(t),
      acao: () => alternarFiltro(t),
    })),
    { rotulo: "Limpar filtros", icone: "fechar" as NomeIcone, acao: () => alternarFiltro("limpar") },
  ]);
}

function instalarToqueCurto() {
  viewport.aoToqueDuplo = (e) => {
    // duplo clique numa face: mostra as cotas do recurso que a criou, para editar no modelo
    if (editor || comando || aguardando) return;
    const ent = viewport.picarEntidade(e.clientX, e.clientY, new Set<TipoEntidade>(["face"]), e.pointerType === "touch" ? 22 : 9);
    const f = ent?.tipo === "face" ? recursoDaFace(ent.indice) : null;
    if (!f) {
      fecharCotasNoModelo();
      viewport.enquadrar();
      return;
    }
    esconderBarraContexto();
    limparSelPeca();
    definirSel({ tipo: "feature", id: f.id });
    renderizarTudo();
    mostrarCotasNoModelo(f);
  };
  viewport.aoToqueCurto = (e) => {
    const tol = e.pointerType === "touch" ? 22 : 9;
    esconderBarraContexto();
    if (!comando) fecharCotasNoModelo();
    const refBruta = viewport.picarReferencia(e.clientX, e.clientY, tol);
    // escolher plano/face para um esboço não passa pelo filtro; o resto, sim
    const refViewport = refBruta && (aguardando || refPermitida(refBruta.tipo)) ? refBruta : null;
    // prioridade sobre a peça: borda de qualquer plano, ou a área de um plano/eixo criado pelo
    // usuário que esteja na frente (os planos principais atravessam a peça: só pela borda)
    const refPrioritaria = refViewport && (refViewport.borda || !["XY", "XZ", "YZ"].includes(refViewport.id)) ? refViewport : null;
    if (aguardando) {
      if (refPrioritaria?.tipo === "plano") return void suporteEscolhido(suporteDoPlano(refPrioritaria.id), null);
      const face = viewport.picarFace(e.clientX, e.clientY);
      if (face) return void suporteEscolhido(faceComoSuporte(face.origem, face.normal), face.origem);
      if (refViewport?.tipo === "plano") return void suporteEscolhido(suporteDoPlano(refViewport.id), null);
      return avisar("Toque uma face plana ou um plano.");
    }
    if (comando) {
      const c = comando.campo;
      if (!c) return avisar("Toque um campo de seleção (rosa) no painel para escolher geometria.");
      const refAceita = refViewport && c.aceita.includes(refViewport.tipo) ? refViewport : null;
      if (refAceita && refAceita === refPrioritaria) return adicionarAoCampo({ tipo: refAceita.tipo, id: refAceita.id });
      const ent = viewport.picarEntidade(e.clientX, e.clientY, filtrar(filtroEntidades(c.aceita)), tol);
      if (!ent) {
        // planos e eixos de referência clicados no viewport
        if (refViewport && c.aceita.includes(refViewport.tipo)) adicionarAoCampo({ tipo: refViewport.tipo, id: refViewport.id });
        return;
      }
      const r = refDeEntidade(ent)!;
      if (c.aceita.includes("plano") && !c.aceita.includes("face") && (r.tipo !== "face" || r.ass.geom !== "plano")) return avisar("Escolha uma face plana.");
      adicionarAoCampo(r);
      return;
    }
    if (avaliacao?.tipo === "medir") {
      const ent = viewport.picarEntidade(e.clientX, e.clientY, filtrar(TODAS), tol);
      if (!ent) {
        avaliacao.refs = [];
      } else {
        const r = refDeEntidade(ent)!;
        const i = avaliacao.refs.findIndex((x) => mesmaRef(x, r));
        if (i >= 0) avaliacao.refs.splice(i, 1);
        else {
          if (avaliacao.refs.length >= 2) avaliacao.refs = [];
          avaliacao.refs.push(r);
        }
      }
      atualizarDestaques();
      void atualizarMedida();
      return;
    }
    // modo peça: pré-seleção (Ctrl/Shift soma)
    const ent = refPrioritaria ? null : viewport.picarEntidade(e.clientX, e.clientY, filtrar(TODAS), tol);
    if (!ent && refViewport) {
      // plano/eixo de referência: seleciona como na árvore (Esboço, Normal a, Ocultar…)
      const somar = e.ctrlKey || e.shiftKey || e.metaKey;
      if (!somar) limparSelPeca();
      if (refViewport.id === "XY" || refViewport.id === "XZ" || refViewport.id === "YZ") {
        const id = refViewport.id;
        selecionar({ tipo: "ref", id }, somar);
        mostrarBarra(acoesDaReferencia(id), e.clientX, e.clientY);
      } else {
        const f = doc.features.find((x) => x.id === refViewport.id);
        if (!f) return;
        selecionar({ tipo: "feature", id: f.id }, somar);
        mostrarBarra(acoesDaFeature(f), e.clientX, e.clientY);
      }
      return;
    }
    if (!ent) {
      limparSelPeca();
      definirSel(null);
      renderizarTudo();
      return;
    }
    const r = refDeEntidade(ent)!;
    pontoTocado = ent.tipo === "face" ? viewport.picarFace(e.clientX, e.clientY)?.origem ?? null : null;
    const soma = e.ctrlKey || e.shiftKey || e.metaKey;
    const i = selPeca.findIndex((x) => mesmaRef(x, r));
    if (i >= 0) selPeca.splice(i, 1);
    else selPeca = soma ? [...selPeca, r] : [r];
    if (!soma) definirSel(null); // Ctrl/Shift: mantém o que foi escolhido na árvore
    renderizarArvore();
    atualizarStatus();
    atualizarDestaques();
    renderizarBarraVistas();
    if (selPeca.length) mostrarBarra(acoesDoModelo(), e.clientX, e.clientY);
  };
}
instalarToqueCurto();

function adicionarAoCampo(r: Referencia) {
  if (!comando?.campo) return;
  const { cam, multiplo } = comando.campo;
  const f = comando.f as unknown as Record<string, unknown>;
  if (multiplo) {
    const lista = ((ler(f, cam) as Referencia[] | undefined) ?? []).slice();
    const i = lista.findIndex((x) => mesmaRef(x, r));
    if (i >= 0) lista.splice(i, 1);
    else lista.push(r);
    gravarCaminho(f, cam, lista);
  } else {
    gravarCaminho(f, cam, r);
    comando.campo = null; // seleção única: passa a vez
  }
  renderizarComando();
  regenerarPrevia(80);
}

/** Durante um comando: "Mostrar pré-visualização" desligado adia a reconstrução até o OK. */
function regenerarPrevia(atraso: number) {
  if (comando && (comando.f as { mostrarPrevia?: boolean }).mostrarPrevia === false) return;
  regenerar(atraso);
}

function gravarCaminho(obj: Record<string, unknown>, cam: string, v: unknown) {
  const partes = cam.split(".");
  const ult = partes.pop()!;
  let o = obj;
  for (const k of partes) o = (o[k] ??= {}) as Record<string, unknown>;
  o[ult] = v;
}

function limparSelPeca() {
  selPeca = [];
  atualizarDestaques();
}

// realce sob o cursor (mouse/caneta pairando)
let quadroRealce = 0;
viewport.canvas().addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch" || e.buttons || editor) return;
  if (quadroRealce) return;
  quadroRealce = requestAnimationFrame(() => {
    quadroRealce = 0;
    const filtro = filtrar(comando?.campo ? filtroEntidades(comando.campo.aceita) : comando ? new Set<TipoEntidade>() : TODAS);
    const ent = viewport.picarEntidade(e.clientX, e.clientY, filtro, 9);
    viewport.destacarEntidades(refsDestacadas().map(entidadeDeRef).filter((x): x is Entidade => !!x), ent, facesDosSelecionados(), facesDaPrevia());
    const refB = !ent && (!comando || comando.campo?.aceita.some((a) => a === "plano" || a === "eixo" || a === "curva")) ? viewport.picarReferencia(e.clientX, e.clientY, 9) : null;
    const ref = refB && refPermitida(refB.tipo) ? refB : null;
    viewport.canvas().style.cursor = ent || ref ? "pointer" : "";
  });
});

// ---------- barra de contexto e menu do botão direito ----------

interface AcaoContexto {
  rotulo: string;
  icone: NomeIcone;
  acao: () => void;
}

function acoesDoModelo(): AcaoContexto[] {
  const out: AcaoContexto[] = [];
  const faces = selPeca.filter((r): r is Extract<Referencia, { tipo: "face" }> => r.tipo === "face");
  const arestas = selPeca.filter((r) => r.tipo === "aresta");
  if (faces.length === 1 && selPeca.length === 1 && faces[0].ass.geom === "plano" && faces[0].ass.normal) {
    const ass = faces[0].ass;
    out.push(
      { rotulo: "Esboço", icone: "esboco", acao: () => void suporteEscolhido(faceComoSuporte(ass.centro, ass.normal!), null) },
      { rotulo: "Normal a", icone: "normalA", acao: () => viewport.olharPlano(referencial(faceComoSuporte(ass.centro, ass.normal!))) },
      { rotulo: "Furo", icone: "furo", acao: () => iniciarFuro() },
    );
  }
  if (arestas.length || faces.length) {
    out.push({ rotulo: "Filete", icone: "filete", acao: () => criarRecurso("filete") }, { rotulo: "Chanfro", icone: "chanfro", acao: () => criarRecurso("chanfro") });
  }
  if (faces.length) out.push({ rotulo: "Casca", icone: "casca", acao: () => criarRecurso("casca") });
  out.push({
    rotulo: "Medir", icone: "medir", acao: () => {
      const refs = selPeca.slice(0, 2);
      comandoAvaliar("medir");
      if (avaliacao?.tipo === "medir") {
        avaliacao.refs = refs;
        atualizarDestaques();
        void atualizarMedida();
      }
    },
  });
  return out;
}

function acoesDaFeature(f: Feature): AcaoContexto[] {
  const out: AcaoContexto[] = [];
  if (f.tipo === "esboco") out.push({ rotulo: "Editar esboço", icone: "esboco", acao: () => void editarEsboco(f) });
  else out.push({ rotulo: "Editar recurso", icone: iconeFeature(f), acao: () => abrirComando(f, false) });
  for (const id of esbocosAbsorvidos(f)) {
    const e = doc.features.find((x): x is FeatureEsboco => x.id === id && x.tipo === "esboco");
    if (e) out.push({ rotulo: `Editar ${e.nome}`, icone: "esboco", acao: () => void editarEsboco(e) });
  }
  if (f.tipo === "planoRef") out.push({ rotulo: "Esboço", icone: "esboco", acao: () => void suporteEscolhido({ tipo: "planoRef", id: f.id }, null) });
  if (REPETIVEIS.includes(f.tipo)) {
    // atalhos: o recurso (e os outros selecionados com Ctrl/Shift) já entram na lista
    out.push(
      { rotulo: "Espelhar", icone: "espelhar", acao: () => criarRecurso("espelhar") },
      { rotulo: "Padrão linear", icone: "padraoLinear", acao: () => criarRecurso("padrao-linear") },
      { rotulo: "Padrão circular", icone: "padraoCircular", acao: () => criarRecurso("padrao-circular") },
    );
  }
  if (f.tipo === "planoRef" || f.tipo === "eixoRef") {
    const oculto = prefs.refsOcultas.includes(f.id);
    out.push({
      rotulo: oculto ? "Mostrar" : "Ocultar", icone: oculto ? "olho" : "olhoFechado", acao: () => {
        prefs.refsOcultas = oculto ? prefs.refsOcultas.filter((x) => x !== f.id) : [...prefs.refsOcultas, f.id];
        salvarPrefs();
        mostrarReferenciasExtras();
      },
    });
  }
  out.push(
    { rotulo: f.suprimida ? "Reativar" : "Suprimir", icone: "olhoFechado", acao: () => { f.suprimida = !f.suprimida; alterou(true); renderizarTudo(); } },
    { rotulo: "Retroceder aqui", icone: "retrocesso", acao: () => { doc.retrocesso = doc.features.indexOf(f); alterou(true); renderizarTudo(); } },
    { rotulo: "Excluir", icone: "olhoFechado", acao: () => excluirFeature(f) },
  );
  return out;
}

function acoesDaReferencia(id: IdReferencia): AcaoContexto[] {
  const vis = prefs.refsVisiveis[id];
  const out: AcaoContexto[] = [];
  if (id !== "origem") {
    out.push(
      { rotulo: "Esboço", icone: "esboco", acao: () => void suporteEscolhido({ tipo: "plano", plano: id, deslocamento: 0 }, null) },
      { rotulo: "Normal a", icone: "normalA", acao: () => viewport.vistaNormalA(id) },
      { rotulo: "Plano", icone: "plano", acao: () => criarRecurso("plano") },
    );
  }
  out.push({ rotulo: vis ? "Ocultar" : "Mostrar", icone: vis ? "olhoFechado" : "olho", acao: () => alternarReferencia(id) });
  return out;
}

function mostrarBarra(acoes: AcaoContexto[], x: number, y: number) {
  const barra = $("barra-contexto");
  barra.innerHTML = "";
  for (const a of acoes) {
    const b = document.createElement("button");
    b.innerHTML = `${ICONES[a.icone]}<span>${a.rotulo}</span>`;
    b.title = a.rotulo;
    b.onclick = () => {
      esconderBarraContexto();
      a.acao();
    };
    barra.appendChild(b);
  }
  const wrap = $("viewport").getBoundingClientRect();
  barra.hidden = false;
  const w = barra.offsetWidth, h = barra.offsetHeight;
  barra.style.left = `${Math.max(6, Math.min(x - wrap.left + 12, wrap.width - w - 6))}px`;
  barra.style.top = `${Math.max(56, Math.min(y - wrap.top - h - 12, wrap.height - h - 6))}px`;
}

function esconderBarraContexto() {
  $("barra-contexto").hidden = true;
}

viewport.aoMenuContexto = (e) => {
  if (editor) return;
  const outros = viewport.entidadesSobCursor(e.clientX, e.clientY, 9).filter((x) => !filtroLigado() || prefs.filtroSelecao!.includes(x.tipo));
  const itemOutro = outros.length > 1
    ? [{ rotulo: "Selecionar outro…", icone: "selecionar" as NomeIcone, acao: () => selecionarOutro(outros, e.clientX, e.clientY) }]
    : [];
  if (comando) {
    mostrarBarra([
      { rotulo: "OK", icone: "concluir", acao: confirmarComando },
      { rotulo: "Cancelar", icone: "fechar", acao: cancelarComando },
      ...itemOutro,
      { rotulo: "Enquadrar", icone: "enquadrar", acao: () => viewport.enquadrar() },
    ], e.clientX, e.clientY);
    return;
  }
  const ent = viewport.picarEntidade(e.clientX, e.clientY, filtrar(TODAS), 9);
  if (ent) {
    const r = refDeEntidade(ent)!;
    if (!selPeca.some((x) => mesmaRef(x, r))) selPeca = [r];
    atualizarDestaques();
  }
  mostrarBarra([
    ...(selPeca.length ? acoesDoModelo() : []),
    ...itemOutro,
    recursoComCotas === TODAS_AS_COTAS
      ? { rotulo: "Esconder cotas", icone: "cota", acao: () => fecharCotasNoModelo() }
      : { rotulo: "Todas as cotas", icone: "cota", acao: () => mostrarTodasAsCotas() },
    { rotulo: "Enquadrar", icone: "enquadrar", acao: () => viewport.enquadrar() },
    { rotulo: "Orientação…", icone: "vistas", acao: () => abrirSeletorVistas($("barra-vistas")) },
    { rotulo: "Medir", icone: "medir", acao: () => comandoAvaliar("medir") },
    { rotulo: "Desfazer", icone: "desfazer", acao: () => desfazer() },
  ], e.clientX, e.clientY);
};

/** Lista as entidades sob o cursor (inclusive escondidas); passar o dedo/mouse realça cada uma. */
function selecionarOutro(lista: ReturnType<Viewport["entidadesSobCursor"]>, x: number, y: number) {
  const nomeGeom: Record<string, string> = { plano: "plana", cilindro: "cilíndrica", cone: "cônica", esfera: "esférica", toro: "toroidal", linha: "reta", circulo: "circular" };
  const cont = { face: 0, aresta: 0, vertice: 0 };
  const itens = lista.map((ent) => {
    const r = refDeEntidade(ent)!;
    const n = ++cont[ent.tipo];
    const geom = "ass" in r ? nomeGeom[(r.ass as { geom?: string }).geom ?? ""] : undefined;
    const tipo = ent.tipo === "face" ? "Face" : ent.tipo === "aresta" ? "Aresta" : "Vértice";
    return {
      rotulo: `${tipo} ${n}${geom ? ` (${geom})` : ""}${n === 1 && ent.tipo === "face" ? " · frente" : ""}`,
      icone: (ent.tipo === "face" ? "face" : ent.tipo === "aresta" ? "aresta" : "vertice") as NomeIcone,
      aoPassar: () => atualizarDestaques(r),
      acao: () => {
        if (comando?.campo) {
          const c = comando.campo;
          if (!c.aceita.includes(ent.tipo)) return avisar("Esse tipo de entidade não serve para o campo ativo.");
          adicionarAoCampo(r);
          return;
        }
        selPeca = [r];
        definirSel(null);
        renderizarArvore();
        atualizarStatus();
        atualizarDestaques();
        mostrarBarra(acoesDoModelo(), x, y);
      },
    };
  });
  abrirPopover({ x, y }, itens);
}

// ---------- configurações da peça ----------

function menuConfiguracoes(ancora: HTMLElement) {
  prepararConfiguracoes(doc);
  abrirPopover(ancora, [
    ...doc.configuracoes!.map((c) => ({
      rotulo: c.nome,
      icone: "configuracoes" as NomeIcone,
      marcado: c.id === doc.configAtiva,
      acao: () => void trocarConfiguracao(c.id),
    })),
    { rotulo: "Nova configuração…", icone: "nova" as NomeIcone, acao: () => criarConfiguracao() },
    { rotulo: "Tabela de configurações…", icone: "equacoes" as NomeIcone, acao: () => abrirTabelaConfiguracoes() },
  ]);
}

/** Resolve os esboços cujas cotas mudaram e reconstrói. */
async function aplicarMudancaDeConfiguracao(esbocos: string[]) {
  if (esbocos.length) {
    const s = await obterSolver();
    for (const id of esbocos) {
      const e = doc.features.find((f) => f.id === id);
      if (e?.tipo === "esboco") s.resolver(e);
    }
  }
  registrarPasso();
  salvarAutosave();
  renderizarTudo();
  regenerar();
}

async function trocarConfiguracao(id: string) {
  if (id === doc.configAtiva) return;
  fecharCotasNoModelo();
  const esbocos = ativarConfiguracao(doc, id);
  await aplicarMudancaDeConfiguracao(esbocos);
  avisar(`Configuração ativa: ${doc.configuracoes!.find((c) => c.id === id)!.nome}`);
  if (!$("janela").hidden && $("janela-titulo").textContent === "Tabela de configurações") abrirTabelaConfiguracoes();
}

function criarConfiguracao() {
  prepararConfiguracoes(doc);
  const nome = prompt("Nome da nova configuração (ela começa igual à ativa):", `Configuração ${doc.configuracoes!.length + 1}`)?.trim();
  if (!nome) return;
  const c = novaConfiguracao(doc, nome);
  void trocarConfiguracao(c.id).then(() => abrirTabelaConfiguracoes());
}

/**
 * Tabela: colunas = configurações; linhas = parâmetros que variam (cotas e valores dos recursos)
 * e recursos que podem ser suprimidos. Editar a coluna da configuração ativa muda a peça na hora.
 */
function abrirTabelaConfiguracoes() {
  prepararConfiguracoes(doc);
  capturarAtiva(doc);
  limparConfiguracoes(doc);
  const cs = doc.configuracoes!;
  abrirJanela("Tabela de configurações", "");
  $("janela").classList.add("larga");
  const corpo = $("janela-corpo");
  const el = <K extends keyof HTMLElementTagNameMap>(t: K, cls = "", txt?: string) => {
    const e = document.createElement(t);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };
  const fmt = (v: number | undefined) => (v === undefined ? "" : String(Number(v.toFixed(4))));
  const todos = listarParametros(doc);
  const nomeDe = new Map(todos.map((p) => [p.chave, p]));
  const recarregar = () => abrirTabelaConfiguracoes();

  corpo.append(el("p", "dica", "Cada coluna é uma configuração. A ativa (★) é a que está na tela; mudar um valor nela atualiza a peça. Toque no nome de uma coluna para ativá-la."));
  const wrap = el("div", "tabela-config-wrap");
  const tab = el("table", "tabela-config");
  const cab = el("tr");
  cab.append(el("th", "", "Parâmetro"));
  for (const c of cs) {
    const th = el("th", c.id === doc.configAtiva ? "ativa" : "");
    const nome = el("button", "nome-config", `${c.id === doc.configAtiva ? "★ " : ""}${c.nome}`);
    nome.title = c.id === doc.configAtiva ? "Configuração ativa" : "Ativar esta configuração";
    nome.onclick = () => void trocarConfiguracao(c.id);
    th.append(nome);
    const ren = el("button", "btn-mini", "✎");
    ren.title = "Renomear";
    ren.onclick = () => {
      const n = prompt("Novo nome da configuração:", c.nome)?.trim();
      if (!n) return;
      c.nome = n;
      registrarPasso();
      salvarAutosave();
      renderizarArvore();
      recarregar();
    };
    th.append(ren);
    if (cs.length > 1) {
      const x = el("button", "btn-mini", "✕");
      x.title = "Excluir configuração";
      x.onclick = () => {
        if (!confirm(`Excluir a configuração "${c.nome}"?`)) return;
        void aplicarMudancaDeConfiguracao(excluirConfiguracao(doc, c.id)).then(recarregar);
      };
      th.append(x);
    }
    cab.append(th);
  }
  tab.append(cab);

  // parâmetros que variam
  for (const k of doc.parametrosConfigurados ?? []) {
    const p = nomeDe.get(k);
    if (!p) continue;
    const tr = el("tr");
    const td0 = el("td", "rotulo-param");
    td0.append(el("span", "", `${p.rotulo}${p.unidade ? ` (${p.unidade})` : ""}`));
    const x = el("button", "btn-mini", "✕");
    x.title = "Parar de variar (o valor atual vale para todas)";
    x.onclick = () => {
      desconfigurarParametro(doc, k);
      registrarPasso();
      salvarAutosave();
      recarregar();
    };
    td0.append(x);
    tr.append(td0);
    for (const c of cs) {
      const td = el("td", c.id === doc.configAtiva ? "ativa" : "");
      const inp = el("input");
      inp.inputMode = "decimal";
      inp.value = fmt(valorNaConfiguracao(doc, c, k));
      inp.onchange = () => {
        const v = avaliarExpressao(inp.value, resolverVariaveis(doc.variaveis).valores);
        if (!Number.isFinite(v)) return inp.classList.add("invalido");
        inp.classList.remove("invalido");
        const e = definirValorNaConfiguracao(doc, c, k, k.endsWith("instancias") ? Math.max(1, Math.round(v)) : v);
        if (c.id === doc.configAtiva) void aplicarMudancaDeConfiguracao(e ? [e] : []);
        else {
          registrarPasso();
          salvarAutosave();
        }
      };
      td.append(inp);
      tr.append(td);
    }
    tab.append(tr);
  }

  // adicionar parâmetro
  const livres = todos.filter((p) => !(doc.parametrosConfigurados ?? []).includes(p.chave));
  if (livres.length) {
    const tr = el("tr", "linha-adicionar");
    const td = el("td");
    td.colSpan = cs.length + 1;
    const sel = el("select");
    sel.add(new Option("+ Variar um parâmetro…", ""));
    for (const p of livres) sel.add(new Option(`${p.rotulo} = ${fmt(p.valor)}${p.unidade ? ` ${p.unidade}` : ""}`, p.chave));
    sel.onchange = () => {
      if (!sel.value) return;
      configurarParametro(doc, sel.value);
      registrarPasso();
      salvarAutosave();
      recarregar();
    };
    td.append(sel);
    tr.append(td);
    tab.append(tr);
  }

  // supressão por configuração
  const recursos = doc.features.filter((f) => f.tipo !== "esboco");
  if (recursos.length) {
    const sep = el("tr", "secao");
    sep.append(Object.assign(el("td", "", "Suprimido em"), { colSpan: cs.length + 1 }));
    tab.append(sep);
    for (const f of recursos) {
      const tr = el("tr");
      tr.append(el("td", "rotulo-param", f.nome));
      for (const c of cs) {
        const td = el("td", c.id === doc.configAtiva ? "ativa" : "");
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = c.suprimidos.includes(f.id);
        cb.onchange = () => {
          definirSupressao(doc, c, f.id, cb.checked);
          if (c.id === doc.configAtiva) void aplicarMudancaDeConfiguracao([]);
          else {
            registrarPasso();
            salvarAutosave();
          }
        };
        td.append(cb);
        tr.append(td);
      }
      tab.append(tr);
    }
  }
  wrap.append(tab);
  corpo.append(wrap);
  const nova = el("button", "largo", "+ Nova configuração");
  nova.onclick = () => criarConfiguracao();
  corpo.append(nova);
}

// ---------- cotas do recurso sobre o modelo (duplo clique) ----------

let recursoComCotas: string | null = null;
const camadaCotasModelo = Object.assign(document.createElement("div"), { className: "camada-cotas-modelo" });
$("viewport").parentElement!.appendChild(camadaCotasModelo);
const cotasNoModelo = new CotasNoModelo(viewport, camadaCotasModelo);
let camadasCotasModelo: THREE.Group[] = [];

/** O recurso mais recente que tem a face entre as "suas" faces. */
function recursoDaFace(indice: number): Feature | null {
  let achado: Feature | null = null;
  for (const f of ativas()) if (facesPorRecurso[f.id]?.includes(indice)) achado = f;
  return achado;
}

/** Valores do próprio recurso mostrados no modelo: os mesmos que as configurações podem variar. */
const PARAMETROS_NO_MODELO = PARAMETROS_RECURSO;

function fecharCotasNoModelo() {
  recursoComCotas = null;
  cotasNoModelo.limpar();
  for (const c of camadasCotasModelo) {
    viewport.grupoEsboco.remove(c);
    descartarCamada(c);
  }
  camadasCotasModelo = [];
  viewport.pedirRender();
}

/** "Exibir todas as cotas": em vez de um recurso, todos os ativos (esboços e valores dos recursos). */
const TODAS_AS_COTAS = "*todas*";

function mostrarCotasNoModelo(f: Feature) {
  fecharCotasNoModelo();
  if (editor) return; // editando um esboço, as cotas aparecem no próprio editor
  recursoComCotas = f.id;
  const rotulos = rotulosDoRecurso(f, new Set());
  if (!rotulos.length) {
    recursoComCotas = null;
    return avisar(`${f.nome}: sem cotas para mostrar.`);
  }
  cotasNoModelo.mostrar(rotulos);
  viewport.pedirRender();
}

/** Cotas de todos os esboços e recursos ativos, editáveis no lugar (sem caçar recurso por recurso). */
function mostrarTodasAsCotas() {
  fecharCotasNoModelo();
  if (editor) return;
  recursoComCotas = TODAS_AS_COTAS;
  const vistos = new Set<string>();
  const rotulos = ativas().flatMap((f) => rotulosDoRecurso(f, vistos));
  if (!rotulos.length) {
    recursoComCotas = null;
    return avisar("O modelo não tem cotas para mostrar.");
  }
  cotasNoModelo.mostrar(rotulos);
  viewport.pedirRender();
  avisar(`${rotulos.length} cota(s) no modelo: toque numa para editar. Toque no vazio para esconder.`);
}

/** Rótulos de um recurso: cotas dos esboços que ele usa (os de `vistos` são pulados) e os próprios valores. */
function rotulosDoRecurso(f: Feature, vistos: Set<string>): RotuloModelo[] {
  const valores = () => resolverVariaveis(doc.variaveis).valores;
  const fmt = (v: number) => Number(v.toFixed(3)).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const rotulos: RotuloModelo[] = [];
  const { w, h } = viewport.tamanho();

  // cotas dos esboços usados pelo recurso (ou do próprio esboço)
  const ids = f.tipo === "esboco" ? [f.id] : esbocosAbsorvidos(f);
  for (const id of ids) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    const esb = doc.features.find((x): x is FeatureEsboco => x.id === id && x.tipo === "esboco");
    if (!esb) continue;
    let ref;
    try {
      ref = referencial(esb.suporte);
    } catch {
      continue;
    }
    const mmPx = viewport.mmPorPixel(ref);
    const camada = construirCamada(esb, { ref, mmPx, resolucao: { w, h }, editando: false, mostrarCotas: true });
    viewport.grupoEsboco.add(camada);
    camadasCotasModelo.push(camada);
    for (const c of esb.restricoes) {
      if (!ehCota(c)) continue;
      const d = desenharCota(c, esb, mmPx);
      if (!d) continue;
      rotulos.push({
        texto: textoCota(c),
        edicao: c.expr ?? String(Number(c.valor.toFixed(4))),
        pos: paraMundo(ref, d.texto.x, d.texto.y),
        fixo: !!c.referencia,
        aplicar: (t) => {
          const v = avaliarExpressao(t, valores());
          if (!Number.isFinite(v) || v <= 0) return false;
          c.valor = v;
          if (t.trim().startsWith("=")) c.expr = t.trim();
          else delete c.expr;
          void obterSolver().then((s) => {
            s.resolver(esb);
            alterou(true);
          });
          return true;
        },
      });
    }
  }
  // valores do recurso, no centro das faces dele
  const centro = viewport.centroFaces(facesPorRecurso[f.id] ?? []);
  const params = (PARAMETROS_NO_MODELO[f.tipo] ?? []).filter(([, , , vis]) => !vis || vis(f as never));
  params.forEach(([cam, rot, un], i) => {
    const v = ler(f as unknown as Record<string, unknown>, cam) as number | undefined;
    if (typeof v !== "number" || !centro) return;
    const chave = `${f.id}.${cam}`;
    rotulos.push({
      texto: `${rot} ${fmt(v)}${un ? (un === "°" ? "°" : ` ${un}`) : ""}`,
      edicao: doc.equacoes?.[chave] ?? String(v),
      pos: centro,
      desloc: (i - (params.length - 1) / 2) * 30,
      aplicar: (t) => {
        const n = avaliarExpressao(t, valores());
        if (!Number.isFinite(n) || n <= 0) return false;
        gravarCaminho(f as unknown as Record<string, unknown>, cam, cam.endsWith("instancias") ? Math.max(1, Math.round(n)) : n);
        doc.equacoes ??= {};
        if (t.trim().startsWith("=")) doc.equacoes[chave] = t.trim();
        else delete doc.equacoes[chave];
        alterou(true);
        return true;
      },
    });
  });
  return rotulos;
}

// ---------- alças de arrasto do comando (profundidade da extrusão) ----------

let valorNoInicioDaAlca = 0;

/** Cotas do próprio comando sobre o modelo (D1/D2 da extrusão), editáveis no lugar. */
const camadaCotasComando = Object.assign(document.createElement("div"), { className: "camada-cotas-modelo" });
$("viewport").parentElement!.appendChild(camadaCotasComando);
const cotasDoComando = new CotasNoModelo(viewport, camadaCotasComando);
/** Ponta da seta D1 (a caixa flutuante aparece ao lado dela). */
let posicaoDaAlca: Vec3 | null = null;

function semAlcas() {
  posicaoDaAlca = null;
  cotasDoComando.limpar();
  viewport.mostrarAlcas([]);
}

/** Setas nas pontas da extrusão (direção 1 e 2), em cego ou plano médio. */
function atualizarAlcas() {
  const f = comando?.f;
  if (!f || f.tipo !== "extrusao" || !f.esboco) return semAlcas();
  const esb = doc.features.find((x): x is FeatureEsboco => x.id === f.esboco && x.tipo === "esboco");
  if (!esb) return semAlcas();
  let ref, lacos;
  try {
    ref = referencial(esb.suporte);
    lacos = encontrarLacos(esb);
  } catch {
    return semAlcas();
  }
  const pts = lacos.flatMap((l) => l.poligono);
  if (!pts.length) return semAlcas();
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const c2 = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const de = f.de ?? { tipo: "plano", dist: 0, inverter: false };
  const s0 = de.tipo === "deslocamento" ? (de.inverter ? -1 : 1) * de.dist : 0;
  const base = paraMundo(ref, c2.x, c2.y);
  const n = ref.normal;
  const sentido = f.inverter ? -1 : 1;
  const em = (s: number): Vec3 => [base[0] + n[0] * s, base[1] + n[1] * s, base[2] + n[2] * s];
  const dir = (sg: number): Vec3 => [n[0] * sg, n[1] * sg, n[2] * sg];
  const cond = f.condicao?.tipo ?? "cego";
  const alcas: { id: string; pos: Vec3; dir: Vec3 }[] = [];
  if (cond === "cego") alcas.push({ id: "profundidade", pos: em(s0 + sentido * f.profundidade), dir: dir(sentido) });
  else if (cond === "planoMedio") alcas.push({ id: "profundidade", pos: em(s0 + sentido * (f.profundidade / 2)), dir: dir(sentido) });
  if (f.direcao2?.ativa && cond !== "planoMedio" && f.direcao2.condicao.tipo === "cego") {
    alcas.push({ id: "direcao2.condicao.dist", pos: em(s0 - sentido * f.direcao2.condicao.dist), dir: dir(-sentido) });
  }
  viewport.mostrarAlcas(alcas);
  posicaoDaAlca = alcas[0]?.pos ?? null;

  // cotas D1/D2 no meio de cada direção: tocar edita (aceita "=expressão"), como no painel
  if (cotasDoComando.editando) return cotasDoComando.posicionar();
  const fmt = (v: number) => Number(v.toFixed(3)).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const cota = (cam: "profundidade" | "direcao2.condicao.dist", rot: string, meio: number): RotuloModelo => {
    const v = ler(f, cam) as number;
    return {
      texto: `${rot} ${fmt(v)} mm`,
      edicao: doc.equacoes?.[`${f.id}.${cam}`] ?? String(v),
      pos: em(meio),
      aplicar: (t) => {
        const n = avaliarExpressao(t, resolverVariaveis(doc.variaveis).valores);
        if (!Number.isFinite(n) || n <= 0) return false;
        gravarCaminho(f as unknown as Record<string, unknown>, cam, Number(n.toFixed(4)));
        doc.equacoes ??= {};
        if (t.trim().startsWith("=")) doc.equacoes[`${f.id}.${cam}`] = t.trim();
        else delete doc.equacoes[`${f.id}.${cam}`];
        salvarAutosave();
        renderizarComando();
        regenerarPrevia(0);
        return true;
      },
    };
  };
  const rotulos: RotuloModelo[] = [];
  if (cond === "cego") rotulos.push(cota("profundidade", "D1", s0 + (sentido * f.profundidade) / 2));
  else if (cond === "planoMedio") rotulos.push(cota("profundidade", "D1", s0 + (sentido * f.profundidade) / 4));
  if (alcas.length > 1) rotulos.push(cota("direcao2.condicao.dist", "D2", s0 - (sentido * f.direcao2!.condicao.dist) / 2));
  cotasDoComando.mostrar(rotulos);
}

viewport.aoArrastarAlca = (id, delta, fim) => {
  const f = comando?.f as unknown as Record<string, unknown> | undefined;
  if (!f) return;
  const atual = ler(f, id) as number;
  if (!fim && !alcaEmArraste) {
    alcaEmArraste = true;
    valorNoInicioDaAlca = atual;
  }
  // plano médio: a seta fica na metade, então o arraste vale o dobro
  const fator = id === "profundidade" && (comando!.f as FeatureExtrusao).condicao?.tipo === "planoMedio" ? 2 : 1;
  const passo = viewport.mmPorPixel(referencialPadrao()) < 0.05 ? 0.1 : 0.5;
  const v = Math.max(passo, Math.round((valorNoInicioDaAlca + delta * fator) / passo) * passo);
  gravarCaminho(f, id, Number(v.toFixed(4)));
  delete doc.equacoes?.[`${comando!.f.id}.${id}`];
  avisar(`${id === "profundidade" ? "D1" : "D2"}: ${v.toLocaleString("pt-BR")} mm`);
  if (fim) {
    alcaEmArraste = false;
    renderizarComando();
    regenerarPrevia(0);
  } else {
    atualizarAlcas();
    regenerarPrevia(120);
  }
};
let alcaEmArraste = false;

/** Referencial qualquer (plano frontal) para medir mm por pixel na tela. */
const referencialPadrao = () => referencial({ tipo: "plano", plano: "XY", deslocamento: 0 });

// ---------- árvore do modelo ----------
const REFERENCIAS: IdReferencia[] = ["XY", "XZ", "YZ", "origem"]; // Frontal, Superior, Lateral

const ICONE_FEATURE: Record<Feature["tipo"], NomeIcone> = {
  esboco: "esboco", extrusao: "extrusao", revolucao: "revolucao", filete: "filete", chanfro: "chanfro",
  casca: "casca", inclinacao: "inclinacaoRecurso", nervura: "nervura", furo: "furo", padraoLinear: "padraoLinear",
  padraoCircular: "padraoCircular", espelhar: "espelhar", planoRef: "plano", eixoRef: "eixoRef",
  varredura: "varredura", loft: "loft", curva: "helice",
  flangeBase: "flangeBase", flangeAresta: "flangeAresta", bainha: "bainha", abaChapa: "aba", corteChapa: "corteChapa", dobraEsboco: "dobra", junta: "junta", meiaEsquadria: "meiaEsquadria",
  fecharCanto: "fecharCanto", alivioCanto: "alivioCanto", quebrarCanto: "quebrarCanto",
  desdobrar: "desdobrar", dobrar: "dobrar", converterChapa: "converterChapa",
};

function iconeFeature(f: Feature): NomeIcone {
  if (f.tipo === "extrusao" && f.operacao === "cortar") return "corte";
  if (f.tipo === "revolucao" && f.operacao === "cortar") return "corteRevolucao";
  if (f.tipo === "varredura" && f.operacao === "cortar") return "corteVarredura";
  if (f.tipo === "loft" && f.operacao === "cortar") return "corteLoft";
  if (f.tipo === "curva") return ({ helice: "helice", xyz: "curvaXYZ", pontosRef: "curvaPontos", composta: "curvaComposta", projetada: "curvaProjetada" } as const)[f.modo];
  return ICONE_FEATURE[f.tipo];
}

function renderizarArvore() {
  for (const lista of [$("arvore"), $("arvore-mini")]) {
    if (!lista.hidden) preencherArvore(lista, lista.id === "arvore-mini");
  }
}

function preencherArvore(lista: HTMLElement, mini: boolean) {
  lista.innerHTML = "";
  const raiz = document.createElement("li");
  raiz.className = "raiz";
  raiz.innerHTML = `${ICONES.peca}<strong></strong>`;
  raiz.querySelector("strong")!.textContent = doc.nome;
  lista.appendChild(raiz);

  if (!mini) {
    const mat = document.createElement("li");
    mat.className = "item ref";
    const m = doc.material ? MATERIAIS[doc.material] : undefined;
    mat.innerHTML = `<span class="item-ic">${ICONES.materialPeca}</span><span class="item-texto"><strong>${m ? m.nome : "Material &lt;não especificado&gt;"}</strong></span>`;
    mat.onclick = () => {
      if (!editor && !comando) escolherMaterial(mat);
    };
    lista.appendChild(mat);
    // configuração ativa (só aparece o nome quando há mais de uma)
    const cfg = document.createElement("li");
    cfg.className = "item ref item-config";
    const ativa = doc.configuracoes?.find((c) => c.id === doc.configAtiva);
    const n = doc.configuracoes?.length ?? 0;
    cfg.innerHTML = `<span class="item-ic">${ICONES.configuracoes}</span><span class="item-texto"><strong></strong><small></small></span>`;
    cfg.querySelector("strong")!.textContent = `Configuração: ${ativa?.nome ?? "Padrão"}`;
    cfg.querySelector("small")!.textContent = n > 1 ? `${n} configurações` : "toque para criar variações";
    cfg.onclick = () => {
      if (editor || comando) return avisar("Conclua o comando atual (✓) antes de trocar de configuração.");
      menuConfiguracoes(cfg);
    };
    lista.appendChild(cfg);
  }

  for (const id of REFERENCIAS) {
    const li = document.createElement("li");
    li.className = "item ref";
    li.classList.toggle("ativo", selArvore().some((s) => s.tipo === "ref" && s.id === id));
    li.classList.toggle("oculta", !prefs.refsVisiveis[id]);
    const vis = prefs.refsVisiveis[id];
    li.innerHTML = `
      <span class="item-ic">${id === "origem" ? ICONES.origem : ICONES.plano}</span>
      <span class="item-texto"><strong>${rotuloReferencia(id)}</strong></span>
      ${mini ? "" : `<button class="item-olho" aria-label="${vis ? "Ocultar" : "Mostrar"}">${vis ? ICONES.olho : ICONES.olhoFechado}</button>`}`;
    li.onclick = (ev) => {
      if ((ev.target as HTMLElement).closest(".item-olho")) return alternarReferencia(id);
      if (id === "origem") return;
      if (aguardando) return void suporteEscolhido({ tipo: "plano", plano: id, deslocamento: 0 }, null);
      if (comando?.campo && comando.campo.aceita.includes("plano")) return adicionarAoCampo({ tipo: "plano", id });
      if (editor || comando) return avisar("Conclua o comando atual (✓) antes de selecionar outro item.");
      const somar = ev.ctrlKey || ev.shiftKey || ev.metaKey;
      if (somar) return selecionar({ tipo: "ref", id }, true);
      limparSelPeca();
      selecionar(selecao?.tipo === "ref" && selecao.id === id ? null : { tipo: "ref", id });
      if (selecao) mostrarBarraNoItem(li, acoesDaReferencia(id));
    };
    li.oncontextmenu = (ev) => {
      ev.preventDefault();
      if (!editor && !comando) mostrarBarraNoItem(li, acoesDaReferencia(id));
    };
    lista.appendChild(li);
  }

  // esboços consumidos aparecem dentro do recurso que os usa
  const filhos = new Set<string>();
  for (const f of doc.features) for (const e of esbocosAbsorvidos(f)) filhos.add(e);
  const limite = doc.retrocesso ?? doc.features.length;

  const itemFeature = (f: Feature, i: number, nivel: number, seta: boolean | null) => {
    const filho = nivel > 0;
    const li = document.createElement("li");
    li.className = "item";
    li.classList.toggle("filho", filho);
    li.style.setProperty("--nivel", String(nivel));
    li.classList.toggle("ativo", selArvore().some((s) => s.tipo === "feature" && s.id === f.id) || f.id === comando?.f.id
      || (!!comando && "recursos" in comando.f && comando.f.recursos.includes(f.id)));
    li.classList.toggle("suprimida", f.suprimida);
    li.classList.toggle("retrocedida", i >= limite);
    li.classList.toggle("com-erro", errosPorFeature.has(f.id));
    li.classList.toggle("editando", f.id === editor?.esb.id);
    li.innerHTML = `
      ${seta === null ? `<span class="item-seta vazia"></span>` : `<button class="item-seta" aria-expanded="${seta}" aria-label="${seta ? "Recolher" : "Mostrar elementos usados"}">${seta ? "▾" : "▸"}</button>`}
      <span class="item-ic">${ICONES[iconeFeature(f)]}</span>
      <span class="item-texto"><strong></strong><small></small></span>
      ${mini || filho ? "" : `<span class="item-mover"><button data-mover="-1" aria-label="Subir">▲</button><button data-mover="1" aria-label="Descer">▼</button></span>`}`;
    li.querySelector("strong")!.textContent = f.nome;
    const opr = "operacao" in f && f.operacao === "cortar" ? " · corte" : "";
    const ms = tempos.find((t) => t.id === f.id)?.ms;
    li.querySelector("small")!.textContent = `${ROTULO_TIPO[f.tipo]}${opr}${f.id === editor?.esb.id ? " · editando" : ""}${ms && ms > 300 ? ` · ${(ms / 1000).toFixed(1)} s` : ""}`;
    li.title = errosPorFeature.get(f.id) ?? "";
    li.onclick = (ev) => {
      if ((ev.target as HTMLElement).closest(".item-seta")) {
        if (expandidos.has(f.id)) expandidos.delete(f.id);
        else expandidos.add(f.id);
        return renderizarArvore();
      }
      const mover = (ev.target as HTMLElement).closest<HTMLElement>("[data-mover]");
      if (mover) return moverFeature(i, Number(mover.dataset.mover));
      if (comando?.campo && comando.campo.aceita.includes("esboco") && f.tipo === "esboco" && f.id !== comando.f.id) return adicionarAoCampo({ tipo: "esboco", id: f.id });
      if (comando?.campo && comando.campo.aceita.includes("curva") && f.tipo === "curva" && f.id !== comando.f.id) return adicionarAoCampo({ tipo: "curva", id: f.id });
      if (comando?.campo && comando.campo.aceita.includes("plano") && f.tipo === "planoRef") return adicionarAoCampo({ tipo: "plano", id: f.id });
      if (comando?.campo && comando.campo.aceita.includes("eixo") && f.tipo === "eixoRef") return adicionarAoCampo({ tipo: "eixo", id: f.id });
      if (aguardando && f.tipo === "planoRef") return void suporteEscolhido({ tipo: "planoRef", id: f.id }, null);
      if (comando && alternarRecursoNoComando(f)) return;
      if (editor || comando) return avisar("Conclua o comando atual (✓) antes de selecionar outro recurso.");
      if (ev.ctrlKey || ev.shiftKey || ev.metaKey) return selecionar({ tipo: "feature", id: f.id }, true);
      limparSelPeca();
      selecionar(f.id === idSelecionado() ? null : { tipo: "feature", id: f.id });
      if (selecao) mostrarBarraNoItem(li, acoesDaFeature(f));
    };
    li.ondblclick = () => {
      esconderBarraContexto();
      if (editor || comando) return;
      if (f.tipo === "esboco") void editarEsboco(f);
      else abrirComando(f, false);
    };
    li.oncontextmenu = (ev) => {
      ev.preventDefault();
      if (!editor && !comando) mostrarBarraNoItem(li, acoesDaFeature(f));
    };
    return li;
  };

  /** Recurso na árvore, com seta para mostrar os elementos usados para criá-lo. */
  const adicionar = (f: Feature, i: number, nivel: number) => {
    const u = elementosUsados(f);
    const tem = u.esbocos.length + u.recursos.length + u.refs.length > 0;
    // esboço filho selecionado ou em edição: abre o pai para ele ficar visível
    const aberto = expandidos.has(f.id) || u.esbocos.some((e) => e.id === idSelecionado() || e.id === editor?.esb.id);
    lista.appendChild(itemFeature(f, i, nivel, tem ? aberto : null));
    if (!tem || !aberto) return;
    for (const e of u.esbocos) adicionar(e, doc.features.indexOf(e), nivel + 1);
    for (const x of u.recursos) lista.appendChild(itemUsado({ tipo: "recurso", id: x.id }, 0, nivel + 1));
    const contagem = new Map<string, number>();
    for (const ref of u.refs) {
      const k = contagem.get(ref.tipo) ?? 0;
      contagem.set(ref.tipo, k + 1);
      lista.appendChild(itemUsado(ref, k, nivel + 1));
    }
  };

  /** Elemento usado (face, aresta, plano, recurso…): toque destaca/seleciona. */
  const itemUsado = (ref: Referencia, k: number, nivel: number) => {
    const li = document.createElement("li");
    li.className = "item filho usado";
    li.style.setProperty("--nivel", String(nivel));
    const alvo = ref.tipo === "recurso" || ref.tipo === "esboco" || ref.tipo === "curva" || (ref.tipo === "plano" || ref.tipo === "eixo") && !["XY", "XZ", "YZ", "X", "Y", "Z"].includes(ref.id)
      ? doc.features.find((x) => x.id === (ref as { id: string }).id) : undefined;
    const icone: NomeIcone = alvo ? iconeFeature(alvo)
      : ({ face: "peca", aresta: "linha", vertice: "ponto", plano: "plano", eixo: "eixoRef", linhaEsboco: "linha", esboco: "esboco", recurso: "peca", curva: "helice" } as const)[ref.tipo];
    li.innerHTML = `<span class="item-seta vazia"></span><span class="item-ic">${ICONES[icone]}</span><span class="item-texto"><strong></strong><small></small></span>`;
    li.querySelector("strong")!.textContent = rotuloRef(ref, k);
    li.querySelector("small")!.textContent = descricaoUsado(ref);
    li.onclick = () => {
      if (editor || comando) return avisar("Conclua o comando atual (✓) antes de selecionar outro item.");
      if (ref.tipo === "face" || ref.tipo === "aresta" || ref.tipo === "vertice") {
        definirSel(null);
        selPeca = [ref];
        renderizarArvore();
        atualizarStatus();
        atualizarDestaques();
        if (!entidadeDeRef(ref)) avisar("Esse elemento não existe mais na peça atual.");
      } else if (ref.tipo === "plano" && (ref.id === "XY" || ref.id === "XZ" || ref.id === "YZ")) {
        limparSelPeca();
        selecionar({ tipo: "ref", id: ref.id });
      } else if (alvo) {
        limparSelPeca();
        selecionar({ tipo: "feature", id: alvo.id });
      }
    };
    return li;
  };

  /** Item fixo da árvore (Chapa metálica, Padrão planificado): ícone, nome, detalhe e ações. */
  const itemFixo = (icone: NomeIcone, nome: string, detalhe: string, acoes: () => AcaoContexto[], duplo: () => void, apagado = false) => {
    const li = document.createElement("li");
    li.className = "item";
    li.classList.toggle("suprimida", apagado);
    li.innerHTML = `<span class="item-seta vazia"></span><span class="item-ic">${ICONES[icone]}</span><span class="item-texto"><strong></strong><small></small></span>`;
    li.querySelector("strong")!.textContent = nome;
    li.querySelector("small")!.textContent = detalhe;
    li.onclick = () => {
      if (editor || comando) return avisar("Conclua o comando atual (✓) antes de selecionar outro item.");
      limparSelPeca();
      definirSel(null);
      mostrarBarraNoItem(li, acoes());
    };
    li.ondblclick = () => {
      esconderBarraContexto();
      if (!editor && !comando) duplo();
    };
    li.oncontextmenu = (ev) => {
      ev.preventDefault();
      if (!editor && !comando) mostrarBarraNoItem(li, acoes());
    };
    return li;
  };
  const fmt = (v: number) => Number(v.toFixed(3)).toLocaleString("pt-BR");
  // "Chapa metálica": parâmetros globais (guardados na primeira flange base), antes dela
  const base = doc.features.find(ehBaseChapa);
  const editarChapa = () => base && abrirComando(base, false, "chapa");

  doc.features.forEach((f, i) => {
    if (i === limite) lista.appendChild(barraRetrocesso());
    if (f.tipo === "esboco" && filhos.has(f.id)) return; // aparece dentro do recurso
    if (f === base && !mini) {
      lista.appendChild(itemFixo("chapa", "Chapa metálica", `t ${fmt(f.espessura)} · R ${fmt(f.raio)} · K ${fmt(f.fatorK)}`, () => [
        { rotulo: "Editar parâmetros", icone: "chapa", acao: editarChapa },
        { rotulo: "Material / K", icone: "material", acao: abrirTabelaChapa },
      ], editarChapa, f.suprimida));
    }
    adicionar(f, i, 0);
  });
  // "Padrão planificado": no fim, apagado enquanto a peça está dobrada (toque duplo alterna)
  if (base && !mini && temChapa()) {
    lista.appendChild(itemFixo("planificar", "Padrão planificado", planificado ? "planificado — toque duas vezes para dobrar" : "toque duas vezes para planificar", () => [
      { rotulo: planificado ? "Dobrar" : "Planificar", icone: "planificar", acao: () => alternarPlanificado() },
      { rotulo: "Exportar DXF", icone: "dxf", acao: () => void comandoChapa("dxf") },
    ], () => alternarPlanificado(), !planificado));
  }
  if (limite >= doc.features.length && doc.features.length) lista.appendChild(barraRetrocesso());

  if (!doc.features.length) {
    lista.insertAdjacentHTML("beforeend", `<li class="dica">Nenhum recurso ainda. Selecione um plano e toque Esboço (aba Sketch).</li>`);
  }
}

/** Recursos da árvore expandidos (seta ▾): mostram os elementos usados para criá-los. */
const expandidos = new Set<string>();

/**
 * Elementos usados para criar o recurso: esboço(s) absorvido(s), recursos de padrão/espelho e
 * referências escolhidas (faces, arestas, vértices, planos, eixos). Esboço: o plano/face de apoio.
 */
function elementosUsados(f: Feature): { esbocos: FeatureEsboco[]; recursos: Feature[]; refs: Referencia[] } {
  const esbocos = esbocosAbsorvidos(f)
    .map((id) => doc.features.find((x): x is FeatureEsboco => x.id === id && x.tipo === "esboco"))
    .filter((x): x is FeatureEsboco => !!x);
  const recursos = "recursos" in f ? f.recursos.map((id) => doc.features.find((x) => x.id === id)).filter((x): x is Feature => !!x) : [];
  const refs: Referencia[] = [];
  if (f.tipo === "esboco") {
    const s = f.suporte;
    if (s.tipo === "plano") refs.push({ tipo: "plano", id: s.plano });
    else if (s.tipo === "planoRef") refs.push({ tipo: "plano", id: s.id });
    // face: guardada como plano no momento da criação (sem assinatura da face)
  } else {
    const ehRef = (v: unknown): v is Referencia => {
      const o = v as Record<string, unknown>;
      if (!o || typeof o !== "object" || typeof o.tipo !== "string") return false;
      if (o.tipo === "face" || o.tipo === "aresta") return typeof o.ass === "object";
      if (o.tipo === "vertice") return Array.isArray(o.p);
      if (o.tipo === "linhaEsboco") return typeof o.geo === "string";
      return ["plano", "eixo", "esboco", "recurso"].includes(o.tipo) && typeof o.id === "string";
    };
    const varrer = (v: unknown) => {
      if (ehRef(v)) {
        const jaAninhado = v.tipo === "esboco" && esbocos.some((e) => e.id === v.id);
        if (!jaAninhado && !refs.some((r) => mesmaRef(r, v))) refs.push(v);
        return;
      }
      if (Array.isArray(v)) v.forEach(varrer);
      else if (v && typeof v === "object") Object.values(v).forEach(varrer);
    };
    varrer(f);
  }
  return { esbocos, recursos, refs };
}

function descricaoUsado(r: Referencia): string {
  switch (r.tipo) {
    case "face": return `Face (${({ plano: "plana", cilindro: "cilíndrica", cone: "cônica", esfera: "esférica", outra: "curva" } as const)[r.ass.geom]})`;
    case "aresta": return `Aresta (${({ linha: "reta", circulo: "circular", outra: "curva" } as const)[r.ass.geom]})`;
    case "vertice": return "Vértice";
    case "plano": return "Plano";
    case "eixo": return "Eixo";
    case "linhaEsboco": return "Linha do esboço";
    case "esboco": return "Esboço";
    case "recurso": return "Recurso";
    case "curva": return "Curva 3D";
  }
}

function barraRetrocesso(): HTMLElement {
  const li = document.createElement("li");
  li.className = "barra-retrocesso";
  const fim = doc.retrocesso === undefined;
  li.innerHTML = `<span></span>${fim ? "" : "<button>▼ 1</button><button>Ir para o fim</button>"}`;
  li.title = "Barra de retrocesso: recursos abaixo dela não são reconstruídos; novos recursos entram aqui.";
  const [btnDesce, btnFim] = [...li.querySelectorAll("button")];
  if (btnFim) btnFim.onclick = () => { delete doc.retrocesso; alterou(true); renderizarTudo(); };
  if (btnDesce) btnDesce.onclick = () => {
    doc.retrocesso = (doc.retrocesso ?? 0) + 1;
    if (doc.retrocesso >= doc.features.length) delete doc.retrocesso;
    alterou(true);
    renderizarTudo();
  };
  return li;
}

function mostrarBarraNoItem(li: HTMLElement, acoes: AcaoContexto[]) {
  const r = li.getBoundingClientRect();
  mostrarBarra(acoes, r.right - 10, r.bottom + 60);
}

/**
 * Excluir com confirmação, como nos CADs profissionais: lista os recursos filhos (dependem do
 * excluído e saem junto, por padrão) e os absorvidos (esboço consumido; opcional).
 */
function excluirFeature(f: Feature) {
  esconderBarraContexto();
  const filhos = filhosDe(doc.features, f.id);
  let comFilhos = true;
  let comAbsorvidos = false;
  const alvo = () => new Set([f.id, ...(comFilhos ? filhos.map((x) => x.id) : [])]);
  const absorvidos = () => absorvidosDe(doc.features, alvo());

  const fundo = document.createElement("div");
  fundo.className = "fundo-dialogo";
  const dlg = document.createElement("div");
  dlg.className = "dialogo dialogo-excluir";
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-modal", "true");
  fundo.append(dlg);
  const item = (x: Feature) => `<li>${ICONES[iconeFeature(x)]}<span>${escapar(x.nome)}</span><small>${ROTULO_TIPO[x.tipo]}</small></li>`;
  const montar = () => {
    const abs = absorvidos();
    dlg.innerHTML = `
      <header><strong>Confirmar exclusão</strong></header>
      <div class="excluir-corpo">
        <ul class="excluir-lista">${item(f)}</ul>
        ${filhos.length ? `
          <label class="excluir-opcao"><input type="checkbox" data-op="filhos" ${comFilhos ? "checked" : ""}/>Excluir também os recursos filhos (${filhos.length})</label>
          <ul class="excluir-lista filhos${comFilhos ? "" : " mantidos"}">${filhos.map(item).join("")}</ul>` : ""}
        ${abs.length ? `
          <label class="excluir-opcao"><input type="checkbox" data-op="absorvidos" ${comAbsorvidos ? "checked" : ""}/>Excluir também os recursos absorvidos (${abs.length})</label>
          <ul class="excluir-lista${comAbsorvidos ? "" : " mantidos"}">${abs.map(item).join("")}</ul>` : ""}
        ${filhos.length && !comFilhos ? `<p class="dialogo-nota">Os filhos mantidos ficarão com erro na árvore.</p>` : ""}
      </div>
      <footer><button data-b="cancelar">Cancelar</button><button data-b="ok" class="perigo">Excluir</button></footer>`;
    dlg.querySelector<HTMLInputElement>('[data-op="filhos"]')?.addEventListener("change", (e) => {
      comFilhos = (e.target as HTMLInputElement).checked;
      montar();
    });
    dlg.querySelector<HTMLInputElement>('[data-op="absorvidos"]')?.addEventListener("change", (e) => {
      comAbsorvidos = (e.target as HTMLInputElement).checked;
      montar();
    });
    dlg.querySelector<HTMLButtonElement>('[data-b="cancelar"]')!.onclick = fechar;
    const ok = dlg.querySelector<HTMLButtonElement>('[data-b="ok"]')!;
    ok.onclick = confirmar;
    ok.focus();
  };
  const fechar = () => {
    fundo.remove();
    document.removeEventListener("keydown", teclas, true);
  };
  const confirmar = () => {
    const ids = alvo();
    if (comAbsorvidos) for (const e of absorvidos()) ids.add(e.id);
    fechar();
    if (comando && ids.has(comando.f.id)) fecharComando();
    if (editor && ids.has(editor.esb.id)) sairEsboco();
    excluirRecursos(doc, ids);
    definirSel(null);
    alterou(true);
    renderizarTudo();
    avisar(ids.size > 1 ? `${ids.size} recursos excluídos.` : `${f.nome} excluído.`);
  };
  const teclas = (e: KeyboardEvent) => {
    if (e.key === "Escape") fechar();
    else if (e.key === "Enter" && !(e.target as HTMLElement).matches("input[type=checkbox]")) confirmar();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  fundo.onclick = (e) => e.target === fundo && fechar();
  document.addEventListener("keydown", teclas, true);
  document.body.append(fundo);
  montar();
}

function alternarReferencia(id: IdReferencia) {
  prefs.refsVisiveis[id] = !prefs.refsVisiveis[id];
  salvarPrefs();
  aplicarVisibilidadeRefs();
  renderizarTudo();
}

function moverFeature(i: number, delta: number) {
  const j = i + delta;
  if (j < 0 || j >= doc.features.length) return;
  [doc.features[i], doc.features[j]] = [doc.features[j], doc.features[i]];
  alterou(true);
}

/**
 * Seleção na árvore. Com `somar` (Ctrl/Shift) o item entra ou sai de uma seleção múltipla —
 * comandos como padrões e espelhar pegam os recursos já selecionados.
 */
function selecionar(s: Selecao, somar = false) {
  if (somar && s) {
    const lista = selArvore();
    const i = lista.findIndex((x) => x.tipo === s.tipo && x.id === s.id);
    if (i >= 0) lista.splice(i, 1);
    else lista.push(s);
    selecao = lista.pop() ?? null;
    selExtras = lista;
  } else definirSel(s);
  renderizarTudo();
}

function renderizarTudo() {
  renderizarArvore();
  atualizarStatus();
  renderizarBarraVistas();
  atualizarDestaques();
  if (!editor) desenharEsbocos();
  else renderizarPainelEdicaoEsboco();
}

// ---------- material ----------

function aplicarMaterial() {
  const m = doc.material ? MATERIAIS[doc.material] : undefined;
  viewport.definirCorPeca(m?.cor ?? 0xd0d7df);
}

function escolherMaterial(ancora: HTMLElement) {
  abrirPopover(ancora, [
    { rotulo: "Não especificado", marcado: !doc.material, acao: () => definirMaterial(undefined) },
    ...Object.entries(MATERIAIS).map(([k, m]) => ({
      rotulo: `${m.nome} · ${m.densidade.toLocaleString("pt-BR")} g/cm³`,
      marcado: doc.material === k,
      acao: () => definirMaterial(k),
    })),
  ]);
}

function definirMaterial(k: string | undefined) {
  doc.material = k;
  aplicarMaterial();
  alterou(true);
  atualizarStatus();
  if (!$("janela").hidden && $("janela-titulo").textContent === "Propriedades de massa") void mostrarMassa();
}

// ---------- esboço ----------
let solver: Promise<SolverEsboco> | null = null;
const obterSolver = () => (solver ??= SolverEsboco.criar(() => wasmPlaneGcs));

async function comandoEsboco(c: Comando, botao: HTMLElement) {
  if (comando) confirmarComando();
  fecharAvaliacao();
  switch (c.id) {
    case "esboco":
      if (editor) sairEsboco();
      else await iniciarEsboco();
      return;
    case "relacao": {
      if (!editor) return avisar("Relações: abra um esboço primeiro.");
      const ops = editor.relacoesPossiveis();
      if (!ops.length) return avisar("Selecione entidades para relacionar (ex.: duas linhas → Paralelo).");
      abrirPopover(botao, ops.map((o) => ({ rotulo: `${o.simbolo}   ${o.rotulo}`, acao: o.aplicar })));
      return;
    }
    case "construcao":
      if (!editor) return avisar("Construção: abra um esboço primeiro.");
      if (editor.geosSelecionadas().length) editor.alternarConstrucaoSelecao();
      else {
        editor.construcao = !editor.construcao;
        avisar(editor.construcao ? "Próximas entidades serão de construção." : "Próximas entidades serão normais.");
        renderizarAbas();
        renderizarPainelEdicaoEsboco();
      }
      return;
    case "espelhoDinamico":
      if (!editor) return avisar("Espelhamento dinâmico: abra um esboço primeiro.");
      editor.alternarEspelhoDinamico();
      return;
    case "selecionarTudo":
      if (!editor) return avisar("Selecionar tudo: abra um esboço primeiro.");
      editor.selecionarTudo();
      return;
    case "exibirRelacoes":
      if (!editor) return avisar("Relações: abra um esboço primeiro.");
      editor.definirFerramenta(c.id);
      return;
    case "padraoLinearEsboco":
    case "padraoCircularEsboco":
      if (!editor) return avisar("Padrão de esboço: abra um esboço primeiro.");
      editor.definirFerramenta(c.id);
      return;
    default: {
      // "ferramenta:variante" (ex.: retangulo:centro) — a variante vai para o editor antes
      const [ferr, variante] = c.id.split(":") as [Ferramenta, string | undefined];
      if (!editor && !(await iniciarEsboco(ferr))) return;
      if (variante) editor!.definirVariante(ferr, variante);
      editor!.definirFerramenta(ferr);
    }
  }
}

/** Esboço selecionado (edita), ou novo no plano/face selecionado; senão pede plano/face. */
async function iniciarEsboco(ferramenta?: Ferramenta): Promise<boolean> {
  const f = featureSelecionada();
  if (f?.tipo === "esboco") {
    await editarEsboco(f, ferramenta);
    return true;
  }
  const abs = f ? esbocosAbsorvidos(f)[0] : undefined;
  if (abs) {
    const e = doc.features.find((x): x is FeatureEsboco => x.id === abs && x.tipo === "esboco");
    if (e) {
      await editarEsboco(e, ferramenta);
      return true;
    }
  }
  if (f?.tipo === "planoRef") {
    await suporteEscolhido({ tipo: "planoRef", id: f.id }, null, ferramenta);
    return true;
  }
  if (selecao?.tipo === "ref" && selecao.id !== "origem") {
    await suporteEscolhido({ tipo: "plano", plano: selecao.id, deslocamento: 0 }, null, ferramenta);
    return true;
  }
  const face = selPeca.length === 1 && selPeca[0].tipo === "face" && selPeca[0].ass.geom === "plano" ? selPeca[0] : null;
  if (face && face.tipo === "face" && face.ass.normal) {
    await suporteEscolhido(faceComoSuporte(face.ass.centro, face.ass.normal), null, ferramenta);
    return true;
  }
  aguardando = { para: "esboco", ferramenta };
  avisar("Toque um plano na árvore ou uma face plana da peça para esboçar.");
  atualizarStatus();
  return false;
}

/** Face plana → suporte de esboço com origem = projeção da origem do modelo. */
/** Suporte de esboço para um plano principal (XY/XZ/YZ) ou um plano de referência criado. */
function suporteDoPlano(id: string): SuporteEsboco {
  return id === "XY" || id === "XZ" || id === "YZ" ? { tipo: "plano", plano: id, deslocamento: 0 } : { tipo: "planoRef", id };
}

function faceComoSuporte(ponto: Vec3, normal: Vec3): SuporteEsboco {
  const d = escalar(ponto, normal);
  return { tipo: "face", origem: normal.map((v) => v * d) as Vec3, normal, eixoX: eixoXParaNormal(normal) };
}

async function suporteEscolhido(suporte: SuporteEsboco, pontoTocado: Vec3 | null, ferramenta?: Ferramenta) {
  const para = aguardando?.para ?? "esboco";
  ferramenta ??= aguardando?.ferramenta;
  aguardando = null;
  limparSelPeca();
  if (para === "furo") return criarFuro(suporte, pontoTocado);
  const esb = novoEsboco(nomeNovo("esboco"), suporte);
  inserirFeature(esb);
  definirSel({ tipo: "feature", id: esb.id });
  alterou(true);
  await editarEsboco(esb, ferramenta);
}

async function editarEsboco(esb: FeatureEsboco, ferramenta?: Ferramenta) {
  if (editor) sairEsboco();
  if (comando) confirmarComando();
  fecharAvaliacao();
  let s: SolverEsboco;
  try {
    s = await obterSolver();
  } catch (e) {
    avisar("Não foi possível carregar o solver de esboço: " + (e as Error).message);
    return;
  }
  try {
    referencial(esb.suporte);
  } catch (e) {
    return avisar((e as Error).message);
  }
  limparEsbocos();
  // as cotas no modelo trazem uma cópia fixa do esboço: sem tirar, o que for aparado/apagado
  // continuaria aparecendo por baixo do esboço em edição
  fecharCotasNoModelo();
  esconderBarraContexto();
  limparSelPeca();
  definirSel({ tipo: "feature", id: esb.id });
  snapshotEsboco = JSON.stringify(doc);
  const host: Hospedeiro = {
    viewport,
    solver: s,
    overlay: $("overlay-esboco"),
    alterou: (final) => alterou(final),
    atualizarInterface: () => {
      renderizarAbas();
      renderizarPainelEdicaoEsboco();
      atualizarStatus();
    },
    avisar,
  };
  editor = new EditorEsboco(host, esb);
  // a seleção acima redesenha os esboços da peça (ainda sem editor): tira essas cópias fixas,
  // senão o que for aparado/apagado continua aparecendo por baixo do esboço em edição
  limparEsbocos();
  fecharCotasNoModelo();
  aplicarDispositivo();
  renderizarPainelEdicaoEsboco();
  if (ferramenta) editor.definirFerramenta(ferramenta);
  prefs.aba = "sketch";
  salvarPrefs();
  mostrarPainel("esboco");
  renderizarAbas();
  renderizarTudo();
}

function renderizarPainelEdicaoEsboco() {
  if (!editor) return;
  const ed = editor;
  renderizarPainelEsboco(
    $("painel-comando"),
    ed,
    sairEsboco,
    (nome) => {
      ed.esb.nome = nome;
      alterou(true);
      atualizarStatus();
    },
    (ancora) => abrirPopover(ancora, ed.relacoesPossiveis().map((r) => ({ rotulo: `${r.simbolo}   ${r.rotulo}`, acao: r.aplicar }))),
  );
}

function sairEsboco() {
  if (!editor) return;
  const id = editor.esb.id;
  editor.fechar();
  editor = null;
  snapshotEsboco = null;
  instalarToqueCurto();
  definirSel({ tipo: "feature", id });
  mostrarPainel("arvore");
  renderizarAbas();
  renderizarTudo();
  regenerar();
  if (voltarParaFuro) {
    const f = doc.features.find((x) => x.id === voltarParaFuro);
    voltarParaFuro = null;
    if (f) {
      prefs.aba = "features";
      renderizarAbas();
      abrirComando(f, false);
      if (comando) comando.aba = "Posições";
      renderizarComando();
    }
  }
  if (recursoAposEsboco) {
    const cmd = recursoAposEsboco;
    recursoAposEsboco = null;
    if (arestasAposEsboco.length) selPeca = arestasAposEsboco;
    arestasAposEsboco = [];
    prefs.aba = "chapa";
    renderizarAbas();
    criarRecurso(cmd);
  }
}

/** ✕ no canto de confirmação: sai do esboço desfazendo tudo o que foi feito nele. */
function descartarEsboco() {
  if (!editor || !snapshotEsboco) return;
  if (!confirm("Descartar as alterações deste esboço?")) return;
  const s = snapshotEsboco;
  editor.fechar();
  editor = null;
  snapshotEsboco = null;
  voltarParaFuro = null;
  recursoAposEsboco = null;
  arestasAposEsboco = [];
  instalarToqueCurto();
  doc = JSON.parse(s);
  mostrarPainel("arvore");
  registrarPasso();
  salvarAutosave();
  renderizarAbas();
  renderizarTudo();
  regenerar();
}

// esboços visíveis fora da edição: os que ainda não viraram recurso e o selecionado
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
  const usados = new Set(doc.features.flatMap(esbocosAbsorvidos));
  const { w, h } = viewport.tamanho();
  for (const f of ativas()) {
    if (f.tipo !== "esboco" || f.suprimida) continue;
    if (usados.has(f.id) && f.id !== idSelecionado()) continue;
    if (tipoOculto("esbocos") && f.id !== idSelecionado()) continue;
    let ref;
    try {
      ref = referencial(f.suporte);
    } catch {
      continue;
    }
    const c = construirCamada(f, { ref, mmPx: viewport.mmPorPixel(ref), resolucao: { w, h }, editando: false });
    viewport.grupoEsboco.add(c);
    camadasEsbocos.push(c);
  }
  viewport.pedirRender();
}

// ---------- furo assistido ----------

function iniciarFuro() {
  const face = selPeca.find((r): r is Extract<Referencia, { tipo: "face" }> => r.tipo === "face" && r.ass.geom === "plano");
  if (face?.ass.normal) {
    limparSelPeca();
    return criarFuro(faceComoSuporte(face.ass.centro, face.ass.normal), pontoTocado ?? face.ass.centro);
  }
  aguardando = { para: "furo" };
  avisar("Furo: toque a face plana onde ficam os furos.");
  atualizarStatus();
}

/** Cria o esboço de posições na face (com um ponto onde se tocou) e abre o painel do furo. */
function criarFuro(suporte: SuporteEsboco, ponto: Vec3 | null) {
  const antes = JSON.stringify(doc);
  const esb = novoEsboco(nomeNovo("esboco"), suporte);
  esb.nome = `Posições do furo ${nomeNovo("furo")}`;
  const r = referencial(suporte);
  const rel: Vec3 = ponto ? [ponto[0] - r.origem[0], ponto[1] - r.origem[1], ponto[2] - r.origem[2]] : [0, 0, 0];
  op.pontoSolto(esb, op.ponto(esb, { x: escalar(rel, r.x), y: escalar(rel, r.y) }));
  inserirFeature(esb);
  const f = novaFeature("furo", nomeNovo("furo")) as FeatureFuro;
  f.esboco = esb.id;
  inserirFeature(f);
  abrirComando(f, true);
  if (comando) comando.snapshot = antes;
}

// ---------- Avaliar ----------

function comandoAvaliar(id: string) {
  if (editor) sairEsboco();
  if (comando) confirmarComando();
  switch (id) {
    case "medir":
      if (avaliacao?.tipo === "medir") return fecharAvaliacao();
      {
        // entidades já selecionadas no modelo entram na medição (até duas)
        const pre = selPeca.slice(0, 2);
        fecharAvaliacao();
        avaliacao = { tipo: "medir", refs: pre };
        limparSelPeca();
        abrirJanela("Medir", "<p class='dica'>Toque faces, arestas ou vértices (até dois). Toque no vazio para limpar.</p>");
        if (pre.length) void atualizarMedida();
      }
      break;
    case "massa":
      return void mostrarMassa();
    case "verificar":
      return void mostrarVerificacao();
    case "desempenho":
      return mostrarDesempenho();
    case "vista-secao":
      if (avaliacao?.tipo === "secao") return fecharAvaliacao();
      fecharAvaliacao();
      fecharJanela();
      avaliacao = { tipo: "secao", plano: "XY", desloc: 0, inverter: false };
      aplicarSecao();
      renderizarPainelAvaliacao();
      break;
    case "analise-inclinacao":
    case "analise-espessura":
    case "zebra":
    case "curvatura": {
      const tipo = Object.entries(mapaAnalise).find(([, v]) => v === id)![0] as Analise["tipo"];
      if (avaliacao?.tipo === "analise" && avaliacao.analise.tipo === tipo) return fecharAvaliacao();
      fecharAvaliacao();
      fecharJanela();
      const analise: Analise = tipo === "inclinacao" ? { tipo, direcao: [0, 1, 0], angulo: 1 }
        : tipo === "espessura" ? { tipo, alvo: 2 } : tipo === "zebra" ? { tipo, listras: 12 } : { tipo };
      avaliacao = { tipo: "analise", analise, plano: "XY" };
      viewport.definirAnalise(analise);
      renderizarPainelAvaliacao();
      break;
    }
  }
  renderizarAbas();
  renderizarBarraVistas();
}

function fecharAvaliacao() {
  if (!avaliacao) return;
  if (avaliacao.tipo === "secao") viewport.definirSecao(null);
  if (avaliacao.tipo === "analise") viewport.definirAnalise(null);
  avaliacao = null;
  fecharJanela();
  if (!comando && !editor) mostrarPainel("arvore");
  atualizarDestaques();
  renderizarAbas();
  renderizarBarraVistas();
}

/** ✓ na vista de seção/análise: fecha o painel mantendo o efeito (desliga tocando de novo). */
function fecharAvaliacaoMantendo() {
  mostrarPainel("arvore");
  avisar("Efeito mantido. Toque de novo no comando para desligar.");
}

async function atualizarMedida() {
  if (avaliacao?.tipo !== "medir") return;
  const refs = avaliacao.refs;
  if (!refs.length) return abrirJanela("Medir", "<p class='dica'>Toque faces, arestas ou vértices (até dois).</p>");
  try {
    const r = await kernel.medir(refs);
    const nomes = refs.map((x, i) => rotuloRef(x, i)).join(" · ");
    abrirJanela("Medir", `<p class="dica">${nomes}</p>${tabela(r.linhas.map((l) => [l.rotulo, l.valor]))}`);
  } catch (e) {
    abrirJanela("Medir", `<p class="prop-erro">${(e as Error).message}</p>`);
  }
}

function tabela(linhas: [string, string][]) {
  return `<table class="tabela">${linhas.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join("")}</table>`;
}

const num = (v: number, casas = 3) => (Math.abs(v) < 0.5 * 10 ** -casas ? 0 : v).toLocaleString("pt-BR", { maximumFractionDigits: casas });

async function mostrarMassa() {
  let p: PropriedadesMassa;
  try {
    p = await kernel.massa();
  } catch (e) {
    return abrirJanela("Propriedades de massa", `<p class="prop-erro">${(e as Error).message}</p>`);
  }
  const m = doc.material ? MATERIAIS[doc.material] : undefined;
  const rho = (m?.densidade ?? 1) * 1e-3; // g/mm³
  const massa = p.volume * rho;
  const I = p.inercia.map((v) => v * rho);
  const linhas: [string, string][] = [
    ["Material", m ? m.nome : "não especificado (densidade 1 g/cm³)"],
    ["Densidade", `${num(m?.densidade ?? 1)} g/cm³`],
    ["Massa", `${num(massa, 2)} g`],
    ["Volume", `${num(p.volume, 2)} mm³`],
    ["Área de superfície", `${num(p.area, 2)} mm²`],
    ["Centro de massa (mm)", p.centro.map((v) => num(v)).join("; ")],
    ["Momentos principais (g·mm²)", p.principais.map((v) => num(v * rho, 1)).join("; ")],
    ["Eixos principais", p.eixos.map((e) => `(${e.map((v) => num(v)).join("; ")})`).join(" ")],
    ["Lxx; Lyy; Lzz no CM (g·mm²)", I.slice(0, 3).map((v) => num(v, 1)).join("; ")],
    ["Lxy; Lxz; Lyz", I.slice(3).map((v) => num(v, 1)).join("; ")],
  ];
  abrirJanela("Propriedades de massa", `${tabela(linhas)}
    <div class="prop-rodape"><button id="massa-material">Material…</button><button id="massa-copiar">Copiar</button></div>`);
  $("massa-material").onclick = () => escolherMaterial($("massa-material"));
  $("massa-copiar").onclick = () => void navigator.clipboard?.writeText(linhas.map((l) => l.join(": ")).join("\n"));
}

async function mostrarVerificacao() {
  try {
    const v = await kernel.verificar();
    abrirJanela("Verificar", tabela([
      ["Resultado", v.valida ? "✅ Geometria válida" : "❌ Geometria inválida"],
      ["Faces", String(v.faces)],
      ["Arestas", String(v.arestas)],
      ["Arestas curtas (< 0,01 mm)", String(v.arestasCurtas)],
      ["Menor aresta", `${num(v.menorAresta, 4)} mm`],
      ["Menor face", `${num(v.menorFace, 4)} mm²`],
    ]));
  } catch (e) {
    abrirJanela("Verificar", `<p class="prop-erro">${(e as Error).message}</p>`);
  }
}

function mostrarDesempenho() {
  const total = tempos.reduce((s, t) => s + t.ms, 0);
  const linhas = [...tempos].sort((a, b) => b.ms - a.ms).map((t): [string, string] => [
    doc.features.find((f) => f.id === t.id)?.nome ?? t.id, `${num(t.ms, 0)} ms (${num((100 * t.ms) / (total || 1), 0)}%)`,
  ]);
  abrirJanela("Desempenho da reconstrução", `<p class="dica">Total: ${num(total, 0)} ms · ${tempos.length} recursos</p>${tabela(linhas)}`);
}

const NORMAL_PLANO: Record<Plano, Vec3> = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] };

function aplicarSecao() {
  if (avaliacao?.tipo !== "secao") return;
  const n = NORMAL_PLANO[avaliacao.plano];
  const s = avaliacao.inverter ? -1 : 1;
  const d = avaliacao.desloc;
  viewport.definirSecao({ normal: n.map((v) => v * s) as Vec3, ponto: n.map((v) => v * d) as Vec3 });
}

function renderizarPainelAvaliacao() {
  const a = avaliacao;
  if (!a || a.tipo === "medir") return;
  mostrarPainel("comando");
  const painel = $("painel-comando");
  const titulo = a.tipo === "secao" ? "Vista de seção"
    : { inclinacao: "Análise de inclinação", espessura: "Análise de espessura", zebra: "Listras zebra", curvatura: "Curvatura" }[a.analise.tipo];
  painel.innerHTML = `<div class="pc-cabecalho"><h2 class="pc-titulo">${titulo}</h2><button class="pc-ok" title="Manter">✓</button><button class="pc-cancelar" title="Desligar">✕</button></div>`;
  painel.querySelector<HTMLElement>(".pc-ok")!.onclick = fecharAvaliacaoMantendo;
  painel.querySelector<HTMLElement>(".pc-cancelar")!.onclick = fecharAvaliacao;
  const caixa = document.createElement("section");
  caixa.className = "pc-caixa";
  const corpo = document.createElement("div");
  corpo.className = "pc-caixa-corpo";
  caixa.append(corpo);
  painel.append(caixa);
  const campoSel = (rot: string, valor: string, ops: [string, string][], mudar: (v: string) => void) => {
    const l = document.createElement("label");
    l.className = "campo";
    l.innerHTML = `<span class="campo-rotulo">${rot}</span>`;
    const s = document.createElement("select");
    for (const [v, r] of ops) s.add(new Option(r, v));
    s.value = valor;
    s.onchange = () => mudar(s.value);
    l.append(s);
    corpo.append(l);
  };
  const campoNum = (rot: string, valor: number, un: string, mudar: (v: number) => void, faixa?: [number, number]) => {
    const l = document.createElement("label");
    l.className = "campo";
    l.innerHTML = `<span class="campo-rotulo">${rot}</span>`;
    const g = document.createElement("div");
    g.className = "num";
    const inp = document.createElement("input");
    inp.inputMode = "decimal";
    inp.value = String(valor);
    inp.onchange = () => {
      const v = avaliarExpressao(inp.value, new Map());
      if (Number.isFinite(v)) mudar(v);
    };
    g.append(inp, Object.assign(document.createElement("span"), { className: "unidade", textContent: un }));
    l.append(g);
    if (faixa) {
      const r = document.createElement("input");
      r.type = "range";
      r.min = String(faixa[0]);
      r.max = String(faixa[1]);
      r.step = "0.1";
      r.value = String(valor);
      r.oninput = () => {
        inp.value = r.value;
        mudar(Number(r.value));
      };
      l.append(r);
    }
    corpo.append(l);
  };
  const inverter = (rot: string, acao: () => void) => {
    const b = document.createElement("button");
    b.className = "pc-inverter";
    b.textContent = `⇅ ${rot}`;
    b.onclick = acao;
    corpo.append(b);
  };
  const planos: [string, string][] = [["XY", "Plano Frontal"], ["XZ", "Plano Superior"], ["YZ", "Plano Lateral"]];
  if (a.tipo === "secao") {
    const t = viewport.topologia;
    const ext = t?.vertices.length ? Math.max(...t.vertices.flatMap((v) => v.map(Math.abs)), 10) : 50;
    campoSel("Seção 1: plano", a.plano, planos, (v) => { a.plano = v as Plano; aplicarSecao(); });
    campoNum("Deslocamento", a.desloc, "mm", (v) => { a.desloc = v; aplicarSecao(); }, [-ext, ext]);
    inverter("Inverter lado", () => { a.inverter = !a.inverter; aplicarSecao(); });
    corpo.insertAdjacentHTML("beforeend", "<p class='dica'>A tampa laranja mostra o material cortado (só visual; a peça não muda).</p>");
  } else {
    const an = a.analise;
    const atualizar = () => {
      viewport.definirAnalise(an);
      mostrarLegendaAnalise();
    };
    if (an.tipo === "inclinacao") {
      campoSel("Direção de extração (normal do plano)", a.plano, planos, (v) => { a.plano = v as Plano; an.direcao = NORMAL_PLANO[a.plano]; atualizar(); });
      campoNum("Ângulo de inclinação", an.angulo, "°", (v) => { an.angulo = v; atualizar(); });
      inverter("Inverter direção", () => { an.direcao = an.direcao.map((x) => -x) as Vec3; atualizar(); });
    } else if (an.tipo === "espessura") {
      campoNum("Espessura alvo", an.alvo, "mm", (v) => { an.alvo = v; atualizar(); });
    } else if (an.tipo === "zebra") {
      campoNum("Nº de listras", an.listras, "", (v) => { an.listras = Math.max(2, Math.round(v)); atualizar(); });
    }
    corpo.insertAdjacentHTML("beforeend", `<p class="dica legenda-analise"></p>`);
    mostrarLegendaAnalise();
  }
}

function mostrarLegendaAnalise() {
  const el = $("painel-comando").querySelector(".legenda-analise");
  if (el) el.textContent = viewport.infoAnalise;
}

function abrirJanela(titulo: string, html: string) {
  $("janela").classList.remove("larga");
  $("janela-titulo").textContent = titulo;
  $("janela-corpo").innerHTML = html;
  $("janela").hidden = false;
}
function fecharJanela() {
  $("janela").hidden = true;
  $("janela").classList.remove("larga");
}
$("janela-fechar").onclick = () => {
  fecharJanela();
  if (avaliacao?.tipo === "medir") fecharAvaliacao();
};

// ---------- chapa metálica: planificar, DXF, tabela ----------

/** Vista planificada da chapa ligada (o kernel troca a peça pelo planificado). */
let planificado = false;
const temChapa = () => ativas().some((x) => ehBaseChapa(x) && !x.suprimida);

function alternarPlanificado(liga = !planificado) {
  if (liga && !temChapa()) return avisar("Planificar: a peça não tem chapa metálica (comece por uma Flange base).");
  if (liga === planificado) return;
  planificado = liga;
  limparSelPeca();
  renderizarAbas();
  renderizarArvore();
  regenerar();
  primeiraRegeneracao = true; // enquadra a peça na nova forma
  avisar(liga ? "Vista planificada (linhas de dobra em laranja). Toque Planificar de novo para dobrar." : "Chapa dobrada.");
}

async function comandoChapa(id: string) {
  if (editor) sairEsboco();
  if (comando) confirmarComando();
  if (id === "planificar") return alternarPlanificado();
  if (id === "material") return abrirTabelaChapa();
  if (!temChapa()) return avisar("Exportar DXF: a peça não tem chapa metálica (comece por uma Flange base).");
  try {
    const { dxf, resumo } = await kernel.dxf(doc.nome);
    baixar(new Blob([dxf], { type: "application/dxf" }), "dxf");
    const mat = MATERIAIS[doc.material ?? ""];
    const massa = mat ? (resumo.area * resumo.espessura * mat.densidade) / 1000 : null;
    abrirJanela("Lista de corte (planificado)", `
      <table class="tabela">
        <tr><td>Caixa delimitadora</td><td>${num(resumo.largura)} × ${num(resumo.altura)} mm</td></tr>
        <tr><td>Espessura</td><td>${num(resumo.espessura)} mm</td></tr>
        <tr><td>Raio de dobra · fator K</td><td>${num(resumo.raio)} mm · ${num(resumo.fatorK)}</td></tr>
        <tr><td>Nº de dobras</td><td>${resumo.dobras}</td></tr>
        <tr><td>Comprimento de corte</td><td>${num(resumo.comprimentoCorte)} mm</td></tr>
        <tr><td>Recortes internos</td><td>${resumo.recortes}</td></tr>
        <tr><td>Área da chapa</td><td>${num(resumo.area)} mm²</td></tr>
        <tr><td>Material · massa</td><td>${mat ? `${escapar(mat.nome)} · ${num(massa!)} g` : "— (defina em Avaliar → Massa)"}</td></tr>
      </table>
      <p class="dica">DXF R12 em mm baixado. Camadas: CONTORNO, DOBRA_CIMA, DOBRA_BAIXO e NOTAS (ângulo, raio e sentido de cada dobra).</p>`);
  } catch (e) {
    avisar("Exportar DXF: " + (e as Error).message);
  }
}

/** Tabela de material/espessura: toca numa linha para aplicar na Flange base. */
function abrirTabelaChapa() {
  const fb = ativas().find((x): x is FeatureBaseChapa => ehBaseChapa(x) && !x.suprimida);
  const atual = fb ? `${fb.espessura}|${fb.raio}|${fb.fatorK}` : "";
  const linhas = TABELA_CHAPA.map((l, i) => {
    const sel = atual === `${l.espessura}|${l.raio}|${l.k}` && fb?.tabela.startsWith(l.material);
    return `<tr data-i="${i}" class="${sel ? "sel" : ""}" style="cursor:pointer"><td>${l.material}</td><td>${num(l.espessura)}</td><td>${num(l.raio)}</td><td>${num(l.k)}</td></tr>`;
  }).join("");
  abrirJanela("Material / espessura / fator K", `
    <p class="dica">${fb ? `Toque numa linha para aplicar em <b>${escapar(fb.nome)}</b> (vale para toda a chapa). Valores próprios: edite a Flange base.` : "Crie uma Flange base para aplicar a tabela."}</p>
    <table class="tabela"><tr><th>Material</th><th>Espessura</th><th>Raio interno</th><th>Fator K</th></tr>${linhas}</table>
    <p class="dica">Referência para dobra no ar com raio ≈ espessura. Ajuste raio e K ao ferramental de quem vai dobrar.</p>`);
  if (!fb) return;
  $("janela-corpo").querySelectorAll<HTMLTableRowElement>("tr[data-i]").forEach((tr) => {
    tr.onclick = () => {
      const l = TABELA_CHAPA[Number(tr.dataset.i)];
      Object.assign(fb, { tabela: `${l.material}|${l.espessura}`, espessura: l.espessura, raio: l.raio, fatorK: l.k });
      alterou(true);
      abrirTabelaChapa();
    };
  });
}

// ---------- equações ----------

const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function abrirEquacoes() {
  const vars = doc.variaveis ?? [];
  const { valores, erros } = resolverVariaveis(vars);
  const eqs = Object.entries(doc.equacoes ?? {});
  const linhasVars = vars.map((v, i) => `
    <tr><td><input data-i="${i}" data-k="nome" value="${escapar(v.nome)}" /></td>
    <td><input data-i="${i}" data-k="expr" value="${escapar(v.expr)}" /></td>
    <td>${erros.includes(v.nome) ? "⚠" : num(valores.get(v.nome) ?? NaN)}</td>
    <td><button data-x="${i}" class="btn-ic">✕</button></td></tr>`).join("");
  const linhasEq = eqs.map(([k, e]) => {
    const [fid, ...cam] = k.split(".");
    const f = doc.features.find((x) => x.id === fid);
    return `<tr><td>${escapar(f?.nome ?? "?")} · ${escapar(cam.join("."))}</td><td>${escapar(e)}</td><td>${num(avaliarExpressao(e, valores))}</td><td><button data-eq="${escapar(k)}" class="btn-ic">✕</button></td></tr>`;
  }).join("");
  abrirJanela("Equações e variáveis globais", `
    <p class="dica">Use nos campos numéricos como <b>=nome</b> (ex.: <b>=largura/2</b>). Funções: sin, cos, tan (graus), sqrt, abs, min, max, round, if(cond; a; b).</p>
    <table class="tabela edicao"><tr><th>Nome</th><th>Valor / expressão</th><th>=</th><th></th></tr>${linhasVars}</table>
    <div class="prop-rodape"><button id="eq-nova">+ Variável</button><button id="eq-aplicar" class="destaque">Aplicar</button></div>
    ${eqs.length ? `<h3 class="prop-titulo">Equações nos recursos</h3><table class="tabela">${linhasEq}</table>` : ""}`);
  const corpo = $("janela-corpo");
  const lerTabela = () => {
    const novas = vars.map((v) => ({ ...v }));
    corpo.querySelectorAll<HTMLInputElement>("input[data-i]").forEach((inp) => {
      const v = novas[Number(inp.dataset.i)];
      if (inp.dataset.k === "nome") v.nome = inp.value.trim().replace(/[^\wÀ-ſ]/g, "_");
      else v.expr = inp.value.trim();
    });
    return novas;
  };
  $("eq-nova").onclick = () => {
    doc.variaveis = [...lerTabela(), { nome: `var${vars.length + 1}`, expr: "10" }];
    abrirEquacoes();
  };
  $("eq-aplicar").onclick = () => {
    doc.variaveis = lerTabela();
    alterou(true);
    abrirEquacoes();
  };
  corpo.querySelectorAll<HTMLElement>("[data-x]").forEach((b) => (b.onclick = () => {
    doc.variaveis = lerTabela().filter((_, i) => i !== Number(b.dataset.x));
    alterou(true);
    abrirEquacoes();
  }));
  corpo.querySelectorAll<HTMLElement>("[data-eq]").forEach((b) => (b.onclick = () => {
    delete doc.equacoes![b.dataset.eq!];
    alterou(true);
    abrirEquacoes();
  }));
}

// ---------- barra de vistas (flutuante no viewport) ----------
const VISTAS: [Vista, string, string][] = [
  ["frontal", "Frontal", "Ctrl+1"],
  ["traseira", "Posterior", "Ctrl+2"],
  ["esquerda", "Esquerda", "Ctrl+3"],
  ["direita", "Direita", "Ctrl+4"],
  ["superior", "Superior", "Ctrl+5"],
  ["inferior", "Inferior", "Ctrl+6"],
  ["iso", "Isométrica", "Ctrl+7"],
];
const ESTILOS: [EstiloExibicao, string, NomeIcone][] = [
  ["sombreado-arestas", "Sombreado com arestas", "estiloSombreadoArestas"],
  ["sombreado", "Sombreado", "estiloSombreado"],
  ["arestas", "Só arestas", "estiloArestas"],
];

/** Plano associado à seleção atual (para "Normal a"). */
function planoDaSelecao(): SuporteEsboco | null {
  if (selecao?.tipo === "ref") return selecao.id === "origem" ? null : { tipo: "plano", plano: selecao.id, deslocamento: 0 };
  const face = selPeca.find((r): r is Extract<Referencia, { tipo: "face" }> => r.tipo === "face" && r.ass.geom === "plano");
  if (face?.ass.normal) return faceComoSuporte(face.ass.centro, face.ass.normal);
  const f = featureSelecionada();
  if (f?.tipo === "esboco") return f.suporte;
  if (f?.tipo === "planoRef") return { tipo: "planoRef", id: f.id };
  const abs = f ? esbocosAbsorvidos(f)[0] : undefined;
  if (abs) {
    const e = doc.features.find((x) => x.id === abs);
    if (e?.tipo === "esboco") return e.suporte;
  }
  return null;
}

function normalA() {
  const p = editor ? editor.esb.suporte : planoDaSelecao();
  if (!p) return avisar("Selecione um plano, face plana ou esboço.");
  try {
    viewport.olharPlano(referencial(p));
  } catch (e) {
    avisar((e as Error).message);
  }
}

function abrirSeletorVistas(ancora: HTMLElement) {
  abrirPopover(ancora, [
    ...VISTAS.map(([v, r, k]) => ({ rotulo: `${r}  ·  ${k}`, acao: () => viewport.definirVista(v) })),
    { rotulo: "Normal a  ·  Ctrl+8", icone: "normalA" as NomeIcone, acao: normalA },
  ]);
}

const TIPOS_ITENS: [TipoItem, string][] = [["planos", "Planos"], ["eixos", "Eixos"], ["origem", "Origem"], ["esbocos", "Esboços"]];

/**
 * Barra de vistas no topo do viewport, recolhida numa setinha para não ocupar a tela:
 * ampliar para caber, zoom por área, vista de seção, orientação, ocultar/mostrar itens e
 * configurações de vista.
 */
function renderizarBarraVistas() {
  const barra = $("barra-vistas");
  barra.innerHTML = "";
  const aberta = !!prefs.barraVistasAberta;
  barra.classList.toggle("aberta", aberta);
  const seta = document.createElement("button");
  seta.className = "btn-ic seta-vistas";
  seta.title = aberta ? "Recolher a barra de vistas" : "Ferramentas de vista";
  seta.setAttribute("aria-label", seta.title);
  seta.setAttribute("aria-expanded", String(aberta));
  seta.innerHTML = ICONES[aberta ? "setaCima" : "setaBaixo"];
  seta.onclick = () => {
    prefs.barraVistasAberta = !aberta;
    salvarPrefs();
    fecharPopover();
    renderizarBarraVistas();
  };
  barra.appendChild(seta);
  if (!aberta) return;

  const caixa = document.createElement("div");
  caixa.className = "caixa-vistas";
  barra.appendChild(caixa);
  const botao = (icone: NomeIcone, titulo: string, acao: (b: HTMLButtonElement) => void, pressionado = false, menu = false) => {
    const b = document.createElement("button");
    b.className = `btn-ic${menu ? " com-menu" : ""}`;
    b.title = titulo;
    b.setAttribute("aria-label", titulo);
    b.setAttribute("aria-pressed", String(pressionado));
    b.innerHTML = ICONES[icone] + (menu ? `<span class="mini-seta">▾</span>` : "");
    b.onclick = () => acao(b);
    caixa.appendChild(b);
    return b;
  };

  botao("enquadrar", "Ampliar para caber (F)", () => viewport.enquadrar());
  botao("zoomArea", "Zoom por área: arraste um retângulo", () => iniciarZoomArea(), zoomAreaAtivo);
  botao("vistaSecao", "Vista de seção", () => comandoAvaliar("vista-secao"), avaliacao?.tipo === "secao");
  botao("vistas", "Orientação da vista (Espaço)", (b) => abrirSeletorVistas(b), false, true);
  const algoOculto = !!prefs.ocultarTudo || !!prefs.tiposOcultos?.length;
  botao(algoOculto ? "olhoFechado" : "olho", "Ocultar/mostrar itens", (b) => abrirOcultarItens(b), algoOculto, true);
  botao("configVista", "Configurações de vista", (b) => abrirConfigVista(b), false, true);
  botao("filtroSelecao", filtroLigado() ? "Filtro de seleção (ligado) · F5" : "Filtro de seleção · F5", (b) => abrirFiltroSelecao(b), filtroLigado(), true);
}

function alternarTipoOculto(t: TipoItem | "tudo") {
  if (t === "tudo") prefs.ocultarTudo = !prefs.ocultarTudo;
  else {
    const lista = new Set(prefs.tiposOcultos ?? []);
    if (lista.has(t)) lista.delete(t);
    else lista.add(t);
    prefs.tiposOcultos = [...lista];
  }
  salvarPrefs();
  aplicarVisibilidadeRefs();
  mostrarReferenciasExtras();
  if (!editor) desenharEsbocos();
  renderizarBarraVistas();
}

function abrirOcultarItens(b: HTMLElement) {
  abrirPopover(b, [
    {
      rotulo: prefs.ocultarTudo ? "Mostrar os tipos de novo" : "Ocultar todos os tipos",
      icone: prefs.ocultarTudo ? "olho" : "olhoFechado",
      marcado: !!prefs.ocultarTudo,
      acao: () => alternarTipoOculto("tudo"),
    },
    ...TIPOS_ITENS.map(([t, r]) => ({
      rotulo: `${r}${prefs.ocultarTudo ? " (ocultos por \"todos os tipos\")" : ""}`,
      icone: (tipoOculto(t) ? "olhoFechado" : "olho") as NomeIcone,
      marcado: !tipoOculto(t),
      acao: () => alternarTipoOculto(t),
    })),
  ]);
}

function abrirConfigVista(b: HTMLElement) {
  abrirPopover(b, [
    ...ESTILOS.map(([e, r, ic]) => ({
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
  ]);
}

// ---------- zoom por área ----------

let zoomAreaAtivo = false;

/** Arrastar um retângulo no viewport para ampliá-lo (Esc ou toque sem arrastar cancela). */
function iniciarZoomArea() {
  if (zoomAreaAtivo) return;
  zoomAreaAtivo = true;
  renderizarBarraVistas();
  avisar("Zoom por área: arraste um retângulo sobre a região a ampliar.");
  const vp = $("viewport");
  const capa = document.createElement("div");
  capa.className = "capa-zoom-area";
  const ret = document.createElement("div");
  ret.className = "retangulo-zoom";
  capa.appendChild(ret);
  vp.appendChild(capa);
  let ini: { x: number; y: number } | null = null;
  const fim = () => {
    zoomAreaAtivo = false;
    capa.remove();
    document.removeEventListener("keydown", esc, true);
    renderizarBarraVistas();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    fim();
  };
  document.addEventListener("keydown", esc, true);
  capa.onpointerdown = (e) => {
    ini = { x: e.clientX, y: e.clientY };
    capa.setPointerCapture(e.pointerId);
  };
  capa.onpointermove = (e) => {
    if (!ini) return;
    const r = vp.getBoundingClientRect();
    Object.assign(ret.style, {
      display: "block",
      left: `${Math.min(ini.x, e.clientX) - r.left}px`,
      top: `${Math.min(ini.y, e.clientY) - r.top}px`,
      width: `${Math.abs(e.clientX - ini.x)}px`,
      height: `${Math.abs(e.clientY - ini.y)}px`,
    });
  };
  capa.onpointerup = (e) => {
    if (ini) viewport.ampliarArea(ini.x, ini.y, e.clientX, e.clientY);
    fim();
  };
  capa.onpointercancel = fim;
}

interface ItemPopover {
  rotulo: string;
  icone?: NomeIcone;
  marcado?: boolean;
  acao: () => void;
  /** Ponteiro sobre o item (ex.: realçar a entidade no modelo). */
  aoPassar?: () => void;
}

let popoverAberto: HTMLElement | null = null;
function fecharPopover() {
  popoverAberto?.remove();
  popoverAberto = null;
}

function abrirPopover(ancora: HTMLElement | { x: number; y: number }, itens: ItemPopover[]) {
  const titulo = ancora instanceof HTMLElement ? ancora.title || ancora.textContent || "" : "cursor";
  const reabrir = popoverAberto?.dataset.ancora !== titulo;
  fecharPopover();
  if (!reabrir) return;
  const p = document.createElement("div");
  p.className = "popover";
  p.dataset.ancora = titulo;
  for (const it of itens) {
    const b = document.createElement("button");
    b.innerHTML = `${it.icone ? ICONES[it.icone] : ""}<span>${it.rotulo}</span>${it.marcado ? "<b>✓</b>" : ""}`;
    b.onclick = () => {
      fecharPopover();
      it.acao();
    };
    if (it.aoPassar) b.onpointerenter = it.aoPassar;
    p.appendChild(b);
  }
  document.body.appendChild(p);
  const r = ancora instanceof HTMLElement ? ancora.getBoundingClientRect() : { left: ancora.x, bottom: ancora.y };
  const largura = p.offsetWidth, altura = p.offsetHeight;
  p.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - altura - 8))}px`;
  p.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - largura - 8))}px`;
  popoverAberto = p;
}

document.addEventListener("pointerdown", (e) => {
  const alvo = e.target as HTMLElement;
  const b = alvo.closest("button");
  const ehAncora = !!b && (b.title || b.textContent) === popoverAberto?.dataset.ancora;
  if (popoverAberto && !popoverAberto.contains(alvo) && !ehAncora) fecharPopover();
  const menu = $("menu-arquivo");
  if (!menu.hidden && !alvo.closest(".menu-wrap")) fecharMenu();
  if (!$("barra-contexto").hidden && !alvo.closest(".barra-contexto") && !alvo.closest("canvas") && !alvo.closest(".arvore")) esconderBarraContexto();
});

// ---------- aviso flutuante ----------
let tempoAviso: number | undefined;
function avisar(texto: string) {
  const el = $("aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(tempoAviso);
  tempoAviso = window.setTimeout(() => (el.hidden = true), 3200);
}

// ---------- arquivo ----------
const nomeDoc = $<HTMLInputElement>("nome-doc");
nomeDoc.value = doc.nome;
nomeDoc.onchange = () => {
  doc.nome = nomeDoc.value.trim() || "Peça";
  nomeDoc.value = doc.nome;
  alterou(true);
};

/** Salva no cofre do WJPDM: no dispositivo, em GO-OUT (o GO-IN publica no pendrive e no Drive). */
function salvarPeca(): Promise<string> {
  capturarAtiva(doc);
  limparConfiguracoes(doc);
  const dados = new Blob([JSON.stringify(doc, null, 2)], { type: "application/octet-stream" });
  avisar("Salvando no cofre…");
  const p = salvarNoCofre("cad", `${doc.nome}.wjcad`, dados, (nome) => {
    doc.nome = nome;
    nomeDoc.value = nome;
    salvarAutosave();
    renderizarArvore();
  });
  p.then(avisar, (e) => avisar(`Não foi possível salvar: ${(e as Error).message}`));
  return p;
}

const ACOES: Record<string, { rotulo: string; icone: NomeIcone; fazer: () => void }> = {
  novo: { rotulo: "Novo…", icone: "nova", fazer: abrirDialogoNovo },
  abrir: { rotulo: "Abrir arquivo do aparelho…", icone: "abrir", fazer: () => $<HTMLInputElement>("arquivo").click() },
  salvar: {
    rotulo: "Salvar (.wjcad)",
    icone: "salvar",
    // octet-stream: o Android não troca a extensão .wjcad por .json
    fazer: () => void salvarPeca(),
  },
  locais: { rotulo: "Cópias do cofre (pendrive, Drive, tablet)…", icone: "pasta", fazer: () => void abrirCopias() },
  abrirCofre: { rotulo: "Abrir do cofre (WJPDM)…", icone: "pasta", fazer: () => void abrirDoCofre("cad") },
  step: { rotulo: "Exportar STEP", icone: "exportar", fazer: () => exportar("step") },
  stl: { rotulo: "Exportar STL", icone: "exportar", fazer: () => exportar("stl") },
  fluxo: { rotulo: "Abrir no WJFlow (escoamento de ar)", icone: "exportar", fazer: () => void abrirNoWJFlow() },
  desenho: { rotulo: "Criar desenho desta peça", icone: "desenho", fazer: () => {
    salvarAutosave();
    location.href = new URL(`${import.meta.env.BASE_URL}cad/desenho/#de-peca`, location.href).href;
  } },
  equacoes: { rotulo: "Equações…", icone: "equacoes", fazer: abrirEquacoes },
  material: { rotulo: "Material…", icone: "materialPeca", fazer: () => escolherMaterial($("btn-menu")) },
  cotas: { rotulo: "Exibir todas as cotas", icone: "cota", fazer: () => (recursoComCotas === TODAS_AS_COTAS ? fecharCotasNoModelo() : mostrarTodasAsCotas()) },
  reconstruir: { rotulo: "Reconstruir (Ctrl+B)", icone: "desempenho", fazer: () => regenerar() },
  fechar: { rotulo: "Fechar documento", icone: "fechar", fazer: fecharDocumento },
  dispositivo: { rotulo: "Dispositivo (celular, tablet, computador)…", icone: "tablet", fazer: () => escolherDispositivo(false) },
  atalhos: { rotulo: "Atalhos de teclado e mouse", icone: "menu", fazer: mostrarAtalhos },
  sobre: { rotulo: "Sobre e licenças", icone: "menu", fazer: mostrarSobre },
};

/** Manda a malha da peça para o WJFlow (IndexedDB do aparelho) e abre o WJFlow com ela. */
async function abrirNoWJFlow() {
  if (!ultimaMalha) return avisar("A peça ainda não tem sólido para analisar.");
  try {
    const b = await Armazem.abrir("wjflow", ["estudos"]);
    await b.por("estudos", { id: "do-cad", nome: doc.nome, vertices: ultimaMalha.vertices, triangulos: ultimaMalha.triangulos } as { id: string });
    location.href = `${import.meta.env.BASE_URL}flow/#peca-do-cad`;
  } catch (e) {
    avisar(`Não foi possível abrir no WJFlow: ${(e as Error).message}`);
  }
}

/** Componentes de terceiros usados no app (com as licenças). */
function mostrarSobre() {
  abrirJanela("Sobre o WJCAD", `<p>WJCAD — CAD paramétrico do WJProMaster, para tablet, celular e computador. Funciona offline. Abre também arquivos .jlscad e .cadt das versões antigas.</p>
  ${tabela([
    ["OpenCascade (replicad-opencascadejs)", "Núcleo de sólidos — LGPL 2.1 com exceção"],
    ["replicad", "Ponte com o OpenCascade — MIT"],
    ["PlaneGCS (@salusoft89/planegcs, do FreeCAD)", "Solver do esboço — LGPL 2.0 ou posterior"],
    ["Three.js", "Visualização 3D — MIT"],
    ["opentype.js", "Leitura de fontes do texto de esboço — MIT"],
    ["Noto Sans (@fontsource/noto-sans)", "Fonte do texto de esboço — SIL Open Font License 1.1, © The Noto Project Authors"],
  ])}
  <p class="dica">As fontes OFL podem ser usadas, embutidas e redistribuídas livremente com o programa; não podem ser vendidas sozinhas.</p>`);
}

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

function mostrarAtalhos() {
  abrirJanela("Atalhos", tabela([
    ["Mouse: botão do meio", "Girar (Ctrl + meio: arrastar a vista)"],
    ["Mouse: roda", "Aproximar/afastar no cursor"],
    ["Mouse: botão direito", "Menu de contexto"],
    ["Toque: 1 dedo / 2 dedos", "Girar / aproximar e arrastar"],
    ["Ctrl+1…7 · Ctrl+8", "Vistas padrão · Normal a"],
    ["Espaço", "Orientação da vista"],
    ["F", "Ampliar para caber"],
    ["S", "Barra de atalhos no cursor"],
    ["F5 · X · E · V", "Filtro de seleção: liga/desliga · só faces · só arestas · só vértices"],
    ["Ctrl+B", "Reconstruir"],
    ["Enter / Esc", "OK / Cancelar no comando"],
    ["Ctrl+Z / Ctrl+Y / Ctrl+S", "Desfazer / Refazer / Salvar"],
    ["Esboço: L R C A S P T D O M V", "Linha, Retângulo, Círculo, Arco, Spline, Polígono, Aparar, Cota, Offset, Espelhar, Selecionar"],
  ]));
}

// ---------- documento: novo, abrir, fechar ----------

/** Ambientes de documento (chapa metálica é feita dentro da peça). Montagem e Desenho têm páginas próprias. */
const AMBIENTES = [
  { id: "peca", rotulo: "Peça", descricao: "Sólido 3D a partir de esboços e recursos", icone: "peca" as NomeIcone },
  { id: "montagem", rotulo: "Montagem", descricao: "Peças posicionadas entre si (componentes e posicionamentos)", icone: "montagem" as NomeIcone },
  { id: "desenho", rotulo: "Desenho", descricao: "Folha ABNT com vistas da peça ou montagem, legenda e PDF", icone: "desenho" as NomeIcone },
];
let contadorPecas = 0;

function abrirDialogoNovo() {
  const dlg = $("dialogo-novo");
  const lista = $("dn-ambientes");
  lista.innerHTML = "";
  let escolhido = AMBIENTES[0].id;
  for (const a of AMBIENTES) {
    const b = document.createElement("button");
    b.className = "ambiente";
    b.setAttribute("aria-pressed", String(a.id === escolhido));
    b.innerHTML = `${ICONES[a.icone]}<strong>${a.rotulo}</strong><small>${a.descricao}</small>`;
    b.onclick = () => {
      escolhido = a.id;
      lista.querySelectorAll(".ambiente").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    };
    b.ondblclick = () => ok();
    lista.append(b);
  }
  const fechar = () => {
    dlg.hidden = true;
    document.removeEventListener("keydown", teclas, true);
  };
  const ok = () => {
    if (escolhido !== "peca") {
      // montagem e desenho: páginas do WJCAD (a peça aberta continua no salvamento automático)
      salvarAutosave();
      location.href = new URL(`${import.meta.env.BASE_URL}cad/${escolhido}/#novo`, location.href).href;
      return;
    }
    if (aberto && doc.features.length && !confirm("Fechar a peça atual e começar uma nova? (o que não foi salvo em arquivo se perde)")) return;
    fechar();
    const d = documentoVazio();
    desligar("cad"); // peça nova: o próximo salvar cria um arquivo no cofre
    d.nome = `Peça${++contadorPecas}`;
    abrirDocumento(d);
  };
  const teclas = (e: KeyboardEvent) => {
    if (e.key === "Escape") fechar();
    else if (e.key === "Enter") ok();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  $("dn-ok").onclick = ok;
  $("dn-cancelar").onclick = fechar;
  dlg.onclick = (e) => e.target === dlg && fechar();
  document.addEventListener("keydown", teclas, true);
  dlg.hidden = false;
  lista.querySelector<HTMLElement>(".ambiente")?.focus();
}

/** Mostra o documento na área de trabalho (novo, aberto de arquivo ou recuperado). */
function abrirDocumento(d: Documento) {
  if (editor) sairEsboco();
  if (comando) fecharComando();
  fecharAvaliacao();
  fecharJanela();
  doc = d;
  planificado = false;
  aberto = true;
  definirSel(null);
  selPeca = [];
  historico.length = 0;
  refazer.length = 0;
  primeiraRegeneracao = true;
  nomeDoc.value = doc.nome;
  aplicarMaterial();
  atualizarAreaDeTrabalho();
  registrarPasso();
  salvarAutosave();
  renderizarTudo();
  regenerar();
}

function fecharDocumento() {
  if (!aberto) return;
  if (doc.features.length && !confirm("Fechar a peça? (o que não foi salvo em arquivo se perde)")) return;
  if (editor) sairEsboco();
  if (comando) fecharComando();
  fecharAvaliacao();
  fecharJanela();
  aberto = false;
  doc = documentoVazio();
  definirSel(null);
  selPeca = [];
  historico.length = 0;
  refazer.length = 0;
  atualizarAreaDeTrabalho();
  viewport.mostrarMalha(null);
  limparEsbocos();
  $("st-volume").textContent = "";
  $("st-tempo").textContent = "";
  atualizarStatus();
}

// ---------- dispositivo: celular, tablet ou computador ----------

const DISPOSITIVOS: { id: Dispositivo; rotulo: string; icone: NomeIcone; descricao: string }[] = [
  { id: "celular", rotulo: "Celular", icone: "celular", descricao: "Tela pequena e dedo: ícones sem texto, árvore e painéis em gaveta, o dedo desenha" },
  { id: "tablet", rotulo: "Tablet", icone: "tablet", descricao: "Caneta e dedo: a caneta desenha e o dedo navega, alvos grandes e lupa" },
  { id: "computador", rotulo: "Computador", icone: "computador", descricao: "Mouse e teclado: botões compactos, atalhos, botão do meio gira" },
];

/** Sugestão pelo aparelho (só para marcar o cartão; quem decide é o usuário). */
function dispositivoProvavel(): Dispositivo {
  const toque = matchMedia("(pointer: coarse)").matches;
  if (!toque) return "computador";
  return Math.min(screen.width, screen.height) < 600 ? "celular" : "tablet";
}

/** Caixa flutuante nos comandos: escolha do usuário ou, sem escolha, só em celular e tablet. */
const caixaFlutuanteLigada = () => prefs.caixaFlutuante ?? (prefs.dispositivo ?? "tablet") !== "computador";

function aplicarDispositivo() {
  const d = prefs.dispositivo ?? "tablet";
  viewport.tempoToqueLongo = prefs.toqueLongoMs ?? 600;
  for (const x of DISPOSITIVOS) document.body.classList.toggle(`disp-${x.id}`, x.id === d);
  if (d !== "celular") document.body.classList.remove("lateral-aberta");
  if (editor) {
    editor.opcaoDedo = d === "tablet";
    if (d !== "tablet") editor.dedoDesenha = true;
  }
}

/** Janela de escolha do dispositivo (obrigatória na primeira vez). */
function escolherDispositivo(obrigatorio: boolean) {
  fecharMenu();
  const fundo = document.createElement("div");
  fundo.className = "fundo-dialogo";
  const provavel = dispositivoProvavel();
  let escolhido = prefs.dispositivo ?? provavel;
  fundo.innerHTML = `
    <div class="dialogo" role="dialog" aria-modal="true">
      <header><strong>Onde você vai usar o WJProMaster?</strong></header>
      <div class="ambientes dispositivos"></div>
      <div class="opcoes-toque">
        <label class="campo"><span class="campo-rotulo">Segurar a caneta/dedo parado abre o menu</span>
          <select data-c="longo">${[[0, "Desligado"], [400, "0,4 s"], [600, "0,6 s (padrão)"], [1000, "1 s"], [1500, "1,5 s"], [3000, "3 s"], [5000, "5 s"]]
            .map(([v, r]) => `<option value="${v}"${v === (prefs.toqueLongoMs ?? 600) ? " selected" : ""}>${r}</option>`).join("")}</select></label>
        <label class="interruptor"><input type="checkbox" data-c="caixa"${caixaFlutuanteLigada() ? " checked" : ""}><span>Comandos com caixa flutuante perto da peça</span></label>
      </div>
      <p class="dialogo-nota">A interface se adapta só ao aparelho escolhido. Dá para trocar depois no menu (Ferramentas → Dispositivo).</p>
      <footer>${obrigatorio ? "" : `<button data-b="cancelar">Cancelar</button>`}<button data-b="ok" class="destaque">OK</button></footer>
    </div>`;
  const lista = fundo.querySelector(".dispositivos")!;
  for (const d of DISPOSITIVOS) {
    const b = document.createElement("button");
    b.className = "ambiente";
    b.setAttribute("aria-pressed", String(d.id === escolhido));
    b.innerHTML = `${ICONES[d.icone]}<strong>${d.rotulo}</strong><small>${d.descricao}</small>${d.id === provavel ? `<em class="sugerido">sugerido</em>` : ""}`;
    b.onclick = () => {
      escolhido = d.id;
      lista.querySelectorAll(".ambiente").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    };
    b.ondblclick = () => ok();
    lista.append(b);
  }
  const fechar = () => {
    fundo.remove();
    document.removeEventListener("keydown", teclas, true);
  };
  const caixa = fundo.querySelector<HTMLInputElement>('[data-c="caixa"]')!;
  const caixaAntes = caixa.checked;
  const ok = () => {
    prefs.dispositivo = escolhido;
    prefs.toqueLongoMs = Number(fundo.querySelector<HTMLSelectElement>('[data-c="longo"]')!.value);
    // só grava a caixa se o usuário mexeu: senão ela segue o aparelho escolhido
    if (caixa.checked !== caixaAntes) prefs.caixaFlutuante = caixa.checked;
    salvarPrefs();
    fechar();
    aplicarDispositivo();
    atualizarAreaDeTrabalho();
    renderizarAbas();
    if (editor) renderizarPainelEdicaoEsboco();
    if (comando) renderizarComando();
  };
  const teclas = (e: KeyboardEvent) => {
    if (e.key === "Enter") ok();
    else if (e.key === "Escape" && !obrigatorio) fechar();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  fundo.querySelector<HTMLButtonElement>('[data-b="ok"]')!.onclick = ok;
  const cancelar = fundo.querySelector<HTMLButtonElement>('[data-b="cancelar"]');
  if (cancelar) cancelar.onclick = fechar;
  document.addEventListener("keydown", teclas, true);
  document.body.append(fundo);
}

/** Celular: fecha a gaveta para o usuário tocar faces/arestas; ☰ ou ✓ continuam acessíveis. */
function recolherGavetaParaSelecionar() {
  if (prefs.dispositivo !== "celular" || !document.body.classList.contains("lateral-aberta")) return;
  abrirGaveta(false);
  avisar("Toque no modelo para selecionar. O painel volta no botão da árvore (canto superior esquerdo).");
}

/** Celular: árvore/painel em gaveta sobre o modelo. */
function abrirGaveta(aberta: boolean) {
  document.body.classList.toggle("lateral-aberta", aberta && prefs.dispositivo === "celular");
}

/** Liga/desliga a interface de edição conforme haja documento aberto. */
function atualizarAreaDeTrabalho() {
  document.body.classList.toggle("sem-documento", !aberto);
  $("tela-inicial").hidden = aberto;
  if (aberto) return;
  $("ti-novo").innerHTML = `${ICONES.nova}<span>Novo…</span>`;
  $("ti-abrir").innerHTML = `${ICONES.pasta}<span>Abrir do cofre…</span>`;
  $("ti-novo").onclick = abrirDialogoNovo;
  $("ti-abrir").onclick = ACOES.abrirCofre.fazer;
  const disp = DISPOSITIVOS.find((d) => d.id === prefs.dispositivo);
  $("ti-dispositivo").innerHTML = disp ? `${ICONES[disp.icone]}<span>Usando: ${disp.rotulo} · trocar</span>` : "";
  $("ti-dispositivo").onclick = () => escolherDispositivo(false);
  const recentes = $("ti-recentes");
  recentes.innerHTML = "";
  const ultimo = carregarAutosave();
  const itens: [string, string, () => void][] = [];
  if (ultimo && ultimo.features.length) itens.push([ultimo.nome, "último documento", () => abrirDocumento(ultimo)]);
  itens.push(["Peça exemplo", "exemplo", () => (desligar("cad"), abrirDocumento(documentoExemplo()))]);
  recentes.append(Object.assign(document.createElement("h3"), { textContent: "Recentes" }));
  for (const [nome, nota, fazer] of itens) {
    const b = document.createElement("button");
    b.innerHTML = `${ICONES.peca}<span></span><small>${nota}</small>`;
    b.querySelector("span")!.textContent = nome;
    b.onclick = fazer;
    recentes.append(b);
  }
}

$<HTMLInputElement>("arquivo").onchange = async (ev) => {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  if (!arq) return;
  desligar("cad"); // veio do aparelho: ao salvar entra no cofre como arquivo novo
  try {
    let dados: unknown;
    try {
      dados = JSON.parse(await arq.text());
    } catch {
      throw new Error("Arquivo não é uma peça WJCAD válida (.wjcad).");
    }
    const d = validarDocumento(dados);
    if (!aberto || !doc.features.length || confirm("Fechar a peça atual e abrir o arquivo?")) abrirDocumento(d);
  } catch (e) {
    alert((e as Error).message);
  }
  (ev.target as HTMLInputElement).value = "";
};

async function exportar(formato: "step" | "stl") {
  if (!aberto) return;
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

// ---------- teclado (tablet com teclado ou computador) ----------
let cursor = { x: 200, y: 200 };
document.addEventListener("pointermove", (e) => (cursor = { x: e.clientX, y: e.clientY }));

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, select, textarea")) return;
  if (!aberto) return; // sem documento não há o que editar
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && /^[1-8]$/.test(e.key)) {
    const i = Number(e.key) - 1;
    if (i === 7) normalA();
    else viewport.definirVista(VISTAS[i][0]);
  } else if (ctrl && k === "z" && !e.shiftKey) desfazer();
  else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) refazerPasso();
  else if (ctrl && k === "s") ACOES.salvar.fazer();
  else if (ctrl && (k === "b" || k === "q")) regenerar();
  else if (ctrl && k === "a" && editor) {
    e.preventDefault();
    editor.selecionarTudo();
  }
  else if (editor && editor.teclado(e)) {
    /* atalhos do esboço */
  } else if (e.key === " ") abrirSeletorVistas($("barra-vistas"));
  else if (k === "f" && !ctrl) viewport.enquadrar();
  else if (e.key === "F5") {
    // liga/desliga o filtro guardando a última escolha
    e.preventDefault();
    if (filtroLigado()) {
      prefs.filtroAnterior = prefs.filtroSelecao;
      alternarFiltro("limpar");
    } else if (prefs.filtroAnterior?.length) {
      prefs.filtroSelecao = [...prefs.filtroAnterior];
      salvarPrefs();
      renderizarBarraVistas();
      atualizarStatus();
      avisar("Filtro de seleção ligado de novo.");
    } else abrirFiltroSelecao($("barra-vistas"));
  } else if (!ctrl && (k === "x" || k === "e" || k === "v")) alternarFiltro(k === "x" ? "face" : k === "e" ? "aresta" : "vertice");
  else if (k === "s" && !ctrl) barraDeAtalhos();
  else if (e.key === "Enter" && comando) confirmarComando();
  else if (e.key === "Delete" && !comando) {
    const f = featureSelecionada();
    if (f) excluirFeature(f);
  } else if (e.key === "Escape") {
    fecharPopover();
    esconderBarraContexto();
    fecharCotasNoModelo();
    if (comando) cancelarComando();
    else if (avaliacao) fecharAvaliacao();
    else if (aguardando) {
      aguardando = null;
      atualizarStatus();
    } else {
      limparSelPeca();
      selecionar(null);
    }
  } else return;
  e.preventDefault();
});

/** Tecla S: comandos mais usados do contexto, no cursor. */
function barraDeAtalhos() {
  const itens: ItemPopover[] = editor
    ? (["linha", "retangulo", "circulo", "arco", "cota", "aparar", "offset"] as Ferramenta[]).map((f) => ({
      rotulo: f[0].toUpperCase() + f.slice(1), acao: () => editor?.definirFerramenta(f),
    }))
    : [
      { rotulo: "Esboço", icone: "esboco", acao: () => void iniciarEsboco() },
      { rotulo: "Extrusão", icone: "extrusao", acao: () => criarRecurso("extrusao") },
      { rotulo: "Corte extrudado", icone: "corte", acao: () => criarRecurso("corte") },
      { rotulo: "Furo assistido", icone: "furo", acao: () => criarRecurso("furo") },
      { rotulo: "Filete", icone: "filete", acao: () => criarRecurso("filete") },
      { rotulo: "Chanfro", icone: "chanfro", acao: () => criarRecurso("chanfro") },
      { rotulo: "Medir", icone: "medir", acao: () => comandoAvaliar("medir") },
    ];
  abrirPopover({ x: cursor.x, y: cursor.y }, itens);
}

// ---------- persistência local ----------
function salvarAutosave() {
  if (!aberto) return;
  capturarAtiva(doc);
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

// ---------- testes automatizados (só em desenvolvimento) ----------
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__cad = { viewport, doc: () => doc, abrirExemplo: () => abrirDocumento(documentoExemplo()), abrir: (d: Documento) => abrirDocumento(validarDocumento(d)) };
}

// ---------- início ----------
$("btn-lateral").innerHTML = ICONES.arvore;
$("btn-lateral").onclick = () => abrirGaveta(!document.body.classList.contains("lateral-aberta"));
aplicarDispositivo();
atualizarAreaDeTrabalho();
if (!prefs.dispositivo) escolherDispositivo(true);
// vindo do WJPDM ("Abrir no app"): abre direto o documento que o cofre deixou no salvamento automático
if (location.hash === "#abrir-autosave") {
  history.replaceState(null, "", location.pathname + location.search);
  const doCofre = carregarAutosave();
  if (doCofre) abrirDocumento(doCofre);
} else if (location.hash === "#novo") {
  // Novo → Peça nas páginas de montagem/desenho
  history.replaceState(null, "", location.pathname + location.search);
  const d = documentoVazio();
  desligar("cad");
  d.nome = `Peça${++contadorPecas}`;
  abrirDocumento(d);
}
// peça aberta a partir de uma montagem ou de um desenho: botão para voltar (o mais recente primeiro)
if (sessionStorage.getItem("wjcad:voltarMontagem")) {
  const b = document.createElement("button");
  b.className = "btn-ic btn-voltar";
  b.title = "Voltar à montagem (salve a peça antes: a montagem se atualiza do cofre)";
  b.innerHTML = `${ICONES.montagem}<span>Montagem</span>`;
  b.onclick = () => {
    sessionStorage.removeItem("wjcad:voltarMontagem");
    location.href = new URL(`${import.meta.env.BASE_URL}cad/montagem/#abrir-autosave`, location.href).href;
  };
  document.querySelector(".rapidas")?.prepend(b);
} else if (sessionStorage.getItem("wjcad:voltarDesenho")) {
  const b = document.createElement("button");
  b.className = "btn-ic btn-voltar";
  b.title = "Voltar ao desenho (salve a peça antes: as vistas se atualizam do cofre)";
  b.innerHTML = `${ICONES.desenho}<span>Desenho</span>`;
  b.onclick = () => (location.href = new URL(`${import.meta.env.BASE_URL}cad/desenho/#abrir-autosave`, location.href).href);
  document.querySelector(".rapidas")?.prepend(b);
}
mostrarPainel("arvore");
renderizarAbas();
renderizarTudo();
// painel do cofre na lateral direita: GO-OUT / GO-IN e arquivos em GO-OUT
instalarPainelCofre("cad", salvarPeca);
// sincronia global do cofre a cada abertura, depois que o kernel carregou (não disputa a rede)
void sincronizarAoAbrir(kernel.pronto)?.catch(() => {});

// diagnóstico do aparelho (só onde o Johann ligou o modo: ?diag=1)
{
  const b = botaoDiagnostico("btn-ic");
  if (b) {
    document.querySelector(".barra-topo")!.append(b);
    registrarMetrica("Última reconstrução", () => (ultimaReconstrucao === null ? null : `${ultimaReconstrucao.toFixed(0)} ms (${doc.features.length} recursos)`));
  }
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  // service worker guardou o kernel pela primeira vez: avisa que já funciona sem internet
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.tipo === "offline-pronto") avisar("WJCAD pronto para usar sem internet neste aparelho.");
  });
  // kernel carregado: pede ao service worker para guardá-lo (vem do cache HTTP, sem baixar de novo)
  void kernel.pronto.then(async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ tipo: "guardar" });
  }).catch(() => {});
}
