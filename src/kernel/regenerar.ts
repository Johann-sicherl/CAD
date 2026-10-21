// Regeneração da peça a partir da árvore de features, usando o kernel B-Rep
// (OpenCascade via replicad). Não depende do navegador: roda no Web Worker e nos testes.

import {
  drawCircle,
  drawPolysides,
  drawRoundedRectangle,
  drawRectangle,
  measureVolume,
  type Drawing,
  type Shape3D,
} from "replicad";
import type { Feature, FeatureExtrusao, FeatureRevolucao, Perfil } from "../model";

export interface ErroFeature {
  id: string;
  mensagem: string;
}

export interface MalhaPeca {
  vertices: Float32Array;
  normais: Float32Array;
  triangulos: Uint32Array;
  arestas: Float32Array; // pares de pontos (x,y,z) formando segmentos
}

export interface ResultadoRegeneracao {
  malha: MalhaPeca | null;
  erros: ErroFeature[];
  volume: number | null; // mm³
}

function desenharPerfil(p: Perfil): Drawing {
  switch (p.tipo) {
    case "retangulo":
      return p.raioCanto > 0
        ? drawRoundedRectangle(p.largura, p.altura, p.raioCanto)
        : drawRectangle(p.largura, p.altura);
    case "circulo":
      return drawCircle(p.diametro / 2);
    case "poligono":
      return drawPolysides(p.diametro / 2, Math.max(3, Math.round(p.lados)));
  }
}

function solidoExtrusao(f: FeatureExtrusao): Shape3D {
  if (f.profundidade === 0) throw new Error("Profundidade não pode ser zero.");
  const desenho = desenharPerfil(f.perfil).translate(f.centroU, f.centroV);
  const esboco = desenho.sketchOnPlane(f.plano, f.deslocamento);
  return (esboco as { extrude(d: number): Shape3D }).extrude(f.profundidade);
}

function solidoRevolucao(f: FeatureRevolucao): Shape3D {
  if (f.largura <= 0 || f.altura <= 0) throw new Error("Largura e altura devem ser positivas.");
  if (f.raioInterno < 0) throw new Error("O perfil não pode cruzar o eixo.");
  const desenho = drawRectangle(f.largura, f.altura).translate(
    f.raioInterno + f.largura / 2,
    f.altura / 2,
  );
  const esboco = desenho.sketchOnPlane(f.plano);
  // O eixo de revolução é o eixo "vertical" do plano do esboço.
  const eixo: [number, number, number] = f.plano === "XY" ? [0, 1, 0] : [0, 0, 1];
  const angulo = Math.min(360, Math.max(1, f.angulo));
  return (esboco as { revolve(e: [number, number, number], o: { angle: number }): Shape3D })
    .revolve(eixo, { angle: angulo });
}

export function regenerar(features: Feature[], tolerancia = 0.05): ResultadoRegeneracao {
  const erros: ErroFeature[] = [];
  let peca: Shape3D | null = null;

  for (const f of features) {
    if (f.suprimida) continue;
    try {
      switch (f.tipo) {
        case "extrusao":
        case "revolucao": {
          const novo = f.tipo === "extrusao" ? solidoExtrusao(f) : solidoRevolucao(f);
          if (f.operacao === "adicionar") {
            peca = peca ? peca.fuse(novo) : novo;
          } else {
            if (!peca) throw new Error("Não há sólido para cortar.");
            peca = peca.cut(novo);
          }
          break;
        }
        case "filete":
          if (!peca) throw new Error("Não há sólido para aplicar filete.");
          if (f.raio <= 0) throw new Error("Raio deve ser positivo.");
          peca = peca.fillet(f.raio);
          break;
        case "chanfro":
          if (!peca) throw new Error("Não há sólido para aplicar chanfro.");
          if (f.distancia <= 0) throw new Error("Distância deve ser positiva.");
          peca = peca.chamfer(f.distancia);
          break;
      }
    } catch (e) {
      // A feature com falha é ignorada e a regeneração continua com a peça anterior,
      // como um CAD faz ao marcar a feature em vermelho na árvore.
      erros.push({ id: f.id, mensagem: traduzirErro(e) });
    }
  }

  if (!peca) return { malha: null, erros, volume: null };

  const m = peca.mesh({ tolerance: tolerancia, angularTolerance: 15 });
  const a = peca.meshEdges({ tolerance: tolerancia, angularTolerance: 15 });
  let volume: number | null = null;
  try {
    volume = measureVolume(peca);
  } catch {
    volume = null;
  }
  ultimaPeca = peca;
  return {
    malha: {
      vertices: Float32Array.from(m.vertices),
      normais: Float32Array.from(m.normals),
      triangulos: Uint32Array.from(m.triangles),
      arestas: Float32Array.from(a.lines),
    },
    erros,
    volume,
  };
}

let ultimaPeca: Shape3D | null = null;

export function exportar(formato: "step" | "stl"): Blob {
  if (!ultimaPeca) throw new Error("Não há peça para exportar.");
  return formato === "step"
    ? ultimaPeca.blobSTEP()
    : ultimaPeca.blobSTL({ tolerance: 0.01, angularTolerance: 5, binary: true } as never);
}

function traduzirErro(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/fillet|chamfer/i.test(msg)) return "Raio/distância grande demais para as arestas da peça.";
  if (/boolean|fuse|cut/i.test(msg)) return "Falha na operação booleana.";
  // Exceções C++ do OpenCascade chegam como números ou WebAssembly.Exception, sem texto útil.
  if (typeof e === "number" || /WebAssembly|object/i.test(msg)) {
    return "O kernel não conseguiu gerar esta geometria (valor grande demais ou perfil inválido).";
  }
  return msg;
}
