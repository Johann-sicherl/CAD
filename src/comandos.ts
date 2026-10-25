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
  /**
   * Botão com menu ▾: as subfunções. O botão executa a última usada; a seta abre a lista.
   * Subfunções de esboço usam o id "ferramenta:variante" (ex.: "retangulo:centro").
   */
  itens?: Comando[];
  /** Ainda não implementado: aparece com o selo "em breve". */
  emBreve?: boolean;
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
      { id: "varredura", rotulo: "Varredura", icone: "varredura", dica: "Leva um perfil ao longo de uma trajetória (tubos, cabos, canais)", grupo: 0 },
      { id: "loft", rotulo: "Loft", icone: "loft", dica: "Transição suave entre dois ou mais perfis", grupo: 0 },
      { id: "corte", rotulo: "Corte extrudado", icone: "corte", dica: "Remove material extrudando um perfil", grupo: 1 },
      { id: "furo", rotulo: "Furo assistido", icone: "furo", dica: "Furos ISO: simples, rebaixado, escareado, roscado", grupo: 1 },
      { id: "corte-revolucao", rotulo: "Corte revolução", icone: "corteRevolucao", dica: "Remove material girando um perfil", grupo: 1 },
      { id: "corte-varredura", rotulo: "Corte varredura", icone: "corteVarredura", dica: "Remove material levando um perfil ao longo de uma trajetória", grupo: 1 },
      { id: "corte-loft", rotulo: "Corte loft", icone: "corteLoft", dica: "Remove material por loft entre perfis", grupo: 1 },
      {
        id: "grupo-filete", rotulo: "Filete", icone: "filete", dica: "Filete e chanfro", grupo: 2,
        itens: [
          { id: "filete", rotulo: "Filete", icone: "filete", dica: "Arredonda as arestas selecionadas", grupo: 2 },
          { id: "chanfro", rotulo: "Chanfro", icone: "chanfro", dica: "Chanfra as arestas selecionadas", grupo: 2 },
        ],
      },
      {
        id: "grupo-padrao", rotulo: "Padrão", icone: "padraoLinear", dica: "Padrões linear e circular", grupo: 2,
        itens: [
          { id: "padrao-linear", rotulo: "Padrão linear", icone: "padraoLinear", dica: "Repete recursos em uma ou duas direções", grupo: 2 },
          { id: "padrao-circular", rotulo: "Padrão circular", icone: "padraoCircular", dica: "Repete recursos em torno de um eixo", grupo: 2 },
        ],
      },
      { id: "nervura", rotulo: "Nervura", icone: "nervura", dica: "Nervura a partir de um esboço aberto", grupo: 2 },
      { id: "inclinacao", rotulo: "Inclinação", icone: "inclinacaoRecurso", dica: "Inclina faces a partir de um plano neutro", grupo: 2 },
      { id: "casca", rotulo: "Casca", icone: "casca", dica: "Esvazia o sólido com espessura constante", grupo: 2 },
      { id: "espelhar", rotulo: "Espelhar", icone: "espelhar", dica: "Espelha recursos ou a peça em relação a um plano", grupo: 2 },
      {
        id: "grupo-referencia", rotulo: "Geometria de referência", icone: "plano", dica: "Planos e eixos de referência", grupo: 3,
        itens: [
          { id: "plano", rotulo: "Plano", icone: "plano", dica: "Plano de referência (distância, ângulo, plano médio)", grupo: 3 },
          { id: "eixo", rotulo: "Eixo", icone: "eixoRef", dica: "Eixo de referência", grupo: 3 },
        ],
      },
      {
        id: "grupo-curvas", rotulo: "Curvas", icone: "helice", dica: "Curvas 3D: trajetórias e guias para varredura e loft", grupo: 3,
        itens: [
          { id: "curva-projetada", rotulo: "Curva projetada", icone: "curvaProjetada", dica: "Projeta um esboço em faces ou cruza dois esboços", grupo: 3 },
          { id: "curva-composta", rotulo: "Curva composta", icone: "curvaComposta", dica: "Junta esboços, arestas e curvas numa só curva", grupo: 3 },
          { id: "curva-xyz", rotulo: "Curva por pontos XYZ", icone: "curvaXYZ", dica: "Curva suave por uma tabela de coordenadas", grupo: 3 },
          { id: "curva-pontos", rotulo: "Curva por pontos de referência", icone: "curvaPontos", dica: "Curva por vértices e pontos escolhidos", grupo: 3 },
          { id: "helice", rotulo: "Hélice e espiral", icone: "helice", dica: "Hélice (molas, roscas) ou espiral a partir de um círculo", grupo: 3 },
        ],
      },
    ],
  },
  {
    id: "sketch",
    rotulo: "Sketch",
    comandos: [
      {
        id: "grupo-esboco", rotulo: "Esboço", icone: "esboco", dica: "Esboço no plano/face selecionado (ou sair do esboço)", grupo: 0,
        itens: [
          { id: "esboco", rotulo: "Esboço", icone: "esboco", dica: "Abre um esboço no plano ou face selecionada (ou edita o esboço selecionado)", grupo: 0 },
          { id: "esboco3d", rotulo: "Esboço 3D", icone: "esboco3d", dica: "Esboço livre no espaço", grupo: 0, emBreve: true },
        ],
      },
      { id: "selecionar", rotulo: "Selecionar", icone: "selecionar", dica: "Seleciona e arrasta entidades (V)", grupo: 0 },
      {
        id: "grupo-cota", rotulo: "Cota", icone: "cota", dica: "Cotas", grupo: 0,
        itens: [{ id: "cota", rotulo: "Cota inteligente", icone: "cota", dica: "Cota inteligente: linear, H/V, radial, angular (D)", grupo: 0 }],
      },
      {
        id: "grupo-linha", rotulo: "Linha", icone: "linha", dica: "Linhas", grupo: 1,
        itens: [
          { id: "linha:normal", rotulo: "Linha", icone: "linha", dica: "Linhas encadeadas por pontos (L)", grupo: 1 },
          { id: "linha:centro", rotulo: "Linha de centro", icone: "linhaCentro", dica: "Linha de construção (eixo de revolução, simetria)", grupo: 1 },
          { id: "linha:pontoMedio", rotulo: "Linha de ponto médio", icone: "linhaPontoMedio", dica: "Linha simétrica: 1º toque no meio, 2º na ponta", grupo: 1 },
        ],
      },
      {
        id: "grupo-retangulo", rotulo: "Retângulo", icone: "retangulo", dica: "Retângulos e paralelogramo", grupo: 1,
        itens: [
          { id: "retangulo:canto", rotulo: "Retângulo de canto", icone: "retangulo", dica: "Por cantos opostos (R)", grupo: 1 },
          { id: "retangulo:centro", rotulo: "Retângulo pelo centro", icone: "retanguloCentro", dica: "Centro e um canto", grupo: 1 },
          { id: "retangulo:3pontos", rotulo: "Retângulo de canto por 3 pontos", icone: "retangulo3p", dica: "Dois cantos de um lado e a largura (inclinado)", grupo: 1 },
          { id: "retangulo:centro3", rotulo: "Retângulo pelo centro por 3 pontos", icone: "retanguloCentro3p", dica: "Centro, meio de um lado e um canto (inclinado)", grupo: 1 },
          { id: "retangulo:paralelogramo", rotulo: "Paralelogramo", icone: "paralelogramo", dica: "Três cantos: o quarto é calculado", grupo: 1 },
        ],
      },
      {
        id: "grupo-rasgo", rotulo: "Rasgo", icone: "rasgo", dica: "Rasgos (oblongos)", grupo: 1,
        itens: [
          { id: "rasgo:reto", rotulo: "Rasgo reto", icone: "rasgo", dica: "Centros das pontas e largura", grupo: 1 },
          { id: "rasgo:centro", rotulo: "Rasgo reto pelo centro", icone: "rasgoCentro", dica: "Centro, centro de uma ponta e largura", grupo: 1 },
          { id: "rasgo:arco3", rotulo: "Rasgo em arco por 3 pontos", icone: "rasgoArco", dica: "Início, fim, ponto do arco e largura", grupo: 1 },
          { id: "rasgo:arcoCentro", rotulo: "Rasgo em arco pelo centro", icone: "rasgoArcoCentro", dica: "Centro do arco, início, fim e largura", grupo: 1 },
        ],
      },
      {
        id: "grupo-circulo", rotulo: "Círculo", icone: "circulo", dica: "Círculos", grupo: 1,
        itens: [
          { id: "circulo:centro", rotulo: "Círculo", icone: "circulo", dica: "Centro e raio (C)", grupo: 1 },
          { id: "circulo:perimetro", rotulo: "Círculo perimetral", icone: "circuloPerimetro", dica: "Três pontos do contorno", grupo: 1 },
        ],
      },
      {
        id: "grupo-arco", rotulo: "Arco", icone: "arco", dica: "Arcos", grupo: 1,
        itens: [
          { id: "arco:centro", rotulo: "Arco pelo centro", icone: "arcoCentro", dica: "Centro, início e fim", grupo: 1 },
          { id: "arco:tangente", rotulo: "Arco tangente", icone: "arcoTangente", dica: "Começa tangente na ponta de uma linha ou arco", grupo: 1 },
          { id: "arco:3pontos", rotulo: "Arco por 3 pontos", icone: "arco", dica: "Início, fim e um ponto do arco (A)", grupo: 1 },
        ],
      },
      { id: "poligono", rotulo: "Polígono", icone: "poligono", dica: "Polígono regular (P)", grupo: 1 },
      {
        id: "grupo-spline", rotulo: "Spline", icone: "spline", dica: "Splines e curvas", grupo: 1,
        itens: [
          { id: "spline", rotulo: "Spline", icone: "spline", dica: "Curva suave por pontos (S)", grupo: 1 },
          { id: "splineEstilo", rotulo: "Spline de estilo", icone: "splineEstilo", dica: "Spline por polígono de controle", grupo: 1, emBreve: true },
          { id: "curvaEquacao", rotulo: "Curva por equação", icone: "curvaEquacao", dica: "y = f(x) ou paramétrica", grupo: 1, emBreve: true },
        ],
      },
      {
        id: "grupo-elipse", rotulo: "Elipse", icone: "elipse", dica: "Elipses e cônicas", grupo: 1,
        itens: [
          { id: "elipse", rotulo: "Elipse", icone: "elipse", dica: "Centro e dois semieixos", grupo: 1 },
          { id: "elipseParcial", rotulo: "Elipse parcial", icone: "elipseParcial", dica: "Arco de elipse", grupo: 1 },
          { id: "parabola", rotulo: "Parábola", icone: "parabola", dica: "Foco, vértice e extremos", grupo: 1 },
          { id: "conica", rotulo: "Cônica", icone: "conica", dica: "Cônica geral", grupo: 1, emBreve: true },
        ],
      },
      {
        id: "grupo-filete-esboco", rotulo: "Filete", icone: "fileteEsboco", dica: "Filete e chanfro de esboço", grupo: 2,
        itens: [
          { id: "fileteEsboco", rotulo: "Filete de esboço", icone: "fileteEsboco", dica: "Arredonda um canto do esboço", grupo: 2 },
          { id: "chanfroEsboco", rotulo: "Chanfro de esboço", icone: "chanfroEsboco", dica: "Chanfra um canto do esboço", grupo: 2 },
        ],
      },
      { id: "texto", rotulo: "Texto", icone: "texto", dica: "Texto de esboço (gravação, marcação)", grupo: 2 },
      { id: "ponto", rotulo: "Ponto", icone: "ponto", dica: "Ponto solto (posição de furo, referência)", grupo: 2 },
      {
        id: "grupo-aparar", rotulo: "Aparar", icone: "aparar", dica: "Aparar e estender", grupo: 3,
        itens: [
          { id: "aparar", rotulo: "Aparar entidades", icone: "aparar", dica: "Apaga trechos entre interseções (T)", grupo: 3 },
          { id: "estender", rotulo: "Estender entidades", icone: "estender", dica: "Estende uma linha até a próxima interseção", grupo: 3 },
        ],
      },
      {
        id: "grupo-converter", rotulo: "Converter", icone: "converter", dica: "Trazer geometria do modelo para o esboço", grupo: 3,
        itens: [
          { id: "converter", rotulo: "Converter entidades", icone: "converter", dica: "Toque arestas/vértices da peça: viram geometria do esboço (fixa)", grupo: 3 },
          { id: "silhueta", rotulo: "Entidades de silhueta", icone: "silhueta", dica: "Contorno da peça visto do plano do esboço", grupo: 3, emBreve: true },
          { id: "intersecao", rotulo: "Curva de interseção", icone: "intersecao", dica: "Onde o plano do esboço corta a peça", grupo: 3, emBreve: true },
        ],
      },
      { id: "offset", rotulo: "Offset", icone: "offset", dica: "Copia uma cadeia de entidades a uma distância (O)", grupo: 3 },
      {
        id: "grupo-espelhar-esboco", rotulo: "Espelhar", icone: "espelharEsboco", dica: "Espelhar entidades", grupo: 3,
        itens: [
          { id: "espelhar", rotulo: "Espelhar entidades", icone: "espelharEsboco", dica: "Espelha a seleção em torno de uma linha (M)", grupo: 3 },
          { id: "espelhoDinamico", rotulo: "Espelhamento dinâmico", icone: "espelhoDinamico", dica: "Desenha de um lado e aparece do outro (liga/desliga)", grupo: 3 },
        ],
      },
      {
        id: "grupo-padrao-esboco", rotulo: "Padrão", icone: "padraoLinearEsboco", dica: "Padrões de esboço", grupo: 3,
        itens: [
          { id: "padraoLinearEsboco", rotulo: "Padrão linear de esboço", icone: "padraoLinearEsboco", dica: "Repete a seleção em uma ou duas direções", grupo: 3 },
          { id: "padraoCircularEsboco", rotulo: "Padrão circular de esboço", icone: "padraoCircularEsboco", dica: "Repete a seleção em torno de um centro", grupo: 3 },
        ],
      },
      {
        id: "grupo-relacoes", rotulo: "Relações", icone: "relacao", dica: "Relações do esboço", grupo: 4,
        itens: [
          { id: "exibirRelacoes", rotulo: "Exibir/Excluir relações", icone: "exibirRelacoes", dica: "Lista todas as relações do esboço", grupo: 4 },
          { id: "relacao", rotulo: "Adicionar relação", icone: "relacao", dica: "Coincidente, horizontal, paralelo, tangente… para a seleção", grupo: 4 },
        ],
      },
      { id: "construcao", rotulo: "Construção", icone: "construcao", dica: "Alterna geometria de construção (seleção ou próximas entidades)", grupo: 4 },
    ],
  },
  {
    id: "chapa",
    rotulo: "Sheet Metal",
    comandos: [
      { id: "flange-base", rotulo: "Flange base", icone: "flangeBase", dica: "Chapa a partir de um esboço: fechado vira placa, aberto vira perfil dobrado", grupo: 0 },
      { id: "aba-chapa", rotulo: "Aba", icone: "aba", dica: "Esboço fechado numa face da chapa vira aba com a mesma espessura", grupo: 0 },
      { id: "flange-aresta", rotulo: "Flange de aresta", icone: "flangeAresta", dica: "Dobra uma aba a partir de arestas da chapa", grupo: 0 },
      { id: "bainha", rotulo: "Bainha", icone: "bainha", dica: "Dobra a borda sobre ela mesma (fechada, aberta, enrolada)", grupo: 0 },
      { id: "dobra", rotulo: "Dobra esboçada", icone: "dobra", dica: "Dobra a chapa ao longo de uma linha de esboço numa face", grupo: 0 },
      { id: "junta", rotulo: "Junta", icone: "junta", dica: "Degrau na chapa (duas dobras) a partir de uma linha de esboço", grupo: 0 },
      { id: "corte-chapa", rotulo: "Corte na chapa", icone: "corteChapa", dica: "Corta através da chapa (normal à chapa) a partir de um esboço numa face", grupo: 1 },
      { id: "alivio", rotulo: "Alívios de canto", icone: "alivio", dica: "Alívios de canto e fechar canto", grupo: 1, emBreve: true },
      { id: "material", rotulo: "Material / K", icone: "material", dica: "Tabela de material, espessura, raio de dobra e fator K", grupo: 1 },
      { id: "planificar", rotulo: "Planificar", icone: "planificar", dica: "Liga/desliga a vista da chapa planificada", grupo: 2 },
      { id: "dxf", rotulo: "Exportar DXF", icone: "dxf", dica: "Planificado em DXF (R12, mm) e lista de corte", grupo: 2 },
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
