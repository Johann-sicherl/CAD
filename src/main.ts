import "./style.css";
import { ABAS, type Comando, type IdAba } from "./comandos";
import { ICONES, type NomeIcone } from "./icones";
import { ClienteKernel } from "./kernel/cliente";
import type { InfoReferencia, ResultadoRegeneracao } from "./kernel/regenerar";
import type { PropriedadesMassa } from "./kernel/avaliar";
import {
  documentoExemplo,
  documentoVazio,
  MATERIAIS,
  NOME_PLANO,
  novaFeature,
  novoEsboco,
  ROTULO_TIPO,
  validarDocumento,
  type Documento,
  type Feature,
  type FeatureEsboco,
  type FeatureFuro,
  type Plano,
  type Referencia,
  type SuporteEsboco,
  type Vec3,
} from "./model";
import { Viewport, type Entidade, type EstiloExibicao, type IdReferencia, type TipoEntidade, type Vista } from "./viewport";
import { EditorEsboco, type Ferramenta, type Hospedeiro } from "./esboco/editor";
import { renderizarPainelEsboco } from "./esboco/painel";
import { eixoXParaNormal, escalar, planosResolvidos, referencial } from "./esboco/referencial";
import { SolverEsboco } from "./esboco/solver";
import { construirCamada, descartarCamada } from "./esboco/visual";
import { aninhamento, encontrarLacos } from "./esboco/geometria";
import * as op from "./esboco/operacoes";
import wasmPlaneGcs from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { esquemaDe, type DadosEsquema } from "./ui/esquemas";
import { ler, renderizarFormulario, type Esquema, type TipoSel } from "./ui/formulario";
import { aplicarEquacoes, avaliarExpressao, resolverVariaveis } from "./equacoes";
import type { Analise } from "./analises";

const CHAVE_AUTOSAVE = "cad-tablet:documento";
const CHAVE_PREFS = "cad-tablet:interface";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- preferências de interface (só deste aparelho) ----------
interface Prefs {
  aba: IdAba;
  estilo: EstiloExibicao;
  refsVisiveis: Record<IdReferencia, boolean>;
  refsOcultas: string[]; // planos/eixos de referência criados pelo usuário e ocultos
}
const prefs: Prefs = {
  aba: "features",
  estilo: "sombreado-arestas",
  refsVisiveis: { XZ: true, XY: true, YZ: true, origem: true },
  refsOcultas: [],
  ...lerJSON<Partial<Prefs>>(CHAVE_PREFS),
};
const salvarPrefs = () => gravarJSON(CHAVE_PREFS, prefs);

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
}

type FerramentaAvaliar =
  | { tipo: "medir"; refs: Referencia[] }
  | { tipo: "secao"; plano: Plano; desloc: number; inverter: boolean }
  | { tipo: "analise"; analise: Analise; plano: Plano };

let doc: Documento = carregarAutosave() ?? documentoExemplo();
let selecao: Selecao = null;
/** Faces/arestas/vértices selecionados no modelo (pré-seleção para comandos). */
let selPeca: Referencia[] = [];
/** Ponto tocado na última face selecionada (posição inicial de furo). */
let pontoTocado: Vec3 | null = null;
let errosPorFeature = new Map<string, string>();
let tempos: { id: string; ms: number }[] = [];
let referenciasKernel: InfoReferencia[] = [];
const historico: string[] = [];
const refazer: string[] = [];
let primeiraRegeneracao = true;
let estadoKernel: "iniciando" | "pronto" | "regenerando" | "erro" = "iniciando";
let editor: EditorEsboco | null = null;
/** Ao entrar no esboço guarda o documento para "descartar alterações". */
let snapshotEsboco: string | null = null;
/** Esboço aberto a partir das posições do furo: ao sair, volta ao painel do furo. */
let voltarParaFuro: string | null = null;
let comando: ComandoAtivo | null = null;
let avaliacao: FerramentaAvaliar | null = null;
/** Esperando o usuário tocar um plano/face para começar um esboço ou furo. */
let aguardando: { para: "esboco" | "furo"; ferramenta?: Ferramenta } | null = null;

const viewport = new Viewport($("viewport"));
const kernel = new ClienteKernel(aoRegenerar);

viewport.definirEstilo(prefs.estilo);
for (const [id, vis] of Object.entries(prefs.refsVisiveis)) viewport.definirVisibilidadeReferencia(id as IdReferencia, vis);
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
    kernel.regenerar(ativas());
  }, atraso);
}

function aoRegenerar(r: ResultadoRegeneracao, ms: number) {
  estadoKernel = "pronto";
  viewport.mostrarMalha(r.malha, r.topologia);
  if (primeiraRegeneracao && r.malha) {
    viewport.enquadrar(false);
    primeiraRegeneracao = false;
  }
  errosPorFeature = new Map(r.erros.map((e) => [e.id, e.mensagem]));
  tempos = r.tempos;
  referenciasKernel = r.referencias;
  planosResolvidos.clear();
  for (const ri of r.referencias) if (ri.tipo === "plano") planosResolvidos.set(ri.id, ri.ref);
  $("st-volume").textContent =
    r.volume !== null ? `Volume: ${(r.volume / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm³` : "";
  $("st-tempo").textContent = `Reconstrução: ${ms.toFixed(0)} ms`;
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
}

function atualizarStatus() {
  const k = $("st-kernel");
  k.textContent = {
    iniciando: "Kernel: iniciando…",
    pronto: "Kernel: pronto",
    regenerando: "Reconstruindo…",
    erro: "Kernel: erro",
  }[estadoKernel];
  k.dataset.estado = estadoKernel;

  const nErros = errosPorFeature.size;
  let estado = "Editando peça";
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
  $("st-material").textContent = mat ? `${mat.nome} (${mat.densidade.toLocaleString("pt-BR")} g/cm³)` : "Material não especificado";
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
    if (aba.id === "avaliar" && avaliacao) {
      const ativo = (c.id === "medir" && avaliacao.tipo === "medir") || (c.id === "vista-secao" && avaliacao.tipo === "secao") ||
        (avaliacao.tipo === "analise" && c.id === mapaAnalise[avaliacao.analise.tipo]);
      b.setAttribute("aria-pressed", String(ativo));
    }
    if (sairDoEsboco) b.classList.add("cmd-sair");
    b.onclick = () => executarComando(c, aba.id, b);
    faixa.appendChild(b);
  }
}

function executarComando(c: Comando, aba: IdAba, botao: HTMLElement) {
  if (c.fase) {
    avisar(`${c.rotulo}: previsto para a Fase ${c.fase} do roteiro.`);
    return;
  }
  esconderBarraContexto();
  if (aba === "sketch") return void comandoEsboco(c, botao);
  if (aba === "avaliar") return comandoAvaliar(c.id);
  if (editor) sairEsboco();
  if (comando) confirmarComando();
  criarRecurso(c.id);
}

// ---------- criação de recursos ----------

const TIPO_POR_COMANDO: Record<string, Exclude<Feature["tipo"], "esboco">> = {
  extrusao: "extrusao", corte: "extrusao", revolucao: "revolucao", "corte-revolucao": "revolucao",
  filete: "filete", chanfro: "chanfro", casca: "casca", nervura: "nervura", inclinacao: "inclinacao",
  furo: "furo", "padrao-linear": "padraoLinear", "padrao-circular": "padraoCircular", espelhar: "espelhar",
  plano: "planoRef", eixo: "eixoRef",
};

function ultimoEsbocoLivre(): FeatureEsboco | null {
  const usados = new Set(doc.features.flatMap((f) => ("esboco" in f && f.esboco ? [f.esboco] : [])));
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
  const tipo = TIPO_POR_COMANDO[id];
  if (!tipo) return;
  if (tipo === "furo") return iniciarFuro();
  const f = novaFeature(tipo, nomeNovo(tipo));
  const sel = featureSelecionada();
  const faces = selPeca.filter((r) => r.tipo === "face");
  const itens = selPeca.filter((r) => r.tipo === "face" || r.tipo === "aresta");
  const planoSel: Referencia | undefined = faces[0] ?? (selecao?.tipo === "ref" && selecao.id !== "origem" ? { tipo: "plano", id: selecao.id } : sel?.tipo === "planoRef" ? { tipo: "plano", id: sel.id } : undefined);
  switch (f.tipo) {
    case "extrusao":
    case "revolucao": {
      const perfil = (sel?.tipo === "esboco" ? sel : null) ?? ultimoEsbocoLivre();
      if (perfil) f.esboco = perfil.id;
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
    case "filete":
    case "chanfro":
      f.itens = itens;
      break;
    case "casca":
      f.faces = faces;
      break;
    case "inclinacao":
      f.faces = faces;
      f.planoNeutro = { tipo: "plano", id: "XY" };
      break;
    case "nervura": {
      const perfil = (sel?.tipo === "esboco" ? sel : null) ?? ultimoEsbocoLivre();
      if (perfil) f.esboco = perfil.id;
      break;
    }
    case "padraoLinear":
    case "padraoCircular":
    case "espelhar":
      if (sel && sel.tipo !== "esboco") f.recursos = [sel.id];
      if (f.tipo === "padraoLinear") {
        const ar = selPeca.find((r) => r.tipo === "aresta");
        if (ar) f.dir1.ref = ar;
      }
      if (f.tipo === "padraoCircular") {
        const ax = selPeca.find((r) => r.tipo === "aresta" || r.tipo === "face");
        if (ax) f.eixo = ax;
      }
      if (f.tipo === "espelhar") f.plano = planoSel ?? { tipo: "plano", id: "YZ" };
      break;
    case "planoRef":
      f.ref1 = planoSel ?? { tipo: "plano", id: "XY" };
      break;
    case "eixoRef": {
      const r = selPeca[0];
      if (r) {
        f.ref1 = r;
        if (r.tipo === "face") f.modo = r.ass.geom === "cilindro" ? "cilindro" : "aresta";
      }
      break;
    }
  }
  limparSelPeca();
  inserirFeature(f);
  abrirComando(f, true);
}

// ---------- painel de comando ----------

function dadosEsquema(f: Feature): DadosEsquema {
  const idx = doc.features.indexOf(f);
  const antes = doc.features.slice(0, idx < 0 ? undefined : idx);
  return {
    esbocosAntes: antes.filter((x) => x.tipo === "esboco").map((x) => [x.id, x.nome]),
    recursosAntes: antes.filter((x) => ["extrusao", "revolucao", "furo", "nervura", "padraoLinear", "padraoCircular", "espelhar"].includes(x.tipo)).map((x) => [x.id, x.nome]),
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

function abrirComando(f: Feature, novo: boolean) {
  if (editor) sairEsboco();
  fecharAvaliacao();
  comando = {
    f, novo, snapshot: JSON.stringify(doc), campo: null, recolhidas: new Set(),
    aba: f.tipo === "furo" ? "Tipo" : undefined,
  };
  // campo de seleção ativo: o primeiro vazio
  const esq = esquemaDe(f, dadosEsquema(f));
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
  selecao = { tipo: "feature", id: f.id };
  mostrarPainel("comando");
  renderizarComando();
  regenerar();
  atualizarStatus();
  renderizarArvore();
}

function renderizarComando() {
  if (!comando) return;
  const c = comando;
  const esq = esquemaDe(c.f, dadosEsquema(c.f)) as Esquema<Feature>;
  renderizarFormulario($("painel-comando"), c.f, esq, {
    erro: errosPorFeature.get(c.f.id),
    aoMudar: (final) => {
      salvarAutosave();
      regenerar(final ? 80 : 300);
      if (final) renderizarComando();
      renderizarArvore();
    },
    ok: confirmarComando,
    cancelar: cancelarComando,
    campoAtivo: c.campo?.cam ?? null,
    ativarCampo: (cam, aceita, multiplo) => {
      c.campo = cam ? { cam, aceita, multiplo } : null;
      renderizarComando();
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
  });
  atualizarDestaques();
}

function confirmarComando() {
  if (!comando) return;
  const f = comando.f;
  fecharComando();
  registrarPasso();
  salvarAutosave();
  selecao = { tipo: "feature", id: f.id };
  renderizarTudo();
  regenerar();
}

function cancelarComando() {
  if (!comando) return;
  doc = JSON.parse(comando.snapshot);
  const novo = comando.novo;
  fecharComando();
  if (novo) selecao = null;
  salvarAutosave();
  renderizarTudo();
  regenerar();
}

function fecharComando() {
  comando = null;
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
}

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
  const esq = esquemaDe(comando.f, dadosEsquema(comando.f));
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
  viewport.destacarEntidades(ents, realce ? entidadeDeRef(realce) : null);
  // planos de referência usados pelo comando aparecem destacados
  const planoUsado = refs.find((r): r is Extract<Referencia, { tipo: "plano" }> => r.tipo === "plano");
  const principal = planoUsado && ["XY", "XZ", "YZ"].includes(planoUsado.id) ? (planoUsado.id as Plano) : null;
  viewport.destacarReferencia(principal ?? (selecao?.tipo === "ref" ? selecao.id : null));
  mostrarReferenciasExtras(planoUsado && !principal ? planoUsado.id : undefined);
}

function mostrarReferenciasExtras(destaque?: string) {
  const sel = destaque ?? idSelecionado();
  viewport.mostrarReferenciasExtras(referenciasKernel, (id) => !prefs.refsOcultas.includes(id), sel ?? null);
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

function instalarToqueCurto() {
  viewport.aoToqueCurto = (e) => {
    const tol = e.pointerType === "touch" ? 22 : 9;
    esconderBarraContexto();
    if (aguardando) {
      const face = viewport.picarFace(e.clientX, e.clientY);
      if (!face) return avisar("Isso não é uma face plana. Toque uma face plana (ou um plano na árvore).");
      return void suporteEscolhido(faceComoSuporte(face.origem, face.normal), face.origem);
    }
    if (comando) {
      const c = comando.campo;
      if (!c) return avisar("Toque um campo de seleção (rosa) no painel para escolher geometria.");
      const ent = viewport.picarEntidade(e.clientX, e.clientY, filtroEntidades(c.aceita), tol);
      if (!ent) return;
      const r = refDeEntidade(ent)!;
      if (c.aceita.includes("plano") && !c.aceita.includes("face") && (r.tipo !== "face" || r.ass.geom !== "plano")) return avisar("Escolha uma face plana.");
      adicionarAoCampo(r);
      return;
    }
    if (avaliacao?.tipo === "medir") {
      const ent = viewport.picarEntidade(e.clientX, e.clientY, TODAS, tol);
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
    const ent = viewport.picarEntidade(e.clientX, e.clientY, TODAS, tol);
    if (!ent) {
      limparSelPeca();
      selecao = null;
      renderizarTudo();
      return;
    }
    const r = refDeEntidade(ent)!;
    pontoTocado = ent.tipo === "face" ? viewport.picarFace(e.clientX, e.clientY)?.origem ?? null : null;
    const soma = e.ctrlKey || e.shiftKey || e.metaKey;
    const i = selPeca.findIndex((x) => mesmaRef(x, r));
    if (i >= 0) selPeca.splice(i, 1);
    else selPeca = soma ? [...selPeca, r] : [r];
    selecao = null;
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
  regenerar(80);
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
    const filtro = comando?.campo ? filtroEntidades(comando.campo.aceita) : comando ? new Set<TipoEntidade>() : TODAS;
    const ent = viewport.picarEntidade(e.clientX, e.clientY, filtro, 9);
    viewport.destacarEntidades(refsDestacadas().map(entidadeDeRef).filter((x): x is Entidade => !!x), ent);
    viewport.canvas().style.cursor = ent ? "pointer" : "";
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
  if ("esboco" in f && f.esboco) {
    const e = doc.features.find((x): x is FeatureEsboco => x.id === f.esboco && x.tipo === "esboco");
    if (e) out.push({ rotulo: "Editar esboço", icone: "esboco", acao: () => void editarEsboco(e) });
  }
  if (f.tipo === "planoRef") out.push({ rotulo: "Esboço", icone: "esboco", acao: () => void suporteEscolhido({ tipo: "planoRef", id: f.id }, null) });
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
  if (editor || comando) return;
  const ent = viewport.picarEntidade(e.clientX, e.clientY, TODAS, 9);
  if (ent) {
    const r = refDeEntidade(ent)!;
    if (!selPeca.some((x) => mesmaRef(x, r))) selPeca = [r];
    atualizarDestaques();
  }
  mostrarBarra([
    ...(selPeca.length ? acoesDoModelo() : []),
    { rotulo: "Enquadrar", icone: "enquadrar", acao: () => viewport.enquadrar() },
    { rotulo: "Orientação…", icone: "vistas", acao: () => abrirSeletorVistas($("barra-vistas")) },
  ], e.clientX, e.clientY);
};

// ---------- árvore do modelo ----------
const REFERENCIAS: IdReferencia[] = ["XZ", "XY", "YZ", "origem"];

const ICONE_FEATURE: Record<Feature["tipo"], NomeIcone> = {
  esboco: "esboco", extrusao: "extrusao", revolucao: "revolucao", filete: "filete", chanfro: "chanfro",
  casca: "casca", inclinacao: "inclinacaoRecurso", nervura: "nervura", furo: "furo", padraoLinear: "padraoLinear",
  padraoCircular: "padraoCircular", espelhar: "espelhar", planoRef: "plano", eixoRef: "eixoRef",
};

function iconeFeature(f: Feature): NomeIcone {
  if (f.tipo === "extrusao" && f.operacao === "cortar") return "corte";
  if (f.tipo === "revolucao" && f.operacao === "cortar") return "corteRevolucao";
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
  }

  for (const id of REFERENCIAS) {
    const li = document.createElement("li");
    li.className = "item ref";
    li.classList.toggle("ativo", selecao?.tipo === "ref" && selecao.id === id);
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
  for (const f of doc.features) if ("esboco" in f && f.esboco) filhos.add(f.esboco);
  const limite = doc.retrocesso ?? doc.features.length;

  const itemFeature = (f: Feature, i: number, filho: boolean) => {
    const li = document.createElement("li");
    li.className = "item";
    li.classList.toggle("filho", filho);
    li.classList.toggle("ativo", f.id === idSelecionado() || f.id === comando?.f.id);
    li.classList.toggle("suprimida", f.suprimida);
    li.classList.toggle("retrocedida", i >= limite);
    li.classList.toggle("com-erro", errosPorFeature.has(f.id));
    li.classList.toggle("editando", f.id === editor?.esb.id);
    li.innerHTML = `
      <span class="item-ic">${ICONES[iconeFeature(f)]}</span>
      <span class="item-texto"><strong></strong><small></small></span>
      ${mini || filho ? "" : `<span class="item-mover"><button data-mover="-1" aria-label="Subir">▲</button><button data-mover="1" aria-label="Descer">▼</button></span>`}`;
    li.querySelector("strong")!.textContent = f.nome;
    const opr = "operacao" in f && f.operacao === "cortar" ? " · corte" : "";
    const ms = tempos.find((t) => t.id === f.id)?.ms;
    li.querySelector("small")!.textContent = `${ROTULO_TIPO[f.tipo]}${opr}${f.id === editor?.esb.id ? " · editando" : ""}${ms && ms > 300 ? ` · ${(ms / 1000).toFixed(1)} s` : ""}`;
    li.title = errosPorFeature.get(f.id) ?? "";
    li.onclick = (ev) => {
      const mover = (ev.target as HTMLElement).closest<HTMLElement>("[data-mover]");
      if (mover) return moverFeature(i, Number(mover.dataset.mover));
      if (comando?.campo && comando.campo.aceita.includes("plano") && f.tipo === "planoRef") return adicionarAoCampo({ tipo: "plano", id: f.id });
      if (comando?.campo && comando.campo.aceita.includes("eixo") && f.tipo === "eixoRef") return adicionarAoCampo({ tipo: "eixo", id: f.id });
      if (aguardando && f.tipo === "planoRef") return void suporteEscolhido({ tipo: "planoRef", id: f.id }, null);
      if (editor || comando) return avisar("Conclua o comando atual (✓) antes de selecionar outro recurso.");
      limparSelPeca();
      selecionar(f.id === idSelecionado() ? null : { tipo: "feature", id: f.id });
      if (selecao) mostrarBarraNoItem(li, acoesDaFeature(f));
    };
    li.ondblclick = () => {
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

  doc.features.forEach((f, i) => {
    if (i === limite) lista.appendChild(barraRetrocesso());
    if (f.tipo === "esboco" && filhos.has(f.id)) return; // aparece dentro do recurso
    lista.appendChild(itemFeature(f, i, false));
    if ("esboco" in f && f.esboco) {
      const e = doc.features.find((x) => x.id === f.esboco);
      if (e) lista.appendChild(itemFeature(e, doc.features.indexOf(e), true));
    }
  });
  if (limite >= doc.features.length && doc.features.length) lista.appendChild(barraRetrocesso());

  if (!doc.features.length) {
    lista.insertAdjacentHTML("beforeend", `<li class="dica">Nenhum recurso ainda. Selecione um plano e toque Esboço (aba Sketch).</li>`);
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

function excluirFeature(f: Feature) {
  const dependentes = doc.features.filter((x) => ("esboco" in x && x.esboco === f.id && x.id !== f.id) || ("recursos" in x && x.recursos.includes(f.id)));
  if (dependentes.length && !confirm(`${f.nome} é usado por ${dependentes.map((x) => x.nome).join(", ")}. Excluir mesmo assim?`)) return;
  doc.features = doc.features.filter((x) => x.id !== f.id);
  if (doc.retrocesso !== undefined && doc.retrocesso >= doc.features.length) delete doc.retrocesso;
  selecao = null;
  alterou(true);
  renderizarTudo();
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
        renderizarPainelEdicaoEsboco();
      }
      return;
    default:
      if (!editor && !(await iniciarEsboco(c.id as Ferramenta))) return;
      editor!.definirFerramenta(c.id as Ferramenta);
  }
}

/** Esboço selecionado (edita), ou novo no plano/face selecionado; senão pede plano/face. */
async function iniciarEsboco(ferramenta?: Ferramenta): Promise<boolean> {
  const f = featureSelecionada();
  if (f?.tipo === "esboco") {
    await editarEsboco(f, ferramenta);
    return true;
  }
  if (f && "esboco" in f && f.esboco) {
    const e = doc.features.find((x): x is FeatureEsboco => x.id === f.esboco && x.tipo === "esboco");
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
  selecao = { tipo: "feature", id: esb.id };
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
  esconderBarraContexto();
  limparSelPeca();
  selecao = { tipo: "feature", id: esb.id };
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
    (ancora) => abrirPopover(ancora, ed.relacoesPossiveis().map((r) => ({ rotulo: r.rotulo, acao: r.aplicar }))),
  );
}

function sairEsboco() {
  if (!editor) return;
  const id = editor.esb.id;
  editor.fechar();
  editor = null;
  snapshotEsboco = null;
  instalarToqueCurto();
  selecao = { tipo: "feature", id };
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
  const usados = new Set(doc.features.flatMap((f) => ("esboco" in f && f.esboco ? [f.esboco] : [])));
  const { w, h } = viewport.tamanho();
  for (const f of ativas()) {
    if (f.tipo !== "esboco" || f.suprimida) continue;
    if (usados.has(f.id) && f.id !== idSelecionado()) continue;
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
      fecharAvaliacao();
      avaliacao = { tipo: "medir", refs: [] };
      abrirJanela("Medir", "<p class='dica'>Toque faces, arestas ou vértices (até dois). Toque no vazio para limpar.</p>");
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
      avaliacao = { tipo: "secao", plano: "XZ", desloc: 0, inverter: false };
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
      const analise: Analise = tipo === "inclinacao" ? { tipo, direcao: [0, 0, 1], angulo: 1 }
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

const NORMAL_PLANO: Record<Plano, Vec3> = { XY: [0, 0, 1], XZ: [0, -1, 0], YZ: [1, 0, 0] };

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
  const planos: [string, string][] = [["XZ", "Plano Frontal"], ["XY", "Plano Superior"], ["YZ", "Plano Lateral"]];
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
  $("janela-titulo").textContent = titulo;
  $("janela-corpo").innerHTML = html;
  $("janela").hidden = false;
}
function fecharJanela() {
  $("janela").hidden = true;
}
$("janela-fechar").onclick = () => {
  fecharJanela();
  if (avaliacao?.tipo === "medir") fecharAvaliacao();
};

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
  if (f && "esboco" in f && f.esboco) {
    const e = doc.features.find((x) => x.id === f.esboco);
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

function renderizarBarraVistas() {
  const barra = $("barra-vistas");
  barra.innerHTML = "";
  const botao = (icone: NomeIcone, titulo: string, acao: (b: HTMLButtonElement) => void, pressionado = false) => {
    const b = document.createElement("button");
    b.className = "btn-ic";
    b.title = titulo;
    b.setAttribute("aria-label", titulo);
    b.setAttribute("aria-pressed", String(pressionado));
    b.innerHTML = ICONES[icone];
    b.onclick = () => acao(b);
    barra.appendChild(b);
    return b;
  };
  const sep = () => barra.appendChild(Object.assign(document.createElement("span"), { className: "sep" }));

  botao("enquadrar", "Ampliar para caber (F)", () => viewport.enquadrar());
  botao("vistaSecao", "Vista de seção", () => comandoAvaliar("vista-secao"), avaliacao?.tipo === "secao");
  sep();
  botao("vistas", "Orientação da vista (Espaço)", (b) => abrirSeletorVistas(b));
  botao("normalA", "Normal a (Ctrl+8)", normalA);
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
  equacoes: { rotulo: "Equações…", icone: "equacoes", fazer: abrirEquacoes },
  material: { rotulo: "Material…", icone: "materialPeca", fazer: () => escolherMaterial($("btn-menu")) },
  reconstruir: { rotulo: "Reconstruir (Ctrl+B)", icone: "desempenho", fazer: () => regenerar() },
  atalhos: { rotulo: "Atalhos de teclado e mouse", icone: "menu", fazer: mostrarAtalhos },
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
    ["Ctrl+B", "Reconstruir"],
    ["Enter / Esc", "OK / Cancelar no comando"],
    ["Ctrl+Z / Ctrl+Y / Ctrl+S", "Desfazer / Refazer / Salvar"],
    ["Esboço: L R C A S P T D O M V", "Linha, Retângulo, Círculo, Arco, Spline, Polígono, Aparar, Cota, Offset, Espelhar, Selecionar"],
  ]));
}

function novaPeca() {
  if (doc.features.length && !confirm("Descartar a peça atual e começar uma nova?")) return;
  if (editor) sairEsboco();
  if (comando) fecharComando();
  fecharAvaliacao();
  doc = documentoVazio();
  selecao = null;
  selPeca = [];
  nomeDoc.value = doc.nome;
  aplicarMaterial();
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
    aplicarMaterial();
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

// ---------- teclado (tablet com teclado ou computador) ----------
let cursor = { x: 200, y: 200 };
document.addEventListener("pointermove", (e) => (cursor = { x: e.clientX, y: e.clientY }));

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, select, textarea")) return;
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
  else if (editor && editor.teclado(e)) {
    /* atalhos do esboço */
  } else if (e.key === " ") abrirSeletorVistas($("barra-vistas"));
  else if (k === "f" && !ctrl) viewport.enquadrar();
  else if (k === "s" && !ctrl) barraDeAtalhos();
  else if (e.key === "Enter" && comando) confirmarComando();
  else if (e.key === "Delete" && !comando) {
    const f = featureSelecionada();
    if (f) excluirFeature(f);
  } else if (e.key === "Escape") {
    fecharPopover();
    esconderBarraContexto();
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
  (window as unknown as Record<string, unknown>).__cad = { viewport, doc: () => doc };
}

// ---------- início ----------
registrarPasso();
mostrarPainel("arvore");
renderizarAbas();
renderizarTudo();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
