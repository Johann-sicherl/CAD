// Ícones próprios do WJCAD (WJProMaster): SVG 24×24 desenhados à mão, traço em currentColor.
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
  celular: svg(`<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 18.5h3" stroke="${C}"/>`),
  tablet: svg(`<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M11 17h2" stroke="${C}"/><path d="m17 8 2.5-2.5" stroke="${C}"/>`),
  computador: svg(`<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/><path d="M14 9.5l2 2-1 .2.8 1.6-.8.4-.8-1.6-.7.7z" stroke="${C}"/>`),
  arvore: svg(`<path d="M5 4v16M5 8h5M5 14h5"/><rect x="11" y="6" width="8" height="4" rx="1" stroke="${C}"/><rect x="11" y="12" width="8" height="4" rx="1" stroke="${C}"/>`),
  fechar: svg(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="m9.5 11.5 5 5M14.5 11.5l-5 5" stroke="${C}"/>`),

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
  // ---------- subfunções (menus ▾) ----------
  linhaCentro: svg(`<path d="M4 20 20 4" stroke="${C}" stroke-dasharray="5 2 1 2"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="4" r="1.6"/>`),
  linhaPontoMedio: svg(`<path d="M4 20 20 4" stroke="${C}"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="4" r="1.6"/><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor"/>`),
  retanguloCentro: svg(`<rect x="4" y="6" width="16" height="12" stroke="${C}"/><path d="M4 6l16 12M20 6 4 18" stroke-dasharray="2 2" stroke-opacity=".6"/><circle cx="12" cy="12" r="1.4"/>`),
  retangulo3p: svg(`<path d="M3 15 13 4l8 7-10 11z" stroke="${C}"/><circle cx="3" cy="15" r="1.4"/><circle cx="13" cy="4" r="1.4"/><circle cx="21" cy="11" r="1.4"/>`),
  retanguloCentro3p: svg(`<path d="M3 15 13 4l8 7-10 11z" stroke="${C}"/><circle cx="12" cy="13" r="1.4"/><circle cx="8" cy="9.5" r="1.2"/><circle cx="21" cy="11" r="1.4"/>`),
  paralelogramo: svg(`<path d="M7 6h14l-4 12H3z" stroke="${C}"/><circle cx="7" cy="6" r="1.4"/><circle cx="21" cy="6" r="1.4"/><circle cx="17" cy="18" r="1.4"/>`),
  rasgoCentro: svg(`<path d="M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7z" stroke="${C}"/><circle cx="12" cy="12" r="1.3"/><circle cx="16" cy="12" r="1"/>`),
  rasgoArco: svg(`<path d="M4 15a8 8 0 0 1 16 0" stroke-dasharray="2 2"/><path d="M1.5 15a10.5 10.5 0 0 1 21 0 2.5 2.5 0 0 1-5 0 5.5 5.5 0 0 0-11 0 2.5 2.5 0 0 1-5 0z" stroke="${C}"/>`),
  rasgoArcoCentro: svg(`<path d="M1.5 15a10.5 10.5 0 0 1 21 0 2.5 2.5 0 0 1-5 0 5.5 5.5 0 0 0-11 0 2.5 2.5 0 0 1-5 0z" stroke="${C}"/><circle cx="12" cy="15" r="1.3"/>`),
  circuloPerimetro: svg(`<circle cx="12" cy="12" r="8" stroke="${C}"/><circle cx="4.5" cy="9" r="1.4"/><circle cx="17" cy="5.8" r="1.4"/><circle cx="15" cy="19.4" r="1.4"/>`),
  arcoCentro: svg(`<path d="M4 18A9 9 0 0 1 20 18" stroke="${C}"/><circle cx="12" cy="18" r="1.4"/><path d="M12 18 4 18M12 18l8 0" stroke-dasharray="1.5 1.5" stroke-opacity=".6"/>`),
  arcoTangente: svg(`<path d="M3 18h7"/><path d="M10 18a6 6 0 0 0 6-6V5" stroke="${C}"/><circle cx="10" cy="18" r="1.4"/>`),
  esboco3d: svg(`<path d="M4 17l8 4 8-4M4 17V7l8-4 8 4v10" stroke-opacity=".5"/><path d="M6 15c3-6 6 2 12-7" stroke="${C}"/>`),
  splineEstilo: svg(`<path d="M3 18c4-12 10 6 18-10" stroke="${C}"/><path d="M3 18 7 6l8 12 6-10" stroke-dasharray="2 2" stroke-opacity=".6"/><rect x="5.8" y="4.8" width="2.4" height="2.4"/><rect x="13.8" y="16.8" width="2.4" height="2.4"/>`),
  curvaEquacao: svg(`<path d="M3 15c3-8 5-8 7 0s4 8 7 0" stroke="${C}"/><text x="18.5" y="9" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="serif" font-style="italic">f</text>`),
  elipse: svg(`<ellipse cx="12" cy="12" rx="9" ry="5.5" stroke="${C}"/><circle cx="12" cy="12" r="1.2"/>`),
  elipseParcial: svg(`<path d="M3 12a9 5.5 0 0 1 18 0" stroke="${C}"/><path d="M21 12a9 5.5 0 0 1-18 0" stroke-dasharray="2 2" stroke-opacity=".5"/><circle cx="12" cy="12" r="1.2"/>`),
  parabola: svg(`<path d="M4 4c2 16 14 16 16 0" stroke="${C}"/><circle cx="12" cy="10" r="1.2"/>`),
  conica: svg(`<path d="M4 19C6 8 9 5 12 5s6 3 8 14" stroke="${C}"/><path d="M4 19 12 2l8 17" stroke-dasharray="2 2" stroke-opacity=".5"/>`),
  texto: svg(`<path d="M5 20 12 4l7 16M8 14h8" stroke="${C}"/>`),
  converter: svg(`<path d="M3 9l6-4 12 4-6 4z" stroke-opacity=".5"/><path d="M3 9v7l6 4 12-4V9" stroke-opacity=".5"/><path d="M9 13v7" stroke="${C}" stroke-width="2.2"/><path d="M15 13v7" stroke="${C}" stroke-dasharray="2 2"/>`),
  silhueta: svg(`<path d="M4 18 8 6h8l4 12z" stroke="${C}" stroke-width="2"/><path d="M8 6c2 4 6 4 8 0" stroke-opacity=".5"/>`),
  intersecao: svg(`<path d="M3 8l9-4 9 4-9 4z" stroke-opacity=".5"/><path d="M3 15l9 5 9-5" stroke-opacity=".5"/><path d="M3 12l9 4 9-4" stroke="${C}" stroke-width="2"/>`),
  padraoLinearEsboco: svg(`<circle cx="5" cy="12" r="2.4"/><circle cx="12" cy="12" r="2.4" stroke="${C}"/><circle cx="19" cy="12" r="2.4" stroke="${C}"/><path d="M3 18h18M18 16l3 2-3 2"/>`),
  padraoCircularEsboco: svg(`<circle cx="12" cy="12" r="7" stroke-dasharray="2 2"/><circle cx="12" cy="5" r="1.8"/><circle cx="18.1" cy="15.5" r="1.8" stroke="${C}"/><circle cx="5.9" cy="15.5" r="1.8" stroke="${C}"/><circle cx="12" cy="12" r="1"/>`),
  exibirRelacoes: svg(`<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" stroke-opacity=".6"/><path d="M8 12h8M8 15h8" stroke="${C}"/>`),
  // curvas 3D
  helice: svg(`<path d="M6 4c12 0 12 3 0 3s-12 3 0 3 12 3 0 3-12 3 0 3 12 3 0 3" stroke="${C}"/>`),
  curvaProjetada: svg(`<path d="M3 17l9 4 9-4-9-4z" stroke-opacity=".6"/><path d="M5 7c3-3 6 3 9 0s4-2 5-1" stroke-dasharray="2 2"/><path d="M6 17c2-2 4 1 6 0s5-2 6-1" stroke="${C}"/><path d="M8 8v7M15 6v8" stroke-opacity=".4"/>`),
  curvaComposta: svg(`<path d="M3 18 9 10" stroke="${C}"/><path d="M9 10c3-4 6-4 8 0" stroke="${C}" stroke-width="2.2"/><path d="M17 10l4 8" stroke="${C}"/><circle cx="9" cy="10" r="1.3"/><circle cx="17" cy="10" r="1.3"/>`),
  curvaXYZ: svg(`<path d="M3 18c4-10 8 2 12-6s4-5 6-6" stroke="${C}"/><text x="7" y="9" font-size="5.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="700">XYZ</text>`),
  curvaPontos: svg(`<path d="M3 18c4-10 8 2 12-6s4-5 6-6" stroke="${C}"/><path d="M3 18l2-2M3 16l2 2M13 11l2 2M13 13l2-2M19 5l2 2M19 7l2-2"/>`),
  // varredura: tubo seguindo uma trajetória curva (traço do perfil no início)
  varredura: svg(`<path d="M4 19c0-7 4-11 12-11" stroke="${C}" stroke-dasharray="2 2"/><path d="M2.5 17.5c0-8 5-13 13.5-13M5.5 20.5c0-6 3.6-9.5 10.5-9.5"/><ellipse cx="4" cy="19" rx="1.6" ry="1.6"/><path d="M16 4.5v6.5"/><ellipse cx="18.5" cy="7.8" rx="1.2" ry="3.3"/>`),
  corteVarredura: svg(`<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M6 17c0-5 3-8 9-8" stroke="${C}" stroke-dasharray="2 2"/><path d="M5 15c0-5.5 3.5-9 10-9M7 19c0-4.5 3-7 8-7" stroke="${C}"/>`),
  // loft: quadrado embaixo virando círculo em cima
  loft: svg(`<path d="M5 15.5h9l4-3H9z"/><ellipse cx="13" cy="5.5" rx="4.5" ry="1.8" stroke="${C}"/><path d="M5 15.5 8.5 5.5M14 15.5l3.5-10M18 12.5 17.5 5.5" stroke="${C}"/>`),
  corteLoft: svg(`<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M7 17h7l3-2H10z" stroke="${C}"/><ellipse cx="13" cy="8" rx="3.5" ry="1.4" stroke="${C}"/><path d="M7 17l2.5-9M14 17l2.5-9" stroke="${C}"/>`),
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
  chapa: svg(`<path d="M3 15l9 4 9-4-9-4z"/><path d="M3 15v1.5l9 4 9-4V15"/><circle cx="12" cy="7" r="2.6" stroke="${C}"/><path d="M12 2.6v1.8M12 9.6v1.8M7.6 7h1.8M14.6 7h1.8" stroke="${C}"/>`),
  junta: svg(`<path d="M3 17h7l3-6h8"/><path d="M3 14h6l3-6h9" stroke="${C}"/><path d="M17 15v4m-1.5-1.5L17 19l1.5-1.5"/>`),
  meiaEsquadria: svg(`<path d="M4 20V8l4-4h12"/><path d="M7 20V9.5L9.5 7H20" stroke="${C}"/><path d="M4 8l3 1.5M8 4l1.5 3" stroke="${C}"/>`),
  aba: svg(`<path d="M3 15l9 4 9-4-9-4z"/><path d="M9 12.4V7l6-2.7v5.4" stroke="${C}"/>`),
  bainha: svg(`<path d="M3 19h12a4 4 0 0 0 0-8H8"/><path d="M3 16h12a1 1 0 0 0 0-2H8" stroke="${C}"/>`),
  corteChapa: svg(`<path d="M3 15l9 4 9-4-9-4z"/><ellipse cx="12" cy="15" rx="3.5" ry="1.6" stroke="${C}"/><path d="M12 4v7" stroke="${C}" stroke-dasharray="2 2"/>`),
  planificar: svg(`<path d="M3 12h7l4-6h7"/><path d="M3 18h18" stroke="${C}"/><path d="M12 13v3m-2-1 2 2 2-2"/>`),
  dxf: svg(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6v5H9z" stroke="${C}"/><path d="M9 12l6 5" stroke="${C}"/>`),
  material: svg(`<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M10 4v16"/><path d="M13 11.5h5" stroke="${C}"/>`),
  fecharCanto: svg(`<path d="M4 20V8h12"/><path d="M8 20V12h12" stroke="${C}"/><path d="M16 8l4 4" stroke="${C}"/>`),
  alivioCanto: svg(`<path d="M4 20V4h16"/><path d="M8 20V8h12"/><rect x="5.5" y="5.5" width="5" height="5" stroke="${C}"/>`),
  quebrarCanto: svg(`<path d="M4 20V10l6-6h10"/><path d="M4 10l6-6" stroke="${C}" stroke-width="2.2"/><path d="M8 20v-8a4 4 0 0 1 4-4h8" stroke="${C}" stroke-dasharray="2 2"/>`),
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
  face: svg(`<path d="M4 8l8-4 8 4-8 4z" fill="${C}" fill-opacity=".3" stroke="${C}"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>`),
  aresta: svg(`<path d="M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8"/><path d="M12 12v8" stroke="${C}" stroke-width="2.6"/>`),
  vertice: svg(`<path d="M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8"/><circle cx="12" cy="12" r="2.4" fill="${C}" stroke="${C}"/>`),
  espelhoDinamico: svg(`<path d="M12 3v18" stroke-dasharray="2.5 2"/><path d="M9 7 4 12l5 5" /><path d="M15 7l5 5-5 5" stroke="${C}"/><path d="M17 4.5a2.5 2.5 0 1 1 0 .01" stroke="${C}"/>`),
  configuracoes: svg(`<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1" stroke="${C}"/><rect x="3" y="13" width="8" height="7" rx="1" stroke="${C}"/><rect x="13" y="13" width="8" height="7" rx="1"/>`),
  filtroSelecao: svg(`<path d="M3 5h18l-7 8v6l-4 2v-8z" stroke="${C}"/>`),
  zoomArea: svg(`<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 21 21"/><rect x="7" y="7.5" width="6" height="5" stroke="${C}" stroke-dasharray="2 1.5"/>`),
  configVista: svg(`<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/><path d="M7 12.5c1.5-3 3-4.5 5-4.5s3.5 1.5 5 4.5" stroke="${C}"/>`),
  setaBaixo: svg(`<path d="M7 10l5 5 5-5"/>`),
  setaCima: svg(`<path d="M7 14l5-5 5 5"/>`),
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
