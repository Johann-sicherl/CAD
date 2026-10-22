// Painéis de cada recurso, campo a campo, conforme docs/funcional/features.md.

import type {
  Feature, FeatureChanfro, FeatureCasca, FeatureEixoRef, FeatureEspelhar, FeatureExtrusao, FeatureFilete,
  FeatureFuro, FeatureInclinacao, FeatureNervura, FeaturePadraoCircular, FeaturePadraoLinear, FeaturePlanoRef,
  FeatureRevolucao, TipoCondicao,
} from "../model";
import { FIXADORES, medidasFuro, notaFuro, TAMANHOS } from "../kernel/furos";
import type { Campo, Esquema } from "./formulario";

export interface DadosEsquema {
  esbocosAntes: [string, string][];
  recursosAntes: [string, string][]; // recursos que podem ser repetidos
  linhasEsboco(esbocoId: string | undefined): [string, string][];
  contornos(esbocoId: string | undefined): [string, string][];
  editarPosicoesFuro(f: FeatureFuro): void;
}

const CONDICOES: Record<TipoCondicao, string> = {
  cego: "Cego",
  passante: "Passante",
  passanteAmbos: "Passante nos dois sentidos",
  proximo: "Até o próximo",
  vertice: "Até o vértice",
  superficie: "Até a superfície",
  deslocSuperficie: "Deslocamento da superfície",
  planoMedio: "Plano médio",
};

function camposCondicao<F>(pref: string, ops: TipoCondicao[], profundidade: string): Campo<F>[] {
  const tipo = (f: F) => (pref.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], f) as { tipo: TipoCondicao } | undefined)?.tipo ?? "cego";
  return [
    { t: "sel", rot: "Condição final", cam: `${pref}.tipo`, opcoes: ops.map((o) => [o, CONDICOES[o]]) },
    { t: "num", rot: "Profundidade", cam: profundidade, un: "mm", min: 0.001, vis: (f) => tipo(f) === "cego" || tipo(f) === "planoMedio" },
    { t: "refs", rot: "Vértice", cam: `${pref}.ref`, aceita: ["vertice"], multiplo: false, vis: (f) => tipo(f) === "vertice" },
    { t: "refs", rot: "Face / plano", cam: `${pref}.ref`, aceita: ["face", "plano"], multiplo: false, vis: (f) => tipo(f) === "superficie" || tipo(f) === "deslocSuperficie" },
    { t: "num", rot: "Deslocamento", cam: `${pref}.dist`, un: "mm", min: 0, vis: (f) => tipo(f) === "deslocSuperficie" },
    { t: "inverter", rot: "Inverter deslocamento", cam: `${pref}.inverterDesloc`, vis: (f) => tipo(f) === "deslocSuperficie" },
  ];
}

const camposInclinacao = <F>(pref: string): Campo<F>[] => [
  { t: "check", rot: "Inclinação", cam: `${pref}.ativa` },
  { t: "num", rot: "Ângulo de inclinação", cam: `${pref}.angulo`, un: "°", min: 0, max: 89, vis: (f) => lerB(f, `${pref}.ativa`) },
  { t: "check", rot: "Inclinação para fora", cam: `${pref}.paraFora`, vis: (f) => lerB(f, `${pref}.ativa`) },
];

const lerB = (f: unknown, c: string) => !!c.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], f);

const camposFino = <F>(): Campo<F>[] => [
  { t: "sel", rot: "Tipo", cam: "fino.tipo", opcoes: [["uma", "Uma direção"], ["medio", "Plano médio"], ["duas", "Duas direções"]] },
  { t: "inverter", rot: "Inverter lado", cam: "fino.inverter", vis: (f) => (f as { fino?: { tipo: string } }).fino?.tipo === "uma" },
  { t: "num", rot: "Espessura T1", cam: "fino.t1", un: "mm", min: 0.001, passo: 0.5 },
  { t: "num", rot: "Espessura T2", cam: "fino.t2", un: "mm", min: 0.001, passo: 0.5, vis: (f) => (f as { fino?: { tipo: string } }).fino?.tipo === "duas" },
];

export function esquemaDe(f: Feature, d: DadosEsquema): Esquema<Feature> {
  switch (f.tipo) {
    case "extrusao":
      return extrusao(f.operacao === "cortar", d) as Esquema<Feature>;
    case "revolucao":
      return revolucao(f.operacao === "cortar", d) as Esquema<Feature>;
    case "filete":
      return filete() as Esquema<Feature>;
    case "chanfro":
      return chanfro() as Esquema<Feature>;
    case "casca":
      return casca() as Esquema<Feature>;
    case "inclinacao":
      return inclinacao() as Esquema<Feature>;
    case "nervura":
      return nervura(d) as Esquema<Feature>;
    case "furo":
      return furo(d) as Esquema<Feature>;
    case "padraoLinear":
      return padraoLinear(d) as Esquema<Feature>;
    case "padraoCircular":
      return padraoCircular(d) as Esquema<Feature>;
    case "espelhar":
      return espelhar(d) as Esquema<Feature>;
    case "planoRef":
      return planoRef() as Esquema<Feature>;
    case "eixoRef":
      return eixoRef() as Esquema<Feature>;
    case "esboco":
      return { titulo: "Esboço", caixas: [] };
  }
}

function extrusao(corte: boolean, d: DadosEsquema): Esquema<FeatureExtrusao> {
  const ops: TipoCondicao[] = corte
    ? ["cego", "passante", "passanteAmbos", "proximo", "vertice", "superficie", "deslocSuperficie", "planoMedio"]
    : ["cego", "proximo", "vertice", "superficie", "deslocSuperficie", "planoMedio"];
  const comEsboco = (f: FeatureExtrusao) => !!f.esboco;
  return {
    titulo: corte ? "Corte extrudado" : "Extrusão",
    caixas: [
      {
        titulo: "Perfil",
        campos: [
          { t: "sel", rot: "Esboço", cam: "esboco", opcoes: () => [...d.esbocosAntes, ["", "Perfil rápido (sem esboço)"]] },
          { t: "sel", rot: "Plano", cam: "plano", opcoes: [["XZ", "Plano Frontal"], ["XY", "Plano Superior"], ["YZ", "Plano Lateral"]], vis: (f) => !comEsboco(f) },
          { t: "num", rot: "Deslocamento do plano", cam: "deslocamento", un: "mm", vis: (f) => !comEsboco(f) },
          { t: "sel", rot: "Forma", cam: "perfil.tipo", opcoes: [["retangulo", "Retângulo"], ["circulo", "Círculo"], ["poligono", "Polígono"]], vis: (f) => !comEsboco(f),
            aoMudar: (f, v) => {
              f.perfil = v === "circulo" ? { tipo: "circulo", diametro: 40 } : v === "poligono" ? { tipo: "poligono", lados: 6, diametro: 40 } : { tipo: "retangulo", largura: 40, altura: 40, raioCanto: 0 };
            } },
          { t: "num", rot: "Largura", cam: "perfil.largura", un: "mm", min: 0.01, vis: (f) => !comEsboco(f) && f.perfil.tipo === "retangulo" },
          { t: "num", rot: "Altura", cam: "perfil.altura", un: "mm", min: 0.01, vis: (f) => !comEsboco(f) && f.perfil.tipo === "retangulo" },
          { t: "num", rot: "Raio dos cantos", cam: "perfil.raioCanto", un: "mm", min: 0, vis: (f) => !comEsboco(f) && f.perfil.tipo === "retangulo" },
          { t: "num", rot: "Diâmetro", cam: "perfil.diametro", un: "mm", min: 0.01, vis: (f) => !comEsboco(f) && f.perfil.tipo !== "retangulo" },
          { t: "num", rot: "Nº de lados", cam: "perfil.lados", min: 3, vis: (f) => !comEsboco(f) && f.perfil.tipo === "poligono" },
          { t: "num", rot: "Centro U", cam: "centroU", un: "mm", vis: (f) => !comEsboco(f) },
          { t: "num", rot: "Centro V", cam: "centroV", un: "mm", vis: (f) => !comEsboco(f) },
        ],
      },
      {
        titulo: "De",
        campos: [
          { t: "sel", rot: "Início", cam: "de.tipo", opcoes: [["plano", "Plano do esboço"], ["superficie", "Superfície/face/plano"], ["vertice", "Vértice"], ["deslocamento", "Deslocamento"]] },
          { t: "refs", rot: "Face / plano de início", cam: "de.ref", aceita: ["face", "plano"], multiplo: false, vis: (f) => f.de?.tipo === "superficie" },
          { t: "refs", rot: "Vértice de início", cam: "de.ref", aceita: ["vertice"], multiplo: false, vis: (f) => f.de?.tipo === "vertice" },
          { t: "num", rot: "Distância", cam: "de.dist", un: "mm", min: 0, vis: (f) => f.de?.tipo === "deslocamento" },
          { t: "inverter", rot: "Inverter", cam: "de.inverter", vis: (f) => f.de?.tipo === "deslocamento" },
        ],
      },
      {
        titulo: "Direção 1",
        campos: [
          // até vértice/superfície: o lado vem da própria referência, não precisa inverter
          { t: "inverter", rot: "Inverter direção", cam: "inverter", vis: (f) => !["passanteAmbos", "vertice", "superficie", "deslocSuperficie"].includes(f.condicao?.tipo ?? "") },
          ...camposCondicao<FeatureExtrusao>("condicao", ops, "profundidade"),
          ...(corte ? [{ t: "check", rot: "Inverter lado do corte", cam: "inverterLadoCorte" } as Campo<FeatureExtrusao>] : []),
          ...camposInclinacao<FeatureExtrusao>("inclinacao"),
        ],
      },
      {
        titulo: "Direção 2",
        opcional: "direcao2.ativa",
        vis: (f) => f.condicao?.tipo !== "planoMedio" && f.condicao?.tipo !== "passanteAmbos",
        campos: [
          ...camposCondicao<FeatureExtrusao>("direcao2.condicao", ops.filter((o) => o !== "planoMedio" && o !== "passanteAmbos"), "direcao2.condicao.dist"),
          ...camposInclinacao<FeatureExtrusao>("direcao2.inclinacao"),
        ],
      },
      { titulo: corte ? "Corte fino" : "Recurso fino", opcional: "fino.ativo", campos: camposFino<FeatureExtrusao>() },
      {
        titulo: "Contornos selecionados",
        vis: (f) => !!f.esboco && d.contornos(f.esboco).length > 1,
        campos: [
          { t: "info", texto: () => "Nenhum marcado = todos os contornos." },
          { t: "lista", rot: "Contornos", cam: "contornos", opcoes: (f) => d.contornos(f.esboco) },
        ],
      },
    ],
  };
}

function revolucao(corte: boolean, d: DadosEsquema): Esquema<FeatureRevolucao> {
  const com = (f: FeatureRevolucao) => !!f.esboco;
  return {
    titulo: corte ? "Corte por revolução" : "Revolução",
    caixas: [
      {
        titulo: "Perfil e eixo",
        campos: [
          { t: "sel", rot: "Esboço", cam: "esboco", opcoes: () => [...d.esbocosAntes, ["", "Perfil rápido (retângulo)"]] },
          { t: "sel", rot: "Eixo de revolução", cam: "eixo", vis: com,
            opcoes: (f) => [["", "1ª linha de construção (ou eixo V)"], ...d.linhasEsboco(f.esboco), ["eixo:X", "Eixo X"], ["eixo:Y", "Eixo Y"], ["eixo:Z", "Eixo Z"], ...(f.eixo && f.eixo.tipo !== "linhaEsboco" && f.eixo.tipo !== "eixo" ? [["modelo", "Aresta/face do modelo"] as [string, string]] : [])],
            valor: (f) => !f.eixo ? "" : f.eixo.tipo === "linhaEsboco" ? f.eixo.geo : f.eixo.tipo === "eixo" && ["X", "Y", "Z"].includes(f.eixo.id) ? `eixo:${f.eixo.id}` : "modelo",
            aoMudar: (f, v) => {
              if (!v) delete f.eixo;
              else if (v.startsWith("eixo:")) f.eixo = { tipo: "eixo", id: v.slice(5) };
              else if (v !== "modelo" && f.esboco) f.eixo = { tipo: "linhaEsboco", esboco: f.esboco, geo: v };
            } },
          { t: "refs", rot: "…ou aresta/eixo do modelo", cam: "eixo", aceita: ["aresta", "eixo", "face"], multiplo: false, vis: com },
          { t: "sel", rot: "Plano do perfil", cam: "plano", opcoes: [["XZ", "Plano Frontal"], ["XY", "Plano Superior"], ["YZ", "Plano Lateral"]], vis: (f) => !com(f) },
          { t: "num", rot: "Raio interno", cam: "raioInterno", un: "mm", min: 0, vis: (f) => !com(f) },
          { t: "num", rot: "Largura radial", cam: "largura", un: "mm", min: 0.01, vis: (f) => !com(f) },
          { t: "num", rot: "Altura", cam: "altura", un: "mm", min: 0.01, vis: (f) => !com(f) },
        ],
      },
      {
        titulo: "Direção 1",
        campos: [
          { t: "inverter", rot: "Inverter direção", cam: "inverter" },
          { t: "check", rot: "Plano médio", cam: "planoMedio" },
          { t: "num", rot: "Ângulo", cam: "angulo", un: "°", min: 0.1, max: 360, passo: 15 },
        ],
      },
      { titulo: "Direção 2", opcional: "direcao2.ativa", vis: (f) => !f.planoMedio, campos: [{ t: "num", rot: "Ângulo", cam: "direcao2.angulo", un: "°", min: 0.1, max: 360, passo: 15 }] },
      { titulo: "Recurso fino", opcional: "fino.ativo", vis: com, campos: camposFino<FeatureRevolucao>() },
      {
        titulo: "Contornos selecionados",
        vis: (f) => !!f.esboco && d.contornos(f.esboco).length > 1,
        campos: [{ t: "lista", rot: "Contornos", cam: "contornos", opcoes: (f) => d.contornos(f.esboco) }],
      },
    ],
  };
}

function filete(): Esquema<FeatureFilete> {
  return {
    titulo: "Filete",
    caixas: [
      { titulo: "Tipo de filete", campos: [{ t: "info", texto: () => "Tamanho constante (variável, de face e arredondamento completo: próximas versões)." }] },
      {
        titulo: "Itens a filetar",
        campos: [
          { t: "refs", rot: "Arestas e faces", cam: "itens", aceita: ["aresta", "face"], multiplo: true, dica: "Toque nas arestas (ou faces) no modelo" },
          { t: "check", rot: "Propagação tangente", cam: "propagarTangente" },
        ],
      },
      {
        titulo: "Parâmetros",
        campos: [
          { t: "sel", rot: "Tamanho", cam: "assimetrico", opcoes: [["simetrico", "Simétrico"], ["assimetrico", "Assimétrico"]], valor: (f) => (f.assimetrico ? "assimetrico" : "simetrico"), aoMudar: (f, v) => (f.assimetrico = v === "assimetrico") },
          { t: "num", rot: "Raio", cam: "raio", un: "mm", min: 0.001, passo: 0.5 },
          { t: "num", rot: "Distância 2", cam: "raio2", un: "mm", min: 0.001, passo: 0.5, vis: (f) => !!f.assimetrico },
          { t: "check", rot: "Filete de múltiplos raios", cam: "multiplosRaios", vis: (f) => !f.assimetrico },
          { t: "info", texto: (f) => (f.multiplosRaios ? "Raio por item: edite abaixo (vazio = raio padrão)." : ""), vis: (f) => !!f.multiplosRaios },
          ...Array.from({ length: 12 }, (_, i): Campo<FeatureFilete> => ({
            t: "num", rot: `Raio do item ${i + 1}`, cam: `raios.${i}`, un: "mm", min: 0.001, passo: 0.5,
            vis: (f) => !!f.multiplosRaios && !f.assimetrico && (f.itens?.length ?? 0) > i,
          })),
        ],
      },
    ],
  };
}

function chanfro(): Esquema<FeatureChanfro> {
  return {
    titulo: "Chanfro",
    caixas: [
      { titulo: "Tipo de chanfro", campos: [{ t: "sel", rot: "Tipo", cam: "modo", opcoes: [["distanciaDistancia", "Distância-distância"], ["anguloDistancia", "Ângulo-distância"]] }] },
      {
        titulo: "Itens a chanfrar",
        campos: [
          { t: "refs", rot: "Arestas e faces", cam: "itens", aceita: ["aresta", "face"], multiplo: true, dica: "Toque nas arestas (ou faces) no modelo" },
          { t: "check", rot: "Propagação tangente", cam: "propagarTangente" },
        ],
      },
      {
        titulo: "Parâmetros",
        campos: [
          { t: "check", rot: "Assimétrico", cam: "assimetrico", vis: (f) => f.modo !== "anguloDistancia" },
          { t: "num", rot: "Distância", cam: "distancia", un: "mm", min: 0.001, passo: 0.5 },
          { t: "num", rot: "Distância 2", cam: "distancia2", un: "mm", min: 0.001, passo: 0.5, vis: (f) => !!f.assimetrico && f.modo !== "anguloDistancia" },
          { t: "num", rot: "Ângulo", cam: "angulo", un: "°", min: 1, max: 89, vis: (f) => f.modo === "anguloDistancia" },
          { t: "inverter", rot: "Inverter direção", cam: "inverter", vis: (f) => f.modo === "anguloDistancia" || !!f.assimetrico },
        ],
      },
    ],
  };
}

function casca(): Esquema<FeatureCasca> {
  return {
    titulo: "Casca",
    caixas: [{
      titulo: "Parâmetros",
      campos: [
        { t: "num", rot: "Espessura", cam: "espessura", un: "mm", min: 0.001, passo: 0.5 },
        { t: "refs", rot: "Faces a remover", cam: "faces", aceita: ["face"], multiplo: true, dica: "Toque nas faces a abrir. Nenhuma = casca fechada: peça oca por dentro (veja com Vista de seção)" },
        { t: "check", rot: "Casca para fora", cam: "paraFora" },
      ],
    }],
  };
}

function inclinacao(): Esquema<FeatureInclinacao> {
  return {
    titulo: "Inclinação",
    caixas: [
      { titulo: "Tipo de inclinação", campos: [{ t: "info", texto: () => "Plano neutro." }] },
      { titulo: "Ângulo de inclinação", campos: [{ t: "num", rot: "Ângulo", cam: "angulo", un: "°", min: 0.1, max: 45 }] },
      { titulo: "Plano neutro", campos: [
        { t: "refs", rot: "Plano / face", cam: "planoNeutro", aceita: ["face", "plano"], multiplo: false, cor: "azul" },
        { t: "inverter", rot: "Inverter direção de extração", cam: "inverter" },
      ] },
      { titulo: "Faces a inclinar", campos: [{ t: "refs", rot: "Faces", cam: "faces", aceita: ["face"], multiplo: true }] },
    ],
  };
}

function nervura(d: DadosEsquema): Esquema<FeatureNervura> {
  return {
    titulo: "Nervura",
    caixas: [{
      titulo: "Parâmetros",
      campos: [
        { t: "sel", rot: "Esboço (perfil aberto)", cam: "esboco", opcoes: () => [["", "—"], ...d.esbocosAntes] },
        { t: "sel", rot: "Espessura", cam: "lado", opcoes: [["primeiro", "Primeiro lado"], ["ambos", "Ambos os lados"], ["segundo", "Segundo lado"]] },
        { t: "num", rot: "Espessura", cam: "espessura", un: "mm", min: 0.001, passo: 0.5 },
        { t: "sel", rot: "Direção da extrusão", cam: "direcao", opcoes: [["normal", "Normal ao esboço"], ["paralela", "Paralela ao esboço"]] },
        { t: "inverter", rot: "Inverter lado do material", cam: "inverterMaterial" },
      ],
    }],
  };
}

function furo(d: DadosEsquema): Esquema<FeatureFuro> {
  const tipos: [string, string][] = [["simples", "Furo"], ["rebaixado", "Rebaixado"], ["escareado", "Escareado"], ["roscado", "Furo roscado"]];
  return {
    titulo: "Furo assistido",
    abas: ["Tipo", "Posições"],
    caixas: [
      { titulo: "Tipo de furo", aba: "Tipo", campos: [
        { t: "sel", rot: "Tipo", cam: "tipoFuro", opcoes: tipos, aoMudar: (f, v) => { f.tipoFuro = v as FeatureFuro["tipoFuro"]; f.fixador = FIXADORES[f.tipoFuro][0]; } },
        { t: "sel", rot: "Norma", cam: "norma", opcoes: [["ISO", "ISO"]] },
        { t: "sel", rot: "Tipo de fixador", cam: "fixador", opcoes: (f) => FIXADORES[f.tipoFuro].map((x) => [x, x]) },
      ] },
      { titulo: "Especificações do furo", aba: "Tipo", campos: [
        { t: "sel", rot: "Tamanho", cam: "tamanho", opcoes: TAMANHOS.map((t) => [t, t]) },
        { t: "sel", rot: "Ajuste", cam: "ajuste", opcoes: [["apertado", "Apertado"], ["normal", "Normal"], ["folgado", "Folgado"]], vis: (f) => f.tipoFuro !== "roscado" },
        { t: "info", texto: (f) => notaFuro(f) },
      ] },
      { titulo: "Dimensionamento personalizado", aba: "Tipo", opcional: "personalizado.ativo", campos: [
        { t: "num", rot: "Ø do furo", cam: "personalizado.diametro", un: "mm", min: 0.1, passo: 0.1 },
        { t: "num", rot: "Ø do rebaixo", cam: "personalizado.diamRebaixo", un: "mm", min: 0.1, vis: (f) => f.tipoFuro === "rebaixado" },
        { t: "num", rot: "Profundidade do rebaixo", cam: "personalizado.profRebaixo", un: "mm", min: 0.1, vis: (f) => f.tipoFuro === "rebaixado" },
        { t: "num", rot: "Ø do escareado", cam: "personalizado.diamEscareado", un: "mm", min: 0.1, vis: (f) => f.tipoFuro === "escareado" },
        { t: "num", rot: "Ângulo do escareado", cam: "personalizado.anguloEscareado", un: "°", min: 30, max: 150, vis: (f) => f.tipoFuro === "escareado" },
      ] },
      { titulo: "Condição final", aba: "Tipo", campos: [
        { t: "sel", rot: "Condição", cam: "condicao.tipo", opcoes: [["cego", "Cego"], ["passante", "Passante"], ["proximo", "Até o próximo"]] },
        { t: "num", rot: "Profundidade", cam: "condicao.profundidade", un: "mm", min: 0.1, vis: (f) => f.condicao.tipo === "cego" },
        { t: "num", rot: "Ângulo da ponta", cam: "condicao.anguloPonta", un: "°", min: 60, max: 180, vis: (f) => f.condicao.tipo === "cego" },
      ] },
      { titulo: "Rosca", aba: "Tipo", vis: (f) => f.tipoFuro === "roscado", campos: [
        { t: "num", rot: "Profundidade da rosca", cam: "rosca.profundidade", un: "mm", min: 0.1 },
        { t: "check", rot: "Rosca cosmética", cam: "rosca.cosmetica" },
        { t: "check", rot: "Remover rosca (Ø nominal)", cam: "rosca.removerRosca" },
      ] },
      { titulo: "Opções", aba: "Tipo", vis: (f) => f.tipoFuro !== "escareado", campos: [
        { t: "check", rot: "Escareado no lado próximo", cam: "escareadoProximo.ativo" },
        { t: "num", rot: "Ø", cam: "escareadoProximo.diametro", un: "mm", min: 0.1, vis: (f) => !!f.escareadoProximo?.ativo },
        { t: "num", rot: "Ângulo", cam: "escareadoProximo.angulo", un: "°", min: 30, max: 150, vis: (f) => !!f.escareadoProximo?.ativo },
      ] },
      { titulo: "Posições", aba: "Posições", campos: [
        { t: "info", texto: () => "Os furos ficam nos pontos de um esboço sobre a face. Abra o esboço, toque para cada furo e cote as posições." },
        { t: "info", texto: (f) => `Ø efetivo ${medidasFuro(f).diametro.toLocaleString("pt-BR")} mm` },
        { t: "botao", rot: "Editar posições (esboço)", acao: (f) => d.editarPosicoesFuro(f), destaque: true },
      ] },
    ],
  };
}

function dirPadrao<F>(pref: string): Campo<F>[] {
  return [
    { t: "refs", rot: "Direção (aresta, eixo, plano)", cam: `${pref}.ref`, aceita: ["aresta", "eixo", "plano", "face"], multiplo: false, cor: "azul" },
    { t: "inverter", rot: "Inverter direção", cam: `${pref}.inverter` },
    { t: "num", rot: "Espaçamento", cam: `${pref}.espacamento`, un: "mm", min: 0.001 },
    { t: "num", rot: "Nº de instâncias", cam: `${pref}.instancias`, min: 1, max: 200 },
  ];
}

function padraoLinear(d: DadosEsquema): Esquema<FeaturePadraoLinear> {
  return {
    titulo: "Padrão linear",
    caixas: [
      { titulo: "Direção 1", campos: dirPadrao<FeaturePadraoLinear>("dir1") },
      { titulo: "Direção 2", opcional: "dir2.ativa", campos: [...dirPadrao<FeaturePadraoLinear>("dir2"), { t: "check", rot: "Padronizar somente a semente", cam: "dir2.somenteSemente" }] },
      { titulo: "Recursos e faces", campos: [{ t: "lista", rot: "Recursos a padronizar", cam: "recursos", opcoes: () => d.recursosAntes }] },
      { titulo: "Instâncias a pular", campos: [{ t: "lista", rot: "Pular", cam: "pular", opcoes: (f) => {
        const out: [string, string][] = [];
        const n1 = Math.min(30, Math.round(f.dir1.instancias)), n2 = f.dir2?.ativa ? Math.min(30, Math.round(f.dir2.instancias)) : 1;
        for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) if (i || j) out.push([`${i},${j}`, n2 > 1 ? `(${i + 1}, ${j + 1})` : `Instância ${i + 1}`]);
        return out;
      } }] },
    ],
  };
}

function padraoCircular(d: DadosEsquema): Esquema<FeaturePadraoCircular> {
  return {
    titulo: "Padrão circular",
    caixas: [
      { titulo: "Direção 1", campos: [
        { t: "refs", rot: "Eixo (eixo, aresta circular, face cilíndrica)", cam: "eixo", aceita: ["eixo", "aresta", "face"], multiplo: false, cor: "azul" },
        { t: "inverter", rot: "Inverter direção", cam: "inverter" },
        { t: "check", rot: "Espaçamento igual", cam: "igual" },
        { t: "num", rot: "Ângulo", cam: "angulo", un: "°", min: 0.1, max: 360, passo: 15 },
        { t: "num", rot: "Nº de instâncias", cam: "instancias", min: 1, max: 360 },
        { t: "info", texto: (f) => (f.igual ? "Ângulo = total ocupado pelas instâncias." : "Ângulo = entre uma instância e a próxima.") },
      ] },
      { titulo: "Recursos e faces", campos: [{ t: "lista", rot: "Recursos a padronizar", cam: "recursos", opcoes: () => d.recursosAntes }] },
      { titulo: "Instâncias a pular", campos: [{ t: "lista", rot: "Pular", cam: "pular", opcoes: (f) =>
        Array.from({ length: Math.max(0, Math.min(60, Math.round(f.instancias)) - 1) }, (_, i): [string, string] => [String(i + 1), `Instância ${i + 2}`]) }] },
    ],
  };
}

function espelhar(d: DadosEsquema): Esquema<FeatureEspelhar> {
  return {
    titulo: "Espelhar",
    caixas: [
      { titulo: "Face / plano de espelho", campos: [{ t: "refs", rot: "Plano", cam: "plano", aceita: ["plano", "face"], multiplo: false, cor: "azul" }] },
      { titulo: "Recursos a espelhar", vis: (f) => !f.corpo, campos: [{ t: "lista", rot: "Recursos", cam: "recursos", opcoes: () => d.recursosAntes }] },
      { titulo: "Corpos a espelhar", campos: [{ t: "check", rot: "Espelhar a peça inteira (mesclar sólidos)", cam: "corpo" }] },
    ],
  };
}

function planoRef(): Esquema<FeaturePlanoRef> {
  return {
    titulo: "Plano",
    caixas: [
      { titulo: "Primeira referência", campos: [
        { t: "refs", rot: "Plano / face", cam: "ref1", aceita: ["plano", "face"], multiplo: false },
        { t: "sel", rot: "Restrição", cam: "modo", opcoes: [["deslocamento", "Distância (paralelo)"], ["angulo", "Ângulo (em torno de eixo)"], ["medio", "Plano médio"]] },
        { t: "num", rot: "Distância", cam: "distancia", un: "mm", vis: (f) => f.modo === "deslocamento" },
        { t: "num", rot: "Ângulo", cam: "angulo", un: "°", vis: (f) => f.modo === "angulo", passo: 15 },
        { t: "inverter", rot: "Inverter", cam: "inverter", vis: (f) => f.modo !== "medio" },
      ] },
      { titulo: "Segunda referência", vis: (f) => f.modo !== "deslocamento", campos: [
        { t: "refs", rot: "Eixo/aresta (ângulo) ou 2º plano (médio)", cam: "ref2", aceita: ["plano", "face", "eixo", "aresta"], multiplo: false },
      ] },
    ],
  };
}

function eixoRef(): Esquema<FeatureEixoRef> {
  return {
    titulo: "Eixo",
    caixas: [{
      titulo: "Seleções",
      campos: [
        { t: "sel", rot: "Tipo", cam: "modo", opcoes: [["aresta", "Uma linha/aresta/eixo"], ["cilindro", "Face cilíndrica/cônica"], ["doisPlanos", "Dois planos"], ["doisPontos", "Dois pontos/vértices"]] },
        { t: "refs", rot: "Referência 1", cam: "ref1", aceita: ["aresta", "face", "plano", "vertice", "eixo"], multiplo: false },
        { t: "refs", rot: "Referência 2", cam: "ref2", aceita: ["plano", "face", "vertice"], multiplo: false, vis: (f) => f.modo === "doisPlanos" || f.modo === "doisPontos" },
      ],
    }],
  };
}
