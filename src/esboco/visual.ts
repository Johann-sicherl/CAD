// Camada 3D do esboço: linhas grossas (LineSegments2) e pontos, no plano do esboço.
// Cores seguem o estado: preto = definido, azul = ainda livre, vermelho = conflito,
// laranja = selecionado; construção é tracejada. Fica sempre por cima da peça.

import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { FeatureEsboco } from "../model";
import { ehCota } from "../model";
import { desenharCota } from "./cotas";
import { amostrar, aninhamento, EIXO_H, EIXO_V, encontrarLacos, mapaPontos, ORIGEM, pontoNoPoligono, pontosDaGeo, type P2 } from "./geometria";
import type { Referencial } from "./referencial";

export const CORES = {
  definido: 0x1d2731,
  livre: 0x2f7fd0,
  conflito: 0xd9342b,
  selecionado: 0xf08c00,
  somenteLeitura: 0x3a78b8,
  cota: 0x2c5d8f,
  referencia: 0x8a96a3,
  eixo: 0xa8b3be,
  previa: 0x6c7a89,
  externa: 0x8a4fbf, // referência do modelo 3D (aresta/vértice da peça)
};

export interface OpcoesCamada {
  ref: Referencial;
  mmPx: number;
  resolucao: { w: number; h: number };
  editando: boolean;
  livres?: Set<string>;
  selecao?: Set<string>;
  conflitantes?: Set<string>;
  /** Geometria provisória da ferramenta (linhas em pares de pontos) e pontos de encaixe. */
  previa?: { segmentos: P2[]; pontos: P2[] };
  marcador?: P2 | null;
  mostrarEixos?: boolean;
}

type Traco = { cor: number; largura: number; tracejado: boolean };

export function construirCamada(esb: FeatureEsboco, o: OpcoesCamada): THREE.Group {
  const grupo = new THREE.Group();
  const r = o.ref;
  grupo.matrixAutoUpdate = false;
  grupo.matrix.makeBasis(new THREE.Vector3(...r.x), new THREE.Vector3(...r.y), new THREE.Vector3(...r.normal));
  grupo.matrix.setPosition(...r.origem);

  const tracos = new Map<string, { t: Traco; pos: number[] }>();
  const adicionar = (t: Traco, seg: P2[]) => {
    const k = `${t.cor}|${t.largura}|${t.tracejado}`;
    let e = tracos.get(k);
    if (!e) tracos.set(k, (e = { t, pos: [] }));
    for (const p of seg) e.pos.push(p.x, p.y, 0);
  };
  const externos = new Set(esb.geos.filter((g) => g.externa).flatMap((g) => [g.id, ...pontosDaGeo(g)]));
  const corDe = (id: string, base = CORES.definido) => {
    if (o.selecao?.has(id)) return CORES.selecionado;
    if (o.conflitantes?.has(id)) return CORES.conflito;
    if (externos.has(id)) return CORES.externa;
    if (!o.editando) return CORES.somenteLeitura;
    if (o.livres?.has(id)) return CORES.livre;
    return base;
  };

  const pts = mapaPontos(esb);
  const passo = Math.max(Math.PI / 90, Math.min(Math.PI / 12, (4 * o.mmPx) / 10));

  // eixos do esboço (selecionáveis para relações e espelho)
  if (o.editando && o.mostrarEixos) {
    const L = 600 * o.mmPx;
    adicionar({ cor: o.selecao?.has(EIXO_H) ? CORES.selecionado : CORES.eixo, largura: 1, tracejado: true }, [{ x: -L, y: 0 }, { x: L, y: 0 }]);
    adicionar({ cor: o.selecao?.has(EIXO_V) ? CORES.selecionado : CORES.eixo, largura: 1, tracejado: true }, [{ x: 0, y: -L }, { x: 0, y: L }]);
  }

  for (const g of esb.geos) {
    const pl = amostrar(g, pts, passo);
    const seg: P2[] = [];
    for (let i = 0; i + 1 < pl.length; i++) seg.push(pl[i], pl[i + 1]);
    const largura = o.editando ? (g.construcao ? 1.4 : 2.4) : 1.6;
    adicionar({ cor: corDe(g.id), largura, tracejado: !!g.construcao }, seg);
  }

  if (o.editando) {
    for (const c of esb.restricoes) {
      if (!ehCota(c)) continue;
      const d = desenharCota(c, esb, o.mmPx);
      if (!d) continue;
      const cor = o.selecao?.has(c.id) ? CORES.selecionado
        : o.conflitantes?.has(c.id) ? CORES.conflito
        : c.referencia ? CORES.referencia : CORES.cota;
      adicionar({ cor, largura: 1.2, tracejado: false }, d.segmentos);
    }
  }

  // contornos fechados sombreados: mostram o que vira perfil (furos ficam sem preenchimento)
  if (o.editando) {
    try {
      const lacos = encontrarLacos(esb);
      const prof = aninhamento(lacos);
      const mat = new THREE.MeshBasicMaterial({ color: 0x7fa9dc, transparent: true, opacity: 0.16, depthTest: false, side: THREE.DoubleSide });
      lacos.forEach((l, i) => {
        if (prof[i] % 2) return;
        const forma = new THREE.Shape(l.poligono.map((p) => new THREE.Vector2(p.x, p.y)));
        lacos.forEach((h, j) => {
          if (prof[j] === prof[i] + 1 && pontoNoPoligono(h.poligono[0], l.poligono)) {
            forma.holes.push(new THREE.Path(h.poligono.map((p) => new THREE.Vector2(p.x, p.y))));
          }
        });
        const m = new THREE.Mesh(new THREE.ShapeGeometry(forma), mat);
        m.renderOrder = 19;
        grupo.add(m);
      });
    } catch {
      /* esboço ainda aberto: sem sombreado */
    }
  }

  if (o.previa?.segmentos.length) adicionar({ cor: CORES.previa, largura: 1.6, tracejado: true }, o.previa.segmentos);

  for (const { t, pos } of tracos.values()) {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const mat = new LineMaterial({
      color: t.cor,
      linewidth: t.largura,
      dashed: t.tracejado,
      dashSize: 7 * o.mmPx,
      gapSize: 4 * o.mmPx,
      depthTest: false,
      transparent: true,
    });
    mat.resolution.set(o.resolucao.w, o.resolucao.h);
    const ls = new LineSegments2(geo, mat);
    if (t.tracejado) ls.computeLineDistances();
    ls.renderOrder = 20;
    grupo.add(ls);
  }

  // pontos (só editando): extremidades, centros, pontos de spline e a origem
  if (o.editando) {
    const pos: number[] = [];
    const cores: number[] = [];
    const cor = new THREE.Color();
    const ponto = (p: P2, c: number) => {
      pos.push(p.x, p.y, 0);
      cor.setHex(c);
      cores.push(cor.r, cor.g, cor.b);
    };
    ponto({ x: 0, y: 0 }, o.selecao?.has(ORIGEM) ? CORES.selecionado : 0x55606b);
    for (const p of esb.pontos) ponto(p, corDe(p.id));
    for (const p of o.previa?.pontos ?? []) ponto(p, CORES.previa);
    if (o.marcador) ponto(o.marcador, CORES.selecionado);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cores, 3));
    const pts3 = new THREE.Points(geo, new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    pts3.renderOrder = 21;
    grupo.add(pts3);
  }
  return grupo;
}

/** Libera a memória de GPU de uma camada antiga. */
export function descartarCamada(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
