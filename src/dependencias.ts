// Relações pai/filho entre recursos da árvore. Um recurso é filho de outro quando guarda o id
// dele em algum campo (esboço usado, recursos de um padrão, plano/eixo de referência, plano do
// esboço…). Referências a faces/arestas são por geometria e não criam dependência aqui.

import type { Documento, Feature, FeatureEsboco } from "./model";

/** O recurso cita o id em algum campo (busca em profundidade, exceto o próprio id). */
export function citaId(f: Feature, id: string): boolean {
  const busca = (v: unknown, raiz: boolean): boolean => {
    if (typeof v === "string") return v === id;
    if (Array.isArray(v)) return v.some((x) => busca(x, false));
    if (v && typeof v === "object") {
      return Object.entries(v).some(([k, x]) => !(raiz && k === "id") && busca(x, false));
    }
    return false;
  };
  return f.id !== id && busca(f, true);
}

/** Filhos diretos e indiretos do recurso, na ordem da árvore. */
export function filhosDe(features: Feature[], id: string): Feature[] {
  const fora = new Set([id]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const f of features) {
      if (fora.has(f.id)) continue;
      if ([...fora].some((x) => citaId(f, x))) {
        fora.add(f.id);
        mudou = true;
      }
    }
  }
  return features.filter((f) => f.id !== id && fora.has(f.id));
}

/**
 * Esboços absorvidos pelos recursos excluídos (aninhados neles na árvore) que nenhum recurso
 * restante usa — podem ser excluídos junto.
 */
export function absorvidosDe(features: Feature[], excluidos: Set<string>): FeatureEsboco[] {
  const out: FeatureEsboco[] = [];
  for (const f of features) {
    if (!excluidos.has(f.id) || !("esboco" in f) || !f.esboco) continue;
    const e = features.find((x): x is FeatureEsboco => x.id === f.esboco && x.tipo === "esboco");
    if (!e || excluidos.has(e.id) || out.includes(e)) continue;
    const usadoPorOutro = features.some((x) => !excluidos.has(x.id) && citaId(x, e.id));
    if (!usadoPorOutro) out.push(e);
  }
  return out;
}

/** Remove os recursos do documento, ajustando retrocesso e equações. */
export function excluirRecursos(doc: Documento, ids: Set<string>) {
  if (doc.retrocesso !== undefined) {
    const antes = doc.features.slice(0, doc.retrocesso).filter((f) => ids.has(f.id)).length;
    doc.retrocesso -= antes;
  }
  doc.features = doc.features.filter((f) => !ids.has(f.id));
  if (doc.retrocesso !== undefined && doc.retrocesso >= doc.features.length) delete doc.retrocesso;
  if (doc.equacoes) {
    for (const k of Object.keys(doc.equacoes)) if (ids.has(k.slice(0, k.indexOf(".")))) delete doc.equacoes[k];
  }
}
