// WJCronProject: cronogramas com tabela de tarefas + Gantt, caminho crítico, recursos, linha de base,
// valor agregado e quadro de cartões. Motor de agendamento puro em src/agenda/agenda.ts.
// Especificação: docs/global/cronograma.md.

import "./cronograma.css";
import { $, autosave, baixar, Casca, el, escapar, escolherArquivo, Historico, janela, menu, registrarOffline } from "../comum/casca";
import {
  calcular, calendarioPadrao, codigosEAP, dataBR, diaDaSemana, estrutura, formatarDuracao, formatarPredecessoras, hojeIso, iso,
  lerDataBR, lerDuracao, lerPredecessoras, RESTRICOES, serial, validarProjeto,
  type Atribuicao, type Calc, type Projeto, type Recurso, type Restricao, type Resultado, type Tarefa, type TipoVinculo,
} from "../agenda/agenda";

const CHAVE = "wjcron:documento";
const uid = () => Math.random().toString(36).slice(2, 10);
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: doc.moeda ?? "BRL" });
const num = (v: number, c = 2) => (Math.round(v * 10 ** c) / 10 ** c).toLocaleString("pt-BR");

function docVazio(): Projeto {
  return { formato: "wjcron", versao: 1, nome: "Projeto1", inicio: hojeIso(), calendario: calendarioPadrao(), tarefas: [], recursos: [] };
}

let doc: Projeto = (() => {
  try {
    const d = autosave.ler<Projeto>(CHAVE);
    return d ? validarProjeto(d) : docVazio();
  } catch {
    return docVazio();
  }
})();
let res: Resultado = calcular(doc);
const historico = new Historico<Projeto>();
historico.limpar(doc);

type Vista = "gantt" | "recursos" | "quadro";
type Mesa = "entrada" | "agenda" | "custo";
type Zoom = "dia" | "semana" | "mes";
let vista: Vista = "gantt";
let mesa: Mesa = "entrada";
let zoom: Zoom = "semana";
let filtro = "todas";
let critico = true;
/** linha visível ativa e coluna */
let ativa = { r: 0, c: 2 };
let selecao = new Set<string>();
let editor: { r: number; c: number; input: HTMLInputElement } | null = null;

const tabela = $<HTMLTableElement>("#cr-tabela");
const tabelaArea = $("#cr-tabela-area");
const ganttArea = $("#cr-gantt-area");
const ganttCab = $("#cr-gantt-cab");
const ganttCorpo = $("#cr-gantt-corpo");
const LINHAS_VAZIAS = 12;
const linhaPx = () => parseFloat(getComputedStyle(document.body).getPropertyValue("--cr-linha")) || 28;

// ---------- linhas visíveis ----------

interface Linha { i: number; t?: Tarefa }
let linhas: Linha[] = [];
let est = estrutura(doc.tarefas);
let eap: string[] = [];

function montarLinhas() {
  est = estrutura(doc.tarefas);
  eap = codigosEAP(doc.tarefas);
  const ts = doc.tarefas;
  const visivel = ts.map(() => true);
  // recolhidos
  ts.forEach((t, i) => {
    for (let p = est.pai[i]; p >= 0; p = est.pai[p]) if (ts[p].recolhida) visivel[i] = false;
  });
  // filtro (folhas que passam + seus resumos)
  if (filtro !== "todas") {
    const passa = ts.map((t, i) => {
      if (est.resumo[i]) return false;
      const c = res.t.get(t.id);
      if (filtro === "criticas") return !!c?.critica;
      if (filtro === "marcos") return !!t.marco || t.dur === 0;
      if (filtro === "incompletas") return t.pct < 100;
      if (filtro === "concluidas") return t.pct >= 100;
      if (filtro === "atrasadas") return !!c && atrasada(t, c);
      return true;
    });
    const mostra = ts.map(() => false);
    passa.forEach((p, i) => {
      if (!p) return;
      mostra[i] = true;
      for (let k = est.pai[i]; k >= 0; k = est.pai[k]) mostra[k] = true;
    });
    mostra.forEach((m, i) => (visivel[i] &&= m));
  }
  linhas = ts.map((t, i) => ({ i, t })).filter((l) => visivel[l.i]);
  if (filtro === "todas") for (let k = 0; k < LINHAS_VAZIAS; k++) linhas.push({ i: -1 });
}

const dataStatus = () => doc.status || hojeIso();
/** Atrasada: deveria ter avançado mais até a data de status. */
function atrasada(t: Tarefa, c: Calc) {
  if (t.pct >= 100) return false;
  const st = serial(dataStatus());
  if (serial(c.termino) < st) return true;
  if (serial(c.inicio) > st || c.dur <= 0) return false;
  const passados = res.cal.indice(st, true) + 1 - c.es;
  return t.pct < Math.min(100, (passados / c.dur) * 100) - 1e-6;
}

// ---------- colunas ----------

interface Col {
  id: string;
  titulo: string;
  w: number;
  cls?: string;
  html: (t: Tarefa, c: Calc | undefined, i: number) => string;
  texto?: (t: Tarefa, c: Calc | undefined, i: number) => string;
  editar?: (t: Tarefa, v: string, i: number) => string | void;
}

const dataCurta = (d: string) => (d ? `${SEMANA[diaDaSemana(serial(d))]} ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "");
const linhaDoId = (id: string) => {
  const i = doc.tarefas.findIndex((t) => t.id === id);
  return i < 0 ? undefined : i + 1;
};
const idDaLinha = (n: number) => doc.tarefas[n - 1]?.id;
const recursoPorId = (id: string) => doc.recursos.find((r) => r.id === id);

function textoRecursos(t: Tarefa) {
  return t.recursos
    .map((a) => {
      const r = recursoPorId(a.r);
      if (!r) return "";
      if (r.tipo === "trabalho") return a.un === 100 ? r.nome : `${r.nome}[${num(a.un)}%]`;
      if (r.tipo === "material") return `${r.nome}[${num(a.un)}${r.unidade ? ` ${r.unidade}` : ""}]`;
      return `${r.nome}[${moeda(a.un)}]`;
    })
    .filter(Boolean)
    .join(";");
}

function lerRecursos(txt: string): Atribuicao[] | string {
  const r: Atribuicao[] = [];
  for (const parte of txt.split(";").map((x) => x.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*(?:\[\s*(?:R\$\s*)?(\d+(?:[.,]\d+)?)\s*(%|[^\]]*)?\])?$/.exec(parte);
    if (!m) return `Recurso inválido: "${parte}" (use Nome ou Nome[50%]).`;
    const nome = m[1].trim();
    let rec = doc.recursos.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
    if (!rec) {
      rec = { id: uid(), nome, tipo: "trabalho", max: 100, taxa: 0, custoUso: 0 };
      doc.recursos.push(rec);
    }
    const un = m[2] ? Number(m[2].replace(",", ".")) : rec.tipo === "trabalho" ? 100 : rec.tipo === "material" ? 1 : 0;
    r.push({ r: rec.id, un });
  }
  return r;
}

const ehResumo = (i: number) => est.resumo[i];
const fmtFolga = (v?: number) => (v === undefined ? "" : formatarDuracao(Math.round(v * 100) / 100));

const COLS: Record<string, Col> = {
  id: { id: "id", titulo: "", w: 40, cls: "cr-id", html: (_t, _c, i) => String(i + 1) },
  ind: {
    id: "ind", titulo: "ⓘ", w: 44, cls: "centro",
    html: (t, c) => {
      let h = "";
      if (c?.conflito) h += `<span class="cr-ind" title="Restrição não atendida (folga negativa)">!</span>`;
      if (c?.limiteUltrapassado) h += `<span class="cr-ind" title="Data limite ultrapassada">◇</span>`;
      if (c?.superalocada) h += `<span class="cr-ind" title="Recurso superalocado">R</span>`;
      if (t.pct >= 100) h += `<span class="cr-ind ok" title="Concluída">✓</span>`;
      else if (t.notas) h += `<span class="cr-ind nota" title="${escapar(t.notas)}">≡</span>`;
      return h;
    },
  },
  eap: { id: "eap", titulo: "EAP", w: 54, html: (_t, _c, i) => eap[i] ?? "" },
  nome: {
    id: "nome", titulo: "Nome da tarefa", w: 230,
    html: (t, _c, i) => {
      const rec = (t.nivel - 1) * 16;
      const dob = ehResumo(i) ? `<span class="cr-dobrar" data-dobrar="${t.id}">${t.recolhida ? "▸" : "▾"}</span>` : `<span class="cr-dobrar"></span>`;
      return `<span style="padding-left:${rec}px">${dob}${escapar(t.nome)}</span>`;
    },
    texto: (t) => t.nome,
    editar: (t, v) => void (t.nome = v),
  },
  dur: {
    id: "dur", titulo: "Duração", w: 78, cls: "dir",
    html: (t, c, i) => (ehResumo(i) ? formatarDuracao(c?.dur ?? 0) : formatarDuracao(t.marco ? 0 : t.dur)),
    texto: (t) => String(t.marco ? 0 : t.dur).replace(".", ","),
    editar: (t, v, i) => {
      if (ehResumo(i)) return "A duração de um resumo vem das subtarefas.";
      const d = lerDuracao(v, doc.calendario.horasDia);
      if (d === null) return `Duração inválida: "${v}" (ex.: 5, 2 sem, 4h).`;
      t.dur = d;
      t.marco = d === 0;
    },
  },
  ini: {
    id: "ini", titulo: "Início", w: 104,
    html: (_t, c) => (c ? dataCurta(c.inicio) : ""),
    texto: (_t, c) => (c ? dataBR(c.inicio) : ""),
    editar: (t, v, i) => {
      if (ehResumo(i)) return "O início de um resumo vem das subtarefas.";
      const d = lerDataBR(v);
      if (!d) return `Data inválida: "${v}".`;
      t.restricao = "SNET";
      t.dataRestricao = d;
    },
  },
  fim: {
    id: "fim", titulo: "Término", w: 104,
    html: (_t, c) => (c ? dataCurta(c.termino) : ""),
    texto: (_t, c) => (c ? dataBR(c.termino) : ""),
    editar: (t, v, i) => {
      if (ehResumo(i)) return "O término de um resumo vem das subtarefas.";
      const d = lerDataBR(v);
      const c = res.t.get(t.id);
      if (!d || !c) return `Data inválida: "${v}".`;
      const n = res.cal.diasUteis(c.inicio, d);
      if (n < 1) return "O término não pode ser antes do início.";
      t.dur = n;
      t.marco = false;
    },
  },
  pred: {
    id: "pred", titulo: "Predecessoras", w: 104,
    html: (t) => escapar(formatarPredecessoras(t.pred, linhaDoId)),
    texto: (t) => formatarPredecessoras(t.pred, linhaDoId),
    editar: (t, v) => {
      const p = lerPredecessoras(v, idDaLinha, doc.calendario.horasDia);
      if (typeof p === "string") return p;
      if (p.some((x) => x.de === t.id)) return "Uma tarefa não pode ser predecessora dela mesma.";
      t.pred = p;
    },
  },
  rec: {
    id: "rec", titulo: "Nomes dos recursos", w: 150,
    html: (t) => escapar(textoRecursos(t)),
    texto: (t) => textoRecursos(t),
    editar: (t, v, i) => {
      if (ehResumo(i) && v.trim()) return "Atribua recursos às subtarefas, não ao resumo.";
      const r = lerRecursos(v);
      if (typeof r === "string") return r;
      t.recursos = r;
    },
  },
  pct: {
    id: "pct", titulo: "% concl.", w: 64, cls: "dir",
    html: (t, c, i) => `${ehResumo(i) ? c?.pct ?? 0 : t.pct}%`,
    texto: (t) => String(t.pct),
    editar: (t, v, i) => {
      const n = Number(v.replace("%", "").replace(",", "."));
      if (!Number.isFinite(n)) return "Informe um número de 0 a 100.";
      definirPct(i, Math.max(0, Math.min(100, Math.round(n))));
    },
  },
  ls: { id: "ls", titulo: "Início tardio", w: 104, html: (_t, c) => (c ? dataCurta(res.cal.dataInicio(c.ls)) : "") },
  lf: { id: "lf", titulo: "Término tardio", w: 104, html: (_t, c) => (c ? dataCurta(res.cal.dataTermino(c.lf)) : "") },
  ft: { id: "ft", titulo: "Folga total", w: 84, cls: "dir", html: (_t, c) => fmtFolga(c?.folgaTotal) },
  fl: { id: "fl", titulo: "Folga livre", w: 84, cls: "dir", html: (_t, c, i) => (ehResumo(i) ? "" : fmtFolga(c?.folgaLivre)) },
  rest: {
    id: "rest", titulo: "Restrição", w: 170,
    html: (t) => {
      const r = RESTRICOES.find(([k]) => k === (t.restricao ?? "ASAP"))![1];
      return escapar(t.restricao && t.restricao !== "ASAP" && t.restricao !== "ALAP" ? `${r} ${dataBR(t.dataRestricao ?? "")}` : r);
    },
  },
  lim: {
    id: "lim", titulo: "Data limite", w: 96,
    html: (t) => (t.limite ? dataCurta(t.limite) : ""),
    texto: (t) => (t.limite ? dataBR(t.limite) : ""),
    editar: (t, v) => {
      if (!v.trim()) return void (t.limite = undefined);
      const d = lerDataBR(v);
      if (!d) return `Data inválida: "${v}".`;
      t.limite = d;
    },
  },
  trab: { id: "trab", titulo: "Trabalho", w: 90, cls: "dir", html: (_t, c) => (c ? `${num(c.trabalho, 1)} h` : "") },
  custo: { id: "custo", titulo: "Custo", w: 110, cls: "dir", html: (_t, c) => (c ? moeda(c.custo) : "") },
  bcusto: { id: "bcusto", titulo: "Custo da LB", w: 110, cls: "dir", html: (t, _c, i) => (custoBase(i, t) === undefined ? "" : moeda(custoBase(i, t)!)) },
  var: {
    id: "var", titulo: "Variação de custo", w: 120, cls: "dir",
    html: (t, c, i) => {
      const b = custoBase(i, t);
      return b === undefined || !c ? "" : moeda(c.custo - b);
    },
  },
  bini: { id: "bini", titulo: "Início da LB", w: 104, html: (t, _c, i) => dataCurta(baseDe(i, t)?.ini ?? "") },
  bfim: { id: "bfim", titulo: "Término da LB", w: 104, html: (t, _c, i) => dataCurta(baseDe(i, t)?.fim ?? "") },
  vterm: {
    id: "vterm", titulo: "Variação de término", w: 120, cls: "dir",
    html: (t, c, i) => {
      const b = baseDe(i, t);
      if (!b || !c) return "";
      return formatarDuracao(res.cal.indice(serial(c.termino), true) - res.cal.indice(serial(b.fim), true));
    },
  },
};

const MESAS: Record<Mesa, string[]> = {
  entrada: ["id", "ind", "nome", "dur", "ini", "fim", "pred", "rec", "pct"],
  agenda: ["id", "eap", "nome", "ini", "fim", "ls", "lf", "ft", "fl", "rest", "lim"],
  custo: ["id", "nome", "trab", "custo", "bcusto", "var", "bini", "bfim", "vterm"],
};
const colunas = () => MESAS[mesa].map((k) => COLS[k]);

/** Linha de base (resumos: acumulada das folhas). */
function baseDe(i: number, t: Tarefa) {
  if (!ehResumo(i)) return t.base;
  const fs = doc.tarefas.filter((x, k) => k > i && x.base && !ehResumo(k) && descende(k, i));
  if (!fs.length) return undefined;
  return {
    ini: fs.map((x) => x.base!.ini).sort()[0],
    fim: fs.map((x) => x.base!.fim).sort().at(-1)!,
    dur: 0,
    custo: fs.reduce((s, x) => s + x.base!.custo, 0),
  };
}
const custoBase = (i: number, t: Tarefa) => baseDe(i, t)?.custo;
function descende(k: number, i: number) {
  for (let p = est.pai[k]; p >= 0; p = est.pai[p]) if (p === i) return true;
  return false;
}
/** Folhas (índices) de uma linha. */
function folhasDe(i: number) {
  if (!ehResumo(i)) return [i];
  const r: number[] = [];
  for (let k = i + 1; k < doc.tarefas.length && doc.tarefas[k].nivel > doc.tarefas[i].nivel; k++) if (!ehResumo(k)) r.push(k);
  return r;
}
/** Fim do bloco (a linha e suas subtarefas). */
function fimDoBloco(i: number) {
  let k = i + 1;
  while (k < doc.tarefas.length && doc.tarefas[k].nivel > doc.tarefas[i].nivel) k++;
  return k;
}
function definirPct(i: number, v: number) {
  for (const k of folhasDe(i)) doc.tarefas[k].pct = v;
}

// ---------- tabela ----------

function renderizarTabela() {
  const cols = colunas();
  const largura = cols.reduce((s, c) => s + c.w, 0);
  tabela.style.width = `${largura}px`;
  let h = `<colgroup>${cols.map((c) => `<col style="width:${c.w}px">`).join("")}</colgroup><thead><tr>`;
  h += cols.map((c) => `<th title="${escapar(c.titulo)}">${escapar(c.titulo)}</th>`).join("");
  h += "</tr></thead><tbody>";
  linhas.forEach((l, r) => {
    if (!l.t) {
      h += `<tr class="vazia" data-r="${r}">${cols.map((c, k) => `<td class="${c.cls ?? ""}${ativa.r === r && ativa.c === k ? " ativa" : ""}"></td>`).join("")}</tr>`;
      return;
    }
    const t = l.t, c = res.t.get(t.id);
    const cls = [selecao.has(t.id) ? "sel" : "", ehResumo(l.i) ? "resumo" : "", t.inativa ? "inativa" : ""].join(" ");
    h += `<tr class="${cls}" data-r="${r}">`;
    cols.forEach((col, k) => {
      const crit = critico && c?.critica && (col.id === "nome" || col.id === "ini" || col.id === "fim") && !ehResumo(l.i) ? " critica" : "";
      h += `<td class="${col.cls ?? ""}${crit}${ativa.r === r && ativa.c === k ? " ativa" : ""}">${col.html(t, c, l.i)}</td>`;
    });
    h += "</tr>";
  });
  tabela.innerHTML = h + "</tbody>";
  posicionarTeclado();
}

function iniciarEdicao(texto?: string) {
  const col = colunas()[ativa.c];
  const l = linhas[ativa.r];
  if (!col || !l) return;
  if (!col.editar) return casca.avisar(`"${col.titulo || "Id"}" é calculado: não se edita.`);
  const td = tabela.tBodies[0]?.rows[ativa.r]?.cells[ativa.c];
  if (!td) return;
  const input = el("input", { type: "text" }) as HTMLInputElement;
  input.value = texto ?? (l.t ? (col.texto ?? ((t: Tarefa) => t.nome))(l.t, res.t.get(l.t.id), l.i) : "");
  td.textContent = "";
  td.append(input);
  input.focus();
  if (texto === undefined) input.select();
  editor = { r: ativa.r, c: ativa.c, input };
  ligarEditor(input);
}

/**
 * Campo escondido sobre a célula ativa: recebe as teclas. Quando o navegador não diz a tecla
 * (teclado virtual do celular/tablet, acentos ´ ~ ^, sugestões), ele mesmo vira o editor no
 * lugar, para o texto aparecer enquanto é digitado.
 */
const teclado = el("input", { type: "text", class: "cr-teclado", autocomplete: "off", "aria-label": "Célula do cronograma" }) as HTMLInputElement;
tabelaArea.append(teclado);
function editarNoLugar() {
  if (editor || vista !== "gantt") return;
  const col = colunas()[ativa.c], l = linhas[ativa.r];
  if (!col || !l || !col.editar) return;
  teclado.classList.add("ativo");
  editor = { r: ativa.r, c: ativa.c, input: teclado };
  ligarEditor(teclado);
}
teclado.addEventListener("compositionstart", editarNoLugar);
teclado.addEventListener("input", () => !editor && teclado.value && editarNoLugar());
function posicionarTeclado() {
  if (editor?.input === teclado) return;
  teclado.classList.remove("ativo");
  teclado.value = "";
  teclado.onkeydown = teclado.onblur = null;
  const td = tabela.tBodies[0]?.rows[ativa.r]?.cells[ativa.c];
  if (!td) return;
  Object.assign(teclado.style, { left: `${td.offsetLeft}px`, top: `${td.offsetTop}px`, width: `${td.offsetWidth}px`, height: `${td.offsetHeight}px` });
}

function ligarEditor(input: HTMLInputElement) {
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (confirmarEdicao()) mover(1, 0);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (confirmarEdicao()) mover(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      editor = null;
      renderizar();
    }
  };
  input.onblur = () => {
    if (editor?.input === input) confirmarEdicao();
  };
}

/** Grava o editor aberto; false se o valor foi recusado. */
function confirmarEdicao(): boolean {
  if (!editor) return true;
  const { r, c, input } = editor;
  editor = null;
  const col = colunas()[c];
  const v = input.value.trim();
  let l = linhas[r];
  if (!l.t) {
    if (!v) return renderizar(), true;
    const ant = doc.tarefas[doc.tarefas.length - 1];
    const t: Tarefa = { id: uid(), nome: "", nivel: ant ? (est.resumo[doc.tarefas.length - 1] ? ant.nivel + 1 : ant.nivel) : 1, dur: 1, pred: [], pct: 0, recursos: [] };
    doc.tarefas.push(t);
    est = estrutura(doc.tarefas);
    l = { i: doc.tarefas.length - 1, t };
    linhas[r] = l;
    if (col.id !== "nome") t.nome = `Tarefa ${doc.tarefas.length}`;
  }
  const erro = col.editar!(l.t!, v, l.i);
  if (erro) {
    casca.avisar(erro, 5000);
    mudou();
    return false;
  }
  selecao = new Set([l.t!.id]);
  mudou();
  return true;
}

function mover(dr: number, dc: number) {
  const n = colunas().length;
  ativa = { r: Math.max(0, Math.min(linhas.length - 1, ativa.r + dr)), c: Math.max(1, Math.min(n - 1, ativa.c + dc)) };
  const t = linhas[ativa.r]?.t;
  selecao = new Set(t ? [t.id] : []);
  renderizar();
  rolarAte(ativa.r);
}

function rolarAte(r: number) {
  const L = linhaPx(), cab = tabelaArea.querySelector("thead")?.getBoundingClientRect().height ?? 44;
  const y = r * L;
  if (y < tabelaArea.scrollTop) tabelaArea.scrollTop = y;
  else if (y + L > tabelaArea.scrollTop + tabelaArea.clientHeight - cab) tabelaArea.scrollTop = y + L - tabelaArea.clientHeight + cab;
}

let ultimoToque = { t: 0, r: -1, c: -1 };
tabela.addEventListener("pointerdown", (e) => {
  const td = (e.target as HTMLElement).closest("td");
  if (!td || td.querySelector("input")) return;
  const dob = (e.target as HTMLElement).closest<HTMLElement>("[data-dobrar]");
  if (dob) {
    const t = doc.tarefas.find((x) => x.id === dob.dataset.dobrar);
    if (t) (t.recolhida = !t.recolhida), mudou(false);
    return;
  }
  if (editor) confirmarEdicao();
  const r = Number(td.parentElement!.dataset.r), c = td.cellIndex;
  // duplo toque/clique detectado aqui: a tabela é redesenhada a cada toque e o "dblclick" se perde
  const agora = Date.now();
  const duplo = agora - ultimoToque.t < 450 && ultimoToque.r === r && ultimoToque.c === c;
  ultimoToque = { t: duplo ? 0 : agora, r, c };
  if (duplo) {
    e.preventDefault();
    const t = linhas[r]?.t;
    if (c === 0) return void (t && informacoes(t));
    return iniciarEdicao();
  }
  const t = linhas[r]?.t;
  if (t && (e.shiftKey || e.ctrlKey || e.metaKey)) {
    if (e.ctrlKey || e.metaKey) selecao.has(t.id) ? selecao.delete(t.id) : selecao.add(t.id);
    else {
      const [a, b] = [Math.min(ativa.r, r), Math.max(ativa.r, r)];
      selecao = new Set(linhas.slice(a, b + 1).flatMap((l) => (l.t ? [l.t.id] : [])));
    }
  } else selecao = new Set(t ? [t.id] : []);
  ativa = { r, c: c === 0 ? ativa.c : c };
  renderizar();
  // mouse e caneta: foco no campo da célula (no dedo, abriria o teclado virtual a cada toque)
  if (e.pointerType === "touch") return;
  e.preventDefault();
  teclado.focus({ preventScroll: true });
});
tabela.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const td = (e.target as HTMLElement).closest("td");
  if (td) {
    const r = Number(td.parentElement!.dataset.r);
    const t = linhas[r]?.t;
    if (t && !selecao.has(t.id)) (selecao = new Set([t.id])), (ativa = { r, c: td.cellIndex || ativa.c }), renderizar();
  }
  menuTarefas(e.clientX, e.clientY);
});
tabelaArea.tabIndex = -1;
document.addEventListener("keydown", (e) => {
  if (editor || vista !== "gantt" || document.querySelector(".wj-fundo, .wj-menu") || e.isComposing) return;
  if (e.target !== teclado && (e.target as HTMLElement).closest("input, textarea, select")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === "ArrowDown") mover(1, 0);
  else if (e.key === "ArrowUp") mover(-1, 0);
  else if (e.key === "ArrowRight" && e.altKey && e.shiftKey) recuar(1);
  else if (e.key === "ArrowLeft" && e.altKey && e.shiftKey) recuar(-1);
  else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) mover(0, 1);
  else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) mover(0, -1);
  else if (e.key === "Enter" || e.key === "F2") {
    if (e.key === "F2" && e.shiftKey) {
      const t = linhas[ativa.r]?.t;
      if (t) informacoes(t);
    } else if (e.key === "F2" && ctrl) vincular();
    else iniciarEdicao();
  } else if (e.key === "Insert") inserir(false);
  else if (e.key === "Delete") excluir();
  else if (e.key.length === 1 && !ctrl && !e.altKey) {
    iniciarEdicao(e.key);
  } else return;
  e.preventDefault();
});

function menuTarefas(x: number, y: number) {
  menu(x, y, [
    { rotulo: "Informações da tarefa…", icone: "editar", acao: () => selecionadas()[0] && informacoes(selecionadas()[0]) },
    "-",
    { rotulo: "Inserir tarefa", icone: "tarefa", acao: () => inserir(false) },
    { rotulo: "Inserir marco", icone: "marco", acao: () => inserir(true) },
    { rotulo: "Excluir tarefa", icone: "apagar", acao: excluir },
    "-",
    { rotulo: "Recuar", icone: "recuoMais", acao: () => recuar(1) },
    { rotulo: "Recuar à esquerda", icone: "recuoMenos", acao: () => recuar(-1) },
    { rotulo: "Vincular tarefas", icone: "vincular", acao: vincular },
    { rotulo: "Desvincular tarefas", icone: "desvincular", acao: desvincular },
    "-",
    { rotulo: "0% concluída", acao: () => pctSel(0) },
    { rotulo: "50% concluída", acao: () => pctSel(50) },
    { rotulo: "100% concluída", acao: () => pctSel(100) },
  ]);
}

// ---------- comandos de tarefa ----------

const selecionadas = () => doc.tarefas.filter((t) => selecao.has(t.id));
const indiceAtivo = () => {
  const l = linhas[ativa.r];
  return l?.t ? l.i : doc.tarefas.length;
};

function inserir(marco: boolean) {
  const i = indiceAtivo();
  const ref = doc.tarefas[i] ?? doc.tarefas[i - 1];
  const t: Tarefa = { id: uid(), nome: marco ? "Marco" : "Nova tarefa", nivel: ref?.nivel ?? 1, dur: marco ? 0 : 1, marco, pred: [], pct: 0, recursos: [] };
  doc.tarefas.splice(i, 0, t);
  selecao = new Set([t.id]);
  mudou();
  ativa = { r: linhas.findIndex((l) => l.t === t), c: colunas().findIndex((c) => c.id === "nome") };
  renderizar();
  iniciarEdicao();
}

function excluir() {
  const ids = new Set<string>();
  doc.tarefas.forEach((t, i) => {
    if (!selecao.has(t.id)) return;
    for (let k = i; k < fimDoBloco(i); k++) ids.add(doc.tarefas[k].id);
  });
  if (!ids.size) return;
  doc.tarefas = doc.tarefas.filter((t) => !ids.has(t.id));
  for (const t of doc.tarefas) t.pred = t.pred.filter((v) => !ids.has(v.de));
  selecao.clear();
  mudou();
}

/** Recuar (+1) ou recuar à esquerda (-1) as selecionadas com suas subtarefas. */
function recuar(d: 1 | -1) {
  const ts = doc.tarefas;
  let mexeu = false;
  for (let i = 0; i < ts.length; i++) {
    if (!selecao.has(ts[i].id)) continue;
    const fim = fimDoBloco(i);
    const max = i > 0 ? ts[i - 1].nivel + 1 : 1;
    const novo = Math.max(1, Math.min(max, ts[i].nivel + d));
    const delta = novo - ts[i].nivel;
    if (delta) {
      for (let k = i; k < fim; k++) ts[k].nivel += delta;
      mexeu = true;
    }
    i = fim - 1;
  }
  if (mexeu) mudou();
}

function vincular() {
  const ts = selecionadas();
  if (ts.length < 2) return casca.avisar("Selecione duas ou mais tarefas (Ctrl ou Shift + clique no Id) para vincular em sequência.");
  for (let k = 1; k < ts.length; k++) {
    if (!ts[k].pred.some((v) => v.de === ts[k - 1].id)) ts[k].pred.push({ de: ts[k - 1].id, tipo: "TI", lat: 0, latUn: "d" });
  }
  mudou();
}

function desvincular() {
  const ts = selecionadas();
  if (!ts.length) return;
  if (ts.length === 1) {
    const id = ts[0].id;
    ts[0].pred = [];
    for (const t of doc.tarefas) t.pred = t.pred.filter((v) => v.de !== id);
  } else for (const t of ts) t.pred = t.pred.filter((v) => !selecao.has(v.de));
  mudou();
}

function pctSel(v: number) {
  doc.tarefas.forEach((t, i) => selecao.has(t.id) && definirPct(i, v));
  mudou();
}

function rolarAteTarefa() {
  const t = selecionadas()[0];
  const c = t && res.t.get(t.id);
  if (!c) return;
  ganttArea.scrollLeft = Math.max(0, xIni(c.es) - 40);
}

// ---------- Gantt ----------

const PX: Record<Zoom, number> = { dia: 28, semana: 14, mes: 4 };
let s0 = 0;
let px = 14;

/** x do começo de t (tempo em dias úteis) e do fim. */
function xIni(t: number) {
  const k = Math.floor(t + 1e-9);
  return (res.cal.data(k) - s0 + (t - k)) * px;
}
function xFim(t: number) {
  const k = Math.ceil(t - 1e-9);
  return (res.cal.data(k - 1) - s0 + 1 - (k - t)) * px;
}

function renderizarGantt() {
  px = PX[zoom];
  const L = linhaPx();
  const ini = serial(res.inicio);
  const fim = serial(res.termino);
  s0 = ini - (zoom === "mes" ? 15 : 3);
  // começa na segunda (ou no 1º do mês)
  if (zoom === "mes") s0 = serial(`${iso(s0).slice(0, 8)}01`);
  else while (diaDaSemana(s0) !== 1) s0--;
  const dias = Math.max(fim - s0 + (zoom === "mes" ? 120 : 30), Math.ceil(ganttArea.clientWidth / px) + 7);
  const W = dias * px, H = linhas.length * L;

  // cabeçalho em dois níveis
  let cab = "";
  const dt = (s: number) => new Date(s * 86400000);
  const sup: [number, number, string][] = [], inf: [number, number, string][] = [];
  for (let s = s0; s < s0 + dias; s++) {
    const d = dt(s), dia = d.getUTCDate(), mes = d.getUTCMonth(), ano = d.getUTCFullYear();
    if (zoom === "mes") {
      if (dia === 1 || s === s0) {
        inf.push([s, 0, MESES[mes].slice(0, 3)]);
        if (mes === 0 || s === s0) sup.push([s, 0, String(ano)]);
      }
    } else {
      if (dia === 1 || s === s0) sup.push([s, 0, `${MESES[mes]} ${ano}`]);
      if (zoom === "dia") inf.push([s, 0, `${SEMANA[diaDaSemana(s)][0].toUpperCase()} ${dia}`]);
      else if (diaDaSemana(s) === 1) inf.push([s, 0, `${String(dia).padStart(2, "0")}/${String(mes + 1).padStart(2, "0")}`]);
    }
  }
  const linhaV = (s: number, y1: number, y2: number) => `<line x1="${(s - s0) * px + 0.5}" y1="${y1}" x2="${(s - s0) * px + 0.5}" y2="${y2}" stroke="#c9d1d9"/>`;
  for (const [s, , t] of sup) cab += linhaV(s, 0, 22) + `<text x="${(s - s0) * px + 4}" y="15">${t}</text>`;
  for (const [s, , t] of inf) cab += linhaV(s, 22, 44) + `<text x="${(s - s0) * px + 3}" y="37">${t}</text>`;
  ganttCab.innerHTML = `<svg width="${W}" height="44"><line x1="0" y1="22.5" x2="${W}" y2="22.5" stroke="#c9d1d9"/>${cab}</svg>`;

  // fundo: fins de semana/feriados, linhas, seleção
  let g = "";
  if (zoom !== "mes") {
    for (let s = s0; s < s0 + dias; s++) {
      if (res.cal.util(s)) continue;
      const fer = res.cal.feriado(s);
      g += `<rect x="${(s - s0) * px}" y="0" width="${px}" height="${H}" fill="${fer ? "#fbeee6" : "#f1f3f5"}">${fer ? `<title>${escapar(fer)}</title>` : ""}</rect>`;
    }
  }
  for (const [s] of inf) g += `<line x1="${(s - s0) * px + 0.5}" y1="0" x2="${(s - s0) * px + 0.5}" y2="${H}" stroke="#eef1f4"/>`;
  linhas.forEach((l, r) => {
    if (l.t && selecao.has(l.t.id)) g += `<rect x="0" y="${r * L}" width="${W}" height="${L}" fill="#e8f1fb"/>`;
    g += `<line x1="0" y1="${(r + 1) * L - 0.5}" x2="${W}" y2="${(r + 1) * L - 0.5}" stroke="#f0f2f4"/>`;
  });
  // hoje e data de status
  const hoje = serial(hojeIso());
  g += `<line x1="${(hoje - s0) * px + px / 2}" y1="0" x2="${(hoje - s0) * px + px / 2}" y2="${H}" stroke="#2e8b57" stroke-dasharray="4 3"><title>Hoje</title></line>`;
  if (doc.status) {
    const st = serial(doc.status);
    g += `<line x1="${(st - s0 + 1) * px}" y1="0" x2="${(st - s0 + 1) * px}" y2="${H}" stroke="#7b4bb7" stroke-width="1.5"><title>Data de status</title></line>`;
  }

  // vínculos
  const pos = new Map<string, number>();
  linhas.forEach((l, r) => l.t && pos.set(l.t.id, r));
  let v = "";
  for (const l of linhas) {
    if (!l.t) continue;
    const b = res.t.get(l.t.id);
    if (!b) continue;
    const rb = pos.get(l.t.id)!;
    for (const p of l.t.pred) {
      const ra = pos.get(p.de), a = res.t.get(p.de);
      if (ra === undefined || !a) continue;
      v += caminhoVinculo(p.tipo, a, b, ra, rb, L, critico && a.critica && b.critica && !a.resumo && !b.resumo);
    }
  }

  // barras
  let bar = "";
  linhas.forEach((l, r) => {
    if (!l.t) return;
    const t = l.t, c = res.t.get(t.id);
    if (!c) return;
    const y = r * L, ym = y + L / 2, hb = Math.min(14, L * 0.45);
    const x1 = xIni(c.es), x2 = c.dur > 0 ? xFim(c.ef) : x1;
    let h = "";
    // linha de base
    const base = baseDe(l.i, t);
    if (base?.ini) {
      const bx1 = (serial(base.ini) - s0) * px, bx2 = (serial(base.fim) - s0 + 1) * px;
      h += `<rect x="${bx1}" y="${ym + hb / 2 + 1}" width="${Math.max(2, bx2 - bx1)}" height="4" fill="#9aa6b2"><title>Linha de base: ${dataBR(base.ini)} a ${dataBR(base.fim)}</title></rect>`;
    }
    if (c.resumo) {
      const yb = ym - 4;
      h += `<path d="M${x1} ${yb}H${x2}v7l-5 -4H${x1 + 5}l-5 4z" fill="#33414f"/>`;
      if (c.pct) h += `<rect x="${x1}" y="${yb + 1}" width="${(x2 - x1) * (c.pct / 100)}" height="2" fill="#8fd19e"/>`;
    } else if (c.dur === 0) {
      const xm = c.es > 0 && Math.abs(c.es - Math.round(c.es)) < 1e-9 ? xFim(c.es) : x1;
      const s = hb / 2 + 2;
      h += `<path class="cr-barra" data-id="${t.id}" d="M${xm} ${ym - s}l${s} ${s}l${-s} ${s}l${-s} ${-s}z" fill="${critico && c.critica ? "#c9372c" : "#33414f"}"/>`;
      h += `<text x="${xm + s + 4}" y="${ym + 4}">${dataBR(c.termino).slice(0, 5)}</text>`;
    } else {
      const cor = critico && c.critica ? "#d9534f" : "#4a8fd6";
      h += `<g class="cr-barra" data-id="${t.id}"><rect x="${x1}" y="${ym - hb / 2}" width="${Math.max(2, x2 - x1)}" height="${hb}" rx="2" fill="${cor}" fill-opacity="${t.inativa ? 0.35 : 1}"/>`;
      if (t.pct) h += `<rect x="${x1}" y="${ym - 2}" width="${(x2 - x1) * (t.pct / 100)}" height="4" fill="#1e2730" fill-opacity=".55"/>`;
      h += `<rect class="cr-alca" x="${x2 - 6}" y="${ym - hb / 2}" width="8" height="${hb}" fill="transparent" style="cursor:ew-resize"/></g>`;
      const rot = textoRecursos(t);
      if (rot) h += `<text x="${x2 + 5}" y="${ym + 4}">${escapar(rot)}</text>`;
    }
    bar += h;
  });

  ganttCorpo.innerHTML = `<svg width="${W}" height="${Math.max(H, 10)}">
    <defs><marker id="cr-seta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="context-stroke"/></marker></defs>
    ${g}<g fill="none" stroke-width="1.2">${v}</g>${bar}</svg>`;
}

function caminhoVinculo(tipo: TipoVinculo, a: Calc, b: Calc, ra: number, rb: number, L: number, crit: boolean) {
  const cor = crit ? "#c9372c" : "#5b6b7b";
  const ya = ra * L + L / 2, yb = rb * L + L / 2;
  const aIni = xIni(a.es), aFim = a.dur > 0 ? xFim(a.ef) : xIni(a.es);
  const bIni = xIni(b.es), bFim = b.dur > 0 ? xFim(b.ef) : xIni(b.es);
  const meio = (ya + yb) / 2 + (yb > ya ? L / 2 - (yb - ya) / 2 : 0);
  let d: string;
  if (tipo === "TI") {
    if (bIni >= aFim + 8) d = `M${aFim} ${ya}H${bIni + 4}V${yb + (yb > ya ? -7 : 7)}`;
    else d = `M${aFim} ${ya}h6V${yb > ya ? ra * L + L : ra * L}H${bIni - 8}V${yb}H${bIni - 1}`;
    void meio;
  } else if (tipo === "II") d = `M${aIni} ${ya}H${Math.min(aIni, bIni) - 8}V${yb}H${bIni - 1}`;
  else if (tipo === "TT") d = `M${aFim} ${ya}H${Math.max(aFim, bFim) + 8}V${yb}H${bFim + 1}`;
  else d = `M${aIni} ${ya}H${Math.min(aIni, bFim) - 8}V${yb}H${bFim + 1}`;
  return `<path d="${d}" stroke="${cor}" marker-end="url(#cr-seta)"/>`;
}

// sincroniza a rolagem vertical da tabela e do Gantt
let sincronizando = false;
for (const [a, b] of [[tabelaArea, ganttArea], [ganttArea, tabelaArea]] as const) {
  a.addEventListener("scroll", () => {
    if (sincronizando) return;
    sincronizando = true;
    b.scrollTop = a.scrollTop;
    requestAnimationFrame(() => (sincronizando = false));
  });
}

// arrastar barras: mover (restrição "não iniciar antes de"), alongar, ou puxar para outra linha = vincular
const dica = el("div", { class: "cr-dica" });
dica.hidden = true;
document.body.append(dica);

ganttCorpo.addEventListener("pointerdown", (e) => {
  const alvo = (e.target as Element).closest<SVGElement>(".cr-barra");
  const L = linhaPx();
  const svg = ganttCorpo.querySelector("svg")!;
  const r0 = svg.getBoundingClientRect();
  if (!alvo) {
    const r = Math.floor((e.clientY - r0.top) / L);
    const t = linhas[r]?.t;
    selecao = new Set(t ? [t.id] : []);
    if (r < linhas.length) ativa = { r, c: ativa.c };
    renderizar();
    return;
  }
  e.preventDefault();
  const t = doc.tarefas.find((x) => x.id === alvo.dataset.id)!;
  const c = res.t.get(t.id)!;
  const i = doc.tarefas.indexOf(t);
  const modo0 = (e.target as Element).classList.contains("cr-alca") ? "dur" : "mover";
  let modo: "dur" | "mover" | "vincular" = modo0;
  const x0 = e.clientX, y0 = e.clientY;
  let dd = 0, mexeu = false;
  ganttCorpo.setPointerCapture(e.pointerId);
  const linhaV = document.createElementNS("http://www.w3.org/2000/svg", "line");
  linhaV.setAttribute("stroke", "#2f7fd0");
  linhaV.setAttribute("stroke-width", "2");
  linhaV.setAttribute("stroke-dasharray", "5 3");
  const mov = (ev: PointerEvent) => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!mexeu && Math.hypot(dx, dy) < 4) return;
    mexeu = true;
    if (modo === "mover" && Math.abs(dy) > L * 0.8) {
      modo = "vincular";
      alvo.setAttribute("transform", "");
      svg.append(linhaV);
    }
    if (modo === "vincular") {
      linhaV.setAttribute("x1", String(x0 - r0.left));
      linhaV.setAttribute("y1", String(y0 - r0.top));
      linhaV.setAttribute("x2", String(ev.clientX - r0.left));
      linhaV.setAttribute("y2", String(ev.clientY - r0.top));
      const alvoT = linhas[Math.floor((ev.clientY - r0.top) / L)]?.t;
      mostrarDica(ev, alvoT && alvoT !== t ? `Vincular: ${t.nome} → ${alvoT.nome}` : "Solte sobre a sucessora");
      return;
    }
    dd = Math.round(dx / px);
    if (modo === "mover") {
      alvo.setAttribute("transform", `translate(${dd * px} 0)`);
      mostrarDica(ev, `Início: ${dataBR(novaData(c.inicio, dd))}`);
    } else {
      const ret = alvo.querySelector("rect")!;
      const w0 = xFim(c.ef) - xIni(c.es);
      ret.setAttribute("width", String(Math.max(px, w0 + dd * px)));
      mostrarDica(ev, `Término: ${dataBR(novaData(c.termino, dd, true))}`);
    }
  };
  const fim = (ev: PointerEvent) => {
    ganttCorpo.removeEventListener("pointermove", mov);
    ganttCorpo.removeEventListener("pointerup", fim);
    ganttCorpo.removeEventListener("pointercancel", fim);
    dica.hidden = true;
    linhaV.remove();
    if (!mexeu) {
      selecao = new Set([t.id]);
      ativa = { r: linhas.findIndex((l) => l.t === t), c: ativa.c };
      renderizar();
      return;
    }
    if (modo === "vincular") {
      const alvoT = linhas[Math.floor((ev.clientY - r0.top) / L)]?.t;
      if (alvoT && alvoT !== t && !alvoT.pred.some((p) => p.de === t.id)) {
        alvoT.pred.push({ de: t.id, tipo: "TI", lat: 0, latUn: "d" });
        return mudou();
      }
      return renderizar();
    }
    if (!dd || est.resumo[i]) return renderizar();
    if (modo === "mover") {
      t.restricao = "SNET";
      t.dataRestricao = novaData(c.inicio, dd);
    } else t.dur = Math.max(1, res.cal.diasUteis(c.inicio, novaData(c.termino, dd, true)));
    mudou();
  };
  ganttCorpo.addEventListener("pointermove", mov);
  ganttCorpo.addEventListener("pointerup", fim);
  ganttCorpo.addEventListener("pointercancel", fim);
});
ganttCorpo.addEventListener("dblclick", (e) => {
  const alvo = (e.target as Element).closest<SVGElement>(".cr-barra");
  const t = alvo && doc.tarefas.find((x) => x.id === alvo.dataset.id);
  if (t) informacoes(t);
});
ganttCorpo.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  menuTarefas(e.clientX, e.clientY);
});

/** Data deslocada em dias corridos, ajustada ao dia útil (seguinte ou, no término, anterior). */
function novaData(d: string, dias: number, anterior = false) {
  let s = serial(d) + dias;
  while (!res.cal.util(s)) s += anterior ? -1 : 1;
  return iso(s);
}
function mostrarDica(e: PointerEvent, t: string) {
  dica.textContent = t;
  dica.hidden = false;
  dica.style.left = `${e.clientX + 14}px`;
  dica.style.top = `${e.clientY + 14}px`;
}

// divisor tabela | Gantt
$("#cr-divisor").addEventListener("pointerdown", (e) => {
  const d = e.currentTarget as HTMLElement;
  d.setPointerCapture(e.pointerId);
  const x0 = e.clientX, w0 = tabelaArea.getBoundingClientRect().width;
  const mov = (ev: PointerEvent) => document.documentElement.style.setProperty("--cr-tabela", `${Math.max(120, Math.min(innerWidth - 120, w0 + ev.clientX - x0))}px`);
  const fim = () => {
    d.removeEventListener("pointermove", mov);
    d.removeEventListener("pointerup", fim);
    renderizarGantt();
  };
  d.addEventListener("pointermove", mov);
  d.addEventListener("pointerup", fim);
});

// ---------- informações da tarefa ----------

function informacoes(t: Tarefa) {
  const i = doc.tarefas.indexOf(t);
  const resumo = est.resumo[i];
  const c = res.t.get(t.id);
  const opcoesTarefas = (sel: string) =>
    doc.tarefas.map((x, k) => (x.id === t.id ? "" : `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${k + 1} — ${escapar(x.nome)}</option>`)).join("");
  const linhaPred = (p?: { de: string; tipo: TipoVinculo; lat: number; latUn: string }) => `<tr>
      <td><select data-p="de"><option value="">—</option>${opcoesTarefas(p?.de ?? "")}</select></td>
      <td><select data-p="tipo">${(["TI", "II", "TT", "IT"] as const).map((k) => `<option${p?.tipo === k ? " selected" : ""}>${k}</option>`).join("")}</select></td>
      <td><input data-p="lat" value="${p ? `${String(p.lat).replace(".", ",")}${p.latUn === "%" ? "%" : ""}` : "0"}" /></td>
      <td><button data-rem>✕</button></td></tr>`;
  const opRec = (sel: string) => doc.recursos.map((r) => `<option value="${r.id}"${r.id === sel ? " selected" : ""}>${escapar(r.nome)}</option>`).join("");
  const linhaRec = (a?: Atribuicao) => `<tr><td><select data-a="r"><option value="">—</option>${opRec(a?.r ?? "")}</select></td>
      <td><input data-a="un" value="${a ? String(a.un).replace(".", ",") : "100"}" /></td><td><button data-rem>✕</button></td></tr>`;
  const corpo = `
    <div class="cr-abas-info">${["Geral", "Predecessoras", "Recursos", "Avançado", "Anotações"].map((n, k) => `<button data-aba="${k}" aria-pressed="${k === 0}">${n}</button>`).join("")}</div>
    <div data-pag="0">
      <div class="wj-campo"><label>Nome</label><input id="ci-nome" value="${escapar(t.nome)}" /></div>
      <div class="cr-grade2">
        <div class="wj-campo"><label>Duração</label><input id="ci-dur" value="${resumo ? formatarDuracao(c?.dur ?? 0) : String(t.marco ? 0 : t.dur).replace(".", ",")}" ${resumo ? "disabled" : ""} /></div>
        <div class="wj-campo"><label>% concluída</label><input id="ci-pct" type="number" min="0" max="100" value="${resumo ? c?.pct ?? 0 : t.pct}" /></div>
        <div class="wj-campo"><label>Início</label><input value="${c ? dataBR(c.inicio) : ""}" disabled /></div>
        <div class="wj-campo"><label>Término</label><input value="${c ? dataBR(c.termino) : ""}" disabled /></div>
        <div class="wj-campo"><label>Prioridade (0–1000)</label><input id="ci-prio" type="number" min="0" max="1000" value="${t.prioridade ?? 500}" /></div>
        <div class="wj-campo"><label>&nbsp;</label><label><input id="ci-marco" type="checkbox" ${t.marco ? "checked" : ""} ${resumo ? "disabled" : ""}/> Marcar como marco</label></div>
      </div>
      ${c ? `<p style="font-size:13px;color:var(--texto-2)">Folga total ${fmtFolga(c.folgaTotal)} · folga livre ${fmtFolga(c.folgaLivre)}${c.critica ? " · <b style='color:var(--erro)'>no caminho crítico</b>" : ""} · trabalho ${num(c.trabalho, 1)} h · custo ${moeda(c.custo)}</p>` : ""}
    </div>
    <div data-pag="1" hidden>
      <table class="cr-lista-ed"><thead><tr><th>Predecessora</th><th>Tipo</th><th>Latência (d ou %)</th><th></th></tr></thead>
      <tbody id="ci-preds">${t.pred.map((p) => linhaPred(p)).join("")}</tbody></table>
      <button id="ci-mais-pred" style="margin-top:8px">+ Predecessora</button>
      <p style="font-size:12px;color:var(--texto-2)">TI = término-início, II = início-início, TT = término-término, IT = início-término. Latência negativa antecipa.</p>
    </div>
    <div data-pag="2" hidden>
      ${resumo ? "<p>Atribua recursos às subtarefas.</p>" : `<table class="cr-lista-ed"><thead><tr><th>Recurso</th><th>Unidades (% · quantidade · R$)</th><th></th></tr></thead>
      <tbody id="ci-recs">${t.recursos.map((a) => linhaRec(a)).join("")}</tbody></table>
      <button id="ci-mais-rec" style="margin-top:8px">+ Recurso</button>`}
    </div>
    <div data-pag="3" hidden>
      <div class="cr-grade2">
        <div class="wj-campo"><label>Tipo de restrição</label><select id="ci-rest">${RESTRICOES.map(([k, n]) => `<option value="${k}"${(t.restricao ?? "ASAP") === k ? " selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="wj-campo"><label>Data da restrição</label><input id="ci-drest" placeholder="dd/mm/aaaa" value="${dataBR(t.dataRestricao ?? "")}" /></div>
        <div class="wj-campo"><label>Data limite</label><input id="ci-lim" placeholder="dd/mm/aaaa" value="${dataBR(t.limite ?? "")}" /></div>
        <div class="wj-campo"><label>&nbsp;</label><label><input id="ci-inativa" type="checkbox" ${t.inativa ? "checked" : ""}/> Inativa (não entra no cálculo)</label></div>
      </div>
    </div>
    <div data-pag="4" hidden><textarea id="ci-notas" rows="8" style="width:100%" placeholder="Anotações da tarefa">${escapar(t.notas ?? "")}</textarea></div>`;
  const { corpo: cp } = janela(`Informações da tarefa ${i + 1}`, corpo, [
    { rotulo: "Cancelar" },
    {
      rotulo: "OK", destaque: true, acao: (b) => {
        const q = <T extends HTMLElement>(s: string) => b.querySelector(s) as T;
        const nome = q<HTMLInputElement>("#ci-nome").value.trim();
        if (!resumo) {
          const d = lerDuracao(q<HTMLInputElement>("#ci-dur").value, doc.calendario.horasDia);
          if (d === null) return void casca.avisar("Duração inválida."), false;
          t.dur = d;
          t.marco = q<HTMLInputElement>("#ci-marco").checked || d === 0;
        }
        const rest = q<HTMLSelectElement>("#ci-rest").value as Restricao;
        const dr = q<HTMLInputElement>("#ci-drest").value.trim();
        if (rest !== "ASAP" && rest !== "ALAP" && !lerDataBR(dr)) return void casca.avisar("Informe a data da restrição."), false;
        const lim = q<HTMLInputElement>("#ci-lim").value.trim();
        if (lim && !lerDataBR(lim)) return void casca.avisar("Data limite inválida."), false;
        const preds: Tarefa["pred"] = [];
        for (const tr of b.querySelectorAll<HTMLTableRowElement>("#ci-preds tr")) {
          const de = tr.querySelector<HTMLSelectElement>('[data-p="de"]')!.value;
          if (!de) continue;
          const lt = tr.querySelector<HTMLInputElement>('[data-p="lat"]')!.value.trim();
          const m = /^(-?\d+(?:[.,]\d+)?)\s*(%|d)?$/.exec(lt || "0");
          if (!m) return void casca.avisar(`Latência inválida: ${lt}`), false;
          preds.push({ de, tipo: tr.querySelector<HTMLSelectElement>('[data-p="tipo"]')!.value as TipoVinculo, lat: Number(m[1].replace(",", ".")), latUn: m[2] === "%" ? "%" : "d" });
        }
        if (!resumo) {
          const recs: Atribuicao[] = [];
          for (const tr of b.querySelectorAll<HTMLTableRowElement>("#ci-recs tr")) {
            const r = tr.querySelector<HTMLSelectElement>('[data-a="r"]')!.value;
            const un = Number(tr.querySelector<HTMLInputElement>('[data-a="un"]')!.value.replace(",", "."));
            if (r && Number.isFinite(un)) recs.push({ r, un });
          }
          t.recursos = recs;
        }
        t.nome = nome || t.nome;
        t.pred = preds;
        t.restricao = rest;
        t.dataRestricao = rest === "ASAP" || rest === "ALAP" ? undefined : lerDataBR(dr)!;
        t.limite = lim ? lerDataBR(lim)! : undefined;
        t.inativa = q<HTMLInputElement>("#ci-inativa").checked || undefined;
        t.prioridade = Number(q<HTMLInputElement>("#ci-prio").value) || 500;
        t.notas = q<HTMLTextAreaElement>("#ci-notas").value || undefined;
        definirPct(i, Math.max(0, Math.min(100, Math.round(Number(q<HTMLInputElement>("#ci-pct").value) || 0))));
        mudou();
      },
    },
  ], true);
  cp.querySelectorAll<HTMLElement>("[data-aba]").forEach((b) => {
    b.onclick = () => {
      cp.querySelectorAll<HTMLElement>("[data-aba]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      cp.querySelectorAll<HTMLElement>("[data-pag]").forEach((p) => (p.hidden = p.dataset.pag !== b.dataset.aba));
    };
  });
  cp.addEventListener("click", (e) => {
    const rem = (e.target as HTMLElement).closest("[data-rem]");
    if (rem) rem.closest("tr")!.remove();
  });
  cp.querySelector<HTMLElement>("#ci-mais-pred")!.onclick = () => cp.querySelector("#ci-preds")!.insertAdjacentHTML("beforeend", linhaPred());
  const maisRec = cp.querySelector<HTMLElement>("#ci-mais-rec");
  if (maisRec) maisRec.onclick = () => {
    if (!doc.recursos.length) return casca.avisar("Cadastre recursos na Planilha de recursos (aba Recursos) ou digite o nome na coluna Nomes dos recursos.");
    cp.querySelector("#ci-recs")!.insertAdjacentHTML("beforeend", linhaRec());
  };
}

// ---------- informações do projeto e calendário ----------

function infoProjeto() {
  const cal = doc.calendario;
  const corpo = `
    <div class="cr-grade2">
      <div class="wj-campo"><label>Data de início</label><input id="pj-ini" value="${dataBR(doc.inicio)}" /></div>
      <div class="wj-campo"><label>Data de status (vazio = hoje)</label><input id="pj-status" value="${dataBR(doc.status ?? "")}" placeholder="dd/mm/aaaa" /></div>
      <div class="wj-campo"><label>Horas por dia</label><input id="pj-horas" type="number" min="1" max="24" step="0.5" value="${cal.horasDia}" /></div>
      <div class="wj-campo"><label>Término calculado</label><input value="${dataBR(res.termino)}" disabled /></div>
    </div>
    <div class="wj-campo"><label>Dias úteis</label><div style="display:flex;gap:10px;flex-wrap:wrap">${SEMANA.map((d, k) => `<label><input type="checkbox" data-dia="${k}" ${cal.uteis[k] ? "checked" : ""}/> ${d}</label>`).join("")}</div></div>
    <label><input id="pj-fer" type="checkbox" ${cal.feriadosNacionais ? "checked" : ""}/> Feriados nacionais do Brasil (inclui Sexta-feira Santa)</label><br/>
    <label><input id="pj-fac" type="checkbox" ${cal.facultativos ? "checked" : ""}/> Carnaval e Corpus Christi como folga</label>
    <div class="wj-campo" style="margin-top:10px"><label>Outras folgas (uma por linha: dd/mm/aaaa Nome) — feriados estaduais, municipais, recesso…</label>
      <textarea id="pj-exc" rows="5">${cal.excecoes.map((e) => `${dataBR(e.data)} ${e.nome}`).join("\n")}</textarea></div>`;
  janela("Informações do projeto", corpo, [
    { rotulo: "Cancelar" },
    {
      rotulo: "OK", destaque: true, acao: (b) => {
        const q = (s: string) => b.querySelector(s) as HTMLInputElement;
        const ini = lerDataBR(q("#pj-ini").value);
        if (!ini) return void casca.avisar("Data de início inválida."), false;
        const st = q("#pj-status").value.trim();
        if (st && !lerDataBR(st)) return void casca.avisar("Data de status inválida."), false;
        const exc: { data: string; nome: string }[] = [];
        for (const ln of (b.querySelector("#pj-exc") as HTMLTextAreaElement).value.split("\n").map((x) => x.trim()).filter(Boolean)) {
          const m = /^(\S+)\s*(.*)$/.exec(ln)!;
          const d = lerDataBR(m[1]);
          if (!d) return void casca.avisar(`Data inválida em "${ln}".`), false;
          exc.push({ data: d, nome: m[2] || "Folga" });
        }
        const uteis = SEMANA.map((_, k) => (b.querySelector(`[data-dia="${k}"]`) as HTMLInputElement).checked);
        if (!uteis.some(Boolean)) return void casca.avisar("Marque pelo menos um dia útil."), false;
        doc.inicio = ini;
        doc.status = st ? lerDataBR(st)! : undefined;
        doc.calendario = { uteis, feriadosNacionais: q("#pj-fer").checked, facultativos: q("#pj-fac").checked, excecoes: exc, horasDia: Number(q("#pj-horas").value) || 8 };
        mudou();
      },
    },
  ]);
}

// ---------- linha de base e valor agregado ----------

function definirLinhaBase() {
  for (const t of doc.tarefas) {
    const c = res.t.get(t.id);
    if (c && !c.resumo) t.base = { ini: c.inicio, fim: c.termino, dur: c.dur, custo: c.custo };
  }
  mudou();
  casca.avisar("Linha de base definida: aparece como barra cinza sob cada tarefa.");
}
function limparLinhaBase() {
  for (const t of doc.tarefas) delete t.base;
  mudou();
}

function estatisticas() {
  const st = serial(dataStatus());
  let bac = 0, vp = 0, va = 0, cr = 0, temBase = false;
  doc.tarefas.forEach((t, i) => {
    const c = res.t.get(t.id);
    if (!c || c.resumo || est.resumo[i]) return;
    cr += c.custo * (t.pct / 100);
    if (!t.base) return;
    temBase = true;
    bac += t.base.custo;
    va += t.base.custo * (t.pct / 100);
    const bi = serial(t.base.ini), bf = serial(t.base.fim);
    const f = st >= bf ? 1 : st < bi ? 0 : t.base.dur > 0 ? Math.min(1, res.cal.diasUteis(t.base.ini, iso(st)) / t.base.dur) : 1;
    vp += t.base.custo * f;
  });
  const pct = (() => {
    const fs = doc.tarefas.filter((_, i) => !est.resumo[i]).map((t) => [t, res.t.get(t.id)] as const).filter(([, c]) => c);
    const d = fs.reduce((s, [, c]) => s + c!.dur, 0);
    return d ? fs.reduce((s, [t, c]) => s + c!.dur * t.pct, 0) / d : 0;
  })();
  const idc = cr ? va / cr : NaN, idp = vp ? va / vp : NaN;
  const lin = (n: string, v: string, dica = "") => `<tr${dica ? ` title="${escapar(dica)}"` : ""}><td>${n}</td><td>${v}</td></tr>`;
  const f2 = (v: number) => (Number.isFinite(v) ? num(v, 2) : "—");
  janela("Estatísticas do projeto", `
    <table class="cr-valores">
      ${lin("Início", dataBR(res.inicio))}${lin("Término", dataBR(res.termino))}${lin("Duração", formatarDuracao(res.dur))}
      ${lin("Trabalho", `${num(res.trabalho, 1)} h`)}${lin("Custo", moeda(res.custo))}${lin("% concluído", `${num(pct, 0)}%`)}
      ${lin("Data de status", dataBR(dataStatus()))}
    </table>
    <h4 style="margin:14px 0 6px">Valor agregado ${temBase ? "" : "<small style='font-weight:400;color:var(--texto-2)'>(defina a linha de base)</small>"}</h4>
    ${temBase ? `<table class="cr-valores">
      ${lin("ONT — orçamento no término", moeda(bac))}
      ${lin("VP — valor planejado", moeda(vp), "Custo da linha de base do trabalho previsto até a data de status")}
      ${lin("VA — valor agregado", moeda(va), "Custo da linha de base do trabalho realizado (% concluído)")}
      ${lin("CR — custo real", moeda(cr), "Custo atual × % concluído (sem apontamento de custos reais)")}
      ${lin("VPR — variação de prazo (VA − VP)", moeda(va - vp))}
      ${lin("VC — variação de custo (VA − CR)", moeda(va - cr))}
      ${lin("IDP — índice de desempenho de prazo", f2(idp))}
      ${lin("IDC — índice de desempenho de custo", f2(idc))}
      ${lin("EAT — estimativa no término (ONT ÷ IDC)", Number.isFinite(idc) && idc ? moeda(bac / idc) : "—")}
    </table>` : ""}
    ${res.erros.length ? `<p style="color:var(--erro)">${res.erros.map(escapar).join("<br>")}</p>` : ""}`);
}

// ---------- planilha de recursos ----------

function renderizarRecursos() {
  const v = $("#cr-recursos-vista");
  const tot = new Map<string, { h: number; c: number }>();
  for (const t of doc.tarefas) {
    const c = res.t.get(t.id);
    if (!c || c.resumo) continue;
    for (const a of t.recursos) {
      const r = recursoPorId(a.r);
      if (!r) continue;
      const x = tot.get(r.id) ?? { h: 0, c: 0 };
      if (r.tipo === "trabalho") {
        const h = c.dur * doc.calendario.horasDia * (a.un / 100);
        x.h += h;
        x.c += h * r.taxa + r.custoUso;
      } else x.c += r.tipo === "material" ? a.un * r.taxa + r.custoUso : a.un;
      tot.set(r.id, x);
    }
  }
  v.innerHTML = `<table><thead><tr><th>Nome do recurso</th><th>Tipo</th><th>Unidade (material)</th><th>Grupo</th><th>Unid. máx. (%)</th><th>Taxa (R$/h ou R$/un.)</th><th>Custo/uso</th><th>Trabalho</th><th>Custo</th><th></th></tr></thead><tbody>
    ${doc.recursos.map((r) => `<tr data-id="${r.id}" class="${res.superalocados.has(r.id) ? "super" : ""}" title="${res.superalocados.has(r.id) ? "Superalocado: mais unidades atribuídas que o máximo em algum dia" : ""}">
      <td><input data-c="nome" value="${escapar(r.nome)}" /></td>
      <td><select data-c="tipo">${[["trabalho", "Trabalho"], ["material", "Material"], ["custo", "Custo"]].map(([k, n]) => `<option value="${k}"${r.tipo === k ? " selected" : ""}>${n}</option>`).join("")}</select></td>
      <td><input data-c="unidade" value="${escapar(r.unidade ?? "")}" ${r.tipo !== "material" ? "disabled" : ""}/></td>
      <td><input data-c="grupo" value="${escapar(r.grupo ?? "")}" /></td>
      <td><input data-c="max" type="number" min="0" value="${r.max}" ${r.tipo !== "trabalho" ? "disabled" : ""}/></td>
      <td><input data-c="taxa" type="number" min="0" step="0.01" value="${r.taxa}" ${r.tipo === "custo" ? "disabled" : ""}/></td>
      <td><input data-c="custoUso" type="number" min="0" step="0.01" value="${r.custoUso}" /></td>
      <td style="text-align:right">${r.tipo === "trabalho" ? `${num(tot.get(r.id)?.h ?? 0, 1)} h` : ""}</td>
      <td style="text-align:right">${moeda(tot.get(r.id)?.c ?? 0)}</td>
      <td><button data-rem title="Excluir recurso">✕</button></td></tr>`).join("")}
    </tbody></table>
    <div class="cr-acoes"><button id="cr-novo-rec" class="destaque">+ Novo recurso</button></div>`;
  v.querySelector<HTMLElement>("#cr-novo-rec")!.onclick = () => {
    doc.recursos.push({ id: uid(), nome: `Recurso ${doc.recursos.length + 1}`, tipo: "trabalho", max: 100, taxa: 0, custoUso: 0 });
    mudou();
  };
}
$("#cr-recursos-vista").addEventListener("change", (e) => {
  const inp = e.target as HTMLInputElement;
  const r = recursoPorId(inp.closest("tr")?.dataset.id ?? "");
  if (!r || !inp.dataset.c) return;
  const k = inp.dataset.c as keyof Recurso;
  if (k === "max" || k === "taxa" || k === "custoUso") r[k] = Math.max(0, Number(inp.value) || 0);
  else if (k === "tipo") r.tipo = inp.value as Recurso["tipo"];
  else if (k === "nome") r.nome = inp.value.trim() || r.nome;
  else (r as unknown as Record<string, string>)[k] = inp.value;
  mudou();
});
$("#cr-recursos-vista").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-rem]");
  const id = b?.closest("tr")?.dataset.id;
  if (!id) return;
  doc.recursos = doc.recursos.filter((r) => r.id !== id);
  for (const t of doc.tarefas) t.recursos = t.recursos.filter((a) => a.r !== id);
  mudou();
});

// ---------- quadro de cartões ----------

const COLUNAS_QUADRO: [string, string, (p: number) => boolean, number][] = [
  ["nao", "Não iniciadas", (p) => p === 0, 0],
  ["and", "Em andamento", (p) => p > 0 && p < 100, 50],
  ["ok", "Concluídas", (p) => p >= 100, 100],
];
function renderizarQuadro() {
  const v = $("#cr-quadro-vista");
  const folhas = doc.tarefas.map((t, i) => [t, i] as const).filter(([t, i]) => !est.resumo[i] && !t.inativa);
  v.innerHTML = COLUNAS_QUADRO.map(([k, n, f]) => {
    const ts = folhas.filter(([t]) => f(t.pct));
    return `<div class="cr-coluna" data-col="${k}"><header><span>${n}</span><span>${ts.length}</span></header>
      ${ts.map(([t, i]) => {
        const c = res.t.get(t.id);
        return `<div class="cr-cartao${critico && c?.critica ? " critica" : ""}" data-id="${t.id}">
          <strong>${escapar(t.nome || `Tarefa ${i + 1}`)}</strong>
          <span style="color:var(--texto-2)">${eap[i]} · ${c ? `${dataBR(c.inicio).slice(0, 5)} → ${dataBR(c.termino).slice(0, 5)}` : ""}${textoRecursos(t) ? ` · ${escapar(textoRecursos(t))}` : ""}</span>
          <div class="cr-barra-pct"><span style="width:${t.pct}%"></span></div></div>`;
      }).join("")}</div>`;
  }).join("");
}
$("#cr-quadro-vista").addEventListener("pointerdown", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".cr-cartao");
  if (!card) return;
  const t = doc.tarefas.find((x) => x.id === card.dataset.id)!;
  const x0 = e.clientX, y0 = e.clientY;
  let fantasma: HTMLElement | null = null;
  let alvo: HTMLElement | null = null;
  card.setPointerCapture(e.pointerId);
  const mov = (ev: PointerEvent) => {
    if (!fantasma && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!fantasma) {
      fantasma = card.cloneNode(true) as HTMLElement;
      fantasma.classList.add("cr-fantasma");
      document.body.append(fantasma);
    }
    fantasma.style.left = `${ev.clientX - 20}px`;
    fantasma.style.top = `${ev.clientY - 20}px`;
    alvo?.classList.remove("alvo");
    alvo = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.classList.contains("cr-coluna")) as HTMLElement | null;
    alvo?.classList.add("alvo");
  };
  const fim = () => {
    card.removeEventListener("pointermove", mov);
    card.removeEventListener("pointerup", fim);
    if (!fantasma) return informacoes(t);
    fantasma.remove();
    const col = COLUNAS_QUADRO.find(([k]) => k === alvo?.dataset.col);
    alvo?.classList.remove("alvo");
    if (col && !col[2](t.pct)) {
      t.pct = col[3];
      mudou();
    }
  };
  card.addEventListener("pointermove", mov);
  card.addEventListener("pointerup", fim);
});

// ---------- arquivos: .wjcron, CSV, XML (MSPDI) ----------

function exportarCSV() {
  const cols = ["Id", "EAP", "Nome", "Duração", "Início", "Término", "Predecessoras", "Recursos", "% concluída", "Custo"];
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lin = doc.tarefas.map((t, i) => {
    const c = res.t.get(t.id);
    return [String(i + 1), eap[i], `${"  ".repeat(t.nivel - 1)}${t.nome}`, formatarDuracao(c?.dur ?? t.dur), c ? dataBR(c.inicio) : "", c ? dataBR(c.termino) : "",
      formatarPredecessoras(t.pred, linhaDoId), textoRecursos(t), String(c?.pct ?? t.pct), c ? num(c.custo) : ""].map(q).join(";");
  });
  baixar(`﻿${[cols.join(";"), ...lin].join("\r\n")}`, doc.nome, "csv", "text/csv");
}

const TIPO_XML: Record<TipoVinculo, number> = { TT: 0, TI: 1, IT: 2, II: 3 };
const REST_XML: Restricao[] = ["ASAP", "ALAP", "MSO", "MFO", "SNET", "SNLT", "FNET", "FNLT"];
const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function exportarXML() {
  const h = doc.calendario.horasDia;
  const dur = (d: number) => `PT${Math.round(d * h * 100) / 100}H0M0S`;
  const uidT = new Map(doc.tarefas.map((t, i) => [t.id, i + 1]));
  const uidR = new Map(doc.recursos.map((r, i) => [r.id, i + 1]));
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">\n<Name>${xmlEsc(doc.nome)}</Name>\n<StartDate>${res.inicio}T08:00:00</StartDate>\n<FinishDate>${res.termino}T17:00:00</FinishDate>\n<MinutesPerDay>${h * 60}</MinutesPerDay>\n<Tasks>\n`;
  doc.tarefas.forEach((t, i) => {
    const c = res.t.get(t.id);
    x += `<Task><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${xmlEsc(t.nome)}</Name><OutlineNumber>${eap[i]}</OutlineNumber><OutlineLevel>${t.nivel}</OutlineLevel>`;
    x += `<Summary>${est.resumo[i] ? 1 : 0}</Summary><Milestone>${t.marco || (!est.resumo[i] && t.dur === 0) ? 1 : 0}</Milestone><Active>${t.inativa ? 0 : 1}</Active>`;
    if (c) x += `<Start>${c.inicio}T08:00:00</Start><Finish>${c.termino}T17:00:00</Finish>`;
    x += `<Duration>${dur(est.resumo[i] ? c?.dur ?? 0 : t.marco ? 0 : t.dur)}</Duration><DurationFormat>7</DurationFormat><PercentComplete>${c?.pct ?? t.pct}</PercentComplete>`;
    x += `<Priority>${t.prioridade ?? 500}</Priority><ConstraintType>${REST_XML.indexOf(t.restricao ?? "ASAP")}</ConstraintType>`;
    if (t.dataRestricao) x += `<ConstraintDate>${t.dataRestricao}T08:00:00</ConstraintDate>`;
    if (t.limite) x += `<Deadline>${t.limite}T17:00:00</Deadline>`;
    if (t.notas) x += `<Notes>${xmlEsc(t.notas)}</Notes>`;
    for (const p of t.pred) {
      const u = uidT.get(p.de);
      if (!u) continue;
      x += `<PredecessorLink><PredecessorUID>${u}</PredecessorUID><Type>${TIPO_XML[p.tipo]}</Type><LinkLag>${p.latUn === "%" ? Math.round(p.lat * 10) : Math.round(p.lat * h * 600)}</LinkLag><LagFormat>${p.latUn === "%" ? 19 : 7}</LagFormat></PredecessorLink>`;
    }
    x += "</Task>\n";
  });
  x += "</Tasks>\n<Resources>\n";
  doc.recursos.forEach((r, i) => {
    x += `<Resource><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${xmlEsc(r.nome)}</Name><Type>${r.tipo === "material" ? 0 : r.tipo === "trabalho" ? 1 : 2}</Type>`;
    if (r.unidade) x += `<MaterialLabel>${xmlEsc(r.unidade)}</MaterialLabel>`;
    if (r.grupo) x += `<Group>${xmlEsc(r.grupo)}</Group>`;
    x += `<MaxUnits>${(r.max / 100).toFixed(2)}</MaxUnits><StandardRate>${r.taxa}</StandardRate><CostPerUse>${r.custoUso}</CostPerUse></Resource>\n`;
  });
  x += "</Resources>\n<Assignments>\n";
  let n = 1;
  doc.tarefas.forEach((t) => {
    for (const a of t.recursos) {
      const r = recursoPorId(a.r);
      if (!r) continue;
      x += `<Assignment><UID>${n++}</UID><TaskUID>${uidT.get(t.id)}</TaskUID><ResourceUID>${uidR.get(a.r)}</ResourceUID><Units>${r.tipo === "trabalho" ? a.un / 100 : a.un}</Units></Assignment>\n`;
    }
  });
  x += "</Assignments>\n</Project>\n";
  baixar(x, doc.nome, "xml", "application/xml");
}

function importarXML(texto: string, nome: string): Projeto {
  const dom = new DOMParser().parseFromString(texto, "application/xml");
  if (dom.querySelector("parsererror") || dom.documentElement.localName !== "Project") throw new Error("O XML não é um projeto (formato MSPDI).");
  const filho = (e: Element, n: string) => [...e.children].find((x) => x.localName === n)?.textContent?.trim() ?? "";
  const filhos = (e: Element | undefined, n: string) => (e ? [...e.children].filter((x) => x.localName === n) : []);
  const raiz = dom.documentElement;
  const sec = (n: string) => [...raiz.children].find((x) => x.localName === n);
  const minDia = Number(filho(raiz, "MinutesPerDay")) || 480;
  const horas = minDia / 60;
  const horasDe = (d: string) => {
    const m = /PT(\d+(?:\.\d+)?)H(\d+(?:\.\d+)?)M(\d+(?:\.\d+)?)S/.exec(d);
    return m ? Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600 : 0;
  };
  const p: Projeto = { ...docVazio(), nome: filho(raiz, "Name") || nome.replace(/\.xml$/i, ""), inicio: (filho(raiz, "StartDate") || hojeIso()).slice(0, 10) };
  p.calendario.horasDia = horas;
  const porUidR = new Map<string, Recurso>();
  for (const r of filhos(sec("Resources"), "Resource")) {
    const nomeR = filho(r, "Name");
    if (!nomeR) continue;
    const tipo = filho(r, "Type");
    const rec: Recurso = {
      id: uid(), nome: nomeR, tipo: tipo === "0" ? "material" : tipo === "2" ? "custo" : "trabalho", max: Math.round((Number(filho(r, "MaxUnits") || 1)) * 100),
      taxa: Number(filho(r, "StandardRate")) || 0, custoUso: Number(filho(r, "CostPerUse")) || 0, unidade: filho(r, "MaterialLabel") || undefined, grupo: filho(r, "Group") || undefined,
    };
    porUidR.set(filho(r, "UID"), rec);
    p.recursos.push(rec);
  }
  const porUidT = new Map<string, Tarefa>();
  const links: [Tarefa, Element][] = [];
  for (const e of filhos(sec("Tasks"), "Task")) {
    const nivel = Number(filho(e, "OutlineLevel") || 1);
    if (nivel < 1 || filho(e, "IsNull") === "1") continue;
    const ct = Number(filho(e, "ConstraintType") || 0);
    const t: Tarefa = {
      id: uid(), nome: filho(e, "Name"), nivel, dur: Math.round((horasDe(filho(e, "Duration")) / horas) * 1000) / 1000,
      marco: filho(e, "Milestone") === "1" || undefined, pred: [], pct: Number(filho(e, "PercentComplete")) || 0, recursos: [],
      restricao: REST_XML[ct] ?? "ASAP", dataRestricao: filho(e, "ConstraintDate").slice(0, 10) || undefined, limite: filho(e, "Deadline").slice(0, 10) || undefined,
      notas: filho(e, "Notes") || undefined, prioridade: Number(filho(e, "Priority")) || undefined, inativa: filho(e, "Active") === "0" || undefined,
    };
    if (t.restricao === "ASAP" || t.restricao === "ALAP") t.dataRestricao = undefined;
    porUidT.set(filho(e, "UID"), t);
    p.tarefas.push(t);
    for (const l of filhos(e, "PredecessorLink")) links.push([t, l]);
  }
  for (const [t, l] of links) {
    const de = porUidT.get(filho(l, "PredecessorUID"));
    if (!de) continue;
    const tipo = (Object.entries(TIPO_XML).find(([, n]) => n === Number(filho(l, "Type") || 1))?.[0] ?? "TI") as TipoVinculo;
    const fmt = Number(filho(l, "LagFormat") || 7), lag = Number(filho(l, "LinkLag") || 0);
    const pctFmt = fmt === 19 || fmt === 20;
    t.pred.push({ de: de.id, tipo, lat: pctFmt ? lag / 10 : Math.round((lag / 600 / horas) * 1000) / 1000, latUn: pctFmt ? "%" : "d" });
  }
  for (const a of filhos(sec("Assignments"), "Assignment")) {
    const t = porUidT.get(filho(a, "TaskUID")), r = porUidR.get(filho(a, "ResourceUID"));
    if (!t || !r) continue;
    const u = Number(filho(a, "Units") || 1);
    t.recursos.push({ r: r.id, un: r.tipo === "trabalho" ? Math.round(u * 100) : u });
  }
  // resumos não guardam duração própria
  const e = estrutura(p.tarefas);
  p.tarefas.forEach((t, i) => e.resumo[i] && ((t.dur = 0), (t.marco = undefined)));
  return p;
}

function exemplo(): Projeto {
  const p = docVazio();
  p.nome = "Transportador de correia";
  const j = { id: uid(), nome: "Projetista", tipo: "trabalho" as const, max: 100, taxa: 95, custoUso: 0 };
  const m = { id: uid(), nome: "Montador", tipo: "trabalho" as const, max: 200, taxa: 60, custoUso: 0 };
  const a = { id: uid(), nome: "Chapa de aço", tipo: "material" as const, max: 0, taxa: 9.5, custoUso: 0, unidade: "kg" };
  p.recursos = [j, m, a];
  const t = (nome: string, nivel: number, dur: number, extra: Partial<Tarefa> = {}): Tarefa => ({ id: uid(), nome, nivel, dur, pred: [], pct: 0, recursos: [], ...extra });
  const ts = [
    t("Engenharia", 1, 0),
    t("Levantamento de requisitos", 2, 3, { recursos: [{ r: j.id, un: 100 }], pct: 100 }),
    t("Modelagem 3D no WJCAD", 2, 8, { recursos: [{ r: j.id, un: 100 }], pct: 40 }),
    t("Detalhamento e lista de materiais", 2, 5, { recursos: [{ r: j.id, un: 100 }] }),
    t("Liberação de projeto", 2, 0, { marco: true }),
    t("Fabricação", 1, 0),
    t("Compra de chapas", 2, 4, { recursos: [{ r: a.id, un: 850 }] }),
    t("Corte e dobra", 2, 6, { recursos: [{ r: m.id, un: 100 }] }),
    t("Soldagem e pintura", 2, 5, { recursos: [{ r: m.id, un: 200 }] }),
    t("Montagem e testes", 1, 4, { recursos: [{ r: m.id, un: 200 }, { r: j.id, un: 50 }] }),
    t("Entrega", 1, 0, { marco: true }),
  ];
  const v = (de: Tarefa, tipo: TipoVinculo = "TI", lat = 0) => ({ de: de.id, tipo, lat, latUn: "d" as const });
  ts[2].pred = [v(ts[1])];
  ts[3].pred = [v(ts[2], "TI", -2)];
  ts[4].pred = [v(ts[3])];
  ts[6].pred = [v(ts[4])];
  ts[7].pred = [v(ts[6])];
  ts[8].pred = [v(ts[7], "II", 3)];
  ts[9].pred = [v(ts[8])];
  ts[10].pred = [v(ts[9])];
  p.tarefas = ts;
  return p;
}

// ---------- casca ----------

function mudou(registrar = true) {
  res = calcular(doc);
  if (registrar) historico.registrar(doc);
  autosave.guardar(CHAVE, doc);
  renderizar();
}

function renderizar() {
  montarLinhas();
  ativa.r = Math.min(ativa.r, Math.max(0, linhas.length - 1));
  for (const [id, sec] of [["gantt", "#cr-gantt-vista"], ["recursos", "#cr-recursos-vista"], ["quadro", "#cr-quadro-vista"]] as const) $(sec).hidden = vista !== id;
  if (vista === "gantt") {
    renderizarTabela();
    renderizarGantt();
  } else if (vista === "recursos") renderizarRecursos();
  else renderizarQuadro();
  casca.renderizar();
  const sup = res.superalocados.size ? ` · ${res.superalocados.size} recurso(s) superalocado(s)` : "";
  casca.definirStatus(doc.tarefas.length
    ? `${doc.tarefas.length} tarefas · início ${dataBR(res.inicio)} · término ${dataBR(res.termino)} · ${formatarDuracao(res.dur)} · ${moeda(res.custo)}${sup}`
    : "Digite o nome da primeira tarefa na tabela (ou abra o exemplo em Projeto → Exemplo).");
  casca.statusDireita.innerHTML = res.erros.length ? `<span style="color:var(--erro)" title="${escapar(res.erros.join("\n"))}">⚠ ${res.erros.length} aviso(s)</span>` : "";
}

function carregar(p: Projeto) {
  doc = p;
  selecao.clear();
  ativa = { r: 0, c: 2 };
  historico.limpar(doc);
  mudou(false);
}

const casca: Casca = new Casca({
  app: "WJCronProject",
  icone: "",
  extensao: "wjcron",
  nomeDoc: () => doc.nome,
  renomear: (n) => ((doc.nome = n), mudou()),
  novo: () => carregar(docVazio()),
  abrir: async () => {
    const f = await escolherArquivo();
    if (!f?.texto) return;
    try {
      if (/\.xml$/i.test(f.nome) || f.texto.trimStart().startsWith("<")) carregar(importarXML(f.texto, f.nome));
      else {
        const p = validarProjeto(JSON.parse(f.texto));
        p.nome = f.nome.replace(/\.(wjcron|json)$/i, "") || p.nome;
        carregar(p);
      }
    } catch (e) {
      casca.avisar(e instanceof Error ? e.message : "Não foi possível abrir o arquivo.", 6000);
    }
  },
  salvar: () => baixar(JSON.stringify(doc), doc.nome, "wjcron", "application/json"),
  desfazer: () => {
    const d = historico.desfazer();
    if (d) (doc = d), mudou(false);
  },
  refazer: () => {
    const d = historico.refazer();
    if (d) (doc = d), mudou(false);
  },
  abas: [
    {
      id: "tarefa", rotulo: "Tarefa", grupos: [
        [
          { id: "nova", rotulo: "Tarefa", icone: "tarefa", dica: "Inserir tarefa (Insert)", acao: () => inserir(false) },
          { id: "marco", rotulo: "Marco", icone: "marco", acao: () => inserir(true) },
          { id: "exc", rotulo: "Excluir", icone: "apagar", dica: "Excluir tarefa (Delete)", acao: excluir },
        ],
        [
          { id: "rec+", rotulo: "Recuar", icone: "recuoMais", peq: true, dica: "Recuar: vira subtarefa (Alt+Shift+→)", acao: () => recuar(1) },
          { id: "rec-", rotulo: "Recuar à esquerda", icone: "recuoMenos", peq: true, dica: "Recuar à esquerda (Alt+Shift+←)", acao: () => recuar(-1) },
          { id: "vinc", rotulo: "Vincular", icone: "vincular", peq: true, dica: "Vincular as selecionadas em sequência (Ctrl+F2)", acao: vincular },
          { id: "desv", rotulo: "Desvincular", icone: "desvincular", peq: true, acao: desvincular },
        ],
        [
          { id: "p0", rotulo: "0%", dica: "0% concluída", acao: () => pctSel(0) },
          { id: "p50", rotulo: "50%", dica: "50% concluída", acao: () => pctSel(50) },
          { id: "p100", rotulo: "100%", dica: "100% concluída", acao: () => pctSel(100) },
        ],
        [
          { id: "info", rotulo: "Informações", icone: "editar", dica: "Informações da tarefa (Shift+F2)", acao: () => (selecionadas()[0] ? informacoes(selecionadas()[0]) : casca.avisar("Selecione uma tarefa.")) },
          { id: "rolar", rotulo: "Rolar até", icone: "localizar", dica: "Rolar o Gantt até a tarefa", acao: rolarAteTarefa },
        ],
      ],
    },
    {
      id: "projeto", rotulo: "Projeto", grupos: [
        [
          { id: "infoP", rotulo: "Informações", icone: "calendario", dica: "Início, data de status e calendário (dias úteis e feriados)", acao: infoProjeto },
          { id: "est", rotulo: "Estatísticas", icone: "painel", dica: "Totais do projeto e valor agregado", acao: estatisticas },
        ],
        [
          { id: "lb", rotulo: "Definir linha de base", icone: "linhaBase", acao: definirLinhaBase },
          { id: "lbx", rotulo: "Limpar linha de base", icone: "apagar", peq: true, acao: limparLinhaBase },
        ],
        [
          { id: "csv", rotulo: "CSV", icone: "exportar", dica: "Exportar a tabela para planilha (CSV)", acao: exportarCSV },
          { id: "xml", rotulo: "XML", icone: "exportar", dica: "Exportar em XML de projeto (MSPDI) — Abrir aceita .xml também", acao: exportarXML },
          { id: "imp", rotulo: "Imprimir", icone: "imprimir", acao: () => print() },
        ],
        [{ id: "ex", rotulo: "Exemplo", icone: "arquivo", dica: "Abrir um projeto de exemplo", acao: () => carregar(exemplo()) }],
      ],
    },
    {
      id: "exibir", rotulo: "Exibir", grupos: [
        [
          { id: "vg", rotulo: "Gantt", icone: "tarefa", ativo: () => vista === "gantt", acao: () => ((vista = "gantt"), renderizar()) },
          { id: "vr", rotulo: "Recursos", icone: "recurso", ativo: () => vista === "recursos", acao: () => ((vista = "recursos"), renderizar()) },
          { id: "vq", rotulo: "Quadro", icone: "painel", ativo: () => vista === "quadro", acao: () => ((vista = "quadro"), renderizar()) },
        ],
        [
          { id: "mesa", rotulo: "Tabela", opcoes: () => [["entrada", "Tabela: Entrada"], ["agenda", "Tabela: Agenda (folgas)"], ["custo", "Tabela: Custo e linha de base"]], valor: () => mesa, aoMudar: (v) => ((mesa = v as Mesa), (ativa.c = 2), renderizar()) },
          {
            id: "filtro", rotulo: "Filtro", opcoes: () => [["todas", "Todas as tarefas"], ["criticas", "Críticas"], ["marcos", "Marcos"], ["atrasadas", "Atrasadas"], ["incompletas", "Incompletas"], ["concluidas", "Concluídas"]],
            valor: () => filtro, aoMudar: (v) => ((filtro = v), renderizar()),
          },
        ],
        [
          { id: "crit", rotulo: "Caminho crítico", icone: "caminhoCritico", ativo: () => critico, acao: () => ((critico = !critico), renderizar()) },
          { id: "zoom", rotulo: "Escala", opcoes: () => [["dia", "Escala: dias"], ["semana", "Escala: semanas"], ["mes", "Escala: meses"]], valor: () => zoom, aoMudar: (v) => ((zoom = v as Zoom), renderizar()) },
          { id: "hoje", rotulo: "Hoje", icone: "hoje", dica: "Rolar até hoje", acao: () => (ganttArea.scrollLeft = Math.max(0, (serial(hojeIso()) - s0) * px - 80)) },
        ],
      ],
    },
  ],
});

addEventListener("resize", () => vista === "gantt" && renderizarGantt());
// a faixa de comandos não rouba o foco (o teclado continua na tabela)
document.querySelector(".wj-comandos")!.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest("button")) e.preventDefault();
});
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || editor || (e.target as HTMLElement).closest("input, textarea, select")) return;
  const k = e.key.toLowerCase();
  if (k === "z") (e.preventDefault(), casca.o.desfazer!());
  else if (k === "y") (e.preventDefault(), casca.o.refazer!());
});

mudou(false);
registrarOffline();

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__cr = { doc: () => doc, res: () => res, carregar, exemplo, importarXML };
