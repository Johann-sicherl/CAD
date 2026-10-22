// Quais faces da peça final pertencem a cada recurso (para destacar o recurso selecionado na
// árvore). A cada passo da regeneração, as faces novas que NÃO estão sobre a superfície da peça
// anterior são "do recurso" (paredes de um furo, laterais de um ressalto, o arredondamento de um
// filete…); faces só recortadas por ele continuam do recurso que as criou. No fim, cada face da
// peça final é atribuída aos recursos cujas faces próprias a contêm.

import { DistanceQuery, makeVertex, type Face, type Shape3D } from "replicad";
import type { Vec3 } from "../model";

const TOL = 1e-4;

type Caixa = { min: Vec3; max: Vec3 };

interface FacesProprias {
  id: string;
  faces: { face: Face; caixa: Caixa | null; consulta: DistanceQuery | null }[];
}

function caixaDe(f: Face): Caixa | null {
  try {
    const b = (f.boundingBox as unknown as { bounds: [Vec3, Vec3] }).bounds;
    return b && b[0].length === 3 ? { min: b[0], max: b[1] } : null;
  } catch {
    return null;
  }
}

const dentro = (p: Vec3, c: Caixa | null, folga: number) =>
  !c || [0, 1, 2].every((i) => p[i] >= c.min[i] - folga && p[i] <= c.max[i] + folga);

function distancia(consulta: DistanceQuery, p: Vec3): number {
  const v = makeVertex(p);
  try {
    return consulta.distanceTo(v);
  } finally {
    v.delete();
  }
}

/** Um ponto que está de fato na face (o centro paramétrico pode cair num furo). */
function pontoNaFace(f: Face): Vec3 | null {
  const q = new DistanceQuery(f);
  try {
    for (const [u, v] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.3, 0.7], [0.7, 0.3], [0.5, 0.15], [0.15, 0.5], [0.5, 0.85], [0.85, 0.5], [0.1, 0.1], [0.9, 0.9]]) {
      const p = f.pointOnSurface(u, v);
      const pt: Vec3 = [p.x, p.y, p.z];
      if (distancia(q, pt) < TOL) return pt;
    }
  } catch {
    /* sem ponto confiável */
  } finally {
    q.delete();
  }
  return null;
}

export class RastreadorFaces {
  private proprias: FacesProprias[] = [];

  /** Registra as faces próprias do recurso, comparando a peça antes e depois dele. */
  registrar(id: string, antes: Shape3D | null, depois: Shape3D | null) {
    if (!depois || depois === antes) return;
    try {
      const velhas = antes ? antes.faces : [];
      const porHash = new Map<number, Face[]>();
      for (const f of velhas) {
        const h = f.hashCode;
        porHash.set(h, [...(porHash.get(h) ?? []), f]);
      }
      const consultaAntes = antes ? new DistanceQuery(antes) : null;
      const faces: FacesProprias["faces"] = [];
      for (const f of depois.faces) {
        if (porHash.get(f.hashCode)?.some((g) => g.isSame(f))) continue; // face intacta: não é deste recurso
        if (consultaAntes) {
          const p = pontoNaFace(f);
          // face nova mas sobre a superfície antiga: só foi recortada
          if (p && distancia(consultaAntes, p) < TOL) continue;
        }
        faces.push({ face: f, caixa: caixaDe(f), consulta: null });
      }
      consultaAntes?.delete();
      if (faces.length) this.proprias.push({ id, faces });
    } catch {
      /* peça anterior já liberada pelo kernel: sem destaque para este recurso */
    }
  }

  /** Índices (na ordem de `peca.faces`) das faces da peça final de cada recurso. */
  atribuir(peca: Shape3D): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    try {
      peca.faces.forEach((f, i) => {
        let p: Vec3 | null | undefined;
        for (const r of this.proprias) {
          for (const pr of r.faces) {
            let pertence = false;
            try {
              pertence = pr.face.isSame(f);
            } catch {
              pertence = false;
            }
            if (!pertence) {
              if (p === undefined) p = pontoNaFace(f);
              if (!p || !dentro(p, pr.caixa, 1e-3)) continue;
              pr.consulta ??= new DistanceQuery(pr.face);
              pertence = distancia(pr.consulta, p) < TOL;
            }
            if (pertence) {
              (out[r.id] ??= []).push(i);
              break;
            }
          }
        }
      });
    } finally {
      for (const r of this.proprias) for (const pr of r.faces) pr.consulta?.delete();
    }
    return out;
  }
}
