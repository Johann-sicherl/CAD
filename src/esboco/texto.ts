// Texto de esboço: monta os contornos das letras a partir de uma fonte (opentype.js) e das opções
// do painel. Função pura sobre a fonte já lida — roda no navegador e nos testes em Node. O
// carregamento das fontes (arquivos do pacote) fica em fontesTexto.ts.

import type { Font } from "opentype.js";
import type { ComandoTexto, OpcoesTexto } from "../model";
import { rot90, type P2 } from "./geometria";

export const OPCOES_TEXTO_PADRAO: OpcoesTexto = {
  texto: "Texto",
  altura: 5,
  negrito: false,
  italico: false,
  angulo: 0,
  alinhamento: "esquerda",
  inverterV: false,
  inverterH: false,
  largura: 100,
  espacamento: 100,
  fonte: "noto-sans",
};

/** Curva que o texto segue, nas coordenadas locais do texto (relativas ao ponto de ancoragem). */
export type GuiaTexto =
  | { tipo: "reta"; a: P2; b: P2 }
  /** Arco anti-horário de a0 a a1 (círculo: a1 = a0 + 2π); o texto corre de a1 para a0 (por cima, legível). */
  | { tipo: "arco"; c: P2; r: number; a0: number; a1: number };

interface Letra {
  /** Contornos com X ao longo da linha de base (a partir de 0) e Y para cima. */
  cmds: ComandoTexto[][];
  x0: number;
  x1: number;
}

const arred = (v: number) => Math.round(v * 1e4) / 1e4;

/** Aplica `f` a todos os pontos (inclusive de controle) dos comandos. */
export function mapearComandos(cs: ComandoTexto[], f: (p: P2) => P2): ComandoTexto[] {
  return cs.map((c): ComandoTexto => {
    if (c[0] === "Z") return c;
    const ps: number[] = [];
    for (let i = 1; i < c.length; i += 2) {
      const q = f({ x: c[i] as number, y: c[i + 1] as number });
      ps.push(arred(q.x), arred(q.y));
    }
    return [c[0], ...ps] as ComandoTexto;
  });
}

/** Contornos das letras (em mm, relativos à ancoragem) com as opções do painel. */
export function gerarContornos(fonte: Font, o: OpcoesTexto, guia?: GuiaTexto | null): ComandoTexto[][] {
  const upm = fonte.unitsPerEm;
  const cap = fonte.tables.os2?.sCapHeight || upm * 0.714;
  const s = Math.max(1e-6, o.altura) / cap;
  const sx = (s * Math.max(1, o.largura)) / 100;
  const glifos = fonte.stringToGlyphs(o.texto.replace(/\s+/g, " "));

  // 1. letras ao longo da linha de base
  const letras: Letra[] = [];
  let x = 0;
  glifos.forEach((g, i) => {
    const cmds: ComandoTexto[][] = [];
    let atual: ComandoTexto[] = [];
    const px = (u: number) => x + u * sx, py = (v: number) => -v * s; // a fonte vem com Y para baixo
    for (const c of g.getPath(0, 0, upm).commands) {
      if (c.type === "M") {
        if (atual.length) cmds.push(atual);
        atual = [["M", px(c.x!), py(c.y!)]];
      } else if (c.type === "L") atual.push(["L", px(c.x!), py(c.y!)]);
      else if (c.type === "Q") atual.push(["Q", px(c.x1!), py(c.y1!), px(c.x!), py(c.y!)]);
      else if (c.type === "C") atual.push(["C", px(c.x1!), py(c.y1!), px(c.x2!), py(c.y2!), px(c.x!), py(c.y!)]);
      else atual.push(["Z"]);
    }
    if (atual.length) cmds.push(atual);
    const kern = i + 1 < glifos.length ? fonte.getKerningValue(g, glifos[i + 1]) : 0;
    const avanco = ((g.advanceWidth ?? 0) + kern) * sx * (Math.max(0, o.espacamento) / 100);
    letras.push({ cmds, x0: x, x1: x + (g.advanceWidth ?? 0) * sx });
    x += avanco;
  });
  const largura = letras.length ? letras[letras.length - 1].x1 : 0;

  // 2. comprimento disponível e deslocamento pelo alinhamento
  const comprimento = guia ? (guia.tipo === "reta" ? Math.hypot(guia.b.x - guia.a.x, guia.b.y - guia.a.y) : guia.r * (guia.a1 - guia.a0)) : largura;
  let folgaPorLetra = 0, inicio = 0;
  if (guia && o.alinhamento === "justificado" && letras.length > 1) folgaPorLetra = (comprimento - largura) / (letras.length - 1);
  else if (o.alinhamento === "centro") inicio = guia ? (comprimento - largura) / 2 : -largura / 2;
  else if (o.alinhamento === "direita") inicio = guia ? comprimento - largura : -largura;

  // 3. posição final de cada letra (rígida: as letras não se deformam na curva)
  const total = guia ? comprimento : largura;
  const out: ComandoTexto[][] = [];
  letras.forEach((l, i) => {
    const desl = inicio + folgaPorLetra * i;
    let xc = desl + (l.x0 + l.x1) / 2;
    const flip = (q: P2): P2 => {
      let X = q.x + desl, Y = q.y;
      if (o.inverterH) X = (guia ? total : 0) + (guia ? 0 : 2 * inicio + largura) - X;
      if (o.inverterV) Y = o.altura - Y;
      return { x: X, y: Y };
    };
    if (o.inverterH) xc = (guia ? total : 2 * inicio + largura) - xc;
    let lugar: (q: P2) => P2;
    if (!guia) {
      const a = (o.angulo * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
      lugar = (q) => ({ x: q.x * co - q.y * si, y: q.x * si + q.y * co });
    } else if (guia.tipo === "reta") {
      const L = comprimento || 1;
      const u = { x: (guia.b.x - guia.a.x) / L, y: (guia.b.y - guia.a.y) / L }, n = rot90(u);
      lugar = (q) => ({ x: guia.a.x + u.x * q.x + n.x * q.y, y: guia.a.y + u.y * q.x + n.y * q.y });
    } else {
      const th = guia.a1 - xc / guia.r;
      const n = { x: Math.cos(th), y: Math.sin(th) }, t = { x: n.y, y: -n.x };
      lugar = (q) => {
        const dx = q.x - xc, r = guia.r + q.y;
        return { x: guia.c.x + n.x * r + t.x * dx, y: guia.c.y + n.y * r + t.y * dx };
      };
    }
    for (const c of l.cmds) out.push(mapearComandos(c, (q) => lugar(flip(q))));
  });
  return out;
}
