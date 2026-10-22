// Ícones próprios do CAD Tablet: SVG 24×24 desenhados à mão, traço em currentColor.
// Formas genéricas (setas, sólidos, perfis); nenhum ícone de terceiros.

const C = "#2f7fd0"; // cor de destaque usada em partes do ícone (o "novo" de cada comando)

const svg = (corpo: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;

export const ICONES = {
  // ---------- arquivo / ações rápidas ----------
  nova: svg(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M12 11v6M9 14h6" stroke="${C}"/>`),
  abrir: svg(`<path d="M3 7V5h6l2 2h8v3"/><path d="M3 7v12h15l3-9H6l-3 9"/>`),
  salvar: svg(`<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="6" stroke="${C}"/>`),
  exportar: svg(`<path d="M5 14v6h14v-6"/><path d="M12 4v11M8 8l4-4 4 4" stroke="${C}"/>`),
  desfazer: svg(`<path d="M9 7 5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-3"/>`),
  refazer: svg(`<path d="m15 7 4 4-4 4"/><path d="M19 11h-9a5 5 0 0 0 0 10h3"/>`),
  menu: svg(`<path d="M4 7h16M4 12h16M4 17h16"/>`),

  // ---------- Features ----------
  extrusao: svg(
    `<path d="M4 17l6 3 10-5-6-3z"/><path d="M4 17V9l6 3v8M10 12l10-5v8" stroke="${C}"/><path d="M4 9l10-5 6 3"/><path d="M14 4v8" stroke-dasharray="2 2"/>`,
  ),
  corte: svg(
    `<path d="M3 15l8 4 10-5-8-4z"/><path d="M3 15V8l8 4v7M11 12l10-5v7M3 8l10-5 8 4"/><ellipse cx="12" cy="9.5" rx="3" ry="1.5" stroke="${C}"/><path d="M9 9.5v4M15 9.5v4" stroke="${C}" stroke-dasharray="1.5 1.5"/>`,
  ),
  revolucao: svg(
    `<ellipse cx="12" cy="6" rx="7" ry="2.5"/><ellipse cx="12" cy="18" rx="7" ry="2.5"/><path d="M5 6v12M19 6v12"/><path d="M12 2v20" stroke-dasharray="2 2"/><path d="M15 12.5a3 1.2 0 1 1 -1-2" stroke="${C}"/><path d="m14 9 0 1.6 1.6.3" stroke="${C}"/>`,
  ),
  corteRevolucao: svg(
    `<rect x="4" y="5" width="16" height="14" rx="1"/><ellipse cx="12" cy="12" rx="4" ry="2" stroke="${C}"/><path d="M8 12v3.5a4 2 0 0 0 8 0V12" stroke="${C}"/><path d="M12 3v18" stroke-dasharray="2 2"/>`,
  ),
  filete: svg(`<path d="M4 20V10a6 6 0 0 1 6-6h10"/><path d="M4 10a6 6 0 0 1 6-6" stroke="${C}" stroke-width="2.4"/><path d="M8 20V12a4 4 0 0 1 4-4h8" stroke-dasharray="2 2"/>`),
  chanfro: svg(`<path d="M4 20V10l6-6h10"/><path d="M4 10l6-6" stroke="${C}" stroke-width="2.4"/><path d="M8 20v-8l4-4h8" stroke-dasharray="2 2"/>`),
  padraoLinear: svg(`<rect x="3" y="9" width="5" height="5"/><rect x="10" y="9" width="5" height="5" stroke="${C}"/><rect x="17" y="9" width="4" height="5" stroke="${C}"/><path d="M3 19h18M18 17l3 2-3 2"/>`),
  padraoCircular: svg(`<circle cx="12" cy="12" r="7" stroke-dasharray="2 2"/><circle cx="12" cy="5" r="2"/><circle cx="18.1" cy="15.5" r="2" stroke="${C}"/><circle cx="5.9" cy="15.5" r="2" stroke="${C}"/><circle cx="12" cy="12" r="1"/>`),
  espelhar: svg(`<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M10 6 4 9v8l6 2z"/><path d="m14 6 6 3v8l-6 2z" stroke="${C}"/>`),
  casca: svg(`<path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M7 9.5l5-2.5 5 2.5v6l-5 2.5-5-2.5z" stroke="${C}"/>`),
  nervura: svg(`<path d="M3 20h18M5 20V6M5 20 19 20"/><path d="M5 9l10 11" stroke="${C}" stroke-width="2.4"/>`),
  furo: svg(`<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 5v14M16 5v14" stroke="${C}" stroke-dasharray="2 2"/><path d="M8 5h8" stroke="${C}"/><path d="M6 5l2 3h8l2-3" stroke="${C}"/>`),

  // ---------- Sketch ----------
  esboco: svg(`<path d="M3 17l7 4 11-6-7-4z"/><path d="M8 15l3-5 5 3" stroke="${C}"/><path d="m16 3 3 3-7 7-3 1 1-3z"/>`),
  linha: svg(`<path d="M5 19 19 5" stroke="${C}"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/>`),
  retangulo: svg(`<rect x="4" y="6" width="16" height="12" stroke="${C}"/><circle cx="4" cy="6" r="1.5"/><circle cx="20" cy="18" r="1.5"/>`),
  circulo: svg(`<circle cx="12" cy="12" r="8" stroke="${C}"/><path d="M12 12h8"/><circle cx="12" cy="12" r="1.2"/>`),
  arco: svg(`<path d="M4 18A9 9 0 0 1 20 18" stroke="${C}"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="18" r="1.5"/><circle cx="12" cy="18" r="1"/>`),
  rasgo: svg(`<path d="M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7z" stroke="${C}"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><path d="M8 12h8" stroke-dasharray="2 2"/>`),
  poligono: svg(`<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" stroke="${C}"/><circle cx="12" cy="12" r="1"/>`),
  spline: svg(`<path d="M3 17c4-10 7 4 11-4s5-5 7-4" stroke="${C}"/><circle cx="3" cy="17" r="1.5"/><circle cx="11" cy="11" r="1.5"/><circle cx="21" cy="9" r="1.5"/>`),
  aparar: svg(`<path d="M4 12h6M14 12h6" stroke="${C}"/><path d="M12 4v16"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="m8.5 16.5 3-3M15.5 16.5l-3-3"/>`),
  estender: svg(`<path d="M4 18 12 10" /><path d="M12 10l6-6" stroke="${C}" stroke-dasharray="2 2"/><path d="M20 3v8" />`),
  fileteEsboco: svg(`<path d="M4 20V11a7 7 0 0 1 7-7h9"/><path d="M4 11a7 7 0 0 1 7-7" stroke="${C}" stroke-width="2.4"/><circle cx="4" cy="4" r="1.3"/>`),
  chanfroEsboco: svg(`<path d="M4 20v-9l7-7h9"/><path d="M4 11l7-7" stroke="${C}" stroke-width="2.4"/><circle cx="4" cy="4" r="1.3"/>`),
  offset: svg(`<path d="M4 18V9a5 5 0 0 1 5-5h11"/><path d="M8 18v-8a2 2 0 0 1 2-2h10" stroke="${C}"/><path d="M5 13h3" />`),
  espelharEsboco: svg(`<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 6 4 16h5z"/><path d="m15 6 5 10h-5z" stroke="${C}"/>`),
  cota: svg(`<path d="M4 6v12M20 6v12"/><path d="M4 12h16M7 10l-3 2 3 2M17 10l3 2-3 2" stroke="${C}"/>`),
  relacao: svg(`<path d="M5 19 19 5"/><path d="M5 9h6M5 13h6" stroke="${C}"/><rect x="13" y="13" width="7" height="7" rx="1" stroke="${C}"/>`),

  selecionar: svg(`<path d="M6 3l12 9-5.5 1.2L15.5 20l-2.6 1.2-3-6.6L6 18z" stroke="${C}"/>`),
  construcao: svg(`<path d="M4 20 20 4" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="6" stroke="${C}" stroke-dasharray="2 2.5"/>`),
  concluir: svg(`<path d="M3 17l7 4 11-6-7-4z"/><path d="m9 9 3 3 7-8" stroke="${C}" stroke-width="2.2"/>`),

  // ---------- Sheet Metal ----------
  flangeBase: svg(`<path d="M3 15l9 4 9-4-9-4z"/><path d="M3 15v1.5l9 4 9-4V15" stroke="${C}"/>`),
  flangeAresta: svg(`<path d="M3 17l9 4 9-4-9-4z"/><path d="M12 13V5l9-4v12" stroke="${C}"/><path d="M12 13a2 2 0 0 0 0 0"/>`),
  dobra: svg(`<path d="M3 20h8a4 4 0 0 0 4-4V4"/><path d="M3 17h8a1 1 0 0 0 1-1V4" stroke="${C}"/><path d="M14 9h6" stroke-dasharray="2 2"/>`),
  planificar: svg(`<path d="M3 12h7l4-6h7"/><path d="M3 18h18" stroke="${C}"/><path d="M12 13v3m-2-1 2 2 2-2"/>`),
  dxf: svg(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6v5H9z" stroke="${C}"/><path d="M9 12l6 5" stroke="${C}"/>`),
  material: svg(`<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M10 4v16"/><path d="M13 11.5h5" stroke="${C}"/>`),
  alivio: svg(`<path d="M4 4h16v16H4z"/><path d="M14 4v6h6" stroke="${C}"/><circle cx="14" cy="10" r="1.5" stroke="${C}"/>`),

  inclinacaoRecurso: svg(`<path d="M4 20h16"/><path d="M6 20 8 6h8l2 14"/><path d="M8 6h8" stroke="${C}" stroke-width="2.2"/><path d="M12 3v3" stroke-dasharray="1.5 1.5"/>`),
  eixoRef: svg(`<path d="M4 20 20 4" stroke="${C}" stroke-dasharray="4 2"/><circle cx="12" cy="12" r="5"/>`),
  ponto: svg(`<circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="${C}"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4" stroke-opacity=".5"/>`),
  equacoes: svg(`<path d="M5 7h6M8 4v6M5 17h6M14 5l5 5M19 5l-5 5"/><path d="M14 15h5M14 19h5" stroke="${C}"/>`),
  materialPeca: svg(`<path d="M4 9l8-5 8 5-8 5z"/><path d="M4 9v6l8 5 8-5V9" stroke="${C}"/>`),
  retrocesso: svg(`<path d="M4 12h16" stroke="${C}" stroke-width="2.4"/><path d="m8 8-4 4 4 4"/>`),

  // ---------- Avaliar ----------
  medir: svg(`<path d="M3 15 15 3l6 6L9 21z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2M6 14l1.5 1.5" stroke="${C}"/>`),
  massa: svg(`<path d="M6 9h12l2 11H4z"/><circle cx="12" cy="6" r="2.5"/><text x="12" y="18" font-size="7" text-anchor="middle" fill="${C}" stroke="none" font-family="sans-serif" font-weight="700">kg</text>`),
  propSecao: svg(`<path d="M5 5h14v4h-5v10h-4V9H5z"/><circle cx="12" cy="11" r="1.6" fill="${C}" stroke="${C}"/>`),
  vistaSecao: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5" stroke-opacity=".4"/><path d="M12 12v9l8-4.5v-9z" fill="${C}" fill-opacity=".3" stroke="${C}"/>`),
  verificar: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="m8.5 12 2.5 2.5 4.5-5" stroke="${C}" stroke-width="2"/>`),
  analiseInclinacao: svg(`<path d="M4 20h16"/><path d="M7 20 9 6h6l2 14" stroke="${C}"/><path d="M12 3v6M10 7l2 2 2-2"/>`),
  analiseEspessura: svg(`<rect x="3" y="6" width="18" height="12" rx="1"/><rect x="7" y="9" width="10" height="6" stroke="${C}"/><path d="M5 6v3M5 15v3" stroke="${C}"/>`),
  zebra: svg(`<circle cx="12" cy="12" r="8"/><path d="M6 7c4 2 8 2 12 0M4.5 11c5 2 10 2 15 0M4.5 15c5 2 10 2 15 0" stroke="${C}"/>`),
  curvatura: svg(`<path d="M3 18C7 6 17 6 21 18"/><path d="M6 12l-2-3M9 9.2 8 6M12 8.5V5M15 9.2l1-3.2M18 12l2-3" stroke="${C}"/>`),
  desempenho: svg(`<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-6" stroke="${C}" stroke-width="2"/><circle cx="12" cy="17" r="1.5"/>`),

  // ---------- árvore / referência ----------
  peca: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>`),
  plano: svg(`<path d="M3 16 9 6h12l-6 10z" stroke="${C}"/>`),
  origem: svg(`<path d="M12 12h8M12 12V4M12 12l-6 6"/><circle cx="12" cy="12" r="2" stroke="${C}"/>`),
  olho: svg(`<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`),
  olhoFechado: svg(`<path d="M2 12s4-6 10-6c2 0 3.8.6 5.2 1.5M22 12s-4 6-10 6c-2 0-3.8-.6-5.2-1.5"/><path d="M4 20 20 4"/>`),
  pasta: svg(`<path d="M3 6h6l2 2h10v11H3z"/>`),

  // ---------- barra de vistas ----------
  enquadrar: svg(`<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="9" y="9" width="6" height="6" stroke="${C}"/>`),
  vistaIso: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9" stroke="${C}"/>`),
  vistaFrontal: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-opacity=".35"/><rect x="6" y="7" width="12" height="11" stroke="${C}"/>`),
  vistas: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/><path d="M12 12 20 7.5V16.5L12 21z" fill="${C}" fill-opacity=".25" stroke="none"/>`),
  estiloSombreadoArestas: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="currentColor" fill-opacity=".22"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>`),
  estiloSombreado: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="currentColor" fill-opacity=".3" stroke="none"/><path d="M12 12 20 7.5V16.5L12 21z" fill="currentColor" fill-opacity=".25" stroke="none"/>`),
  estiloArestas: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/><path d="M4 16.5 12 12M20 16.5 12 12M12 3v9" stroke-dasharray="1.5 2" stroke-opacity=".6"/>`),
  perspectiva: svg(`<path d="M5 6h14l-3 12H8z"/><path d="M12 6v12" stroke="${C}" stroke-dasharray="2 2"/>`),
  normalA: svg(`<path d="M3 16 9 8h12l-6 8z"/><path d="M12 12V2M9.5 4.5 12 2l2.5 2.5" stroke="${C}"/>`),
} as const;

export type NomeIcone = keyof typeof ICONES;
