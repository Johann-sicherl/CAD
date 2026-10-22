// Modelo paramétrico: a peça é uma lista ordenada de features (árvore de histórico).
// Regenerar = executar as features em ordem a partir do zero.
// Especificação campo a campo de cada comando: docs/funcional/.

export type Plano = "XY" | "XZ" | "YZ";

/** Planos de referência com nomes de vista (Z para cima). */
export const NOME_PLANO: Record<Plano, string> = { XZ: "Frontal", XY: "Superior", YZ: "Lateral" };

export type Vec3 = [number, number, number];

export type Perfil =
  | { tipo: "retangulo"; largura: number; altura: number; raioCanto: number }
  | { tipo: "circulo"; diametro: number }
  | { tipo: "poligono"; lados: number; diametro: number };

interface FeatureBase {
  id: string;
  nome: string;
  suprimida: boolean;
}

// ---------- referências a geometria ----------
// Faces/arestas/vértices da peça são guardados por "assinatura" geométrica e reencontrados
// a cada regeneração pela entidade mais parecida (o kernel não tem nomes persistentes).

export interface AssinaturaFace {
  geom: "plano" | "cilindro" | "cone" | "esfera" | "outra";
  centro: Vec3;
  area: number;
  normal?: Vec3; // plano: normal para fora
  eixo?: Vec3; // cilindro/cone: direção do eixo
  pontoEixo?: Vec3;
  raio?: number;
}

export interface AssinaturaAresta {
  geom: "linha" | "circulo" | "outra";
  meio: Vec3;
  a: Vec3;
  b: Vec3;
  comprimento: number;
  centro?: Vec3; // círculo
  eixo?: Vec3;
  raio?: number;
}

export type Referencia =
  | { tipo: "face"; ass: AssinaturaFace }
  | { tipo: "aresta"; ass: AssinaturaAresta }
  | { tipo: "vertice"; p: Vec3 }
  /** Plano principal (XY/XZ/YZ) ou recurso de plano de referência (id). */
  | { tipo: "plano"; id: string }
  /** Eixo principal (X/Y/Z) ou recurso de eixo de referência (id). */
  | { tipo: "eixo"; id: string }
  | { tipo: "esboco"; id: string }
  /** Linha de um esboço (eixo de revolução, direção). */
  | { tipo: "linhaEsboco"; esboco: string; geo: string }
  | { tipo: "recurso"; id: string };

// ---------- esboço ----------

/** Onde o esboço está: num plano principal (com afastamento), num plano de referência ou numa face. */
export type SuporteEsboco =
  | { tipo: "plano"; plano: Plano; deslocamento: number }
  | { tipo: "planoRef"; id: string }
  | { tipo: "face"; origem: Vec3; normal: Vec3; eixoX: Vec3 };

export interface PontoEsboco {
  id: string;
  x: number; // coordenadas no plano do esboço (mm)
  y: number;
}

interface GeoBase {
  id: string;
  construcao?: boolean; // geometria de construção: não vira perfil (ex.: linha de centro)
  /** Referência do modelo 3D (aresta/vértice da peça projetado no plano): fica fixa. */
  externa?: Referencia;
}

export type GeoEsboco =
  | (GeoBase & { tipo: "linha"; p1: string; p2: string })
  | (GeoBase & { tipo: "circulo"; c: string; r: number })
  /** Arco anti-horário do ponto `ini` ao ponto `fim`, com centro `c`. */
  | (GeoBase & { tipo: "arco"; c: string; ini: string; fim: string; r: number })
  /** Curva suave que passa pelos pontos (Catmull-Rom → Bézier cúbica). */
  | (GeoBase & { tipo: "spline"; pontos: string[] })
  /** Ponto solto (posição de furo, referência). */
  | (GeoBase & { tipo: "ponto"; p: string });

/** Relações geométricas e cotas. Referências são ids de pontos ou de geometrias. */
export type RestricaoEsboco =
  | { id: string; tipo: "coincidente"; a: string; b: string } // ponto-ponto ou ponto-curva
  | { id: string; tipo: "horizontal" | "vertical"; a: string; b?: string } // linha, ou dois pontos
  | { id: string; tipo: "paralelo" | "perpendicular" | "colinear"; a: string; b: string }
  | { id: string; tipo: "tangente" | "igual" | "concentrico"; a: string; b: string }
  | { id: string; tipo: "pontoMedio"; p: string; g: string }
  | { id: string; tipo: "simetrico"; a: string; b: string; g: string }
  | { id: string; tipo: "fixo"; a: string; x: number; y: number; r?: number }
  | CotaEsboco;

export type CotaEsboco = {
  id: string;
  /** Posição do texto da cota no plano (mm) — só visual. */
  texto?: { x: number; y: number };
  /** Cota de referência: só mede, não comanda a geometria. */
  referencia?: boolean;
  valor: number; // mm ou graus
  /** Expressão (ex.: "=largura/2") avaliada com as variáveis globais. */
  expr?: string;
} & (
  | { tipo: "distancia"; a: string; b?: string } // comprimento de linha, ponto-ponto ou ponto-linha
  | { tipo: "distanciaH" | "distanciaV"; a: string; b: string } // entre pontos (b − a)
  | { tipo: "raio" | "diametro"; a: string }
  | { tipo: "angulo"; a: string; b: string } // entre duas linhas
);

export const TIPOS_COTA = ["distancia", "distanciaH", "distanciaV", "raio", "diametro", "angulo"] as const;
export const ehCota = (r: RestricaoEsboco): r is CotaEsboco =>
  (TIPOS_COTA as readonly string[]).includes(r.tipo);

export interface FeatureEsboco extends FeatureBase {
  tipo: "esboco";
  suporte: SuporteEsboco;
  pontos: PontoEsboco[];
  geos: GeoEsboco[];
  restricoes: RestricaoEsboco[];
}

// ---------- extrusão / corte ----------

export type TipoCondicao =
  | "cego" | "passante" | "passanteAmbos" | "proximo" | "vertice" | "superficie" | "deslocSuperficie" | "planoMedio";

export interface Condicao {
  tipo: TipoCondicao;
  dist: number; // profundidade (cego/plano médio) ou deslocamento (deslocSuperficie)
  ref?: Referencia; // vértice ou face/plano
  inverterDesloc?: boolean;
}

export interface Inclinacao {
  ativa: boolean;
  angulo: number; // graus
  paraFora: boolean;
}

export interface RecursoFino {
  ativo: boolean;
  tipo: "uma" | "medio" | "duas";
  t1: number;
  t2: number;
  inverter: boolean;
}

export interface FeatureExtrusao extends FeatureBase {
  tipo: "extrusao";
  operacao: "adicionar" | "cortar";
  /** Esboço usado como perfil. Sem esboço, usa o perfil rápido abaixo. */
  esboco?: string;
  plano: Plano;
  deslocamento: number; // distância do plano à origem (mm)
  centroU: number;      // posição do centro do perfil no plano (mm)
  centroV: number;
  perfil: Perfil;
  /** Profundidade da direção 1 (cego). Valores negativos de arquivos antigos viram `inverter`. */
  profundidade: number;
  /** Início: plano do esboço, deslocado dele, ou numa face/plano/vértice. */
  de?: { tipo: "plano" | "deslocamento" | "superficie" | "vertice"; dist: number; inverter: boolean; ref?: Referencia };
  inverter?: boolean;
  condicao?: Condicao;
  inclinacao?: Inclinacao;
  direcao2?: { ativa: boolean; condicao: Condicao; inclinacao?: Inclinacao };
  fino?: RecursoFino;
  /** Índices dos contornos do esboço usados, como texto (vazio/ausente = todos). */
  contornos?: string[];
  /** Corte: remove o material de fora do perfil. */
  inverterLadoCorte?: boolean;
}

export interface FeatureRevolucao extends FeatureBase {
  tipo: "revolucao";
  operacao: "adicionar" | "cortar";
  /** Esboço usado como perfil. */
  esboco?: string;
  /** Eixo: linha do esboço ou eixo de referência. Sem eixo: 1ª linha de construção (ou eixo V). */
  eixo?: Referencia;
  plano: Plano;
  raioInterno: number;  // perfil retangular rápido (sem esboço)
  largura: number;
  altura: number;
  angulo: number;       // graus (direção 1)
  inverter?: boolean;
  planoMedio?: boolean;
  direcao2?: { ativa: boolean; angulo: number };
  fino?: RecursoFino;
  contornos?: string[];
}

// ---------- filete, chanfro, casca, inclinação, nervura ----------

export interface FeatureFilete extends FeatureBase {
  tipo: "filete";
  raio: number;
  /** Arestas e faces (todas as arestas da face). Vazio = todas as arestas da peça. */
  itens?: Referencia[];
  /** Raio por item (filete de múltiplos raios); ausente = `raio`. */
  raios?: (number | null)[];
  multiplosRaios?: boolean;
  assimetrico?: boolean;
  raio2?: number;
  propagarTangente?: boolean;
}

export interface FeatureChanfro extends FeatureBase {
  tipo: "chanfro";
  modo?: "anguloDistancia" | "distanciaDistancia";
  distancia: number;
  distancia2?: number;
  angulo?: number;
  assimetrico?: boolean;
  inverter?: boolean;
  itens?: Referencia[];
  propagarTangente?: boolean;
}

export interface FeatureCasca extends FeatureBase {
  tipo: "casca";
  espessura: number;
  faces: Referencia[]; // faces removidas
  paraFora: boolean;
}

export interface FeatureInclinacao extends FeatureBase {
  tipo: "inclinacao";
  angulo: number;
  planoNeutro?: Referencia;
  faces: Referencia[];
  inverter: boolean;
}

export interface FeatureNervura extends FeatureBase {
  tipo: "nervura";
  esboco?: string;
  espessura: number;
  lado: "primeiro" | "ambos" | "segundo";
  direcao: "paralela" | "normal";
  inverterMaterial: boolean;
}

// ---------- furo assistido ----------

export type TipoFuro = "simples" | "rebaixado" | "escareado" | "roscado";

export interface FeatureFuro extends FeatureBase {
  tipo: "furo";
  tipoFuro: TipoFuro;
  norma: "ISO";
  fixador: string; // ex.: "ISO 4762 cabeça cilíndrica"
  tamanho: string; // ex.: "M6"
  ajuste: "apertado" | "normal" | "folgado";
  /** Esboço com os pontos de posição (criado junto, na face escolhida). */
  esboco?: string;
  condicao: { tipo: "cego" | "passante" | "proximo"; profundidade: number; anguloPonta: number };
  personalizado?: {
    ativo: boolean;
    diametro: number;
    diamRebaixo: number;
    profRebaixo: number;
    diamEscareado: number;
    anguloEscareado: number;
  };
  rosca?: { profundidade: number; cosmetica: boolean; removerRosca: boolean };
  escareadoProximo?: { ativo: boolean; diametro: number; angulo: number };
}

// ---------- padrões e espelho ----------

export interface DirecaoPadrao {
  ref?: Referencia; // aresta linear, eixo, plano (normal) ou linha de esboço
  inverter: boolean;
  espacamento: number;
  instancias: number;
}

export interface FeaturePadraoLinear extends FeatureBase {
  tipo: "padraoLinear";
  recursos: string[];
  dir1: DirecaoPadrao;
  dir2?: DirecaoPadrao & { ativa: boolean; somenteSemente: boolean };
  pular: string[]; // "i,j"
}

export interface FeaturePadraoCircular extends FeatureBase {
  tipo: "padraoCircular";
  recursos: string[];
  eixo?: Referencia;
  inverter: boolean;
  igual: boolean; // espaçamento igual: `angulo` é o total
  angulo: number;
  instancias: number;
  pular: string[]; // "i"
}

export interface FeatureEspelhar extends FeatureBase {
  tipo: "espelhar";
  plano?: Referencia; // plano principal/de referência ou face plana
  recursos: string[];
  corpo: boolean; // espelha a peça inteira (até aqui) e une
}

// ---------- geometria de referência ----------

export interface FeaturePlanoRef extends FeatureBase {
  tipo: "planoRef";
  modo: "deslocamento" | "angulo" | "medio";
  ref1?: Referencia; // plano/face
  ref2?: Referencia; // eixo/aresta (ângulo) ou 2º plano (médio)
  distancia: number;
  angulo: number;
  inverter: boolean;
}

export interface FeatureEixoRef extends FeatureBase {
  tipo: "eixoRef";
  modo: "aresta" | "doisPlanos" | "cilindro" | "doisPontos";
  ref1?: Referencia;
  ref2?: Referencia;
}

export type Feature =
  | FeatureEsboco | FeatureExtrusao | FeatureRevolucao | FeatureFilete | FeatureChanfro
  | FeatureCasca | FeatureInclinacao | FeatureNervura | FeatureFuro
  | FeaturePadraoLinear | FeaturePadraoCircular | FeatureEspelhar | FeaturePlanoRef | FeatureEixoRef;

export interface Variavel {
  nome: string;
  expr: string; // "50" ou "=largura*2"
}

export interface Documento {
  formato: "jlscad";
  versao: 1 | 2;
  nome: string;
  features: Feature[];
  /** Material da peça (chave de MATERIAIS). */
  material?: string;
  /** Variáveis globais usadas em equações (`=nome`). */
  variaveis?: Variavel[];
  /** Expressões dos campos numéricos: `idFeature.caminho` → expressão. */
  equacoes?: Record<string, string>;
  /** Barra de retrocesso: só as primeiras N features regeneram (ausente = todas). */
  retrocesso?: number;
}

export interface Material {
  nome: string;
  densidade: number; // g/cm³
  cor: number;
}

export const MATERIAIS: Record<string, Material> = {
  "aco-1020": { nome: "Aço 1020", densidade: 7.87, cor: 0xb4bcc6 },
  "aco-1045": { nome: "Aço 1045", densidade: 7.85, cor: 0xaeb6c0 },
  "inox-304": { nome: "Aço inox 304", densidade: 8.0, cor: 0xc8ced6 },
  "aluminio-6061": { nome: "Alumínio 6061", densidade: 2.7, cor: 0xd3d9df },
  "aluminio-5052": { nome: "Alumínio 5052", densidade: 2.68, cor: 0xd6dce2 },
  latao: { nome: "Latão", densidade: 8.5, cor: 0xd8bf6a },
  cobre: { nome: "Cobre", densidade: 8.96, cor: 0xc98a5a },
  "ferro-fundido": { nome: "Ferro fundido cinzento", densidade: 7.2, cor: 0x8f969e },
  titanio: { nome: "Titânio Ti-6Al-4V", densidade: 4.43, cor: 0xb0b4b8 },
  abs: { nome: "ABS", densidade: 1.05, cor: 0xe8e4d8 },
  nylon: { nome: "Nylon (PA6)", densidade: 1.14, cor: 0xf0eee6 },
  pom: { nome: "POM (acetal)", densidade: 1.41, cor: 0xf4f4f0 },
  pp: { nome: "Polipropileno", densidade: 0.9, cor: 0xeef0f2 },
  pla: { nome: "PLA", densidade: 1.24, cor: 0xdfe8f0 },
};

export function novoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function documentoVazio(): Documento {
  return { formato: "jlscad", versao: 2, nome: "Peça1", features: [] };
}

export function documentoExemplo(): Documento {
  return {
    formato: "jlscad",
    versao: 2,
    nome: "Peça exemplo",
    features: [
      {
        id: novoId(), nome: "Base", tipo: "extrusao", suprimida: false,
        operacao: "adicionar", plano: "XY", deslocamento: 0, centroU: 0, centroV: 0,
        perfil: { tipo: "retangulo", largura: 80, altura: 50, raioCanto: 0 },
        profundidade: 12,
      },
      {
        id: novoId(), nome: "Ressalto", tipo: "extrusao", suprimida: false,
        operacao: "adicionar", plano: "XY", deslocamento: 12, centroU: 0, centroV: 0,
        perfil: { tipo: "circulo", diametro: 30 },
        profundidade: 18,
      },
      {
        id: novoId(), nome: "Furo central", tipo: "extrusao", suprimida: false,
        operacao: "cortar", plano: "XY", deslocamento: 30, centroU: 0, centroV: 0,
        perfil: { tipo: "circulo", diametro: 14 },
        profundidade: 30, inverter: true,
      },
    ],
  };
}

export function novoEsboco(indice: number, suporte: SuporteEsboco): FeatureEsboco {
  return {
    id: novoId(), tipo: "esboco", nome: `Esboço${indice}`, suprimida: false,
    suporte, pontos: [], geos: [], restricoes: [],
  };
}

const COND_PADRAO = (dist: number): Condicao => ({ tipo: "cego", dist });
const FINO_PADRAO = (): RecursoFino => ({ ativo: false, tipo: "uma", t1: 2, t2: 2, inverter: false });

export function novaFeature(tipo: Exclude<Feature["tipo"], "esboco">, indice: number): Feature {
  const base = { id: novoId(), suprimida: false };
  switch (tipo) {
    case "extrusao":
      return {
        ...base, tipo, nome: `Extrusão${indice}`, operacao: "adicionar",
        plano: "XY", deslocamento: 0, centroU: 0, centroV: 0,
        perfil: { tipo: "retangulo", largura: 40, altura: 40, raioCanto: 0 },
        profundidade: 10,
        de: { tipo: "plano", dist: 0, inverter: false },
        condicao: COND_PADRAO(10),
        inclinacao: { ativa: false, angulo: 5, paraFora: false },
        direcao2: { ativa: false, condicao: COND_PADRAO(10), inclinacao: { ativa: false, angulo: 5, paraFora: false } },
        fino: FINO_PADRAO(),
      };
    case "revolucao":
      return {
        ...base, tipo, nome: `Revolução${indice}`, operacao: "adicionar",
        plano: "XZ", raioInterno: 10, largura: 10, altura: 20, angulo: 360,
        direcao2: { ativa: false, angulo: 90 }, fino: FINO_PADRAO(),
      };
    case "filete":
      return { ...base, tipo, nome: `Filete${indice}`, raio: 1, itens: [], propagarTangente: true };
    case "chanfro":
      return { ...base, tipo, nome: `Chanfro${indice}`, distancia: 1, modo: "distanciaDistancia", angulo: 45, distancia2: 1, itens: [], propagarTangente: true };
    case "casca":
      return { ...base, tipo, nome: `Casca${indice}`, espessura: 2, faces: [], paraFora: false };
    case "inclinacao":
      return { ...base, tipo, nome: `Inclinação${indice}`, angulo: 3, faces: [], inverter: false };
    case "nervura":
      return { ...base, tipo, nome: `Nervura${indice}`, espessura: 3, lado: "ambos", direcao: "normal", inverterMaterial: false };
    case "furo":
      return {
        ...base, tipo, nome: `Furo${indice}`, tipoFuro: "simples", norma: "ISO", fixador: "Broca (passagem ISO 273)",
        tamanho: "M6", ajuste: "normal", condicao: { tipo: "passante", profundidade: 10, anguloPonta: 118 },
        rosca: { profundidade: 12, cosmetica: true, removerRosca: false },
      };
    case "padraoLinear":
      return {
        ...base, tipo, nome: `PadrãoLinear${indice}`, recursos: [],
        dir1: { inverter: false, espacamento: 20, instancias: 3 },
        dir2: { ativa: false, somenteSemente: false, inverter: false, espacamento: 20, instancias: 2 },
        pular: [],
      };
    case "padraoCircular":
      return { ...base, tipo, nome: `PadrãoCircular${indice}`, recursos: [], inverter: false, igual: true, angulo: 360, instancias: 6, pular: [] };
    case "espelhar":
      return { ...base, tipo, nome: `Espelhar${indice}`, recursos: [], corpo: false };
    case "planoRef":
      return { ...base, tipo, nome: `Plano${indice}`, modo: "deslocamento", distancia: 20, angulo: 45, inverter: false };
    case "eixoRef":
      return { ...base, tipo, nome: `Eixo${indice}`, modo: "aresta" };
  }
}

export const ROTULO_TIPO: Record<Feature["tipo"], string> = {
  esboco: "Esboço",
  extrusao: "Extrusão",
  revolucao: "Revolução",
  filete: "Filete",
  chanfro: "Chanfro",
  casca: "Casca",
  inclinacao: "Inclinação",
  nervura: "Nervura",
  furo: "Furo",
  padraoLinear: "Padrão linear",
  padraoCircular: "Padrão circular",
  espelhar: "Espelhar",
  planoRef: "Plano",
  eixoRef: "Eixo",
};

/** Lê arquivos antigos e completa campos novos com valores padrão. */
export function validarDocumento(dados: unknown): Documento {
  const d = dados as Documento;
  // "cad-tablet": arquivos .cadt do nome antigo do programa
  if (!d || (d.formato !== "jlscad" && (d.formato as string) !== "cad-tablet") || !Array.isArray(d.features)) {
    throw new Error("Arquivo não é um projeto JLSCAD válido.");
  }
  d.formato = "jlscad";
  for (const f of d.features) {
    if (f.tipo === "extrusao") {
      // versão 1: profundidade negativa = sentido oposto
      if (f.profundidade < 0) {
        f.profundidade = -f.profundidade;
        f.inverter = !f.inverter;
      }
      f.de ??= { tipo: "plano", dist: 0, inverter: false };
      f.condicao ??= { tipo: "cego", dist: f.profundidade };
      f.inclinacao ??= { ativa: false, angulo: 5, paraFora: false };
      f.direcao2 ??= { ativa: false, condicao: { tipo: "cego", dist: 10 }, inclinacao: { ativa: false, angulo: 5, paraFora: false } };
      f.fino ??= FINO_PADRAO();
    } else if (f.tipo === "revolucao") {
      f.direcao2 ??= { ativa: false, angulo: 90 };
      f.fino ??= FINO_PADRAO();
    } else if (f.tipo === "filete" || f.tipo === "chanfro") {
      f.itens ??= [];
    }
  }
  d.versao = 2;
  return d;
}
