// WJPlaniel: planilha eletrônica do WJProMaster (especificação: docs/global/planilha.md).
// Liga a casca comum, a grade, a barra de fórmulas, as folhas e os arquivos (.wjpl e CSV).

import "./planilha.css";
import { $, autosave, baixar, Casca, el, escapar, escolherArquivo, Historico, janela, menu, registrarOffline, type Aba } from "../comum/casca";
import { comparar } from "../formulas/conversao";
import { listaDeFuncoes } from "../formulas/funcoes";
import { Calculadora, chave, interpretarEntrada, pastaVazia, validarPasta, type Celula, type Folha, type Formato, type Pasta, type TipoFormato } from "../formulas/pasta";
import { ajustarReferencias } from "../formulas/sintaxe";
import { colunaParaIndice, enderecoA1, LIMITE_COLUNAS, LIMITE_LINHAS } from "../formulas/tipos";
import { exibir } from "./formatar";
import { Grade, lerTSV, type Faixa } from "./grade";

const CHAVE = "wjpl:documento";

let pasta: Pasta = (() => {
  try {
    const p = autosave.ler<Pasta>(CHAVE);
    return p ? validarPasta(p) : pastaVazia();
  } catch {
    return pastaVazia();
  }
})();
const calc = new Calculadora(pasta);
const historico = new Historico<Pasta>();
historico.limpar(pasta);

const folha = () => pasta.folhas[pasta.ativa];

const nomeBox = $<HTMLInputElement>("#pl-nome");
const barra = $<HTMLInputElement>("#pl-formula");

// ---------- formatação da seleção ----------

/** Formato da célula ativa (para o estado dos botões). */
const fmtAtivo = (): Formato => folha().celulas[chave(grade.ativa.l, grade.ativa.c)]?.f ?? {};

function formatar(desc: string, muda: (f: Formato) => void) {
  const fx = grade.faixa();
  // linha/coluna inteira: aplica só ao usado (+ a célula ativa)
  const lim = grade.faixaLimitada();
  const fl = folha();
  alterar(desc, () => {
    for (let l = fx.l0; l <= Math.max(lim.l1, fx.l0); l++) {
      for (let c = fx.c0; c <= Math.max(lim.c1, fx.c0); c++) {
        const k = chave(l, c);
        const cel: Celula = fl.celulas[k] ?? { e: "" };
        const f = { ...(cel.f ?? {}) };
        muda(f);
        for (const x of Object.keys(f) as (keyof Formato)[]) if (f[x] === undefined || f[x] === false) delete f[x];
        cel.f = Object.keys(f).length ? f : undefined;
        if (!cel.f) delete cel.f;
        if (cel.e === "" && !cel.f) delete fl.celulas[k];
        else fl.celulas[k] = cel;
      }
    }
  });
}

const alternar = (campo: "negrito" | "italico" | "sublinhado" | "riscado" | "quebrar" | "borda") => {
  const v = !fmtAtivo()[campo];
  formatar("Formatar", (f) => (f[campo] = v));
};

// ---------- alterações (histórico, recálculo, salvamento automático) ----------

function alterar(_desc: string, muda: () => void) {
  muda();
  calc.invalidar();
  historico.registrar(pasta);
  autosave.guardar(CHAVE, pasta);
  grade.atualizarEspaco();
  grade.redesenhar();
  aoMudarSelecao();
}

function trocarPasta(p: Pasta) {
  pasta = p;
  calc.pasta = p;
  calc.invalidar();
  grade.host.pasta = p;
  grade.selecionar({ l: 0, c: 0 });
  autosave.guardar(CHAVE, pasta);
  renderizarFolhas();
  casca.renderizar();
}

// ---------- grade ----------

const grade = new Grade($("#pl-grade"), {
  pasta,
  calc,
  folha,
  alterar,
  aoMudarSelecao: () => aoMudarSelecao(),
  aoEditar: (t) => {
    if (t !== null && document.activeElement !== barra) barra.value = t;
    if (t === null) aoMudarSelecao();
    casca.definirStatus(t === null ? "Pronto" : grade.podeApontar() ? "Apontar" : "Editar");
  },
  menuContexto: (x, y) => menu(x, y, [
    { rotulo: "Recortar", icone: "recortar", acao: () => grade.copiar(null, true) },
    { rotulo: "Copiar", icone: "copiar", acao: () => grade.copiar(null, false) },
    { rotulo: "Colar", icone: "colar", acao: () => void colarDaArea() },
    "-",
    { rotulo: "Inserir linha acima", icone: "inserirLinha", acao: () => inserirExcluir("lin", 1) },
    { rotulo: "Inserir coluna à esquerda", icone: "inserirColuna", acao: () => inserirExcluir("col", 1) },
    { rotulo: "Excluir linha(s)", icone: "excluirLinha", acao: () => inserirExcluir("lin", -1) },
    { rotulo: "Excluir coluna(s)", icone: "excluirColuna", acao: () => inserirExcluir("col", -1) },
    "-",
    { rotulo: "Limpar conteúdo", icone: "apagar", acao: () => grade.limpar() },
    { rotulo: "Limpar tudo (com formatos)", icone: "apagar", acao: () => grade.limpar(true) },
    { rotulo: "Classificar A → Z", icone: "classificarAZ", acao: () => classificar(1) },
    { rotulo: "Classificar Z → A", icone: "classificarZA", acao: () => classificar(-1) },
  ]),
});

async function colarDaArea() {
  try {
    grade.colar(await navigator.clipboard.readText());
  } catch {
    grade.colar("");
  }
}

function aoMudarSelecao() {
  const f = grade.faixa();
  const umaCel = f.l0 === f.l1 && f.c0 === f.c1;
  const inteira = f.l1 === LIMITE_LINHAS - 1 || f.c1 === LIMITE_COLUNAS - 1;
  nomeBox.value = umaCel ? enderecoA1(f.l0, f.c0) : inteira ? `${f.l1 - f.l0 + 1 > 1e5 ? "Colunas" : "Linhas"}` : `${enderecoA1(f.l0, f.c0)}:${enderecoA1(f.l1, f.c1)}`;
  if (!grade.editando && document.activeElement !== barra) barra.value = folha().celulas[chave(grade.ativa.l, grade.ativa.c)]?.e ?? "";
  // resumo da seleção na barra de status
  const lim = grade.faixaLimitada();
  let soma = 0, n = 0, cont = 0;
  if ((lim.l1 - lim.l0 + 1) * (lim.c1 - lim.c0 + 1) <= 200000) {
    for (let l = lim.l0; l <= lim.l1; l++) {
      for (let c = lim.c0; c <= lim.c1; c++) {
        if (!folha().celulas[chave(l, c)]) continue;
        const v = calc.valor(folha().nome, l, c);
        if (v === null || v === "") continue;
        cont++;
        if (typeof v === "number") {
          soma += v;
          n++;
        }
      }
    }
  }
  const fmt = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
  casca.statusDireita.innerHTML = `${n > 1 || (!umaCel && n) ? `<span>Média: ${fmt(soma / n)}</span><span>Contagem: ${cont}</span><span>Soma: ${fmt(soma)}</span>` : !umaCel && cont ? `<span>Contagem: ${cont}</span>` : ""}
    <span>${Math.round(grade.zoom * 100)}%</span>`;
  casca.renderizar();
}

// barra de fórmulas
barra.addEventListener("focus", () => {
  if (!grade.editando) grade.iniciarEdicao(null, "editar");
  barra.focus();
});
barra.addEventListener("input", () => grade.definirTextoEdicao(barra.value));
barra.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    grade.editor.value = barra.value;
    grade.confirmarEdicao({ dl: 1, dc: 0 });
  } else if (e.key === "Escape") {
    e.preventDefault();
    grade.cancelarEdicao();
  }
});
// caixa de nome: vai para A1, B2:C9 ou um nome definido
nomeBox.addEventListener("focus", () => nomeBox.select());
nomeBox.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const t = nomeBox.value.trim();
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(t);
  if (m) {
    const a = { l: Number(m[2]) - 1, c: colunaParaIndice(m[1]) };
    const b = m[3] ? { l: Number(m[4]) - 1, c: colunaParaIndice(m[3]) } : a;
    grade.selecionar(a);
    if (m[3]) grade.selecionarFaixa({ l0: Math.min(a.l, b.l), c0: Math.min(a.c, b.c), l1: Math.max(a.l, b.l), c1: Math.max(a.c, b.c) });
    grade.mostrar(a);
  } else if (/^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*$/.test(t)) {
    // nome novo para a seleção, ou ir para um nome existente
    const def = Object.entries(pasta.nomes ?? {}).find(([k]) => k.toLowerCase() === t.toLowerCase());
    if (def) {
      const r = /!?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(def[1]);
      if (r) grade.selecionar({ l: Number(r[2]) - 1, c: colunaParaIndice(r[1]) });
    } else {
      const f = grade.faixa();
      const ref = `='${folha().nome.replace(/'/g, "''")}'!${enderecoA1(f.l0, f.c0, true, true)}${f.l0 !== f.l1 || f.c0 !== f.c1 ? `:${enderecoA1(f.l1, f.c1, true, true)}` : ""}`;
      alterar("Definir nome", () => ((pasta.nomes ??= {})[t] = ref));
      casca.avisar(`Nome "${t}" definido para a seleção.`);
    }
  } else casca.avisar("Referência inválida (use A1, B2:C9 ou um nome).");
  grade.focar();
});
$("#pl-fx").onclick = () => inserirFuncao();

// ---------- folhas ----------

function renderizarFolhas() {
  const barraF = $("#pl-folhas");
  barraF.innerHTML = "";
  pasta.folhas.forEach((f, i) => {
    const b = el("button", { class: `pl-folha${i === pasta.ativa ? " ativa" : ""}`, title: "Toque duplo: renomear · botão direito: mais opções" }, escapar(f.nome));
    b.onclick = () => irParaFolha(i);
    b.ondblclick = () => renomearFolha(i);
    b.oncontextmenu = (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY - 160, [
        { rotulo: "Renomear", icone: "editar", acao: () => renomearFolha(i) },
        { rotulo: "Duplicar", icone: "duplicar", acao: () => duplicarFolha(i) },
        { rotulo: "Mover para a esquerda", acao: () => moverFolha(i, -1) },
        { rotulo: "Mover para a direita", acao: () => moverFolha(i, 1) },
        "-",
        { rotulo: "Excluir", icone: "apagar", acao: () => excluirFolha(i) },
      ]);
    };
    barraF.append(b);
  });
  const mais = el("button", { class: "pl-folha-mais", title: "Nova planilha" }, "+");
  mais.onclick = novaFolha;
  barraF.append(mais);
}

function irParaFolha(i: number) {
  if (grade.editando) grade.confirmarEdicao(null);
  pasta.ativa = i;
  calc.invalidar();
  grade.selecionar({ l: 0, c: 0 });
  renderizarFolhas();
}

function nomeLivre(base: string) {
  let n = pasta.folhas.length + 1;
  while (pasta.folhas.some((f) => f.nome.toLowerCase() === `${base}${n}`.toLowerCase())) n++;
  return `${base}${n}`;
}

function novaFolha() {
  alterar("Nova planilha", () => {
    pasta.folhas.push({ nome: nomeLivre("Planilha"), celulas: {} });
    pasta.ativa = pasta.folhas.length - 1;
  });
  renderizarFolhas();
}

function renomearFolha(i: number) {
  const atual = pasta.folhas[i].nome;
  const novo = prompt("Nome da planilha:", atual)?.trim();
  if (!novo || novo === atual) return;
  if (/[\\/?*[\]:]/.test(novo)) return casca.avisar("O nome não pode ter \\ / ? * [ ] :");
  if (pasta.folhas.some((f, k) => k !== i && f.nome.toLowerCase() === novo.toLowerCase())) return casca.avisar("Já existe uma planilha com esse nome.");
  alterar("Renomear planilha", () => {
    pasta.folhas[i].nome = novo;
    // fórmulas que citam a folha pelo nome antigo passam a usar o novo
    const rx = new RegExp(`(^|[^\\w'])('?)${atual.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "''")}\\2!`, "gi");
    const q = /^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*$/.test(novo) ? novo : `'${novo.replace(/'/g, "''")}'`;
    for (const f of pasta.folhas) for (const c of Object.values(f.celulas)) if (c.e.startsWith("=")) c.e = c.e.replace(rx, (_, a: string) => `${a}${q}!`);
  });
  renderizarFolhas();
}

function duplicarFolha(i: number) {
  alterar("Duplicar planilha", () => {
    const c: Folha = JSON.parse(JSON.stringify(pasta.folhas[i]));
    c.nome = nomeLivre(`${pasta.folhas[i].nome} (`).replace(/\($/, "");
    c.nome = `${pasta.folhas[i].nome} (2)`;
    let k = 2;
    while (pasta.folhas.some((f) => f.nome === c.nome)) c.nome = `${pasta.folhas[i].nome} (${++k})`;
    pasta.folhas.splice(i + 1, 0, c);
    pasta.ativa = i + 1;
  });
  renderizarFolhas();
}

function moverFolha(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= pasta.folhas.length) return;
  alterar("Mover planilha", () => {
    const [f] = pasta.folhas.splice(i, 1);
    pasta.folhas.splice(j, 0, f);
    pasta.ativa = j;
  });
  renderizarFolhas();
}

function excluirFolha(i: number) {
  if (pasta.folhas.length === 1) return casca.avisar("A pasta precisa de pelo menos uma planilha.");
  if (!confirm(`Excluir a planilha "${pasta.folhas[i].nome}"? (Ctrl+Z desfaz)`)) return;
  alterar("Excluir planilha", () => {
    pasta.folhas.splice(i, 1);
    pasta.ativa = Math.min(pasta.ativa, pasta.folhas.length - 1);
  });
  renderizarFolhas();
}

// ---------- linhas/colunas, classificar, duplicatas ----------

function inserirExcluir(eixo: "lin" | "col", sinal: 1 | -1) {
  const f = grade.faixa();
  const pos = eixo === "lin" ? f.l0 : f.c0;
  const qtd = eixo === "lin" ? (f.l1 === LIMITE_LINHAS - 1 && f.c0 === 0 ? 1 : f.l1 - f.l0 + 1) : f.c1 - f.c0 + 1;
  const n = sinal * Math.min(qtd, 1000);
  const alvo = folha();
  alterar(sinal > 0 ? "Inserir" : "Excluir", () => {
    const novas: Record<string, Celula> = {};
    for (const [k, cel] of Object.entries(alvo.celulas)) {
      let [l, c] = k.split(",").map(Number);
      const v = eixo === "lin" ? l : c;
      if (n < 0 && v >= pos && v < pos - n) continue;
      if (v >= pos) {
        if (eixo === "lin") l += n;
        else c += n;
      }
      novas[chave(l, c)] = cel;
    }
    alvo.celulas = novas;
    // larguras/alturas acompanham
    const mapa = eixo === "lin" ? alvo.alturas : alvo.larguras;
    if (mapa) {
      const m2: Record<number, number> = {};
      for (const [k, w] of Object.entries(mapa)) {
        const v = Number(k);
        if (n < 0 && v >= pos && v < pos - n) continue;
        m2[v >= pos ? v + n : v] = w;
      }
      if (eixo === "lin") alvo.alturas = m2;
      else alvo.larguras = m2;
    }
    // fórmulas de todas as folhas que apontam para esta
    for (const fl of pasta.folhas) {
      for (const cel of Object.values(fl.celulas)) {
        if (cel.e.startsWith("=")) cel.e = ajustarReferencias(cel.e, fl.nome, alvo.nome, eixo, pos, n);
      }
    }
  });
}

/** Classifica as linhas da seleção (ou do bloco de dados em volta) pela coluna ativa. */
function classificar(ordem: 1 | -1) {
  let f = grade.faixaLimitada();
  if (f.l0 === f.l1 && f.c0 === f.c1) f = blocoEmVolta(grade.ativa.l, grade.ativa.c);
  const fl = folha();
  const col = grade.ativa.c;
  // primeira linha com texto e o resto com números: cabeçalho fica
  const cab = typeof calc.valor(fl.nome, f.l0, col) === "string" && typeof calc.valor(fl.nome, f.l0 + 1, col) === "number";
  const l0 = cab ? f.l0 + 1 : f.l0;
  const linhas: { chaveOrd: ReturnType<typeof calc.valor>; cels: (Celula | undefined)[] }[] = [];
  for (let l = l0; l <= f.l1; l++) {
    const cels: (Celula | undefined)[] = [];
    for (let c = f.c0; c <= f.c1; c++) cels.push(fl.celulas[chave(l, c)]);
    linhas.push({ chaveOrd: calc.valor(fl.nome, l, col), cels });
  }
  linhas.sort((a, b) => {
    // vazios sempre no fim
    if (a.chaveOrd === null) return b.chaveOrd === null ? 0 : 1;
    if (b.chaveOrd === null) return -1;
    return ordem * comparar(a.chaveOrd, b.chaveOrd);
  });
  alterar("Classificar", () => {
    linhas.forEach((x, i) => x.cels.forEach((cel, j) => {
      const k = chave(l0 + i, f.c0 + j);
      if (cel) fl.celulas[k] = cel;
      else delete fl.celulas[k];
    }));
  });
  grade.selecionarFaixa(f);
}

function blocoEmVolta(l: number, c: number): Faixa {
  const fl = folha();
  const cheia = (a: number, b: number) => !!fl.celulas[chave(a, b)]?.e;
  let l0 = l, l1 = l, c0 = c, c1 = c;
  let mudou = true;
  while (mudou) {
    mudou = false;
    const linhaCheia = (x: number) => { for (let k = c0; k <= c1; k++) if (cheia(x, k)) return true; return false; };
    const colCheia = (x: number) => { for (let k = l0; k <= l1; k++) if (cheia(k, x)) return true; return false; };
    if (l0 > 0 && linhaCheia(l0 - 1)) { l0--; mudou = true; }
    if (linhaCheia(l1 + 1)) { l1++; mudou = true; }
    if (c0 > 0 && colCheia(c0 - 1)) { c0--; mudou = true; }
    if (colCheia(c1 + 1)) { c1++; mudou = true; }
  }
  return { l0, c0, l1, c1 };
}

function removerDuplicatas() {
  let f = grade.faixaLimitada();
  if (f.l0 === f.l1 && f.c0 === f.c1) f = blocoEmVolta(grade.ativa.l, grade.ativa.c);
  const fl = folha();
  const vistos = new Set<string>();
  const ficam: (Celula | undefined)[][] = [];
  let removidas = 0;
  for (let l = f.l0; l <= f.l1; l++) {
    const cels: (Celula | undefined)[] = [];
    const chaves: string[] = [];
    for (let c = f.c0; c <= f.c1; c++) {
      cels.push(fl.celulas[chave(l, c)]);
      chaves.push(String(calc.valor(fl.nome, l, c) ?? "").toLowerCase());
    }
    const k = chaves.join("\u0001");
    if (vistos.has(k)) {
      removidas++;
      continue;
    }
    vistos.add(k);
    ficam.push(cels);
  }
  alterar("Remover duplicatas", () => {
    for (let l = f.l0; l <= f.l1; l++) for (let c = f.c0; c <= f.c1; c++) delete fl.celulas[chave(l, c)];
    ficam.forEach((cels, i) => cels.forEach((cel, j) => cel && (fl.celulas[chave(f.l0 + i, f.c0 + j)] = cel)));
  });
  casca.avisar(removidas ? `${removidas} linha(s) duplicada(s) removida(s); ${ficam.length} ficaram.` : "Nenhuma linha duplicada.");
}

// ---------- AutoSoma, funções, nomes, localizar ----------

/** AutoSoma: abaixo de uma coluna de números (ou à direita de uma linha). */
function autoSoma(funcao = "SOMA") {
  const f = grade.faixaLimitada();
  const fl = folha();
  if (f.l0 !== f.l1 || f.c0 !== f.c1) {
    // seleção com números: total na linha de baixo de cada coluna
    alterar("AutoSoma", () => {
      for (let c = f.c0; c <= f.c1; c++) fl.celulas[chave(f.l1 + 1, c)] = { e: `=${funcao}(${enderecoA1(f.l0, c)}:${enderecoA1(f.l1, c)})` };
    });
    return;
  }
  const { l, c } = grade.ativa;
  const num = (a: number, b: number) => typeof calc.valor(fl.nome, a, b) === "number";
  let l0 = l - 1;
  while (l0 >= 0 && num(l0, c)) l0--;
  if (l0 < l - 1) return grade.iniciarEdicao(`=${funcao}(${enderecoA1(l0 + 1, c)}:${enderecoA1(l - 1, c)})`, "editar");
  let c0 = c - 1;
  while (c0 >= 0 && num(l, c0)) c0--;
  if (c0 < c - 1) return grade.iniciarEdicao(`=${funcao}(${enderecoA1(l, c0 + 1)}:${enderecoA1(l, c - 1)})`, "editar");
  grade.iniciarEdicao(`=${funcao}(`, "entrar");
}

function inserirFuncao() {
  const todas = listaDeFuncoes();
  const cats = ["Todas", ...new Set(todas.map((x) => x.def.categoria))];
  const { corpo, fechar } = janela("Inserir função", `
    <div class="pl-funcoes">
      <input data-q placeholder="Procurar (ex.: soma, procura, data)" />
      <select data-cat>${cats.map((c) => `<option>${c}</option>`).join("")}</select>
      <div class="pl-lista-funcoes" data-lista></div>
      <div data-info style="font-size:14px"></div>
    </div>`, [
    { rotulo: "Cancelar" },
    { rotulo: "Inserir", destaque: true, acao: (c) => {
      const nome = c.querySelector<HTMLElement>(".sel")?.dataset.nome;
      if (!nome) return false;
      usar(nome);
    } },
  ]);
  const usar = (nome: string) => {
    fechar();
    if (grade.editando && grade.editor.value.startsWith("=")) {
      grade.editor.value += `${nome}(`;
      grade.definirTextoEdicao(grade.editor.value);
      grade.editor.focus();
    } else grade.iniciarEdicao(`=${nome}(`, "editar");
  };
  const desenhar = () => {
    const q = corpo.querySelector<HTMLInputElement>("[data-q]")!.value.toLowerCase();
    const cat = corpo.querySelector<HTMLSelectElement>("[data-cat]")!.value;
    const lista = todas.filter((x) => (cat === "Todas" || x.def.categoria === cat) && (!q || `${x.nome} ${x.def.descricao}`.toLowerCase().includes(q)));
    const alvo = corpo.querySelector<HTMLElement>("[data-lista]")!;
    alvo.innerHTML = lista.map((x, i) => `<div data-nome="${x.nome}" class="${i === 0 ? "sel" : ""}"><b>${x.nome}</b><small>${escapar(x.def.descricao)}</small></div>`).join("") || `<p class="wj-vazio">Nada encontrado.</p>`;
    const info = (nome?: string) => {
      const d = todas.find((x) => x.nome === nome)?.def;
      corpo.querySelector<HTMLElement>("[data-info]")!.innerHTML = d ? `<code>${escapar(d.sintaxe)}</code><br>${escapar(d.descricao)}` : "";
    };
    info(lista[0]?.nome);
    for (const d of alvo.querySelectorAll<HTMLElement>("[data-nome]")) {
      d.onclick = () => {
        alvo.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
        d.classList.add("sel");
        info(d.dataset.nome);
      };
      d.ondblclick = () => usar(d.dataset.nome!);
    }
  };
  corpo.querySelector<HTMLInputElement>("[data-q]")!.oninput = desenhar;
  corpo.querySelector<HTMLSelectElement>("[data-cat]")!.onchange = desenhar;
  desenhar();
}

function gerenciarNomes() {
  const linhas = Object.entries(pasta.nomes ?? {});
  const { corpo } = janela("Nomes definidos", `
    <p style="margin-top:0;font-size:14px;color:var(--texto-2)">Use nas fórmulas pelo nome (ex.: <code>=Preço*Imposto</code>). Também dá para criar digitando o nome na caixa de nome com a seleção feita.</p>
    <table class="wj-tabela"><tr><th>Nome</th><th>Refere-se a</th><th></th></tr>
    ${linhas.map(([n, r]) => `<tr><td>${escapar(n)}</td><td><code>${escapar(r)}</code></td><td><button data-x="${escapar(n)}">Excluir</button></td></tr>`).join("") || `<tr><td colspan="3" class="wj-vazio">Nenhum nome.</td></tr>`}
    </table>
    <div style="display:flex;gap:6px;margin-top:10px"><input data-n placeholder="Nome" style="width:120px"/><input data-r placeholder="=0,18 ou =Planilha1!$A$1:$A$9" style="flex:1"/><button data-add>Adicionar</button></div>`);
  for (const b of corpo.querySelectorAll<HTMLElement>("[data-x]")) {
    b.onclick = () => {
      alterar("Excluir nome", () => delete pasta.nomes![b.dataset.x!]);
      b.closest("tr")!.remove();
    };
  }
  corpo.querySelector<HTMLElement>("[data-add]")!.onclick = () => {
    const n = corpo.querySelector<HTMLInputElement>("[data-n]")!.value.trim();
    let r = corpo.querySelector<HTMLInputElement>("[data-r]")!.value.trim();
    if (!/^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*$/.test(n) || /^[A-Za-z]{1,3}\d+$/.test(n)) return casca.avisar("Nome inválido (comece com letra; não pode parecer uma célula como A1).");
    if (!r) return;
    if (!r.startsWith("=")) r = `=${r}`;
    alterar("Definir nome", () => ((pasta.nomes ??= {})[n] = r));
    document.querySelector(".wj-fundo")?.remove();
    gerenciarNomes();
  };
}

function localizar() {
  const { corpo } = janela("Localizar", `
    <div class="wj-campo"><label>Procurar</label><input data-q /></div>
    <label style="font-size:14px"><input type="checkbox" data-f /> Procurar também nas fórmulas</label>`, [
    { rotulo: "Fechar" },
    { rotulo: "Localizar próxima", destaque: true, acao: (c) => {
      const q = c.querySelector<HTMLInputElement>("[data-q]")!.value.toLowerCase();
      const emFormula = c.querySelector<HTMLInputElement>("[data-f]")!.checked;
      if (!q) return false;
      const fl = folha();
      const ks = Object.keys(fl.celulas).map((k) => k.split(",").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const atual = grade.ativa;
      const casa = ([l, cc]: number[]) => {
        const cel = fl.celulas[chave(l, cc)];
        const t = exibir(calc.valor(fl.nome, l, cc), cel.f).texto.toLowerCase();
        return t.includes(q) || (emFormula && cel.e.toLowerCase().includes(q));
      };
      const depois = ks.find(([l, cc]) => (l > atual.l || (l === atual.l && cc > atual.c)) && casa([l, cc])) ?? ks.find(casa);
      if (!depois) casca.avisar("Não encontrado.");
      else grade.selecionar({ l: depois[0], c: depois[1] });
      return false;
    } },
  ]);
  void corpo;
}

// ---------- arquivos ----------

function novo() {
  if (Object.values(pasta.folhas).some((f) => Object.keys(f.celulas).length) && !confirm("Começar uma pasta nova? (salve antes se quiser guardar esta)")) return;
  trocarPasta(pastaVazia());
  historico.limpar(pasta);
}

async function abrir() {
  const a = await escolherArquivo();
  if (!a?.texto) return;
  try {
    if (/\.(csv|tsv|txt)$/i.test(a.nome)) {
      importarCSV(a.nome, a.texto, true);
      return;
    }
    const p = validarPasta(JSON.parse(a.texto));
    p.nome = p.nome || a.nome.replace(/\.[^.]+$/, "");
    trocarPasta(p);
    historico.limpar(pasta);
  } catch (e) {
    casca.avisar((e as Error).message || "Não foi possível abrir o arquivo.");
  }
}

function salvar() {
  baixar(JSON.stringify(pasta), pasta.nome, "wjpl");
  casca.avisar("Pasta salva (.wjpl).");
}

/** CSV: separador detectado (; , ou tabulação); numa planilha nova. */
function importarCSV(nome: string, texto: string, pastaNova = false) {
  const linha1 = texto.split(/\r?\n/)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => [s, linha1.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const linhas = lerTSV(texto, sep);
  const fl: Folha = { nome: nome.replace(/\.[^.]+$/, "").slice(0, 30) || "Importado", celulas: {} };
  linhas.forEach((cs, l) => cs.forEach((v, c) => {
    if (v === "") return;
    const sug = interpretarEntrada(v).formato;
    fl.celulas[chave(l, c)] = { e: v, ...(sug && sug !== "texto" ? { f: { tipo: sug } } : {}) };
  }));
  if (pastaNova) {
    const p = pastaVazia(fl.nome);
    p.folhas = [fl];
    trocarPasta(p);
    historico.limpar(pasta);
  } else {
    while (pasta.folhas.some((f) => f.nome.toLowerCase() === fl.nome.toLowerCase())) fl.nome += " (2)";
    alterar("Importar CSV", () => {
      pasta.folhas.push(fl);
      pasta.ativa = pasta.folhas.length - 1;
    });
    renderizarFolhas();
  }
  casca.avisar(`${linhas.length} linha(s) importada(s).`);
}

function exportarCSV() {
  const fl = folha();
  const d = calc.dimensao(fl.nome);
  const out: string[] = [];
  for (let l = 0; l < d.lins; l++) {
    const cs: string[] = [];
    for (let c = 0; c < d.cols; c++) {
      const cel = fl.celulas[chave(l, c)];
      const t = cel ? exibir(calc.valor(fl.nome, l, c), cel.f).texto : "";
      cs.push(/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
    }
    out.push(cs.join(";"));
  }
  // BOM: o CSV abre com acentos certos nas planilhas de mercado
  baixar("\ufeff" + out.join("\r\n"), `${pasta.nome} - ${fl.nome}`, "csv", "text/csv");
}

// ---------- faixa de comandos ----------

const TAMANHOS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map((t): [string, string] => [String(t), String(t)]);
const FORMATOS: [TipoFormato, string][] = [
  ["geral", "Geral"], ["numero", "Número"], ["moeda", "Moeda (R$)"], ["porcentagem", "Porcentagem"], ["data", "Data"],
  ["hora", "Hora"], ["dataHora", "Data e hora"], ["cientifico", "Científico"], ["texto", "Texto"],
];

const abas: Aba[] = [
  {
    id: "inicio", rotulo: "Início", grupos: [
      [
        { id: "colar", rotulo: "Colar", icone: "colar", dica: "Colar (Ctrl+V)", acao: () => void colarDaArea() },
        { id: "recortar", rotulo: "Recortar", icone: "recortar", peq: true, dica: "Recortar (Ctrl+X)", acao: () => grade.copiar(null, true) },
        { id: "copiar", rotulo: "Copiar", icone: "copiar", peq: true, dica: "Copiar (Ctrl+C)", acao: () => grade.copiar(null, false) },
      ],
      [
        { id: "tam", rotulo: "Tamanho da fonte", opcoes: () => TAMANHOS, valor: () => String(fmtAtivo().tamanho ?? 11), aoMudar: (v) => formatar("Tamanho", (f) => (f.tamanho = Number(v) === 11 ? undefined : Number(v))) },
        { id: "n", rotulo: "Negrito", icone: "negrito", peq: true, dica: "Negrito (Ctrl+N)", ativo: () => !!fmtAtivo().negrito, acao: () => alternar("negrito") },
        { id: "i", rotulo: "Itálico", icone: "italico", peq: true, dica: "Itálico (Ctrl+I)", ativo: () => !!fmtAtivo().italico, acao: () => alternar("italico") },
        { id: "s", rotulo: "Sublinhado", icone: "sublinhado", peq: true, dica: "Sublinhado (Ctrl+S…U)", ativo: () => !!fmtAtivo().sublinhado, acao: () => alternar("sublinhado") },
        { id: "r", rotulo: "Tachado", icone: "riscado", peq: true, ativo: () => !!fmtAtivo().riscado, acao: () => alternar("riscado") },
        { id: "cor", rotulo: "Cor da fonte", icone: "corTexto", peq: true, cor: { valor: () => fmtAtivo().cor ?? "#1e2730", aoMudar: (v) => formatar("Cor da fonte", (f) => (f.cor = v)) } },
        { id: "fundo", rotulo: "Cor de preenchimento", icone: "corFundo", peq: true, cor: { valor: () => fmtAtivo().fundo ?? "#ffff00", aoMudar: (v) => formatar("Preenchimento", (f) => (f.fundo = v)) } },
        { id: "borda", rotulo: "Bordas", icone: "borda", peq: true, ativo: () => !!fmtAtivo().borda, acao: () => alternar("borda") },
      ],
      [
        { id: "esq", rotulo: "Alinhar à esquerda", icone: "alinharEsq", peq: true, ativo: () => fmtAtivo().alinhar === "esquerda", acao: () => formatar("Alinhar", (f) => (f.alinhar = f.alinhar === "esquerda" ? undefined : "esquerda")) },
        { id: "cen", rotulo: "Centralizar", icone: "alinharCentro", peq: true, ativo: () => fmtAtivo().alinhar === "centro", acao: () => formatar("Alinhar", (f) => (f.alinhar = f.alinhar === "centro" ? undefined : "centro")) },
        { id: "dir", rotulo: "Alinhar à direita", icone: "alinharDir", peq: true, ativo: () => fmtAtivo().alinhar === "direita", acao: () => formatar("Alinhar", (f) => (f.alinhar = f.alinhar === "direita" ? undefined : "direita")) },
        { id: "quebrar", rotulo: "Quebrar texto", icone: "quebrar", peq: true, ativo: () => !!fmtAtivo().quebrar, acao: () => alternar("quebrar") },
      ],
      [
        { id: "fmt", rotulo: "Formato de número", opcoes: () => FORMATOS, valor: () => fmtAtivo().tipo ?? "geral", aoMudar: (v) => formatar("Formato de número", (f) => (f.tipo = v === "geral" ? undefined : (v as TipoFormato))) },
        { id: "moeda", rotulo: "Moeda", icone: "moeda", peq: true, acao: () => formatar("Moeda", (f) => ((f.tipo = "moeda"), (f.casas = 2))) },
        { id: "pct", rotulo: "Porcentagem", icone: "porcentagem", peq: true, acao: () => formatar("Porcentagem", (f) => (f.tipo = "porcentagem")) },
        { id: "milhar", rotulo: "Separador de milhar", icone: "milhar", peq: true, acao: () => formatar("Milhar", (f) => ((f.tipo ??= "numero"), (f.milhar = !f.milhar))) },
        { id: "casas+", rotulo: "Aumentar casas decimais", icone: "casasMais", peq: true, acao: () => formatar("Casas decimais", (f) => ((f.tipo ??= "numero"), (f.casas = Math.min(10, (f.casas ?? (f.tipo === "porcentagem" ? 0 : 2)) + 1)))) },
        { id: "casas-", rotulo: "Diminuir casas decimais", icone: "casasMenos", peq: true, acao: () => formatar("Casas decimais", (f) => ((f.tipo ??= "numero"), (f.casas = Math.max(0, (f.casas ?? (f.tipo === "porcentagem" ? 0 : 2)) - 1)))) },
      ],
      [
        { id: "inslin", rotulo: "Inserir linha", icone: "inserirLinha", peq: true, acao: () => inserirExcluir("lin", 1) },
        { id: "inscol", rotulo: "Inserir coluna", icone: "inserirColuna", peq: true, acao: () => inserirExcluir("col", 1) },
        { id: "exclin", rotulo: "Excluir linha", icone: "excluirLinha", peq: true, acao: () => inserirExcluir("lin", -1) },
        { id: "exccol", rotulo: "Excluir coluna", icone: "excluirColuna", peq: true, acao: () => inserirExcluir("col", -1) },
      ],
      [
        { id: "soma", rotulo: "AutoSoma", icone: "soma", dica: "AutoSoma (Alt+=)", acao: () => autoSoma() },
        { id: "az", rotulo: "Classificar A → Z", icone: "classificarAZ", peq: true, acao: () => classificar(1) },
        { id: "za", rotulo: "Classificar Z → A", icone: "classificarZA", peq: true, acao: () => classificar(-1) },
        { id: "limpar", rotulo: "Limpar", icone: "apagar", peq: true, acao: () => grade.limpar() },
        { id: "loc", rotulo: "Localizar", icone: "localizar", peq: true, dica: "Localizar (Ctrl+F)", acao: localizar },
      ],
    ],
  },
  {
    id: "inserir", rotulo: "Inserir", grupos: [
      [
        { id: "fx", rotulo: "Função", icone: "fx", acao: inserirFuncao },
        { id: "folha", rotulo: "Planilha", icone: "folha", acao: novaFolha },
        { id: "nome", rotulo: "Nome", icone: "nome", acao: gerenciarNomes },
      ],
      [
        { id: "linha", rotulo: "Linhas", icone: "inserirLinha", acao: () => inserirExcluir("lin", 1) },
        { id: "coluna", rotulo: "Colunas", icone: "inserirColuna", acao: () => inserirExcluir("col", 1) },
      ],
    ],
  },
  {
    id: "formulas", rotulo: "Fórmulas", grupos: [
      [
        { id: "fx", rotulo: "Inserir função", icone: "fx", acao: inserirFuncao },
        { id: "soma", rotulo: "Soma", icone: "soma", acao: () => autoSoma("SOMA") },
        { id: "media", rotulo: "Média", icone: "soma", acao: () => autoSoma("MÉDIA") },
        { id: "cont", rotulo: "Contar", icone: "soma", acao: () => autoSoma("CONT.NÚM") },
        { id: "max", rotulo: "Máximo", icone: "soma", acao: () => autoSoma("MÁXIMO") },
        { id: "min", rotulo: "Mínimo", icone: "soma", acao: () => autoSoma("MÍNIMO") },
      ],
      [
        { id: "nomes", rotulo: "Gerenciador de nomes", icone: "nome", acao: gerenciarNomes },
        { id: "mostrar", rotulo: "Mostrar fórmulas", icone: "fx", ativo: () => grade.mostrarFormulas, acao: () => ((grade.mostrarFormulas = !grade.mostrarFormulas), grade.redesenhar(), casca.renderizar()) },
        { id: "calc", rotulo: "Calcular agora", icone: "refazer", dica: "Recalcula tudo (F9)", acao: () => ((calc.invalidar()), grade.redesenhar(), aoMudarSelecao()) },
      ],
    ],
  },
  {
    id: "dados", rotulo: "Dados", grupos: [
      [
        { id: "az", rotulo: "Classificar A → Z", icone: "classificarAZ", acao: () => classificar(1) },
        { id: "za", rotulo: "Classificar Z → A", icone: "classificarZA", acao: () => classificar(-1) },
        { id: "dup", rotulo: "Remover duplicatas", icone: "filtro", acao: removerDuplicatas },
      ],
      [
        { id: "csvin", rotulo: "Importar CSV", icone: "importar", acao: async () => {
          const a = await escolherArquivo();
          if (a?.texto) importarCSV(a.nome, a.texto);
        } },
        { id: "csvout", rotulo: "Exportar CSV", icone: "exportar", acao: exportarCSV },
      ],
    ],
  },
  {
    id: "exibir", rotulo: "Exibir", grupos: [
      [
        { id: "congelar", rotulo: "Congelar painéis", icone: "congelar", dica: "Congela as linhas acima e as colunas à esquerda da célula ativa", ativo: () => !!(folha().congelar && (folha().congelar!.lin || folha().congelar!.col)), acao: () => {
          const fl = folha();
          const tem = fl.congelar && (fl.congelar.lin || fl.congelar.col);
          alterar("Congelar painéis", () => (fl.congelar = tem ? undefined : { lin: grade.ativa.l, col: grade.ativa.c }));
          grade.redesenhar();
        } },
        { id: "grade", rotulo: "Linhas de grade", icone: "grade", ativo: () => grade.mostrarGrade, acao: () => ((grade.mostrarGrade = !grade.mostrarGrade), grade.redesenhar(), casca.renderizar()) },
      ],
      [
        { id: "z+", rotulo: "Aumentar zoom", icone: "zoomMais", acao: () => grade.definirZoom(grade.zoom * 1.15) },
        { id: "z-", rotulo: "Diminuir zoom", icone: "zoomMenos", acao: () => grade.definirZoom(grade.zoom / 1.15) },
        { id: "z1", rotulo: "100%", icone: "localizar", acao: () => grade.definirZoom(1) },
      ],
    ],
  },
];

const casca = new Casca({
  app: "WJPlaniel",
  icone: "",
  extensao: "wjpl",
  abas,
  nomeDoc: () => pasta.nome,
  renomear: (n) => alterar("Renomear", () => (pasta.nome = n)),
  novo,
  abrir: () => void abrir(),
  salvar,
  desfazer: () => {
    const p = historico.desfazer();
    if (p) {
      Object.assign(pasta, p);
      calc.invalidar();
      autosave.guardar(CHAVE, pasta);
      grade.redesenhar();
      renderizarFolhas();
      aoMudarSelecao();
    }
  },
  refazer: () => {
    const p = historico.refazer();
    if (p) {
      Object.assign(pasta, p);
      calc.invalidar();
      autosave.guardar(CHAVE, pasta);
      grade.redesenhar();
      renderizarFolhas();
      aoMudarSelecao();
    }
  },
});

// atalhos (quando o foco está na grade)
document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const naGrade = document.activeElement?.classList.contains("pl-teclado");
  if (ctrl && e.key.toLowerCase() === "z" && !grade.editando) {
    e.preventDefault();
    casca.o.desfazer!();
  } else if (ctrl && e.key.toLowerCase() === "y" && !grade.editando) {
    e.preventDefault();
    casca.o.refazer!();
  } else if (ctrl && e.key.toLowerCase() === "f") {
    e.preventDefault();
    localizar();
  } else if (naGrade && ctrl && (e.key.toLowerCase() === "b" || e.key.toLowerCase() === "n")) {
    e.preventDefault();
    alternar("negrito");
  } else if (naGrade && ctrl && e.key.toLowerCase() === "i") {
    e.preventDefault();
    alternar("italico");
  } else if (naGrade && ctrl && e.key.toLowerCase() === "u") {
    e.preventDefault();
    alternar("sublinhado");
  } else if (naGrade && e.altKey && e.key === "=") {
    e.preventDefault();
    autoSoma();
  } else if (e.key === "F9") {
    e.preventDefault();
    calc.invalidar();
    grade.redesenhar();
  }
});

renderizarFolhas();
grade.atualizarEspaco();
grade.selecionar({ l: 0, c: 0 });
casca.definirStatus("Pronto");
if (matchMedia("(pointer: fine)").matches) grade.focar();
registrarOffline();

// testes automatizados (só em desenvolvimento)
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__pl = { pasta: () => pasta, grade, calc };
