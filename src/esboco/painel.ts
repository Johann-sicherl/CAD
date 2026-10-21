// Painel lateral durante a edição de um esboço: estado de definição, opções da ferramenta,
// seleção (relações, construção, exclusão) e saída do esboço.

import { ehCota, type RestricaoEsboco } from "../model";
import { textoCota } from "./cotas";
import { EIXO_H, EIXO_V, ORIGEM } from "./geometria";
import { avaliar, ROTULO_FERRAMENTA, type EditorEsboco } from "./editor";

const NOME_RELACAO: Record<string, string> = {
  coincidente: "Coincidente", horizontal: "Horizontal", vertical: "Vertical", paralelo: "Paralelo",
  perpendicular: "Perpendicular", colinear: "Colinear", tangente: "Tangente", igual: "Igual",
  concentrico: "Concêntrico", pontoMedio: "Ponto médio", simetrico: "Simétrico", fixo: "Fixo",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function botao(texto: string, acao: () => void, cls = ""): HTMLButtonElement {
  const b = el("button", cls, texto);
  b.type = "button";
  b.onclick = acao;
  return b;
}

function interruptor(rotulo: string, valor: boolean, mudar: (v: boolean) => void): HTMLElement {
  const l = el("label", "interruptor");
  const c = el("input");
  c.type = "checkbox";
  c.checked = valor;
  c.onchange = () => mudar(c.checked);
  l.append(c, el("span", "", rotulo));
  return l;
}

function campoNumero(rotulo: string, valor: number, unidade: string, mudar: (v: number) => void): HTMLElement {
  const l = el("label", "campo");
  l.append(el("span", "campo-rotulo", rotulo));
  const g = el("div", "num");
  const inp = el("input");
  inp.inputMode = "decimal";
  inp.value = String(valor);
  inp.onchange = () => {
    const v = avaliar(inp.value);
    if (Number.isFinite(v)) mudar(v);
  };
  g.append(inp, el("span", "unidade", unidade));
  l.append(g);
  return l;
}

export function renderizarPainelEsboco(
  painel: HTMLElement,
  ed: EditorEsboco,
  sair: () => void,
  renomear: (nome: string) => void,
  abrirRelacoes: (ancora: HTMLElement) => void,
) {
  painel.innerHTML = "";
  painel.classList.remove("vazio");
  const esb = ed.esb;

  const cab = el("div", "prop-cabecalho");
  cab.append(el("span", "prop-tipo", "Editando esboço"));
  const nome = el("input", "prop-nome");
  nome.value = esb.nome;
  nome.onchange = () => renomear(nome.value.trim() || esb.nome);
  cab.append(nome);
  painel.append(cab);

  const def = el("div", `definicao ${esb.geos.length ? ed.estado.definicao : "vazio"}`, ed.textoDefinicao);
  painel.append(def);
  if (ed.estado.definicao === "superdefinido") {
    painel.append(botao("Excluir relações em conflito", () => ed.excluirConflitos(), "perigo largo"));
  }

  // ferramenta
  painel.append(el("h3", "prop-titulo", ROTULO_FERRAMENTA[ed.ferramenta]));
  painel.append(el("p", "dica", ed.instrucao));
  if (ed.ferramenta === "poligono") {
    painel.append(campoNumero("Nº de lados", ed.lados, "", (v) => (ed.lados = Math.max(3, Math.min(64, Math.round(v))))));
  }
  if (ed.ferramenta === "offset") {
    painel.append(campoNumero("Distância", ed.distOffset, "mm", (v) => (ed.distOffset = Math.abs(v))));
    const linha = el("div", "prop-rodape");
    linha.append(botao("Aplicar", () => ed.aplicarOffset(false), "destaque"), botao("Lado oposto", () => ed.aplicarOffset(true)));
    painel.append(linha);
  }
  if (ed.ferramenta === "spline") {
    painel.append(botao("Concluir curva", () => ed.concluirSpline(), "largo"));
  }
  if (!["selecionar", "aparar", "offset", "espelhar", "cota"].includes(ed.ferramenta)) {
    painel.append(interruptor("Geometria de construção", ed.construcao, (v) => (ed.construcao = v)));
  }

  // seleção
  const sel = [...ed.selecao];
  if (sel.length) {
    painel.append(el("h3", "prop-titulo", `Seleção (${sel.length})`));
    const acoes = el("div", "prop-rodape coluna");
    const rel = botao("Adicionar relação…", () => abrirRelacoes(rel));
    rel.disabled = !ed.relacoesPossiveis().length;
    acoes.append(rel);
    if (ed.geosSelecionadas().length) acoes.append(botao("Alternar construção", () => ed.alternarConstrucaoSelecao()));
    const excluiveis = sel.filter((id) => id !== ORIGEM && id !== EIXO_H && id !== EIXO_V);
    if (excluiveis.length) acoes.append(botao("Excluir", () => ed.excluirSelecao(), "perigo"));
    painel.append(acoes);

    // cota selecionada: valor e tipo
    const cotas = esb.restricoes.filter((r) => ed.selecao.has(r.id) && ehCota(r));
    for (const c of cotas) {
      if (!ehCota(c)) continue;
      const bloco = el("div", "cota-painel");
      bloco.append(el("strong", "", `Cota ${textoCota(c)}`));
      if (!c.referencia) bloco.append(campoNumero("Valor", Number(c.valor.toFixed(4)), c.tipo === "angulo" ? "°" : "mm", (v) => ed.definirValorCota(c.id, v)));
      bloco.append(interruptor("Cota de referência (só mede)", !!c.referencia, () => ed.alternarReferencia(c.id)));
      painel.append(bloco);
    }

    const rels = ed.relacoesDaSelecao();
    if (rels.length) {
      const lista = el("ul", "lista-relacoes");
      for (const r of rels) lista.append(itemRelacao(r, ed));
      painel.append(el("h3", "prop-titulo", "Relações"), lista);
    }
  }

  painel.append(el("h3", "prop-titulo", "Opções"));
  painel.append(interruptor("Mostrar relações no desenho", ed.mostrarRelacoes, (v) => {
    ed.mostrarRelacoes = v;
    ed.redesenhar();
  }));
  painel.append(interruptor("Desenhar com o dedo (sem caneta)", ed.dedoDesenha, (v) => (ed.dedoDesenha = v)));

  const fim = el("div", "prop-rodape");
  fim.append(botao("✓ Sair do esboço", sair, "destaque"));
  painel.append(fim);
}

function itemRelacao(r: RestricaoEsboco, ed: EditorEsboco): HTMLElement {
  const li = el("li");
  li.classList.toggle("conflito", ed.estado.conflitantes.includes(r.id));
  li.append(el("span", "", NOME_RELACAO[r.tipo] ?? r.tipo));
  const x = botao("✕", () => {
    ed.selecao.clear();
    ed.selecao.add(r.id);
    ed.excluirSelecao();
  }, "remover");
  x.setAttribute("aria-label", "Excluir relação");
  li.append(x);
  return li;
}
