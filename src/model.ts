// Modelo paramétrico: a peça é uma lista ordenada de features (árvore de histórico).
// Regenerar = executar as features em ordem a partir do zero.

export type Plano = "XY" | "XZ" | "YZ";

export type Perfil =
  | { tipo: "retangulo"; largura: number; altura: number; raioCanto: number }
  | { tipo: "circulo"; diametro: number }
  | { tipo: "poligono"; lados: number; diametro: number };

interface FeatureBase {
  id: string;
  nome: string;
  suprimida: boolean;
}

export interface FeatureExtrusao extends FeatureBase {
  tipo: "extrusao";
  operacao: "adicionar" | "cortar";
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

export type Feature = FeatureExtrusao | FeatureRevolucao | FeatureFilete | FeatureChanfro;

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

export function novaFeature(tipo: Feature["tipo"], indice: number): Feature {
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
