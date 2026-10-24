// Painel lateral durante a edição de um esboço: estado de definição, opções da ferramenta,
// seleção (relações, construção, exclusão) e saída do esboço.

import { ehCota, type OpcoesTexto, type RestricaoEsboco } from "../model";
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

/** Campo de seleção (como os campos rosa/azuis dos comandos): o ativo recebe o que for tocado. */
function campoSelecao(rot: string, azul: boolean, ativo: boolean, vazio: string, chips: string[], ativar: () => void, limpar: () => void): HTMLElement[] {
  const area = el("div", `pc-refs ${azul ? "azul" : "rosa"}${ativo ? " ativo" : ""}`);
  area.onclick = ativar;
  if (!chips.length) area.append(el("span", "pc-vazio", vazio));
  for (const t of chips) area.append(el("span", "pc-chip", t));
  if (chips.length) {
    const x = el("button", "pc-chip-x", "×");
    x.type = "button";
    x.title = "Limpar";
    x.onclick = (ev) => { ev.stopPropagation(); limpar(); };
    area.append(x);
  }
  return [el("span", "campo-rotulo", rot), area];
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
  if (ed.ferramenta === "espelhar") {
    const campoSel = (rot: string, c: "entidades" | "eixo", chips: string[], limpar: () => void) =>
      painel.append(...campoSelecao(rot, c === "eixo", ed.espelho.campo === c, c === "eixo" ? "Toque a linha de espelho" : "Toque as entidades",
        chips, () => ed.definirCampoEspelho(c), limpar));
    const n = ed.geosSelecionadas().length;
    campoSel("Entidades a espelhar", "entidades", n ? [`${n} entidade${n > 1 ? "s" : ""}`] : [], () => ed.limparSelecao());
    painel.append(interruptor("Copiar", ed.espelho.copiar, (v) => (ed.espelho.copiar = v)));
    const eixo = ed.nomeEixoEspelho;
    campoSel("Espelhar em relação a", "eixo", eixo ? [eixo] : [], () => {
      ed.espelho.eixo = null;
      ed.definirCampoEspelho("eixo");
    });
    if (n && ed.espelho.eixo) painel.append(botao("Aplicar espelho", () => ed.aplicarEspelho(), "destaque largo"));
  }
  if (ed.ferramenta === "padraoLinearEsboco" || ed.ferramenta === "padraoCircularEsboco") {
    const n = ed.geosSelecionadas().length;
    const num = (rot: string, v: number, un: string, mudar: (x: number) => void) =>
      campoNumero(rot, Number(v.toFixed(4)), un, (x) => { mudar(x); ed.mudouPadrao(); });
    const marca = (rot: string, v: boolean, mudar: (x: boolean) => void) => interruptor(rot, v, (x) => { mudar(x); ed.mudouPadrao(); });
    const inteiro = (x: number) => Math.max(1, Math.min(500, Math.round(x)));
    if (ed.ferramenta === "padraoLinearEsboco") {
      for (const k of ["dir1", "dir2"] as const) {
        const d = ed.padraoLin[k];
        painel.append(el("h3", "prop-titulo", k === "dir1" ? "Direção 1" : "Direção 2"));
        const nome = ed.nomeRefPadrao(d.ref);
        painel.append(...campoSelecao("Direção", true, ed.campoPadrao === k, k === "dir1" ? "Eixo X (toque para outra)" : "Eixo Y (toque para outra)",
          nome ? [nome] : [], () => ed.definirCampoPadrao(k), () => { d.ref = null; d.ang = k === "dir1" ? 0 : 90; ed.definirCampoPadrao("entidades"); }));
        painel.append(
          marca("Inverter direção", d.inverter, (x) => (d.inverter = x)),
          num("Espaçamento", d.esp, "mm", (x) => (d.esp = Math.abs(x))),
          marca(k === "dir1" ? "Cotar espaçamento X" : "Cotar espaçamento Y", d.cotar, (x) => (d.cotar = x)),
          num("Nº de instâncias", d.n, "", (x) => (d.n = inteiro(x))),
          num("Ângulo", d.ang, "°", (x) => { d.ang = x; d.ref = null; }),
        );
      }
    } else {
      const c = ed.padraoCirc;
      painel.append(el("h3", "prop-titulo", "Parâmetros"));
      const nome = ed.nomeRefPadrao(c.centro);
      painel.append(...campoSelecao("Centro", true, ed.campoPadrao === "centro", "Origem (toque para outro ponto)", nome ? [nome] : [],
        () => ed.definirCampoPadrao("centro"), () => { Object.assign(c, { centro: null, cx: 0, cy: 0 }); ed.definirCampoPadrao("entidades"); }));
      painel.append(
        num("Centro X", c.cx, "mm", (x) => { c.cx = x; c.centro = null; }),
        num("Centro Y", c.cy, "mm", (x) => { c.cy = x; c.centro = null; }),
        marca("Inverter direção", c.inverter, (x) => (c.inverter = x)),
        num(c.igual ? "Ângulo total" : "Ângulo entre instâncias", c.angulo, "°", (x) => (c.angulo = x)),
        interruptor("Espaçamento igual", c.igual, (x) => { c.igual = x; if (!x && c.angulo === 360) c.angulo = 360 / c.n; if (x) c.angulo = 360; ed.mudouPadrao(); ed.definirCampoPadrao(ed.campoPadrao); }),
        num("Nº de instâncias", c.n, "", (x) => (c.n = inteiro(x))),
      );
      const ck = interruptor("Cotar raio", c.cotarRaio, (x) => (c.cotarRaio = x));
      if (!c.centro) {
        ck.title = "Escolha um ponto do esboço como centro para cotar o raio";
        (ck.querySelector("input") as HTMLInputElement).disabled = true;
      }
      painel.append(ck);
      const ps = ed.posicaoSementeCircular;
      if (ps) painel.append(el("p", "dica", `Raio ${ps.raio.toFixed(3)} mm · ângulo do arco ${ps.angulo.toFixed(2)}°`));
    }
    painel.append(el("h3", "prop-titulo", "Entidades a padronizar"));
    painel.append(...campoSelecao("Entidades", false, ed.campoPadrao === "entidades", "Toque as entidades", n ? [`${n} entidade${n > 1 ? "s" : ""}`] : [],
      () => ed.definirCampoPadrao("entidades"), () => ed.limparSelecao()));
    const alvo = ed.ferramenta === "padraoLinearEsboco" ? ed.padraoLin : ed.padraoCirc;
    const pular = el("label", "campo");
    pular.append(el("span", "campo-rotulo", ed.ferramenta === "padraoLinearEsboco" ? "Instâncias a pular (ex.: 3, 2-2)" : "Instâncias a pular (ex.: 2, 4)"));
    const ip = el("input");
    ip.value = alvo.pular;
    ip.onchange = () => { alvo.pular = ip.value; ed.mudouPadrao(); };
    pular.append(ip);
    painel.append(pular);
    if (n) painel.append(botao("Aplicar padrão", () => ed.aplicarPadrao(), "destaque largo"));
  }
  if (ed.ferramenta === "texto") {
    const o = ed.textoOpc;
    const curva = ed.curvaTexto;
    painel.append(...campoSelecao("Curvas", false, ed.campoTexto === "curva", "Nenhuma (toque para escolher)", curva ? [curva] : [],
      () => ed.definirCampoTexto(ed.campoTexto === "curva" ? "posicao" : "curva"), () => ed.soltarTextoDaCurva()));
    const lt = el("label", "campo");
    lt.append(el("span", "campo-rotulo", "Texto"));
    const ta = el("textarea", "texto-esboco");
    ta.rows = 2;
    ta.value = o.texto;
    ta.oninput = () => void ed.mudarTexto({ texto: ta.value }, true);
    // ao sair da caixa só grava o passo de desfazer: refazer o painel aqui engoliria o clique
    // que tirou o foco (ex.: no botão Negrito)
    ta.onchange = () => ed.confirmarTexto();
    lt.append(ta);
    painel.append(lt);
    // estilo: negrito, itálico e alinhamento como botões de alternar
    const alternar = (rot: string, titulo: string, ativo: boolean, acao: () => void, cls = "") => {
      const b = botao(rot, acao, `alternar ${cls}`);
      b.title = titulo;
      b.setAttribute("aria-pressed", String(ativo));
      return b;
    };
    const estilo = el("div", "barra-alternar");
    estilo.append(
      alternar("N", "Negrito", o.negrito, () => void ed.mudarTexto({ negrito: !o.negrito }).then(() => ed.definirCampoTexto(ed.campoTexto)), "negrito"),
      alternar("I", "Itálico", o.italico, () => void ed.mudarTexto({ italico: !o.italico }).then(() => ed.definirCampoTexto(ed.campoTexto)), "italico"),
    );
    for (const [v, r, t] of [["esquerda", "⇤", "Alinhar à esquerda"], ["centro", "↔", "Centralizar"], ["direita", "⇥", "Alinhar à direita"], ["justificado", "⇹", "Justificar (ao longo da curva)"]] as const) {
      estilo.append(alternar(r, t, o.alinhamento === v, () => void ed.mudarTexto({ alinhamento: v }).then(() => ed.definirCampoTexto(ed.campoTexto))));
    }
    painel.append(estilo);
    const num = (rot: string, v: number, un: string, mudar: (x: number) => Partial<OpcoesTexto>) =>
      campoNumero(rot, Number(v.toFixed(4)), un, (x) => void ed.mudarTexto(mudar(x)));
    painel.append(
      num("Altura das letras", o.altura, "mm", (x) => ({ altura: Math.max(0.01, Math.abs(x)) })),
      num("Girar", o.angulo, "°", (x) => ({ angulo: x })),
      interruptor("Inverter vertical", o.inverterV, (v) => void ed.mudarTexto({ inverterV: v })),
      interruptor("Inverter horizontal", o.inverterH, (v) => void ed.mudarTexto({ inverterH: v })),
      num("Largura", o.largura, "%", (x) => ({ largura: Math.max(1, x) })),
      num("Espaçamento", o.espacamento, "%", (x) => ({ espacamento: Math.max(0, x) })),
    );
    const lf = el("label", "campo");
    lf.append(el("span", "campo-rotulo", "Fonte"));
    const sf = el("select");
    sf.add(new Option("Noto Sans (licença SIL OFL)", "noto-sans"));
    sf.value = o.fonte;
    lf.append(sf);
    painel.append(lf);
    if (ed.ultimoTexto) painel.append(botao("Novo texto", () => ed.definirFerramenta("texto"), "largo"));
  }
  if (ed.ferramenta === "exibirRelacoes") {
    const f = el("label", "campo");
    f.append(el("span", "campo-rotulo", "Filtro"));
    const sf = el("select");
    for (const [v, r] of [["todas", "Todas no esboço"], ["problemas", "Superdefinindo / redundantes"], ["externas", "Externas (peça)"],
      ["fixas", "Fixas"], ["selecionadas", "Entidades selecionadas"]]) sf.add(new Option(r, v));
    sf.value = ed.filtroRelacoes;
    sf.onchange = () => {
      ed.filtroRelacoes = sf.value as typeof ed.filtroRelacoes;
      renderizarPainelEsboco(painel, ed, sair, renomear, abrirRelacoes);
    };
    f.append(sf);
    painel.append(f);
    const rels = ed.relacoesFiltradas();
    painel.append(el("h3", "prop-titulo", `Relações (${rels.length})`));
    if (!rels.length) painel.append(el("p", "dica", "Nenhuma relação neste filtro."));
    const lista = el("ul", "lista-relacoes");
    for (const r of rels) {
      const li = itemRelacao(r, ed);
      const estado = ed.estadoRelacao(r);
      li.classList.toggle("ativa", ed.relacaoAtiva === r.id);
      const info = li.firstElementChild as HTMLElement;
      info.textContent = `${NOME_RELACAO[r.tipo] ?? r.tipo} · ${estado}`;
      info.classList.add("rel-info");
      info.onclick = () => ed.mostrarRelacao(r.id);
      lista.append(li);
    }
    painel.append(lista);
    if (rels.length) painel.append(botao("Excluir todas (do filtro)", () => ed.excluirRelacoes(rels.map((r) => r.id)), "perigo largo"));
  }
  if (ed.ferramenta === "aparar") {
    painel.append(el("h3", "prop-titulo", "Opções"));
    const modos: [string, string][] = [["potente", "Aparar potente (riscar)"], ["canto", "Canto"], ["dentro", "Aparar dentro"], ["fora", "Aparar fora"], ["proximo", "Aparar até o mais próximo"]];
    const grupo = el("div", "opcoes-radio");
    for (const [v, r] of modos) {
      const l = el("label", "radio");
      const i = el("input");
      i.type = "radio";
      i.name = "modo-aparar";
      i.checked = ed.aparo.modo === v;
      i.onchange = () => ed.definirModoAparar(v as typeof ed.aparo.modo);
      l.append(i, el("span", "", r));
      grupo.append(l);
    }
    painel.append(grupo);
    painel.append(
      interruptor("Manter entidades aparadas como construção", ed.aparo.construcao, (v) => (ed.aparo.construcao = v)),
      interruptor("Ignorar aparar geometria de construção", ed.aparo.ignorarConstrucao, (v) => (ed.aparo.ignorarConstrucao = v)),
    );
  }
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
  if (!["selecionar", "aparar", "offset", "espelhar", "cota", "padraoLinearEsboco", "padraoCircularEsboco", "exibirRelacoes"].includes(ed.ferramenta)) {
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
    const txt = sel.length === 1 ? esb.geos.find((g) => g.id === sel[0] && g.tipo === "texto") : undefined;
    if (txt) acoes.append(botao("Editar texto", () => ed.editarTexto(txt.id)));
    const excluiveis = sel.filter((id) => id !== ORIGEM && id !== EIXO_H && id !== EIXO_V);
    if (excluiveis.length) acoes.append(botao("Excluir", () => ed.excluirSelecao(), "perigo"));
    painel.append(acoes);

    // transformar a seleção (mover, copiar, girar)
    if (ed.geosSelecionadas().length) {
      const det = el("details", "transformar");
      det.append(el("summary", "", "Mover, copiar, girar"));
      const v = { dx: 10, dy: 0, angulo: 90 };
      const linha = (...bs: HTMLElement[]) => {
        const d = el("div", "prop-rodape");
        d.append(...bs);
        det.append(d);
      };
      det.append(campoNumero("ΔX", v.dx, "mm", (x) => (v.dx = x)), campoNumero("ΔY", v.dy, "mm", (x) => (v.dy = x)));
      linha(botao("Mover", () => ed.transformarSelecao("mover", v)), botao("Copiar", () => ed.transformarSelecao("copiar", v)));
      det.append(campoNumero("Ângulo (centro: ponto selecionado ou origem)", v.angulo, "°", (x) => (v.angulo = x)));
      linha(botao("Girar", () => ed.transformarSelecao("girar", v)), botao("Girar cópia", () => ed.transformarSelecao("girarCopia", v)));
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

    const rels = ed.ferramenta === "exibirRelacoes" ? [] : ed.relacoesDaSelecao();
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
