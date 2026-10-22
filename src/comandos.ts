// Definição das abas de comando (Features / Sketch / Sheet Metal) e dos seus botões.
// Comandos com `fase` ainda não existem: aparecem desabilitados e avisam quando chegam.

import type { NomeIcone } from "./icones";

export type IdAba = "features" | "sketch" | "chapa" | "avaliar";

export interface Comando {
  id: string;
  rotulo: string;
  icone: NomeIcone;
  dica: string;
  /** Fase do roteiro em que o comando será implementado (ausente = já disponível). */
  fase?: number;
  /** Comandos da mesma aba são separados em grupos por este campo. */
  grupo: number;
}

export interface Aba {
  id: IdAba;
  rotulo: string;
  comandos: Comando[];
}

export const ABAS: Aba[] = [
  {
    id: "features",
    rotulo: "Features",
    comandos: [
      { id: "extrusao", rotulo: "Extrusão", icone: "extrusao", dica: "Ressalto extrudado a partir de um esboço", grupo: 0 },
      { id: "revolucao", rotulo: "Revolução", icone: "revolucao", dica: "Ressalto girando um perfil em torno de um eixo", grupo: 0 },
      { id: "corte", rotulo: "Corte extrudado", icone: "corte", dica: "Remove material extrudando um perfil", grupo: 1 },
      { id: "corte-revolucao", rotulo: "Corte revolução", icone: "corteRevolucao", dica: "Remove material girando um perfil", grupo: 1 },
      { id: "furo", rotulo: "Furo assistido", icone: "furo", dica: "Furos ISO: simples, rebaixado, escareado, roscado", grupo: 1 },
      { id: "filete", rotulo: "Filete", icone: "filete", dica: "Arredonda as arestas selecionadas", grupo: 2 },
      { id: "chanfro", rotulo: "Chanfro", icone: "chanfro", dica: "Chanfra as arestas selecionadas", grupo: 2 },
      { id: "casca", rotulo: "Casca", icone: "casca", dica: "Esvazia o sólido com espessura constante", grupo: 2 },
      { id: "nervura", rotulo: "Nervura", icone: "nervura", dica: "Nervura a partir de um esboço aberto", grupo: 2 },
      { id: "inclinacao", rotulo: "Inclinação", icone: "inclinacaoRecurso", dica: "Inclina faces a partir de um plano neutro", grupo: 2 },
      { id: "padrao-linear", rotulo: "Padrão linear", icone: "padraoLinear", dica: "Repete recursos em uma ou duas direções", grupo: 3 },
      { id: "padrao-circular", rotulo: "Padrão circular", icone: "padraoCircular", dica: "Repete recursos em torno de um eixo", grupo: 3 },
      { id: "espelhar", rotulo: "Espelhar", icone: "espelhar", dica: "Espelha recursos ou a peça em relação a um plano", grupo: 3 },
      { id: "plano", rotulo: "Plano", icone: "plano", dica: "Plano de referência (distância, ângulo, plano médio)", grupo: 4 },
      { id: "eixo", rotulo: "Eixo", icone: "eixoRef", dica: "Eixo de referência", grupo: 4 },
    ],
  },
  {
    id: "sketch",
    rotulo: "Sketch",
    comandos: [
      { id: "esboco", rotulo: "Esboço", icone: "esboco", dica: "Abre um esboço no plano ou face selecionada (ou edita o esboço selecionado)", grupo: 0 },
      { id: "selecionar", rotulo: "Selecionar", icone: "selecionar", dica: "Seleciona e arrasta entidades (V)", grupo: 0 },
      { id: "linha", rotulo: "Linha", icone: "linha", dica: "Linhas encadeadas por pontos (L)", grupo: 1 },
      { id: "ponto", rotulo: "Ponto", icone: "ponto", dica: "Ponto solto (posição de furo, referência)", grupo: 1 },
      { id: "retangulo", rotulo: "Retângulo", icone: "retangulo", dica: "Retângulo por cantos opostos (R)", grupo: 1 },
      { id: "circulo", rotulo: "Círculo", icone: "circulo", dica: "Círculo por centro e raio (C)", grupo: 1 },
      { id: "arco", rotulo: "Arco", icone: "arco", dica: "Arco por três pontos (A)", grupo: 1 },
      { id: "rasgo", rotulo: "Rasgo", icone: "rasgo", dica: "Rasgo reto (oblongo)", grupo: 1 },
      { id: "poligono", rotulo: "Polígono", icone: "poligono", dica: "Polígono regular (P)", grupo: 1 },
      { id: "spline", rotulo: "Spline", icone: "spline", dica: "Curva suave por pontos (S)", grupo: 1 },
      { id: "aparar", rotulo: "Aparar", icone: "aparar", dica: "Apaga trechos entre interseções (T)", grupo: 2 },
      { id: "estender", rotulo: "Estender", icone: "estender", dica: "Estende uma linha até a próxima interseção", grupo: 2 },
      { id: "fileteEsboco", rotulo: "Filete", icone: "fileteEsboco", dica: "Arredonda um canto do esboço", grupo: 2 },
      { id: "chanfroEsboco", rotulo: "Chanfro", icone: "chanfroEsboco", dica: "Chanfra um canto do esboço", grupo: 2 },
      { id: "offset", rotulo: "Offset", icone: "offset", dica: "Copia uma cadeia de entidades a uma distância (O)", grupo: 2 },
      { id: "espelhar", rotulo: "Espelhar", icone: "espelharEsboco", dica: "Espelha a seleção em torno de uma linha (M)", grupo: 2 },
      { id: "cota", rotulo: "Cota", icone: "cota", dica: "Cota inteligente: linear, H/V, radial, angular (D)", grupo: 3 },
      { id: "relacao", rotulo: "Relação", icone: "relacao", dica: "Coincidente, horizontal, paralelo, tangente… para a seleção", grupo: 3 },
      { id: "construcao", rotulo: "Construção", icone: "construcao", dica: "Alterna geometria de construção (seleção ou próximas entidades)", grupo: 3 },
    ],
  },
  {
    id: "chapa",
    rotulo: "Sheet Metal",
    comandos: [
      { id: "flange-base", rotulo: "Flange base", icone: "flangeBase", dica: "Chapa a partir de um esboço fechado", grupo: 0, fase: 4 },
      { id: "flange-aresta", rotulo: "Flange de aresta", icone: "flangeAresta", dica: "Dobra uma aba a partir de uma aresta", grupo: 0, fase: 4 },
      { id: "dobra", rotulo: "Dobra por esboço", icone: "dobra", dica: "Dobra a chapa ao longo de uma linha", grupo: 0, fase: 4 },
      { id: "alivio", rotulo: "Alívios", icone: "alivio", dica: "Alívios de dobra e de canto", grupo: 1, fase: 4 },
      { id: "material", rotulo: "Material / K", icone: "material", dica: "Tabela de material, espessura, fator K e raio", grupo: 1, fase: 4 },
      { id: "planificar", rotulo: "Planificar", icone: "planificar", dica: "Mostra a chapa planificada", grupo: 2, fase: 4 },
      { id: "dxf", rotulo: "Exportar DXF", icone: "dxf", dica: "Planificado em DXF para corte", grupo: 2, fase: 4 },
    ],
  },
  {
    id: "avaliar",
    rotulo: "Avaliar",
    comandos: [
      { id: "medir", rotulo: "Medir", icone: "medir", dica: "Distâncias, ângulos, raios e coordenadas", grupo: 0 },
      { id: "massa", rotulo: "Massa", icone: "massa", dica: "Propriedades de massa: massa, volume, centro de massa, inércia", grupo: 0 },
      { id: "prop-secao", rotulo: "Prop. de seção", icone: "propSecao", dica: "Área, centroide e momentos de inércia de uma face", grupo: 0, fase: 5 },
      { id: "vista-secao", rotulo: "Vista de seção", icone: "vistaSecao", dica: "Corta a vista por um ou mais planos (só visual)", grupo: 1 },
      { id: "verificar", rotulo: "Verificar", icone: "verificar", dica: "Procura geometria inválida, arestas curtas e raio mínimo", grupo: 1 },
      { id: "analise-inclinacao", rotulo: "Inclinação", icone: "analiseInclinacao", dica: "Análise de inclinação para moldagem/fundição", grupo: 2 },
      { id: "analise-espessura", rotulo: "Espessura", icone: "analiseEspessura", dica: "Regiões finas e grossas da peça", grupo: 2 },
      { id: "zebra", rotulo: "Zebra", icone: "zebra", dica: "Listras zebra para avaliar continuidade entre faces", grupo: 2 },
      { id: "curvatura", rotulo: "Curvatura", icone: "curvatura", dica: "Faces coloridas pela curvatura", grupo: 2 },
      { id: "desempenho", rotulo: "Desempenho", icone: "desempenho", dica: "Tempo de reconstrução de cada recurso", grupo: 3 },
    ],
  },
];
