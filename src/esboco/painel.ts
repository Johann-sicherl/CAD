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
  const tipo = (rot: string, valor: string, ops: [string, string][], mudar: (v: string) => void) => {
    const l = el("label", "campo");
    l.append(el("span", "campo-rotulo", rot));
    const s = el("select");
    for (const [v, r] of ops) s.add(new Option(r, v));
    s.value = valor;
    s.onchange = () => {
      mudar(s.value);
      ed.definirFerramenta(ed.ferramenta);
    };
    l.append(s);
    painel.append(l);
  };
  if (ed.ferramenta === "linha") tipo("Tipo", ed.tipoLinha, [["normal", "Linha"], ["centro", "Linha de centro"], ["pontoMedio", "Linha de ponto médio"]], (v) => (ed.tipoLinha = v as never));
  if (ed.ferramenta === "retangulo") tipo("Tipo", ed.tipoRetangulo, [["canto", "De canto"], ["centro", "Pelo centro"], ["3pontos", "De canto por 3 pontos"], ["centro3", "Pelo centro por 3 pontos"], ["paralelogramo", "Paralelogramo"]], (v) => (ed.tipoRetangulo = v as never));
  if (ed.ferramenta === "circulo") tipo("Tipo", ed.tipoCirculo, [["centro", "Pelo centro"], ["perimetro", "Perimetral (3 pontos)"]], (v) => (ed.tipoCirculo = v as never));
  if (ed.ferramenta === "arco") tipo("Tipo", ed.tipoArco, [["3pontos", "3 pontos"], ["centro", "Centro-pontas"], ["tangente", "Tangente"]], (v) => (ed.tipoArco = v as never));
  if (ed.ferramenta === "rasgo") tipo("Tipo", ed.tipoRasgo, [["reto", "Reto"], ["centro", "Reto pelo centro"], ["arco3", "Em arco por 3 pontos"], ["arcoCentro", "Em arco pelo centro"]], (v) => (ed.tipoRasgo = v as never));
  if (ed.ferramenta === "poligono") {
    // parâmetros do polígono (antes de criar valem para o próximo; depois editam o último)
    painel.append(el("h3", "prop-titulo", "Parâmetros"));
    painel.append(campoNumero("Nº de lados", ed.lados, "", (v) => {
      ed.lados = Math.max(3, Math.min(64, Math.round(v)));
      ed.refazerPoligono();
    }));
    tipo("Círculo", ed.poligonoCircunscrito ? "circ" : "insc", [["insc", "Círculo inscrito"], ["circ", "Círculo circunscrito"]], (v) => {
      ed.poligonoCircunscrito = v === "circ";
      ed.refazerPoligono();
    });
    const pp = ed.parametrosPoligono();
    if (pp) {
      const f = (x: number) => Number(x.toFixed(4));
      painel.append(
        campoNumero("Centro X", f(pp.x), "mm", (v) => ed.editarPoligono({ x: v })),
        campoNumero("Centro Y", f(pp.y), "mm", (v) => ed.editarPoligono({ y: v })),
        campoNumero("Diâmetro do círculo", f(pp.diametro), "mm", (v) => ed.editarPoligono({ diametro: v })),
        campoNumero("Ângulo", f(pp.angulo), "°", (v) => ed.editarPoligono({ angulo: v })),
      );
      painel.append(botao("Novo polígono", () => {
        ed.ultimoPoligono = null;
        ed.definirFerramenta("poligono");
      }, "largo"));
    }
  }
  if (ed.ferramenta === "fileteEsboco") {
    painel.append(campoNumero("Raio", ed.raioFilete, "mm", (v) => (ed.raioFilete = Math.abs(v))));
    painel.append(interruptor("Cotar cada filete", ed.cotarFilete, (v) => (ed.cotarFilete = v)));
  }
  if (ed.ferramenta === "chanfroEsboco") painel.append(campoNumero("Distância", ed.distChanfro, "mm", (v) => (ed.distChanfro = Math.abs(v))));
  if (ed.ferramenta === "offset") {
    const o = ed.offset;
    const opcao = (rot: string, k: "cotar" | "inverter" | "cadeia" | "bidirecional" | "baseConstrucao" | "construcao") =>
      interruptor(rot, o[k], (v) => { o[k] = v; ed.mudouOffset(); });
    painel.append(el("h3", "prop-titulo", "Parâmetros"));
    painel.append(campoNumero("Distância", ed.distOffset, "mm", (v) => { ed.distOffset = Math.abs(v); ed.mudouOffset(); }));
    painel.append(
      opcao("Adicionar cotas", "cotar"),
      opcao("Inverter", "inverter"),
      opcao("Selecionar cadeia", "cadeia"),
      opcao("Bidirecional", "bidirecional"),
    );
    const tampar = el("label", "campo");
    tampar.append(el("span", "campo-rotulo", "Tampar extremidades"));
    const st = el("select");
    for (const [v, r] of [["nenhuma", "Não"], ["arcos", "Arcos"], ["linhas", "Linhas"]]) st.add(new Option(r, v));
    st.value = o.tampar;
    st.onchange = () => { o.tampar = st.value as typeof o.tampar; ed.mudouOffset(); };
    tampar.append(st);
    painel.append(tampar);
    painel.append(el("h3", "prop-titulo", "Geometria de construção"));
    painel.append(
      opcao("Geometria base", "baseConstrucao"),
      opcao("Geometria do offset", "construcao"),
    );
    painel.append(botao(ed.selecao.size ? "Aplicar offset" : "Toque uma entidade", () => ed.aplicarOffset(), "destaque largo"));
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

    // transformar a seleção (mover, copiar, girar, padrões)
    if (ed.geosSelecionadas().length) {
      const det = el("details", "transformar");
      det.open = !!ed.abrirTransformar; // pedido pelo menu ▾ Padrão
      det.append(el("summary", "", "Mover, copiar, girar, padrões"));
      const v = { dx: 10, dy: 0, angulo: 90, n: 3, esp: 20, total: 360, angLin: 0 };
      const linha = (...bs: HTMLElement[]) => {
        const d = el("div", "prop-rodape");
        d.append(...bs);
        det.append(d);
      };
      det.append(campoNumero("ΔX", v.dx, "mm", (x) => (v.dx = x)), campoNumero("ΔY", v.dy, "mm", (x) => (v.dy = x)));
      linha(botao("Mover", () => ed.transformarSelecao("mover", v)), botao("Copiar", () => ed.transformarSelecao("copiar", v)));
      det.append(campoNumero("Ângulo (centro: ponto selecionado ou origem)", v.angulo, "°", (x) => (v.angulo = x)));
      linha(botao("Girar", () => ed.transformarSelecao("girar", v)), botao("Girar cópia", () => ed.transformarSelecao("girarCopia", v)));
      det.append(campoNumero("Nº de instâncias", v.n, "", (x) => (v.n = x)), campoNumero("Espaçamento", v.esp, "mm", (x) => (v.esp = x)),
        campoNumero("Direção (ângulo)", v.angLin, "°", (x) => (v.angLin = x)));
      linha(botao("Padrão linear", () => ed.transformarSelecao("padraoLinear", { n: v.n, esp: v.esp, angulo: v.angLin })));
      det.append(campoNumero("Ângulo total (circular)", v.total, "°", (x) => (v.total = x)));
      linha(botao("Padrão circular", () => ed.transformarSelecao("padraoCircular", { n: v.n, angulo: v.total })));
      painel.append(det);
    }

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
  if (ed.opcaoDedo) painel.append(interruptor("Desenhar com o dedo (sem caneta)", ed.dedoDesenha, (v) => (ed.dedoDesenha = v)));

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
