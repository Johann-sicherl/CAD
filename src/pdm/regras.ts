// Regras do cofre do WJPDM (puras, testadas em scripts/teste-pdm.ts): modelo de dados, fluxo de
// estados com transições e condições, check-out, sequência de revisões e numeração automática.

/** Id de um estado do fluxo de trabalho (o fluxo é editável: ver Fluxo). */
export type Estado = string;

export interface EstadoFluxo {
  id: string;
  nome: string;
  cor: string;
  /** trava a edição (sem GO-OUT, sem renomear) */
  bloqueado: boolean;
  /** impede excluir o arquivo (ex.: em produção: torne-o obsoleto antes) */
  naoExcluir?: boolean;
  /** primeira revisão desta fase ("P1", "01", "A"): a revisão sobe nesse esquema ao entrar no estado */
  esquemaRevisao?: string;
}

export interface Transicao {
  id: string;
  nome: string;
  de: Estado[];
  para: Estado;
  /** a revisão sobe ao executar, no esquema do estado de destino */
  sobeRevisao?: boolean;
  /** campos do cartão que precisam estar preenchidos */
  exigeCampos?: string[];
  /** pede um comentário (motivo) */
  exigeComentario?: boolean;
}

/** Fluxo de trabalho do cofre (um só, editável em Ferramentas → Fluxo de trabalho). */
export interface Fluxo {
  nome: string;
  /** estado dos arquivos novos */
  inicial: Estado;
  estados: EstadoFluxo[];
  transicoes: Transicao[];
}

const COR = { dev: "#2f7fd0", prod: "#2e8b57", rev: "#c98a12", obs: "#8a96a3" };

/**
 * Fluxo de fábrica (Johann, 29/10/2026): Protótipo → Pré-série → Série, cada fase em
 * desenvolvimento (editável), em produção (travado, revisão sobe) e em revisão (fora da linha de
 * produção e fora do desenvolvimento: travado até ser aprovado ou devolvido). A fase Protótipo usa
 * os ids antigos (trabalho/revisao/liberado) para os arquivos que já existem.
 */
function fluxoPadrao(): Fluxo {
  const fases = [
    { nome: "Protótipo", dev: "trabalho", prod: "liberado", rev: "revisao", esquema: "P1", pre: "" },
    { nome: "Pré-série", dev: "pre-dev", prod: "pre-prod", rev: "pre-rev", esquema: "01", pre: "pre-" },
    { nome: "Série", dev: "serie-dev", prod: "serie-prod", rev: "serie-rev", esquema: "A", pre: "serie-" },
  ];
  const estados: EstadoFluxo[] = fases.flatMap((f) => [
    { id: f.dev, nome: `${f.nome} em desenvolvimento`, cor: COR.dev, bloqueado: false },
    { id: f.prod, nome: `${f.nome} em produção`, cor: COR.prod, bloqueado: true, naoExcluir: true, esquemaRevisao: f.esquema },
    { id: f.rev, nome: `${f.nome} em revisão`, cor: COR.rev, bloqueado: true },
  ]);
  estados.push({ id: "obsoleto", nome: "Obsoleto", cor: COR.obs, bloqueado: true });
  const transicoes: Transicao[] = fases.flatMap((f, k) => {
    const prox = fases[k + 1];
    return [
      { id: `${f.pre}enviar`, nome: "Enviar para revisão", de: [f.dev], para: f.rev, exigeCampos: ["codigo", "descricao"] },
      { id: `${f.pre}aprovar`, nome: "Aprovar para produção", de: [f.rev], para: f.prod, sobeRevisao: true },
      { id: `${f.pre}rejeitar`, nome: "Devolver ao desenvolvimento", de: [f.rev], para: f.dev },
      { id: `${f.pre}revisar`, nome: "Colocar em revisão (sai da produção)", de: [f.prod], para: f.rev, exigeComentario: true },
      ...(prox ? [{ id: `${f.pre}avancar`, nome: `Avançar para ${prox.nome}`, de: [f.prod], para: prox.dev }] : []),
    ];
  });
  transicoes.push(
    { id: "obsoleto", nome: "Tornar obsoleto", de: fases.flatMap((f) => [f.dev, f.prod]), para: "obsoleto", exigeComentario: true },
    { id: "reativar", nome: "Reativar", de: ["obsoleto"], para: "trabalho" },
  );
  return { nome: "Ciclo de vida do componente", inicial: "trabalho", estados, transicoes };
}
export const FLUXO_PADRAO: Fluxo = fluxoPadrao();
export const copiaDoFluxo = (f: Fluxo): Fluxo => JSON.parse(JSON.stringify(f));

let fluxo: Fluxo = FLUXO_PADRAO;
/** Fluxo em uso (o do cofre, ou o de fábrica). */
export const fluxoAtual = () => fluxo;
/** Passa a usar o fluxo do cofre (inválido ou ausente: o de fábrica). */
export function usarFluxo(f?: Fluxo | null) {
  fluxo = f && !validarFluxo(f).length ? f : FLUXO_PADRAO;
}
/** Dados do estado; um estado que saiu do fluxo aparece com o próprio id e sem trava. */
export const estadoDe = (id: Estado): EstadoFluxo => fluxo.estados.find((e) => e.id === id) ?? { id, nome: `${id} (fora do fluxo)`, cor: COR.obs, bloqueado: false };

/** Problemas do fluxo (vazio = válido). `emUso`: estados que algum arquivo tem agora. */
export function validarFluxo(f: Fluxo, emUso: Iterable<Estado> = []): string[] {
  const erros: string[] = [];
  const ids = new Set(f.estados.map((e) => e.id));
  if (!f.estados.length) erros.push("O fluxo precisa de pelo menos um estado.");
  const nomes = f.estados.map((e) => e.nome.trim().toLowerCase());
  if (nomes.some((n) => !n)) erros.push("Todo estado precisa de nome.");
  if (new Set(nomes).size !== nomes.length) erros.push("Há estados com o mesmo nome.");
  if (ids.size !== f.estados.length) erros.push("Há estados repetidos.");
  if (!ids.has(f.inicial)) erros.push("Escolha o estado inicial (arquivos novos).");
  for (const t of f.transicoes) {
    const n = t.nome.trim() || "(sem nome)";
    if (!t.nome.trim()) erros.push("Toda transição precisa de nome.");
    if (!t.de.length) erros.push(`"${n}": marque de quais estados ela sai.`);
    if (t.de.some((d) => !ids.has(d)) || !ids.has(t.para)) erros.push(`"${n}": usa um estado que não existe.`);
  }
  const faltam = [...new Set(emUso)].filter((e) => !ids.has(e));
  if (faltam.length) erros.push(`Há arquivos nos estados removidos (${faltam.join(", ")}): mude o estado deles antes de remover.`);
  return erros;
}

export interface Evento {
  data: string;
  usuario: string;
  texto: string;
}

export interface Versao {
  n: number;
  /** chave do conteúdo no armazenamento */
  blob: string;
  tamanho: number;
  autor: string;
  data: string;
  comentario: string;
  /** revisão vigente quando a versão foi criada */
  revisao: string;
  estado: Estado;
}

export interface Arquivo {
  id: string;
  nome: string;
  pasta: string;
  versoes: Versao[];
  /** revisão atual ("" antes da primeira liberação) */
  revisao: string;
  estado: Estado;
  checkout?: { usuario: string; data: string };
  cartao: Record<string, string>;
  item?: string;
  historico: Evento[];
  lixeira?: boolean;
  /** quando foi para a lixeira (destruído sozinho após 30 dias) */
  lixeiraData?: string;
  /** arquivo novo que nunca teve GO-IN: existe só no dispositivo (não vai para pendrive/Drive) */
  soLocal?: boolean;
  /** cópia de trabalho (o que o app salvou desde o último GO-IN); ausente = igual à última versão */
  trabalho?: { blob: string; tamanho: number; data: string; autor: string };
  /** última alteração do registro (sincronia entre cópias: a mais recente vence) */
  mod?: string;
}

export interface Pasta {
  id: string;
  nome: string;
  pai: string | null;
  cartao?: Record<string, string>;
  mod?: string;
}

export interface LinhaBOM {
  item: string;
  qtd: number;
  pos?: string;
  obs?: string;
}

export type TipoItem = "acabado" | "semiacabado" | "fabricado" | "comprado" | "materia" | "consumivel" | "servico";
export const TIPOS_ITEM: [TipoItem, string][] = [
  ["acabado", "Produto acabado"],
  ["semiacabado", "Semiacabado"],
  ["fabricado", "Peça fabricada"],
  ["comprado", "Comprado"],
  ["materia", "Matéria-prima"],
  ["consumivel", "Consumível"],
  ["servico", "Serviço"],
];

export interface Item {
  id: string;
  codigo: string;
  descricao: string;
  tipo: TipoItem;
  unidade: string;
  material?: string;
  massa?: number;
  obs?: string;
  bom: LinhaBOM[];
  mod?: string;
}

/** Campos do cartão de dados (ordem do formulário). */
export const CAMPOS_CARTAO: { id: string; nome: string; lista?: string[] }[] = [
  { id: "codigo", nome: "Código" },
  { id: "descricao", nome: "Descrição" },
  { id: "material", nome: "Material" },
  { id: "projetista", nome: "Projetista" },
  { id: "projeto", nome: "Projeto / cliente" },
  { id: "acabamento", nome: "Acabamento", lista: ["", "Bruto", "Pintado", "Zincado", "Galvanizado a fogo", "Anodizado", "Polido", "Escovado"] },
  { id: "obs", nome: "Observação" },
];

export interface Transicao {
  id: string;
  nome: string;
  de: Estado[];
  para: Estado;
  /** a revisão sobe ao executar (liberação) */
  sobeRevisao?: boolean;
}

/** Motivo pelo qual a transição não pode ser feita agora (ou null). */
export function bloqueioDaTransicao(a: Arquivo, t: Transicao): string | null {
  if (!t.de.includes(a.estado)) return `O arquivo está em "${estadoDe(a.estado).nome}".`;
  if (a.checkout) return `Está em GO-OUT com ${a.checkout.usuario}: faça o GO-IN antes.`;
  if (a.lixeira) return "O arquivo está na lixeira.";
  const faltam = CAMPOS_CARTAO.filter((c) => t.exigeCampos?.includes(c.id) && !a.cartao[c.id]?.trim()).map((c) => c.nome);
  if (faltam.length) return `Preencha no cartão de dados: ${faltam.join(", ")}.`;
  return null;
}

export function transicoesDe(a: Arquivo) {
  return fluxo.transicoes.filter((t) => t.de.includes(a.estado)).map((t) => ({ t, bloqueio: bloqueioDaTransicao(a, t) }));
}

/** Executa a transição (sem checar bloqueio). */
export function aplicarTransicao(a: Arquivo, t: Transicao, usuario: string, agora: string, comentario = "") {
  const de = a.estado;
  a.estado = t.para;
  if (t.sobeRevisao) a.revisao = proximaRevisaoNoEsquema(a.revisao, estadoDe(t.para).esquemaRevisao);
  const ult = a.versoes[a.versoes.length - 1];
  if (ult && t.sobeRevisao) (ult.revisao = a.revisao), (ult.estado = a.estado);
  a.historico.push({ data: agora, usuario, texto: `${t.nome}: ${estadoDe(de).nome} → ${estadoDe(t.para).nome}${t.sobeRevisao ? ` (revisão ${a.revisao})` : ""}${comentario ? ` — ${comentario}` : ""}` });
}

/** GO-OUT (retirar para editar, o check-out dos PDMs): null se pode, ou o motivo. */
export function bloqueioDoCheckout(a: Arquivo, usuario: string): string | null {
  if (a.lixeira) return "O arquivo está na lixeira.";
  if (a.checkout) return a.checkout.usuario === usuario ? "Este arquivo já está em GO-OUT com você." : `Em GO-OUT com ${a.checkout.usuario} desde ${a.checkout.data.slice(0, 10)}.`;
  const e = estadoDe(a.estado);
  if (e.bloqueado) return `Arquivo "${e.nome}" não pode ser alterado: mude o estado (Alterar estado) para um estado de desenvolvimento.`;
  return null;
}

/** A, B … Z, AA, AB …; numérica: 00, 01 … (mantém os dígitos). */
export function proximaRevisao(r: string): string {
  if (!r) return "A";
  if (/^\d+$/.test(r)) return String(Number(r) + 1).padStart(r.length, "0");
  const letras = r.toUpperCase().split("");
  let i = letras.length - 1;
  while (i >= 0) {
    if (letras[i] !== "Z") {
      letras[i] = String.fromCharCode(letras[i].charCodeAt(0) + 1);
      return letras.join("");
    }
    letras[i] = "A";
    i--;
  }
  return `A${letras.join("")}`;
}

/**
 * Revisão seguinte no esquema da fase ("P1" → P1, P2…; "01" → 01, 02…; "A" → A, B…): se a revisão
 * atual já é desse esquema, sobe; se é de outra fase (ou vazia), começa no primeiro do esquema.
 */
export function proximaRevisaoNoEsquema(atual: string, esquema?: string): string {
  const m = esquema ? /^(.*?)(\d+|[A-Za-z]+)$/.exec(esquema.trim()) : null;
  if (!m) return proximaRevisao(atual);
  const [, prefixo, base] = m;
  const resto = atual.startsWith(prefixo) ? atual.slice(prefixo.length) : "";
  const mesmoTipo = /^\d+$/.test(base) ? /^\d+$/.test(resto) : /^[A-Za-z]+$/.test(resto);
  return resto && mesmoTipo ? prefixo + proximaRevisao(resto) : esquema!.trim();
}

/** Próximo código livre pela máscara (# = dígito), ex.: "12-####" → "12-0007". */
export function proximoCodigo(mascara: string, usados: string[]): string {
  const n = (mascara.match(/#/g) ?? []).length;
  if (!n) return mascara;
  const pre = mascara.slice(0, mascara.indexOf("#")), pos = mascara.slice(mascara.lastIndexOf("#") + 1);
  let max = 0;
  for (const u of usados) {
    if (!u.startsWith(pre) || !u.endsWith(pos)) continue;
    const meio = u.slice(pre.length, u.length - pos.length);
    if (/^\d+$/.test(meio)) max = Math.max(max, Number(meio));
  }
  return `${pre}${String(max + 1).padStart(n, "0")}${pos}`;
}

/** Extensão (minúscula, sem ponto). */
export const extensao = (nome: string) => (/\.([^.]+)$/.exec(nome)?.[1] ?? "").toLowerCase();

/** Nome livre na pasta: "peça.wjcad" → "peça (2).wjcad". */
export function nomeLivre(nome: string, existentes: string[]): string {
  const usados = new Set(existentes.map((x) => x.toLowerCase()));
  if (!usados.has(nome.toLowerCase())) return nome;
  const ext = extensao(nome);
  const base = ext ? nome.slice(0, -(ext.length + 1)) : nome;
  for (let k = 2; ; k++) {
    const n = `${base} (${k})${ext ? `.${ext}` : ""}`;
    if (!usados.has(n.toLowerCase())) return n;
  }
}

/** Lista de materiais explodida (quantidades acumuladas por nível); detecta ciclos. */
export function explodirBOM(itens: Item[], raiz: string): { item: Item; nivel: number; qtd: number; total: number }[] | string {
  const porId = new Map(itens.map((i) => [i.id, i]));
  const r: { item: Item; nivel: number; qtd: number; total: number }[] = [];
  const andar = (id: string, nivel: number, mult: number, caminho: string[]): string | null => {
    const it = porId.get(id);
    if (!it) return null;
    for (const l of it.bom) {
      if (caminho.includes(l.item)) return `A lista de materiais é circular (${[...caminho, l.item].map((x) => porId.get(x)?.codigo ?? "?").join(" → ")}).`;
      const filho = porId.get(l.item);
      if (!filho) continue;
      r.push({ item: filho, nivel, qtd: l.qtd, total: l.qtd * mult });
      const e = andar(l.item, nivel + 1, l.qtd * mult, [...caminho, l.item]);
      if (e) return e;
    }
    return null;
  };
  return andar(raiz, 1, 1, [raiz]) ?? r;
}

/** Itens que usam o item (onde é usado, todos os níveis). */
export function ondeEUsado(itens: Item[], id: string): { item: Item; nivel: number }[] {
  const r: { item: Item; nivel: number }[] = [];
  const vistos = new Set<string>();
  const subir = (alvo: string, nivel: number) => {
    for (const it of itens) {
      if (!it.bom.some((l) => l.item === alvo) || vistos.has(it.id)) continue;
      vistos.add(it.id);
      r.push({ item: it, nivel });
      subir(it.id, nivel + 1);
    }
  };
  subir(id, 1);
  return r;
}
