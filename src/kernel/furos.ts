// Tabelas ISO para o furo assistido (rosca métrica grossa).
// Passagem: ISO 273 (fina/média/grossa = apertado/normal/folgado).
// Rebaixo para cabeça cilíndrica ISO 4762: Ø e profundidade conforme DIN 974-1 (série 1).
// Escareado 90° para cabeça chata ISO 10642: Ø = dk máximo teórico.
// Valores de referência: confira com a norma/fornecedor antes de fabricar; o painel permite
// "dimensionamento personalizado" para sobrescrever qualquer um.

import type { FeatureFuro } from "../model";

export interface MedidaISO {
  passo: number;
  clr: [number, number, number]; // apertado, normal, folgado
  rebaixo?: [number, number]; // Ø, profundidade
  escareado?: number; // Ø a 90°
}

export const ISO: Record<string, MedidaISO> = {
  "M1,6": { passo: 0.35, clr: [1.7, 1.8, 2.0], rebaixo: [3.5, 1.8] },
  M2: { passo: 0.4, clr: [2.2, 2.4, 2.6], rebaixo: [4.4, 2.3], escareado: 4.4 },
  "M2,5": { passo: 0.45, clr: [2.7, 2.9, 3.1], rebaixo: [5.5, 2.8], escareado: 5.5 },
  M3: { passo: 0.5, clr: [3.2, 3.4, 3.6], rebaixo: [6.5, 3.4], escareado: 6.72 },
  M4: { passo: 0.7, clr: [4.3, 4.5, 4.8], rebaixo: [8, 4.4], escareado: 8.96 },
  M5: { passo: 0.8, clr: [5.3, 5.5, 5.8], rebaixo: [10, 5.4], escareado: 11.2 },
  M6: { passo: 1.0, clr: [6.4, 6.6, 7.0], rebaixo: [11, 6.4], escareado: 13.44 },
  M8: { passo: 1.25, clr: [8.4, 9.0, 10.0], rebaixo: [15, 8.6], escareado: 17.92 },
  M10: { passo: 1.5, clr: [10.5, 11.0, 12.0], rebaixo: [18, 10.6], escareado: 22.4 },
  M12: { passo: 1.75, clr: [13.0, 13.5, 14.5], rebaixo: [20, 12.6], escareado: 26.88 },
  M14: { passo: 2.0, clr: [15.0, 15.5, 16.5], rebaixo: [24, 14.6], escareado: 30.8 },
  M16: { passo: 2.0, clr: [17.0, 17.5, 18.5], rebaixo: [26, 16.6], escareado: 33.6 },
  M20: { passo: 2.5, clr: [21.0, 22.0, 24.0], rebaixo: [33, 20.6], escareado: 40.32 },
  M24: { passo: 3.0, clr: [25.0, 26.0, 28.0], rebaixo: [40, 24.8] },
  M30: { passo: 3.5, clr: [31.0, 33.0, 35.0], rebaixo: [48, 30.8] },
  M36: { passo: 4.0, clr: [37.0, 39.0, 42.0], rebaixo: [57, 36.8] },
  M42: { passo: 4.5, clr: [43.0, 45.0, 48.0] },
  M48: { passo: 5.0, clr: [50.0, 52.0, 56.0] },
  M56: { passo: 5.5, clr: [58.0, 62.0, 66.0] },
  M64: { passo: 6.0, clr: [66.0, 70.0, 74.0] },
};

export const TAMANHOS = Object.keys(ISO);

export const FIXADORES: Record<FeatureFuro["tipoFuro"], string[]> = {
  simples: ["Broca (passagem ISO 273)"],
  rebaixado: ["ISO 4762 cabeça cilíndrica"],
  escareado: ["ISO 10642 cabeça chata"],
  roscado: ["Rosca métrica grossa"],
};

export const nominal = (t: string) => parseFloat(t.replace("M", "").replace(",", "."));

/** Medidas efetivas do furo (padrão ISO ou personalizadas). */
export function medidasFuro(f: FeatureFuro) {
  const m = ISO[f.tamanho] ?? ISO.M6;
  const d = nominal(f.tamanho);
  const iAjuste = f.ajuste === "apertado" ? 0 : f.ajuste === "folgado" ? 2 : 1;
  const brocaRosca = Math.round((d - m.passo) * 100) / 100;
  let diametro = f.tipoFuro === "roscado" ? (f.rosca?.removerRosca ? d : brocaRosca) : m.clr[iAjuste];
  let diamRebaixo = m.rebaixo?.[0] ?? d * 1.8;
  let profRebaixo = m.rebaixo?.[1] ?? d + 0.5;
  let diamEscareado = m.escareado ?? d * 2;
  let anguloEscareado = 90;
  const p = f.personalizado;
  if (p?.ativo) {
    diametro = p.diametro;
    diamRebaixo = p.diamRebaixo;
    profRebaixo = p.profRebaixo;
    diamEscareado = p.diamEscareado;
    anguloEscareado = p.anguloEscareado;
  }
  return { diametro, diamRebaixo, profRebaixo, diamEscareado, anguloEscareado, passo: m.passo, nominal: d, brocaRosca };
}

/** Texto da nota do furo (como numa chamada de desenho). */
export function notaFuro(f: FeatureFuro): string {
  const m = medidasFuro(f);
  const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const prof = f.condicao.tipo === "passante" ? "passante" : `↧ ${fmt(f.condicao.profundidade)}`;
  switch (f.tipoFuro) {
    case "simples":
      return `Ø${fmt(m.diametro)} ${prof}`;
    case "rebaixado":
      return `Ø${fmt(m.diametro)} ${prof} · ⌴ Ø${fmt(m.diamRebaixo)} ↧ ${fmt(m.profRebaixo)}`;
    case "escareado":
      return `Ø${fmt(m.diametro)} ${prof} · ⌵ Ø${fmt(m.diamEscareado)} × ${fmt(m.anguloEscareado)}°`;
    case "roscado":
      return `${f.tamanho}×${fmt(m.passo)} ↧ ${fmt(f.rosca?.profundidade ?? 0)} · broca Ø${fmt(m.diametro)} ${prof}`;
  }
}
