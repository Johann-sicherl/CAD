// WJCAD — ambiente de Montagem (cad/montagem/). Componentes (peças do cofre embutidas), posição e
// rotação, posicionamentos (mates) com solver, árvore, painéis de comando como na peça.
// Especificação: docs/funcional/montagem.md. Modelo puro em ./modelo.ts, cena em ./cena.ts,
// solver em ./solver.ts (testados em scripts/teste-montagem.ts).

import "../style.css";
import { ICONES, type NomeIcone } from "../icones";
import { ClienteKernel, type ResultadoComponente } from "../kernel/cliente";
import { Viewport, type Entidade, type TipoEntidade, type Vista } from "../viewport";
import { MATERIAIS, validarDocumento, type Documento, type Referencia, type Vec3 } from "../model";
import {
  aplicarPadroes, embutirPeca, excluirComponentes, excluirPadrao, explosaoAutomatica, girarEmTorno, massaDaMontagem, posesExplodidas, IDENTIDADE, inserirComponente, marcaDe, montagemVazia, novoIdM, quantidades, quatDeEuler,
  quatEixoAngulo, rotuloComponente, validarMontagem, type ComponenteMontagem, type DocumentoMontagem, type PecaEmbutida, type Posicionamento,
  type PadraoComponentes, type RefMontagem, type TipoPosicionamento, type Transformacao,
} from "./modelo";
import { centroDoComponente, facesDoComponente, globalDaEntidade, indiceLocal, juntar, localDaEntidade, type Cena } from "./cena";
import { compRel, NOME_TIPO, primitivaLocal, resolverMontagem, tiposPossiveis, transformar, type ResultadoSolver } from "./solver";
import {
  abrirArquivoNoApp, abrirCopias, abrirDoCofre, desligar, documentosDoCofre, instalarPainelCofre, lerDoCofre, salvarNoCofre,
  sincronizarAoAbrir, vinculo,
} from "../comum/cofre";
import { renderizarFormulario, type ContextoFormulario, type Esquema } from "../ui/formulario";
import {
  $, abrirGaveta, abrirJanela, abrirPopover, aplicarDispositivo, avisar, baixar, escapar, esconderBarra, fecharJanela,
  instalarFecharAoTocarFora, lerPrefsCad, mostrarBarra, type AcaoContexto,
} from "../ui/basico";

const CHAVE = "wjcad:montagem"; // salvamento automático (o WJPDM também grava aqui para abrir)
const RAIZ = import.meta.env.BASE_URL;

// ---------- estado ----------
let doc: DocumentoMontagem | null = null;
const historico: string[] = [];
const refazer: string[] = [];
let cena: Cena | null = null;
/** Componentes selecionados (árvore ou modelo). */
let selComps: string[] = [];
let selMate: string | null = null;
/** Só estes aparecem (Isolar); null = todos. */
let isolados: Set<string> | null = null;
let solucao: ResultadoSolver | null = null;
/** Mostra os passos da vista explodida (só exibição). */
let mostrarExplodida = false;
let estadoKernel: "iniciando" | "pronto" | "erro" = "iniciando";
const malhas = new Map<string, ResultadoComponente>();
const pedidos = new Map<string, Promise<ResultadoComponente>>();
const errosPeca = new Map<string, string>();

type Comando =
  | { tipo: "inserir"; manter: boolean }
  | { tipo: "mover"; girar: boolean; snapshot: string; f: DadosMover }
  | { tipo: "posicionar"; snapshot: string; sel: RefMontagem[]; m: Posicionamento; editando: boolean }
  /** padrão linear/circular ou espelhar: campo ativo = sementes (tocar componentes) ou referência */
  | { tipo: "padrao"; snapshot: string; p: PadraoComponentes; editando: boolean; campo: "sementes" | "ref"; refNome: string }
  | { tipo: "explodir"; snapshot: string; comps: string[]; dir: Vec3; dist: number; fator: number }
  | { tipo: "medir"; sel: { ref: Referencia; nome: string; ent: Entidade }[]; linhas: { rotulo: string; valor: string }[] };
interface DadosMover {
  modo: "livre" | "delta" | "posicao";
  dx: number; dy: number; dz: number;
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
}
let comando: Comando | null = null;

aplicarDispositivo();
const viewport = new Viewport($("viewport"));
const kernel = new ClienteKernel();
const prefsCad = lerPrefsCad();
viewport.tempoToqueLongo = prefsCad.toqueLongoMs ?? 600;
if (prefsCad.estilo) viewport.definirEstilo(prefsCad.estilo as never);

kernel.pronto.then(() => {
  $("carregando").remove();
  estadoKernel = "pronto";
  atualizarStatus();
  void atualizarCena();
}).catch((e) => {
  $("carregando").textContent = "Falha ao carregar o kernel: " + (e as Error).message;
  estadoKernel = "erro";
  atualizarStatus();
});

const pecaDe = (c: ComponenteMontagem) => doc!.pecas.find((p) => p.id === c.peca)!;
const compDe = (id: string | null) => (id ? doc?.componentes.find((c) => c.id === id) : undefined);
const nomeComp = (id: string | null) => (id ? (compDe(id) ? rotuloComponente(doc!, compDe(id)!) : "?") : "Montagem");
const visivel = (c: ComponenteMontagem) => !c.suprimido && !c.oculto && (!isolados || isolados.has(c.id));

// ---------- peças no kernel e cena ----------

/** Chave do conteúdo da peça (cache de malhas e sólidos no kernel). */
const chaveDe = (p: PecaEmbutida) => `${p.id}:${p.marca ?? marcaDe(JSON.stringify(p.doc.features))}`;

function malhaDa(p: PecaEmbutida): Promise<ResultadoComponente> {
  const k = chaveDe(p);
  const pronta = malhas.get(k);
  if (pronta) return Promise.resolve(pronta);
  let pd = pedidos.get(k);
  if (!pd) {
    const feats = p.doc.features.slice(0, p.doc.retrocesso ?? p.doc.features.length);
    pd = kernel.componente(k, feats).then((r) => {
      malhas.set(k, r);
      pedidos.delete(k);
      if (r.erros.length) errosPeca.set(p.id, `${r.erros.length} recurso(s) com erro na peça`);
      else errosPeca.delete(p.id);
      return r;
    }, (e) => {
      pedidos.delete(k);
      errosPeca.set(p.id, (e as Error).message);
      throw e;
    });
    pedidos.set(k, pd);
  }
  return pd;
}

/** Monta a cena com as malhas já calculadas (síncrono: usado a cada movimento do arraste). */
function montarCena() {
  if (!doc) {
    cena = null;
    viewport.mostrarMalha(null);
    return;
  }
  if (doc.padroes?.length) aplicarPadroes(doc, centrosLocais());
  const poses = mostrarExplodida && doc.explosao?.length ? posesExplodidas(doc) : null;
  const itens = doc.componentes.filter(visivel).flatMap((c) => {
    const r = malhas.get(chaveDe(pecaDe(c)));
    return r?.malha && r.topologia ? [{ comp: c.id, malha: r.malha, topo: r.topologia, t: poses?.get(c.id) ?? c.t }] : [];
  });
  cena = itens.length ? juntar(itens) : null;
  viewport.mostrarMalha(cena?.malha ?? null, cena?.topo ?? null);
  destacar();
}

let seqCena = 0;
/** Calcula as peças que faltam no kernel e mostra a montagem. */
async function atualizarCena(enquadrar = false) {
  if (!doc || estadoKernel !== "pronto") return montarCena();
  const seq = ++seqCena;
  const faltam = doc.componentes.filter((c) => !c.suprimido && !malhas.has(chaveDe(pecaDe(c))));
  if (faltam.length) {
    atualizarStatus(`Calculando ${new Set(faltam.map((c) => c.peca)).size} peça(s)…`);
    await Promise.allSettled([...new Set(faltam.map(pecaDe))].map(malhaDa));
  }
  if (seq !== seqCena) return;
  montarCena();
  if (enquadrar) viewport.enquadrar(false);
  atualizarStatus();
  renderizarArvore();
}

/** Centro (caixa) de cada peça no sistema dela: espelhamento de componentes. */
function centrosLocais(): Map<string, Vec3> {
  const m = new Map<string, Vec3>();
  for (const p of doc?.pecas ?? []) {
    const vs = malhas.get(chaveDe(p))?.topologia?.vertices;
    if (!vs?.length) continue;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); }
    m.set(p.id, [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]);
  }
  return m;
}

// ---------- solver ----------

function centrosDosComponentes(): Map<string, Vec3> {
  const m = new Map<string, Vec3>();
  if (cena) for (const id of cena.mapa.comps) {
    const c = centroDoComponente(cena, id);
    if (c) m.set(id, c);
  }
  return m;
}

function escalaDaCena(): number {
  if (!cena?.topo.vertices.length) return 100;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of cena.topo.vertices) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); }
  return Math.max(10, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
}

/** Roda o solver e aplica as novas posições. */
function resolver(o: { preferido?: string; arrastado?: { comp: string; alvo: Transformacao }; semGraus?: boolean } = {}) {
  if (!doc) return;
  solucao = resolverMontagem(doc, { ...o, centros: centrosDosComponentes(), escala: escalaDaCena() });
  for (const [id, t] of solucao.poses) {
    const c = compDe(id);
    if (c) c.t = t;
  }
  if (doc.padroes?.length) aplicarPadroes(doc, centrosLocais());
}

/** Prefixo do estado do componente na árvore: (f) fixo, (−) subdefinido, (+) com erro. */
function prefixo(c: ComponenteMontagem): string {
  if (c.fixo) return "(f) ";
  if (c.padrao) return "";
  const erro = doc!.posicionamentos.some((m) => solucao?.erros.has(m.id) && (m.a?.comp === c.id || m.b?.comp === c.id));
  if (erro) return "(+) ";
  const g = solucao?.graus.get(c.id) ?? 6;
  return g > 0 ? "(−) " : "";
}

// ---------- histórico, salvamento automático ----------

function registrarPasso() {
  if (!doc) return;
  historico.push(JSON.stringify(doc));
  if (historico.length > 80) historico.shift();
  refazer.length = 0;
}
function salvarAutosave() {
  if (!doc) return;
  try {
    localStorage.setItem(CHAVE, JSON.stringify(doc));
  } catch {
    /* sem espaço: segue sem o salvamento automático */
  }
}
/** Mudança confirmada: passo de desfazer, salvamento automático e tela. */
function alterou(cenaToda = false) {
  registrarPasso();
  salvarAutosave();
  if (cenaToda) void atualizarCena();
  else montarCena();
  renderizarArvore();
  atualizarStatus();
}
function restaurar(json: string) {
  doc = validarMontagem(JSON.parse(json));
  selComps = selComps.filter((id) => compDe(id));
  if (selMate && !doc.posicionamentos.some((m) => m.id === selMate)) selMate = null;
  $<HTMLInputElement>("nome-doc").value = doc.nome;
  salvarAutosave();
  resolver();
  void atualizarCena();
  renderizarArvore();
}
function desfazer() {
  if (comando || historico.length < 2) return;
  refazer.push(historico.pop()!);
  restaurar(historico[historico.length - 1]);
}
function refazerPasso() {
  if (comando) return;
  const p = refazer.pop();
  if (!p) return;
  historico.push(p);
  restaurar(p);
}

// ---------- status ----------

function atualizarStatus(texto?: string) {
  const k = $("st-kernel");
  k.textContent = { iniciando: "Kernel: iniciando…", pronto: "Kernel: pronto", erro: "Kernel: erro" }[estadoKernel];
  k.dataset.estado = estadoKernel;
  const st = $("st-estado");
  if (!doc) {
    st.textContent = "Nenhuma montagem aberta";
    $("st-info").textContent = "";
    return;
  }
  const nErros = solucao?.erros.size ?? 0;
  let estado = texto ?? "Editando montagem";
  if (!texto && comando?.tipo === "posicionar") estado = `Posicionar: ${comando.sel.length < 2 ? `toque a ${comando.sel.length ? "2ª" : "1ª"} entidade (face, aresta, vértice ou plano)` : NOME_TIPO[comando.m.tipo]}`;
  else if (!texto && comando?.tipo === "mover") estado = `${comando.girar ? "Girar" : "Mover"} componente: arraste um componente flutuante`;
  else if (!texto && comando?.tipo === "inserir") estado = "Inserir componentes: escolha a peça no painel";
  else if (!texto && comando?.tipo === "padrao") estado = comando.campo === "sementes" ? "Toque os componentes a repetir" : `Toque a referência: ${comando.refNome}`;
  else if (!texto && comando?.tipo === "explodir") estado = "Vista explodida: toque os componentes do passo, escolha a direção e a distância";
  else if (!texto && comando?.tipo === "medir") estado = "Medir: toque uma ou duas entidades (faces, arestas, vértices)";
  else if (!texto && selComps.length) estado = `Selecionado: ${selComps.map(nomeComp).join(", ")}`;
  if (nErros) estado += ` · ${nErros} posicionamento(s) com erro`;
  st.textContent = estado;
  st.classList.toggle("com-erro", nErros > 0);
  const sub = doc.componentes.filter((c) => !c.fixo && !c.padrao && !c.suprimido && (solucao?.graus.get(c.id) ?? 6) > 0).length;
  $("st-info").textContent = `${doc.componentes.length} componente(s) · ${doc.posicionamentos.length} posicionamento(s)${sub ? ` · ${sub} subdefinido(s)` : doc.componentes.length ? " · totalmente definida" : ""}`;
}

// ---------- destaques no viewport ----------

/** Entidade de um RefMontagem na cena (para destacar). */
function entidadeDe(r: RefMontagem | null): Entidade | null {
  if (!r?.comp || !cena) return null;
  const c = compDe(r.comp);
  if (!c) return null;
  const topo = malhas.get(chaveDe(pecaDe(c)))?.topologia;
  if (!topo) return null;
  const l = indiceLocal(topo, r.ref);
  if (!l) return null;
  const g = globalDaEntidade(cena.mapa, l.tipo, r.comp, l.indice);
  return g === null ? null : { tipo: l.tipo, indice: g };
}

function destacar(realce: Entidade | null = null) {
  if (!cena) return viewport.destacarEntidades([]);
  const doComp: Entidade[] = selComps.flatMap((id) => facesDoComponente(cena!.mapa, id).map((i) => ({ tipo: "face" as const, indice: i })));
  const sel: Entidade[] = [];
  if (comando?.tipo === "posicionar") for (const r of comando.sel) { const e = entidadeDe(r); if (e) sel.push(e); }
  else if (comando?.tipo === "medir") sel.push(...comando.sel.map((s) => s.ent));
  else if (selMate) {
    const m = doc!.posicionamentos.find((x) => x.id === selMate);
    for (const r of [m?.a ?? null, m?.b ?? null]) { const e = entidadeDe(r); if (e) sel.push(e); }
  }
  viewport.destacarEntidades(sel, realce, doComp);
  // planos da montagem escolhidos no posicionamento
  const plano = comando?.tipo === "posicionar" ? comando.sel.find((r) => r.comp === null && r.ref.tipo === "plano") : undefined;
  viewport.destacarReferencia(plano && plano.ref.tipo === "plano" && plano.ref.id !== "origem" ? (plano.ref.id as never) : null);
}

// ---------- árvore ----------

const PLANOS: [string, string][] = [["XY", "Plano Frontal"], ["XZ", "Plano Superior"], ["YZ", "Plano Lateral"], ["origem", "Origem"]];
const planosVisiveis: Record<string, boolean> = { XY: true, XZ: true, YZ: true, origem: true };
const recolhidos = new Set<string>(["__planos"]);
const ICONE_TIPO: Record<TipoPosicionamento, NomeIcone> = {
  coincidente: "posCoincidente", paralelo: "posParalelo", perpendicular: "posPerpendicular", tangente: "posTangente",
  concentrico: "posConcentrico", travar: "posTravar", distancia: "posDistancia", angulo: "posAngulo",
};

function li(cls: string, icone: NomeIcone, titulo: string, sub = "", nivel = 0): HTMLLIElement {
  const e = document.createElement("li");
  e.className = cls;
  e.style.setProperty("--nivel", String(nivel));
  e.innerHTML = `<span class="item-ic">${ICONES[icone]}</span><span class="item-texto"><strong></strong><small></small></span>`;
  e.querySelector("strong")!.textContent = titulo;
  e.querySelector("small")!.textContent = sub;
  return e;
}

function renderizarArvore() {
  const lista = $("arvore");
  lista.innerHTML = "";
  if (!doc) return;
  const raiz = document.createElement("li");
  raiz.className = "raiz";
  raiz.innerHTML = `${ICONES.montagem}<strong></strong>`;
  raiz.querySelector("strong")!.textContent = doc.nome;
  lista.append(raiz);

  // planos e origem (recolhidos numa pasta, como os planos na peça)
  const pasta = li("item ref", "plano", "Planos e origem", recolhidos.has("__planos") ? "toque para mostrar" : "");
  pasta.onclick = () => {
    if (recolhidos.has("__planos")) recolhidos.delete("__planos");
    else recolhidos.add("__planos");
    renderizarArvore();
  };
  lista.append(pasta);
  if (!recolhidos.has("__planos")) for (const [id, nome] of PLANOS) {
    const e = li("item ref filho", id === "origem" ? "origem" : "plano", nome, "", 1);
    e.classList.toggle("oculta", !planosVisiveis[id]);
    const olho = document.createElement("button");
    olho.className = "item-olho";
    olho.innerHTML = planosVisiveis[id] ? ICONES.olho : ICONES.olhoFechado;
    olho.onclick = (ev) => {
      ev.stopPropagation();
      planosVisiveis[id] = !planosVisiveis[id];
      viewport.definirVisibilidadeReferencia(id as never, planosVisiveis[id]);
      renderizarArvore();
    };
    e.append(olho);
    e.onclick = () => {
      if (comando?.tipo === "posicionar") return adicionarEntidade({ comp: null, ref: { tipo: "plano", id } });
      if (id !== "origem") viewport.vistaNormalA(id as never);
    };
    lista.append(e);
  }

  // componentes (as instâncias de padrão aparecem dentro do padrão)
  for (const c of doc.componentes.filter((x) => !x.padrao)) {
    const p = pecaDe(c);
    const g = solucao?.graus.get(c.id);
    const sub = c.suprimido ? "suprimido" : c.fixo ? "fixo" : g === 0 ? "totalmente definido" : `${g ?? 6} grau(s) livre(s)`;
    const e = li("item", "componente", `${prefixo(c)}${rotuloComponente(doc, c)}`, `${sub}${errosPeca.has(p.id) ? ` · ${errosPeca.get(p.id)}` : ""}${p.arquivo ? "" : " · fora do cofre"}`);
    e.classList.toggle("ativo", selComps.includes(c.id));
    e.classList.toggle("suprimida", !!c.suprimido);
    e.classList.toggle("oculta", !!c.oculto);
    e.classList.toggle("com-erro", prefixo(c) === "(+) " || errosPeca.has(p.id));
    const olho = document.createElement("button");
    olho.className = "item-olho";
    olho.title = c.oculto ? "Mostrar" : "Ocultar";
    olho.innerHTML = c.oculto ? ICONES.olhoFechado : ICONES.olho;
    olho.onclick = (ev) => {
      ev.stopPropagation();
      c.oculto = !c.oculto;
      alterou();
    };
    e.append(olho);
    e.onclick = (ev) => tocarComponente(c.id, ev.ctrlKey || ev.shiftKey || ev.metaKey, e);
    e.oncontextmenu = (ev) => {
      ev.preventDefault();
      if (!selComps.includes(c.id)) selComps = [c.id];
      destacar();
      const r = e.getBoundingClientRect();
      mostrarBarra(acoesDoComponente(), r.right, r.top + 40);
    };
    lista.append(e);
  }

  // padrões e espelhamentos
  for (const pd of doc.padroes ?? []) {
    const inst = doc.componentes.filter((c) => c.padrao === pd.id);
    const ic: NomeIcone = pd.tipo === "linear" ? "padraoComponentes" : pd.tipo === "circular" ? "padraoCircular" : "espelhar";
    const e = li("item", ic, pd.nome, `${pd.sementes.map(nomeComp).join(", ")} · ${inst.length} cópia(s)`);
    e.classList.toggle("suprimida", !!pd.suprimido);
    e.onclick = (ev) => {
      if (comando) return avisar("Conclua o comando atual (✓) antes de selecionar outro item.");
      selComps = inst.map((c) => c.id);
      destacar();
      renderizarArvore();
      mostrarBarra(acoesDoPadrao(pd), ev.clientX, ev.clientY);
    };
    lista.append(e);
    if (!recolhidos.has(pd.id)) for (const c of inst) {
      const ei = li("item filho", "componente", rotuloComponente(doc, c), `cópia ${c.copia} de ${nomeComp(c.semente ?? null)}`, 1);
      ei.classList.toggle("ativo", selComps.includes(c.id));
      ei.onclick = (ev) => tocarComponente(c.id, ev.ctrlKey || ev.shiftKey || ev.metaKey, ei);
      lista.append(ei);
    }
  }
  // vista explodida
  if (doc.explosao?.length) {
    const e = li("item", "explodida", "Vista explodida", `${doc.explosao.length} passo(s) · ${mostrarExplodida ? "explodida (toque para recolher)" : "recolhida (toque para explodir)"}`);
    e.classList.toggle("ativo", mostrarExplodida);
    e.onclick = () => alternarExplosao();
    e.oncontextmenu = (ev) => {
      ev.preventDefault();
      mostrarBarra([
        { rotulo: "Editar passos", icone: "explodida", acao: abrirExplodir },
        { rotulo: "Excluir a explosão", icone: "fechar", acao: () => {
          doc!.explosao = [];
          mostrarExplodida = false;
          alterou();
        } },
      ], ev.clientX, ev.clientY);
    };
    lista.append(e);
  }

  // posicionamentos
  const nM = doc.posicionamentos.length;
  const pm = li("item ref", "posicionar", `Posicionamentos (${nM})`, nM ? "" : "nenhum ainda: Posicionar (M)");
  pm.onclick = () => {
    if (recolhidos.has("__mates")) recolhidos.delete("__mates");
    else recolhidos.add("__mates");
    renderizarArvore();
  };
  lista.append(pm);
  if (!recolhidos.has("__mates")) for (const m of doc.posicionamentos) {
    const erro = solucao?.erros.get(m.id);
    const valor = m.tipo === "distancia" ? ` = ${fmt(m.valor ?? 0)} mm` : m.tipo === "angulo" ? ` = ${fmt(m.valor ?? 0)}°` : "";
    const e = li("item filho", ICONE_TIPO[m.tipo], `${m.nome}${valor}`, erro ?? `${nomeComp(m.a?.comp ?? null)}, ${nomeComp(m.b?.comp ?? null)}`, 1);
    e.classList.toggle("ativo", selMate === m.id || (comando?.tipo === "posicionar" && comando.m.id === m.id));
    e.classList.toggle("suprimida", !!m.suprimido);
    e.classList.toggle("com-erro", !!erro);
    e.title = erro ?? "";
    e.onclick = () => {
      if (comando) return avisar("Conclua o comando atual (✓) antes de selecionar outro item.");
      selMate = selMate === m.id ? null : m.id;
      selComps = [];
      destacar();
      renderizarArvore();
      if (selMate) {
        const r = e.getBoundingClientRect();
        mostrarBarra(acoesDoPosicionamento(m), r.right, r.top + 40);
      }
    };
    lista.append(e);
  }
}

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toLocaleString("pt-BR");

// ---------- abas e faixa de comandos ----------

interface Cmd {
  id: string;
  rotulo: string;
  icone: NomeIcone;
  dica: string;
  grupo: number;
  emBreve?: boolean;
}
const ABAS_M: { id: string; rotulo: string; comandos: Cmd[] }[] = [
  {
    id: "montagem", rotulo: "Montagem", comandos: [
      { id: "inserir", rotulo: "Inserir componentes", icone: "inserirComponente", dica: "Insere peças do cofre ou do aparelho (I)", grupo: 0 },
      { id: "posicionar", rotulo: "Posicionar", icone: "posicionar", dica: "Posicionamentos: coincidente, paralelo, perpendicular, tangente, concêntrico, travar, distância, ângulo (M)", grupo: 0 },
      { id: "mover", rotulo: "Mover componente", icone: "moverComponente", dica: "Arrastar livre, por ΔXYZ ou para uma posição XYZ", grupo: 1 },
      { id: "girar", rotulo: "Girar componente", icone: "girarComponente", dica: "Arrastar livre ou por ângulos em X, Y e Z", grupo: 1 },
      { id: "padrao-linear", rotulo: "Padrão linear", icone: "padraoComponentes", dica: "Repete componentes em uma ou duas direções (as cópias seguem a semente)", grupo: 2 },
      { id: "padrao-circular", rotulo: "Padrão circular", icone: "padraoCircular", dica: "Repete componentes em torno de um eixo", grupo: 2 },
      { id: "espelhar", rotulo: "Espelhar componentes", icone: "espelhar", dica: "Cópia na posição espelhada por um plano (peças simétricas)", grupo: 2 },
      { id: "explodida", rotulo: "Vista explodida", icone: "explodida", dica: "Passos de explosão (manual ou automática); toque de novo na árvore para explodir/recolher", grupo: 3 },
      { id: "explodir-recolher", rotulo: "Explodir / Recolher", icone: "olho", dica: "Mostra a montagem explodida ou recolhida", grupo: 3 },
      { id: "isolar", rotulo: "Isolar", icone: "isolar", dica: "Mostra só os componentes selecionados (de novo: mostra todos)", grupo: 3 },
      { id: "mostrar-todos", rotulo: "Mostrar todos", icone: "olho", dica: "Mostra os componentes ocultos e sai do isolamento", grupo: 3 },
    ],
  },
  {
    id: "avaliar", rotulo: "Avaliar", comandos: [
      { id: "lista-materiais", rotulo: "Lista de materiais", icone: "listaMateriais", dica: "Itens, código, descrição, material e quantidade (CSV, WJPlan)", grupo: 0 },
      { id: "interferencia", rotulo: "Interferência", icone: "interferencia", dica: "Detecta volumes de interferência entre componentes", grupo: 0 },
      { id: "massa", rotulo: "Propriedades de massa", icone: "massa", dica: "Massa, volume e centro de massa da montagem", grupo: 0 },
      { id: "medir", rotulo: "Medir", icone: "medir", dica: "Distâncias e ângulos entre componentes", grupo: 1 },
    ],
  },
];
let abaAtiva = "montagem";

function renderizarAbas() {
  const abas = $("abas");
  abas.innerHTML = "";
  for (const a of ABAS_M) {
    const b = document.createElement("button");
    b.className = "aba";
    b.role = "tab";
    b.textContent = a.rotulo;
    b.setAttribute("aria-selected", String(a.id === abaAtiva));
    b.onclick = () => {
      abaAtiva = a.id;
      renderizarAbas();
    };
    abas.append(b);
  }
  const faixa = $("faixa-comandos");
  faixa.innerHTML = "";
  const aba = ABAS_M.find((a) => a.id === abaAtiva)!;
  let grupo = aba.comandos[0]?.grupo;
  for (const c of aba.comandos) {
    if (c.grupo !== grupo) {
      faixa.append(Object.assign(document.createElement("span"), { className: "sep" }));
      grupo = c.grupo;
    }
    const b = document.createElement("button");
    b.className = "cmd";
    b.title = c.emBreve ? `${c.dica} — em breve` : c.dica;
    b.innerHTML = `${ICONES[c.icone]}<span>${c.rotulo}</span>`;
    if (c.emBreve) {
      b.setAttribute("aria-disabled", "true");
      b.insertAdjacentHTML("beforeend", `<em class="selo">breve</em>`);
    }
    const ativo = (c.id === "posicionar" && comando?.tipo === "posicionar") || (c.id === "inserir" && comando?.tipo === "inserir")
      || (c.id === "mover" && comando?.tipo === "mover" && !comando.girar) || (c.id === "girar" && comando?.tipo === "mover" && comando.girar)
      || (c.id === "isolar" && !!isolados) || (c.id === "explodir-recolher" && mostrarExplodida)
      || (c.id === "medir" && comando?.tipo === "medir") || (c.id === "explodida" && comando?.tipo === "explodir")
      || (comando?.tipo === "padrao" && ((c.id === "padrao-linear" && comando.p.tipo === "linear") || (c.id === "padrao-circular" && comando.p.tipo === "circular") || (c.id === "espelhar" && comando.p.tipo === "espelho")));
    b.setAttribute("aria-pressed", String(ativo));
    b.onclick = () => executar(c);
    faixa.append(b);
  }
}

function executar(c: Cmd) {
  if (c.emBreve) return avisar(`${c.rotulo}: em breve (roteiro da montagem, docs/funcional/montagem.md).`);
  if (!doc) return;
  esconderBarra();
  switch (c.id) {
    case "inserir": return abrirInserir();
    case "posicionar": return abrirPosicionar();
    case "mover": return abrirMover(false);
    case "girar": return abrirMover(true);
    case "isolar": return alternarIsolar();
    case "mostrar-todos": return mostrarTodos();
    case "lista-materiais": return mostrarListaMateriais();
    case "padrao-linear": return abrirPadrao("linear");
    case "padrao-circular": return abrirPadrao("circular");
    case "espelhar": return abrirPadrao("espelho");
    case "explodida": return abrirExplodir();
    case "explodir-recolher": return alternarExplosao();
    case "interferencia": return void verificarInterferencia();
    case "massa": return void mostrarMassa();
    case "medir": return abrirMedir();
  }
}

// ---------- ações sobre componentes ----------

function acoesDoComponente(): AcaoContexto[] {
  const cs = selComps.map(compDe).filter((c): c is ComponenteMontagem => !!c);
  if (!cs.length) return [];
  const um = cs.length === 1 ? cs[0] : null;
  const out: AcaoContexto[] = [
    { rotulo: "Posicionar", icone: "posicionar", acao: () => abrirPosicionar() },
    { rotulo: "Mover", icone: "moverComponente", acao: () => abrirMover(false) },
    { rotulo: "Girar", icone: "girarComponente", acao: () => abrirMover(true) },
    cs.every((c) => c.fixo)
      ? { rotulo: "Flutuar", icone: "flutuar", acao: () => fixar(cs, false) }
      : { rotulo: "Fixar", icone: "fixar", acao: () => fixar(cs, true) },
    { rotulo: cs.every((c) => c.oculto) ? "Mostrar" : "Ocultar", icone: cs.every((c) => c.oculto) ? "olho" : "olhoFechado", acao: () => ocultar(cs) },
    { rotulo: "Isolar", icone: "isolar", acao: () => alternarIsolar() },
    { rotulo: cs.every((c) => c.suprimido) ? "Reativar" : "Suprimir", icone: "olhoFechado", acao: () => suprimir(cs) },
  ];
  if (um) out.push({ rotulo: "Abrir peça", icone: "peca", acao: () => void abrirPeca(um) });
  out.push({ rotulo: "Excluir", icone: "fechar", acao: () => excluirSelecao() });
  return out;
}

function acoesDoPosicionamento(m: Posicionamento): AcaoContexto[] {
  return [
    { rotulo: "Editar", icone: "posicionar", acao: () => abrirPosicionar(m) },
    ...(m.tipo !== "travar" && m.tipo !== "concentrico" ? [{ rotulo: "Inverter alinhamento", icone: "girarComponente" as NomeIcone, acao: () => {
      m.alinhamento = m.alinhamento === "antialinhado" ? "alinhado" : "antialinhado";
      resolver();
      alterou();
    } }] : []),
    { rotulo: m.suprimido ? "Reativar" : "Suprimir", icone: "olhoFechado", acao: () => {
      m.suprimido = !m.suprimido;
      resolver();
      alterou();
    } },
    { rotulo: "Excluir", icone: "fechar", acao: () => {
      doc!.posicionamentos = doc!.posicionamentos.filter((x) => x !== m);
      selMate = null;
      resolver();
      alterou();
    } },
  ];
}

function fixar(cs: ComponenteMontagem[], f: boolean) {
  for (const c of cs) c.fixo = f;
  resolver();
  alterou();
  avisar(f ? "Fixo: o componente não se move (nem pelos posicionamentos)." : "Flutuante: os posicionamentos e o arraste movem o componente.");
}
function ocultar(cs: ComponenteMontagem[]) {
  const todos = cs.every((c) => c.oculto);
  for (const c of cs) c.oculto = !todos;
  alterou();
}
function suprimir(cs: ComponenteMontagem[]) {
  const todos = cs.every((c) => c.suprimido);
  for (const c of cs) c.suprimido = !todos;
  resolver();
  alterou(true);
}
function alternarIsolar() {
  if (isolados) isolados = null;
  else if (selComps.length) isolados = new Set(selComps);
  else return avisar("Selecione os componentes a isolar.");
  montarCena();
  renderizarAbas();
  avisar(isolados ? "Isolado: só os selecionados aparecem. Toque Isolar de novo para ver todos." : "Todos os componentes visíveis.");
}
function mostrarTodos() {
  isolados = null;
  for (const c of doc!.componentes) c.oculto = false;
  alterou();
  renderizarAbas();
}
function excluirSelecao() {
  if (!doc || !selComps.length) return;
  if (selComps.some((id) => compDe(id)?.padrao)) return avisar("Cópias de padrão saem editando ou excluindo o padrão (árvore).");
  const nomes = selComps.map(nomeComp).join(", ");
  const n = doc.posicionamentos.filter((m) => selComps.includes(m.a?.comp ?? "") || selComps.includes(m.b?.comp ?? "")).length;
  if (!confirm(`Excluir ${nomes}${n ? ` e ${n} posicionamento(s) deles` : ""}?`)) return;
  excluirComponentes(doc, selComps);
  selComps = [];
  resolver();
  alterou();
}

/** Abre a peça do componente no ambiente de Peça (do cofre, ou a cópia embutida). */
async function abrirPeca(c: ComponenteMontagem) {
  const p = pecaDe(c);
  salvarAutosave();
  if (p.arquivo) {
    const r = await lerDoCofre(p.arquivo);
    if (r) {
      avisar(`Abrindo ${p.nome} no ambiente de Peça. Ao salvar lá e voltar, a montagem se atualiza.`);
      sessionStorage.setItem("wjcad:voltarMontagem", "1");
      const erro = await abrirArquivoNoApp(r.arquivo);
      if (erro) avisar(erro);
      return;
    }
  }
  // peça só embutida (veio do aparelho): abre a cópia; ao salvar ela entra no cofre
  localStorage.setItem("jlscad:documento", JSON.stringify(p.doc));
  desligar("cad");
  sessionStorage.setItem("wjcad:voltarMontagem", "1");
  location.href = new URL(`${RAIZ}cad/#abrir-autosave`, location.href).href;
}

// ---------- seleção no modelo ----------

/** Componente sob o ponteiro (pela face/aresta/vértice tocada). */
function componenteSob(x: number, y: number, tol = 10): { comp: string; ent: Entidade } | null {
  if (!cena) return null;
  const ent = viewport.picarEntidade(x, y, new Set(["face", "aresta", "vertice"]), tol);
  if (!ent) return null;
  const l = localDaEntidade(cena.mapa, ent.tipo, ent.indice);
  return l ? { comp: l.comp, ent } : null;
}

function tocarComponente(id: string, somar: boolean, ancora?: HTMLElement, xy?: { x: number; y: number }) {
  if (comando?.tipo === "inserir") return;
  selMate = null;
  if (somar) selComps = selComps.includes(id) ? selComps.filter((x) => x !== id) : [...selComps, id];
  else selComps = selComps.length === 1 && selComps[0] === id ? [] : [id];
  destacar();
  renderizarArvore();
  atualizarStatus();
  if (comando?.tipo === "mover") return renderizarComando();
  if (!selComps.length) return esconderBarra();
  if (xy) mostrarBarra(acoesDoComponente(), xy.x, xy.y);
  else if (ancora) {
    const r = ancora.getBoundingClientRect();
    mostrarBarra(acoesDoComponente(), r.right, r.top + 40);
  }
}

/** Referência (na peça, coordenadas locais) da entidade tocada na cena. */
function refDaEntidade(ent: Entidade): RefMontagem | null {
  if (!cena) return null;
  const l = localDaEntidade(cena.mapa, ent.tipo, ent.indice);
  if (!l) return null;
  const c = compDe(l.comp)!;
  const topo = malhas.get(chaveDe(pecaDe(c)))?.topologia;
  if (!topo) return null;
  const ref: Referencia = ent.tipo === "face" ? { tipo: "face", ass: topo.faces[l.indice] }
    : ent.tipo === "aresta" ? { tipo: "aresta", ass: topo.arestas[l.indice] }
    : { tipo: "vertice", p: topo.vertices[l.indice] };
  return { comp: l.comp, ref };
}

/**
 * Entidade sob o toque: aresta/vértice só quando o toque cai em cima deles (6 px); senão a face
 * sob o dedo; senão a aresta/vértice mais perto dentro da tolerância do dedo. O dedo, largo,
 * não troca a face tocada pela aresta ou o canto vizinhos.
 */
function picarNoToque(e: PointerEvent): Entidade | null {
  const tol = e.pointerType === "touch" ? 22 : 10;
  const av = new Set<TipoEntidade>(["aresta", "vertice"]);
  return viewport.picarEntidade(e.clientX, e.clientY, av, 6)
    ?? viewport.picarEntidade(e.clientX, e.clientY, new Set<TipoEntidade>(["face"]), 2)
    ?? viewport.picarEntidade(e.clientX, e.clientY, av, tol);
}

viewport.aoToqueCurto = (e) => {
  if (!doc) return;
  const tol = e.pointerType === "touch" ? 22 : 10;
  if (comando?.tipo === "posicionar") {
    // dedo em cima de uma face: a face ganha; aresta/vértice só bem perto (senão o dedo, largo,
    // pegaria a aresta vizinha em vez da face tocada)
    const ent = picarNoToque(e);
    const r = ent ? refDaEntidade(ent) : null;
    if (r) adicionarEntidade(r, { x: e.clientX, y: e.clientY });
    return;
  }
  if (comando?.tipo === "inserir") return colocarInserido(e.clientX, e.clientY);
  if (comando?.tipo === "medir") {
    const ent = picarNoToque(e);
    if (ent) void adicionarMedida(ent);
    return;
  }
  if (comando?.tipo === "padrao" && comando.campo === "ref") {
    const ent = viewport.picarEntidade(e.clientX, e.clientY, new Set<TipoEntidade>(["face", "aresta"]), Math.min(tol, 10))
      ?? viewport.picarEntidade(e.clientX, e.clientY, new Set<TipoEntidade>(["aresta"]), tol);
    if (ent) referenciaDoPadrao(ent);
    return;
  }
  const alvo = componenteSob(e.clientX, e.clientY, tol);
  if (comando?.tipo === "padrao" || comando?.tipo === "explodir") {
    if (alvo) alternarNoComando(alvo.comp);
    return;
  }
  if (alvo) tocarComponente(alvo.comp, e.ctrlKey || e.shiftKey || e.metaKey, undefined, { x: e.clientX, y: e.clientY });
  else if (!comando) {
    selComps = [];
    selMate = null;
    esconderBarra();
    destacar();
    renderizarArvore();
    atualizarStatus();
  }
};

viewport.aoMenuContexto = (e) => {
  if (!doc) return;
  if (comando) {
    return mostrarBarra([
      { rotulo: "OK", icone: "concluir", acao: confirmarComando },
      { rotulo: "Cancelar", icone: "fechar", acao: cancelarComando },
      { rotulo: "Enquadrar", icone: "enquadrar", acao: () => viewport.enquadrar() },
    ], e.clientX, e.clientY);
  }
  const alvo = componenteSob(e.clientX, e.clientY);
  if (alvo && !selComps.includes(alvo.comp)) {
    selComps = [alvo.comp];
    destacar();
    renderizarArvore();
  }
  mostrarBarra([
    ...acoesDoComponente(),
    { rotulo: "Inserir componentes", icone: "inserirComponente", acao: () => abrirInserir() },
    { rotulo: "Enquadrar", icone: "enquadrar", acao: () => viewport.enquadrar() },
    { rotulo: "Desfazer", icone: "desfazer", acao: desfazer },
  ], e.clientX, e.clientY);
};

// ---------- painel de comando (no lugar da árvore) ----------

function mostrarPainel(emComando: boolean) {
  $("arvore").hidden = emComando;
  $("painel-comando").hidden = !emComando;
  $("canto-confirmacao").hidden = !emComando;
  if (!emComando) $("painel-comando").innerHTML = "";
  abrirGaveta(emComando);
}

function fecharComando() {
  comando = null;
  viewport.interceptador = null;
  mostrarPainel(false);
  destacar();
  renderizarAbas();
  renderizarArvore();
  atualizarStatus();
}

function confirmarComando() {
  if (!comando) return;
  if (comando.tipo === "posicionar" && comando.sel.length === 2) return void concluirPosicionamento(true);
  if (comando.tipo === "posicionar" && comando.editando) return void concluirPosicionamento(true);
  if (comando.tipo === "posicionar" && comando.sel.length === 1) return avisar("Toque a segunda entidade (ou ✕ para sair).");
  if (comando.tipo === "padrao") return concluirPadrao();
  if (comando.tipo === "medir") return fecharComando();
  fecharComando();
  alterou();
}

function cancelarComando() {
  if (!comando) return;
  if (comando.tipo === "mover" || comando.tipo === "posicionar" || comando.tipo === "padrao" || comando.tipo === "explodir") {
    doc = validarMontagem(JSON.parse(comando.snapshot));
    resolver();
    montarCena();
  }
  fecharComando();
}

/** Cabeçalho ✓/✕ e caixas com as classes do painel da peça (formulario.ts). */
function painelBase(titulo: string, erro?: string): HTMLElement {
  const p = $("painel-comando");
  p.innerHTML = "";
  p.classList.add("painel-comando");
  const cab = document.createElement("div");
  cab.className = "pc-cabecalho";
  cab.innerHTML = `<h2 class="pc-titulo"></h2><button class="pc-ok" title="OK (Enter)">✓</button><button class="pc-cancelar" title="Cancelar (Esc)">✕</button>`;
  cab.querySelector("h2")!.textContent = titulo;
  cab.querySelector<HTMLElement>(".pc-ok")!.onclick = confirmarComando;
  cab.querySelector<HTMLElement>(".pc-cancelar")!.onclick = cancelarComando;
  p.append(cab);
  if (erro) p.append(Object.assign(document.createElement("p"), { className: "prop-erro", textContent: erro }));
  return p;
}
function caixa(p: HTMLElement, titulo: string): HTMLElement {
  const s = document.createElement("section");
  s.className = "pc-caixa";
  s.innerHTML = `<header class="pc-caixa-titulo"><span></span><span class="pc-seta">▾</span></header><div class="pc-caixa-corpo"></div>`;
  s.querySelector("span")!.textContent = titulo;
  p.append(s);
  return s.querySelector(".pc-caixa-corpo")!;
}

function renderizarComando() {
  if (!comando) return;
  if (comando.tipo === "inserir") return renderizarInserir();
  if (comando.tipo === "mover") return renderizarMover();
  if (comando.tipo === "padrao") return renderizarPadrao();
  if (comando.tipo === "explodir") return renderizarExplodir();
  if (comando.tipo === "medir") return renderizarMedir();
  return renderizarPosicionar();
}

$("cc-ok").onclick = confirmarComando;
$("cc-cancelar").onclick = cancelarComando;

// ---------- Inserir componentes ----------

let pendenteColocar: string | null = null;

function abrirInserir() {
  if (comando) cancelarComando();
  comando = { tipo: "inserir", manter: false };
  pendenteColocar = null;
  mostrarPainel(true);
  renderizarAbas();
  atualizarStatus();
  void renderizarInserir();
}

async function renderizarInserir() {
  if (comando?.tipo !== "inserir") return;
  const c = comando;
  const p = painelBase("Inserir componentes");
  const corpo = caixa(p, "Peça a inserir");
  corpo.innerHTML = `<input class="campo-busca" type="search" placeholder="Pesquisar no cofre…" aria-label="Pesquisar peças no cofre" />
    <div class="pc-arquivos" data-lista><p class="dica">Lendo o cofre…</p></div>
    <div class="pc-botoes"><button data-b="aberta" class="largo"></button><button data-b="aparelho" class="largo">Procurar no aparelho…</button></div>`;
  const aberta = (() => {
    try {
      const d = JSON.parse(localStorage.getItem("jlscad:documento") ?? "null");
      return d && Array.isArray(d.features) && d.features.length ? (d as Documento) : null;
    } catch {
      return null;
    }
  })();
  const bAberta = corpo.querySelector<HTMLButtonElement>('[data-b="aberta"]')!;
  if (aberta) {
    bAberta.textContent = `Peça aberta no WJCAD: ${aberta.nome}`;
    bAberta.onclick = () => void inserirDoc(validarDocumento(aberta), { arquivo: vinculo("cad") ?? undefined, nome: aberta.nome });
  } else bAberta.remove();
  corpo.querySelector<HTMLButtonElement>('[data-b="aparelho"]')!.onclick = () => $<HTMLInputElement>("arquivo").click();
  const opcoes = caixa(p, "Opções");
  opcoes.innerHTML = `<label class="interruptor"><input type="checkbox" data-manter ${c.manter ? "checked" : ""}/><span>Manter aberto (inserir várias)</span></label>
    <p class="dica">Escolhida a peça, toque no modelo onde ela deve ficar. O primeiro componente da montagem fica fixo na origem.</p>`;
  opcoes.querySelector<HTMLInputElement>("[data-manter]")!.onchange = (e) => (c.manter = (e.target as HTMLInputElement).checked);
  const lista = corpo.querySelector<HTMLElement>("[data-lista]")!;
  const busca = corpo.querySelector<HTMLInputElement>(".campo-busca")!;
  let docs: Awaited<ReturnType<typeof documentosDoCofre>> = [];
  try {
    docs = await documentosDoCofre(["wjcad", "jlscad"]);
  } catch {
    docs = [];
  }
  const desenhar = () => {
    const q = busca.value.trim().toLowerCase();
    const vis = docs.filter((d) => !q || d.arquivo.nome.toLowerCase().includes(q) || (d.arquivo.cartao.codigo ?? "").toLowerCase().includes(q) || (d.arquivo.cartao.descricao ?? "").toLowerCase().includes(q));
    lista.innerHTML = vis.length ? "" : `<p class="dica">${docs.length ? "Nada encontrado." : "Nenhuma peça no cofre ainda: salve peças no WJCAD (💾) ou procure no aparelho."}</p>`;
    for (const d of vis.slice(0, 60)) {
      const b = document.createElement("button");
      b.className = "pc-arquivo";
      b.innerHTML = `${ICONES.peca}<span><strong></strong><small></small></span>`;
      b.querySelector("strong")!.textContent = d.arquivo.nome.replace(/\.(wjcad|jlscad)$/i, "");
      b.querySelector("small")!.textContent = `${d.caminho}${d.arquivo.cartao.codigo ? ` · ${d.arquivo.cartao.codigo}` : ""}${d.arquivo.revisao ? ` · rev. ${d.arquivo.revisao}` : ""}`;
      b.onclick = () => void inserirDoCofre(d.arquivo.id);
      lista.append(b);
    }
  };
  busca.oninput = desenhar;
  desenhar();
}

async function inserirDoCofre(id: string) {
  const r = await lerDoCofre(id);
  if (!r) return avisar("Não foi possível ler a peça no cofre.");
  try {
    await inserirDoc(validarDocumento(JSON.parse(r.texto)), { arquivo: id, versao: r.versao, nome: r.arquivo.nome });
  } catch (e) {
    avisar((e as Error).message);
  }
}

/** Embute a peça, cria o componente e espera o toque para colocar. */
async function inserirDoc(d: Documento, origem: { arquivo?: string; versao?: number; nome?: string }) {
  if (!doc) return;
  const pecaId = embutirPeca(doc, d, origem);
  // ao lado do que já existe (o toque no modelo coloca onde se quer)
  let pos: Vec3 = [0, 0, 0];
  if (cena?.topo.vertices.length) {
    let mx = -Infinity;
    for (const v of cena.topo.vertices) mx = Math.max(mx, v[0]);
    pos = [mx + escalaDaCena() * 0.4, 0, 0];
  }
  const c = inserirComponente(doc, pecaId, { pos, rot: [0, 0, 0, 1] });
  selComps = [c.id];
  pendenteColocar = c.fixo ? null : c.id;
  await atualizarCena(doc.componentes.length === 1);
  registrarPasso();
  salvarAutosave();
  avisar(c.fixo ? `${rotuloComponente(doc, c)} inserido fixo na origem.` : `${rotuloComponente(doc, c)} inserido: toque no modelo para colocá-lo, ou ✓.`);
  if (comando?.tipo === "inserir" && !comando.manter && !pendenteColocar) fecharComando();
}

/** Toque com o Inserir aberto: coloca o componente recém-inserido no ponto tocado. */
function colocarInserido(x: number, y: number) {
  if (!doc || !pendenteColocar) return;
  const c = compDe(pendenteColocar);
  if (!c) return;
  const eixos = viewport.eixosCamera();
  const alvo = viewport.pontoSob(x, y) ?? (() => {
    const o = viewport.alvoCamera();
    const q = viewport.telaParaPlano(x, y, { origem: o, x: eixos.direita, y: eixos.cima, normal: eixos.dir });
    return q ? ([o[0] + eixos.direita[0] * q.x + eixos.cima[0] * q.y, o[1] + eixos.direita[1] * q.x + eixos.cima[1] * q.y, o[2] + eixos.direita[2] * q.x + eixos.cima[2] * q.y] as Vec3) : null;
  })();
  if (!alvo) return;
  // a origem da peça vai para o ponto, recuada para não entrar no que foi tocado
  const centro = cena ? centroDoComponente(cena, c.id) : null;
  const desloc: Vec3 = centro ? [c.t.pos[0] - centro[0], c.t.pos[1] - centro[1], c.t.pos[2] - centro[2]] : [0, 0, 0];
  c.t = { pos: [alvo[0] + desloc[0], alvo[1] + desloc[1], alvo[2] + desloc[2]], rot: c.t.rot };
  pendenteColocar = null;
  montarCena();
  registrarPasso();
  salvarAutosave();
  if (comando?.tipo === "inserir" && !comando.manter) fecharComando();
  else avisar("Colocado. Escolha outra peça ou ✓.");
}

$<HTMLInputElement>("arquivo").onchange = async (ev) => {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  (ev.target as HTMLInputElement).value = "";
  if (!arq) return;
  try {
    const dados = JSON.parse(await arq.text());
    if (dados?.formato === "wjasm") {
      if (!doc || confirm("Fechar a montagem atual e abrir o arquivo?")) {
        desligar("asm");
        abrirMontagem(validarMontagem(dados));
      }
      return;
    }
    const d = validarDocumento(dados);
    if (comando?.tipo === "inserir") await inserirDoc(d, { nome: arq.name });
    else avisar("Para inserir uma peça, use Inserir componentes.");
  } catch (e) {
    avisar((e as Error).message || "Arquivo inválido.");
  }
};

// ---------- Mover / Girar componente ----------

function abrirMover(girar: boolean) {
  if (comando) cancelarComando();
  if (!doc) return;
  comando = { tipo: "mover", girar, snapshot: JSON.stringify(doc), f: { modo: "livre", dx: 0, dy: 0, dz: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 90 } };
  viewport.interceptador = interceptarArraste;
  mostrarPainel(true);
  renderizarAbas();
  renderizarMover();
  atualizarStatus();
}

function renderizarMover() {
  if (comando?.tipo !== "mover") return;
  const c = comando;
  const um = selComps.length === 1 ? compDe(selComps[0]) : undefined;
  if (um && c.f.modo === "posicao") [c.f.x, c.f.y, c.f.z] = um.t.pos.map((v) => Math.round(v * 1000) / 1000) as Vec3;
  const esq: Esquema<DadosMover> = {
    titulo: c.girar ? "Girar componente" : "Mover componente",
    caixas: [
      { titulo: "Componentes", campos: [{ t: "info", texto: () => (selComps.length ? selComps.map(nomeComp).join(", ") : "Toque os componentes no modelo (ou arraste um).") }] },
      c.girar
        ? {
          titulo: "Girar", campos: [
            { t: "sel", rot: "Tipo", cam: "modo", opcoes: [["livre", "Arrastar livre"], ["delta", "Por ângulos em X, Y, Z"]] },
            { t: "num", rot: "Em torno de X", cam: "rx", un: "°", passo: 15, vis: (f) => f.modo === "delta" },
            { t: "num", rot: "Em torno de Y", cam: "ry", un: "°", passo: 15, vis: (f) => f.modo === "delta" },
            { t: "num", rot: "Em torno de Z", cam: "rz", un: "°", passo: 15, vis: (f) => f.modo === "delta" },
            { t: "botao", rot: "Aplicar", destaque: true, acao: aplicarMover, vis: (f) => f.modo !== "livre" },
          ],
        }
        : {
          titulo: "Mover", campos: [
            { t: "sel", rot: "Tipo", cam: "modo", opcoes: [["livre", "Arrastar livre"], ["delta", "Por ΔX, ΔY, ΔZ"], ["posicao", "Para a posição X, Y, Z"]] },
            { t: "num", rot: "ΔX", cam: "dx", un: "mm", vis: (f) => f.modo === "delta" },
            { t: "num", rot: "ΔY", cam: "dy", un: "mm", vis: (f) => f.modo === "delta" },
            { t: "num", rot: "ΔZ", cam: "dz", un: "mm", vis: (f) => f.modo === "delta" },
            { t: "num", rot: "X", cam: "x", un: "mm", vis: (f) => f.modo === "posicao" },
            { t: "num", rot: "Y", cam: "y", un: "mm", vis: (f) => f.modo === "posicao" },
            { t: "num", rot: "Z", cam: "z", un: "mm", vis: (f) => f.modo === "posicao" },
            { t: "botao", rot: "Aplicar", destaque: true, acao: aplicarMover, vis: (f) => f.modo !== "livre" },
          ],
        },
      { titulo: "Como usar", campos: [{ t: "info", texto: () => "Arraste o componente no modelo (dedo, caneta ou mouse). Com posicionamentos, ele só anda nos graus livres; componentes fixos não se movem." }] },
    ],
  };
  const ctx: ContextoFormulario = {
    aoMudar: () => renderizarMover(),
    ok: confirmarComando,
    cancelar: cancelarComando,
    campoAtivo: null,
    ativarCampo: () => {},
    rotuloRef: () => "",
    realcarRef: () => {},
    equacao: () => undefined,
    definirEquacao: () => {},
    avaliar: (t) => Number(t.replace(",", ".").replace(/^=/, "")),
    recolhidas: new Set(),
  };
  renderizarFormulario($("painel-comando"), c.f, esq, ctx);
}

function aplicarMover() {
  if (comando?.tipo !== "mover" || !doc) return;
  const f = comando.f;
  const cs = selComps.map(compDe).filter((c): c is ComponenteMontagem => !!c && !c.fixo);
  if (!cs.length) return avisar(selComps.length ? "Os selecionados estão fixos: flutue-os para mover." : "Toque os componentes a mover.");
  for (const c of cs) {
    if (comando.girar) {
      const centro = (cena && centroDoComponente(cena, c.id)) ?? c.t.pos;
      c.t = girarEmTorno(c.t, quatDeEuler(f.rx, f.ry, f.rz), centro);
    } else if (f.modo === "delta") c.t = { pos: [c.t.pos[0] + f.dx, c.t.pos[1] + f.dy, c.t.pos[2] + f.dz], rot: c.t.rot };
    else c.t = { pos: [f.x, f.y, f.z], rot: c.t.rot };
  }
  resolver({ preferido: cs[0].id });
  montarCena();
  registrarPasso();
  salvarAutosave();
  renderizarArvore();
  if (solucao?.erros.size) avisar("Movido; os posicionamentos puxaram o componente de volta nos graus que eles prendem.");
}

let arraste: { comp: string; outros: string[]; ref: { origem: Vec3; x: Vec3; y: Vec3; normal: Vec3 }; p0: { x: number; y: number }; x0: number; y0: number; t0: Map<string, Transformacao>; centro: Vec3; quadro: number } | null = null;

/** Pointerdown no viewport durante Mover/Girar: começa a arrastar o componente tocado. */
function interceptarArraste(e: PointerEvent): boolean {
  if (comando?.tipo !== "mover" || !doc) return false;
  if (e.pointerType === "mouse" && e.button !== 0) return false;
  const alvo = componenteSob(e.clientX, e.clientY, e.pointerType === "touch" ? 22 : 10);
  if (!alvo) return false;
  const c = compDe(alvo.comp)!;
  if (c.padrao) {
    avisar(`${rotuloComponente(doc, c)} é cópia de um padrão: mova a semente (${nomeComp(c.semente ?? null)}).`);
    return true;
  }
  if (c.fixo) {
    avisar(`${rotuloComponente(doc, c)} está fixo: flutue-o para mover (menu do componente).`);
    return true;
  }
  if (!selComps.includes(c.id)) selComps = [c.id];
  const eixos = viewport.eixosCamera();
  const origem = viewport.pontoSob(e.clientX, e.clientY) ?? c.t.pos;
  const ref = { origem, x: eixos.direita, y: eixos.cima, normal: eixos.dir };
  const p0 = viewport.telaParaPlano(e.clientX, e.clientY, ref);
  if (!p0) return false;
  const outros = selComps.filter((id) => id !== c.id && !compDe(id)?.fixo);
  arraste = {
    comp: c.id, outros, ref, p0, x0: e.clientX, y0: e.clientY, quadro: 0,
    t0: new Map([c.id, ...outros].map((id) => [id, compDe(id)!.t])),
    centro: (cena && centroDoComponente(cena, c.id)) ?? c.t.pos,
  };
  viewport.canvas().setPointerCapture(e.pointerId);
  destacar();
  renderizarArvore();
  return true;
}

function moverArraste(e: PointerEvent) {
  if (!arraste || comando?.tipo !== "mover" || !doc) return;
  const a = arraste;
  if (a.quadro) return; // um cálculo por quadro
  a.quadro = requestAnimationFrame(() => {
    a.quadro = 0;
    if (arraste !== a || comando?.tipo !== "mover") return;
    const ids = [a.comp, ...a.outros];
    if (comando.girar) {
      // horizontal gira em torno do "para cima" da tela, vertical em torno da "direita"
      const qx = quatEixoAngulo(a.ref.y, (e.clientX - a.x0) * 0.6);
      const qy = quatEixoAngulo(a.ref.x, (e.clientY - a.y0) * 0.6);
      for (const id of ids) compDe(id)!.t = girarEmTorno(girarEmTorno(a.t0.get(id)!, qx, a.centro), qy, a.centro);
    } else {
      const p = viewport.telaParaPlano(e.clientX, e.clientY, a.ref);
      if (!p) return;
      const dx = p.x - a.p0.x, dy = p.y - a.p0.y;
      const d: Vec3 = [a.ref.x[0] * dx + a.ref.y[0] * dy, a.ref.x[1] * dx + a.ref.y[1] * dy, a.ref.x[2] * dx + a.ref.y[2] * dy];
      for (const id of ids) {
        const t = a.t0.get(id)!;
        compDe(id)!.t = { pos: [t.pos[0] + d[0], t.pos[1] + d[1], t.pos[2] + d[2]], rot: t.rot };
      }
    }
    // com posicionamentos: o solver segura o que eles prendem e o componente segue o arraste no resto
    const preso = doc!.posicionamentos.some((m) => !m.suprimido && (m.a?.comp === a.comp || m.b?.comp === a.comp));
    if (preso && !a.outros.length) resolver({ arrastado: { comp: a.comp, alvo: compDe(a.comp)!.t }, semGraus: true });
    montarCena();
  });
}

function soltarArraste() {
  if (!arraste) return;
  cancelAnimationFrame(arraste.quadro);
  arraste = null;
  resolver();
  montarCena();
  registrarPasso();
  salvarAutosave();
  renderizarArvore();
  atualizarStatus();
}
viewport.canvas().addEventListener("pointermove", moverArraste);
viewport.canvas().addEventListener("pointerup", soltarArraste);
viewport.canvas().addEventListener("pointercancel", soltarArraste);

// ---------- Posicionar (mates) ----------

const TIPOS: TipoPosicionamento[] = ["coincidente", "paralelo", "perpendicular", "tangente", "concentrico", "travar", "distancia", "angulo"];
/** Só para posicionar: move sem criar o posicionamento. */
let soPosicionar = false;

function novoPosicionamento(): Posicionamento {
  return { id: novoIdM(), nome: "", tipo: "coincidente", a: null, b: null, alinhamento: "auto" };
}

/** Abre o comando (novo, ou editando um posicionamento existente). */
function abrirPosicionar(existente?: Posicionamento) {
  if (comando) cancelarComando();
  if (!doc) return;
  if (doc.componentes.length < 1) return avisar("Insira componentes antes de posicionar.");
  const snapshot = JSON.stringify(doc);
  comando = existente
    ? { tipo: "posicionar", snapshot, sel: [existente.a!, existente.b!].filter(Boolean), m: existente, editando: true }
    : { tipo: "posicionar", snapshot, sel: [], m: novoPosicionamento(), editando: false };
  selMate = null;
  esconderBarra();
  mostrarPainel(true);
  abrirGaveta(false); // celular: modelo livre para tocar as entidades
  renderizarAbas();
  renderizarPosicionar();
  destacar();
  atualizarStatus();
}

function rotuloEnt(r: RefMontagem): string {
  const nomes: Record<string, string> = { plano: "face plana", cilindro: "face cilíndrica", cone: "face cônica", esfera: "face esférica", outra: "face", linha: "aresta reta", circulo: "aresta circular" };
  const ref = r.ref;
  const tipo = ref.tipo === "face" || ref.tipo === "aresta" ? nomes[ref.ass.geom] ?? ref.tipo : ref.tipo === "vertice" ? "vértice" : ref.tipo === "plano" ? (PLANOS.find((p) => p[0] === ref.id)?.[1] ?? "plano") : ref.tipo;
  return r.comp ? `${tipo} de ${nomeComp(r.comp)}` : `${tipo} (montagem)`;
}

/** Primitiva da entidade em coordenadas da montagem. */
function primitivaDe(r: RefMontagem) {
  const p = primitivaLocal(r.ref);
  if (!p) return null;
  const c = compDe(r.comp);
  return c ? transformar(p, c.t) : p;
}

function adicionarEntidade(r: RefMontagem, xy?: { x: number; y: number }) {
  if (comando?.tipo !== "posicionar" || !doc) return;
  const c = comando;
  if (!primitivaLocal(r.ref)) return avisar("Essa entidade não serve para posicionar: toque faces planas ou cilíndricas, arestas, vértices ou planos.");
  if (c.sel.length >= 2) c.sel = [];
  if (c.sel.length === 1 && c.sel[0].comp === r.comp) {
    if (r.comp === null) return avisar("As duas entidades são da montagem: toque uma entidade de um componente.");
    // segunda entidade no mesmo componente: troca a primeira (como nos CADs)
    c.sel = [r];
  } else c.sel.push(r);
  if (c.sel.length === 2) {
    const A = primitivaDe(c.sel[0]), B = primitivaDe(c.sel[1]);
    const possiveis = A && B ? tiposPossiveis(A, B) : [];
    if (!possiveis.includes(c.m.tipo) || !c.editando) c.m.tipo = possiveis[0] ?? "coincidente";
    if (c.m.tipo === "distancia" || c.m.tipo === "angulo") c.m.valor ??= valorAtual(c.m.tipo, A, B);
    previaPosicionamento();
    if (xy) barraRapida(possiveis, xy);
  } else {
    // primeira entidade: volta as posições à do início (sem prévia)
    doc = validarMontagem(JSON.parse(c.snapshot));
    montarCena();
  }
  renderizarPosicionar();
  destacar();
  atualizarStatus();
}

/** Valor inicial da distância/ângulo: o que está agora entre as entidades. */
function valorAtual(tipo: TipoPosicionamento, A: ReturnType<typeof primitivaDe>, B: ReturnType<typeof primitivaDe>): number {
  if (!A || !B) return tipo === "angulo" ? 90 : 10;
  const dir = (p: NonNullable<typeof A>) => (p.tipo === "plano" ? p.n : p.tipo === "eixo" || p.tipo === "linha" ? p.d : null);
  if (tipo === "angulo") {
    const a = dir(A), b = dir(B);
    if (!a || !b) return 90;
    const c = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
    return Math.round((Math.acos(Math.min(1, c)) * 180) / Math.PI) || 90;
  }
  if (A.tipo === "plano") {
    const v = Math.abs((B.p[0] - A.p[0]) * A.n[0] + (B.p[1] - A.p[1]) * A.n[1] + (B.p[2] - A.p[2]) * A.n[2]);
    return Math.round(v * 100) / 100 || 10;
  }
  return Math.round(Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]) * 100) / 100 || 10;
}

/** Barra rápida perto do toque: tipos possíveis + OK (como a caixinha de relações do esboço). */
function barraRapida(tipos: TipoPosicionamento[], xy: { x: number; y: number }) {
  if (comando?.tipo !== "posicionar") return;
  mostrarBarra([
    ...tipos.filter((t) => t !== "travar").map((t) => ({ rotulo: NOME_TIPO[t], icone: ICONE_TIPO[t], acao: () => definirTipo(t) })),
    { rotulo: "OK", icone: "concluir" as NomeIcone, acao: () => concluirPosicionamento(true) },
  ], xy.x, xy.y);
}

function definirTipo(t: TipoPosicionamento) {
  if (comando?.tipo !== "posicionar") return;
  comando.m.tipo = t;
  if (t === "distancia" || t === "angulo") comando.m.valor = valorAtual(t, primitivaDe(comando.sel[0]), primitivaDe(comando.sel[1]));
  previaPosicionamento();
  renderizarPosicionar();
}

/** Aplica o posicionamento provisório (a partir das posições do início) e mostra. */
function previaPosicionamento() {
  if (comando?.tipo !== "posicionar" || comando.sel.length !== 2) return;
  const c = comando;
  const base = validarMontagem(JSON.parse(c.snapshot));
  doc = base;
  const m: Posicionamento = { ...c.m, a: c.sel[0], b: c.sel[1] };
  if (m.tipo === "travar") {
    const ta = compDe(m.a!.comp)?.t ?? IDENTIDADE(), tb = compDe(m.b!.comp)?.t ?? IDENTIDADE();
    m.rel = compRel(ta, tb);
  }
  // alinhamento "auto" vira o mais próximo da posição atual (fica gravado)
  if (m.alinhamento === "auto" && m.tipo !== "travar") {
    const A = primitivaDe(m.a!), B = primitivaDe(m.b!);
    const da = A && (A.tipo === "plano" ? A.n : A.tipo !== "ponto" ? A.d : null), db = B && (B.tipo === "plano" ? B.n : B.tipo !== "ponto" ? B.d : null);
    m.alinhamento = da && db && da[0] * db[0] + da[1] * db[1] + da[2] * db[2] < 0 ? "antialinhado" : "alinhado";
    c.m.alinhamento = m.alinhamento;
  }
  if (c.editando) doc.posicionamentos = doc.posicionamentos.map((x) => (x.id === m.id ? m : x));
  else doc.posicionamentos.push(m);
  // move de preferência o componente da 1ª entidade (se ele estiver fixo, o da 2ª)
  const preferido = [c.sel[0].comp, c.sel[1].comp].find((id) => id && !compDe(id)?.fixo) ?? undefined;
  resolver({ preferido });
  montarCena();
}

function renderizarPosicionar() {
  if (comando?.tipo !== "posicionar" || !doc) return;
  const c = comando;
  const erro = c.sel.length === 2 ? solucao?.erros.get(c.m.id) : undefined;
  const p = painelBase(c.editando ? `Posicionar: ${c.m.nome}` : "Posicionar", erro);
  // seleções (campo rosa, sempre ativo)
  const s = caixa(p, "Entidades a posicionar");
  const area = document.createElement("div");
  area.className = "pc-refs rosa ativo";
  c.sel.forEach((r, i) => {
    const chip = document.createElement("span");
    chip.className = "pc-chip";
    chip.textContent = rotuloEnt(r);
    const x = document.createElement("button");
    x.className = "pc-chip-x";
    x.textContent = "×";
    x.onclick = (e) => {
      e.stopPropagation();
      c.sel.splice(i, 1);
      doc = validarMontagem(JSON.parse(c.snapshot));
      montarCena();
      renderizarPosicionar();
      destacar();
    };
    chip.append(x);
    area.append(chip);
  });
  if (!c.sel.length) area.append(Object.assign(document.createElement("span"), { className: "pc-vazio", textContent: "Toque duas entidades: faces, arestas, vértices ou planos (árvore)" }));
  s.append(area);
  // tipos (padrão)
  const possiveis = c.sel.length === 2 ? (() => {
    const A = primitivaDe(c.sel[0]), B = primitivaDe(c.sel[1]);
    return A && B ? tiposPossiveis(A, B) : [];
  })() : TIPOS;
  const t = caixa(p, "Posicionamentos padrão");
  const grade = document.createElement("div");
  grade.className = "pc-grade-tipos";
  for (const tipo of TIPOS) {
    const b = document.createElement("button");
    b.className = "pc-tipo";
    b.innerHTML = `${ICONES[ICONE_TIPO[tipo]]}<span>${NOME_TIPO[tipo]}</span>`;
    b.setAttribute("aria-pressed", String(c.m.tipo === tipo));
    b.disabled = !possiveis.includes(tipo);
    b.onclick = () => definirTipo(tipo);
    grade.append(b);
  }
  t.append(grade);
  if (c.m.tipo === "distancia" || c.m.tipo === "angulo") {
    const l = document.createElement("label");
    l.className = "campo";
    l.innerHTML = `<span class="campo-rotulo">${c.m.tipo === "distancia" ? "Distância (mm)" : "Ângulo (°)"}</span><div class="num"><button type="button">−</button><input inputmode="decimal" /><button type="button">+</button></div>`;
    const inp = l.querySelector("input")!;
    inp.value = fmt(c.m.valor ?? 0);
    const aplicar = (v: number) => {
      if (!Number.isFinite(v)) return;
      c.m.valor = Math.max(0, v);
      previaPosicionamento();
      renderizarPosicionar();
    };
    inp.onchange = () => aplicar(Number(inp.value.replace(",", ".")));
    inp.onkeydown = (e) => e.stopPropagation();
    const [menos, mais] = l.querySelectorAll("button");
    const passo = c.m.tipo === "angulo" ? 5 : 1;
    menos.onclick = () => aplicar((c.m.valor ?? 0) - passo);
    mais.onclick = () => aplicar((c.m.valor ?? 0) + passo);
    t.append(l);
    const inv = document.createElement("button");
    inv.className = "pc-inverter";
    inv.textContent = "⇅ Inverter lado";
    inv.setAttribute("aria-pressed", String(!!c.m.inverter));
    inv.onclick = () => {
      c.m.inverter = !c.m.inverter;
      previaPosicionamento();
      renderizarPosicionar();
    };
    t.append(inv);
  }
  if (c.m.tipo !== "travar" && c.m.tipo !== "concentrico" && c.m.tipo !== "tangente") {
    const al = caixa(p, "Alinhamento");
    const linha = document.createElement("div");
    linha.className = "pc-botoes";
    for (const [v, rot] of [["alinhado", "Alinhado"], ["antialinhado", "Antialinhado"]] as const) {
      const b = document.createElement("button");
      b.textContent = rot;
      b.setAttribute("aria-pressed", String(c.m.alinhamento === v));
      b.onclick = () => {
        c.m.alinhamento = v;
        previaPosicionamento();
        renderizarPosicionar();
      };
      linha.append(b);
    }
    al.append(linha);
  }
  const op = caixa(p, "Opções");
  op.innerHTML = `<label class="interruptor"><input type="checkbox" data-so ${soPosicionar ? "checked" : ""}/><span>Só para posicionar (move sem criar o posicionamento)</span></label>
    <p class="dica">O componente da 1ª entidade vai até a 2ª. ✓ cria e continua no comando para o próximo; ✕ sai.</p>`;
  op.querySelector<HTMLInputElement>("[data-so]")!.onchange = (e) => (soPosicionar = (e.target as HTMLInputElement).checked);
}

/** ✓ do posicionamento: grava (ou só move) e segue no comando para o próximo. */
function concluirPosicionamento(continuar: boolean) {
  if (comando?.tipo !== "posicionar" || !doc) return;
  const c = comando;
  if (c.sel.length !== 2) {
    fecharComando();
    return;
  }
  previaPosicionamento();
  const erro = solucao?.erros.get(c.m.id);
  const m = doc.posicionamentos.find((x) => x.id === c.m.id)!;
  if (soPosicionar && !c.editando) {
    doc.posicionamentos = doc.posicionamentos.filter((x) => x !== m);
    resolver();
  } else if (!c.editando) {
    const n = doc.posicionamentos.filter((x) => x.tipo === m.tipo).length;
    m.nome = `${NOME_TIPO[m.tipo]}${n}`;
  } else if (!/\d+$/.test(m.nome) || !m.nome.startsWith(NOME_TIPO[m.tipo])) {
    m.nome = `${NOME_TIPO[m.tipo]}${doc.posicionamentos.filter((x) => x.tipo === m.tipo).length}`;
  }
  registrarPasso();
  salvarAutosave();
  esconderBarra();
  if (erro) avisar(`${m.nome || NOME_TIPO[m.tipo]}: ${erro}`, 6000);
  else if (!soPosicionar) avisar(`${m.nome} criado.`);
  if (continuar && !c.editando) {
    comando = { tipo: "posicionar", snapshot: JSON.stringify(doc), sel: [], m: novoPosicionamento(), editando: false };
    renderizarPosicionar();
    destacar();
    renderizarArvore();
    atualizarStatus();
  } else fecharComando();
}

// ---------- padrões e espelhamento de componentes ----------

const NOME_PADRAO = { linear: "Padrão linear", circular: "Padrão circular", espelho: "Espelho" } as const;
const DIRECOES: [string, Vec3][] = [["X", [1, 0, 0]], ["Y", [0, 1, 0]], ["Z", [0, 0, 1]], ["−X", [-1, 0, 0]], ["−Y", [0, -1, 0]], ["−Z", [0, 0, -1]]];
const PLANOS_ESPELHO: [string, Vec3][] = [["Plano Frontal (XY)", [0, 0, 1]], ["Plano Superior (XZ)", [0, 1, 0]], ["Plano Lateral (YZ)", [1, 0, 0]]];

function abrirPadrao(tipo: PadraoComponentes["tipo"], existente?: PadraoComponentes) {
  if (comando) cancelarComando();
  if (!doc) return;
  const n = (doc.padroes ?? []).filter((x) => x.tipo === tipo).length + 1;
  const sementes = existente?.sementes ?? selComps.filter((id) => !compDe(id)?.padrao);
  const base = { id: novoIdM(), nome: `${NOME_PADRAO[tipo]}${n}`, sementes };
  const p: PadraoComponentes = existente ? JSON.parse(JSON.stringify(existente))
    : tipo === "linear" ? { ...base, tipo, dir: [1, 0, 0], passo: Math.round(escalaDaCena()), n: 3 }
    : tipo === "circular" ? { ...base, tipo, ponto: [0, 0, 0], eixo: [0, 1, 0], n: 4, angulo: 360 }
    : { ...base, tipo, ponto: [0, 0, 0], normal: [1, 0, 0] };
  comando = { tipo: "padrao", snapshot: JSON.stringify(doc), p, editando: !!existente, campo: sementes.length ? "ref" : "sementes", refNome: tipo === "espelho" ? "face plana" : tipo === "circular" ? "eixo (face cilíndrica ou aresta circular)" : "direção (aresta ou face)" };
  doc.padroes = [...(doc.padroes ?? []).filter((x) => x.id !== p.id), p];
  selComps = [...p.sementes];
  previaPadrao();
  mostrarPainel(true);
  renderizarAbas();
  renderizarPadrao();
  atualizarStatus();
}

function previaPadrao() {
  if (comando?.tipo !== "padrao" || !doc) return;
  // padrão sem semente sai em aplicarPadroes: o que está sendo editado volta para a lista
  const p = comando.p;
  if (!(doc.padroes ?? []).includes(p)) doc.padroes = [...(doc.padroes ?? []).filter((x) => x.id !== p.id), p];
  aplicarPadroes(doc, centrosLocais());
  montarCena();
}

function alternarNoComando(id: string) {
  if (!doc) return;
  const c = compDe(id);
  if (!c) return;
  if (comando?.tipo === "padrao") {
    const sid = c.padrao ? c.semente! : id;
    if (c.padrao === comando.p.id) return;
    const s = comando.p.sementes;
    comando.p.sementes = s.includes(sid) ? s.filter((x) => x !== sid) : [...s, sid];
    selComps = [...comando.p.sementes];
    previaPadrao();
    renderizarPadrao();
  } else if (comando?.tipo === "explodir") {
    comando.comps = comando.comps.includes(id) ? comando.comps.filter((x) => x !== id) : [...comando.comps, id];
    selComps = [...comando.comps];
    destacar();
    renderizarExplodir();
  }
  renderizarArvore();
  atualizarStatus();
}

/** Direção, eixo ou plano do padrão a partir da entidade tocada (coordenadas da montagem). */
function referenciaDoPadrao(ent: Entidade) {
  if (comando?.tipo !== "padrao" || !cena) return;
  const p = comando.p;
  const g = ent.tipo === "face" ? cena.topo.faces[ent.indice] : ent.tipo === "aresta" ? cena.topo.arestas[ent.indice] : null;
  if (!g) return;
  const ref: Referencia = ent.tipo === "face" ? { tipo: "face", ass: cena.topo.faces[ent.indice] } : { tipo: "aresta", ass: cena.topo.arestas[ent.indice] };
  const pr = primitivaLocal(ref);
  if (!pr) return avisar("Essa entidade não dá direção: toque uma aresta reta, face plana ou cilíndrica.");
  if (p.tipo === "linear") {
    const d = pr.tipo === "plano" ? pr.n : pr.tipo === "eixo" || pr.tipo === "linha" ? pr.d : null;
    if (!d) return avisar("Toque uma aresta reta ou face (a normal dela vira a direção).");
    p.dir = d;
  } else if (p.tipo === "circular") {
    if (pr.tipo !== "eixo" && pr.tipo !== "linha") return avisar("Toque uma face cilíndrica, aresta circular ou aresta reta (eixo).");
    p.eixo = pr.d;
    p.ponto = pr.p;
  } else {
    if (pr.tipo !== "plano") return avisar("Toque uma face plana (plano do espelho).");
    p.normal = pr.n;
    p.ponto = pr.p;
  }
  previaPadrao();
  renderizarPadrao();
}

function renderizarPadrao() {
  if (comando?.tipo !== "padrao") return;
  const c = comando;
  const p = c.p;
  const painel = painelBase(`${NOME_PADRAO[p.tipo]}: ${p.nome}`);
  const campo = (titulo: string, ativo: boolean, texto: string, aoTocar: () => void) => {
    const b = document.createElement("button");
    b.className = `campo-ref${ativo ? " ativo" : ""}`;
    b.innerHTML = `<small></small><span></span>`;
    b.querySelector("small")!.textContent = titulo;
    b.querySelector("span")!.textContent = texto;
    b.onclick = aoTocar;
    return b;
  };
  const cS = caixa(painel, "Componentes a repetir");
  cS.append(campo("Sementes (toque no modelo)", c.campo === "sementes", p.sementes.length ? p.sementes.map(nomeComp).join(", ") : "nenhum", () => {
    c.campo = "sementes";
    renderizarPadrao();
    atualizarStatus();
  }));
  const num = (rot: string, valor: number, un: string, f: (v: number) => void, min = -1e9) => {
    const l = document.createElement("label");
    l.className = "campo";
    l.innerHTML = `<span></span><input type="number" step="any" inputmode="decimal" />`;
    l.querySelector("span")!.textContent = `${rot}${un ? ` (${un})` : ""}`;
    const i = l.querySelector("input")!;
    i.value = String(Math.round(valor * 1000) / 1000);
    i.onchange = () => {
      const v = Number(i.value.replace(",", "."));
      if (!Number.isFinite(v) || v < min) return avisar("Valor inválido.");
      f(v);
      previaPadrao();
      renderizarPadrao();
    };
    return l;
  };
  const botoesDir = (atual: Vec3, f: (v: Vec3) => void, lista = DIRECOES) => {
    const g = document.createElement("div");
    g.className = "pc-botoes";
    for (const [r, v] of lista) {
      const b = document.createElement("button");
      b.textContent = r;
      b.setAttribute("aria-pressed", String(v.every((x, k) => Math.abs(x - atual[k]) < 1e-9)));
      b.onclick = () => {
        f(v);
        previaPadrao();
        renderizarPadrao();
      };
      g.append(b);
    }
    return g;
  };
  const cR = caixa(painel, p.tipo === "linear" ? "Direção 1" : p.tipo === "circular" ? "Eixo" : "Plano do espelho");
  const fmtV = (v: Vec3) => v.map((x) => fmt(x)).join("; ");
  cR.append(campo(p.tipo === "linear" ? "Direção (ou toque aresta/face)" : p.tipo === "circular" ? "Eixo (ou toque face cilíndrica/aresta)" : "Plano (ou toque face plana)", c.campo === "ref",
    p.tipo === "linear" ? fmtV(p.dir) : p.tipo === "circular" ? `${fmtV(p.eixo)} por ${fmtV(p.ponto)}` : `normal ${fmtV(p.normal)} por ${fmtV(p.ponto)}`, () => {
      c.campo = "ref";
      renderizarPadrao();
      atualizarStatus();
    }));
  if (p.tipo === "linear") {
    cR.append(botoesDir(p.dir, (v) => (p.dir = v)));
    cR.append(num("Espaçamento", p.passo, "mm", (v) => (p.passo = v)), num("Instâncias (com a semente)", p.n, "", (v) => (p.n = Math.max(1, Math.round(v))), 1));
    const c2 = caixa(painel, "Direção 2");
    const usa = document.createElement("label");
    usa.className = "interruptor";
    usa.innerHTML = `<input type="checkbox" ${p.dir2 ? "checked" : ""}/><span>Usar direção 2</span>`;
    usa.querySelector("input")!.onchange = (ev) => {
      if ((ev.target as HTMLInputElement).checked) Object.assign(p, { dir2: [0, 0, 1] as Vec3, passo2: p.passo, n2: 2 });
      else delete p.dir2;
      previaPadrao();
      renderizarPadrao();
    };
    c2.append(usa);
    if (p.dir2) c2.append(botoesDir(p.dir2, (v) => (p.dir2 = v)), num("Espaçamento", p.passo2 ?? 0, "mm", (v) => (p.passo2 = v)), num("Instâncias", p.n2 ?? 1, "", (v) => (p.n2 = Math.max(1, Math.round(v))), 1));
  } else if (p.tipo === "circular") {
    cR.append(botoesDir(p.eixo, (v) => {
      p.eixo = v;
      p.ponto = [0, 0, 0];
    }, DIRECOES.slice(0, 3)));
    cR.append(num("Instâncias (com a semente)", p.n, "", (v) => (p.n = Math.max(1, Math.round(v))), 1), num("Ângulo total", p.angulo, "°", (v) => (p.angulo = v)));
    cR.append(Object.assign(document.createElement("p"), { className: "dica", textContent: "360° = instâncias igualmente espaçadas na volta toda." }));
  } else {
    cR.append(botoesDir(p.normal, (v) => {
      p.normal = v;
      p.ponto = [0, 0, 0];
    }, PLANOS_ESPELHO));
    cR.append(Object.assign(document.createElement("p"), { className: "dica", textContent: "A cópia fica na posição espelhada com a mesma orientação (peças simétricas). Versão oposta de peça não simétrica: em breve." }));
  }
  const n = doc!.componentes.filter((x) => x.padrao === p.id).length;
  painel.append(Object.assign(document.createElement("p"), { className: "dica", textContent: `${n} cópia(s). As cópias seguem a semente: mova ou posicione só a semente.` }));
}

function concluirPadrao() {
  if (comando?.tipo !== "padrao" || !doc) return;
  if (!comando.p.sementes.length) return avisar("Toque pelo menos um componente para repetir.");
  const nome = comando.p.nome;
  fecharComando();
  selComps = [];
  resolver();
  alterou(true);
  avisar(`${nome} pronto.`);
}

function acoesDoPadrao(p: PadraoComponentes): AcaoContexto[] {
  return [
    { rotulo: "Editar", icone: p.tipo === "linear" ? "padraoComponentes" : p.tipo === "circular" ? "padraoCircular" : "espelhar", acao: () => abrirPadrao(p.tipo, p) },
    { rotulo: p.suprimido ? "Reativar" : "Suprimir", icone: "olhoFechado", acao: () => {
      p.suprimido = !p.suprimido;
      resolver();
      alterou(true);
    } },
    { rotulo: "Excluir", icone: "fechar", acao: () => {
      excluirPadrao(doc!, p.id);
      selComps = [];
      resolver();
      alterou();
    } },
  ];
}

// ---------- vista explodida ----------

function alternarExplosao() {
  if (!doc) return;
  if (!doc.explosao?.length) return abrirExplodir();
  mostrarExplodida = !mostrarExplodida;
  montarCena();
  renderizarArvore();
  renderizarAbas();
}

function abrirExplodir() {
  if (comando) cancelarComando();
  if (!doc) return;
  comando = { tipo: "explodir", snapshot: JSON.stringify(doc), comps: selComps.filter((id) => compDe(id)), dir: [0, 1, 0], dist: Math.round(escalaDaCena() * 0.6), fator: 1 };
  mostrarExplodida = true;
  montarCena();
  mostrarPainel(true);
  renderizarAbas();
  renderizarExplodir();
  atualizarStatus();
}

function renderizarExplodir() {
  if (comando?.tipo !== "explodir" || !doc) return;
  const c = comando;
  const painel = painelBase("Vista explodida");
  const auto = caixa(painel, "Explosão automática");
  auto.innerHTML = `<label class="campo"><span>Afastamento (× distância ao centro)</span><input type="number" step="0.25" min="0.25" data-f /></label>
    <button class="largo destaque" data-b="auto">Explodir todos</button>`;
  auto.querySelector<HTMLInputElement>("[data-f]")!.value = String(c.fator);
  auto.querySelector<HTMLInputElement>("[data-f]")!.onchange = (e) => (c.fator = Math.max(0.1, Number((e.target as HTMLInputElement).value.replace(",", ".")) || 1));
  auto.querySelector<HTMLButtonElement>('[data-b="auto"]')!.onclick = () => {
    doc!.explosao = explosaoAutomatica(doc!, centrosDosComponentes(), c.fator);
    mostrarExplodida = true;
    montarCena();
    renderizarExplodir();
  };
  const man = caixa(painel, "Novo passo");
  man.innerHTML = `<p class="dica">${c.comps.length ? escapar(c.comps.map(nomeComp).join(", ")) : "Toque os componentes do passo no modelo."}</p><div class="pc-botoes" data-dir></div>
    <label class="campo"><span>Distância (mm)</span><input type="number" step="any" data-d /></label>
    <button class="largo" data-b="add">Adicionar passo</button>`;
  const gd = man.querySelector<HTMLElement>("[data-dir]")!;
  for (const [r, v] of DIRECOES) {
    const b = document.createElement("button");
    b.textContent = r;
    b.setAttribute("aria-pressed", String(v.every((x, k) => x === c.dir[k])));
    b.onclick = () => {
      c.dir = v;
      renderizarExplodir();
    };
    gd.append(b);
  }
  const di = man.querySelector<HTMLInputElement>("[data-d]")!;
  di.value = String(c.dist);
  di.onchange = () => (c.dist = Number(di.value.replace(",", ".")) || 0);
  man.querySelector<HTMLButtonElement>('[data-b="add"]')!.onclick = () => {
    if (!c.comps.length) return avisar("Toque os componentes do passo no modelo.");
    doc!.explosao = [...(doc!.explosao ?? []), { id: novoIdM(), comps: [...c.comps], dir: c.dir, dist: c.dist }];
    c.comps = [];
    selComps = [];
    mostrarExplodida = true;
    montarCena();
    renderizarExplodir();
  };
  const lista = caixa(painel, `Passos (${doc.explosao?.length ?? 0})`);
  (doc.explosao ?? []).forEach((s, i) => {
    const l = document.createElement("div");
    l.className = "pc-passo";
    l.innerHTML = `<span></span><button title="Excluir passo">✕</button>`;
    l.querySelector("span")!.textContent = `${i + 1}. ${s.comps.map(nomeComp).join(", ")} · ${fmt(s.dist)} mm`;
    l.querySelector("button")!.onclick = () => {
      doc!.explosao = doc!.explosao!.filter((x) => x !== s);
      montarCena();
      renderizarExplodir();
    };
    lista.append(l);
  });
  if (!doc.explosao?.length) lista.append(Object.assign(document.createElement("p"), { className: "dica", textContent: "Nenhum passo ainda." }));
}

// ---------- interferência, massa, medir ----------

/** Pedidos ao kernel que usam os sólidos guardados: se o kernel recarregou, recalcula e tenta de novo. */
async function comSolidos<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (!/não calculada/.test((e as Error).message)) throw e;
    malhas.clear();
    await atualizarCena();
    return f();
  }
}

const itensKernel = (cs: ComponenteMontagem[]) => cs.map((c) => ({ comp: c.id, chave: chaveDe(pecaDe(c)), t: c.t }));

async function verificarInterferencia() {
  if (!doc) return;
  const cs = doc.componentes.filter((c) => !c.suprimido && malhas.has(chaveDe(pecaDe(c))));
  if (cs.length < 2) return avisar("A verificação precisa de pelo menos dois componentes.");
  atualizarStatus("Verificando interferências…");
  let r: { a: string; b: string; volume: number }[];
  try {
    r = await comSolidos(() => kernel.interferencia(itensKernel(cs)));
  } catch (e) {
    atualizarStatus();
    return avisar(`Não foi possível verificar: ${(e as Error).message}`);
  }
  atualizarStatus();
  abrirJanela("Interferências", r.length
    ? `<p>${r.length} interferência(s) entre ${cs.length} componentes (faces só encostadas não contam).</p>
      <table class="tabela"><thead><tr><th>Componentes</th><th>Volume (mm³)</th></tr></thead><tbody>${r.map((x, i) => `<tr data-i="${i}" class="clicavel"><td>${escapar(nomeComp(x.a))} × ${escapar(nomeComp(x.b))}</td><td>${fmt(x.volume)}</td></tr>`).join("")}</tbody></table>
      <p class="dica">Toque uma linha para destacar o par.</p>`
    : `<p>Nenhuma interferência entre os ${cs.length} componentes.</p>`, true);
  $("janela-corpo").querySelectorAll<HTMLElement>("[data-i]").forEach((tr) => (tr.onclick = () => {
    const x = r[Number(tr.dataset.i)];
    selComps = [x.a, x.b];
    destacar();
    renderizarArvore();
  }));
}

async function mostrarMassa() {
  if (!doc) return;
  const cs = doc.componentes.filter((c) => !c.suprimido && malhas.has(chaveDe(pecaDe(c))));
  if (!cs.length) return avisar("A montagem não tem componentes calculados.");
  atualizarStatus("Calculando massa…");
  let mp: Awaited<ReturnType<typeof kernel.massaPecas>>;
  try {
    mp = await comSolidos(() => kernel.massaPecas([...new Set(cs.map((c) => chaveDe(pecaDe(c))))]));
  } catch (e) {
    atualizarStatus();
    return avisar(`Não foi possível calcular: ${(e as Error).message}`);
  }
  atualizarStatus();
  const semMaterial = new Set<string>();
  const itens = cs.flatMap((c) => {
    const p = pecaDe(c);
    const m = mp[chaveDe(p)];
    if (!m) return [];
    const mat = p.doc.material ? MATERIAIS[p.doc.material] : undefined;
    if (!mat) semMaterial.add(p.nome);
    return [{ m: { ...m, densidade: mat?.densidade ?? 1 }, t: c.t }];
  });
  const r = massaDaMontagem(itens);
  const n = (v: number, c = 3) => v.toLocaleString("pt-BR", { maximumFractionDigits: c });
  abrirJanela("Propriedades de massa da montagem", `<table class="tabela"><tbody>
    <tr><td>Massa</td><td>${r.massa >= 1000 ? `${n(r.massa / 1000)} kg` : `${n(r.massa, 2)} g`}</td></tr>
    <tr><td>Volume</td><td>${n(r.volume, 1)} mm³</td></tr>
    <tr><td>Área de superfície</td><td>${n(r.area, 1)} mm²</td></tr>
    <tr><td>Centro de massa (X; Y; Z)</td><td>${r.centro.map((v) => n(v)).join("; ")} mm</td></tr>
    <tr><td>Componentes</td><td>${itens.length}</td></tr></tbody></table>
    ${semMaterial.size ? `<p class="dica">Sem material (densidade 1 g/cm³ usada): ${escapar([...semMaterial].join(", "))}. Defina o material na peça (☰ → Material).</p>` : ""}`);
}

function abrirMedir() {
  if (comando) cancelarComando();
  comando = { tipo: "medir", sel: [], linhas: [] };
  mostrarPainel(true);
  renderizarAbas();
  renderizarMedir();
  atualizarStatus();
}

async function adicionarMedida(ent: Entidade) {
  if (comando?.tipo !== "medir" || !cena || !doc) return;
  const c = comando;
  const ref: Referencia | null = ent.tipo === "face" ? { tipo: "face", ass: cena.topo.faces[ent.indice] }
    : ent.tipo === "aresta" ? { tipo: "aresta", ass: cena.topo.arestas[ent.indice] }
    : { tipo: "vertice", p: cena.topo.vertices[ent.indice] };
  const l = localDaEntidade(cena.mapa, ent.tipo, ent.indice);
  const nome = `${{ face: "Face", aresta: "Aresta", vertice: "Vértice" }[ent.tipo]} de ${nomeComp(l?.comp ?? null)}`;
  const i = c.sel.findIndex((s) => s.ent.tipo === ent.tipo && s.ent.indice === ent.indice);
  if (i >= 0) c.sel.splice(i, 1);
  else c.sel = [...c.sel.slice(-1), { ref, nome, ent }];
  destacar();
  c.linhas = [];
  renderizarMedir();
  if (!c.sel.length) return;
  // só os componentes das entidades (a medida é exata no B-Rep)
  const comps = [...new Set(c.sel.map((s) => localDaEntidade(cena!.mapa, s.ent.tipo, s.ent.indice)?.comp).filter((x): x is string => !!x))].map((id) => compDe(id)!);
  try {
    const r = await comSolidos(() => kernel.medirMontagem(itensKernel(comps).map(({ chave, t }) => ({ chave, t })), c.sel.map((s) => s.ref)));
    if (comando !== c) return;
    c.linhas = r.linhas;
  } catch (e) {
    c.linhas = [{ rotulo: "Erro", valor: (e as Error).message }];
  }
  renderizarMedir();
}

function renderizarMedir() {
  if (comando?.tipo !== "medir") return;
  const c = comando;
  const p = painelBase("Medir");
  const s = caixa(p, "Seleção");
  s.innerHTML = c.sel.length ? c.sel.map((x) => `<p>${escapar(x.nome)}</p>`).join("") : `<p class="dica">Toque uma ou duas entidades (faces, arestas, vértices) de qualquer componente.</p>`;
  const r = caixa(p, "Resultado");
  r.innerHTML = c.linhas.length ? `<table class="tabela"><tbody>${c.linhas.map((l) => `<tr><td>${escapar(l.rotulo)}</td><td>${escapar(l.valor)}</td></tr>`).join("")}</tbody></table>` : `<p class="dica">${c.sel.length ? "Medindo…" : "—"}</p>`;
}

// ---------- lista de materiais ----------

async function linhasLista(): Promise<{ item: number; codigo: string; descricao: string; material: string; qtd: number; nome: string }[]> {
  const out: { item: number; codigo: string; descricao: string; material: string; qtd: number; nome: string }[] = [];
  let item = 0;
  for (const { peca, qtd } of quantidades(doc!)) {
    let cartao: Record<string, string> = {};
    if (peca.arquivo) cartao = (await lerDoCofre(peca.arquivo).catch(() => null))?.arquivo.cartao ?? {};
    const mat = peca.doc.material ? MATERIAIS[peca.doc.material]?.nome : undefined;
    out.push({ item: ++item, nome: peca.nome, codigo: cartao.codigo ?? "", descricao: cartao.descricao || peca.nome, material: mat ?? cartao.material ?? "", qtd });
  }
  return out;
}

async function mostrarListaMateriais() {
  if (!doc) return;
  const linhas = await linhasLista();
  abrirJanela("Lista de materiais (nível superior)", linhas.length
    ? `<table class="tabela"><thead><tr><th>ITEM</th><th>CÓDIGO</th><th>DESCRIÇÃO</th><th>MATERIAL</th><th>QTD</th></tr></thead><tbody>${linhas.map((l) => `<tr><td>${l.item}</td><td>${escapar(l.codigo)}</td><td>${escapar(l.descricao)}</td><td>${escapar(l.material)}</td><td>${l.qtd}</td></tr>`).join("")}</tbody></table>
      <p class="dica">Código e descrição vêm do cartão de dados do cofre (WJPDM). Na Fase de Desenho a mesma lista vira a tabela com balões.</p>
      <div class="pc-botoes"><button data-b="csv" class="destaque">Exportar CSV</button></div>`
    : `<p>A montagem ainda não tem componentes.</p>`, true);
  $("janela-corpo").querySelector<HTMLElement>('[data-b="csv"]')?.addEventListener("click", () => {
    const csv = ["ITEM;CÓDIGO;DESCRIÇÃO;MATERIAL;QTD", ...linhas.map((l) => [l.item, l.codigo, l.descricao, l.material, l.qtd].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";"))].join("\r\n");
    baixar(new Blob(["﻿" + csv], { type: "text/csv" }), `${doc!.nome} - lista de materiais.csv`);
  });
}
$("janela-fechar").onclick = fecharJanela;

// ---------- arquivo ----------

/** Salva no cofre (GO-OUT no dispositivo) com as referências da montagem (tabela do WJPDM). */
function salvar(): Promise<string> {
  if (!doc) return Promise.resolve("Nada a salvar.");
  const d = doc;
  const dados = new Blob([JSON.stringify(d)], { type: "application/octet-stream" });
  const referencias = quantidades(d).filter((x) => x.peca.arquivo).map((x) => ({ filho: x.peca.arquivo!, tipo: "componente" as const, quantidade: x.qtd }));
  avisar("Salvando no cofre…");
  const p = salvarNoCofre("asm", `${d.nome}.wjasm`, dados, (nome) => {
    d.nome = nome;
    $<HTMLInputElement>("nome-doc").value = nome;
    salvarAutosave();
    renderizarArvore();
  }, { referencias, modelo: { tipo: "montagem" } });
  p.then((m) => avisar(m, 6000), (e) => avisar(`Não foi possível salvar: ${(e as Error).message}`));
  return p;
}

function abrirMontagem(d: DocumentoMontagem) {
  if (comando) fecharComando();
  doc = d;
  selComps = [];
  selMate = null;
  isolados = null;
  historico.length = 0;
  refazer.length = 0;
  $<HTMLInputElement>("nome-doc").value = d.nome;
  atualizarAreaDeTrabalho();
  registrarPasso();
  salvarAutosave();
  renderizarAbas();
  renderizarArvore();
  void (async () => {
    await atualizarDoCofre();
    await atualizarCena(true);
    resolver();
    montarCena();
    renderizarArvore();
    atualizarStatus();
  })();
}

/** Peças que vieram do cofre e mudaram lá (GO-IN, cópia de trabalho): atualiza a cópia embutida. */
async function atualizarDoCofre() {
  if (!doc) return;
  const mudaram: string[] = [];
  for (const p of [...doc.pecas]) {
    if (!p.arquivo) continue;
    const r = await lerDoCofre(p.arquivo).catch(() => null);
    if (!r) continue;
    try {
      const nova = validarDocumento(JSON.parse(r.texto));
      const marca = marcaDe(`${JSON.stringify(nova.features)}|${nova.material ?? ""}`);
      if (marca !== p.marca) {
        embutirPeca(doc, nova, { arquivo: p.arquivo, versao: r.versao });
        mudaram.push(p.nome);
      }
    } catch {
      /* conteúdo inválido no cofre: fica a cópia embutida */
    }
  }
  if (mudaram.length) {
    salvarAutosave();
    avisar(`Atualizado do cofre: ${mudaram.join(", ")}.`, 5000);
  }
}

function novaMontagem(abrirInserirLogo = true) {
  if (doc?.componentes.length && !confirm("Fechar a montagem atual e começar uma nova? (o que não foi salvo no cofre se perde)")) return;
  desligar("asm");
  abrirMontagem(montagemVazia(`Montagem${Math.floor(Math.random() * 90) + 10}`));
  if (abrirInserirLogo) abrirInserir();
}

/** Novo documento: Peça e Desenho abrem as páginas deles. */
function abrirNovo() {
  abrirPopover($("btn-menu"), [
    { rotulo: "Peça", icone: "peca", acao: () => (location.href = new URL(`${RAIZ}cad/#novo`, location.href).href) },
    { rotulo: "Montagem", icone: "montagem", acao: () => novaMontagem() },
    { rotulo: "Desenho", icone: "desenho", acao: () => (location.href = new URL(`${RAIZ}cad/desenho/#novo`, location.href).href) },
  ]);
}

function fecharMontagem() {
  if (!doc) return;
  if (!confirm("Fechar a montagem? (o que não foi salvo no cofre se perde)")) return;
  if (comando) fecharComando();
  doc = null;
  cena = null;
  viewport.mostrarMalha(null);
  atualizarAreaDeTrabalho();
  atualizarStatus();
}

// ---------- menu, ações rápidas ----------

const ACOES: Record<string, { rotulo: string; icone: NomeIcone; fazer: () => void; doc?: boolean }> = {
  novo: { rotulo: "Novo…", icone: "nova", fazer: abrirNovo },
  abrirCofre: { rotulo: "Abrir do cofre (WJPDM)…", icone: "pasta", fazer: () => void abrirDoCofre("asm") },
  abrir: { rotulo: "Abrir arquivo do aparelho (.wjasm)…", icone: "abrir", fazer: () => $<HTMLInputElement>("arquivo").click() },
  salvar: { rotulo: "Salvar (.wjasm)", icone: "salvar", fazer: () => void salvar(), doc: true },
  fechar: { rotulo: "Fechar montagem", icone: "fechar", fazer: fecharMontagem, doc: true },
  desenho: { rotulo: "Criar desenho desta montagem", icone: "desenho", fazer: () => {
    salvarAutosave();
    location.href = new URL(`${RAIZ}cad/desenho/#de-montagem`, location.href).href;
  }, doc: true },
  locais: { rotulo: "Cópias do cofre (pendrive, Drive, dispositivo)…", icone: "pasta", fazer: () => void abrirCopias() },
  atalhos: { rotulo: "Atalhos", icone: "menu", fazer: () => abrirJanela("Atalhos da montagem", `<table class="tabela"><tbody>${[
    ["I", "Inserir componentes"], ["M", "Posicionar"], ["Delete", "Excluir componente/posicionamento selecionado"], ["H", "Ocultar/mostrar o selecionado"],
    ["F", "Ampliar para caber"], ["Ctrl+1…7", "Vistas padrão"], ["Ctrl+Z / Ctrl+Y / Ctrl+S", "Desfazer / Refazer / Salvar"], ["Enter / Esc", "OK / Cancelar no comando"],
    ["Mouse: meio / roda / direito", "Girar / aproximar / menu"], ["Toque: 1 dedo / 2 dedos", "Girar / aproximar e arrastar"],
  ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</tbody></table>`) },
};

function montarMenu() {
  const menu = $("menu-arquivo");
  menu.innerHTML = "";
  const titulo = (t: string) => menu.append(Object.assign(document.createElement("span"), { className: "menu-titulo", textContent: t }));
  const item = (k: string) => {
    const a = ACOES[k];
    const b = document.createElement("button");
    b.role = "menuitem";
    b.innerHTML = `${ICONES[a.icone]}<span>${a.rotulo}</span>`;
    if (a.doc) b.dataset.requerDoc = "";
    b.onclick = () => {
      fecharMenu();
      a.fazer();
    };
    menu.append(b);
  };
  titulo("Arquivo");
  ["novo", "abrirCofre", "abrir", "salvar", "desenho", "fechar"].forEach(item);
  titulo("Ferramentas");
  item("locais");
  titulo("Ajuda");
  item("atalhos");
  const rap = $("rapidas");
  rap.innerHTML = "";
  for (const [k, t] of [["novo", "Novo"], ["abrirCofre", "Abrir do cofre"], ["salvar", "Salvar (Ctrl+S)"]] as const) {
    const b = document.createElement("button");
    b.className = "btn-ic";
    b.title = t;
    b.innerHTML = ICONES[ACOES[k].icone];
    if (ACOES[k].doc) b.dataset.requerDoc = "";
    b.onclick = ACOES[k].fazer;
    rap.append(b);
  }
  rap.append(Object.assign(document.createElement("span"), { className: "sep" }));
  for (const [ic, t, f] of [["desfazer", "Desfazer (Ctrl+Z)", desfazer], ["refazer", "Refazer (Ctrl+Y)", refazerPasso]] as const) {
    const b = document.createElement("button");
    b.className = "btn-ic";
    b.title = t;
    b.dataset.requerDoc = "";
    b.innerHTML = ICONES[ic];
    b.onclick = f;
    rap.append(b);
  }
}
function fecharMenu() {
  $("menu-arquivo").hidden = true;
  $("btn-menu").setAttribute("aria-expanded", "false");
}
$("btn-menu").innerHTML = ICONES.menu;
$("btn-menu").onclick = () => {
  const m = $("menu-arquivo");
  m.hidden = !m.hidden;
  $("btn-menu").setAttribute("aria-expanded", String(!m.hidden));
};
$("btn-lateral").innerHTML = ICONES.arvore;
$("btn-lateral").onclick = () => document.body.classList.toggle("lateral-aberta");
instalarFecharAoTocarFora(fecharMenu);

const nomeDoc = $<HTMLInputElement>("nome-doc");
nomeDoc.onchange = () => {
  if (!doc) return;
  doc.nome = nomeDoc.value.trim() || "Montagem";
  nomeDoc.value = doc.nome;
  alterou();
};

// ---------- barra de vistas ----------

const VISTAS: [Vista, string][] = [["frontal", "Frontal"], ["traseira", "Posterior"], ["esquerda", "Esquerda"], ["direita", "Direita"], ["superior", "Superior"], ["inferior", "Inferior"], ["iso", "Isométrica"]];
function renderizarBarraVistas() {
  const barra = $("barra-vistas");
  barra.innerHTML = "";
  barra.classList.add("aberta");
  const caixaV = document.createElement("div");
  caixaV.className = "caixa-vistas";
  const botao = (icone: NomeIcone, titulo: string, acao: (b: HTMLButtonElement) => void) => {
    const b = document.createElement("button");
    b.className = "btn-ic";
    b.title = titulo;
    b.setAttribute("aria-label", titulo);
    b.innerHTML = ICONES[icone];
    b.onclick = () => acao(b);
    caixaV.append(b);
  };
  botao("enquadrar", "Ampliar para caber (F)", () => viewport.enquadrar());
  botao("vistas", "Orientação da vista", (b) => abrirPopover(b, VISTAS.map(([v, r]) => ({ rotulo: r, acao: () => viewport.definirVista(v) }))));
  botao("configVista", "Estilo de exibição", (b) => abrirPopover(b, [
    { rotulo: "Sombreado com arestas", icone: "estiloSombreadoArestas", acao: () => viewport.definirEstilo("sombreado-arestas") },
    { rotulo: "Sombreado", icone: "estiloSombreado", acao: () => viewport.definirEstilo("sombreado") },
    { rotulo: "Arestas", icone: "estiloArestas", acao: () => viewport.definirEstilo("arestas") },
  ]));
  barra.append(caixaV);
}

// ---------- área de trabalho ----------

function atualizarAreaDeTrabalho() {
  const aberto = !!doc;
  document.body.classList.toggle("sem-documento", !aberto);
  $("tela-inicial").hidden = aberto;
  if (aberto) return;
  $("ti-novo").innerHTML = `${ICONES.montagem}<span>Nova montagem</span>`;
  $("ti-abrir").innerHTML = `${ICONES.pasta}<span>Abrir do cofre…</span>`;
  $("ti-novo").onclick = () => novaMontagem();
  $("ti-abrir").onclick = () => void abrirDoCofre("asm");
  const rec = $("ti-recentes");
  rec.innerHTML = "";
  let ultima: DocumentoMontagem | null = null;
  try {
    ultima = validarMontagem(JSON.parse(localStorage.getItem(CHAVE) ?? "null"));
  } catch {
    ultima = null;
  }
  rec.append(Object.assign(document.createElement("h3"), { textContent: "Recentes" }));
  if (ultima) {
    const b = document.createElement("button");
    b.innerHTML = `${ICONES.montagem}<span></span><small>última montagem</small>`;
    b.querySelector("span")!.textContent = ultima.nome;
    const u = ultima;
    b.onclick = () => abrirMontagem(u);
    rec.append(b);
  }
  const voltar = document.createElement("button");
  voltar.innerHTML = `${ICONES.peca}<span>Ambiente de Peça</span><small>WJCAD</small>`;
  voltar.onclick = () => (location.href = new URL(`${RAIZ}cad/`, location.href).href);
  rec.append(voltar);
}

// ---------- teclado ----------

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, select, textarea")) return;
  if (!doc) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && /^[1-7]$/.test(e.key)) viewport.definirVista(VISTAS[Number(e.key) - 1][0]);
  else if (ctrl && k === "z" && !e.shiftKey) desfazer();
  else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) refazerPasso();
  else if (ctrl && k === "s") void salvar();
  else if (e.key === "Enter" && comando) confirmarComando();
  else if (e.key === "Escape") {
    if (comando) cancelarComando();
    else {
      selComps = [];
      selMate = null;
      esconderBarra();
      destacar();
      renderizarArvore();
    }
  } else if (ctrl) return;
  else if (k === "f") viewport.enquadrar();
  else if (k === "i" && !comando) abrirInserir();
  else if (k === "m" && !comando) abrirPosicionar();
  else if (k === "h" && selComps.length) ocultar(selComps.map(compDe).filter((c): c is ComponenteMontagem => !!c));
  else if (e.key === "Delete" && !comando) {
    if (selMate) {
      const m = doc.posicionamentos.find((x) => x.id === selMate);
      if (m) acoesDoPosicionamento(m).find((a) => a.rotulo === "Excluir")?.acao();
    } else excluirSelecao();
  } else return;
  e.preventDefault();
});

// ---------- início ----------

montarMenu();
renderizarAbas();
renderizarBarraVistas();
// montagem aberta a partir de um desenho: botão para voltar a ele
if (sessionStorage.getItem("wjcad:voltarDesenho")) {
  const b = document.createElement("button");
  b.className = "btn-ic btn-voltar";
  b.title = "Voltar ao desenho (salve a montagem antes: as vistas se atualizam do cofre)";
  b.innerHTML = `${ICONES.desenho}<span>Desenho</span>`;
  b.onclick = () => (location.href = new URL(`${RAIZ}cad/desenho/#abrir-autosave`, location.href).href);
  $("rapidas").prepend(b);
}
instalarPainelCofre("asm", salvar);
void sincronizarAoAbrir(kernel.pronto)?.catch(() => {});
{
  let inicial: DocumentoMontagem | null = null;
  try {
    inicial = validarMontagem(JSON.parse(localStorage.getItem(CHAVE) ?? "null"));
  } catch {
    inicial = null;
  }
  const hash = location.hash;
  if (hash) history.replaceState(null, "", location.pathname + location.search);
  if (hash === "#novo") novaMontagem();
  else if (hash === "#abrir-autosave" && inicial) abrirMontagem(inicial);
  else if (inicial && vinculo("asm")) abrirMontagem(inicial); // volta da peça: continua a montagem
  else atualizarAreaDeTrabalho();

}

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__asm = { doc: () => doc, viewport, cena: () => cena, abrir: (d: unknown) => abrirMontagem(validarMontagem(d)), solucao: () => solucao };
