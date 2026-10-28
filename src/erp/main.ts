// WJERP: gestão local ligada ao WJPDM — cadastros, estoque com custo médio, compras, vendas,
// ordens de produção que consomem a lista de materiais, MRP, financeiro e painel.
// Telas geradas por metadados (lista → ficha). Regras puras em src/erp/regras.ts; especificação em
// docs/global/erp.md. Os dados ficam neste aparelho (IndexedDB) até o servidor da fase G7.

import "./erp.css";
import { $, baixar, Casca, el, escapar, janela, registrarOffline, salvarArquivo } from "../comum/casca";
import { Armazem } from "../comum/armazem";
import { IC, type NomeIc } from "../comum/icones";
import { calcularEstoque, mrp, parcelas, proximoNumero, saldoDe, type ItemErp, type Movimento, type Sugestao } from "./regras";

type Reg = Record<string, unknown> & { id: string };
type TipoCampo = "texto" | "numero" | "moeda" | "data" | "lista" | "ref" | "area";
interface Campo {
  id: string;
  nome: string;
  tipo: TipoCampo;
  opcoes?: [string, string][];
  ref?: string;
  obrig?: boolean;
  naLista?: boolean;
  /** só leitura na ficha (preenchido pelo sistema) */
  ro?: boolean;
  padrao?: () => unknown;
  largo?: boolean;
  /** escondido no celular (lista) */
  opc?: boolean;
  /** continua editável com o documento travado (armazém, entrega, observação) */
  livre?: boolean;
}
interface Acao {
  rotulo: string;
  destaque?: boolean;
  fazer: (r: Reg) => Promise<void> | void;
}
interface Entidade {
  id: string;
  nome: string;
  singular: string;
  grupo: string;
  icone: NomeIc;
  campos: Campo[];
  linhas?: Campo[];
  prefixo?: string;
  status?: (r: Reg) => [string, string];
  filtros?: [string, string][];
  acoes?: (r: Reg) => Acao[];
  validar?: (r: Reg) => string | null;
  /** quando o registro não pode mais ser alterado (ficha só leitura) */
  travado?: (r: Reg) => boolean;
  total?: (r: Reg) => number;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const somarDias = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
const dataBR = (d: unknown) => (typeof d === "string" && d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const moeda = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number, c = 3) => (Math.round((v || 0) * 10 ** c) / 10 ** c).toLocaleString("pt-BR");
const n = (v: unknown) => Number(v) || 0;
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").map((u) => [u, u] as [string, string]);
const COR = { azul: "#2f7fd0", verde: "#2e8b57", amarelo: "#c98a12", vermelho: "#c9372c", cinza: "#8a96a3", roxo: "#7b4bb7" };

/** CPF/CNPJ: confere os dígitos verificadores. */
function documentoValido(d: string): boolean {
  const x = d.replace(/\D/g, "");
  if (!x) return true;
  if (/^(\d)\1+$/.test(x)) return false;
  const dv = (base: string, pesos: number[]) => {
    const r = base.split("").reduce((t, c, i) => t + Number(c) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (x.length === 11) {
    const d1 = dv(x.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = dv(x.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return d1 === +x[9] && d2 === +x[10];
  }
  if (x.length === 14) {
    const d1 = dv(x.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = dv(x.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return d1 === +x[12] && d2 === +x[13];
  }
  return false;
}

// ---------- dados ----------

const LOJAS = ["meta", "clientes", "fornecedores", "itens", "armazens", "condicoes", "movimentos", "compras", "vendas", "ops", "titulos"];
let db: Armazem;
const dados: Record<string, Reg[]> = Object.fromEntries(LOJAS.map((l) => [l, []]));
const porId = (ent: string, id: unknown) => dados[ent]?.find((r) => r.id === id);
const nomeRef = (ent: string, id: unknown) => {
  const r = porId(ent, id);
  if (!r) return "";
  return ent === "itens" ? `${s(r.codigo)} — ${s(r.descricao)}` : s(r.nome ?? r.numero ?? r.codigo);
};

async function gravar(ent: string, r: Reg) {
  r.alterado = new Date().toISOString().slice(0, 19);
  const lista = dados[ent];
  const i = lista.findIndex((x) => x.id === r.id);
  if (i < 0) lista.push(r);
  else lista[i] = r;
  await db.por(ent, r);
}
async function apagar(ent: string, id: string) {
  dados[ent] = dados[ent].filter((x) => x.id !== id);
  await db.apagar(ent, id);
}

let estoque = calcularEstoque([], true);
function recalcularEstoque() {
  estoque = calcularEstoque(dados.movimentos as unknown as Movimento[], true);
}
const armazemPadrao = () => s(dados.armazens[0]?.id);
const medio = (item: string) => estoque.medio.get(item) ?? n(porId("itens", item)?.custoPadrao);

/** Grava movimentos depois de conferir que nenhum saldo fica negativo. */
async function movimentar(novos: Omit<Movimento, "id">[]) {
  const ms = novos.map((m) => ({ id: uid(), ...m }) as Movimento);
  calcularEstoque([...(dados.movimentos as unknown as Movimento[]), ...ms]);
  for (const m of ms) await gravar("movimentos", m as unknown as Reg);
  recalcularEstoque();
}

async function gerarTitulos(tipo: "pagar" | "receber", pessoa: string, total: number, cond: unknown, origem: string, emissao = hoje()) {
  const dias = s(porId("condicoes", cond)?.dias) || "0";
  const ps = parcelas(total, dias, emissao);
  for (const [k, p] of ps.entries()) {
    await gravar("titulos", { id: uid(), tipo, numero: origem, parcela: `${k + 1}/${ps.length}`, pessoa, emissao, vencimento: p.vencimento, valor: p.valor, pago: 0, baixas: [], origem });
  }
}

// ---------- entidades ----------

const linhasTotal = (r: Reg) => ((r.linhas as Reg[]) ?? []).reduce((t, l) => t + n(l.qtd) * n(l.preco), 0);
const statusTitulo = (r: Reg): [string, string] => {
  const aberto = n(r.valor) - n(r.pago);
  if (aberto <= 0.004) return ["Pago", COR.verde];
  if (s(r.vencimento) < hoje()) return ["Vencido", COR.vermelho];
  return n(r.pago) > 0 ? ["Parcial", COR.amarelo] : ["Em aberto", COR.azul];
};
const ST: Record<string, [string, string]> = {
  aberto: ["Em aberto", COR.azul], aprovado: ["Aprovado", COR.roxo], parcial: ["Parcial", COR.amarelo], recebido: ["Recebido", COR.verde],
  faturado: ["Faturado", COR.verde], cancelado: ["Cancelado", COR.cinza], prevista: ["Prevista", COR.cinza], firme: ["Firme", COR.azul], encerrada: ["Encerrada", COR.verde],
};
const stDoc = (r: Reg) => ST[s(r.status)] ?? ["?", COR.cinza];

const ENTIDADES: Entidade[] = [
  {
    id: "clientes", nome: "Clientes", singular: "Cliente", grupo: "Cadastros", icone: "cliente", prefixo: "C",
    campos: [
      { id: "codigo", nome: "Código", tipo: "texto", naLista: true, ro: true },
      { id: "nome", nome: "Nome / razão social", tipo: "texto", obrig: true, naLista: true, largo: true },
      { id: "doc", nome: "CPF / CNPJ", tipo: "texto", naLista: true, opc: true },
      { id: "email", nome: "E-mail", tipo: "texto", opc: true },
      { id: "telefone", nome: "Telefone", tipo: "texto", naLista: true, opc: true },
      { id: "cidade", nome: "Cidade", tipo: "texto", naLista: true, opc: true },
      { id: "uf", nome: "UF", tipo: "lista", opcoes: [["", ""], ...UFS], naLista: true, opc: true },
      { id: "cond", nome: "Condição de pagamento", tipo: "ref", ref: "condicoes" },
      { id: "limite", nome: "Limite de crédito", tipo: "moeda" },
      { id: "obs", nome: "Observação", tipo: "area", largo: true },
    ],
    validar: (r) => (documentoValido(s(r.doc)) ? null : "CPF/CNPJ inválido (dígitos verificadores não conferem)."),
  },
  {
    id: "fornecedores", nome: "Fornecedores", singular: "Fornecedor", grupo: "Cadastros", icone: "fornecedor", prefixo: "F",
    campos: [
      { id: "codigo", nome: "Código", tipo: "texto", naLista: true, ro: true },
      { id: "nome", nome: "Nome / razão social", tipo: "texto", obrig: true, naLista: true, largo: true },
      { id: "doc", nome: "CPF / CNPJ", tipo: "texto", naLista: true, opc: true },
      { id: "email", nome: "E-mail", tipo: "texto", opc: true },
      { id: "telefone", nome: "Telefone", tipo: "texto", naLista: true, opc: true },
      { id: "cidade", nome: "Cidade", tipo: "texto", naLista: true, opc: true },
      { id: "uf", nome: "UF", tipo: "lista", opcoes: [["", ""], ...UFS], naLista: true, opc: true },
      { id: "cond", nome: "Condição de pagamento", tipo: "ref", ref: "condicoes" },
      { id: "prazo", nome: "Prazo de entrega (dias)", tipo: "numero" },
      { id: "obs", nome: "Observação", tipo: "area", largo: true },
    ],
    validar: (r) => (documentoValido(s(r.doc)) ? null : "CPF/CNPJ inválido (dígitos verificadores não conferem)."),
  },
  {
    id: "itens", nome: "Itens", singular: "Item", grupo: "Cadastros", icone: "item",
    campos: [
      { id: "codigo", nome: "Código", tipo: "texto", obrig: true, naLista: true },
      { id: "descricao", nome: "Descrição", tipo: "texto", obrig: true, naLista: true, largo: true },
      { id: "unidade", nome: "Unidade", tipo: "texto", naLista: true, padrao: () => "pç", opc: true },
      { id: "politica", nome: "Política", tipo: "lista", opcoes: [["comprar", "Comprar"], ["fabricar", "Fabricar"]], naLista: true, padrao: () => "comprar", opc: true },
      { id: "preco", nome: "Preço de venda", tipo: "moeda", naLista: true, opc: true },
      { id: "custoPadrao", nome: "Custo padrão", tipo: "moeda" },
      { id: "minimo", nome: "Estoque mínimo", tipo: "numero" },
      { id: "lote", nome: "Lote mínimo de reposição", tipo: "numero" },
      { id: "prazo", nome: "Prazo de reposição (dias)", tipo: "numero" },
      { id: "pdm", nome: "Vínculo com o WJPDM", tipo: "texto", ro: true },
    ],
    linhas: [
      { id: "item", nome: "Componente (estrutura)", tipo: "ref", ref: "itens", obrig: true },
      { id: "qtd", nome: "Qtd. por unidade", tipo: "numero", obrig: true },
    ],
    validar: (r) => {
      if (dados.itens.some((x) => x.id !== r.id && s(x.codigo).toLowerCase() === s(r.codigo).toLowerCase())) return "Já existe um item com esse código.";
      if (((r.linhas as Reg[]) ?? []).some((l) => l.item === r.id)) return "O item não pode ser componente dele mesmo.";
      return null;
    },
  },
  {
    id: "armazens", nome: "Armazéns", singular: "Armazém", grupo: "Cadastros", icone: "estoque",
    campos: [
      { id: "codigo", nome: "Código", tipo: "texto", obrig: true, naLista: true },
      { id: "nome", nome: "Nome", tipo: "texto", obrig: true, naLista: true, largo: true },
    ],
  },
  {
    id: "condicoes", nome: "Condições de pagamento", singular: "Condição de pagamento", grupo: "Cadastros", icone: "financeiro",
    campos: [
      { id: "nome", nome: "Nome", tipo: "texto", obrig: true, naLista: true },
      { id: "dias", nome: "Dias das parcelas (ex.: 30/60/90; 0 = à vista)", tipo: "texto", obrig: true, naLista: true, padrao: () => "30" },
    ],
  },
  {
    id: "compras", nome: "Pedidos de compra", singular: "Pedido de compra", grupo: "Movimentos", icone: "compra", prefixo: "PC",
    campos: [
      { id: "numero", nome: "Número", tipo: "texto", naLista: true, ro: true },
      { id: "fornecedor", nome: "Fornecedor", tipo: "ref", ref: "fornecedores", naLista: true },
      { id: "data", nome: "Emissão", tipo: "data", naLista: true, padrao: hoje, opc: true },
      { id: "entrega", nome: "Entrega prevista", tipo: "data", naLista: true, padrao: () => somarDias(hoje(), 10), opc: true, livre: true },
      { id: "cond", nome: "Condição de pagamento", tipo: "ref", ref: "condicoes" },
      { id: "armazem", nome: "Armazém de entrada", tipo: "ref", ref: "armazens", padrao: armazemPadrao, livre: true },
      { id: "obs", nome: "Observação", tipo: "area", largo: true, livre: true },
    ],
    linhas: [
      { id: "item", nome: "Item", tipo: "ref", ref: "itens", obrig: true },
      { id: "qtd", nome: "Qtd.", tipo: "numero", obrig: true },
      { id: "preco", nome: "Preço unit.", tipo: "moeda" },
      { id: "recebido", nome: "Recebido", tipo: "numero", ro: true },
    ],
    status: stDoc,
    filtros: [["", "Todos"], ["aberto", "Em aberto"], ["aprovado", "Aprovados"], ["parcial", "Parciais"], ["recebido", "Recebidos"], ["cancelado", "Cancelados"]],
    total: linhasTotal,
    travado: (r) => s(r.status) !== "aberto",
    acoes: (r) => [
      ...(r.status === "aberto" ? [{ rotulo: "Aprovar", destaque: true, fazer: aprovarCompra }] : []),
      ...(r.status === "aprovado" || r.status === "parcial" ? [{ rotulo: "Receber…", destaque: true, fazer: receberCompra }] : []),
      ...(r.status === "aberto" || r.status === "aprovado" ? [{ rotulo: "Cancelar pedido", fazer: (x: Reg) => mudarStatus("compras", x, "cancelado") }] : []),
    ],
  },
  {
    id: "vendas", nome: "Pedidos de venda", singular: "Pedido de venda", grupo: "Movimentos", icone: "venda", prefixo: "PV",
    campos: [
      { id: "numero", nome: "Número", tipo: "texto", naLista: true, ro: true },
      { id: "cliente", nome: "Cliente", tipo: "ref", ref: "clientes", obrig: true, naLista: true },
      { id: "data", nome: "Emissão", tipo: "data", naLista: true, padrao: hoje, opc: true },
      { id: "entrega", nome: "Entrega prometida", tipo: "data", naLista: true, padrao: () => somarDias(hoje(), 30), opc: true, livre: true },
      { id: "cond", nome: "Condição de pagamento", tipo: "ref", ref: "condicoes" },
      { id: "armazem", nome: "Armazém de saída", tipo: "ref", ref: "armazens", padrao: armazemPadrao, livre: true },
      { id: "obs", nome: "Observação", tipo: "area", largo: true, livre: true },
    ],
    linhas: [
      { id: "item", nome: "Item", tipo: "ref", ref: "itens", obrig: true },
      { id: "qtd", nome: "Qtd.", tipo: "numero", obrig: true },
      { id: "preco", nome: "Preço unit.", tipo: "moeda" },
      { id: "entregue", nome: "Faturado", tipo: "numero", ro: true },
    ],
    status: stDoc,
    filtros: [["", "Todos"], ["aberto", "Em aberto"], ["aprovado", "Aprovados"], ["parcial", "Parciais"], ["faturado", "Faturados"], ["cancelado", "Cancelados"]],
    total: linhasTotal,
    travado: (r) => s(r.status) !== "aberto",
    acoes: (r) => [
      ...(r.status === "aberto" ? [{ rotulo: "Aprovar", destaque: true, fazer: aprovarVenda }] : []),
      ...(r.status === "aprovado" || r.status === "parcial" ? [{ rotulo: "Faturar / expedir…", destaque: true, fazer: faturarVenda }] : []),
      ...(r.status === "aberto" || r.status === "aprovado" ? [{ rotulo: "Cancelar pedido", fazer: (x: Reg) => mudarStatus("vendas", x, "cancelado") }] : []),
    ],
  },
  {
    id: "ops", nome: "Ordens de produção", singular: "Ordem de produção", grupo: "Produção", icone: "producao", prefixo: "OP",
    campos: [
      { id: "numero", nome: "Número", tipo: "texto", naLista: true, ro: true },
      { id: "item", nome: "Produto", tipo: "ref", ref: "itens", obrig: true, naLista: true },
      { id: "qtd", nome: "Quantidade", tipo: "numero", obrig: true, naLista: true },
      { id: "data", nome: "Início", tipo: "data", naLista: true, padrao: hoje, opc: true },
      { id: "entrega", nome: "Entrega", tipo: "data", naLista: true, padrao: () => somarDias(hoje(), 7), opc: true },
      { id: "armazem", nome: "Armazém", tipo: "ref", ref: "armazens", padrao: armazemPadrao },
      { id: "produzido", nome: "Produzido", tipo: "numero", ro: true, naLista: true, opc: true },
      { id: "obs", nome: "Observação", tipo: "area", largo: true },
    ],
    status: stDoc,
    filtros: [["", "Todas"], ["prevista", "Previstas"], ["firme", "Firmes"], ["encerrada", "Encerradas"], ["cancelada", "Canceladas"]],
    travado: (r) => s(r.status) === "encerrada" || s(r.status) === "cancelado",
    validar: (r) => (((porId("itens", r.item)?.linhas as Reg[]) ?? []).length ? null : "O produto não tem estrutura (componentes): cadastre no item ou importe do WJPDM."),
    acoes: (r) => [
      ...(r.status === "prevista" ? [{ rotulo: "Firmar", destaque: true, fazer: (x: Reg) => mudarStatus("ops", x, "firme") }] : []),
      ...(r.status === "firme" ? [{ rotulo: "Apontar / encerrar…", destaque: true, fazer: encerrarOP }] : []),
      ...(r.status === "prevista" || r.status === "firme" ? [{ rotulo: "Cancelar OP", fazer: (x: Reg) => mudarStatus("ops", x, "cancelado") }] : []),
    ],
  },
  {
    id: "movimentos", nome: "Movimentos de estoque", singular: "Movimento de estoque", grupo: "Estoque", icone: "movimento",
    campos: [
      { id: "data", nome: "Data", tipo: "data", obrig: true, naLista: true, padrao: hoje },
      { id: "tipo", nome: "Tipo", tipo: "lista", opcoes: [["entrada", "Entrada"], ["saida", "Saída"], ["transferencia", "Transferência"], ["ajuste", "Ajuste (+/−)"]], naLista: true, padrao: () => "entrada" },
      { id: "item", nome: "Item", tipo: "ref", ref: "itens", obrig: true, naLista: true },
      { id: "armazem", nome: "Armazém", tipo: "ref", ref: "armazens", obrig: true, naLista: true, padrao: armazemPadrao, opc: true },
      { id: "destino", nome: "Destino (transferência)", tipo: "ref", ref: "armazens" },
      { id: "qtd", nome: "Quantidade", tipo: "numero", obrig: true, naLista: true },
      { id: "custo", nome: "Custo unitário (entrada)", tipo: "moeda", naLista: true, opc: true },
      { id: "doc", nome: "Documento", tipo: "texto", naLista: true, opc: true },
      { id: "obs", nome: "Observação", tipo: "area", largo: true },
    ],
    filtros: [["", "Todos"], ["entrada", "Entradas"], ["saida", "Saídas"], ["transferencia", "Transferências"], ["ajuste", "Ajustes"]],
    travado: (r) => !!dados.movimentos.find((x) => x.id === r.id),
    validar: (r) => {
      if (r.tipo === "transferencia" && (!r.destino || r.destino === r.armazem)) return "Escolha um armazém de destino diferente.";
      if (r.tipo !== "ajuste" && n(r.qtd) <= 0) return "A quantidade deve ser positiva.";
      if ((r.tipo === "entrada" || (r.tipo === "ajuste" && n(r.qtd) > 0)) && r.custo === undefined) r.custo = medio(s(r.item));
      try {
        calcularEstoque([...(dados.movimentos as unknown as Movimento[]).filter((m) => m.id !== r.id), r as unknown as Movimento]);
      } catch (e) {
        return (e as Error).message;
      }
      return null;
    },
  },
  {
    id: "titulos", nome: "Contas a pagar e receber", singular: "Título", grupo: "Financeiro", icone: "financeiro",
    campos: [
      { id: "tipo", nome: "Tipo", tipo: "lista", opcoes: [["receber", "A receber"], ["pagar", "A pagar"]], naLista: true, padrao: () => "pagar" },
      { id: "numero", nome: "Documento", tipo: "texto", naLista: true },
      { id: "parcela", nome: "Parcela", tipo: "texto", naLista: true, padrao: () => "1/1", opc: true },
      { id: "pessoa", nome: "Cliente / fornecedor", tipo: "texto", obrig: true, naLista: true },
      { id: "emissao", nome: "Emissão", tipo: "data", padrao: hoje },
      { id: "vencimento", nome: "Vencimento", tipo: "data", obrig: true, naLista: true, padrao: () => somarDias(hoje(), 30) },
      { id: "valor", nome: "Valor", tipo: "moeda", obrig: true, naLista: true },
      { id: "pago", nome: "Pago / recebido", tipo: "moeda", ro: true, naLista: true, opc: true },
      { id: "obs", nome: "Observação", tipo: "area", largo: true },
    ],
    status: statusTitulo,
    filtros: [["", "Todos"], ["receber", "A receber"], ["pagar", "A pagar"], ["abertos", "Em aberto"], ["vencidos", "Vencidos"], ["pagos", "Pagos"]],
    travado: (r) => n(r.pago) > 0,
    acoes: (r) => (n(r.valor) - n(r.pago) > 0.004 ? [{ rotulo: r.tipo === "receber" ? "Receber…" : "Pagar…", destaque: true, fazer: baixarTitulo }] : []),
  },
];
const ENT = Object.fromEntries(ENTIDADES.map((e) => [e.id, e]));

// ---------- ações dos documentos ----------

async function mudarStatus(ent: string, r: Reg, st: string) {
  r.status = st;
  await gravar(ent, r);
  renderizar();
}

async function aprovarCompra(r: Reg) {
  if (!r.fornecedor) return casca.avisar("Informe o fornecedor antes de aprovar.");
  if (!((r.linhas as Reg[]) ?? []).length) return casca.avisar("O pedido não tem itens.");
  await mudarStatus("compras", r, "aprovado");
}

async function aprovarVenda(r: Reg) {
  const ls = (r.linhas as Reg[]) ?? [];
  if (!ls.length) return casca.avisar("O pedido não tem itens.");
  const cli = porId("clientes", r.cliente);
  const limite = n(cli?.limite);
  if (limite > 0) {
    const emAberto = dados.titulos.filter((t) => t.tipo === "receber" && t.pessoa === cli?.nome).reduce((t, x) => t + n(x.valor) - n(x.pago), 0);
    const vencidos = dados.titulos.some((t) => t.tipo === "receber" && t.pessoa === cli?.nome && statusTitulo(t)[0] === "Vencido");
    if (vencidos) return casca.avisar(`Crédito bloqueado: ${cli?.nome} tem títulos vencidos.`, 6000);
    if (emAberto + linhasTotal(r) > limite) return casca.avisar(`Crédito insuficiente: em aberto ${moeda(emAberto)} + pedido ${moeda(linhasTotal(r))} > limite ${moeda(limite)}.`, 7000);
  }
  await mudarStatus("vendas", r, "aprovado");
}

/** Janela de quantidades por linha (receber / faturar). */
function janelaQuantidades(titulo: string, r: Reg, campoFeito: string, maximo: (l: Reg) => number, ok: (qs: number[]) => Promise<void>) {
  const ls = (r.linhas as Reg[]) ?? [];
  janela(titulo, `<table class="er-linhas"><thead><tr><th>Item</th><th class="num">Pedido</th><th class="num">Já feito</th><th class="num">Máx. agora</th><th style="width:120px">Agora</th></tr></thead><tbody>
    ${ls.map((l, k) => `<tr><td>${escapar(nomeRef("itens", l.item))}</td><td class="num">${num(n(l.qtd))}</td><td class="num">${num(n(l[campoFeito]))}</td><td class="num">${num(maximo(l))}</td>
      <td><input type="number" min="0" step="any" data-k="${k}" value="${Math.max(0, maximo(l))}" /></td></tr>`).join("")}</tbody></table>`, [
    { rotulo: "Cancelar" },
    {
      rotulo: "Confirmar", destaque: true, acao: (c) => {
        const qs = ls.map((_, k) => Math.max(0, Number((c.querySelector(`[data-k="${k}"]`) as HTMLInputElement).value) || 0));
        const exc = ls.findIndex((l, k) => qs[k] > maximo(l) + 1e-9);
        if (exc >= 0) return void casca.avisar(`Quantidade maior que o permitido na linha ${exc + 1}.`), false;
        if (!qs.some((q) => q > 0)) return void casca.avisar("Informe alguma quantidade."), false;
        void ok(qs).catch((e) => casca.avisar((e as Error).message, 6000));
      },
    },
  ], true);
}

function receberCompra(r: Reg) {
  const ls = (r.linhas as Reg[]) ?? [];
  janelaQuantidades(`Receber ${s(r.numero)}`, r, "recebido", (l) => n(l.qtd) - n(l.recebido), async (qs) => {
    const arm = s(r.armazem) || armazemPadrao();
    if (!arm) throw new Error("Cadastre um armazém.");
    await movimentar(ls.flatMap((l, k) => (qs[k] > 0 ? [{ data: hoje(), tipo: "entrada" as const, item: s(l.item), armazem: arm, qtd: qs[k], custo: n(l.preco), doc: s(r.numero) }] : [])));
    ls.forEach((l, k) => (l.recebido = n(l.recebido) + qs[k]));
    const valor = ls.reduce((t, l, k) => t + qs[k] * n(l.preco), 0);
    await gerarTitulos("pagar", nomeRef("fornecedores", r.fornecedor), valor, r.cond, s(r.numero));
    r.status = ls.every((l) => n(l.recebido) >= n(l.qtd) - 1e-9) ? "recebido" : "parcial";
    await gravar("compras", r);
    casca.avisar(`Recebido: entrada no estoque e ${moeda(valor)} em contas a pagar.`);
    renderizar();
  });
}

function faturarVenda(r: Reg) {
  const ls = (r.linhas as Reg[]) ?? [];
  const arm = s(r.armazem) || armazemPadrao();
  janelaQuantidades(`Faturar / expedir ${s(r.numero)}`, r, "entregue", (l) => Math.min(n(l.qtd) - n(l.entregue), saldoDe(estoque.saldos, s(l.item), arm)), async (qs) => {
    await movimentar(ls.flatMap((l, k) => (qs[k] > 0 ? [{ data: hoje(), tipo: "saida" as const, item: s(l.item), armazem: arm, qtd: qs[k], doc: s(r.numero) }] : [])));
    ls.forEach((l, k) => (l.entregue = n(l.entregue) + qs[k]));
    const valor = ls.reduce((t, l, k) => t + qs[k] * n(l.preco), 0);
    await gerarTitulos("receber", nomeRef("clientes", r.cliente), valor, r.cond, s(r.numero));
    r.status = ls.every((l) => n(l.entregue) >= n(l.qtd) - 1e-9) ? "faturado" : "parcial";
    await gravar("vendas", r);
    casca.avisar(`Faturado: saída do estoque e ${moeda(valor)} em contas a receber.`);
    renderizar();
  });
}

function encerrarOP(r: Reg) {
  const item = porId("itens", r.item);
  const comp = (item?.linhas as Reg[]) ?? [];
  const arm = s(r.armazem) || armazemPadrao();
  const falta = n(r.qtd) - n(r.produzido);
  const max = Math.min(falta, ...comp.map((c) => saldoDe(estoque.saldos, s(c.item), arm) / Math.max(1e-9, n(c.qtd))));
  janela(`Apontar produção — ${s(r.numero)}`, `
    <p><b>${escapar(nomeRef("itens", r.item))}</b> · pedido ${num(n(r.qtd))} · já produzido ${num(n(r.produzido))}</p>
    <table class="er-linhas"><thead><tr><th>Componente</th><th class="num">Por unidade</th><th class="num">Saldo em ${escapar(nomeRef("armazens", arm))}</th><th class="num">Custo médio</th></tr></thead><tbody>
    ${comp.map((c) => `<tr><td>${escapar(nomeRef("itens", c.item))}</td><td class="num">${num(n(c.qtd))}</td><td class="num">${num(saldoDe(estoque.saldos, s(c.item), arm))}</td><td class="num">${moeda(medio(s(c.item)))}</td></tr>`).join("")}</tbody></table>
    <div class="wj-campo" style="margin-top:10px"><label>Quantidade produzida agora (máx. ${num(Math.max(0, Math.floor(max * 1000) / 1000))} pelo saldo dos componentes)</label><input id="op-q" type="number" min="0" step="any" value="${Math.max(0, Math.floor(max * 1000) / 1000)}" /></div>
    <label><input id="op-fim" type="checkbox" checked /> Encerrar a OP depois deste apontamento</label>`, [
    { rotulo: "Cancelar" },
    {
      rotulo: "Apontar", destaque: true, acao: (c) => {
        const q = Number((c.querySelector("#op-q") as HTMLInputElement).value) || 0;
        const fim = (c.querySelector("#op-fim") as HTMLInputElement).checked;
        if (q <= 0 && !fim) return void casca.avisar("Informe a quantidade produzida."), false;
        void (async () => {
          if (q > 0) {
            const custo = comp.reduce((t, x) => t + n(x.qtd) * medio(s(x.item)), 0);
            await movimentar([
              ...comp.map((x) => ({ data: hoje(), tipo: "saida" as const, item: s(x.item), armazem: arm, qtd: n(x.qtd) * q, doc: s(r.numero), obs: "Consumo da OP" })),
              { data: hoje(), tipo: "entrada" as const, item: s(r.item), armazem: arm, qtd: q, custo, doc: s(r.numero), obs: "Produção da OP" },
            ]);
            r.produzido = n(r.produzido) + q;
          }
          if (fim || n(r.produzido) >= n(r.qtd) - 1e-9) r.status = "encerrada";
          await gravar("ops", r);
          casca.avisar(q > 0 ? `Apontado: ${num(q)} produzido(s); componentes consumidos do estoque.` : "OP encerrada.");
          renderizar();
        })().catch((e) => casca.avisar((e as Error).message, 6000));
      },
    },
  ]);
}

function baixarTitulo(r: Reg) {
  const aberto = Math.round((n(r.valor) - n(r.pago)) * 100) / 100;
  janela(`${r.tipo === "receber" ? "Receber" : "Pagar"} ${s(r.numero)} ${s(r.parcela)}`, `
    <p>${escapar(s(r.pessoa))} · vencimento ${dataBR(r.vencimento)} · em aberto <b>${moeda(aberto)}</b></p>
    <div class="er-ficha"><div class="wj-campo"><label>Valor</label><input id="bx-v" type="number" step="0.01" min="0" value="${aberto}" /></div>
    <div class="wj-campo"><label>Data</label><input id="bx-d" type="date" value="${hoje()}" /></div></div>`, [
    { rotulo: "Cancelar" },
    {
      rotulo: "Confirmar", destaque: true, acao: (c) => {
        const v = Number((c.querySelector("#bx-v") as HTMLInputElement).value) || 0;
        if (v <= 0 || v > aberto + 0.004) return void casca.avisar("Valor inválido."), false;
        r.pago = Math.round((n(r.pago) + v) * 100) / 100;
        r.baixas = [...((r.baixas as unknown[]) ?? []), { data: (c.querySelector("#bx-d") as HTMLInputElement).value, valor: v }];
        void gravar("titulos", r).then(renderizar);
      },
    },
  ]);
}

// ---------- telas ----------

type Tela = { tipo: "painel" } | { tipo: "lista"; ent: string } | { tipo: "saldos" } | { tipo: "kardex"; item: string } | { tipo: "mrp" } | { tipo: "fluxo" };
let tela: Tela = { tipo: "painel" };
let ordenar: { col: string; desc: boolean } | null = null;
const conteudoEl = $("#er-conteudo");
const busca = $<HTMLInputElement>("#er-busca");
const filtroEl = $<HTMLSelectElement>("#er-filtro");

const MENU: [string, [string, string, NomeIc][]][] = [
  ["Início", [["painel", "Painel", "painel"]]],
  ["Cadastros", ENTIDADES.filter((e) => e.grupo === "Cadastros").map((e) => [`lista:${e.id}`, e.nome, e.icone])],
  ["Movimentos", [["lista:vendas", "Pedidos de venda", "venda"], ["lista:compras", "Pedidos de compra", "compra"]]],
  ["Produção", [["lista:ops", "Ordens de produção", "producao"], ["mrp", "MRP (necessidades)", "estrutura"]]],
  ["Estoque", [["saldos", "Saldos", "estoque"], ["lista:movimentos", "Movimentos", "movimento"]]],
  ["Financeiro", [["lista:titulos", "Contas a pagar e receber", "financeiro"], ["fluxo", "Fluxo de caixa", "grafico"]]],
];
const chaveTela = (t: Tela) => (t.tipo === "lista" ? `lista:${t.ent}` : t.tipo === "kardex" ? "saldos" : t.tipo);

function renderizarMenu() {
  const atual = chaveTela(tela);
  $("#er-menu").innerHTML = MENU.map(([g, itens]) => `<h4>${g}</h4>${itens.map(([k, nome, ic]) => `<button data-tela="${k}" aria-current="${k === atual}">${IC[ic]}<span>${nome}</span></button>`).join("")}`).join("");
}
$("#er-menu").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tela]");
  if (!b) return;
  const k = b.dataset.tela!;
  tela = k.startsWith("lista:") ? { tipo: "lista", ent: k.slice(6) } : ({ tipo: k } as Tela);
  busca.value = "";
  filtroEl.value = "";
  ordenar = null;
  document.body.classList.remove("er-menu-aberto");
  renderizar();
});
$("#er-menu-btn").onclick = () => document.body.classList.toggle("er-menu-aberto");
busca.oninput = () => renderizarConteudo();
filtroEl.onchange = () => renderizarConteudo();
$("#er-novo").onclick = () => tela.tipo === "lista" && abrirFicha(ENT[tela.ent]);

function valorTexto(c: Campo, v: unknown): string {
  if (c.tipo === "moeda") return v === undefined || v === "" ? "" : moeda(n(v));
  if (c.tipo === "numero") return v === undefined || v === "" ? "" : num(n(v));
  if (c.tipo === "data") return dataBR(v);
  if (c.tipo === "lista") return c.opcoes?.find(([k]) => k === v)?.[1] ?? s(v);
  if (c.tipo === "ref") return nomeRef(c.ref!, v);
  return s(v);
}

function registrosFiltrados(e: Entidade) {
  const q = busca.value.trim().toLowerCase();
  const f = filtroEl.value;
  let rs = dados[e.id].filter((r) => {
    if (q && !e.campos.some((c) => valorTexto(c, r[c.id]).toLowerCase().includes(q))) return false;
    if (!f) return true;
    if (e.id === "titulos") {
      const st = statusTitulo(r)[0];
      return f === r.tipo || (f === "abertos" && st !== "Pago") || (f === "vencidos" && st === "Vencido") || (f === "pagos" && st === "Pago");
    }
    if (e.id === "movimentos") return r.tipo === f;
    return r.status === f;
  });
  const o = ordenar;
  if (o) {
    const c = e.campos.find((x) => x.id === o.col);
    const val = (r: Reg) => (o.col === "__total" ? e.total!(r) : c && (c.tipo === "numero" || c.tipo === "moeda") ? n(r[o.col]) : c ? valorTexto(c, r[o.col]).toLowerCase() : "");
    rs = [...rs].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (o.desc ? -1 : 1);
    });
  } else rs = [...rs].reverse();
  return rs;
}

function renderizarLista(e: Entidade) {
  const cols = e.campos.filter((c) => c.naLista);
  const rs = registrosFiltrados(e);
  const num = (c: Campo) => c.tipo === "numero" || c.tipo === "moeda";
  let h = `<table class="er-tabela"><thead><tr>${e.status ? "<th>Situação</th>" : ""}${cols.map((c) => `<th data-ord="${c.id}" class="${num(c) ? "num" : ""}${c.opc ? " opc" : ""}">${c.nome}${ordenar?.col === c.id ? (ordenar.desc ? " ▼" : " ▲") : ""}</th>`).join("")}${e.total ? `<th data-ord="__total" class="num">Total</th>` : ""}</tr></thead><tbody>`;
  h += rs.map((r) => `<tr data-id="${r.id}">${e.status ? `<td><span class="er-selo" style="background:${e.status(r)[1]}">${e.status(r)[0]}</span></td>` : ""}${cols.map((c) => `<td class="${num(c) ? "num" : ""}${c.opc ? " opc" : ""}">${escapar(valorTexto(c, r[c.id]))}</td>`).join("")}${e.total ? `<td class="num">${moeda(e.total(r))}</td>` : ""}</tr>`).join("");
  if (!rs.length) h += `<tr><td class="er-vazio" colspan="${cols.length + 2}">Nenhum registro. Toque em <b>+ Novo</b>${e.id === "itens" ? " ou importe os itens do WJPDM (Início → Importar do WJPDM)" : ""}.</td></tr>`;
  h += "</tbody>";
  const somaveis = cols.filter((c) => c.tipo === "moeda" && c.id !== "preco" && c.id !== "custo");
  if (rs.length && (somaveis.length || e.total)) {
    h += `<tfoot><tr>${e.status ? "<td></td>" : ""}${cols.map((c, k) => `<td class="${num(c) ? "num" : ""}${c.opc ? " opc" : ""}">${somaveis.includes(c) ? moeda(rs.reduce((t, r) => t + n(r[c.id]), 0)) : k === 0 ? `${rs.length} registro(s)` : ""}</td>`).join("")}${e.total ? `<td class="num">${moeda(rs.reduce((t, r) => t + e.total!(r), 0))}</td>` : ""}</tr></tfoot>`;
  }
  conteudoEl.innerHTML = h + "</table>";
}

conteudoEl.addEventListener("click", (e) => {
  const th = (e.target as HTMLElement).closest<HTMLElement>("[data-ord]");
  if (th && tela.tipo === "lista") {
    const col = th.dataset.ord!;
    ordenar = ordenar?.col === col ? (ordenar.desc ? null : { col, desc: true }) : { col, desc: false };
    return renderizarConteudo();
  }
  const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
  if (tr && tela.tipo === "lista") {
    const ent = ENT[tela.ent];
    const r = porId(ent.id, tr.dataset.id);
    if (r) abrirFicha(ent, r);
  }
  const card = (e.target as HTMLElement).closest<HTMLElement>("[data-ir]");
  if (card) {
    const k = card.dataset.ir!;
    tela = k.startsWith("lista:") ? { tipo: "lista", ent: k.slice(6) } : ({ tipo: k } as Tela);
    const f = card.dataset.filtro;
    renderizar();
    if (f) (filtroEl.value = f), renderizarConteudo();
  }
  const kx = (e.target as HTMLElement).closest<HTMLElement>("[data-kardex]");
  if (kx) (tela = { tipo: "kardex", item: kx.dataset.kardex! }), renderizar();
});

// ---------- ficha ----------

function campoHtml(c: Campo, v: unknown, ro: boolean, attr = "data-c") {
  const dis = ro || c.ro ? "disabled" : "";
  const val = v === undefined || v === null ? "" : String(v);
  if (c.tipo === "area") return `<textarea ${attr}="${c.id}" rows="2" ${dis}>${escapar(val)}</textarea>`;
  if (c.tipo === "lista") return `<select ${attr}="${c.id}" ${dis}>${c.opcoes!.map(([k, nm]) => `<option value="${k}"${k === val ? " selected" : ""}>${escapar(nm)}</option>`).join("")}</select>`;
  if (c.tipo === "ref") {
    const ops = [...dados[c.ref!]].sort((a, b) => nomeRef(c.ref!, a.id).localeCompare(nomeRef(c.ref!, b.id), "pt-BR"));
    return `<select ${attr}="${c.id}" ${dis}><option value="">—</option>${ops.map((r) => `<option value="${r.id}"${r.id === val ? " selected" : ""}>${escapar(nomeRef(c.ref!, r.id))}</option>`).join("")}</select>`;
  }
  const tipo = c.tipo === "data" ? "date" : c.tipo === "numero" || c.tipo === "moeda" ? "number" : "text";
  return `<input ${attr}="${c.id}" type="${tipo}" ${c.tipo === "moeda" ? 'step="0.01"' : c.tipo === "numero" ? 'step="any"' : ""} value="${escapar(val)}" ${dis} />`;
}

function lerCampo(c: Campo, el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): unknown {
  const v = el.value.trim();
  if (c.tipo === "numero" || c.tipo === "moeda") return v === "" ? undefined : Number(v);
  return v || undefined;
}

function abrirFicha(e: Entidade, existente?: Reg) {
  const novo = !existente;
  const r: Reg = existente ? JSON.parse(JSON.stringify(existente)) : { id: uid() };
  if (novo) {
    for (const c of e.campos) if (c.padrao) r[c.id] = c.padrao();
    if (e.linhas) r.linhas = [];
    if (e.status) r.status = e.id === "ops" ? "prevista" : "aberto";
    if (e.prefixo) r[e.id === "clientes" || e.id === "fornecedores" ? "codigo" : "numero"] = proximoNumero(e.prefixo, dados[e.id].map((x) => s(x.codigo ?? x.numero)), e.prefixo.length === 1 ? 5 : 6);
    if (e.id === "itens") r.linhas = [];
  }
  const ro = !novo && !!e.travado?.(existente!);
  const titulo = `${e.singular}${r.numero ? ` ${s(r.numero)}` : r.codigo ? ` ${s(r.codigo)}` : ""}`;
  const linhaHtml = (l: Reg, k: number) => `<tr data-k="${k}">${e.linhas!.map((c) => `<td class="${c.tipo === "numero" || c.tipo === "moeda" ? "num" : ""}">${campoHtml(c, l[c.id], ro, "data-l")}</td>`).join("")}${e.id !== "itens" ? `<td class="num" data-sub>${moeda(n(l.qtd) * n(l.preco))}</td>` : ""}<td>${ro ? "" : `<button data-rem title="Remover">✕</button>`}</td></tr>`;
  const extra = e.id === "itens" && !novo ? infoItem(r) : e.id === "titulos" && ((r.baixas as Reg[]) ?? []).length ? `<p class="pd-dica">Baixas: ${((r.baixas as Reg[]) ?? []).map((b) => `${dataBR(b.data)} ${moeda(n(b.valor))}`).join(" · ")}</p>` : "";
  const corpo = `
    ${e.status ? `<p><span class="er-selo" style="background:${e.status(r)[1]}">${e.status(r)[0]}</span>${ro ? ` <small style="color:var(--texto-2)">— documento não editável nesta situação</small>` : ""}</p>` : ""}
    <div class="er-ficha">${e.campos.map((c) => `<div class="wj-campo${c.largo ? " largo" : ""}"><label>${c.nome}${c.obrig ? " *" : ""}</label>${campoHtml(c, r[c.id], ro && !c.livre)}</div>`).join("")}</div>
    ${e.linhas ? `<h4 style="margin:12px 0 4px">${e.id === "itens" ? "Estrutura (lista de materiais)" : "Itens"}</h4>
      <table class="er-linhas"><thead><tr>${e.linhas.map((c) => `<th>${c.nome}</th>`).join("")}${e.id !== "itens" ? "<th>Subtotal</th>" : ""}<th style="width:40px"></th></tr></thead>
      <tbody id="fi-linhas">${((r.linhas as Reg[]) ?? []).map(linhaHtml).join("")}</tbody></table>
      ${ro ? "" : `<button id="fi-mais" style="margin-top:6px">+ ${e.id === "itens" ? "Componente" : "Item"}</button>`}
      ${e.total ? `<div class="er-total" id="fi-total">Total: ${moeda(e.total(r))}</div>` : ""}` : ""}
    ${extra}
    <p class="er-erro" id="fi-erro"></p>`;
  const coletar = (c: HTMLElement) => {
    for (const cp of e.campos) {
      if (cp.ro || (ro && !cp.livre)) continue;
      const x = c.querySelector<HTMLInputElement>(`[data-c="${cp.id}"]`);
      if (x) r[cp.id] = lerCampo(cp, x);
    }
    if (e.linhas && !ro) {
      r.linhas = [...c.querySelectorAll<HTMLTableRowElement>("#fi-linhas tr")].map((tr) => {
        const ant = ((r.linhas as Reg[]) ?? [])[Number(tr.dataset.k)] ?? {};
        const l: Reg = { ...ant, id: s(ant.id) || uid() };
        for (const cp of e.linhas!) {
          if (cp.ro) continue;
          const x = tr.querySelector<HTMLInputElement>(`[data-l="${cp.id}"]`);
          if (x) l[cp.id] = lerCampo(cp, x);
        }
        return l;
      });
    }
  };
  const validar = (): string | null => {
    for (const cp of e.campos) if (cp.obrig && (r[cp.id] === undefined || r[cp.id] === "")) return `Preencha: ${cp.nome}.`;
    for (const l of (r.linhas as Reg[]) ?? []) for (const cp of e.linhas ?? []) if (cp.obrig && !l[cp.id]) return `Preencha ${cp.nome} em todas as linhas.`;
    return e.validar?.(r) ?? null;
  };
  const temLivres = e.campos.some((c) => c.livre);
  const salvar = async (c: HTMLElement): Promise<boolean> => {
    if (ro) {
      if (!temLivres) return true;
      coletar(c);
      await gravar(e.id, r);
      return true;
    }
    coletar(c);
    const erro = validar();
    if (erro) {
      c.querySelector("#fi-erro")!.textContent = erro;
      return false;
    }
    if (e.id === "movimentos") {
      if (!novo) return true;
      await movimentar([r as unknown as Movimento]);
      return true;
    }
    await gravar(e.id, r);
    return true;
  };
  const botoes: { rotulo: string; destaque?: boolean; acao?: (c: HTMLElement) => boolean | void }[] = [];
  if (!novo && !ro && e.id !== "movimentos") {
    botoes.push({
      rotulo: "Excluir", acao: () => {
        const uso = emUso(e.id, r.id);
        if (uso) return void casca.avisar(uso, 6000), false;
        if (!confirm(`Excluir ${titulo}?`)) return false;
        void apagar(e.id, r.id).then(renderizar);
      },
    });
  }
  for (const a of novo ? [] : e.acoes?.(existente!) ?? []) {
    botoes.push({
      rotulo: a.rotulo, acao: (c) => {
        void (async () => {
          if (!(await salvar(c))) return;
          const atual = porId(e.id, r.id) ?? r;
          await a.fazer(atual);
          renderizar();
        })().catch((x) => casca.avisar((x as Error).message, 6000));
      },
    });
  }
  botoes.push({ rotulo: ro && !temLivres ? "Fechar" : "Cancelar" });
  if (!ro || temLivres) {
    botoes.push({
      rotulo: "Salvar", destaque: true, acao: (c) => {
        void salvar(c).then((ok) => {
          if (!ok) return;
          c.closest(".wj-fundo")?.remove();
          renderizar();
        }).catch((x) => (c.querySelector("#fi-erro")!.textContent = (x as Error).message));
        return false;
      },
    });
  }
  const { corpo: cp } = janela(titulo, corpo, botoes, true);
  const atualizarTotal = () => {
    if (!e.total) return;
    coletar(cp);
    cp.querySelector("#fi-total")!.textContent = `Total: ${moeda(e.total(r))}`;
    cp.querySelectorAll<HTMLTableRowElement>("#fi-linhas tr").forEach((tr, k) => {
      const l = (r.linhas as Reg[])[k];
      const sub = tr.querySelector("[data-sub]");
      if (sub && l) sub.textContent = moeda(n(l.qtd) * n(l.preco));
    });
  };
  cp.addEventListener("input", atualizarTotal);
  cp.addEventListener("change", (ev) => {
    // item escolhido na linha: sugere o preço (venda) ou o custo médio (compra)
    const sel = ev.target as HTMLSelectElement;
    if (sel.dataset.l === "item") {
      const tr = sel.closest("tr")!;
      const preco = tr.querySelector<HTMLInputElement>('[data-l="preco"]');
      if (preco && !preco.value) {
        const it = porId("itens", sel.value);
        preco.value = String(e.id === "vendas" ? n(it?.preco) : Math.round(medio(sel.value) * 100) / 100 || n(it?.custoPadrao));
      }
      atualizarTotal();
    }
    if (sel.dataset.c === "fornecedor" || sel.dataset.c === "cliente") {
      const p = porId(sel.dataset.c === "cliente" ? "clientes" : "fornecedores", sel.value);
      const cond = cp.querySelector<HTMLSelectElement>('[data-c="cond"]');
      if (p?.cond && cond && !cond.value) cond.value = s(p.cond);
    }
  });
  cp.addEventListener("click", (ev) => {
    const rem = (ev.target as HTMLElement).closest("[data-rem]");
    if (rem) (rem.closest("tr")!.remove(), atualizarTotal());
  });
  const mais = cp.querySelector<HTMLElement>("#fi-mais");
  if (mais) mais.onclick = () => {
    coletar(cp);
    const ls = r.linhas as Reg[];
    ls.push({ id: uid(), qtd: 1 });
    cp.querySelector("#fi-linhas")!.insertAdjacentHTML("beforeend", linhaHtml(ls[ls.length - 1], ls.length - 1));
  };
}

/** Saldos e uso do item (na ficha). */
function infoItem(r: Reg) {
  const sal = dados.armazens.map((a) => [a, saldoDe(estoque.saldos, r.id, a.id)] as const).filter(([, q]) => q);
  const usado = dados.itens.filter((x) => ((x.linhas as Reg[]) ?? []).some((l) => l.item === r.id));
  return `<h4 style="margin:12px 0 4px">Estoque</h4><p>${sal.length ? sal.map(([a, q]) => `${escapar(s(a.nome))}: <b>${num(q)}</b>`).join(" · ") : "Sem saldo."} · custo médio ${moeda(medio(r.id))}</p>
    ${usado.length ? `<p>Usado em: ${usado.map((x) => escapar(s(x.codigo))).join(", ")}</p>` : ""}`;
}

/** Impede excluir cadastros usados por outros registros. */
function emUso(ent: string, id: string): string | null {
  const usa = (lista: string, campos: string[]) => dados[lista].some((r) => campos.some((c) => r[c] === id) || ((r.linhas as Reg[]) ?? []).some((l) => l.item === id));
  if (ent === "itens" && (usa("movimentos", ["item"]) || usa("compras", []) || usa("vendas", []) || usa("ops", ["item"]) || usa("itens", []))) return "O item tem movimentos, pedidos, OPs ou é componente de outro item.";
  if (ent === "clientes" && usa("vendas", ["cliente"])) return "O cliente tem pedidos de venda.";
  if (ent === "fornecedores" && usa("compras", ["fornecedor"])) return "O fornecedor tem pedidos de compra.";
  if (ent === "armazens" && (usa("movimentos", ["armazem", "destino"]) || usa("compras", ["armazem"]) || usa("vendas", ["armazem"]))) return "O armazém tem movimentos.";
  if (ent === "condicoes" && ["clientes", "fornecedores", "compras", "vendas"].some((l) => usa(l, ["cond"]))) return "A condição está em uso.";
  return null;
}

// ---------- painel, saldos, kardex, MRP, fluxo ----------

function renderizarPainel() {
  const h = hoje(), d30 = somarDias(h, 30);
  const valorEstoque = [...estoque.totalItem.values()].reduce((t, x) => t + x.valor, 0);
  const abaixo = dados.itens.filter((i) => n(i.minimo) > 0 && saldoDe(estoque.saldos, i.id) < n(i.minimo));
  const pvAbertos = dados.vendas.filter((v) => ["aberto", "aprovado", "parcial"].includes(s(v.status)));
  const pcAbertos = dados.compras.filter((v) => ["aberto", "aprovado", "parcial"].includes(s(v.status)));
  const opsAbertas = dados.ops.filter((o) => o.status === "prevista" || o.status === "firme");
  const aberto = (t: Reg) => n(t.valor) - n(t.pago);
  const receber30 = dados.titulos.filter((t) => t.tipo === "receber" && aberto(t) > 0 && s(t.vencimento) <= d30).reduce((t, x) => t + aberto(x), 0);
  const pagar30 = dados.titulos.filter((t) => t.tipo === "pagar" && aberto(t) > 0 && s(t.vencimento) <= d30).reduce((t, x) => t + aberto(x), 0);
  const vencidos = dados.titulos.filter((t) => statusTitulo(t)[0] === "Vencido");
  const card = (rot: string, v: string, ir: string, alerta = false, filtro = "") => `<div class="er-card${alerta ? " alerta" : ""}" data-ir="${ir}" ${filtro ? `data-filtro="${filtro}"` : ""}><small>${rot}</small><strong>${v}</strong></div>`;
  const ultimos = [...dados.movimentos].slice(-8).reverse();
  conteudoEl.innerHTML = `<div class="er-cards">
      ${card("Valor em estoque", moeda(valorEstoque), "saldos")}
      ${card("Itens abaixo do mínimo", String(abaixo.length), "saldos", abaixo.length > 0)}
      ${card("Pedidos de venda em aberto", `${pvAbertos.length} · ${moeda(pvAbertos.reduce((t, r) => t + linhasTotal(r), 0))}`, "lista:vendas")}
      ${card("Pedidos de compra em aberto", `${pcAbertos.length} · ${moeda(pcAbertos.reduce((t, r) => t + linhasTotal(r), 0))}`, "lista:compras")}
      ${card("Ordens de produção abertas", String(opsAbertas.length), "lista:ops")}
      ${card("A receber em 30 dias", moeda(receber30), "lista:titulos", false, "receber")}
      ${card("A pagar em 30 dias", moeda(pagar30), "lista:titulos", false, "pagar")}
      ${card("Títulos vencidos", `${vencidos.length} · ${moeda(vencidos.reduce((t, x) => t + aberto(x), 0))}`, "lista:titulos", vencidos.length > 0, "vencidos")}
    </div>
    <h3 class="er-secao">Últimos movimentos de estoque</h3>
    ${ultimos.length ? `<table class="er-tabela"><thead><tr><th>Data</th><th>Tipo</th><th>Item</th><th class="num">Qtd.</th><th class="opc">Documento</th></tr></thead><tbody>${ultimos.map((m) => `<tr data-kardex="${m.item}"><td>${dataBR(m.data)}</td><td>${valorTexto(ENT.movimentos.campos[1], m.tipo)}</td><td>${escapar(nomeRef("itens", m.item))}</td><td class="num">${num(n(m.qtd))}</td><td class="opc">${escapar(s(m.doc))}</td></tr>`).join("")}</tbody></table>`
      : `<p class="pd-dica">Sem movimentos ainda. Comece por <b>Início → Dados de exemplo</b> ou cadastre itens (ou importe do WJPDM), armazéns e pedidos.</p>`}`;
}

function renderizarSaldos() {
  const q = busca.value.trim().toLowerCase();
  const its = dados.itens.filter((i) => !q || `${s(i.codigo)} ${s(i.descricao)}`.toLowerCase().includes(q)).sort((a, b) => s(a.codigo).localeCompare(s(b.codigo)));
  const arms = dados.armazens;
  let tot = 0;
  conteudoEl.innerHTML = `<table class="er-tabela"><thead><tr><th>Código</th><th>Descrição</th>${arms.map((a) => `<th class="num opc">${escapar(s(a.codigo))}</th>`).join("")}<th class="num">Total</th><th class="num opc">Mínimo</th><th class="num">Custo médio</th><th class="num">Valor</th></tr></thead><tbody>
    ${its.map((i) => {
      const t = estoque.totalItem.get(i.id) ?? { qtd: 0, valor: 0 };
      tot += t.valor;
      const baixo = n(i.minimo) > 0 && t.qtd < n(i.minimo);
      return `<tr data-kardex="${i.id}" title="Ver ficha (kardex)"><td>${escapar(s(i.codigo))}</td><td>${escapar(s(i.descricao))}</td>${arms.map((a) => `<td class="num opc">${num(saldoDe(estoque.saldos, i.id, a.id))}</td>`).join("")}
        <td class="num" style="${baixo ? "color:var(--erro);font-weight:700" : ""}">${num(t.qtd)} ${escapar(s(i.unidade))}</td><td class="num opc">${i.minimo ? num(n(i.minimo)) : ""}</td><td class="num">${moeda(medio(i.id))}</td><td class="num">${moeda(t.valor)}</td></tr>`;
    }).join("") || `<tr><td class="er-vazio" colspan="9">Nenhum item.</td></tr>`}
    </tbody><tfoot><tr><td colspan="${arms.length + 5}">Valor total em estoque</td><td class="num">${moeda(tot)}</td></tr></tfoot></table>`;
}

function renderizarKardex(item: string) {
  const ls = estoque.kardex.filter((k) => k.m.item === item);
  conteudoEl.innerHTML = `<p><button data-ir="saldos">← Saldos</button> <b>${escapar(nomeRef("itens", item))}</b> · saldo ${num(estoque.totalItem.get(item)?.qtd ?? 0)} · custo médio ${moeda(medio(item))}</p>
    <table class="er-tabela"><thead><tr><th>Data</th><th>Tipo</th><th class="opc">Armazém</th><th class="opc">Documento</th><th class="num">Qtd.</th><th class="num opc">Custo unit.</th><th class="num">Saldo</th><th class="num">Valor</th><th class="num opc">Médio</th></tr></thead><tbody>
    ${ls.map((k) => `<tr><td>${dataBR(k.m.data)}</td><td>${valorTexto(ENT.movimentos.campos[1], k.m.tipo)}${k.m.tipo === "transferencia" ? ` → ${escapar(nomeRef("armazens", k.m.destino))}` : ""}</td><td class="opc">${escapar(nomeRef("armazens", k.armazem))}</td><td class="opc">${escapar(s(k.m.doc))}</td>
      <td class="num" style="color:${k.qtd < 0 ? "var(--erro)" : "var(--ok)"}">${num(k.qtd)}</td><td class="num opc">${moeda(k.custo)}</td><td class="num">${num(k.saldoQtd)}</td><td class="num">${moeda(k.saldoValor)}</td><td class="num opc">${moeda(k.medio)}</td></tr>`).join("") || `<tr><td class="er-vazio" colspan="9">Sem movimentos.</td></tr>`}</tbody></table>`;
}

let sugestoes: Sugestao[] = [];
function itensErp(): ItemErp[] {
  return dados.itens.map((i) => ({
    id: i.id, codigo: s(i.codigo), descricao: s(i.descricao), unidade: s(i.unidade), politica: i.politica === "fabricar" ? "fabricar" : "comprar",
    bom: ((i.linhas as Reg[]) ?? []).filter((l) => l.item).map((l) => ({ item: s(l.item), qtd: n(l.qtd) })), minimo: n(i.minimo), lote: n(i.lote), prazo: n(i.prazo),
  }));
}
function rodarMRP(): string | null {
  const aReceber = (item: string) =>
    dados.compras.filter((c) => ["aberto", "aprovado", "parcial"].includes(s(c.status))).reduce((t, c) => t + ((c.linhas as Reg[]) ?? []).filter((l) => l.item === item).reduce((u, l) => u + n(l.qtd) - n(l.recebido), 0), 0) +
    dados.ops.filter((o) => (o.status === "prevista" || o.status === "firme") && o.item === item).reduce((t, o) => t + n(o.qtd) - n(o.produzido), 0);
  // componentes já empenhados em OPs abertas entram como demanda
  const demandas: { item: string; qtd: number; data: string }[] = [];
  for (const v of dados.vendas.filter((x) => ["aberto", "aprovado", "parcial"].includes(s(x.status)))) for (const l of (v.linhas as Reg[]) ?? []) {
    const resta = n(l.qtd) - n(l.entregue);
    if (resta > 0) demandas.push({ item: s(l.item), qtd: resta, data: s(v.entrega) || hoje() });
  }
  for (const o of dados.ops.filter((x) => x.status === "prevista" || x.status === "firme")) {
    const resta = n(o.qtd) - n(o.produzido);
    for (const l of (porId("itens", o.item)?.linhas as Reg[]) ?? []) demandas.push({ item: s(l.item), qtd: resta * n(l.qtd), data: s(o.data) || hoje() });
  }
  const r = mrp(itensErp(), (i) => saldoDe(estoque.saldos, i), aReceber, demandas);
  if (typeof r === "string") return r;
  sugestoes = r;
  return null;
}

function renderizarMRP() {
  const erro = rodarMRP();
  conteudoEl.innerHTML = `<p class="pd-dica">O MRP soma a demanda dos pedidos de venda em aberto, os componentes das OPs abertas e o estoque mínimo, explode a estrutura de cada item (a lista de materiais do WJPDM) e abate saldo, compras e OPs em aberto.</p>
    ${erro ? `<p class="er-erro">${escapar(erro)}</p>` : sugestoes.length ? `<table class="er-tabela"><thead><tr><th><input type="checkbox" id="mrp-todos" checked /></th><th>Ação</th><th>Item</th><th class="num">Quantidade</th><th class="num opc">Necessidade</th><th class="num opc">Disponível</th><th>Iniciar em</th><th class="opc">Precisa em</th></tr></thead><tbody>
      ${sugestoes.map((x, k) => `<tr><td><input type="checkbox" data-sug="${k}" checked /></td><td><span class="er-selo" style="background:${x.tipo === "fabricar" ? COR.azul : COR.roxo}">${x.tipo === "fabricar" ? "Fabricar (OP)" : "Comprar (PC)"}</span></td><td>${escapar(nomeRef("itens", x.item))}</td>
        <td class="num">${num(x.qtd)}</td><td class="num opc">${num(x.necessidade)}</td><td class="num opc">${num(x.disponivel)}</td><td style="${x.inicio < hoje() ? "color:var(--erro);font-weight:700" : ""}">${dataBR(x.inicio)}</td><td class="opc">${dataBR(x.data)}</td></tr>`).join("")}
      </tbody></table><div class="pd-acoes" style="margin-top:10px;display:flex;gap:8px"><button class="destaque" id="mrp-gerar">Gerar OPs e pedidos de compra selecionados</button></div>`
      : `<p><b>Nenhuma necessidade:</b> estoque, compras e OPs em aberto atendem a demanda.</p>`}`;
  const todos = conteudoEl.querySelector<HTMLInputElement>("#mrp-todos");
  if (todos) todos.onchange = () => conteudoEl.querySelectorAll<HTMLInputElement>("[data-sug]").forEach((c) => (c.checked = todos.checked));
  const gerar = conteudoEl.querySelector<HTMLElement>("#mrp-gerar");
  if (gerar) gerar.onclick = () => void gerarSugestoes();
}

async function gerarSugestoes() {
  const sel = [...conteudoEl.querySelectorAll<HTMLInputElement>("[data-sug]")].filter((c) => c.checked).map((c) => sugestoes[Number(c.dataset.sug)]);
  let ops = 0, pcs = 0;
  for (const x of sel.filter((y) => y.tipo === "fabricar")) {
    await gravar("ops", { id: uid(), numero: proximoNumero("OP", dados.ops.map((o) => s(o.numero))), item: x.item, qtd: x.qtd, data: x.inicio, entrega: x.data, armazem: armazemPadrao(), status: "prevista", produzido: 0, obs: "Gerada pelo MRP" });
    ops++;
  }
  // compras: um pedido (sem fornecedor) por data de necessidade
  const porData = new Map<string, Sugestao[]>();
  for (const x of sel.filter((y) => y.tipo === "comprar")) porData.set(x.inicio, [...(porData.get(x.inicio) ?? []), x]);
  for (const [data, xs] of porData) {
    await gravar("compras", {
      id: uid(), numero: proximoNumero("PC", dados.compras.map((o) => s(o.numero))), data: hoje(), entrega: xs[0].data, armazem: armazemPadrao(), status: "aberto", obs: `Gerado pelo MRP (pedir até ${dataBR(data)})`,
      linhas: xs.map((x) => ({ id: uid(), item: x.item, qtd: x.qtd, preco: Math.round(medio(x.item) * 100) / 100, recebido: 0 })),
    });
    pcs++;
  }
  casca.avisar(`${ops} OP(s) prevista(s) e ${pcs} pedido(s) de compra criados. Informe o fornecedor nos pedidos e aprove.`, 6000);
  renderizar();
}

function renderizarFluxo() {
  const h = hoje();
  const semanas = Array.from({ length: 12 }, (_, k) => ({ ini: somarDias(h, k * 7), fim: somarDias(h, k * 7 + 6), rec: 0, pag: 0 }));
  let atrasRec = 0, atrasPag = 0;
  for (const t of dados.titulos) {
    const a = n(t.valor) - n(t.pago);
    if (a <= 0.004) continue;
    const v = s(t.vencimento);
    if (v < h) {
      if (t.tipo === "receber") atrasRec += a;
      else atrasPag += a;
      continue;
    }
    const sm = semanas.find((x) => v >= x.ini && v <= x.fim);
    if (sm) sm[t.tipo === "receber" ? "rec" : "pag"] += a;
  }
  const max = Math.max(1, ...semanas.map((x) => Math.max(x.rec, x.pag)));
  let acum = 0;
  conteudoEl.innerHTML = `<div class="er-barras">${semanas.map((x) => `<div title="${dataBR(x.ini)}: receber ${moeda(x.rec)} · pagar ${moeda(x.pag)}"><span style="display:flex;gap:2px;align-items:flex-end;height:120px;width:auto"><span style="height:${(x.rec / max) * 120}px;background:${COR.verde}"></span><span style="height:${(x.pag / max) * 120}px;background:${COR.vermelho}"></span></span>${x.ini.slice(8, 10)}/${x.ini.slice(5, 7)}</div>`).join("")}</div>
    <p class="pd-dica"><span style="color:${COR.verde}">■</span> a receber · <span style="color:${COR.vermelho}">■</span> a pagar, por semana. Vencidos: a receber ${moeda(atrasRec)} · a pagar ${moeda(atrasPag)}.</p>
    <table class="er-tabela"><thead><tr><th>Semana</th><th class="num">A receber</th><th class="num">A pagar</th><th class="num">Saldo da semana</th><th class="num">Acumulado</th></tr></thead><tbody>
    ${semanas.map((x) => {
      acum += x.rec - x.pag;
      return `<tr><td>${dataBR(x.ini)} a ${dataBR(x.fim)}</td><td class="num">${moeda(x.rec)}</td><td class="num">${moeda(x.pag)}</td><td class="num">${moeda(x.rec - x.pag)}</td><td class="num" style="color:${acum < 0 ? "var(--erro)" : "inherit"}">${moeda(acum)}</td></tr>`;
    }).join("")}</tbody></table>`;
}

// ---------- integração com o WJPDM ----------

async function importarDoPDM() {
  let pdm: Armazem;
  try {
    pdm = await Armazem.abrir("wjpdm");
  } catch {
    return casca.avisar("Não foi possível abrir o cofre do WJPDM neste aparelho.");
  }
  const its = await pdm.todos<{ id: string; codigo: string; descricao: string; tipo: string; unidade: string; material?: string; bom: { item: string; qtd: number }[] }>("itens");
  if (!its.length) return casca.avisar("O cofre do WJPDM neste aparelho não tem itens (cadastre em WJPDM → Itens).", 6000);
  const mapa = new Map<string, Reg>();
  let novos = 0, atualizados = 0;
  for (const p of its) {
    let r = dados.itens.find((x) => x.pdmId === p.id) ?? dados.itens.find((x) => s(x.codigo) === p.codigo);
    if (!r) (r = { id: uid(), preco: 0, minimo: 0, linhas: [] }), novos++;
    else atualizados++;
    Object.assign(r, { codigo: p.codigo, descricao: p.descricao, unidade: p.unidade || "pç", pdmId: p.id, pdm: `Sim — item ${p.codigo} do cofre`, politica: ["acabado", "semiacabado", "fabricado"].includes(p.tipo) && p.bom.length ? "fabricar" : r.politica ?? "comprar" });
    mapa.set(p.id, r);
  }
  for (const p of its) {
    const r = mapa.get(p.id)!;
    if (p.bom.length) r.linhas = p.bom.filter((l) => mapa.has(l.item)).map((l) => ({ id: uid(), item: mapa.get(l.item)!.id, qtd: l.qtd }));
    await gravar("itens", r);
  }
  casca.avisar(`WJPDM: ${novos} item(ns) novo(s), ${atualizados} atualizado(s) (descrição, unidade e estrutura).`, 6000);
  tela = { tipo: "lista", ent: "itens" };
  renderizar();
}

// ---------- exemplo, cópia de segurança, CSV ----------

async function dadosExemplo() {
  if (dados.itens.length && !confirm("Acrescentar os dados de exemplo aos cadastros atuais?")) return;
  const id = () => uid();
  const a1 = { id: id(), codigo: "01", nome: "Almoxarifado" }, a2 = { id: id(), codigo: "02", nome: "Expedição" };
  const c30 = { id: id(), nome: "30 dias", dias: "30" }, c3x = { id: id(), nome: "30/60/90", dias: "30/60/90" }, av = { id: id(), nome: "À vista", dias: "0" };
  const forn = { id: id(), codigo: proximoNumero("F", dados.fornecedores.map((x) => s(x.codigo)), 5), nome: "Aços Planos Ltda.", doc: "11.222.333/0001-81", cidade: "Joinville", uf: "SC", cond: c30.id, prazo: 7 };
  const forn2 = { id: id(), codigo: proximoNumero("F", [s(forn.codigo)], 5), nome: "Fixadores Brasil", cidade: "São Paulo", uf: "SP", cond: av.id, prazo: 3 };
  const cli = { id: id(), codigo: proximoNumero("C", dados.clientes.map((x) => s(x.codigo)), 5), nome: "Mineração Serra Azul S.A.", doc: "", cidade: "Itabira", uf: "MG", cond: c3x.id, limite: 200000 };
  const chapa = { id: id(), codigo: "MP-0001", descricao: "Chapa aço SAE 1020 #3 mm", unidade: "kg", politica: "comprar", custoPadrao: 9.5, minimo: 200, lote: 500, prazo: 7, linhas: [] };
  const paraf = { id: id(), codigo: "CP-0001", descricao: "Parafuso sext. M10x30 8.8 zincado", unidade: "pç", politica: "comprar", custoPadrao: 0.85, minimo: 500, lote: 1000, prazo: 3, linhas: [] };
  const sup = { id: id(), codigo: "12-0001", descricao: "Suporte do mancal (chapa dobrada)", unidade: "pç", politica: "fabricar", prazo: 2, linhas: [{ id: id(), item: chapa.id, qtd: 4.2 }, { id: id(), item: paraf.id, qtd: 4 }] };
  const tr = { id: id(), codigo: "10-0001", descricao: "Transportador de correia TC-500", unidade: "pç", politica: "fabricar", preco: 48500, prazo: 10, linhas: [{ id: id(), item: sup.id, qtd: 8 }, { id: id(), item: paraf.id, qtd: 24 }] };
  for (const [l, rs] of [["armazens", [a1, a2]], ["condicoes", [c30, c3x, av]], ["fornecedores", [forn, forn2]], ["clientes", [cli]], ["itens", [chapa, paraf, sup, tr]]] as const) for (const r of rs) await gravar(l, r as unknown as Reg);
  await movimentar([
    { data: somarDias(hoje(), -20), tipo: "entrada", item: chapa.id, armazem: a1.id, qtd: 600, custo: 9.2, doc: "Saldo inicial" },
    { data: somarDias(hoje(), -20), tipo: "entrada", item: paraf.id, armazem: a1.id, qtd: 300, custo: 0.8, doc: "Saldo inicial" },
  ]);
  await gravar("vendas", { id: id(), numero: proximoNumero("PV", dados.vendas.map((x) => s(x.numero))), cliente: cli.id, data: hoje(), entrega: somarDias(hoje(), 25), cond: c3x.id, armazem: a2.id, status: "aprovado", linhas: [{ id: id(), item: tr.id, qtd: 2, preco: 48500, entregue: 0 }] });
  await gravar("titulos", { id: id(), tipo: "pagar", numero: "NF 1234", parcela: "1/1", pessoa: "Energia elétrica", emissao: somarDias(hoje(), -5), vencimento: somarDias(hoje(), 5), valor: 3820.4, pago: 0, baixas: [] });
  casca.avisar("Dados de exemplo criados. Veja o MRP: ele explode o transportador e sugere OPs e compras.", 6000);
  tela = { tipo: "mrp" };
  renderizar();
}

async function exportarCopia() {
  const d = { formato: "wjerp-copia", versao: 1, data: new Date().toISOString().slice(0, 19), dados: Object.fromEntries(LOJAS.filter((l) => l !== "meta").map((l) => [l, dados[l]])) };
  salvarArquivo(JSON.stringify(d), "WJERP", "wjerp", "application/json"); // cópia no cofre (ERP/WJERP.wjerp); cada GO-IN vira versão
}
async function importarCopia() {
  const inp = el("input", { type: "file" }) as HTMLInputElement;
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.formato !== "wjerp-copia") throw new Error("Não é uma cópia do WJERP (.wjerp).");
      if (!confirm(`Substituir todos os dados deste aparelho pela cópia de ${String(d.data).slice(0, 10)}?`)) return;
      await db.limparTudo();
      for (const [l, rs] of Object.entries(d.dados as Record<string, Reg[]>)) for (const r of rs) await db.por(l, r);
      await carregar();
      casca.avisar("Dados restaurados.");
    } catch (e) {
      casca.avisar((e as Error).message, 6000);
    }
  };
  inp.click();
}

function exportarCSV() {
  if (tela.tipo !== "lista") return casca.avisar("Abra uma lista (clientes, itens, pedidos…) para exportar.");
  const e = ENT[tela.ent];
  const cols = e.campos;
  const q = (x: string) => (/[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  const rs = registrosFiltrados(e);
  const lin = rs.map((r) => [...cols.map((c) => (c.tipo === "moeda" || c.tipo === "numero" ? String(n(r[c.id])).replace(".", ",") : valorTexto(c, r[c.id]))), ...(e.total ? [String(e.total(r)).replace(".", ",")] : [])].map(q).join(";"));
  baixar(`﻿${[...cols.map((c) => c.nome), ...(e.total ? ["Total"] : [])].map(q).join(";")}\r\n${lin.join("\r\n")}`, e.nome, "csv", "text/csv");
}

// ---------- casca ----------

function renderizarConteudo() {
  if (tela.tipo === "lista") renderizarLista(ENT[tela.ent]);
  else if (tela.tipo === "painel") renderizarPainel();
  else if (tela.tipo === "saldos") renderizarSaldos();
  else if (tela.tipo === "kardex") renderizarKardex(tela.item);
  else if (tela.tipo === "mrp") renderizarMRP();
  else renderizarFluxo();
}

function renderizar() {
  renderizarMenu();
  const e = tela.tipo === "lista" ? ENT[tela.ent] : null;
  $("#er-titulo").textContent = e ? e.nome : { painel: "Painel", saldos: "Saldos de estoque", kardex: "Ficha do item (kardex)", mrp: "MRP — necessidades de materiais", fluxo: "Fluxo de caixa (12 semanas)" }[tela.tipo as string] ?? "";
  $("#er-novo").hidden = !e;
  busca.hidden = !(e || tela.tipo === "saldos");
  filtroEl.hidden = !e?.filtros;
  if (e?.filtros) {
    const v = filtroEl.value;
    filtroEl.innerHTML = e.filtros.map(([k, nm]) => `<option value="${k}">${nm}</option>`).join("");
    filtroEl.value = e.filtros.some(([k]) => k === v) ? v : "";
  }
  renderizarConteudo();
  casca.renderizar();
  casca.definirStatus(`${dados.itens.length} itens · ${dados.clientes.length} clientes · ${dados.fornecedores.length} fornecedores · ${dados.movimentos.length} movimentos`);
  casca.statusDireita.innerHTML = `<span>Dados neste aparelho</span>`;
}

const casca: Casca = new Casca({
  app: "WJERP",
  icone: "",
  extensao: "wjerp",
  nomeDoc: () => "Empresa",
  renomear: () => {},
  novo: () => (tela.tipo === "lista" ? abrirFicha(ENT[tela.ent]) : casca.avisar("Abra uma lista para incluir um registro.")),
  abrir: () => void importarCopia(),
  salvar: () => void exportarCopia(),
  abas: [
    {
      id: "inicio", rotulo: "Início", grupos: [
        [
          { id: "painel", rotulo: "Painel", icone: "painel", acao: () => ((tela = { tipo: "painel" }), renderizar()) },
          { id: "pv", rotulo: "Pedido de venda", icone: "venda", dica: "Novo pedido de venda", acao: () => ((tela = { tipo: "lista", ent: "vendas" }), renderizar(), abrirFicha(ENT.vendas)) },
          { id: "pc", rotulo: "Pedido de compra", icone: "compra", dica: "Novo pedido de compra", acao: () => ((tela = { tipo: "lista", ent: "compras" }), renderizar(), abrirFicha(ENT.compras)) },
          { id: "op", rotulo: "OP", icone: "producao", dica: "Nova ordem de produção", acao: () => ((tela = { tipo: "lista", ent: "ops" }), renderizar(), abrirFicha(ENT.ops)) },
        ],
        [
          { id: "mrp", rotulo: "MRP", icone: "estrutura", dica: "Calcular necessidades e gerar OPs/compras", acao: () => ((tela = { tipo: "mrp" }), renderizar()) },
          { id: "saldos", rotulo: "Saldos", icone: "estoque", acao: () => ((tela = { tipo: "saldos" }), renderizar()) },
          { id: "fluxo", rotulo: "Fluxo de caixa", icone: "grafico", acao: () => ((tela = { tipo: "fluxo" }), renderizar()) },
        ],
        [{ id: "pdm", rotulo: "Importar do WJPDM", icone: "importar", dica: "Traz itens e listas de materiais do cofre do WJPDM deste aparelho", acao: () => void importarDoPDM() }],
      ],
    },
    {
      id: "dados", rotulo: "Dados", grupos: [
        [
          { id: "csv", rotulo: "Exportar lista", icone: "exportar", dica: "Lista atual em CSV (abre no WJPlan)", acao: exportarCSV },
          { id: "copia", rotulo: "Cópia de segurança", icone: "salvar", acao: () => void exportarCopia() },
          { id: "rest", rotulo: "Restaurar cópia", icone: "abrir", acao: () => void importarCopia() },
        ],
        [{ id: "ex", rotulo: "Dados de exemplo", icone: "arquivo", acao: () => void dadosExemplo() }],
      ],
    },
  ],
});

async function carregar() {
  for (const l of LOJAS) dados[l] = await db.todos<Reg>(l);
  recalcularEstoque();
  renderizar();
}

void (async () => {
  try {
    db = await Armazem.abrir("wjerp", LOJAS);
  } catch {
    casca.avisar("Este navegador não permitiu o armazenamento local (IndexedDB).", 10000);
    return;
  }
  await carregar();
  void navigator.storage?.persist?.();
})();
registrarOffline();

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__erp = { dados, estoque: () => estoque, dadosExemplo, importarDoPDM };
