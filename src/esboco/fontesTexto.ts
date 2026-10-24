// Fontes do texto de esboço: Noto Sans (SIL Open Font License 1.1), dos arquivos do pacote
// @fontsource/noto-sans — vão no build e no cache offline, sem download externo.

import * as opentype from "opentype.js";
import type { Font } from "opentype.js";
import normal from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url";
import italico from "@fontsource/noto-sans/files/noto-sans-latin-400-italic.woff?url";
import negrito from "@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url";
import negritoItalico from "@fontsource/noto-sans/files/noto-sans-latin-700-italic.woff?url";

const ARQUIVOS: Record<string, string> = { "0|0": normal, "0|1": italico, "1|0": negrito, "1|1": negritoItalico };
const chave = (n: boolean, i: boolean) => `${+n}|${+i}`;
const lidas = new Map<string, Font>();
const pedidas = new Map<string, Promise<Font>>();

/** Fonte já lida (para regenerar o texto sem esperar), ou null. */
export function fonteLida(n: boolean, i: boolean): Font | null {
  return lidas.get(chave(n, i)) ?? null;
}

export function carregarFonte(n: boolean, i: boolean): Promise<Font> {
  const k = chave(n, i);
  let p = pedidas.get(k);
  if (!p) {
    p = fetch(ARQUIVOS[k])
      .then((r) => r.arrayBuffer())
      .then((b) => {
        const f = opentype.parse(b);
        lidas.set(k, f);
        return f;
      });
    pedidas.set(k, p);
    p.catch(() => pedidas.delete(k));
  }
  return p;
}
