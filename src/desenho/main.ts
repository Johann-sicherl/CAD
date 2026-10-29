// WJCAD — ambiente de Desenho (cad/desenho/). Folhas com formato ABNT e legenda, vistas do modelo
// (peça ou montagem) projetadas pelo kernel com remoção de linhas ocultas, três vistas padrão,
// vista projetada, notas, propriedades da folha e PDF. Especificação: docs/funcional/desenho.md.
// Modelo puro em ./modelo.ts (testado em scripts/teste-desenho.ts).

import "../style.css";
import { ICONES, type NomeIcone } from "../icones";
import { ClienteKernel, type ResultadoComponente } from "../kernel/cliente";
import type { Corte, Projecao } from "../kernel/projecao";
import { ehBaseChapa, MATERIAIS, validarDocumento, type Documento } from "../model";
import { aplicarPonto, embutirPeca, marcaDe, posesExplodidas, quantidades, validarMontagem, type DocumentoMontagem } from "../montagem/modelo";
import {
  desenhoCota, entidadeSob, gerarDxf, medida, posicionarBaloes, reencontrar, segmentos, type Balao, type Cota, type EntCota, type EntDxf,
} from "./anotacoes";
import {
  afastarDaMae, areaUtil, cameraProjetada, escalaQueCabe, CAMERAS, CAMPOS_LEGENDA, caixaNaFolha, desenhoVazio, ESCALAS, escalaDaVista, excluirVistas, FORMATOS, ladoDoPonto,
  layoutTresVistas, lerEscala, naVista, pontoNaVista, proximaLetra, moldura, moverVista, NOME_ESTILO, NOME_ORIENTACAO, novaFolha, novoIdD, orientacaoDe, preencherPropriedades,
  proximoNomeVista, retanguloLegenda, rotuloEscala, validarDesenho, type Camera, type CampoLegenda, type DocumentoDesenho, type EstiloVista,
  type Folha, type Formato, type ModeloDesenho, type Nota, type Orientacao, type Retangulo, type VistaDesenho,
} from "./modelo";
import {
  abrirArquivoNoApp, abrirCopias, abrirDoCofre, desligar, documentosDoCofre, instalarPainelCofre, lerDoCofre, salvarNoCofre,
  sincronizarAoAbrir, vinculo,
} from "../comum/cofre";
import {
  $, abrirGaveta, abrirJanela, abrirPopover, aplicarDispositivo, avisar, baixar, escapar, esconderBarra, fecharJanela,
  instalarFecharAoTocarFora, mostrarBarra, type AcaoContexto,
} from "../ui/basico";

const CHAVE = "wjcad:desenho"; // salvamento automático (o WJPDM também grava aqui para abrir)
const RAIZ = import.meta.env.BASE_URL;

// ---------- estado ----------
let doc: DocumentoDesenho | null = null;
let folhaId = "";
const historico: string[] = [];
const refazer: string[] = [];
let selVistas: string[] = [];
let selNota: string | null = null;
/** Cota, balão ou tabela selecionada. */
let selAnot: { k: "cota" | "balao" | "tabela"; id: string } | null = null;
let estadoKernel: "iniciando" | "pronto" | "erro" = "iniciando";
/** Cartão do cofre de cada modelo (legenda e notas). */
const cartoes = new Map<string, Record<string, string>>();
/** Revisão do próprio desenho no cofre. */
let revisaoDesenho = "";

type Comando =
  | { tipo: "modelo"; tres: boolean; modelo: string | null; orientacoes: Orientacao[]; multiplas: boolean; estilo: EstiloVista; escala?: number; iso: boolean }
  | { tipo: "projetada"; mae: string | null; criadas: number }
  | { tipo: "nota"; texto: string; altura: number; editando: string | null; snapshot: string }
  | { tipo: "vista"; id: string; snapshot: string }
  | { tipo: "folha"; snapshot: string; nova: boolean }
  | { tipo: "legenda"; snapshot: string }
  /** seção: vista mãe, orientação da linha e o ponto do corte (plano da mãe, mm do modelo) */
  | { tipo: "secao"; mae: string | null; orient: "horizontal" | "vertical"; ponto: [number, number] | null }
  /** detalhe: vista mãe, centro e raio do círculo (plano da mãe, mm do modelo) */
  | { tipo: "detalhe"; mae: string | null; centro: [number, number] | null; r: number | null; fator: number }
  | { tipo: "planificada"; modelo: string | null }
  /** cota inteligente: vista, 1ª e 2ª entidade (o toque seguinte no vazio coloca a cota) */
  | { tipo: "cota"; vista: string | null; e1: EntCota | null; e2: EntCota | null }
  | { tipo: "editarCota"; id: string; snapshot: string };
let comando: Comando | null = null;

aplicarDispositivo();
const kernel = new ClienteKernel();
const svg = $("folha") as unknown as SVGSVGElement;

kernel.pronto.then(() => {
  $("carregando").remove();
  estadoKernel = "pronto";
  atualizarStatus();
  desenharFolha();
}).catch((e) => {
  $("carregando").textContent = "Falha ao carregar o kernel: " + (e as Error).message;
  estadoKernel = "erro";
  atualizarStatus();
});

const folha = (): Folha | undefined => doc?.folhas.find((f) => f.id === folhaId) ?? doc?.folhas[0];
const modeloDe = (id: string) => doc?.modelos.find((m) => m.id === id);
const vistaDe = (id: string | null) => (id ? folha()?.vistas.find((v) => v.id === id) : undefined);
const fmt = (v: number) => (Math.round(v * 1000) / 1000).toLocaleString("pt-BR");
const nomeCamera = (c: Camera) => {
  const o = orientacaoDe(c);
  return o ? NOME_ORIENTACAO[o] : "Projetada";
};

// ---------- sólidos e projeções no kernel ----------

/** Opções da projeção de uma vista: corte (seção), montagem explodida, chapa planificada. */
interface OpcoesProj {
  corte?: Corte;
  explodida?: boolean;
  planificada?: boolean;
}
const opcoesDa = (v: VistaDesenho): OpcoesProj => ({
  ...(v.secao ? { corte: { p: v.secao.p, n: v.camera.olho } } : {}),
  ...(v.explodida ? { explodida: true } : {}),
  ...(v.planificada ? { planificada: true } : {}),
});

type ItemKernel = { chave: string; features: Documento["features"]; planificar: boolean; t: { pos: [number, number, number]; rot: [number, number, number, number] } };

/** Peças que formam o modelo, com a chave do sólido no kernel e a posição. */
function itensDoModelo(m: ModeloDesenho, o: OpcoesProj = {}): ItemKernel[] {
  const feats = (d: Documento) => d.features.slice(0, d.retrocesso ?? d.features.length);
  if (m.tipo === "peca") {
    const d = m.doc as Documento;
    return [{ chave: `peca:${marcaDe(JSON.stringify(feats(d)))}${o.planificada ? ":plan" : ""}`, features: feats(d), planificar: !!o.planificada, t: { pos: [0, 0, 0], rot: [0, 0, 0, 1] } }];
  }
  const a = m.doc as DocumentoMontagem;
  const poses = o.explodida ? posesExplodidas(a) : null;
  return a.componentes.filter((c) => !c.suprimido).flatMap((c) => {
    const p = a.pecas.find((x) => x.id === c.peca);
    if (!p) return [];
    const f = feats(p.doc);
    return [{ chave: `${p.id}:${p.marca ?? marcaDe(JSON.stringify(f))}`, features: f, planificar: false, t: poses?.get(c.id) ?? c.t }];
  });
}

const solidos = new Map<string, Promise<ResultadoComponente>>();
/** Resultado de cada sólido já calculado (topologia: centro das peças para os balões). */
const resultados = new Map<string, ResultadoComponente>();
/** Chapa planificada: linhas de dobra e plano, pela chave do sólido. */
const planificados = new Map<string, Pick<ResultadoComponente, "dobras" | "plano">>();
const projecoes = new Map<string, Projecao>();
const pedidosProj = new Map<string, Promise<Projecao>>();
const errosProj = new Map<string, string>();

/** Tolerância das curvas: ~0,15 mm na folha. */
const tolDe = (escala: number) => Number(Math.min(5, Math.max(0.01, 0.15 / escala)).toPrecision(2));
const v3 = (v: number[]) => v.map((x) => x.toFixed(4)).join(",");
const chaveProj = (m: ModeloDesenho, c: Camera, escala: number, o: OpcoesProj = {}) =>
  `${m.id}:${m.marca ?? ""}${m.tipo === "montagem" ? `:${marcaDe((m.doc as DocumentoMontagem).pecas.map((p) => p.marca ?? p.id).join())}` : ""}|${v3(c.olho)}|${v3(c.direita)}|${tolDe(escala)}${o.corte ? `|c${v3(o.corte.p)}` : ""}${o.explodida ? `|x${marcaDe(JSON.stringify((m.doc as DocumentoMontagem).explosao ?? []))}` : ""}${o.planificada ? "|p" : ""}`;
const chaveDaVista = (f: Folha, v: VistaDesenho, m: ModeloDesenho) => chaveProj(m, v.camera, escalaDaVista(f, v), opcoesDa(v));

/** Sólidos das peças no kernel (uma vez por chave). */
function garantirSolidos(itens: ItemKernel[]) {
  return Promise.all(itens.map((it) => {
    let s = solidos.get(it.chave);
    if (!s) {
      s = kernel.componente(it.chave, it.features, it.planificar).then((r) => {
        resultados.set(it.chave, r);
        if (it.planificar) planificados.set(it.chave, { dobras: r.dobras, plano: r.plano });
        return r;
      }, (e) => {
        solidos.delete(it.chave);
        throw e;
      });
      solidos.set(it.chave, s);
    }
    return s;
  }));
}

function projecaoDe(m: ModeloDesenho, c: Camera, escala: number, o: OpcoesProj = {}): Promise<Projecao> {
  const k = chaveProj(m, c, escala, o);
  const pronta = projecoes.get(k);
  if (pronta) return Promise.resolve(pronta);
  let p = pedidosProj.get(k);
  if (!p) {
    p = (async () => {
      await kernel.pronto;
      const itens = itensDoModelo(m, o);
      if (!itens.length) throw new Error("O modelo não tem peças.");
      await garantirSolidos(itens);
      const pedir = () => kernel.projetar(itens.map((it) => ({ chave: it.chave, t: it.t })), c, tolDe(escala), o.corte);
      try {
        return await pedir();
      } catch (e) {
        // kernel recarregado (sólidos perdidos): calcula de novo e tenta mais uma vez
        if (!/não calculada/.test((e as Error).message)) throw e;
        for (const it of itens) solidos.delete(it.chave);
        await garantirSolidos(itens);
        return pedir();
      }
    })().then((r) => {
      projecoes.set(k, r);
      pedidosProj.delete(k);
      errosProj.delete(k);
      return r;
    }, (e) => {
      pedidosProj.delete(k);
      errosProj.set(k, (e as Error).message);
      throw e;
    });
    pedidosProj.set(k, p);
  }
  return p;
}
const projecaoDaVista = (f: Folha, v: VistaDesenho, m: ModeloDesenho) => projecaoDe(m, v.camera, escalaDaVista(f, v), opcoesDa(v));

const projDaVista = (f: Folha, v: VistaDesenho) => {
  const m = modeloDe(v.modelo);
  return m ? projecoes.get(chaveDaVista(f, v, m)) : undefined;
};
/** Caixa da vista na folha (detalhe: o círculo). */
function caixaDaVista(f: Folha, v: VistaDesenho): Retangulo | null {
  const s = escalaDaVista(f, v);
  if (v.detalhe) {
    const d = v.detalhe;
    return caixaNaFolha(v, s, { x0: d.cx - d.r, y0: d.cy - d.r, x1: d.cx + d.r, y1: d.cy + d.r });
  }
  const p = projDaVista(f, v);
  return p ? caixaNaFolha(v, s, p.caixa) : null;
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
    /* sem espaço (modelos grandes embutidos): segue sem o salvamento automático */
  }
}
function alterou() {
  registrarPasso();
  salvarAutosave();
  tudo();
}
function tudo() {
  desenharFolha();
  renderizarArvore();
  renderizarAbasFolhas();
  atualizarStatus();
}
function restaurar(json: string) {
  doc = validarDesenho(JSON.parse(json));
  if (!doc.folhas.some((f) => f.id === folhaId)) folhaId = doc.folhas[0].id;
  selVistas = selVistas.filter((id) => vistaDe(id));
  if (selNota && !folha()?.notas.some((n) => n.id === selNota)) selNota = null;
  $<HTMLInputElement>("nome-doc").value = doc.nome;
  salvarAutosave();
  tudo();
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
  const f = folha();
  if (!doc || !f) {
    st.textContent = "Nenhum desenho aberto";
    $("st-info").textContent = "";
    return;
  }
  let estado = texto ?? "Editando desenho";
  if (!texto && comando?.tipo === "modelo") estado = comando.modelo ? (comando.tres ? "Três vistas padrão: ✓ para colocar" : "Vista do modelo: toque na folha onde a vista deve ficar") : "Escolha a peça ou montagem no painel";
  else if (!texto && comando?.tipo === "projetada") estado = comando.mae ? "Vista projetada: toque ao lado da vista (direita, esquerda, acima, abaixo ou na diagonal)" : "Vista projetada: toque a vista mãe";
  else if (!texto && comando?.tipo === "secao") estado = !comando.mae ? "Vista de seção: toque a vista a cortar" : !comando.ponto ? "Vista de seção: toque por onde passa o corte" : "Vista de seção: toque onde a seção fica (do lado para onde se olha)";
  else if (!texto && comando?.tipo === "detalhe") estado = !comando.mae ? "Vista de detalhe: toque a vista" : !comando.centro ? "Vista de detalhe: toque o centro da região" : comando.r === null ? "Vista de detalhe: toque a borda do círculo" : "Vista de detalhe: toque onde o detalhe fica";
  else if (!texto && comando?.tipo === "planificada") estado = comando.modelo ? "Vista planificada: toque onde ela fica" : "Vista planificada: escolha a peça de chapa";
  else if (!texto && comando?.tipo === "cota") estado = !comando.e1 ? "Cota: toque uma aresta, vértice ou círculo de uma vista" : "Cota: toque outra entidade (distância/ângulo) ou onde o número fica";
  else if (!texto && comando?.tipo === "nota") estado = comando.editando ? "Nota: edite o texto no painel" : "Nota: escreva o texto e toque na folha";
  else if (!texto && selVistas.length) estado = `Selecionada: ${selVistas.map((id) => vistaDe(id)?.nome ?? "?").join(", ")}`;
  st.textContent = estado;
  const nErros = f.vistas.filter((v) => {
    const m = modeloDe(v.modelo);
    return m && errosProj.has(chaveDaVista(f, v, m));
  }).length;
  st.classList.toggle("com-erro", nErros > 0);
  $("st-info").textContent = `${f.nome} · ${FORMATOS[f.formato].nome} · escala ${rotuloEscala(f.escala)} · ${f.diedro}º diedro · ${f.vistas.length} vista(s)${nErros ? ` · ${nErros} com erro` : ""}`;
}

// ---------- folha (SVG) ----------

/** Janela visível da folha (coordenadas do SVG, mm). */
let vb = { x: 0, y: 0, w: 420, h: 297 };
let vbFolha = "";

function pxPorMm(): number {
  const r = svg.getBoundingClientRect();
  return r.width ? r.width / vb.w : 1;
}
function aplicarVb() {
  const r = svg.getBoundingClientRect();
  if (r.width && r.height) vb.h = vb.w * (r.height / r.width);
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  // espessuras com mínimo de ~1 px na tela (na impressão valem as da norma)
  const px = 1 / pxPorMm();
  svg.style.setProperty("--lv", String(Math.max(0.5, 1.5 * px)));
  svg.style.setProperty("--lo", String(Math.max(0.35, 1.1 * px)));
  svg.style.setProperty("--lf", String(Math.max(0.25, 0.8 * px)));
  svg.style.setProperty("--lm", String(Math.max(0.7, 1.8 * px)));
}
function enquadrarFolha() {
  const f = folha();
  if (!f) return;
  const F = FORMATOS[f.formato];
  const r = svg.getBoundingClientRect();
  const asp = r.width && r.height ? r.height / r.width : F.a / F.l;
  const m = 0.04;
  let w = F.l * (1 + 2 * m);
  if (w * asp < F.a * (1 + 2 * m)) w = (F.a * (1 + 2 * m)) / asp;
  vb = { x: F.l / 2 - w / 2, y: F.a / 2 - (w * asp) / 2, w, h: w * asp };
  aplicarVb();
}
/** Cliente (px) → folha (mm, y para cima). */
function paraFolha(cx: number, cy: number): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  const f = folha();
  const sx = vb.x + ((cx - r.left) / r.width) * vb.w, sy = vb.y + ((cy - r.top) / r.height) * vb.h;
  return { x: sx, y: (f ? FORMATOS[f.formato].a : 0) - sy };
}

const n3 = (v: number) => Math.round(v * 1000) / 1000;
const caminhos = new Map<string, { vis: string; oc: string }>();
function caminhoDe(k: string, p: Projecao) {
  let c = caminhos.get(k);
  if (!c) {
    const d = (ls: [number, number][][]) => ls.map((l) => "M" + l.map(([x, y]) => `${n3(x)} ${n3(y)}`).join("L")).join("");
    c = { vis: d(p.visiveis), oc: d(p.ocultas) };
    caminhos.set(k, c);
    if (caminhos.size > 200) caminhos.delete(caminhos.keys().next().value!);
  }
  return c;
}

/** Propriedades para a legenda e as notas ({codigo}, {titulo}, {material}…). */
function propriedades(f: Folha): Record<string, string> {
  const d = doc!;
  const m = d.modelos.find((x) => f.vistas.some((v) => v.modelo === x.id)) ?? d.modelos[0];
  const cartao = (m && cartoes.get(m.id)) ?? {};
  const mat = m?.tipo === "peca" ? MATERIAIS[(m.doc as Documento).material ?? ""]?.nome : undefined;
  const i = d.folhas.indexOf(f);
  const leg = d.legenda;
  return {
    empresa: leg.empresa ?? "",
    titulo: leg.titulo || cartao.descricao || m?.nome || d.nome,
    codigo: leg.codigo || cartao.codigo || d.nome,
    material: leg.material || mat || cartao.material || "",
    massa: leg.massa ?? "",
    projetista: leg.projetista || cartao.projetista || "",
    aprovado: leg.aprovado ?? "",
    data: leg.data || new Date().toLocaleDateString("pt-BR"),
    revisao: leg.revisao || revisaoDesenho || "",
    escala: rotuloEscala(f.escala),
    folha: `${i + 1}/${d.folhas.length}`,
    descricao: cartao.descricao ?? "",
    modelo: m?.nome ?? "",
  };
}

const txt = (x: number, y: number, t: string, h: number, extra = "") => `<text x="${n3(x)}" y="${n3(y)}" font-size="${h}" ${extra}>${escapar(t)}</text>`;

/** Símbolo do diedro (tronco de cone, ISO 5456-2): 1º diedro = círculos à direita. */
function simboloDiedro(x: number, y: number, diedro: 1 | 3): string {
  // x, y: centro do campo (coordenadas do SVG)
  const trap = (cx: number) => `<path d="M${cx - 5} ${y - 2}L${cx + 5} ${y - 4}L${cx + 5} ${y + 4}L${cx - 5} ${y + 2}Z" />`;
  const circ = (cx: number) => `<circle cx="${cx}" cy="${y}" r="4" /><circle cx="${cx}" cy="${y}" r="2" />`;
  return `<g class="l-fina" fill="none">${diedro === 1 ? trap(x - 6) + circ(x + 7) : circ(x - 7) + trap(x + 6)}</g>`;
}

function legendaSvg(f: Folha, A: number): string {
  const r = retanguloLegenda(f.formato);
  const p = propriedades(f);
  const X = (v: number) => r.x0 + v, Y = (v: number) => A - (r.y0 + v); // v medido de baixo da legenda
  const W = r.x1 - r.x0;
  // colunas proporcionais à largura (175 mm nos formatos grandes, 178 no A4 retrato)
  const k = W / 175;
  const cel = (x0: number, x1: number, y0: number, y1: number, rot: string, valor: string, h = 3.5) =>
    `<rect x="${X(x0 * k)}" y="${Y(y1)}" width="${(x1 - x0) * k}" height="${y1 - y0}" class="l-fina" fill="none" />` +
    txt(X(x0 * k) + 1, Y(y1) + 2.6, rot, 1.8, 'class="t-rot"') + (valor ? txt(X(x0 * k) + 1.5, Y(y0) - 2.6, valor, h, valor.length * h * 0.55 > (x1 - x0) * k - 3 ? `textLength="${(x1 - x0) * k - 3}" lengthAdjust="spacingAndGlyphs"` : "") : "");
  return `<g class="legenda" data-legenda="1">
    <rect x="${r.x0}" y="${A - r.y1}" width="${W}" height="${r.y1 - r.y0}" class="l-media" fill="#fff" />
    ${cel(0, 120, 30, 44, "TÍTULO", p.titulo, 5)}${cel(120, 175, 30, 44, "EMPRESA", p.empresa)}
    ${cel(0, 70, 16, 30, "CÓDIGO / Nº DO DESENHO", p.codigo, 5)}${cel(70, 120, 16, 30, "MATERIAL", p.material)}${cel(120, 150, 16, 30, "MASSA", p.massa)}${cel(150, 175, 16, 30, "REVISÃO", p.revisao, 5)}
    ${cel(0, 35, 0, 16, "PROJETISTA", p.projetista)}${cel(35, 70, 0, 16, "APROVADO", p.aprovado)}${cel(70, 95, 0, 16, "DATA", p.data)}${cel(95, 115, 0, 16, "ESCALA", p.escala)}${cel(115, 140, 0, 16, "DIEDRO", "")}${cel(140, 155, 0, 16, "UNID.", "mm")}${cel(155, 175, 0, 16, "FOLHA", p.folha)}
    ${simboloDiedro(X(127.5 * k), Y(7), f.diedro)}
  </g>`;
}

function formatoSvg(f: Folha): string {
  const F = FORMATOS[f.formato];
  const A = F.a;
  const m = moldura(f.formato);
  // marcas de centro da folha (NBR 10068): do corte da folha até a moldura, no meio de cada lado
  const cx = F.l / 2, cy = A / 2;
  return `<rect class="papel" x="0" y="0" width="${F.l}" height="${A}" />
    <rect x="${m.x0}" y="${A - m.y1}" width="${m.x1 - m.x0}" height="${m.y1 - m.y0}" class="l-moldura" fill="none" />
    <path class="l-moldura" d="M${cx} 0V${A - m.y1}M${cx} ${A - m.y0}V${A}M0 ${cy}H${m.x0}M${m.x1} ${cy}H${F.l}" />
    ${legendaSvg(f, A)}`;
}

/** Seta cheia (triângulo) com a ponta em (x, y) apontando para (dx, dy). */
const seta = (x: number, y: number, dx: number, dy: number, t = 3) => {
  const n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
  const bx = x - ux * t, by = y - uy * t;
  return `M${n3(x)} ${n3(y)}L${n3(bx - uy * t / 3)} ${n3(by + ux * t / 3)}L${n3(bx + uy * t / 3)} ${n3(by - ux * t / 3)}Z`;
};

/** Marcas que as vistas filhas deixam na mãe: linha de corte (seção) e círculo (detalhe). */
function marcasNaMae(f: Folha, mae: VistaDesenho, p: Projecao): string {
  const s = escalaDaVista(f, mae);
  let out = "";
  for (const v of f.vistas) {
    if (v.detalhe?.mae === mae.id) {
      const d = v.detalhe;
      out += `<circle class="m-detalhe" cx="${n3(d.cx * s)}" cy="${n3(-d.cy * s)}" r="${n3(d.r * s)}" />`
        + txt(n3((d.cx + d.r * 0.75) * s + 2), n3(-(d.cy + d.r * 0.75) * s - 2), d.letra, 5, 'class="t-letra"');
    }
    if (v.secao?.mae === mae.id) {
      // linha de corte: passa pelo ponto, perpendicular à direção de visão da seção (vista na mãe)
      const [px, py] = naVista(mae.camera, v.secao.p);
      const [nx, ny] = naVista(mae.camera, v.camera.olho);
      const dx = -ny, dy = nx;
      const b = p.caixa, m = 6 / s;
      // extremos: a reta cruza a caixa da mãe com folga
      const ts = [(b.x0 - m - px) / (dx || 1e-12), (b.x1 + m - px) / (dx || 1e-12), (b.y0 - m - py) / (dy || 1e-12), (b.y1 + m - py) / (dy || 1e-12)];
      const t0 = Math.abs(dx) > Math.abs(dy) ? Math.min(ts[0], ts[1]) : Math.min(ts[2], ts[3]);
      const t1 = Math.abs(dx) > Math.abs(dy) ? Math.max(ts[0], ts[1]) : Math.max(ts[2], ts[3]);
      const a = [(px + dx * t0) * s, -(py + dy * t0) * s], c = [(px + dx * t1) * s, -(py + dy * t1) * s];
      const ux = (c[0] - a[0]) / Math.hypot(c[0] - a[0], c[1] - a[1]), uy = (c[1] - a[1]) / Math.hypot(c[0] - a[0], c[1] - a[1]);
      // a seta aponta para onde se olha (−olho da seção), no sistema da folha (y para baixo)
      const vx = -nx, vy = ny;
      const k = Math.hypot(vx, vy) || 1;
      const sx = vx / k, sy = vy / k;
      out += `<path class="m-corte" d="M${n3(a[0])} ${n3(a[1])}L${n3(c[0])} ${n3(c[1])}" />`
        + `<path class="m-corte-ponta" d="M${n3(a[0])} ${n3(a[1])}l${n3(ux * 6)} ${n3(uy * 6)}M${n3(c[0])} ${n3(c[1])}l${n3(-ux * 6)} ${n3(-uy * 6)}" />`;
      for (const q of [a, c]) {
        const qx = q[0] + (q === a ? ux : -ux) * 3, qy = q[1] + (q === a ? uy : -uy) * 3;
        out += `<path class="m-seta" d="M${n3(qx)} ${n3(qy)}L${n3(qx + sx * 8)} ${n3(qy + sy * 8)}" /><path class="m-seta-ponta" d="${seta(qx + sx * 9, qy + sy * 9, sx, sy)}" />`
          + txt(n3(qx + sx * 12 - 1.8), n3(qy + sy * 12 + 1.8), v.secao.letra, 5, 'class="t-letra"');
      }
    }
  }
  return out;
}

function vistaSvg(f: Folha, v: VistaDesenho, A: number): string {
  const m = modeloDe(v.modelo);
  const s = escalaDaVista(f, v);
  const sel = selVistas.includes(v.id);
  const cab = `<g class="vista${sel ? " sel" : ""}" data-vista="${v.id}" transform="translate(${n3(v.x)} ${n3(A - v.y)})">`;
  if (!m) return "";
  const k = chaveDaVista(f, v, m);
  const p = projecoes.get(k);
  if (!p) {
    const erro = errosProj.get(k);
    if (!erro && !pedidosProj.has(k)) void projecaoDaVista(f, v, m).then(desenharFolha, desenharFolha);
    return `${cab}<rect class="v-alvo" x="-20" y="-8" width="40" height="12" /><text class="t-aviso" x="0" y="0" font-size="3.5" text-anchor="middle">${erro ? `erro: ${escapar(erro)}` : "calculando vista…"}</text></g>`;
  }
  const c = caminhoDe(k, p);
  const lv = `calc(var(--lv) / ${s})`, lo = `calc(var(--lo) / ${s})`, lf = `calc(var(--lf) / ${s})`;
  let geo = "";
  let defs = "";
  // hachura das regiões cortadas (NBR 12298: 45°, componentes vizinhos em sentidos alternados)
  if (p.cortes?.length) {
    const passo = 2.5 / s;
    for (const ang of [45, 135]) defs += `<pattern id="h${ang}-${v.id}" patternUnits="userSpaceOnUse" width="${n3(passo)}" height="${n3(passo)}" patternTransform="rotate(${ang})"><line class="v-hachura" x1="0" y1="0" x2="0" y2="${n3(passo)}" style="stroke-width:${lf}" /></pattern>`;
    geo += p.cortes.map((r) => `<path class="v-regiao" fill="url(#h${r.i % 2 ? 135 : 45}-${v.id})" fill-rule="evenodd" d="${r.lacos.map((l) => "M" + l.map(([x, y]) => `${n3(x)} ${n3(y)}`).join("L") + "Z").join("")}" />`).join("");
  }
  // ocultas por baixo das visíveis (onde coincidem, vale a contínua)
  if (v.estilo !== "sem-ocultas" && c.oc) geo += `<path class="v-oc" style="stroke-width:${v.estilo === "arame" ? lv : lo}" ${v.estilo === "ocultas" ? `stroke-dasharray="${n3(3 / s)} ${n3(1.5 / s)}"` : ""} d="${c.oc}" />`;
  geo += `<path class="v-vis" style="stroke-width:${lv}" d="${c.vis}" />`;
  if (v.marcasCentro !== false && p.circulos.length) {
    // marca de centro (NBR 8403, traço-ponto estreito): cruz que passa 2 mm além do círculo
    const e = 2 / s;
    geo += `<path class="v-centro" style="stroke-width:${lf}" stroke-dasharray="${n3(8 / s)} ${n3(1.5 / s)} ${n3(1 / s)} ${n3(1.5 / s)}" d="${p.circulos.map((q) => `M${n3(q.cx - q.r - e)} ${n3(q.cy)}H${n3(q.cx + q.r + e)}M${n3(q.cx)} ${n3(q.cy - q.r - e)}V${n3(q.cy + q.r + e)}`).join("")}" />`;
  }
  // chapa planificada: linhas de dobra (traço-ponto estreito)
  if (v.planificada) {
    const pl = itensDoModelo(m, opcoesDa(v)).map((it) => planificados.get(it.chave)).find(Boolean);
    if (pl?.dobras?.length) geo += `<path class="v-dobra" style="stroke-width:${lf}" stroke-dasharray="${n3(8 / s)} ${n3(1.5 / s)} ${n3(1 / s)} ${n3(1.5 / s)}" d="${pl.dobras.map((l) => "M" + l.map((q) => naVista(v.camera, q).map(n3).join(" ")).join("L")).join("")}" />`;
  }
  let b: Retangulo = p.caixa;
  let corpo = `<g transform="scale(${s} ${-s})">${geo}</g>`;
  if (v.detalhe) {
    const d = v.detalhe;
    b = { x0: d.cx - d.r, y0: d.cy - d.r, x1: d.cx + d.r, y1: d.cy + d.r };
    defs += `<clipPath id="c-${v.id}"><circle cx="${n3(d.cx)}" cy="${n3(d.cy)}" r="${n3(d.r)}" /></clipPath>`;
    corpo = `<g transform="scale(${s} ${-s})"><g clip-path="url(#c-${v.id})">${geo}</g><circle class="m-detalhe" style="stroke-width:${lf}" cx="${n3(d.cx)}" cy="${n3(d.cy)}" r="${n3(d.r)}" /></g>`;
  }
  const x0 = b.x0 * s - 3, y0 = -b.y1 * s - 3, w = (b.x1 - b.x0) * s + 6, h = (b.y1 - b.y0) * s + 6;
  const titulo = v.secao ? `SEÇÃO ${v.secao.letra}-${v.secao.letra}` : v.detalhe ? `DETALHE ${v.detalhe.letra}` : v.nome.toUpperCase();
  const mostrarRotulo = v.secao || v.detalhe || (v.rotulo ?? (v.escala !== undefined && v.escala !== f.escala));
  const comEscala = v.detalhe || (v.escala !== undefined && v.escala !== f.escala);
  const rot = mostrarRotulo ? txt(n3((b.x0 + b.x1) * s / 2), n3(-b.y0 * s + 8), `${titulo}${comEscala ? `  ESCALA ${rotuloEscala(s)}` : ""}`, 3.5, 'text-anchor="middle" class="t-rotulo"') : "";
  return `${cab}${defs ? `<defs>${defs}</defs>` : ""}<rect class="v-alvo" x="${n3(x0)}" y="${n3(y0)}" width="${n3(w)}" height="${n3(h)}" />
    ${corpo}${marcasNaMae(f, v, p)}${rot}</g>`;
}

function notaSvg(f: Folha, n: Nota, A: number): string {
  const linhas = preencherPropriedades(n.texto, propriedades(f)).split("\n");
  return `<text class="nota${selNota === n.id ? " sel" : ""}" data-nota="${n.id}" x="${n3(n.x)}" y="${n3(A - n.y)}" font-size="${n.altura}">${linhas.map((l, i) => `<tspan x="${n3(n.x)}" dy="${i ? n.altura * 1.5 : 0}">${escapar(l) || " "}</tspan>`).join("")}</text>`;
}

/** Conteúdo SVG da folha inteira (tela e PDF). */
function conteudoFolha(f: Folha): string {
  const A = FORMATOS[f.formato].a;
  return formatoSvg(f) + f.vistas.map((v) => vistaSvg(f, v, A)).join("") + f.notas.map((n) => notaSvg(f, n, A)).join("")
    + f.cotas.map((c) => cotaSvg(f, c, A)).join("") + f.baloes.map((b) => balaoSvg(f, b, A)).join("") + f.tabelas.map((t) => tabelaSvg(f, t, A)).join("");
}

// ---------- cotas, balões e lista de materiais na folha ----------

/** Cota com as entidades reencontradas na vista atual (null nas que sumiram: pendente). */
function cotaAtual(f: Folha, c: Cota): { c: Cota; pendente: boolean } {
  const v = vistaDe(c.vista);
  const p = v && projDaVista(f, v);
  if (!v || !p) return { c, pendente: false };
  const tol = Math.max(0.05, 0.6 / escalaDaVista(f, v));
  const e1 = reencontrar(c.e1, p.visiveis, p.circulos, tol);
  const e2 = c.e2 ? reencontrar(c.e2, p.visiveis, p.circulos, tol) : undefined;
  if (!e1 || (c.e2 && !e2)) return { c, pendente: true };
  return { c: { ...c, e1, ...(e2 ? { e2 } : {}) }, pendente: false };
}

/** Seta cheia na folha (SVG, y para baixo) a partir de ponta e direção em y para cima. */
const setaSvg = (x: number, y: number, dx: number, dy: number) => seta(x, y, dx, -dy, 3);

function cotaSvg(f: Folha, cota: Cota, A: number): string {
  const v = vistaDe(cota.vista);
  if (!v) return "";
  const s = escalaDaVista(f, v);
  const { c, pendente } = cotaAtual(f, cota);
  const d = desenhoCota(c, s);
  if (!d) return "";
  const X = (p: [number, number]) => n3(v.x + p[0]), Y = (p: [number, number]) => n3(A - (v.y + p[1]));
  const sel = selAnot?.k === "cota" && selAnot.id === cota.id;
  const linhas = d.linhas.map(([a, b]) => `M${X(a)} ${Y(a)}L${X(b)} ${Y(b)}`).join("")
    + d.arcos.map((a) => {
      const p0: [number, number] = [a.c[0] + a.r * Math.cos(a.a0), a.c[1] + a.r * Math.sin(a.a0)], p1: [number, number] = [a.c[0] + a.r * Math.cos(a.a1), a.c[1] + a.r * Math.sin(a.a1)];
      return `M${X(p0)} ${Y(p0)}A${n3(a.r)} ${n3(a.r)} 0 ${a.a1 - a.a0 > Math.PI ? 1 : 0} 0 ${X(p1)} ${Y(p1)}`;
    }).join("");
  const setas = d.setas.map((q) => setaSvg(Number(X(q.p)), Number(Y(q.p)), q.d[0], q.d[1])).join("");
  const t = d.texto;
  return `<g class="cota${sel ? " sel" : ""}${pendente ? " pendente" : ""}" data-anot="cota:${cota.id}">
    <path class="c-linha" d="${linhas}" /><path class="c-seta" d="${setas}" />
    <text class="c-texto" x="${X(t.p)}" y="${Y(t.p)}" font-size="3.5" text-anchor="middle" transform="rotate(${n3(-t.ang)} ${X(t.p)} ${Y(t.p)})">${escapar(t.s)}</text>
    <rect class="c-alvo" x="${n3(Number(X(t.p)) - 8)}" y="${n3(Number(Y(t.p)) - 5)}" width="16" height="7" /></g>`;
}

/** Itens da lista de materiais do modelo (mesma numeração dos balões). */
function linhasDaLista(m: ModeloDesenho): { item: number; peca: string; codigo: string; descricao: string; material: string; qtd: number }[] {
  if (m.tipo === "peca") {
    const d = m.doc as Documento;
    const cart = cartoes.get(m.id) ?? {};
    return [{ item: 1, peca: "peca", codigo: cart.codigo ?? "", descricao: cart.descricao || m.nome, material: MATERIAIS[d.material ?? ""]?.nome ?? cart.material ?? "", qtd: 1 }];
  }
  return quantidades(m.doc as DocumentoMontagem).map(({ peca, qtd }, i) => {
    const cart = (peca.arquivo && cartoesPecas.get(peca.arquivo)) || {};
    if (peca.arquivo && !cartoesPecas.has(peca.arquivo)) void lerCartaoPeca(peca.arquivo);
    return { item: i + 1, peca: peca.id, codigo: cart.codigo ?? "", descricao: cart.descricao || peca.nome, material: MATERIAIS[peca.doc.material ?? ""]?.nome ?? cart.material ?? "", qtd };
  });
}

/** Cartões das peças das montagens (lista de materiais), lidos do cofre sob demanda. */
const cartoesPecas = new Map<string, Record<string, string>>();
async function lerCartaoPeca(id: string) {
  cartoesPecas.set(id, {});
  const r = await lerDoCofre(id).catch(() => null);
  if (r) {
    cartoesPecas.set(id, r.arquivo.cartao);
    desenharFolha();
  }
}

function itemDoBalao(b: Balao, v: VistaDesenho): number | null {
  const m = modeloDe(v.modelo);
  if (!m) return null;
  if (m.tipo === "peca") return 1;
  const a = m.doc as DocumentoMontagem;
  const c = a.componentes.find((x) => x.id === b.comp);
  if (!c) return null;
  return quantidades(a).findIndex((q) => q.peca.id === c.peca) + 1 || null;
}

function balaoSvg(f: Folha, b: Balao, A: number): string {
  const v = vistaDe(b.vista);
  if (!v) return "";
  const s = escalaDaVista(f, v);
  const item = itemDoBalao(b, v);
  const ax = v.x + b.ancora[0] * s, ay = A - (v.y + b.ancora[1] * s);
  const bx = v.x + b.pos[0], by = A - (v.y + b.pos[1]);
  const r = 5;
  const k = Math.hypot(ax - bx, ay - by) || 1;
  const sel = selAnot?.k === "balao" && selAnot.id === b.id;
  return `<g class="balao${sel ? " sel" : ""}${item === null ? " pendente" : ""}" data-anot="balao:${b.id}">
    <path class="b-linha" d="M${n3(ax)} ${n3(ay)}L${n3(bx + ((ax - bx) / k) * r)} ${n3(by + ((ay - by) / k) * r)}" /><circle class="b-ponto" cx="${n3(ax)}" cy="${n3(ay)}" r="0.7" />
    <circle class="b-circulo" cx="${n3(bx)}" cy="${n3(by)}" r="${r}" />
    <text x="${n3(bx)}" y="${n3(by + 1.8)}" font-size="5" text-anchor="middle">${item ?? "?"}</text></g>`;
}

/** Lista de materiais (NBR 10582/13142): sobre a legenda, cabeçalho embaixo, itens subindo. */
function tabelaSvg(f: Folha, t: { id: string; modelo: string }, A: number): string {
  const m = modeloDe(t.modelo);
  if (!m) return "";
  const r = retanguloLegenda(f.formato);
  const W = r.x1 - r.x0, k = W / 175;
  const cols: [string, number, "start" | "middle"][] = [["ITEM", 15, "middle"], ["CÓDIGO", 35, "start"], ["DESCRIÇÃO", 70, "start"], ["MATERIAL", 35, "start"], ["QTD", 20, "middle"]];
  const linhas = linhasDaLista(m);
  const h = 7;
  const sel = selAnot?.k === "tabela" && selAnot.id === t.id;
  let out = `<g class="tabela-lista${sel ? " sel" : ""}" data-anot="tabela:${t.id}">`;
  const linha = (i: number, valores: string[], cab: boolean) => {
    const y0 = r.y1 + i * h;
    let x = r.x0;
    let g = `<rect class="l-fina" x="${n3(r.x0)}" y="${n3(A - y0 - h)}" width="${n3(W)}" height="${h}" fill="#fff" />`;
    cols.forEach(([, w], j) => {
      const ww = w * k;
      if (j) g += `<path class="l-fina" d="M${n3(x)} ${n3(A - y0)}V${n3(A - y0 - h)}" />`;
      const tx = cols[j][2] === "middle" ? x + ww / 2 : x + 1.5;
      const val = valores[j] ?? "";
      g += txt(tx, A - y0 - 2.2, val, cab ? 2.5 : 3, `text-anchor="${cols[j][2]}"${cab ? ' class="t-rot"' : ""}${val.length * 1.7 > ww - 3 ? ` textLength="${n3(ww - 3)}" lengthAdjust="spacingAndGlyphs"` : ""}`);
      x += ww;
    });
    return g;
  };
  out += linha(0, cols.map((c) => c[0]), true);
  linhas.forEach((l, i) => (out += linha(i + 1, [String(l.item), l.codigo, l.descricao, l.material, String(l.qtd)], false)));
  return out + "</g>";
}

function desenharFolha() {
  const f = folha();
  if (!doc || !f) {
    svg.innerHTML = "";
    return;
  }
  const chaveVb = `${f.id}:${f.formato}`;
  if (vbFolha !== chaveVb) {
    vbFolha = chaveVb;
    enquadrarFolha();
  }
  svg.innerHTML = `<rect class="sombra" x="2" y="2" width="${FORMATOS[f.formato].l}" height="${FORMATOS[f.formato].a}" />` + conteudoFolha(f) + (selVistas.length ? molduraSelecao(f) : "");
}

/** Moldura tracejada das vistas selecionadas. */
function molduraSelecao(f: Folha): string {
  const A = FORMATOS[f.formato].a;
  return selVistas.map((id) => {
    const v = vistaDe(id);
    const c = v && caixaDaVista(f, v);
    return c ? `<rect class="moldura-sel" x="${n3(c.x0 - 3)}" y="${n3(A - c.y1 - 3)}" width="${n3(c.x1 - c.x0 + 6)}" height="${n3(c.y1 - c.y0 + 6)}" />` : "";
  }).join("");
}

/** Arraste: só move os grupos (sem refazer os caminhos). */
function reposicionarVistas() {
  const f = folha();
  if (!f) return;
  const A = FORMATOS[f.formato].a;
  for (const v of f.vistas) svg.querySelector(`[data-vista="${v.id}"]`)?.setAttribute("transform", `translate(${n3(v.x)} ${n3(A - v.y)})`);
  svg.querySelectorAll(".moldura-sel").forEach((e) => e.remove());
  if (selVistas.length) svg.insertAdjacentHTML("beforeend", molduraSelecao(f));
}

new ResizeObserver(() => {
  if (!doc) return;
  aplicarVb();
}).observe(svg);

// ---------- interação na folha: zoom, pan, selecionar, mover ----------

const ponteiros = new Map<number, { x: number; y: number }>();
let gesto: null | { tipo: "pan"; x: number; y: number; vb0: typeof vb; moveu: boolean; alvo: Element | null; xy0: { x: number; y: number } }
  | { tipo: "vista"; id: string; ini: { x: number; y: number }; v0: { x: number; y: number }; moveu: boolean; snap: string }
  | { tipo: "nota"; id: string; ini: { x: number; y: number }; n0: { x: number; y: number }; moveu: boolean; snap: string }
  | { tipo: "anot"; k: "cota" | "balao" | "tabela"; id: string; ini: { x: number; y: number }; o0: [number, number]; moveu: boolean }
  | { tipo: "pinca"; d0: number; m0: { x: number; y: number }; vb0: typeof vb } = null;

function zoomEm(cx: number, cy: number, fator: number) {
  const r = svg.getBoundingClientRect();
  const px = vb.x + ((cx - r.left) / r.width) * vb.w, py = vb.y + ((cy - r.top) / r.height) * vb.h;
  const w = Math.min(5000, Math.max(5, vb.w * fator));
  const k = w / vb.w;
  vb = { x: px - (px - vb.x) * k, y: py - (py - vb.y) * k, w, h: vb.h * k };
  aplicarVb();
}

svg.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomEm(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015));
}, { passive: false });

svg.addEventListener("pointerdown", (e) => {
  if (!doc) return;
  svg.setPointerCapture(e.pointerId);
  ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ponteiros.size === 2) {
    const [a, b] = [...ponteiros.values()];
    gesto = { tipo: "pinca", d0: Math.hypot(a.x - b.x, a.y - b.y), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, vb0: { ...vb } };
    return;
  }
  if (ponteiros.size > 2) return;
  const alvo = e.target as Element;
  const naVista = alvo.closest("[data-vista]")?.getAttribute("data-vista");
  const naNota = alvo.closest("[data-nota]")?.getAttribute("data-nota");
  const naAnot = alvo.closest("[data-anot]")?.getAttribute("data-anot");
  const p = paraFolha(e.clientX, e.clientY);
  // botão do meio: sempre pan; comando que espera toque na folha: o toque é do comando
  const comandoToca = comando && (comando.tipo === "modelo" && !comando.tres && comando.modelo || comando.tipo === "projetada" || (comando.tipo === "nota" && !comando.editando)
    || comando.tipo === "secao" || comando.tipo === "detalhe" || comando.tipo === "planificada" || comando.tipo === "cota");
  if (e.button === 1 || e.button === 2 || comandoToca || (!naVista && !naNota && !naAnot)) {
    gesto = { tipo: "pan", x: e.clientX, y: e.clientY, vb0: { ...vb }, moveu: false, alvo: e.button === 0 ? alvo : null, xy0: p };
    return;
  }
  if (naAnot) {
    const [k, id] = naAnot.split(":") as ["cota" | "balao" | "tabela", string];
    const f = folha()!;
    const o = k === "cota" ? f.cotas.find((x) => x.id === id)?.pos : k === "balao" ? f.baloes.find((x) => x.id === id)?.pos : [0, 0];
    gesto = { tipo: "anot", k, id, ini: p, o0: [...(o ?? [0, 0])] as [number, number], moveu: false };
    return;
  }
  if (naNota) {
    const n = folha()!.notas.find((x) => x.id === naNota)!;
    gesto = { tipo: "nota", id: naNota, ini: p, n0: { x: n.x, y: n.y }, moveu: false, snap: JSON.stringify(doc) };
    return;
  }
  const v = vistaDe(naVista!)!;
  gesto = { tipo: "vista", id: v.id, ini: p, v0: { x: v.x, y: v.y }, moveu: false, snap: JSON.stringify(doc) };
});

svg.addEventListener("pointermove", (e) => {
  if (!ponteiros.has(e.pointerId) || !gesto) return;
  ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesto.tipo === "pinca") {
    const [a, b] = [...ponteiros.values()];
    if (!b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = svg.getBoundingClientRect();
    const k = gesto.d0 / Math.max(10, d);
    const w = Math.min(5000, Math.max(5, gesto.vb0.w * k));
    const kk = w / gesto.vb0.w;
    // o ponto da folha sob o meio inicial dos dedos fica sob o meio atual
    const px = gesto.vb0.x + ((gesto.m0.x - r.left) / r.width) * gesto.vb0.w, py = gesto.vb0.y + ((gesto.m0.y - r.top) / r.height) * gesto.vb0.h;
    vb = { x: px - ((m.x - r.left) / r.width) * w, y: py - ((m.y - r.top) / r.height) * gesto.vb0.h * kk, w, h: gesto.vb0.h * kk };
    aplicarVb();
    return;
  }
  if (gesto.tipo === "pan") {
    const dx = e.clientX - gesto.x, dy = e.clientY - gesto.y;
    if (!gesto.moveu && Math.hypot(dx, dy) < 6) return;
    gesto.moveu = true;
    const k = gesto.vb0.w / svg.getBoundingClientRect().width;
    vb = { ...gesto.vb0, x: gesto.vb0.x - dx * k, y: gesto.vb0.y - dy * k };
    aplicarVb();
    return;
  }
  const p = paraFolha(e.clientX, e.clientY);
  const dx = p.x - gesto.ini.x, dy = p.y - gesto.ini.y;
  if (!gesto.moveu && Math.hypot(dx, dy) * pxPorMm() < 6) return;
  gesto.moveu = true;
  esconderBarra();
  const f = folha()!;
  if (gesto.tipo === "anot") {
    const g = gesto;
    if (g.k === "cota") {
      const c = f.cotas.find((x) => x.id === g.id), v = c && vistaDe(c.vista);
      if (c && v) c.pos = [g.o0[0] + dx / escalaDaVista(f, v), g.o0[1] + dy / escalaDaVista(f, v)];
    } else if (g.k === "balao") {
      const b = f.baloes.find((x) => x.id === g.id);
      if (b) b.pos = [g.o0[0] + dx, g.o0[1] + dy];
    }
    if (!quadroAnot) quadroAnot = requestAnimationFrame(() => {
      quadroAnot = 0;
      desenharFolha();
    });
    return;
  }
  if (gesto.tipo === "vista") {
    if (!selVistas.includes(gesto.id)) selVistas = [gesto.id];
    moverVista(f, gesto.id, gesto.v0.x + dx, gesto.v0.y + dy);
    reposicionarVistas();
  } else {
    const g = gesto;
    const n = f.notas.find((x) => x.id === g.id);
    if (n) {
      n.x = g.n0.x + dx;
      n.y = g.n0.y + dy;
      const el = svg.querySelector(`[data-nota="${n.id}"]`);
      el?.setAttribute("x", String(n3(n.x)));
      el?.setAttribute("y", String(n3(FORMATOS[f.formato].a - n.y)));
      el?.querySelectorAll("tspan").forEach((t) => t.setAttribute("x", String(n3(n.x))));
    }
  }
});

let quadroAnot = 0;

function soltar(e: PointerEvent) {
  if (!ponteiros.has(e.pointerId)) return;
  ponteiros.delete(e.pointerId);
  const g = gesto;
  if (g?.tipo === "pinca") {
    if (!ponteiros.size) gesto = null;
    return;
  }
  gesto = null;
  if (!g || e.type === "pointercancel") return;
  if (g.tipo === "pan") {
    if (!g.moveu && g.alvo) tocarFolha(g.alvo, g.xy0, e);
    return;
  }
  if (g.tipo === "vista") {
    if (g.moveu) return alterou();
    return tocarVista(g.id, e);
  }
  if (g.tipo === "anot") {
    if (g.moveu) return alterou();
    if (comando) return;
    selAnot = { k: g.k, id: g.id };
    selVistas = [];
    selNota = null;
    desenharFolha();
    return mostrarBarra([
      ...(g.k === "cota" ? [{ rotulo: "Editar cota", icone: "cota" as NomeIcone, acao: () => abrirEditarCota(g.id) }] : []),
      { rotulo: "Excluir", icone: "fechar", acao: () => excluirSelecao() },
    ], e.clientX, e.clientY);
  }
  if (g.moveu) return alterou();
  selNota = g.id;
  selVistas = [];
  desenharFolha();
  mostrarBarra([
    { rotulo: "Editar texto", icone: "nota", acao: () => abrirNota(g.id) },
    { rotulo: "Excluir", icone: "fechar", acao: () => excluirSelecao() },
  ], e.clientX, e.clientY);
}
svg.addEventListener("pointerup", soltar);
svg.addEventListener("pointercancel", soltar);
svg.addEventListener("contextmenu", (e) => e.preventDefault());
svg.addEventListener("dblclick", (e) => {
  const id = (e.target as Element).closest("[data-vista]")?.getAttribute("data-vista");
  if (id && !comando) abrirPropsVista(id);
  const n = (e.target as Element).closest("[data-nota]")?.getAttribute("data-nota");
  if (n && !comando) abrirNota(n);
  if ((e.target as Element).closest("[data-legenda]") && !comando) abrirLegenda();
});

/** Toque sem arrastar num lugar vazio (ou com comando que usa o toque). */
function tocarFolha(alvo: Element, p: { x: number; y: number }, e: PointerEvent) {
  if (comando?.tipo === "modelo" && comando.modelo && !comando.tres) return void colocarVistaModelo(p);
  if (comando?.tipo === "projetada") {
    const id = alvo.closest("[data-vista]")?.getAttribute("data-vista");
    if (!comando.mae || (id && id !== comando.mae && !comando.criadas)) {
      if (id) {
        comando.mae = id;
        selVistas = [id];
        desenharFolha();
        renderizarComando();
        atualizarStatus();
      } else avisar("Toque uma vista para ser a mãe da vista projetada.");
      return;
    }
    return void colocarProjetada(p);
  }
  if (comando?.tipo === "nota" && !comando.editando) return colocarNota(p);
  if (comando?.tipo === "secao" || comando?.tipo === "detalhe") return void tocarSecaoDetalhe(alvo, p);
  if (comando?.tipo === "planificada") return void colocarPlanificada(p);
  if (comando?.tipo === "cota") return tocarCota(alvo, p);
  if (comando) return;
  if (alvo.closest("[data-legenda]")) {
    selVistas = [];
    selNota = null;
    desenharFolha();
    return mostrarBarra([{ rotulo: "Editar legenda", icone: "folha", acao: abrirLegenda }, { rotulo: "Propriedades da folha", icone: "folha", acao: () => abrirPropsFolha(false) }], e.clientX, e.clientY);
  }
  if (selVistas.length || selNota || selAnot) {
    selVistas = [];
    selNota = null;
    selAnot = null;
    esconderBarra();
    tudo();
  }
}

function tocarVista(id: string, e: PointerEvent) {
  if (comando?.tipo === "projetada") return tocarFolha(svg.querySelector(`[data-vista="${id}"]`)!, paraFolha(e.clientX, e.clientY), e);
  if (comando) return;
  selNota = null;
  if (e.shiftKey || e.ctrlKey) selVistas = selVistas.includes(id) ? selVistas.filter((x) => x !== id) : [...selVistas, id];
  else selVistas = [id];
  tudo();
  if (selVistas.length) mostrarBarra(acoesDaVista(), e.clientX, e.clientY);
}

function acoesDaVista(): AcaoContexto[] {
  const id = selVistas[0];
  const v = vistaDe(id);
  const a: AcaoContexto[] = [];
  if (selVistas.length === 1 && v) {
    a.push({ rotulo: "Vista projetada", icone: "vistaProjetada", acao: () => abrirProjetada(id) });
    a.push({ rotulo: "Propriedades", icone: "configVista", acao: () => abrirPropsVista(id) });
    a.push({ rotulo: v.estilo === "ocultas" ? "Ocultas removidas" : "Ocultas tracejadas", icone: "estiloArestas", acao: () => {
      v.estilo = v.estilo === "ocultas" ? "sem-ocultas" : "ocultas";
      alterou();
    } });
    const m = modeloDe(v.modelo);
    if (m) a.push({ rotulo: m.tipo === "peca" ? "Abrir peça" : "Abrir montagem", icone: m.tipo === "peca" ? "peca" : "montagem", acao: () => void abrirModelo(m) });
  }
  a.push({ rotulo: "Excluir", icone: "fechar", acao: excluirSelecao });
  return a;
}

function excluirSelecao() {
  const f = folha();
  if (!f || comando) return;
  if (selAnot) {
    const { k, id } = selAnot;
    if (k === "cota") f.cotas = f.cotas.filter((x) => x.id !== id);
    else if (k === "balao") f.baloes = f.baloes.filter((x) => x.id !== id);
    else f.tabelas = f.tabelas.filter((x) => x.id !== id);
    selAnot = null;
    return alterou();
  }
  if (selNota) {
    f.notas = f.notas.filter((n) => n.id !== selNota);
    selNota = null;
    return alterou();
  }
  if (!selVistas.length) return;
  excluirVistas(f, selVistas);
  selVistas = [];
  limparModelos();
  alterou();
}

/** Modelos sem vista em nenhuma folha saem do desenho (e das referências do cofre). */
function limparModelos() {
  if (!doc) return;
  const usados = new Set(doc.folhas.flatMap((f) => f.vistas.map((v) => v.modelo)));
  doc.modelos = doc.modelos.filter((m) => usados.has(m.id));
}

async function abrirModelo(m: ModeloDesenho) {
  salvarAutosave();
  sessionStorage.setItem("wjcad:voltarDesenho", "1");
  if (m.arquivo) {
    const r = await lerDoCofre(m.arquivo);
    if (r) {
      avisar(`Abrindo ${m.nome}. Ao salvar lá e voltar, as vistas se atualizam.`);
      const erro = await abrirArquivoNoApp(r.arquivo);
      if (erro) avisar(erro);
      return;
    }
  }
  // modelo só embutido (veio do aparelho): abre a cópia
  if (m.tipo === "peca") {
    localStorage.setItem("jlscad:documento", JSON.stringify(m.doc));
    desligar("cad");
    location.href = new URL(`${RAIZ}cad/#abrir-autosave`, location.href).href;
  } else {
    localStorage.setItem("wjcad:montagem", JSON.stringify(m.doc));
    desligar("asm");
    location.href = new URL(`${RAIZ}cad/montagem/#abrir-autosave`, location.href).href;
  }
}

// ---------- árvore ----------

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
  raiz.innerHTML = `${ICONES.desenho}<strong></strong>`;
  raiz.querySelector("strong")!.textContent = doc.nome;
  lista.append(raiz);
  for (const f of doc.folhas) {
    const ativa = f.id === folha()?.id;
    const e = li(`item${ativa ? " selecionado" : ""}`, "folha", f.nome, `${FORMATOS[f.formato].nome} · ${rotuloEscala(f.escala)} · ${f.diedro}º diedro`);
    e.onclick = () => {
      if (!ativa) return trocarFolha(f.id);
      abrirPropsFolha(false);
    };
    lista.append(e);
    if (!ativa) continue;
    for (const v of f.vistas) {
      const m = modeloDe(v.modelo);
      const ev = li(`item${selVistas.includes(v.id) ? " selecionado" : ""}`, v.mae ? "vistaProjetada" : "vistaModelo", v.nome,
        `${v.planificada ? "Planificado" : v.secao && !v.detalhe ? `Seção ${v.secao.letra}-${v.secao.letra}` : v.detalhe ? `Detalhe ${v.detalhe.letra}` : nomeCamera(v.camera)}${v.explodida ? " explodida" : ""} · ${rotuloEscala(escalaDaVista(f, v))}${v.escala === undefined ? " (folha)" : ""} · ${m?.nome ?? "?"}`, 1);
      const k = m ? chaveDaVista(f, v, m) : "";
      if (errosProj.has(k)) ev.classList.add("com-erro");
      ev.onclick = (x) => {
        if (comando) return;
        selVistas = [v.id];
        selNota = null;
        tudo();
        mostrarBarra(acoesDaVista(), x.clientX, x.clientY);
      };
      ev.ondblclick = () => abrirPropsVista(v.id);
      lista.append(ev);
    }
    for (const n of f.notas) {
      const en = li(`item${selNota === n.id ? " selecionado" : ""}`, "nota", "Nota", n.texto.split("\n")[0].slice(0, 40), 1);
      en.onclick = () => {
        selNota = n.id;
        selVistas = [];
        tudo();
      };
      en.ondblclick = () => abrirNota(n.id);
      lista.append(en);
    }
  }
  if (doc.modelos.length) {
    lista.append(li("item ref", "pasta", "Modelos referenciados", `${doc.modelos.length}`));
    for (const m of doc.modelos) {
      const em = li("item", m.tipo === "peca" ? "peca" : "montagem", m.nome, `${m.tipo === "peca" ? "peça" : "montagem"}${m.arquivo ? " · cofre" : " · embutido"}${m.versao ? ` · v${m.versao}` : ""}`, 1);
      em.onclick = (x) => mostrarBarra([{ rotulo: m.tipo === "peca" ? "Abrir peça" : "Abrir montagem", icone: m.tipo === "peca" ? "peca" : "montagem", acao: () => void abrirModelo(m) }], x.clientX, x.clientY);
      lista.append(em);
    }
  }
}

// ---------- abas de folhas ----------

function trocarFolha(id: string) {
  if (comando) fecharComando();
  folhaId = id;
  selVistas = [];
  selNota = null;
  tudo();
}

function renderizarAbasFolhas() {
  const barra = $("abas-folhas");
  barra.innerHTML = "";
  if (!doc) return;
  for (const f of doc.folhas) {
    const b = document.createElement("button");
    b.className = "aba-folha";
    b.role = "tab";
    b.textContent = f.nome;
    b.setAttribute("aria-selected", String(f.id === folha()?.id));
    b.onclick = () => (f.id === folha()?.id ? abrirPopover(b, [
      { rotulo: "Propriedades da folha…", icone: "folha", acao: () => abrirPropsFolha(false) },
      { rotulo: "Excluir folha", icone: "fechar", acao: () => excluirFolha(f.id) },
    ]) : trocarFolha(f.id));
    barra.append(b);
  }
  const mais = document.createElement("button");
  mais.className = "aba-folha mais";
  mais.title = "Adicionar folha";
  mais.textContent = "+";
  mais.onclick = adicionarFolha;
  barra.append(mais);
}

function adicionarFolha() {
  if (!doc) return;
  if (comando) fecharComando();
  const atual = folha();
  const f = novaFolha(doc, atual?.formato ?? "A3");
  f.diedro = atual?.diedro ?? 1;
  doc.folhas.push(f);
  folhaId = f.id;
  selVistas = [];
  alterou();
  abrirPropsFolha(true);
}

function excluirFolha(id: string) {
  if (!doc) return;
  if (doc.folhas.length < 2) return avisar("O desenho precisa de pelo menos uma folha.");
  const f = doc.folhas.find((x) => x.id === id);
  if (f?.vistas.length && !confirm(`Excluir ${f.nome} com ${f.vistas.length} vista(s)?`)) return;
  doc.folhas = doc.folhas.filter((x) => x.id !== id);
  folhaId = doc.folhas[0].id;
  limparModelos();
  alterou();
}

// ---------- abas e faixa de comandos ----------

interface Cmd {
  id: string;
  rotulo: string;
  icone: NomeIcone;
  dica: string;
  grupo: number;
  emBreve?: boolean;
}
const ABAS_D: { id: string; rotulo: string; comandos: Cmd[] }[] = [
  {
    id: "vistas", rotulo: "Vistas", comandos: [
      { id: "modelo", rotulo: "Vista do modelo", icone: "vistaModelo", dica: "Vista de uma peça ou montagem numa orientação (frontal, superior, lateral, isométrica…)", grupo: 0 },
      { id: "tres", rotulo: "Três vistas padrão", icone: "tresVistas", dica: "Frontal, superior e lateral alinhadas no diedro da folha, com escala automática", grupo: 0 },
      { id: "projetada", rotulo: "Vista projetada", icone: "vistaProjetada", dica: "Vista alinhada ao lado de outra (ou isométrica na diagonal)", grupo: 0 },
      { id: "secao", rotulo: "Vista de seção", icone: "vistaCorte", dica: "Corte A-A com hachura: toque a vista, o lugar do corte e onde a seção fica", grupo: 1 },
      { id: "detalhe", rotulo: "Vista de detalhe", icone: "vistaDetalhe", dica: "Ampliação de uma região (DETALHE B): toque o centro, a borda do círculo e onde fica", grupo: 1 },
      { id: "planificada", rotulo: "Vista planificada", icone: "planificar", dica: "Padrão planificado da chapa com linhas de dobra", grupo: 1 },
      { id: "explodida", rotulo: "Vista explodida", icone: "explodida", dica: "Liga/desliga a posição explodida da montagem na vista selecionada", grupo: 1 },
    ],
  },
  {
    id: "anotacao", rotulo: "Anotação", comandos: [
      { id: "nota", rotulo: "Nota", icone: "nota", dica: "Texto na folha, com propriedades ligadas ({codigo}, {material}…)", grupo: 0 },
      { id: "marcas", rotulo: "Marcas de centro", icone: "marcaCentro", dica: "Liga/desliga as marcas de centro dos furos nas vistas selecionadas (ou em todas)", grupo: 0 },
      { id: "cota", rotulo: "Cota inteligente", icone: "cota", dica: "Toque arestas, vértices ou círculos de uma vista e depois onde fica o número (D)", grupo: 1 },
      { id: "balao", rotulo: "Balões automáticos", icone: "balao", dica: "Um balão por peça da montagem na vista selecionada, com o nº do item da lista", grupo: 1 },
      { id: "lista", rotulo: "Lista de materiais", icone: "listaMateriais", dica: "Tabela ITEM, CÓDIGO, DESCRIÇÃO, MATERIAL, QTD sobre a legenda", grupo: 1 },
    ],
  },
  {
    id: "folha", rotulo: "Folha", comandos: [
      { id: "props-folha", rotulo: "Propriedades da folha", icone: "folha", dica: "Nome, formato (A4–A0), escala e diedro", grupo: 0 },
      { id: "legenda", rotulo: "Legenda", icone: "folha", dica: "Campos da legenda (título, código, material, projetista…); vazios vêm do cartão do cofre", grupo: 0 },
      { id: "nova-folha", rotulo: "Adicionar folha", icone: "nova", dica: "Nova folha no desenho", grupo: 0 },
      { id: "pdf", rotulo: "Imprimir / PDF", icone: "pdf", dica: "Folha em tamanho real para imprimir ou salvar em PDF (Ctrl+P)", grupo: 1 },
      { id: "svg", rotulo: "Exportar SVG", icone: "exportar", dica: "Folha atual em SVG (mm)", grupo: 1 },
      { id: "dxf", rotulo: "Exportar DXF", icone: "dxf", dica: "Folha em DXF (mm), camadas por tipo de linha", grupo: 1 },
    ],
  },
];
let abaAtiva = "vistas";

function renderizarAbas() {
  const abas = $("abas");
  abas.innerHTML = "";
  for (const a of ABAS_D) {
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
  const aba = ABAS_D.find((a) => a.id === abaAtiva)!;
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
    const ativo = (c.id === "modelo" && comando?.tipo === "modelo" && !comando.tres) || (c.id === "tres" && comando?.tipo === "modelo" && comando.tres)
      || (c.id === "projetada" && comando?.tipo === "projetada") || (c.id === "nota" && comando?.tipo === "nota")
      || (c.id === "cota" && comando?.tipo === "cota")
      || (c.id === "secao" && comando?.tipo === "secao") || (c.id === "detalhe" && comando?.tipo === "detalhe") || (c.id === "planificada" && comando?.tipo === "planificada")
      || (c.id === "props-folha" && comando?.tipo === "folha") || (c.id === "legenda" && comando?.tipo === "legenda");
    b.setAttribute("aria-pressed", String(ativo));
    b.onclick = () => executar(c);
    faixa.append(b);
  }
}

function executar(c: Cmd) {
  if (c.emBreve) return avisar(`${c.rotulo}: em breve (roteiro do desenho, docs/funcional/desenho.md).`);
  if (!doc) return;
  esconderBarra();
  switch (c.id) {
    case "modelo": return abrirVistaModelo(false);
    case "tres": return abrirVistaModelo(true);
    case "projetada": return abrirProjetada(selVistas.length === 1 ? selVistas[0] : null);
    case "secao": return abrirSecaoDetalhe("secao");
    case "detalhe": return abrirSecaoDetalhe("detalhe");
    case "planificada": return abrirPlanificada();
    case "explodida": return alternarExplodida();
    case "nota": return abrirNota(null);
    case "marcas": return alternarMarcas();
    case "props-folha": return abrirPropsFolha(false);
    case "legenda": return abrirLegenda();
    case "nova-folha": return adicionarFolha();
    case "pdf": return imprimir();
    case "svg": return exportarSvg();
    case "dxf": return void exportarDxfFolha();
    case "cota": return abrirCota();
    case "balao": return void baloesAutomaticos();
    case "lista": return inserirLista();
  }
}

function alternarMarcas() {
  const f = folha();
  if (!f?.vistas.length) return avisar("A folha ainda não tem vistas.");
  const alvo = selVistas.length ? f.vistas.filter((v) => selVistas.includes(v.id)) : f.vistas;
  const ligar = alvo.some((v) => v.marcasCentro === false);
  for (const v of alvo) v.marcasCentro = ligar;
  alterou();
  avisar(`Marcas de centro ${ligar ? "ligadas" : "desligadas"} em ${alvo.length} vista(s).`);
}

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
  mostrarPainel(false);
  renderizarAbas();
  tudo();
}

function confirmarComando() {
  if (!comando) return;
  const c = comando;
  if (c.tipo === "modelo" && c.tres) return void colocarTresVistas();
  if (c.tipo === "modelo" && c.modelo) return avisar("Toque na folha onde a vista deve ficar (ou ✕).");
  if (c.tipo === "nota" && c.editando) {
    fecharComando();
    return alterou();
  }
  fecharComando();
  if (c.tipo === "vista" || c.tipo === "folha" || c.tipo === "legenda" || c.tipo === "editarCota") alterou();
}

function cancelarComando() {
  if (!comando) return;
  const c = comando;
  if (c.tipo === "vista" || c.tipo === "folha" || c.tipo === "legenda" || c.tipo === "nota" || c.tipo === "editarCota") {
    doc = validarDesenho(JSON.parse(c.snapshot));
    if (!doc.folhas.some((f) => f.id === folhaId)) folhaId = doc.folhas[0].id;
  }
  fecharComando();
}

function painelBase(titulo: string): HTMLElement {
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
  switch (comando.tipo) {
    case "modelo": return void renderizarVistaModelo();
    case "projetada": return renderizarProjetada();
    case "nota": return renderizarNota();
    case "vista": return renderizarPropsVista();
    case "folha": return renderizarPropsFolha();
    case "legenda": return renderizarLegenda();
    case "secao": case "detalhe": return renderizarSecaoDetalhe();
    case "planificada": return renderizarPlanificada();
    case "cota": return renderizarCota();
    case "editarCota": return renderizarEditarCota();
  }
}

$("cc-ok").onclick = confirmarComando;
$("cc-cancelar").onclick = cancelarComando;

/** Lista de escalas para os selects (folha e vista). */
function opcoesEscala(atual: number | undefined, comFolha: boolean): string {
  const lista = [...ESCALAS];
  if (atual !== undefined && !lista.some((e) => Math.abs(e - atual) < 1e-9)) lista.push(atual);
  lista.sort((a, b) => b - a);
  return (comFolha ? `<option value="folha"${atual === undefined ? " selected" : ""}>Usar a escala da folha</option>` : "")
    + lista.map((e) => `<option value="${e}"${atual !== undefined && Math.abs(e - atual) < 1e-9 ? " selected" : ""}>${rotuloEscala(e)}</option>`).join("")
    + `<option value="outra">Outra…</option>`;
}
function lerSelectEscala(sel: HTMLSelectElement, atual: number | undefined): number | undefined | null {
  if (sel.value === "folha") return undefined;
  if (sel.value === "outra") {
    const t = prompt("Escala (ex.: 1:2,5 ou 3:1)", atual ? rotuloEscala(atual) : "1:1");
    const e = t ? lerEscala(t) : null;
    if (!e) {
      avisar("Escala inválida.");
      return null;
    }
    return e;
  }
  return Number(sel.value);
}

// ---------- Vista do modelo / Três vistas padrão ----------

function abrirVistaModelo(tres: boolean) {
  if (comando) cancelarComando();
  const f = folha()!;
  // modelo já usado na folha (ou no desenho) vem escolhido: o mais comum é detalhar o mesmo
  const pre = f.vistas[f.vistas.length - 1]?.modelo ?? doc!.modelos[0]?.id ?? null;
  comando = { tipo: "modelo", tres, modelo: pre, orientacoes: ["frontal"], multiplas: false, estilo: "ocultas", iso: false };
  mostrarPainel(true);
  renderizarAbas();
  atualizarStatus();
  void renderizarVistaModelo();
}

async function renderizarVistaModelo() {
  if (comando?.tipo !== "modelo") return;
  const c = comando;
  const p = painelBase(c.tres ? "Três vistas padrão" : "Vista do modelo");
  if (c.tres) {
    // opções antes do modelo: escolhido o modelo, as vistas já são colocadas
    const op = caixa(p, "Opções");
    op.innerHTML = `<label class="interruptor"><input type="checkbox" data-iso ${c.iso ? "checked" : ""}/><span>Isométrica no canto livre</span></label>
      ${(Object.keys(NOME_ESTILO) as EstiloVista[]).map((k) => `<label class="opcao"><input type="radio" name="estilo" value="${k}" ${c.estilo === k ? "checked" : ""}/> ${NOME_ESTILO[k]}</label>`).join("")}
      <p class="dica">${folha()!.diedro === 1 ? "1º diedro (ABNT): superior abaixo da frontal, lateral esquerda à direita." : "3º diedro: superior acima da frontal, lateral direita à direita."} Com a folha vazia, a escala da folha se ajusta para caber.</p>`;
    op.querySelector<HTMLInputElement>("[data-iso]")!.onchange = (e) => (c.iso = (e.target as HTMLInputElement).checked);
    op.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((i) => (i.onchange = () => (c.estilo = i.value as EstiloVista)));
  }
  const corpo = caixa(p, "Peça/Montagem a detalhar");
  if (c.modelo && modeloDe(c.modelo)) {
    const m = modeloDe(c.modelo)!;
    corpo.innerHTML = `<div class="pc-escolhido">${ICONES[m.tipo === "peca" ? "peca" : "montagem"]}<span><strong></strong><small>${m.tipo === "peca" ? "Peça" : "Montagem"}${m.arquivo ? " · cofre" : ""}</small></span><button class="largo" data-b="trocar">Trocar</button></div>`;
    corpo.querySelector("strong")!.textContent = m.nome;
    corpo.querySelector<HTMLButtonElement>('[data-b="trocar"]')!.onclick = () => {
      c.modelo = null;
      atualizarStatus();
      void renderizarVistaModelo();
    };
  } else {
    corpo.innerHTML = `<input class="campo-busca" type="search" placeholder="Pesquisar no cofre…" aria-label="Pesquisar no cofre" />
      <div class="pc-arquivos" data-lista><p class="dica">Lendo o cofre…</p></div>
      <div class="pc-botoes" data-abertos></div>
      <div class="pc-botoes"><button data-b="aparelho" class="largo">Procurar no aparelho…</button></div>`;
    const abertos = corpo.querySelector<HTMLElement>("[data-abertos]")!;
    for (const m of doc!.modelos) {
      const b = document.createElement("button");
      b.className = "largo";
      b.textContent = `Já no desenho: ${m.nome}`;
      b.onclick = () => escolherModelo(m.id);
      abertos.append(b);
    }
    const pecaAberta = lerJson<Documento>("jlscad:documento", (d) => validarDocumento(d));
    if (pecaAberta?.features.length) {
      const b = document.createElement("button");
      b.className = "largo";
      b.textContent = `Peça aberta no WJCAD: ${pecaAberta.nome}`;
      b.onclick = () => void adicionarModelo("peca", pecaAberta, { arquivo: vinculo("cad") ?? undefined, nome: pecaAberta.nome });
      abertos.append(b);
    }
    const asmAberta = lerJson<DocumentoMontagem>("wjcad:montagem", (d) => validarMontagem(d));
    if (asmAberta?.componentes.length) {
      const b = document.createElement("button");
      b.className = "largo";
      b.textContent = `Montagem aberta: ${asmAberta.nome}`;
      b.onclick = () => void adicionarModelo("montagem", asmAberta, { arquivo: vinculo("asm") ?? undefined, nome: asmAberta.nome });
      abertos.append(b);
    }
    corpo.querySelector<HTMLButtonElement>('[data-b="aparelho"]')!.onclick = () => {
      escolhendoArquivoModelo = true;
      const inp = $<HTMLInputElement>("arquivo");
      inp.accept = ".wjcad,.jlscad,.cadt,.wjasm";
      inp.click();
    };
    const lista = corpo.querySelector<HTMLElement>("[data-lista]")!;
    const busca = corpo.querySelector<HTMLInputElement>(".campo-busca")!;
    let docs: Awaited<ReturnType<typeof documentosDoCofre>> = [];
    try {
      docs = await documentosDoCofre(["wjcad", "jlscad", "wjasm"]);
    } catch {
      docs = [];
    }
    if (comando !== c) return;
    const desenhar = () => {
      const q = busca.value.trim().toLowerCase();
      const vis = docs.filter((d) => !q || d.arquivo.nome.toLowerCase().includes(q) || (d.arquivo.cartao.codigo ?? "").toLowerCase().includes(q) || (d.arquivo.cartao.descricao ?? "").toLowerCase().includes(q));
      lista.innerHTML = vis.length ? "" : `<p class="dica">${docs.length ? "Nada encontrado." : "Nenhuma peça ou montagem no cofre ainda: salve no WJCAD (💾) ou procure no aparelho."}</p>`;
      for (const d of vis.slice(0, 60)) {
        const asm = d.arquivo.nome.toLowerCase().endsWith(".wjasm");
        const b = document.createElement("button");
        b.className = "pc-arquivo";
        b.innerHTML = `${ICONES[asm ? "montagem" : "peca"]}<span><strong></strong><small></small></span>`;
        b.querySelector("strong")!.textContent = d.arquivo.nome.replace(/\.(wjcad|jlscad|wjasm)$/i, "");
        b.querySelector("small")!.textContent = `${d.caminho}${d.arquivo.cartao.codigo ? ` · ${d.arquivo.cartao.codigo}` : ""}${d.arquivo.revisao ? ` · rev. ${d.arquivo.revisao}` : ""}`;
        b.onclick = () => void adicionarDoCofre(d.arquivo.id);
        lista.append(b);
      }
    };
    busca.oninput = desenhar;
    desenhar();
  }
  if (!c.tres) {
    const ori = caixa(p, "Orientação");
    ori.innerHTML = `<div class="pc-grade-tipos">${(Object.keys(CAMERAS) as Orientacao[]).map((o) => `<button class="pc-tipo" data-o="${o}" aria-pressed="${c.orientacoes.includes(o)}"><span>${NOME_ORIENTACAO[o]}</span></button>`).join("")}</div>
      <label class="interruptor"><input type="checkbox" data-mult ${c.multiplas ? "checked" : ""}/><span>Vistas múltiplas</span></label>`;
    ori.querySelectorAll<HTMLButtonElement>("[data-o]").forEach((b) => (b.onclick = () => {
      const o = b.dataset.o as Orientacao;
      if (c.multiplas) c.orientacoes = c.orientacoes.includes(o) ? c.orientacoes.filter((x) => x !== o) : [...c.orientacoes, o];
      else c.orientacoes = [o];
      if (!c.orientacoes.length) c.orientacoes = [o];
      void renderizarVistaModelo();
    }));
    ori.querySelector<HTMLInputElement>("[data-mult]")!.onchange = (e) => {
      c.multiplas = (e.target as HTMLInputElement).checked;
      if (!c.multiplas) c.orientacoes = c.orientacoes.slice(0, 1);
    };
    const est = caixa(p, "Estilo de exibição");
    est.innerHTML = (Object.keys(NOME_ESTILO) as EstiloVista[]).map((k) => `<label class="opcao"><input type="radio" name="estilo" value="${k}" ${c.estilo === k ? "checked" : ""}/> ${NOME_ESTILO[k]}</label>`).join("");
    est.querySelectorAll<HTMLInputElement>("input").forEach((i) => (i.onchange = () => (c.estilo = i.value as EstiloVista)));
    const esc = caixa(p, "Escala");
    esc.innerHTML = `<select data-esc>${opcoesEscala(c.escala, true)}</select>`;
    const sel = esc.querySelector<HTMLSelectElement>("select")!;
    sel.onchange = () => {
      const e = lerSelectEscala(sel, c.escala);
      if (e !== null) c.escala = e;
      void renderizarVistaModelo();
    };
  }
  if (c.modelo) p.append(Object.assign(document.createElement("p"), { className: "dica", textContent: c.tres ? "✓ coloca as três vistas na folha." : "Toque na folha onde a vista deve ficar. Depois, toque ao lado dela para as vistas projetadas." }));
}

function lerJson<T>(chave: string, validar: (d: unknown) => T): T | null {
  try {
    const t = localStorage.getItem(chave);
    return t ? validar(JSON.parse(t)) : null;
  } catch {
    return null;
  }
}

let escolhendoArquivoModelo = false;

function escolherModelo(id: string) {
  if (comando?.tipo !== "modelo") return;
  comando.modelo = id;
  atualizarStatus();
  void renderizarVistaModelo();
  if (comando.tres) void colocarTresVistas();
}

/** Embute o modelo no desenho (ou reaproveita o mesmo arquivo já embutido). */
function adicionarModelo(tipo: "peca" | "montagem", d: Documento | DocumentoMontagem, origem: { arquivo?: string; versao?: number; nome?: string }): string {
  const marca = marcaDe(JSON.stringify(d));
  const igual = doc!.modelos.find((m) => (origem.arquivo && m.arquivo === origem.arquivo) || (!origem.arquivo && !m.arquivo && m.marca === marca));
  const nome = (origem.nome ?? d.nome).replace(/\.(wjcad|jlscad|cadt|wjasm)$/i, "");
  if (igual) Object.assign(igual, { doc: d, marca, versao: origem.versao, nome });
  const m: ModeloDesenho = igual ?? { id: novoIdD(), nome, tipo, ...(origem.arquivo ? { arquivo: origem.arquivo } : {}), ...(origem.versao ? { versao: origem.versao } : {}), marca, doc: d };
  if (!igual) doc!.modelos.push(m);
  if (m.arquivo) void lerCartao(m);
  salvarAutosave();
  escolherModelo(m.id);
  return m.id;
}

async function adicionarDoCofre(id: string) {
  const r = await lerDoCofre(id);
  if (!r) return avisar("Não foi possível ler o arquivo no cofre.");
  try {
    const asm = r.arquivo.nome.toLowerCase().endsWith(".wjasm");
    const d = asm ? validarMontagem(JSON.parse(r.texto)) : validarDocumento(JSON.parse(r.texto));
    cartoes.set(id, r.arquivo.cartao);
    adicionarModelo(asm ? "montagem" : "peca", d, { arquivo: id, versao: r.versao, nome: r.arquivo.nome });
  } catch (e) {
    avisar((e as Error).message);
  }
}

async function lerCartao(m: ModeloDesenho) {
  if (!m.arquivo) return;
  const r = await lerDoCofre(m.arquivo).catch(() => null);
  if (r) {
    cartoes.set(m.id, r.arquivo.cartao);
    desenharFolha();
  }
}

/** Toque na folha com a Vista do modelo: calcula e centra cada orientação escolhida no ponto. */
async function colocarVistaModelo(p: { x: number; y: number }) {
  if (comando?.tipo !== "modelo" || !comando.modelo) return;
  const c = comando;
  const f = folha()!;
  const m = modeloDe(c.modelo!)!;
  const s = c.escala ?? f.escala;
  atualizarStatus("Calculando a vista…");
  let x = p.x;
  let ultima: VistaDesenho | null = null;
  for (const o of c.orientacoes) {
    let proj: Projecao;
    try {
      proj = await projecaoDe(m, CAMERAS[o], s);
    } catch (e) {
      atualizarStatus();
      return avisar(`Não foi possível projetar: ${(e as Error).message}`);
    }
    const b = proj.caixa;
    const v: VistaDesenho = {
      id: novoIdD(), nome: proximoNomeVista(f), modelo: m.id, camera: CAMERAS[o], estilo: c.estilo,
      x: x - ((b.x0 + b.x1) / 2) * s, y: p.y - ((b.y0 + b.y1) / 2) * s, ...(c.escala !== undefined ? { escala: c.escala } : {}),
      ...(o === "iso" ? { estilo: c.estilo === "ocultas" ? "sem-ocultas" as const : c.estilo } : {}),
    };
    f.vistas.push(v);
    ultima = v;
    x += (b.x1 - b.x0) * s + 20;
  }
  selVistas = ultima ? [ultima.id] : [];
  registrarPasso();
  salvarAutosave();
  // como no CAD de referência: colocada uma vista, segue a vista projetada a partir dela
  if (ultima && c.orientacoes.length === 1) {
    comando = { tipo: "projetada", mae: ultima.id, criadas: 0 };
    renderizarComando();
    renderizarAbas();
  }
  tudo();
}

async function colocarTresVistas() {
  if (comando?.tipo !== "modelo" || !comando.modelo) return avisar("Escolha a peça ou montagem.");
  const c = comando;
  const f = folha()!;
  const m = modeloDe(c.modelo!)!;
  const vazia = !f.vistas.length;
  const lado = cameraProjetada(CAMERAS.frontal, "direita", f.diedro);
  const cima = cameraProjetada(CAMERAS.frontal, f.diedro === 1 ? "abaixo" : "acima", f.diedro);
  atualizarStatus("Calculando as três vistas…");
  try {
    // primeiro à escala 1 para medir; depois na escala escolhida (tolerância das curvas)
    const [F1, S1, L1] = await Promise.all([projecaoDe(m, CAMERAS.frontal, 1), projecaoDe(m, cima, 1), projecaoDe(m, lado, 1)]);
    const area = areaUtil(f.formato);
    const L = layoutTresVistas({ frontal: F1.caixa, superior: S1.caixa, lateral: L1.caixa }, area, f.diedro, 20, vazia ? undefined : f.escala);
    if (vazia) f.escala = L.escala;
    if (comando !== c) return;
    const nova = (nome: string, cam: Camera, xy: [number, number], mae?: string, lado?: VistaDesenho["lado"]): VistaDesenho =>
      ({ id: novoIdD(), nome, modelo: m.id, camera: cam, x: xy[0], y: xy[1], estilo: c.estilo, ...(mae ? { mae, lado } : {}) });
    const vF = nova(proximoNomeVista(f, "Frontal "), CAMERAS.frontal, L.frontal);
    f.vistas.push(vF);
    const vS = nova(proximoNomeVista(f, "Superior "), cima, L.superior, vF.id, f.diedro === 1 ? "abaixo" : "acima");
    f.vistas.push(vS);
    const vL = nova(proximoNomeVista(f, "Lateral "), lado, L.lateral, vF.id, "direita");
    f.vistas.push(vL);
    if (c.iso) {
      // isométrica no quadrante livre (1º diedro: embaixo à direita; 3º: em cima à direita), na
      // maior escala normalizada que cabe ali, sem passar da escala da folha
      const I1 = await projecaoDe(m, CAMERAS.iso, 1);
      const cF = caixaNaFolha(vF, f.escala, F1.caixa), cL = caixaNaFolha(vL, f.escala, L1.caixa);
      const q = f.diedro === 1 ? { x0: cL.x0, x1: area.x1, y0: area.y0, y1: cF.y0 - 20 } : { x0: cL.x0, x1: area.x1, y0: cF.y1 + 20, y1: area.y1 };
      const ei = escalaQueCabe(I1.caixa, q.x1 - q.x0 - 10, q.y1 - q.y0 - 10, f.escala);
      const b = I1.caixa;
      const cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2;
      f.vistas.push({
        id: novoIdD(), nome: proximoNomeVista(f, "Isométrica "), modelo: m.id, camera: CAMERAS.iso, estilo: "sem-ocultas",
        x: cx - ((b.x0 + b.x1) / 2) * ei, y: cy - ((b.y0 + b.y1) / 2) * ei, ...(ei !== f.escala ? { escala: ei } : {}),
      });
    }
    selVistas = [];
    fecharComando();
    alterou();
    avisar(`Três vistas na escala ${rotuloEscala(f.escala)}${vazia ? " (escala da folha ajustada)" : ""}.`);
  } catch (e) {
    atualizarStatus();
    avisar(`Não foi possível projetar: ${(e as Error).message}`);
  }
}

// ---------- Vista projetada ----------

function abrirProjetada(mae: string | null) {
  if (comando) cancelarComando();
  if (!folha()?.vistas.length) return avisar("Coloque primeiro uma vista do modelo.");
  comando = { tipo: "projetada", mae, criadas: 0 };
  if (mae) selVistas = [mae];
  mostrarPainel(true);
  renderizarComando();
  renderizarAbas();
  tudo();
}

function renderizarProjetada() {
  if (comando?.tipo !== "projetada") return;
  const c = comando;
  const p = painelBase("Vista projetada");
  const corpo = caixa(p, "Vista mãe");
  const mae = vistaDe(c.mae);
  corpo.innerHTML = mae
    ? `<p><strong></strong><br><small>${nomeCamera(mae.camera)} · ${rotuloEscala(escalaDaVista(folha()!, mae))}</small></p><p class="dica">Toque à direita, à esquerda, acima ou abaixo da vista mãe para a vista alinhada (${folha()!.diedro}º diedro); na diagonal sai a isométrica. ✓ termina.</p>`
    : `<p class="dica">Toque a vista de onde a nova vista será projetada.</p>`;
  if (mae) corpo.querySelector("strong")!.textContent = mae.nome;
}

async function colocarProjetada(p: { x: number; y: number }) {
  if (comando?.tipo !== "projetada") return;
  const c = comando;
  const f = folha()!;
  const mae = vistaDe(c.mae);
  if (!mae) return;
  const m = modeloDe(mae.modelo)!;
  const cm = caixaDaVista(f, mae);
  if (!cm) return avisar("A vista mãe ainda está sendo calculada.");
  const lado = ladoDoPonto(cm, p.x, p.y);
  const cx = (cm.x0 + cm.x1) / 2, cy = (cm.y0 + cm.y1) / 2;
  const cam = cameraProjetada(mae.camera, lado, f.diedro, { dx: p.x - cx, dy: p.y - cy });
  const s = escalaDaVista(f, mae);
  atualizarStatus("Calculando a vista…");
  let proj: Projecao;
  try {
    proj = await projecaoDe(m, cam, s);
  } catch (e) {
    atualizarStatus();
    return avisar(`Não foi possível projetar: ${(e as Error).message}`);
  }
  if (comando !== c) return;
  const b = proj.caixa;
  // alinhada à mãe no eixo comum; no outro eixo, centrada no toque (como se coloca no CAD de referência)
  const centradoX = p.x - ((b.x0 + b.x1) / 2) * s, centradoY = p.y - ((b.y0 + b.y1) / 2) * s;
  const iso = lado === "diagonal";
  const v: VistaDesenho = {
    id: novoIdD(), nome: proximoNomeVista(f), modelo: m.id, camera: cam, estilo: iso ? "sem-ocultas" : mae.estilo,
    x: lado === "acima" || lado === "abaixo" ? mae.x : centradoX,
    y: lado === "direita" || lado === "esquerda" ? mae.y : centradoY,
    ...(mae.escala !== undefined ? { escala: mae.escala } : {}),
    ...(iso ? {} : { mae: mae.id, lado }),
  };
  // tocou perto demais: a vista nova não encosta na mãe
  const [ax, ay] = afastarDaMae(cm, caixaNaFolha(v, s, b), lado);
  v.x += ax;
  v.y += ay;
  f.vistas.push(v);
  c.criadas++;
  registrarPasso();
  salvarAutosave();
  tudo();
  avisar(`${v.nome}: ${nomeCamera(cam)}${iso ? "" : ` (${lado} da ${mae.nome})`}.`);
}

// ---------- Vista de seção e de detalhe ----------

function abrirSecaoDetalhe(tipo: "secao" | "detalhe") {
  if (comando) cancelarComando();
  const f = folha();
  if (!f?.vistas.length) return avisar("Coloque primeiro uma vista do modelo.");
  const mae = selVistas.length === 1 && !vistaDe(selVistas[0])?.detalhe ? selVistas[0] : null;
  comando = tipo === "secao" ? { tipo, mae, orient: "horizontal", ponto: null } : { tipo, mae, centro: null, r: null, fator: 2 };
  mostrarPainel(true);
  renderizarComando();
  renderizarAbas();
  tudo();
}

/** Plano da vista mãe (mm do modelo) do ponto tocado na folha. */
function noPlanoDa(f: Folha, v: VistaDesenho, p: { x: number; y: number }): [number, number] {
  const s = escalaDaVista(f, v);
  return [(p.x - v.x) / s, (p.y - v.y) / s];
}

async function tocarSecaoDetalhe(alvo: Element, p: { x: number; y: number }) {
  const c = comando;
  if (c?.tipo !== "secao" && c?.tipo !== "detalhe") return;
  const f = folha()!;
  const id = alvo.closest("[data-vista]")?.getAttribute("data-vista");
  if (!c.mae) {
    if (!id) return avisar("Toque uma vista.");
    const v = vistaDe(id)!;
    if (v.detalhe) return avisar("Escolha a vista original (não um detalhe).");
    if (orientacaoDe(v.camera) === "iso" && c.tipo === "secao") return avisar("A seção parte de uma vista ortogonal (frontal, superior, lateral…).");
    c.mae = id;
    selVistas = [id];
    // o primeiro toque só escolhe a vista; os próximos marcam o corte/círculo
    renderizarComando();
    atualizarStatus();
    return tudo();
  }
  const mae = vistaDe(c.mae)!;
  const q = noPlanoDa(f, mae, p);
  if (c.tipo === "secao") {
    if (!c.ponto) {
      if (id !== c.mae) {
        if (!id) return avisar("Toque por onde o corte passa, em cima da vista.");
        c.mae = id;
        selVistas = [id];
        return tudo(), renderizarComando();
      }
      c.ponto = q;
    } else return void colocarSecao(p);
  } else {
    if (!c.centro) {
      if (id !== c.mae) {
        // tocou outra vista: ela vira a mãe (o próximo toque marca o centro)
        if (!id || vistaDe(id)?.detalhe) return avisar("Toque o centro da região em cima da vista.");
        c.mae = id;
        selVistas = [id];
        renderizarComando();
        return tudo();
      }
      c.centro = q;
    } else if (c.r === null) {
      c.r = Math.max(1 / escalaDaVista(f, mae), Math.hypot(q[0] - c.centro[0], q[1] - c.centro[1]));
    } else return void colocarDetalhe(p);
  }
  renderizarComando();
  atualizarStatus();
  desenharFolha();
  desenharPreviaSecaoDetalhe();
}

/** Linha de corte ou círculo provisório na vista mãe enquanto o comando está aberto. */
function desenharPreviaSecaoDetalhe() {
  const c = comando;
  if (c?.tipo !== "secao" && c?.tipo !== "detalhe") return;
  const f = folha()!;
  const mae = vistaDe(c.mae);
  if (!mae) return;
  const s = escalaDaVista(f, mae);
  const A = FORMATOS[f.formato].a;
  const X = (x: number) => n3(mae.x + x * s), Y = (y: number) => n3(A - (mae.y + y * s));
  let d = "";
  if (c.tipo === "secao" && c.ponto) {
    const cx = caixaDaVista(f, mae);
    if (!cx) return;
    d = c.orient === "horizontal" ? `<path class="previa-corte" d="M${n3(cx.x0 - 6)} ${Y(c.ponto[1])}H${n3(cx.x1 + 6)}" />` : `<path class="previa-corte" d="M${X(c.ponto[0])} ${n3(A - cx.y1 - 6)}V${n3(A - cx.y0 + 6)}" />`;
  } else if (c.tipo === "detalhe" && c.centro) {
    d = `<circle class="previa-corte" cx="${X(c.centro[0])}" cy="${Y(c.centro[1])}" r="${n3((c.r ?? 0.5 / s) * s)}" />`;
  }
  svg.insertAdjacentHTML("beforeend", d);
}

async function colocarSecao(p: { x: number; y: number }) {
  if (comando?.tipo !== "secao" || !comando.mae || !comando.ponto) return;
  const c = comando;
  const f = folha()!;
  const mae = vistaDe(c.mae)!;
  const m = modeloDe(mae.modelo)!;
  const cm = caixaDaVista(f, mae);
  if (!cm) return avisar("A vista mãe ainda está sendo calculada.");
  // a seção fica do lado tocado, na direção perpendicular à linha de corte
  const cy = (cm.y0 + cm.y1) / 2, cx = (cm.x0 + cm.x1) / 2;
  const lado = c.orient === "horizontal" ? (p.y >= cy ? "acima" : "abaixo") : (p.x >= cx ? "direita" : "esquerda");
  const cam = cameraProjetada(mae.camera, lado, f.diedro);
  const s = escalaDaVista(f, mae);
  const pt = c.ponto!;
  const ponto3 = pontoNaVista(mae.camera, pt[0], pt[1]);
  const letra = proximaLetra(doc!);
  atualizarStatus("Calculando a seção…");
  let proj: Projecao;
  try {
    proj = await projecaoDe(m, cam, s, { corte: { p: ponto3, n: cam.olho } });
  } catch (e) {
    atualizarStatus();
    return avisar(`Não foi possível cortar: ${(e as Error).message}`);
  }
  if (comando !== c) return;
  const b = proj.caixa;
  const v: VistaDesenho = {
    id: novoIdD(), nome: `Seção ${letra}-${letra}`, modelo: m.id, camera: cam, estilo: "sem-ocultas",
    x: lado === "acima" || lado === "abaixo" ? mae.x : p.x - ((b.x0 + b.x1) / 2) * s,
    y: lado === "direita" || lado === "esquerda" ? mae.y : p.y - ((b.y0 + b.y1) / 2) * s,
    ...(mae.escala !== undefined ? { escala: mae.escala } : {}),
    ...(mae.explodida ? { explodida: true } : {}),
    mae: mae.id, lado, secao: { p: ponto3, letra, mae: mae.id },
  };
  const [ax, ay] = afastarDaMae(cm, caixaNaFolha(v, s, b), lado);
  v.x += ax;
  v.y += ay;
  f.vistas.push(v);
  selVistas = [v.id];
  fecharComando();
  alterou();
  avisar(`Seção ${letra}-${letra} criada.`);
}

async function colocarDetalhe(p: { x: number; y: number }) {
  if (comando?.tipo !== "detalhe" || !comando.mae || !comando.centro || comando.r === null) return;
  const c = comando;
  const f = folha()!;
  const mae = vistaDe(c.mae)!;
  const m = modeloDe(mae.modelo)!;
  const s = escalaDaVista(f, mae) * c.fator;
  const letra = proximaLetra(doc!);
  const ce = c.centro!;
  const v: VistaDesenho = {
    id: novoIdD(), nome: `Detalhe ${letra}`, modelo: m.id, camera: mae.camera, estilo: mae.estilo === "ocultas" ? "sem-ocultas" : mae.estilo,
    x: p.x - ce[0] * s, y: p.y - ce[1] * s, escala: s,
    ...(mae.secao ? { secao: { ...mae.secao, letra: mae.secao.letra } } : {}),
    ...(mae.explodida ? { explodida: true } : {}),
    detalhe: { mae: mae.id, cx: ce[0], cy: ce[1], r: c.r!, letra },
  };
  // detalhe de uma seção mostra o corte, mas a linha de corte é só da seção original
  if (v.secao) v.secao = { ...v.secao, mae: "" };
  f.vistas.push(v);
  selVistas = [v.id];
  fecharComando();
  alterou();
  avisar(`Detalhe ${letra} (escala ${rotuloEscala(s)}).`);
}

function renderizarSecaoDetalhe() {
  const c = comando;
  if (c?.tipo !== "secao" && c?.tipo !== "detalhe") return;
  const p = painelBase(c.tipo === "secao" ? "Vista de seção" : "Vista de detalhe");
  const mae = vistaDe(c.mae);
  const b = caixa(p, "Vista mãe");
  b.innerHTML = mae ? `<p><strong></strong></p>` : `<p class="dica">Toque a vista de onde sai ${c.tipo === "secao" ? "a seção" : "o detalhe"}.</p>`;
  if (mae) b.querySelector("strong")!.textContent = mae.nome;
  if (c.tipo === "secao") {
    const o = caixa(p, "Linha de corte");
    o.innerHTML = `<div class="pc-botoes"><button data-o="horizontal" aria-pressed="${c.orient === "horizontal"}">Horizontal</button><button data-o="vertical" aria-pressed="${c.orient === "vertical"}">Vertical</button></div>
      <p class="dica">${!c.ponto ? "Toque na vista por onde o corte passa." : "Toque onde a seção fica: do lado para onde se olha (setas)."} A hachura é a 45°; peças vizinhas da montagem com sentidos alternados.</p>`;
    o.querySelectorAll<HTMLButtonElement>("[data-o]").forEach((x) => (x.onclick = () => {
      c.orient = x.dataset.o as "horizontal" | "vertical";
      renderizarSecaoDetalhe();
      desenharFolha();
      desenharPreviaSecaoDetalhe();
    }));
  } else {
    const o = caixa(p, "Escala do detalhe");
    o.innerHTML = `<div class="pc-botoes">${[1.5, 2, 2.5, 4, 5].map((k) => `<button data-k="${k}" aria-pressed="${c.fator === k}">${fmt(k)}×</button>`).join("")}</div>
      <p class="dica">${!c.centro ? "Toque o centro da região na vista." : c.r === null ? "Toque a borda do círculo." : "Toque onde o detalhe fica."}</p>`;
    o.querySelectorAll<HTMLButtonElement>("[data-k]").forEach((x) => (x.onclick = () => {
      c.fator = Number(x.dataset.k);
      renderizarSecaoDetalhe();
    }));
  }
}

// ---------- Vista planificada (chapa) e explodida ----------

function modelosDeChapa(): ModeloDesenho[] {
  return (doc?.modelos ?? []).filter((m) => m.tipo === "peca" && (m.doc as Documento).features.some(ehBaseChapa));
}

function abrirPlanificada() {
  if (comando) cancelarComando();
  const chapas = modelosDeChapa();
  const daSel = vistaDe(selVistas[0] ?? null);
  const pre = daSel && chapas.some((m) => m.id === daSel.modelo) ? daSel.modelo : chapas.length === 1 ? chapas[0].id : null;
  comando = { tipo: "planificada", modelo: pre };
  mostrarPainel(true);
  renderizarComando();
  renderizarAbas();
  atualizarStatus();
}

function renderizarPlanificada() {
  if (comando?.tipo !== "planificada") return;
  const c = comando;
  const p = painelBase("Vista planificada");
  const b = caixa(p, "Peça de chapa metálica");
  const chapas = modelosDeChapa();
  b.innerHTML = chapas.length
    ? `<div class="pc-botoes">${chapas.map((m) => `<button data-m="${m.id}" aria-pressed="${c.modelo === m.id}"></button>`).join("")}</div><p class="dica">Toque na folha onde a vista fica. As linhas de dobra saem em traço-ponto.</p>`
    : `<p class="dica">Nenhuma peça de chapa metálica no desenho. Coloque antes uma vista da peça de chapa (Vista do modelo).</p>`;
  b.querySelectorAll<HTMLButtonElement>("[data-m]").forEach((x) => {
    x.textContent = modeloDe(x.dataset.m!)!.nome;
    x.onclick = () => {
      c.modelo = x.dataset.m!;
      renderizarPlanificada();
      atualizarStatus();
    };
  });
}

async function colocarPlanificada(p: { x: number; y: number }) {
  if (comando?.tipo !== "planificada") return;
  const c = comando;
  if (!c.modelo) return avisar("Escolha a peça de chapa no painel.");
  const f = folha()!;
  const m = modeloDe(c.modelo)!;
  atualizarStatus("Planificando…");
  try {
    const itens = itensDoModelo(m, { planificada: true });
    await garantirSolidos(itens);
    const pl = planificados.get(itens[0].chave);
    if (!pl?.plano) throw new Error("A peça não tem chapa metálica para planificar.");
    const cam = { olho: pl.plano.olho, direita: pl.plano.direita };
    const s = f.escala;
    const proj = await projecaoDe(m, cam, s, { planificada: true });
    if (comando !== c) return;
    const b = proj.caixa;
    const v: VistaDesenho = { id: novoIdD(), nome: proximoNomeVista(f, "Planificado "), modelo: m.id, camera: cam, estilo: "sem-ocultas", planificada: true, rotulo: true, x: p.x - ((b.x0 + b.x1) / 2) * s, y: p.y - ((b.y0 + b.y1) / 2) * s };
    f.vistas.push(v);
    selVistas = [v.id];
    fecharComando();
    alterou();
  } catch (e) {
    atualizarStatus();
    avisar(`Não foi possível planificar: ${(e as Error).message}`);
  }
}

function alternarExplodida() {
  const f = folha();
  const alvo = (f?.vistas ?? []).filter((v) => (selVistas.length ? selVistas.includes(v.id) : true) && modeloDe(v.modelo)?.tipo === "montagem");
  if (!alvo.length) return avisar("Selecione uma vista de montagem (a montagem precisa de passos de vista explodida).");
  const semPassos = alvo.filter((v) => !((modeloDe(v.modelo)!.doc as DocumentoMontagem).explosao?.length));
  if (semPassos.length === alvo.length) return avisar("A montagem não tem vista explodida: crie os passos na Montagem (Vista explodida) e salve.");
  const ligar = alvo.some((v) => !v.explodida);
  for (const v of alvo) v.explodida = ligar || undefined;
  alterou();
  avisar(`${alvo.length} vista(s) ${ligar ? "explodida(s)" : "recolhida(s)"}.`);
}

// ---------- Cota inteligente ----------

function abrirCota() {
  if (comando) cancelarComando();
  if (!folha()?.vistas.length) return avisar("Coloque primeiro uma vista.");
  comando = { tipo: "cota", vista: null, e1: null, e2: null };
  mostrarPainel(true);
  renderizarComando();
  renderizarAbas();
  atualizarStatus();
}

function tocarCota(alvo: Element, p: { x: number; y: number }) {
  if (comando?.tipo !== "cota") return;
  const c = comando;
  const f = folha()!;
  const id = alvo.closest("[data-vista]")?.getAttribute("data-vista") ?? c.vista;
  const v = vistaDe(id);
  const pr = v && projDaVista(f, v);
  if (v && pr && (!c.vista || c.vista === v.id)) {
    const s = escalaDaVista(f, v);
    const q: [number, number] = [(p.x - v.x) / s, (p.y - v.y) / s];
    // tolerâncias em mm da folha (o dedo é largo): vértice 2,5 mm, linha/círculo 2 mm
    // tolerâncias na folha: o maior entre alguns mm e alguns pixels (o dedo é largo; zoom afastado)
    const px = pxPorMm();
    const dedo = matchMedia("(pointer: coarse)").matches;
    const tolV = Math.max(dedo ? 3 : 2, (dedo ? 14 : 8) / px) / s, tolL = Math.max(dedo ? 2.5 : 1.5, (dedo ? 12 : 6) / px) / s;
    const ent = entidadeSob(q, pr.visiveis, pr.circulos, tolV, tolL);
    if (ent && !(c.e1 && c.e1.tipo === "circulo")) {
      if (!c.e1) {
        c.vista = v.id;
        c.e1 = ent;
      } else if (!c.e2) c.e2 = ent;
      else c.e2 = ent;
      renderizarCota();
      atualizarStatus();
      return desenharFolha(), desenharPreviaCota();
    }
  }
  if (!c.e1 || !c.vista) return avisar("Toque uma aresta, vértice ou círculo de uma vista.");
  // toque no vazio (ou com círculo escolhido): coloca a cota com o número ali
  const vv = vistaDe(c.vista)!;
  const s = escalaDaVista(f, vv);
  const nova: Cota = { id: novoIdD(), vista: vv.id, e1: c.e1, ...(c.e2 ? { e2: c.e2 } : {}), pos: [(p.x - vv.x) / s, (p.y - vv.y) / s], modo: "auto" };
  if (!medida(nova)) {
    c.e1 = c.e2 = null;
    renderizarCota();
    return avisar("Essa combinação não dá cota: toque de novo.");
  }
  f.cotas.push(nova);
  c.e1 = c.e2 = null;
  c.vista = null;
  registrarPasso();
  salvarAutosave();
  renderizarCota();
  atualizarStatus();
  desenharFolha();
}

/** Entidades escolhidas destacadas na vista enquanto a cota não é colocada. */
function desenharPreviaCota() {
  if (comando?.tipo !== "cota" || !comando.vista) return;
  const f = folha()!;
  const v = vistaDe(comando.vista)!;
  const s = escalaDaVista(f, v), A = FORMATOS[f.formato].a;
  const X = (q: [number, number]) => n3(v.x + q[0] * s), Y = (q: [number, number]) => n3(A - (v.y + q[1] * s));
  const d = [comando.e1, comando.e2].filter((e): e is EntCota => !!e).map((e) => e.tipo === "ponto" ? `<circle class="previa-ent" cx="${X(e.p)}" cy="${Y(e.p)}" r="1.2" />`
    : e.tipo === "linha" ? `<path class="previa-ent" d="M${X(e.a)} ${Y(e.a)}L${X(e.b)} ${Y(e.b)}" />`
    : `<circle class="previa-ent" cx="${X(e.c)}" cy="${Y(e.c)}" r="${n3(e.r * s)}" />`).join("");
  svg.insertAdjacentHTML("beforeend", d);
}

function renderizarCota() {
  if (comando?.tipo !== "cota") return;
  const c = comando;
  const p = painelBase("Cota inteligente");
  const nome = (e: EntCota | null) => (!e ? "—" : e.tipo === "ponto" ? "Vértice" : e.tipo === "linha" ? "Aresta" : `Círculo Ø${fmt(2 * e.r)}`);
  const b = caixa(p, "Entidades");
  b.innerHTML = `<p>1ª: <strong>${nome(c.e1)}</strong></p><p>2ª: <strong>${nome(c.e2)}</strong></p>
    <p class="dica">Uma aresta: comprimento · duas paralelas: distância · duas em ângulo: ângulo · círculo: diâmetro · dois vértices: distância (horizontal, vertical ou alinhada conforme onde o número fica). O valor é o real do modelo, seja qual for a escala.</p>
    <button class="largo" data-b="limpar">Recomeçar</button>`;
  b.querySelector<HTMLButtonElement>('[data-b="limpar"]')!.onclick = () => {
    c.e1 = c.e2 = null;
    c.vista = null;
    renderizarCota();
    desenharFolha();
  };
}

function abrirEditarCota(id: string) {
  if (comando) cancelarComando();
  comando = { tipo: "editarCota", id, snapshot: JSON.stringify(doc) };
  mostrarPainel(true);
  renderizarComando();
}

function renderizarEditarCota() {
  if (comando?.tipo !== "editarCota") return;
  const c = folha()!.cotas.find((x) => x.id === (comando as { id: string }).id);
  if (!c) return fecharComando();
  const p = painelBase("Cota");
  const m = medida(c);
  const b = caixa(p, "Valor e texto");
  b.innerHTML = `<p>Valor medido: <strong>${m ? fmt(m.valor) : "—"}${m?.tipo === "angulo" ? "°" : " mm"}</strong></p>
    <label class="campo"><span>Texto antes (ex.: 4×)</span><input data-k="prefixo" /></label>
    <label class="campo"><span>Texto depois</span><input data-k="sufixo" /></label>
    <label class="campo"><span>Casas decimais</span><select data-k="casas">${[0, 1, 2, 3].map((n) => `<option value="${n}"${(c.casas ?? 2) === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="campo"><span>Tolerância ± (mm)</span><input data-k="tol" type="number" step="0.01" min="0" /></label>
    ${m?.tipo === "linear" ? `<label class="campo"><span>Direção</span><select data-k="modo">${[["auto", "Automática"], ["h", "Horizontal"], ["v", "Vertical"], ["alinhada", "Alinhada"]].map(([k, n]) => `<option value="${k}"${c.modo === k ? " selected" : ""}>${n}</option>`).join("")}</select></label>` : ""}`;
  b.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-k]").forEach((i) => {
    const k = i.dataset.k as "prefixo" | "sufixo" | "casas" | "tol" | "modo";
    if (i instanceof HTMLInputElement) i.value = String(c[k] ?? "");
    i.oninput = () => {
      const val = i.value;
      if (k === "casas") c.casas = Number(val);
      else if (k === "tol") c.tol = Number(val.replace(",", ".")) || undefined;
      else if (k === "modo") c.modo = val as Cota["modo"];
      else c[k] = val || undefined;
      desenharFolha();
    };
  });
}

// ---------- Balões e lista de materiais ----------

async function baloesAutomaticos() {
  const f = folha();
  if (!f) return;
  const v = vistaDe(selVistas[0] ?? null) ?? f.vistas.find((x) => modeloDe(x.modelo)?.tipo === "montagem");
  const m = v && modeloDe(v.modelo);
  if (!v || !m) return avisar("Selecione a vista da montagem.");
  if (m.tipo !== "montagem") return avisar("Balões automáticos: a vista precisa ser de uma montagem (peça única: item 1 na lista).");
  const a = m.doc as DocumentoMontagem;
  const itens = itensDoModelo(m, opcoesDa(v));
  await garantirSolidos(itens);
  const poses = v.explodida ? posesExplodidas(a) : null;
  // um balão por peça (primeira instância visível)
  const vistos = new Set<string>();
  const comps = a.componentes.filter((c) => !c.suprimido && !vistos.has(c.peca) && (vistos.add(c.peca), true));
  const s = escalaDaVista(f, v);
  const ancoras = comps.map((c) => {
    const p = a.pecas.find((x) => x.id === c.peca)!;
    const r = resultados.get(`${p.id}:${p.marca ?? marcaDe(JSON.stringify(p.doc.features.slice(0, p.doc.retrocesso ?? p.doc.features.length)))}`);
    const vs = r?.topologia?.vertices ?? [];
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const q of vs) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], q[i]); mx[i] = Math.max(mx[i], q[i]); }
    const centro: [number, number, number] = vs.length ? [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2] : [0, 0, 0];
    return naVista(v.camera, aplicarPonto(poses?.get(c.id) ?? c.t, centro));
  });
  const pr = projDaVista(f, v) ?? await projecaoDaVista(f, v, m);
  const b = pr.caixa;
  const pos = posicionarBaloes(ancoras.map(([x, y]) => [x * s, y * s] as [number, number]), { x0: b.x0 * s, y0: b.y0 * s, x1: b.x1 * s, y1: b.y1 * s });
  f.baloes = f.baloes.filter((x) => x.vista !== v.id);
  comps.forEach((c, i) => f.baloes.push({ id: novoIdD(), vista: v.id, comp: c.id, ancora: ancoras[i], pos: pos[i] }));
  if (!f.tabelas.length) f.tabelas.push({ id: novoIdD(), modelo: m.id });
  alterou();
  avisar(`${comps.length} balão(ões); a lista de materiais está sobre a legenda.`);
}

function inserirLista() {
  const f = folha();
  if (!f) return;
  const v = vistaDe(selVistas[0] ?? null) ?? f.vistas.find((x) => modeloDe(x.modelo)?.tipo === "montagem") ?? f.vistas[0];
  if (!v) return avisar("Coloque primeiro uma vista do modelo.");
  f.tabelas = [{ id: novoIdD(), modelo: v.modelo }];
  alterou();
}

// ---------- DXF da folha ----------

const CAMADAS_DXF = { FORMATO: 7, VISIVEL: 7, OCULTA: 8, CENTRO: 1, HACHURA: 9, COTA: 3, TEXTO: 2 };

async function exportarDxfFolha() {
  if (!doc) return;
  await esperarVistas();
  const f = folha()!;
  const F = FORMATOS[f.formato];
  const ents: EntDxf[] = [];
  const m = moldura(f.formato), r = retanguloLegenda(f.formato);
  const ret = (x0: number, y0: number, x1: number, y1: number, cam: string) => ents.push(...segmentos([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], cam));
  ret(0, 0, F.l, F.a, "FORMATO");
  ret(m.x0, m.y0, m.x1, m.y1, "FORMATO");
  ret(r.x0, r.y0, r.x1, r.y1, "FORMATO");
  const props = propriedades(f);
  ents.push({ tipo: "texto", camada: "TEXTO", p: [r.x0 + 2, r.y1 - 10], h: 5, s: props.titulo }, { tipo: "texto", camada: "TEXTO", p: [r.x0 + 2, r.y0 + 20], h: 3.5, s: `${props.codigo}  ESCALA ${props.escala}  FOLHA ${props.folha}` });
  for (const v of f.vistas) {
    const pr = projDaVista(f, v);
    if (!pr) continue;
    const s = escalaDaVista(f, v);
    const T = (q: [number, number]): [number, number] => [v.x + q[0] * s, v.y + q[1] * s];
    // detalhe: só o que cai dentro do círculo
    const dentro = (q: [number, number]) => !v.detalhe || Math.hypot(q[0] - v.detalhe.cx, q[1] - v.detalhe.cy) <= v.detalhe.r;
    const add = (ls: [number, number][][], cam: string) => {
      for (const l of ls) for (let i = 1; i < l.length; i++) if (dentro(l[i - 1]) && dentro(l[i])) ents.push({ tipo: "linha", camada: cam, a: T(l[i - 1]), b: T(l[i]) });
    };
    add(pr.visiveis, "VISIVEL");
    if (v.estilo !== "sem-ocultas") add(pr.ocultas, v.estilo === "arame" ? "VISIVEL" : "OCULTA");
    for (const rg of pr.cortes ?? []) for (const l of rg.lacos) add([[...l, l[0]]], "HACHURA");
    if (v.detalhe) ents.push({ tipo: "circulo", camada: "VISIVEL", c: T([v.detalhe.cx, v.detalhe.cy]), r: v.detalhe.r * s });
    if (v.marcasCentro !== false) for (const c of pr.circulos) if (dentro([c.cx, c.cy])) {
      const e = 2 / s;
      ents.push({ tipo: "linha", camada: "CENTRO", a: T([c.cx - c.r - e, c.cy]), b: T([c.cx + c.r + e, c.cy]) }, { tipo: "linha", camada: "CENTRO", a: T([c.cx, c.cy - c.r - e]), b: T([c.cx, c.cy + c.r + e]) });
    }
  }
  for (const c0 of f.cotas) {
    const v = vistaDe(c0.vista);
    const d = v && desenhoCota(cotaAtual(f, c0).c, escalaDaVista(f, v));
    if (!v || !d) continue;
    const T = (q: [number, number]): [number, number] => [v.x + q[0], v.y + q[1]];
    for (const [a, b] of d.linhas) ents.push({ tipo: "linha", camada: "COTA", a: T(a), b: T(b) });
    for (const a of d.arcos) ents.push({ tipo: "arco", camada: "COTA", c: T(a.c), r: a.r, a0: a.a0, a1: a.a1 });
    for (const st of d.setas) {
      const L = 3, w = 1;
      const base: [number, number] = [st.p[0] - st.d[0] * L, st.p[1] - st.d[1] * L];
      ents.push({ tipo: "linha", camada: "COTA", a: T(st.p), b: T([base[0] - st.d[1] * w, base[1] + st.d[0] * w]) }, { tipo: "linha", camada: "COTA", a: T(st.p), b: T([base[0] + st.d[1] * w, base[1] - st.d[0] * w]) });
    }
    ents.push({ tipo: "texto", camada: "COTA", p: T(d.texto.p), h: 3.5, s: d.texto.s, ang: d.texto.ang });
  }
  for (const n of f.notas) preencherPropriedades(n.texto, props).split("\n").forEach((l, i) => ents.push({ tipo: "texto", camada: "TEXTO", p: [n.x, n.y - i * n.altura * 1.5], h: n.altura, s: l }));
  for (const b of f.baloes) {
    const v = vistaDe(b.vista);
    if (!v) continue;
    const s = escalaDaVista(f, v);
    const c: [number, number] = [v.x + b.pos[0], v.y + b.pos[1]];
    ents.push({ tipo: "circulo", camada: "COTA", c, r: 5 }, { tipo: "linha", camada: "COTA", a: [v.x + b.ancora[0] * s, v.y + b.ancora[1] * s], b: c }, { tipo: "texto", camada: "COTA", p: [c[0] - 1.5, c[1] - 1.8], h: 5, s: String(itemDoBalao(b, v) ?? "?") });
  }
  baixar(new Blob([gerarDxf(ents, CAMADAS_DXF)], { type: "application/dxf" }), `${doc.nome} - ${f.nome}.dxf`);
}

// ---------- Propriedades da vista ----------

function abrirPropsVista(id: string) {
  if (comando) cancelarComando();
  selVistas = [id];
  comando = { tipo: "vista", id, snapshot: JSON.stringify(doc) };
  mostrarPainel(true);
  renderizarComando();
  tudo();
}

function renderizarPropsVista() {
  if (comando?.tipo !== "vista") return;
  const f = folha()!;
  const v = vistaDe(comando.id);
  if (!v) return fecharComando();
  const p = painelBase(`Vista: ${v.nome}`);
  const ger = caixa(p, "Vista");
  const ori = orientacaoDe(v.camera);
  ger.innerHTML = `<label class="campo"><span>Nome</span><input data-nome /></label>
    ${v.mae ? `<p class="dica">Projetada da ${escapar(vistaDe(v.mae)?.nome ?? "?")} (${v.lado}): ${nomeCamera(v.camera)}. Alinhada à mãe.</p>
      <button class="largo" data-b="soltar">Quebrar alinhamento</button>`
      : `<label class="campo"><span>Orientação</span><select data-ori>${(Object.keys(CAMERAS) as Orientacao[]).map((o) => `<option value="${o}"${o === ori ? " selected" : ""}>${NOME_ORIENTACAO[o]}</option>`).join("")}${ori ? "" : `<option selected value="">Projetada</option>`}</select></label>`}`;
  const nome = ger.querySelector<HTMLInputElement>("[data-nome]")!;
  nome.value = v.nome;
  nome.oninput = () => {
    v.nome = nome.value.trim() || v.nome;
    desenharFolha();
  };
  const sOri = ger.querySelector<HTMLSelectElement>("[data-ori]");
  if (sOri) sOri.onchange = () => {
    if (!sOri.value) return;
    v.camera = CAMERAS[sOri.value as Orientacao];
    // as projetadas dela ficariam erradas: viram independentes
    for (const k of f.vistas) if (k.mae === v.id) delete k.mae, delete k.lado;
    desenharFolha();
  };
  const bSoltar = ger.querySelector<HTMLButtonElement>('[data-b="soltar"]');
  if (bSoltar) bSoltar.onclick = () => {
    delete v.mae;
    delete v.lado;
    renderizarPropsVista();
  };
  const est = caixa(p, "Estilo de exibição");
  est.innerHTML = (Object.keys(NOME_ESTILO) as EstiloVista[]).map((k) => `<label class="opcao"><input type="radio" name="estilo-v" value="${k}" ${v.estilo === k ? "checked" : ""}/> ${NOME_ESTILO[k]}</label>`).join("")
    + `<label class="interruptor"><input type="checkbox" data-mc ${v.marcasCentro !== false ? "checked" : ""}/><span>Marcas de centro nos furos</span></label>`;
  est.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((i) => (i.onchange = () => {
    v.estilo = i.value as EstiloVista;
    desenharFolha();
  }));
  est.querySelector<HTMLInputElement>("[data-mc]")!.onchange = (e) => {
    v.marcasCentro = (e.target as HTMLInputElement).checked;
    desenharFolha();
  };
  if (modeloDe(v.modelo)?.tipo === "montagem") {
    const l = document.createElement("label");
    l.className = "interruptor";
    l.innerHTML = `<input type="checkbox" ${v.explodida ? "checked" : ""}/><span>Explodida (passos da montagem)</span>`;
    l.querySelector("input")!.onchange = (e) => {
      v.explodida = (e.target as HTMLInputElement).checked || undefined;
      desenharFolha();
    };
    est.append(l);
  }
  const esc = caixa(p, "Escala");
  esc.innerHTML = `<select data-esc>${opcoesEscala(v.escala, true)}</select>
    <label class="interruptor"><input type="checkbox" data-rot ${(v.rotulo ?? (v.escala !== undefined && v.escala !== f.escala)) ? "checked" : ""}/><span>Rótulo com nome e escala</span></label>`;
  const sel = esc.querySelector<HTMLSelectElement>("select")!;
  sel.onchange = () => {
    const e = lerSelectEscala(sel, v.escala);
    if (e === null) return renderizarPropsVista();
    // muda a escala em torno do centro da vista (a origem do modelo se afasta/aproxima)
    const c = caixaDaVista(f, v);
    const s0 = escalaDaVista(f, v);
    if (e === undefined) delete v.escala;
    else v.escala = e;
    const s1 = escalaDaVista(f, v);
    if (c && s0 !== s1) {
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      v.x = cx - (cx - v.x) * (s1 / s0);
      v.y = cy - (cy - v.y) * (s1 / s0);
    }
    renderizarPropsVista();
    desenharFolha();
  };
  esc.querySelector<HTMLInputElement>("[data-rot]")!.onchange = (e) => {
    v.rotulo = (e.target as HTMLInputElement).checked;
    desenharFolha();
  };
}

// ---------- Nota ----------

function abrirNota(id: string | null) {
  if (comando) cancelarComando();
  const n = id ? folha()?.notas.find((x) => x.id === id) : undefined;
  comando = { tipo: "nota", texto: n?.texto ?? "", altura: n?.altura ?? 3.5, editando: n ? n.id : null, snapshot: JSON.stringify(doc) };
  selNota = n?.id ?? null;
  mostrarPainel(true);
  renderizarComando();
  renderizarAbas();
  atualizarStatus();
  $("painel-comando").querySelector<HTMLTextAreaElement>("textarea")?.focus();
}

function renderizarNota() {
  if (comando?.tipo !== "nota") return;
  const c = comando;
  const p = painelBase(c.editando ? "Editar nota" : "Nota");
  const corpo = caixa(p, "Texto");
  corpo.innerHTML = `<textarea rows="5" data-t placeholder="Ex.: NOTAS:&#10;1. Quebrar cantos vivos.&#10;2. Material: {material}"></textarea>
    <div class="pc-botoes">${["codigo", "titulo", "material", "revisao", "escala", "data"].map((k) => `<button data-p="${k}">{${k}}</button>`).join("")}</div>
    <label class="campo"><span>Altura do texto</span><select data-h>${[2.5, 3.5, 5, 7].map((h) => `<option value="${h}"${h === c.altura ? " selected" : ""}>${fmt(h)} mm</option>`).join("")}</select></label>
    <p class="dica">${c.editando ? "✓ grava a alteração." : "Escreva e toque na folha onde a nota deve ficar (pode colocar várias)."}</p>`;
  const t = corpo.querySelector<HTMLTextAreaElement>("textarea")!;
  t.value = c.texto;
  const aplicar = () => {
    c.texto = t.value;
    const n = c.editando ? folha()?.notas.find((x) => x.id === c.editando) : undefined;
    if (n) {
      n.texto = c.texto || " ";
      n.altura = c.altura;
      desenharFolha();
    }
  };
  t.oninput = aplicar;
  corpo.querySelectorAll<HTMLButtonElement>("[data-p]").forEach((b) => (b.onclick = () => {
    const i = t.selectionStart ?? t.value.length;
    t.value = `${t.value.slice(0, i)}{${b.dataset.p}}${t.value.slice(t.selectionEnd ?? i)}`;
    aplicar();
    t.focus();
  }));
  corpo.querySelector<HTMLSelectElement>("[data-h]")!.onchange = (e) => {
    c.altura = Number((e.target as HTMLSelectElement).value);
    aplicar();
  };
}

function colocarNota(p: { x: number; y: number }) {
  if (comando?.tipo !== "nota") return;
  if (!comando.texto.trim()) return avisar("Escreva o texto da nota no painel.");
  const n: Nota = { id: novoIdD(), x: p.x, y: p.y, texto: comando.texto, altura: comando.altura };
  folha()!.notas.push(n);
  registrarPasso();
  salvarAutosave();
  comando.snapshot = JSON.stringify(doc);
  tudo();
}

// ---------- Propriedades da folha e legenda ----------

function abrirPropsFolha(nova: boolean) {
  if (comando) cancelarComando();
  comando = { tipo: "folha", snapshot: JSON.stringify(doc), nova };
  mostrarPainel(true);
  renderizarComando();
  renderizarAbas();
}

function renderizarPropsFolha() {
  if (comando?.tipo !== "folha") return;
  const f = folha()!;
  const p = painelBase("Propriedades da folha");
  const corpo = caixa(p, "Folha");
  corpo.innerHTML = `<label class="campo"><span>Nome</span><input data-nome /></label>
    <label class="campo"><span>Formato (NBR 10068)</span><select data-fmt>${(Object.keys(FORMATOS) as Formato[]).map((k) => `<option value="${k}"${k === f.formato ? " selected" : ""}>${FORMATOS[k].nome} (${FORMATOS[k].l} × ${FORMATOS[k].a})</option>`).join("")}</select></label>
    <label class="campo"><span>Escala</span><select data-esc>${opcoesEscala(f.escala, false)}</select></label>
    <label class="campo"><span>Tipo de projeção</span><select data-d><option value="1"${f.diedro === 1 ? " selected" : ""}>1º diedro (ABNT, padrão)</option><option value="3"${f.diedro === 3 ? " selected" : ""}>3º diedro</option></select></label>
    <p class="dica">A escala da folha vale para as vistas sem escala própria. Mudar o diedro não move as vistas já colocadas.</p>`;
  const nome = corpo.querySelector<HTMLInputElement>("[data-nome]")!;
  nome.value = f.nome;
  nome.oninput = () => {
    f.nome = nome.value.trim() || f.nome;
    renderizarAbasFolhas();
  };
  corpo.querySelector<HTMLSelectElement>("[data-fmt]")!.onchange = (e) => {
    f.formato = (e.target as HTMLSelectElement).value as Formato;
    desenharFolha();
    atualizarStatus();
  };
  const sel = corpo.querySelector<HTMLSelectElement>("[data-esc]")!;
  sel.onchange = () => {
    const e = lerSelectEscala(sel, f.escala);
    if (e) {
      // vistas na escala da folha crescem/encolhem em torno do próprio centro
      for (const v of f.vistas.filter((k) => k.escala === undefined)) {
        const c = caixaDaVista(f, v);
        if (!c) continue;
        const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
        v.x = cx - (cx - v.x) * (e / f.escala);
        v.y = cy - (cy - v.y) * (e / f.escala);
      }
      f.escala = e;
    }
    renderizarPropsFolha();
    desenharFolha();
    atualizarStatus();
  };
  corpo.querySelector<HTMLSelectElement>("[data-d]")!.onchange = (e) => {
    f.diedro = (e.target as HTMLSelectElement).value === "3" ? 3 : 1;
    desenharFolha();
    atualizarStatus();
  };
}

function abrirLegenda() {
  if (comando) cancelarComando();
  comando = { tipo: "legenda", snapshot: JSON.stringify(doc) };
  mostrarPainel(true);
  renderizarComando();
  renderizarAbas();
}

function renderizarLegenda() {
  if (comando?.tipo !== "legenda") return;
  const d = doc!;
  const props = propriedades(folha()!);
  const p = painelBase("Legenda");
  const corpo = caixa(p, "Campos (NBR 10582)");
  corpo.innerHTML = CAMPOS_LEGENDA.map(([k, n]) => `<label class="campo"><span>${n}</span><input data-k="${k}" /></label>`).join("")
    + `<p class="dica">Campo vazio usa o cartão do modelo no cofre (WJPDM) ou o valor automático (data de hoje, revisão do desenho). Escala, diedro e folha vêm da folha.</p>`;
  corpo.querySelectorAll<HTMLInputElement>("[data-k]").forEach((i) => {
    const k = i.dataset.k as CampoLegenda;
    i.value = d.legenda[k] ?? "";
    i.placeholder = props[k] ?? "";
    i.oninput = () => {
      if (i.value.trim()) d.legenda[k] = i.value;
      else delete d.legenda[k];
      desenharFolha();
    };
  });
}

// ---------- imprimir / PDF / SVG ----------

const CSS_FOLHA = `.papel{fill:#fff}.l-moldura{stroke:#000;stroke-width:.7;fill:none}.l-media{stroke:#000;stroke-width:.5}.l-fina{stroke:#000;stroke-width:.25}
.v-vis{fill:none;stroke:#000;stroke-linecap:round;stroke-linejoin:round}.v-oc{fill:none;stroke:#000}.v-centro{fill:none;stroke:#000}
.v-alvo{fill:none;stroke:none}.c-linha,.b-linha{fill:none;stroke:#000;stroke-width:.25}.c-seta,.b-ponto{fill:#000}.c-alvo{fill:none;stroke:none}.b-circulo{fill:#fff;stroke:#000;stroke-width:.35}.cota.pendente .c-texto{fill:#000}.v-hachura{stroke:#000}.v-regiao{stroke:none}.v-dobra{fill:none;stroke:#000}.m-detalhe{fill:none;stroke:#000;stroke-width:.25}.m-corte{fill:none;stroke:#000;stroke-width:.25;stroke-dasharray:8 1.5 1 1.5}.m-corte-ponta,.m-seta{fill:none;stroke:#000;stroke-width:.5}.m-seta-ponta{fill:#000}.t-letra{font-weight:600}text{font-family:"Helvetica","Arial",sans-serif;fill:#000}.t-rot{fill:#444}.t-aviso{fill:#a33}.sombra{display:none}`;

/** SVG autônomo da folha em tamanho real (mm), com as espessuras da norma. */
function svgDaFolha(f: Folha): string {
  const F = FORMATOS[f.formato];
  const conteudo = conteudoFolha(f).replace(/calc\(var\(--lv\) \/ ([\d.e-]+)\)/g, (_, s) => String(0.5 / Number(s))).replace(/calc\(var\(--lo\) \/ ([\d.e-]+)\)/g, (_, s) => String(0.35 / Number(s))).replace(/calc\(var\(--lf\) \/ ([\d.e-]+)\)/g, (_, s) => String(0.25 / Number(s)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${F.l}mm" height="${F.a}mm" viewBox="0 0 ${F.l} ${F.a}"><style>${CSS_FOLHA}</style>${conteudo}</svg>`;
}

async function esperarVistas(): Promise<boolean> {
  const f = folha()!;
  const pend = f.vistas.flatMap((v) => {
    const m = modeloDe(v.modelo);
    return m ? [projecaoDaVista(f, v, m).catch(() => null)] : [];
  });
  if (pend.length) {
    atualizarStatus("Calculando as vistas…");
    await Promise.all(pend);
    atualizarStatus();
  }
  return true;
}

async function imprimir() {
  if (!doc) return;
  await esperarVistas();
  const f = folha()!;
  const F = FORMATOS[f.formato];
  // todas as folhas, cada uma numa página do tamanho dela
  const paginas = doc.folhas.map((x) => svgDaFolha(x));
  const ifr = document.createElement("iframe");
  ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(ifr);
  const w = ifr.contentWindow!;
  w.document.open();
  w.document.write(`<!doctype html><html><head><title>${escapar(doc.nome)}</title><style>@page{size:${F.l}mm ${F.a}mm;margin:0}html,body{margin:0}svg{display:block;page-break-after:always}</style></head><body>${paginas.join("")}</body></html>`);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
    setTimeout(() => ifr.remove(), 1000);
  }, 200);
  if (doc.folhas.some((x) => x.formato !== f.formato)) avisar("Folhas com formatos diferentes: a impressão usa o formato da folha atual para todas as páginas.", 6000);
}

async function exportarSvg() {
  if (!doc) return;
  await esperarVistas();
  const f = folha()!;
  baixar(new Blob([svgDaFolha(f)], { type: "image/svg+xml" }), `${doc.nome} - ${f.nome}.svg`);
}

// ---------- arquivo ----------

/** Salva no cofre (GO-OUT no dispositivo) com as referências do desenho (tabela do WJPDM). */
function salvar(): Promise<string> {
  if (!doc) return Promise.resolve("Nada a salvar.");
  limparModelos();
  const d = doc;
  const dados = new Blob([JSON.stringify(d)], { type: "application/octet-stream" });
  const referencias = d.modelos.filter((m) => m.arquivo).map((m) => ({ filho: m.arquivo!, tipo: "desenho" as const, quantidade: 1 }));
  avisar("Salvando no cofre…");
  const p = salvarNoCofre("drw", `${d.nome}.wjdrw`, dados, (nome) => {
    d.nome = nome;
    $<HTMLInputElement>("nome-doc").value = nome;
    salvarAutosave();
    renderizarArvore();
  }, { referencias, modelo: { tipo: "desenho" } });
  p.then((m) => {
    avisar(m, 6000);
    void lerRevisao();
  }, (e) => avisar(`Não foi possível salvar: ${(e as Error).message}`));
  return p;
}

async function lerRevisao() {
  const id = vinculo("drw");
  revisaoDesenho = id ? ((await lerDoCofre(id).catch(() => null))?.arquivo.revisao ?? "") : "";
  desenharFolha();
}

function abrirDesenho(d: DocumentoDesenho) {
  if (comando) fecharComando();
  doc = d;
  folhaId = d.folhas[0].id;
  vbFolha = "";
  selVistas = [];
  selNota = null;
  historico.length = 0;
  refazer.length = 0;
  $<HTMLInputElement>("nome-doc").value = d.nome;
  atualizarAreaDeTrabalho();
  registrarPasso();
  salvarAutosave();
  renderizarAbas();
  tudo();
  void (async () => {
    await atualizarDoCofre();
    for (const m of d.modelos) void lerCartao(m);
    void lerRevisao();
  })();
}

/** Associatividade: modelos do cofre que mudaram lá (GO-IN, cópia de trabalho) entram no desenho. */
async function atualizarDoCofre() {
  if (!doc) return;
  const mudaram: string[] = [];
  for (const m of doc.modelos) {
    if (!m.arquivo) continue;
    const r = await lerDoCofre(m.arquivo).catch(() => null);
    if (!r) continue;
    try {
      const nova = m.tipo === "montagem" ? validarMontagem(JSON.parse(r.texto)) : validarDocumento(JSON.parse(r.texto));
      const marca = marcaDe(JSON.stringify(nova));
      cartoes.set(m.id, r.arquivo.cartao);
      if (marca !== m.marca) {
        Object.assign(m, { doc: nova, marca, versao: r.versao });
        mudaram.push(m.nome);
      }
    } catch {
      /* conteúdo inválido no cofre: fica a cópia embutida */
    }
  }
  // peças das montagens: a versão do cofre entra mesmo sem a montagem ter sido salva de novo
  for (const m of doc.modelos) {
    if (m.tipo !== "montagem") continue;
    const a = m.doc as DocumentoMontagem;
    for (const p of [...a.pecas]) {
      if (!p.arquivo) continue;
      const r = await lerDoCofre(p.arquivo).catch(() => null);
      if (!r) continue;
      try {
        const nova = validarDocumento(JSON.parse(r.texto));
        if (marcaDe(`${JSON.stringify(nova.features)}|${nova.material ?? ""}`) !== p.marca) {
          embutirPeca(a, nova, { arquivo: p.arquivo, versao: r.versao });
          mudaram.push(p.nome);
        }
      } catch {
        /* peça inválida no cofre: fica a embutida */
      }
    }
  }
  if (mudaram.length) {
    salvarAutosave();
    tudo();
    avisar(`Vistas atualizadas do cofre: ${mudaram.join(", ")}.`, 5000);
  }
}

function novoDesenho(abrirTres = true) {
  if (doc?.folhas.some((f) => f.vistas.length) && !confirm("Fechar o desenho atual e começar um novo? (o que não foi salvo no cofre se perde)")) return false;
  desligar("drw");
  abrirDesenho(desenhoVazio(`Desenho${Math.floor(Math.random() * 90) + 10}`));
  if (abrirTres) abrirVistaModelo(true);
  return true;
}

/** Criar desenho a partir da peça ou montagem aberta (menu dos outros ambientes). */
function desenhoDoAberto(tipo: "peca" | "montagem") {
  const d = tipo === "peca" ? lerJson<Documento>("jlscad:documento", (x) => validarDocumento(x)) : lerJson<DocumentoMontagem>("wjcad:montagem", (x) => validarMontagem(x));
  if (!d) return void novoDesenho();
  desligar("drw");
  abrirDesenho(desenhoVazio(d.nome));
  abrirVistaModelo(true);
  const c = comando as Extract<Comando, { tipo: "modelo" }>;
  c.iso = true;
  adicionarModelo(tipo, d, { arquivo: vinculo(tipo === "peca" ? "cad" : "asm") ?? undefined, nome: d.nome });
}

function abrirNovo() {
  abrirPopover($("btn-menu"), [
    { rotulo: "Peça", icone: "peca", acao: () => (location.href = new URL(`${RAIZ}cad/#novo`, location.href).href) },
    { rotulo: "Montagem", icone: "montagem", acao: () => (location.href = new URL(`${RAIZ}cad/montagem/#novo`, location.href).href) },
    { rotulo: "Desenho", icone: "desenho", acao: () => void novoDesenho() },
  ]);
}

function fecharDesenho() {
  if (!doc) return;
  if (!confirm("Fechar o desenho? (o que não foi salvo no cofre se perde)")) return;
  if (comando) fecharComando();
  doc = null;
  svg.innerHTML = "";
  atualizarAreaDeTrabalho();
  atualizarStatus();
}

$<HTMLInputElement>("arquivo").onchange = async (e) => {
  const inp = e.target as HTMLInputElement;
  const arq = inp.files?.[0];
  inp.value = "";
  const paraModelo = escolhendoArquivoModelo;
  escolhendoArquivoModelo = false;
  inp.accept = ".wjdrw";
  if (!arq) return;
  try {
    const dados = JSON.parse(await arq.text());
    if (paraModelo && comando?.tipo === "modelo") {
      const asm = dados?.formato === "wjasm";
      adicionarModelo(asm ? "montagem" : "peca", asm ? validarMontagem(dados) : validarDocumento(dados), { nome: arq.name });
      return;
    }
    desligar("drw");
    abrirDesenho(validarDesenho(dados));
  } catch (err) {
    avisar((err as Error).message);
  }
};

// ---------- menu, ações rápidas ----------

const ACOES: Record<string, { rotulo: string; icone: NomeIcone; fazer: () => void; doc?: boolean }> = {
  novo: { rotulo: "Novo…", icone: "nova", fazer: abrirNovo },
  abrirCofre: { rotulo: "Abrir do cofre (WJPDM)…", icone: "pasta", fazer: () => void abrirDoCofre("drw") },
  abrir: { rotulo: "Abrir arquivo do aparelho (.wjdrw)…", icone: "abrir", fazer: () => {
    escolhendoArquivoModelo = false;
    $<HTMLInputElement>("arquivo").accept = ".wjdrw";
    $<HTMLInputElement>("arquivo").click();
  } },
  salvar: { rotulo: "Salvar (.wjdrw)", icone: "salvar", fazer: () => void salvar(), doc: true },
  pdf: { rotulo: "Imprimir / PDF…", icone: "pdf", fazer: () => void imprimir(), doc: true },
  fechar: { rotulo: "Fechar desenho", icone: "fechar", fazer: fecharDesenho, doc: true },
  locais: { rotulo: "Cópias do cofre (pendrive, Drive, dispositivo)…", icone: "pasta", fazer: () => void abrirCopias() },
  atalhos: { rotulo: "Atalhos", icone: "menu", fazer: () => abrirJanela("Atalhos do desenho", `<table class="tabela"><tbody>${[
    ["F", "Ajustar a folha na tela"], ["Delete", "Excluir vista/nota selecionada"], ["Ctrl+P", "Imprimir / PDF"],
    ["Ctrl+Z / Ctrl+Y / Ctrl+S", "Desfazer / Refazer / Salvar"], ["Enter / Esc", "OK / Cancelar no comando"],
    ["Mouse: roda / meio ou arrastar no vazio", "Aproximar / mover a folha"], ["Toque: 1 dedo no vazio / 2 dedos", "Mover / aproximar a folha"],
    ["Duplo toque na vista / nota / legenda", "Propriedades / editar"],
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
  ["novo", "abrirCofre", "abrir", "salvar", "pdf", "fechar"].forEach(item);
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
$("janela-fechar").onclick = fecharJanela;

const nomeDoc = $<HTMLInputElement>("nome-doc");
nomeDoc.onchange = () => {
  if (!doc) return;
  doc.nome = nomeDoc.value.trim() || "Desenho";
  nomeDoc.value = doc.nome;
  alterou();
};

// ---------- barra de vistas (folha) ----------

function renderizarBarraVistas() {
  const barra = $("barra-vistas");
  barra.innerHTML = "";
  barra.classList.add("aberta");
  const caixaV = document.createElement("div");
  caixaV.className = "caixa-vistas";
  const botao = (icone: NomeIcone, titulo: string, acao: () => void) => {
    const b = document.createElement("button");
    b.className = "btn-ic";
    b.title = titulo;
    b.setAttribute("aria-label", titulo);
    b.innerHTML = ICONES[icone];
    b.onclick = acao;
    caixaV.append(b);
  };
  botao("enquadrar", "Ajustar a folha (F)", enquadrarFolha);
  botao("zoomArea", "Aproximar", () => {
    const r = svg.getBoundingClientRect();
    zoomEm(r.left + r.width / 2, r.top + r.height / 2, 0.7);
  });
  botao("vistas", "Afastar", () => {
    const r = svg.getBoundingClientRect();
    zoomEm(r.left + r.width / 2, r.top + r.height / 2, 1 / 0.7);
  });
  barra.append(caixaV);
}

// ---------- área de trabalho ----------

function atualizarAreaDeTrabalho() {
  const aberto = !!doc;
  document.body.classList.toggle("sem-documento", !aberto);
  $("tela-inicial").hidden = aberto;
  if (aberto) return;
  $("ti-novo").innerHTML = `${ICONES.desenho}<span>Novo desenho</span>`;
  $("ti-abrir").innerHTML = `${ICONES.pasta}<span>Abrir do cofre…</span>`;
  $("ti-novo").onclick = () => void novoDesenho();
  $("ti-abrir").onclick = () => void abrirDoCofre("drw");
  const rec = $("ti-recentes");
  rec.innerHTML = "";
  const ultimo = lerJson<DocumentoDesenho>(CHAVE, validarDesenho);
  rec.append(Object.assign(document.createElement("h3"), { textContent: "Recentes" }));
  if (ultimo) {
    const b = document.createElement("button");
    b.innerHTML = `${ICONES.desenho}<span></span><small>último desenho</small>`;
    b.querySelector("span")!.textContent = ultimo.nome;
    b.onclick = () => abrirDesenho(ultimo);
    rec.append(b);
  }
  for (const [ic, r, s, url] of [["peca", "Ambiente de Peça", "WJCAD", "cad/"], ["montagem", "Ambiente de Montagem", "WJCAD", "cad/montagem/"]] as const) {
    const b = document.createElement("button");
    b.innerHTML = `${ICONES[ic]}<span>${r}</span><small>${s}</small>`;
    b.onclick = () => (location.href = new URL(`${RAIZ}${url}`, location.href).href);
    rec.append(b);
  }
}

// ---------- teclado ----------

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, select, textarea")) return;
  if (!doc) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === "z" && !e.shiftKey) desfazer();
  else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) refazerPasso();
  else if (ctrl && k === "s") void salvar();
  else if (ctrl && k === "p") void imprimir();
  else if (e.key === "Enter" && comando) confirmarComando();
  else if (e.key === "Escape") {
    if (comando) cancelarComando();
    else {
      selVistas = [];
      selNota = null;
      esconderBarra();
      tudo();
    }
  } else if (ctrl) return;
  else if (k === "f") enquadrarFolha();
  else if (k === "d" && !comando) abrirCota();
  else if (e.key === "Delete" && !comando) excluirSelecao();
  else return;
  e.preventDefault();
});

// ---------- início ----------

montarMenu();
renderizarAbas();
renderizarBarraVistas();
instalarPainelCofre("drw", salvar);
void sincronizarAoAbrir(kernel.pronto)?.catch(() => {});
{
  const inicial = lerJson<DocumentoDesenho>(CHAVE, validarDesenho);
  const hash = location.hash;
  const voltando = !!sessionStorage.getItem("wjcad:voltarDesenho");
  sessionStorage.removeItem("wjcad:voltarDesenho");
  if (hash) history.replaceState(null, "", location.pathname + location.search);
  if (hash === "#novo") novoDesenho();
  else if (hash === "#de-peca") desenhoDoAberto("peca");
  else if (hash === "#de-montagem") desenhoDoAberto("montagem");
  else if (hash === "#abrir-autosave" && inicial) abrirDesenho(inicial);
  else if (inicial && (vinculo("drw") || voltando)) abrirDesenho(inicial); // volta da peça/montagem: continua (e atualiza as vistas)
  else atualizarAreaDeTrabalho();
}

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__drw = { doc: () => doc, abrir: (d: unknown) => abrirDesenho(validarDesenho(d)), projecoes, folha };
