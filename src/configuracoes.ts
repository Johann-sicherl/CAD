// Configurações da peça: variações dentro do mesmo arquivo (ex.: moldura curta/longa).
// Os valores "ao vivo" nos recursos são os da configuração ativa. Cada configuração guarda só
// os parâmetros escolhidos na tabela (cotas de esboço e valores de recursos) e quais recursos
// ficam suprimidos nela. Trocar de configuração guarda os valores atuais na que sai e aplica
// os da que entra. Lógica pura (testada em Node); a janela fica em main.ts.

import { ehCota, novoId, type Documento, type Feature, type FeatureEsboco, type FeatureExtrusao, type FeatureRevolucao } from "./model";

export interface Configuracao {
  id: string;
  nome: string;
  /** Valor de cada parâmetro configurado (chave → valor). */
  valores: Record<string, number>;
  /** Recursos suprimidos nesta configuração. */
  suprimidos: string[];
}

/** Valores de recurso que podem variar (e aparecem como cotas no modelo): [caminho, rótulo, unidade, visível?]. */
export const PARAMETROS_RECURSO: Partial<Record<Feature["tipo"], [string, string, string, ((f: never) => boolean)?][]>> = {
  extrusao: [
    ["profundidade", "D1", "mm", (f: FeatureExtrusao) => !f.condicao || f.condicao.tipo === "cego" || f.condicao.tipo === "planoMedio"],
    ["direcao2.condicao.dist", "D2", "mm", (f: FeatureExtrusao) => !!f.direcao2?.ativa && f.direcao2.condicao.tipo === "cego"],
  ],
  revolucao: [["angulo", "Ângulo", "°"], ["direcao2.angulo", "Ângulo 2", "°", (f: FeatureRevolucao) => !!f.direcao2?.ativa]],
  filete: [["raio", "R", "mm"]],
  chanfro: [["distancia", "D", "mm"]],
  casca: [["espessura", "Espessura", "mm"]],
  inclinacao: [["angulo", "Inclinação", "°"]],
  nervura: [["espessura", "Espessura", "mm"]],
  furo: [["condicao.profundidade", "Profundidade", "mm"]],
  padraoLinear: [["dir1.espacamento", "Espaçamento", "mm"], ["dir1.instancias", "Instâncias", ""]],
  padraoCircular: [["angulo", "Ângulo", "°"], ["instancias", "Instâncias", ""]],
  planoRef: [["distancia", "Distância", "mm"]],
  dobraEsboco: [["angulo", "Ângulo", "°"]],
  junta: [["deslocamento", "Deslocamento", "mm"], ["angulo", "Ângulo", "°"]],
  flangeAresta: [["angulo", "Ângulo", "°"], ["comprimento", "Comprimento", "mm"]],
  curva: [["passo", "Passo", "mm"], ["revolucoes", "Revoluções", ""], ["altura", "Altura", "mm"]],
};

export interface Parametro {
  /** `idRecurso.caminho` (como nas equações) ou `idEsboço#idCota`. */
  chave: string;
  rotulo: string;
  unidade: string;
  valor: number;
}

const lerCaminho = (o: unknown, cam: string): unknown => cam.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
function gravarCaminho(o: Record<string, unknown>, cam: string, v: unknown) {
  const partes = cam.split(".");
  const ult = partes.pop()!;
  let x = o;
  for (const k of partes) x = (x[k] ??= {}) as Record<string, unknown>;
  x[ult] = v;
}

/** Todos os parâmetros que podem entrar na tabela: cotas dos esboços e valores dos recursos. */
export function listarParametros(doc: Documento): Parametro[] {
  const out: Parametro[] = [];
  for (const f of doc.features) {
    if (f.tipo === "esboco") {
      let n = 0;
      for (const r of f.restricoes) {
        if (!ehCota(r) || r.referencia) continue;
        n++;
        out.push({ chave: `${f.id}#${r.id}`, rotulo: `D${n}@${f.nome}`, unidade: r.tipo === "angulo" ? "°" : "mm", valor: r.valor });
      }
      continue;
    }
    for (const [cam, rot, un, vis] of PARAMETROS_RECURSO[f.tipo] ?? []) {
      if (vis && !vis(f as never)) continue;
      const v = lerCaminho(f, cam);
      if (typeof v === "number") out.push({ chave: `${f.id}.${cam}`, rotulo: `${rot}@${f.nome}`, unidade: un, valor: v });
    }
  }
  return out;
}

/** Valor atual (ao vivo) de um parâmetro, ou undefined se ele não existe mais. */
export function lerParametro(doc: Documento, chave: string): number | undefined {
  const cota = chave.indexOf("#");
  if (cota > 0) {
    const e = doc.features.find((f): f is FeatureEsboco => f.id === chave.slice(0, cota) && f.tipo === "esboco");
    const r = e?.restricoes.find((x) => x.id === chave.slice(cota + 1));
    return r && ehCota(r) ? r.valor : undefined;
  }
  const i = chave.indexOf(".");
  const f = doc.features.find((x) => x.id === chave.slice(0, i));
  const v = f && lerCaminho(f, chave.slice(i + 1));
  return typeof v === "number" ? v : undefined;
}

/** Grava o valor ao vivo. Devolve o id do esboço quando era uma cota (precisa ser resolvido). */
export function gravarParametro(doc: Documento, chave: string, v: number): string | null {
  const cota = chave.indexOf("#");
  if (cota > 0) {
    const e = doc.features.find((f): f is FeatureEsboco => f.id === chave.slice(0, cota) && f.tipo === "esboco");
    const r = e?.restricoes.find((x) => x.id === chave.slice(cota + 1));
    if (!e || !r || !ehCota(r) || Math.abs(r.valor - v) < 1e-12) return null;
    r.valor = v;
    delete r.expr; // valor da configuração manda (equação no mesmo parâmetro brigaria com ela)
    return e.id;
  }
  const i = chave.indexOf(".");
  const f = doc.features.find((x) => x.id === chave.slice(0, i));
  if (f) gravarCaminho(f as unknown as Record<string, unknown>, chave.slice(i + 1), v);
  return null;
}

/** Garante a lista (com "Padrão" ativa) e devolve a configuração ativa. */
export function prepararConfiguracoes(doc: Documento): Configuracao {
  if (!doc.configuracoes?.length) {
    doc.configuracoes = [{ id: novoId(), nome: "Padrão", valores: {}, suprimidos: doc.features.filter((f) => f.suprimida).map((f) => f.id) }];
  }
  doc.parametrosConfigurados ??= [];
  let ativa = doc.configuracoes.find((c) => c.id === doc.configAtiva);
  if (!ativa) {
    ativa = doc.configuracoes[0];
    doc.configAtiva = ativa.id;
  }
  return ativa;
}

/** Guarda na configuração ativa os valores ao vivo dos parâmetros configurados e as supressões. */
export function capturarAtiva(doc: Documento) {
  if (!doc.configuracoes?.length) return;
  const ativa = prepararConfiguracoes(doc);
  for (const k of doc.parametrosConfigurados ?? []) {
    const v = lerParametro(doc, k);
    if (v !== undefined) ativa.valores[k] = v;
  }
  ativa.suprimidos = doc.features.filter((f) => f.suprimida).map((f) => f.id);
}

/**
 * Ativa a configuração: guarda a atual, aplica valores e supressões da nova. Devolve os esboços
 * cujas cotas mudaram (o app resolve de novo antes de reconstruir).
 */
export function ativarConfiguracao(doc: Documento, id: string): string[] {
  capturarAtiva(doc);
  const c = doc.configuracoes?.find((x) => x.id === id);
  if (!c) return [];
  doc.configAtiva = id;
  const alterados = new Set<string>();
  for (const k of doc.parametrosConfigurados ?? []) {
    const v = c.valores[k];
    if (v === undefined) continue;
    const e = gravarParametro(doc, k, v);
    if (e) alterados.add(e);
  }
  for (const f of doc.features) f.suprimida = c.suprimidos.includes(f.id);
  return [...alterados];
}

/** Nova configuração copiando a ativa (valores e supressões). */
export function novaConfiguracao(doc: Documento, nome: string): Configuracao {
  const base = prepararConfiguracoes(doc);
  capturarAtiva(doc);
  const c: Configuracao = { id: novoId(), nome, valores: { ...base.valores }, suprimidos: [...base.suprimidos] };
  doc.configuracoes!.push(c);
  return c;
}

/** Passa a variar o parâmetro: todas as configurações começam com o valor atual. */
export function configurarParametro(doc: Documento, chave: string) {
  prepararConfiguracoes(doc);
  if (doc.parametrosConfigurados!.includes(chave)) return;
  const v = lerParametro(doc, chave);
  if (v === undefined) return;
  doc.parametrosConfigurados!.push(chave);
  // equação no mesmo valor brigaria com a configuração: o valor da tabela passa a mandar
  if (doc.equacoes) delete doc.equacoes[chave];
  for (const c of doc.configuracoes!) c.valores[chave] ??= v;
}

/** Deixa de variar: o valor atual (da configuração ativa) passa a valer para todas. */
export function desconfigurarParametro(doc: Documento, chave: string) {
  doc.parametrosConfigurados = (doc.parametrosConfigurados ?? []).filter((k) => k !== chave);
  for (const c of doc.configuracoes ?? []) delete c.valores[chave];
}

/** Valor de um parâmetro numa configuração (a ativa lê ao vivo). */
export function valorNaConfiguracao(doc: Documento, c: Configuracao, chave: string): number | undefined {
  return c.id === doc.configAtiva ? lerParametro(doc, chave) : c.valores[chave];
}

/**
 * Muda o valor numa configuração. Na ativa, muda ao vivo (devolve o esboço a resolver, se for
 * cota); nas outras, só guarda.
 */
export function definirValorNaConfiguracao(doc: Documento, c: Configuracao, chave: string, v: number): string | null {
  c.valores[chave] = v;
  return c.id === doc.configAtiva ? gravarParametro(doc, chave, v) : null;
}

/** Suprime/reativa um recurso numa configuração (na ativa, ao vivo). */
export function definirSupressao(doc: Documento, c: Configuracao, idRecurso: string, suprimido: boolean) {
  c.suprimidos = c.suprimidos.filter((x) => x !== idRecurso);
  if (suprimido) c.suprimidos.push(idRecurso);
  if (c.id === doc.configAtiva) {
    const f = doc.features.find((x) => x.id === idRecurso);
    if (f) f.suprimida = suprimido;
  }
}

/** Remove a configuração (a última não pode). Se era a ativa, ativa a primeira restante. */
export function excluirConfiguracao(doc: Documento, id: string): string[] {
  const cs = doc.configuracoes ?? [];
  if (cs.length <= 1) return [];
  const eraAtiva = doc.configAtiva === id;
  doc.configuracoes = cs.filter((c) => c.id !== id);
  if (!eraAtiva) return [];
  doc.configAtiva = undefined;
  const primeira = doc.configuracoes[0];
  // aplica a primeira sem capturar a removida
  doc.configAtiva = primeira.id;
  const alterados: string[] = [];
  for (const k of doc.parametrosConfigurados ?? []) {
    const v = primeira.valores[k];
    if (v === undefined) continue;
    const e = gravarParametro(doc, k, v);
    if (e && !alterados.includes(e)) alterados.push(e);
  }
  for (const f of doc.features) f.suprimida = primeira.suprimidos.includes(f.id);
  return alterados;
}

/** Tira das configurações referências a recursos/cotas que não existem mais. */
export function limparConfiguracoes(doc: Documento) {
  if (!doc.configuracoes) return;
  const ids = new Set(doc.features.map((f) => f.id));
  doc.parametrosConfigurados = (doc.parametrosConfigurados ?? []).filter((k) => lerParametro(doc, k) !== undefined);
  for (const c of doc.configuracoes) {
    c.suprimidos = c.suprimidos.filter((x) => ids.has(x));
    for (const k of Object.keys(c.valores)) if (!doc.parametrosConfigurados.includes(k)) delete c.valores[k];
  }
}
