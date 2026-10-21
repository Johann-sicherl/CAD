// Regeneração da peça a partir da árvore de features, usando o kernel B-Rep
// (OpenCascade via replicad). Não depende do navegador: roda no Web Worker e nos testes.

import {
  draw,
  drawCircle,
  drawPolysides,
  drawRoundedRectangle,
  drawRectangle,
  measureVolume,
  Plane,
  type Drawing,
  type Shape3D,
} from "replicad";
import type { Feature, FeatureEsboco, FeatureExtrusao, FeatureRevolucao, Perfil, Vec3 } from "../model";
import { aninhamento, encontrarLacos, mapaPontos, type Laco } from "../esboco/geometria";
import { paraMundo, referencial } from "../esboco/referencial";

export interface ErroFeature {
  id: string;
  mensagem: string;
}

export interface MalhaPeca {
  vertices: Float32Array;
  normais: Float32Array;
  triangulos: Uint32Array;
  arestas: Float32Array; // pares de pontos (x,y,z) formando segmentos
  /** Faces B-Rep: trincas (início, quantidade, id) em índices de `triangulos`. */
  faces: Uint32Array;
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

// ---------- perfis a partir de esboço ----------

function desenhoDoLaco(l: Laco): Drawing {
  if (l.tipo === "circulo") return drawCircle(l.r).translate(l.c.x, l.c.y);
  const ts = l.trechos;
  const ini = ts[0].a;
  const pen = draw([ini.x, ini.y]);
  ts.forEach((t, i) => {
    // o último trecho termina exatamente no início (pontos coincidentes podem diferir no 1e-9)
    const b = i === ts.length - 1 ? ini : t.b;
    if (t.tipo === "linha") pen.lineTo([b.x, b.y]);
    else if (t.tipo === "arco") pen.threePointsArcTo([b.x, b.y], [t.meio.x, t.meio.y]);
    else pen.cubicBezierCurveTo([b.x, b.y], [t.c1.x, t.c1.y], [t.c2.x, t.c2.y]);
  });
  return pen.close();
}

/** Contornos do esboço → região plana: externos somam, internos viram furos (ilhas voltam a somar). */
export function desenhoDoEsboco(esb: FeatureEsboco): Drawing {
  const lacos = encontrarLacos(esb);
  const prof = aninhamento(lacos);
  let res: Drawing | null = null;
  const niveis = [...new Set(prof)].sort((a, b) => a - b);
  for (const n of niveis) {
    lacos.forEach((l, i) => {
      if (prof[i] !== n) return;
      const d = desenhoDoLaco(l);
      res = n % 2 === 0 ? (res ? res.fuse(d) : d) : res!.cut(d);
    });
  }
  return res!;
}

function planoDoEsboco(esb: FeatureEsboco): Plane {
  const r = referencial(esb.suporte);
  return new Plane(r.origem, r.x, r.normal);
}

function esbocoDe(f: FeatureExtrusao | FeatureRevolucao, anteriores: Map<string, FeatureEsboco>): FeatureEsboco {
  const e = anteriores.get(f.esboco!);
  if (!e) throw new Error("O esboço desta feature não existe, está suprimido ou vem depois dela na árvore.");
  return e;
}

function extrudarEsboco(f: FeatureExtrusao, esb: FeatureEsboco): Shape3D {
  if (f.profundidade === 0) throw new Error("Profundidade não pode ser zero.");
  const sk = desenhoDoEsboco(esb).sketchOnPlane(planoDoEsboco(esb)) as unknown as { extrude(d: number): Shape3D };
  return sk.extrude(f.profundidade);
}

function revolverEsboco(f: FeatureRevolucao, esb: FeatureEsboco): Shape3D {
  const r = referencial(esb.suporte);
  // eixo: primeira linha de construção do esboço; sem ela, o eixo vertical (V) do esboço
  const pts = mapaPontos(esb);
  const lc = esb.geos.find((g) => g.tipo === "linha" && g.construcao);
  let origem: Vec3 = r.origem, dir: Vec3 = r.y;
  if (lc && lc.tipo === "linha") {
    const a = pts.get(lc.p1)!, b = pts.get(lc.p2)!;
    origem = paraMundo(r, a.x, a.y);
    const pb = paraMundo(r, b.x, b.y);
    dir = [pb[0] - origem[0], pb[1] - origem[1], pb[2] - origem[2]];
  }
  const sk = desenhoDoEsboco(esb).sketchOnPlane(planoDoEsboco(esb)) as unknown as {
    revolve(e: Vec3, o: { origin: Vec3; angle: number }): Shape3D;
  };
  return sk.revolve(dir, { origin: origem, angle: Math.min(360, Math.max(1, f.angulo)) });
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
  const esbocos = new Map<string, FeatureEsboco>();

  for (const f of features) {
    if (f.suprimida) continue;
    try {
      switch (f.tipo) {
        case "esboco":
          esbocos.set(f.id, f); // não gera sólido; fica disponível para as features seguintes
          break;
        case "extrusao":
        case "revolucao": {
          const novo = f.esboco
            ? f.tipo === "extrusao" ? extrudarEsboco(f, esbocoDe(f, esbocos)) : revolverEsboco(f, esbocoDe(f, esbocos))
            : f.tipo === "extrusao" ? solidoExtrusao(f) : solidoRevolucao(f);
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
      faces: Uint32Array.from(m.faceGroups.flatMap((g) => [g.start, g.count, g.faceId])),
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
