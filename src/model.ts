// Modelo paramétrico: a peça é uma lista ordenada de features (árvore de histórico).
// Regenerar = executar as features em ordem a partir do zero.

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

// ---------- esboço ----------

/** Onde o esboço está: num plano de referência (com afastamento) ou numa face plana. */
export type SuporteEsboco =
  | { tipo: "plano"; plano: Plano; deslocamento: number }
  | { tipo: "face"; origem: Vec3; normal: Vec3; eixoX: Vec3 };

export interface PontoEsboco {
  id: string;
  x: number; // coordenadas no plano do esboço (mm)
  y: number;
}

interface GeoBase {
  id: string;
  construcao?: boolean; // geometria de construção: não vira perfil (ex.: linha de centro)
}

export type GeoEsboco =
  | (GeoBase & { tipo: "linha"; p1: string; p2: string })
  | (GeoBase & { tipo: "circulo"; c: string; r: number })
  /** Arco anti-horário do ponto `ini` ao ponto `fim`, com centro `c`. */
  | (GeoBase & { tipo: "arco"; c: string; ini: string; fim: string; r: number })
  /** Curva suave que passa pelos pontos (Catmull-Rom → Bézier cúbica). */
  | (GeoBase & { tipo: "spline"; pontos: string[] });

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

// ---------- features sólidas ----------

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
  profundidade: number; // mm (negativo = sentido oposto)
}

export interface FeatureRevolucao extends FeatureBase {
  tipo: "revolucao";
  operacao: "adicionar" | "cortar";
  /** Esboço usado como perfil; o eixo é a 1ª linha de construção (ou o eixo V do esboço). */
  esboco?: string;
  plano: Plano;
  raioInterno: number;  // perfil retangular afastado do eixo
  largura: number;
  altura: number;
  angulo: number;       // graus
}

export interface FeatureFilete extends FeatureBase {
  tipo: "filete";
  raio: number;
}

export interface FeatureChanfro extends FeatureBase {
  tipo: "chanfro";
  distancia: number;
}

export type Feature = FeatureEsboco | FeatureExtrusao | FeatureRevolucao | FeatureFilete | FeatureChanfro;

export interface Documento {
  formato: "cad-tablet";
  versao: 1;
  nome: string;
  features: Feature[];
}

export function novoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function documentoVazio(): Documento {
  return { formato: "cad-tablet", versao: 1, nome: "Peça1", features: [] };
}

export function documentoExemplo(): Documento {
  return {
    formato: "cad-tablet",
    versao: 1,
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
        profundidade: -30,
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

export function novaFeature(tipo: Exclude<Feature["tipo"], "esboco">, indice: number): Feature {
  const base = { id: novoId(), suprimida: false };
  switch (tipo) {
    case "extrusao":
      return {
        ...base, tipo, nome: `Extrusão${indice}`, operacao: "adicionar",
        plano: "XY", deslocamento: 0, centroU: 0, centroV: 0,
        perfil: { tipo: "retangulo", largura: 40, altura: 40, raioCanto: 0 },
        profundidade: 10,
      };
    case "revolucao":
      return {
        ...base, tipo, nome: `Revolução${indice}`, operacao: "adicionar",
        plano: "XZ", raioInterno: 10, largura: 10, altura: 20, angulo: 360,
      };
    case "filete":
      return { ...base, tipo, nome: `Filete${indice}`, raio: 1 };
    case "chanfro":
      return { ...base, tipo, nome: `Chanfro${indice}`, distancia: 1 };
  }
}

export const ROTULO_TIPO: Record<Feature["tipo"], string> = {
  esboco: "Esboço",
  extrusao: "Extrusão",
  revolucao: "Revolução",
  filete: "Filete",
  chanfro: "Chanfro",
};

export function validarDocumento(dados: unknown): Documento {
  const d = dados as Documento;
  if (!d || d.formato !== "cad-tablet" || !Array.isArray(d.features)) {
    throw new Error("Arquivo não é um projeto CAD Tablet válido.");
  }
  return d;
}
