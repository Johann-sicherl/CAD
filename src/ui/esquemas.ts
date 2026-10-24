// Painéis de cada recurso, campo a campo, conforme docs/funcional/features.md.

import type {
  Feature, FeatureChanfro, FeatureCasca, FeatureCurva, FeatureEixoRef, FeatureEspelhar, FeatureExtrusao, FeatureFilete,
  FeatureFuro, FeatureInclinacao, FeatureNervura, FeaturePadraoCircular, FeaturePadraoLinear, FeaturePlanoRef,
  FeatureRevolucao, FeatureVarredura, FeatureLoft, RestricaoLoft, TipoCondicao,
  FeatureFlangeBase, FeatureFlangeAresta, FeatureBainha, FeatureAbaChapa,
} from "../model";
import { TABELA_CHAPA } from "../model";
import { FIXADORES, medidasFuro, notaFuro, TAMANHOS } from "../kernel/furos";
import type { Caixa, Campo, Esquema } from "./formulario";

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
    case "varredura":
      return varredura(f.operacao === "cortar") as Esquema<Feature>;
    case "loft":
      return loft(f.operacao === "cortar") as Esquema<Feature>;
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
    case "curva":
      return curva(f) as Esquema<Feature>;
    case "flangeBase":
      return flangeBase(d) as Esquema<Feature>;
    case "flangeAresta":
      return flangeAresta() as Esquema<Feature>;
    case "bainha":
      return bainha() as Esquema<Feature>;
    case "abaChapa":
    case "corteChapa":
      return abaChapa(f.tipo === "corteChapa", d) as Esquema<Feature>;
    case "esboco":
      return { titulo: "Esboço", caixas: [] };
  }
}

// ---------- chapa metálica (docs/funcional/chapa.md) ----------

const POSICOES: [string, string][] = [["materialInterno", "Material interno"], ["materialExterno", "Material externo"], ["dobraExterna", "Dobra externa"]];

function flangeBase(d: DadosEsquema): Esquema<FeatureFlangeBase> {
  const aberto = (f: FeatureFlangeBase) => !!f.esboco && d.contornos(f.esboco).length === 0;
  return {
    titulo: "Flange base",
    caixas: [
      { titulo: "Perfil", campos: [
        { t: "sel", rot: "Esboço", cam: "esboco", opcoes: () => [["", "—"], ...d.esbocosAntes] },
        { t: "info", texto: (f) => (!f.esboco ? "Esboço fechado vira placa; aberto (só linhas) vira perfil dobrado." : aberto(f) ? "Perfil aberto: as linhas viram paredes e os cantos viram dobras." : "Perfil fechado: placa plana.") },
      ] },
      { titulo: "Direção 1", vis: aberto, campos: [
        { t: "sel", rot: "Condição final", cam: "planoMedio", opcoes: [["cego", "Cego"], ["medio", "Plano médio"]], valor: (f) => (f.planoMedio ? "medio" : "cego"), aoMudar: (f, v) => (f.planoMedio = v === "medio") },
        { t: "inverter", rot: "Inverter direção", cam: "inverterDirecao", vis: (f) => !f.planoMedio },
        { t: "num", rot: "Profundidade", cam: "profundidade", un: "mm", min: 0.001 },
      ] },
      { titulo: "Bitolas de chapa", campos: [
        { t: "sel", rot: "Tabela", cam: "tabela",
          opcoes: [["", "Personalizado"], ...TABELA_CHAPA.map((l): [string, string] => [`${l.material}|${l.espessura}`, `${l.material} — ${l.espessura} mm (R${l.raio}, K ${l.k})`])],
          // valores mexidos à mão: a tabela mostra "Personalizado"
          valor: (f) => {
            const l = TABELA_CHAPA.find((x) => `${x.material}|${x.espessura}` === f.tabela);
            return l && l.espessura === f.espessura && l.raio === f.raio && l.k === f.fatorK ? f.tabela : "";
          },
          aoMudar: (f, v) => {
            f.tabela = v;
            const l = TABELA_CHAPA.find((x) => `${x.material}|${x.espessura}` === v);
            if (l) {
              f.espessura = l.espessura;
              f.raio = l.raio;
              f.fatorK = l.k;
            }
          } },
      ] },
      { titulo: "Parâmetros de chapa", campos: [
        { t: "num", rot: "Espessura", cam: "espessura", un: "mm", min: 0.01, passo: 0.1 },
        { t: "inverter", rot: "Inverter direção (lado do material)", cam: "inverter" },
        { t: "num", rot: "Raio de dobra", cam: "raio", un: "mm", min: 0.01, passo: 0.5 },
      ] },
      { titulo: "Margem de dobra", campos: [
        { t: "info", texto: () => "Fator K (margem = ângulo × (R + K·t))." },
        { t: "num", rot: "Fator K", cam: "fatorK", min: 0, max: 1, passo: 0.01 },
      ] },
      { titulo: "Alívio automático", campos: [{ t: "info", texto: () => "Retangular, largura = espessura, nas pontas de flanges parciais." }] },
    ],
  };
}

function flangeAresta(): Esquema<FeatureFlangeAresta> {
  return {
    titulo: "Flange de aresta",
    caixas: [
      { titulo: "Parâmetros da flange", campos: [
        { t: "refs", rot: "Arestas", cam: "arestas", aceita: ["aresta"], multiplo: true, dica: "Toque nas arestas retas compridas da chapa (face de cima ou de baixo)" },
        { t: "check", rot: "Usar raio próprio", cam: "raioProprio" },
        { t: "num", rot: "Raio de dobra", cam: "raio", un: "mm", min: 0.01, passo: 0.5, vis: (f) => f.raioProprio },
      ] },
      { titulo: "Ângulo", campos: [{ t: "num", rot: "Ângulo da flange", cam: "angulo", un: "°", min: 0.1, max: 180 }] },
      { titulo: "Comprimento da flange", campos: [
        { t: "inverter", rot: "Inverter direção", cam: "inverter" },
        { t: "num", rot: "Comprimento", cam: "comprimento", un: "mm", min: 0.001 },
        { t: "sel", rot: "Medição", cam: "medicao", opcoes: [["externoVirtual", "Externo virtual"], ["internoVirtual", "Interno virtual"], ["tangente", "Tangente à dobra"]] },
      ] },
      { titulo: "Posição da flange", campos: [{ t: "sel", rot: "Posição", cam: "posicao", opcoes: POSICOES }] },
      { titulo: "Deslocamentos (largura parcial)", campos: [
        { t: "num", rot: "Do início da aresta", cam: "deslocInicio", un: "mm", min: 0 },
        { t: "num", rot: "Do fim da aresta", cam: "deslocFim", un: "mm", min: 0 },
        { t: "info", texto: (f) => (f.deslocInicio > 0 || f.deslocFim > 0 ? "Flange parcial: alívio retangular automático nas pontas." : "") },
      ] },
    ],
  };
}

function bainha(): Esquema<FeatureBainha> {
  return {
    titulo: "Bainha",
    caixas: [
      { titulo: "Arestas", campos: [
        { t: "refs", rot: "Arestas", cam: "arestas", aceita: ["aresta"], multiplo: true, dica: "Toque nas arestas retas da chapa" },
        { t: "inverter", rot: "Inverter direção", cam: "inverter" },
        { t: "sel", rot: "Posição", cam: "posicao", opcoes: [["materialInterno", "Material interno"], ["materialExterno", "Material externo"]] },
      ] },
      { titulo: "Tipo e tamanho", campos: [
        { t: "sel", rot: "Tipo", cam: "estilo", opcoes: [["fechada", "Fechada"], ["aberta", "Aberta"], ["enrolada", "Enrolada"]] },
        { t: "num", rot: "Comprimento", cam: "comprimento", un: "mm", min: 0.001, vis: (f) => f.estilo !== "enrolada" },
        { t: "num", rot: "Folga", cam: "folga", un: "mm", min: 0.001, passo: 0.1, vis: (f) => f.estilo === "aberta" },
        { t: "num", rot: "Ângulo", cam: "angulo", un: "°", min: 1, max: 359, vis: (f) => f.estilo === "enrolada" },
        { t: "num", rot: "Raio", cam: "raio", un: "mm", min: 0.01, passo: 0.5, vis: (f) => f.estilo === "enrolada" },
      ] },
    ],
  };
}

function abaChapa(corte: boolean, d: DadosEsquema): Esquema<FeatureAbaChapa> {
  return {
    titulo: corte ? "Corte na chapa" : "Aba",
    caixas: [{ titulo: "Perfil", campos: [
      { t: "sel", rot: "Esboço", cam: "esboco", opcoes: () => [["", "—"], ...d.esbocosAntes] },
      { t: "info", texto: () => corte
        ? "Esboço fechado numa face plana da chapa: corta através da espessura (normal à chapa) e aparece no planificado."
        : "Esboço fechado numa face plana da chapa, encostado na borda: vira aba com a mesma espessura." },
    ] }],
  };
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
          { t: "sel", rot: "Plano", cam: "plano", opcoes: [["XY", "Plano Frontal"], ["XZ", "Plano Superior"], ["YZ", "Plano Lateral"]], vis: (f) => !comEsboco(f) },
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
          { t: "sel", rot: "Plano do perfil", cam: "plano", opcoes: [["XY", "Plano Frontal"], ["XZ", "Plano Superior"], ["YZ", "Plano Lateral"]], vis: (f) => !com(f) },
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

/** Varredura / corte por varredura: docs/funcional/features.md §4. */
function varredura(corte: boolean): Esquema<FeatureVarredura> {
  const deEsboco = (f: FeatureVarredura) => f.tipoPerfil === "esboco";
  return {
    titulo: corte ? "Corte por varredura" : "Varredura",
    caixas: [
      {
        titulo: "Perfil e trajetória",
        campos: [
          { t: "sel", rot: "Tipo de perfil", cam: "tipoPerfil", opcoes: [["esboco", "Perfil de esboço"], ["circular", "Perfil circular"]] },
          { t: "refs", rot: "Perfil", cam: "perfil", aceita: ["esboco"], multiplo: false, vis: deEsboco,
            dica: "Toque o esboço do perfil na árvore (esboço fechado)" },
          { t: "refs", rot: "Trajetória", cam: "trajetoria", aceita: ["esboco", "aresta", "curva"], multiplo: true, cor: "azul",
            dica: "Toque o esboço da trajetória na árvore, ou arestas encadeadas no modelo" },
          { t: "num", rot: "Diâmetro", cam: "diametro", un: "mm", min: 0.001, passo: 0.5, vis: (f) => !deEsboco(f) },
        ],
      },
      {
        titulo: "Curvas-guia",
        campos: [
          { t: "refs", rot: "Curvas-guia", cam: "guias", aceita: ["esboco", "aresta", "curva"], multiplo: true, ordenavel: true,
            dica: "Opcional: esboços ou arestas que tocam o perfil (o perfil escala para segui-las)" },
          { t: "check", rot: "Mesclar faces suaves", cam: "mesclarFacesSuaves", vis: (f) => f.guias.length > 0 },
        ],
      },
      {
        titulo: "Tangência de início/fim",
        campos: [
          { t: "sel", rot: "Tangência inicial", cam: "tangenciaInicio", opcoes: [["nenhuma", "Nenhuma"], ["trajetoria", "Tangente à trajetória"]] },
          { t: "sel", rot: "Tangência final", cam: "tangenciaFim", opcoes: [["nenhuma", "Nenhuma"], ["trajetoria", "Tangente à trajetória"]] },
        ],
      },
      { titulo: corte ? "Corte fino" : "Recurso fino", opcional: "fino.ativo", campos: camposFino<FeatureVarredura>() },
    ],
  };
}

/** Loft / corte por loft: docs/funcional/features.md §5. */
function loft(corte: boolean): Esquema<FeatureLoft> {
  const restricao = (rot: string, cam: "restricaoInicio" | "restricaoFim"): Campo<FeatureLoft>[] => {
    const r = (f: FeatureLoft): RestricaoLoft => f[cam];
    return [
      { t: "sel", rot, cam: `${cam}.tipo`, opcoes: [["nenhuma", "Nenhuma"], ["vetor", "Vetor de direção"], ["normal", "Normal ao perfil"]],
        vis: (f) => !f.fecharLoft },
      { t: "refs", rot: "Vetor de direção", cam: `${cam}.ref`, aceita: ["aresta", "eixo", "plano", "face"], multiplo: false, cor: "azul",
        dica: "Aresta reta, eixo, plano ou face plana", vis: (f) => !f.fecharLoft && r(f).tipo === "vetor" },
      { t: "num", rot: "Comprimento da tangente", cam: `${cam}.comprimento`, min: 0.05, max: 10, passo: 0.1, vis: (f) => !f.fecharLoft && r(f).tipo !== "nenhuma" },
      { t: "inverter", rot: "Inverter direção", cam: `${cam}.inverter`, vis: (f) => !f.fecharLoft && r(f).tipo !== "nenhuma" },
    ];
  };
  return {
    titulo: corte ? "Corte por loft" : "Loft",
    caixas: [
      {
        titulo: "Perfis",
        campos: [
          { t: "refs", rot: "Perfis", cam: "perfis", aceita: ["esboco"], multiplo: true, ordenavel: true,
            dica: "Toque os esboços dos perfis na árvore, na ordem do loft" },
        ],
      },
      { titulo: "Restrições de início/fim", campos: [...restricao("Restrição inicial", "restricaoInicio"), ...restricao("Restrição final", "restricaoFim")] },
      {
        titulo: "Curvas-guia",
        campos: [
          { t: "refs", rot: "Curvas-guia", cam: "guias", aceita: ["esboco", "aresta", "curva"], multiplo: true, ordenavel: true,
            dica: "Opcional: esboços ou arestas que tocam os perfis" },
          { t: "sel", rot: "Influência da curva-guia", cam: "influenciaGuias", vis: (f) => f.guias.length > 0,
            opcoes: [["proximaGuia", "Até a próxima guia"], ["proximaArestaViva", "Até a próxima aresta viva"], ["proximaAresta", "Até a próxima aresta"], ["global", "Global"]] },
        ],
      },
      {
        titulo: "Parâmetros de linha de centro",
        campos: [
          { t: "refs", rot: "Linha de centro", cam: "linhaCentro", aceita: ["esboco", "aresta", "curva"], multiplo: true, cor: "azul",
            dica: "Opcional: curva que os perfis seguem" },
          { t: "num", rot: "Número de seções", cam: "secoesLinhaCentro", min: 2, max: 200, passo: 1, vis: (f) => f.linhaCentro.length > 0 },
        ],
      },
      {
        titulo: "Opções",
        campos: [
          { t: "check", rot: "Mesclar faces tangentes", cam: "mesclarFacesTangentes" },
          { t: "check", rot: "Fechar loft", cam: "fecharLoft" },
          { t: "check", rot: "Mostrar pré-visualização", cam: "mostrarPrevia" },
          { t: "check", rot: "Microtolerância", cam: "microtolerancia" },
        ],
      },
      { titulo: corte ? "Corte fino" : "Recurso fino", opcional: "fino.ativo", campos: camposFino<FeatureLoft>() },
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

const TITULO_CURVA: Record<FeatureCurva["modo"], string> = {
  helice: "Hélice e espiral", xyz: "Curva por pontos XYZ", pontosRef: "Curva por pontos de referência",
  composta: "Curva composta", projetada: "Curva projetada",
};

/** Curvas 3D (features.md §16): o modo vem do item escolhido no menu Curvas ▾. */
function curva(f0: FeatureCurva): Esquema<FeatureCurva> {
  const caixas: Caixa<FeatureCurva>[] = [];
  if (f0.modo === "helice") {
    const def = (...ds: FeatureCurva["definicao"][]) => (f: FeatureCurva) => ds.includes(f.definicao);
    caixas.push(
      { titulo: "Círculo de base", campos: [
        { t: "refs", rot: "Esboço com o círculo", cam: "base", aceita: ["esboco"], multiplo: false, dica: "Esboço com um círculo: centro e diâmetro da hélice" },
      ] },
      { titulo: "Definido por", campos: [
        { t: "sel", rot: "Tipo", cam: "definicao", opcoes: [["passoRevolucao", "Passo e revolução"], ["alturaRevolucao", "Altura e revolução"], ["alturaPasso", "Altura e passo"], ["espiral", "Espiral"]] },
      ] },
      { titulo: "Parâmetros", campos: [
        { t: "num", rot: "Passo", cam: "passo", un: "mm", min: 0.01, vis: def("passoRevolucao", "alturaPasso", "espiral") },
        { t: "num", rot: "Altura", cam: "altura", un: "mm", min: 0.01, vis: def("alturaRevolucao", "alturaPasso") },
        { t: "num", rot: "Revoluções", cam: "revolucoes", min: 0.05, passo: 0.5, vis: def("passoRevolucao", "alturaRevolucao", "espiral") },
        { t: "inverter", rot: "Inverter direção", cam: "inverter" },
        { t: "num", rot: "Ângulo inicial", cam: "anguloInicial", un: "°", passo: 15 },
        { t: "sel", rot: "Sentido", cam: "horario", opcoes: [["false", "Anti-horário"], ["true", "Horário"]], valor: (f) => String(f.horario), aoMudar: (f, v) => (f.horario = v === "true") },
      ] },
      { titulo: "Hélice cônica", opcional: "conica.ativa", vis: (f) => f.definicao !== "espiral", campos: [
        { t: "num", rot: "Ângulo do cone", cam: "conica.angulo", un: "°", min: 0.1, max: 80 },
        { t: "check", rot: "Cônica para fora", cam: "conica.paraFora" },
      ] },
    );
  } else if (f0.modo === "xyz") {
    caixas.push({ titulo: "Pontos", campos: [
      { t: "texto", rot: "X; Y; Z (mm), um ponto por linha", cam: "pontosTexto", linhas: 8, dica: "0; 0; 0\n20; 0; 10" },
      { t: "check", rot: "Curva fechada", cam: "fechada" },
      { t: "info", texto: () => "A curva passa por todos os pontos, na ordem da lista. Dá para colar uma coluna de planilha." },
    ] });
  } else if (f0.modo === "pontosRef") {
    caixas.push({ titulo: "Pontos de referência", campos: [
      { t: "refs", rot: "Pontos (em ordem)", cam: "pontos", aceita: ["vertice"], multiplo: true, ordenavel: true, dica: "Toque os vértices na ordem da curva" },
      { t: "check", rot: "Curva fechada", cam: "fechada" },
    ] });
  } else if (f0.modo === "composta") {
    caixas.push({ titulo: "Entidades a juntar", campos: [
      { t: "refs", rot: "Esboços, arestas e curvas", cam: "itens", aceita: ["esboco", "aresta", "curva"], multiplo: true, dica: "Toque os trechos: precisam se ligar pelas pontas" },
    ] });
  } else {
    caixas.push(
      { titulo: "Tipo de projeção", campos: [
        { t: "sel", rot: "Tipo", cam: "projecao", opcoes: [["esbocoEmFaces", "Esboço em faces"], ["esbocoEmEsboco", "Esboço em esboço"]] },
      ] },
      { titulo: "Seleções", campos: [
        { t: "refs", rot: "Esboço a projetar", cam: "esboco", aceita: ["esboco"], multiplo: false },
        { t: "refs", rot: "Segundo esboço", cam: "esboco2", aceita: ["esboco"], multiplo: false, cor: "azul", vis: (f) => f.projecao === "esbocoEmEsboco" },
        { t: "refs", rot: "Faces de destino", cam: "faces", aceita: ["face"], multiplo: true, cor: "azul", vis: (f) => f.projecao === "esbocoEmFaces" },
        { t: "inverter", rot: "Inverter projeção", cam: "inverter", vis: (f) => f.projecao === "esbocoEmFaces" && !f.bidirecional },
        { t: "check", rot: "Bidirecional", cam: "bidirecional", vis: (f) => f.projecao === "esbocoEmFaces" },
        { t: "info", texto: (f) => f.projecao === "esbocoEmEsboco"
          ? "Os dois esboços (em planos que se cruzam) são estendidos na normal de cada um; a curva é onde se encontram."
          : "O esboço é levado na direção da normal dele até as faces." },
      ] },
    );
  }
  return { titulo: TITULO_CURVA[f0.modo], caixas };
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
