// Regras do cofre do WJPDM (puras, testadas em scripts/teste-pdm.ts): modelo de dados, fluxo de
// estados com transições e condições, check-out, sequência de revisões e numeração automática.

export type Estado = "trabalho" | "revisao" | "liberado" | "obsoleto";

export const ESTADOS: Record<Estado, { nome: string; cor: string; bloqueado: boolean }> = {
  trabalho: { nome: "Em trabalho", cor: "#2f7fd0", bloqueado: false },
  revisao: { nome: "Em revisão", cor: "#c98a12", bloqueado: true },
  liberado: { nome: "Liberado", cor: "#2e8b57", bloqueado: true },
  obsoleto: { nome: "Obsoleto", cor: "#8a96a3", bloqueado: true },
};

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
}

export interface Pasta {
  id: string;
  nome: string;
  pai: string | null;
  cartao?: Record<string, string>;
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
}

/** Campos do cartão de dados (ordem do formulário). */
export const CAMPOS_CARTAO: { id: string; nome: string; obrigatorioNaRevisao?: boolean; lista?: string[] }[] = [
  { id: "codigo", nome: "Código", obrigatorioNaRevisao: true },
  { id: "descricao", nome: "Descrição", obrigatorioNaRevisao: true },
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

export const TRANSICOES: Transicao[] = [
  { id: "enviar", nome: "Enviar para revisão", de: ["trabalho"], para: "revisao" },
  { id: "aprovar", nome: "Aprovar e liberar", de: ["revisao"], para: "liberado", sobeRevisao: true },
  { id: "rejeitar", nome: "Rejeitar (volta a Em trabalho)", de: ["revisao"], para: "trabalho" },
  { id: "alterar", nome: "Nova revisão (volta a Em trabalho)", de: ["liberado"], para: "trabalho" },
  { id: "obsoleto", nome: "Tornar obsoleto", de: ["liberado", "trabalho"], para: "obsoleto" },
  { id: "reativar", nome: "Reativar", de: ["obsoleto"], para: "trabalho" },
];

/** Motivo pelo qual a transição não pode ser feita agora (ou null). */
export function bloqueioDaTransicao(a: Arquivo, t: Transicao): string | null {
  if (!t.de.includes(a.estado)) return `O arquivo está em "${ESTADOS[a.estado].nome}".`;
  if (a.checkout) return `Está com check-out de ${a.checkout.usuario}: faça o check-in antes.`;
  if (a.lixeira) return "O arquivo está na lixeira.";
  if (t.id === "enviar") {
    const faltam = CAMPOS_CARTAO.filter((c) => c.obrigatorioNaRevisao && !a.cartao[c.id]?.trim()).map((c) => c.nome);
    if (faltam.length) return `Preencha no cartão de dados: ${faltam.join(", ")}.`;
  }
  return null;
}

export function transicoesDe(a: Arquivo) {
  return TRANSICOES.filter((t) => t.de.includes(a.estado)).map((t) => ({ t, bloqueio: bloqueioDaTransicao(a, t) }));
}

/** Executa a transição (sem checar bloqueio). */
export function aplicarTransicao(a: Arquivo, t: Transicao, usuario: string, agora: string, comentario = "") {
  const de = a.estado;
  a.estado = t.para;
  if (t.sobeRevisao) a.revisao = proximaRevisao(a.revisao);
  const ult = a.versoes[a.versoes.length - 1];
  if (ult && t.sobeRevisao) (ult.revisao = a.revisao), (ult.estado = a.estado);
  a.historico.push({ data: agora, usuario, texto: `${t.nome}: ${ESTADOS[de].nome} → ${ESTADOS[t.para].nome}${t.sobeRevisao ? ` (revisão ${a.revisao})` : ""}${comentario ? ` — ${comentario}` : ""}` });
}

/** Check-out: null se pode, ou o motivo. */
export function bloqueioDoCheckout(a: Arquivo, usuario: string): string | null {
  if (a.lixeira) return "O arquivo está na lixeira.";
  if (a.checkout) return a.checkout.usuario === usuario ? "Você já tem o check-out deste arquivo." : `Check-out de ${a.checkout.usuario} desde ${a.checkout.data.slice(0, 10)}.`;
  if (ESTADOS[a.estado].bloqueado) return `Arquivo "${ESTADOS[a.estado].nome}" não pode ser alterado${a.estado === "liberado" ? ": crie uma nova revisão (Alterar estado)" : ""}.`;
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
