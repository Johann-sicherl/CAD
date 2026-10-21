// Painel de propriedades: gera os campos de edição a partir do tipo da feature.
// Campos numéricos têm botões − / + grandes, mais fáceis de acertar com o dedo.

import type { Feature, Perfil } from "./model";
import { NOME_PLANO, ROTULO_TIPO } from "./model";

type Campo =
  | { tipo: "num"; caminho: string; rotulo: string; unidade?: string; passo?: number; min?: number }
  | { tipo: "sel"; caminho: string; rotulo: string; opcoes: [string, string][] }
  | { tipo: "titulo"; rotulo: string };

const PLANOS: [string, string][] = (["XZ", "XY", "YZ"] as const).map((p) => [p, `Plano ${NOME_PLANO[p]} (${p})`]);

function camposDe(f: Feature): Campo[] {
  switch (f.tipo) {
    case "extrusao": {
      const perfil: Campo[] = [
        { tipo: "titulo", rotulo: "Esboço" },
        { tipo: "sel", caminho: "plano", rotulo: "Plano", opcoes: PLANOS },
        { tipo: "num", caminho: "deslocamento", rotulo: "Deslocamento do plano", unidade: "mm" },
        { tipo: "sel", caminho: "perfil.tipo", rotulo: "Perfil", opcoes: [["retangulo", "Retângulo"], ["circulo", "Círculo"], ["poligono", "Polígono"]] },
        { tipo: "num", caminho: "centroU", rotulo: "Centro U", unidade: "mm" },
        { tipo: "num", caminho: "centroV", rotulo: "Centro V", unidade: "mm" },
      ];
      if (f.perfil.tipo === "retangulo") {
        perfil.push(
          { tipo: "num", caminho: "perfil.largura", rotulo: "Largura", unidade: "mm", min: 0.01 },
          { tipo: "num", caminho: "perfil.altura", rotulo: "Altura", unidade: "mm", min: 0.01 },
          { tipo: "num", caminho: "perfil.raioCanto", rotulo: "Raio dos cantos", unidade: "mm", min: 0, passo: 0.5 },
        );
      } else if (f.perfil.tipo === "circulo") {
        perfil.push({ tipo: "num", caminho: "perfil.diametro", rotulo: "Diâmetro", unidade: "mm", min: 0.01 });
      } else {
        perfil.push(
          { tipo: "num", caminho: "perfil.lados", rotulo: "Nº de lados", passo: 1, min: 3 },
          { tipo: "num", caminho: "perfil.diametro", rotulo: "Diâmetro circunscrito", unidade: "mm", min: 0.01 },
        );
      }
      return [
        { tipo: "sel", caminho: "operacao", rotulo: "Operação", opcoes: [["adicionar", "Adicionar material"], ["cortar", "Remover material"]] },
        ...perfil,
        { tipo: "titulo", rotulo: "Extrusão" },
        { tipo: "num", caminho: "profundidade", rotulo: "Profundidade (− inverte)", unidade: "mm" },
      ];
    }
    case "revolucao":
      return [
        { tipo: "sel", caminho: "operacao", rotulo: "Operação", opcoes: [["adicionar", "Adicionar material"], ["cortar", "Remover material"]] },
        { tipo: "sel", caminho: "plano", rotulo: "Plano do perfil", opcoes: PLANOS },
        { tipo: "num", caminho: "raioInterno", rotulo: "Raio interno", unidade: "mm", min: 0 },
        { tipo: "num", caminho: "largura", rotulo: "Largura radial", unidade: "mm", min: 0.01 },
        { tipo: "num", caminho: "altura", rotulo: "Altura", unidade: "mm", min: 0.01 },
        { tipo: "num", caminho: "angulo", rotulo: "Ângulo", unidade: "°", passo: 15, min: 1 },
      ];
    case "filete":
      return [{ tipo: "num", caminho: "raio", rotulo: "Raio (todas as arestas)", unidade: "mm", passo: 0.5, min: 0.01 }];
    case "chanfro":
      return [{ tipo: "num", caminho: "distancia", rotulo: "Distância (todas as arestas)", unidade: "mm", passo: 0.5, min: 0.01 }];
  }
}

function ler(obj: object, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj);
}

function gravar(obj: object, caminho: string, valor: unknown) {
  const partes = caminho.split(".");
  const ultimo = partes.pop()!;
  const alvo = partes.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, obj as Record<string, unknown>);
  alvo[ultimo] = valor;
}

const PERFIL_PADRAO: Record<Perfil["tipo"], Perfil> = {
  retangulo: { tipo: "retangulo", largura: 40, altura: 40, raioCanto: 0 },
  circulo: { tipo: "circulo", diametro: 40 },
  poligono: { tipo: "poligono", lados: 6, diametro: 40 },
};

/**
 * Desenha o painel. `aoAlterar` recebe a feature já modificada;
 * `final` = true quando a edição deve virar um passo de desfazer.
 */
export function renderizarPropriedades(
  painel: HTMLElement,
  f: Feature | null,
  erro: string | undefined,
  aoAlterar: (f: Feature, final: boolean) => void,
  aoExcluir: (f: Feature) => void,
) {
  painel.innerHTML = "";
  painel.classList.toggle("vazio", !f);
  if (!f) {
    painel.innerHTML = `<p class="dica">Toque numa feature da árvore para editar suas cotas.</p>`;
    return;
  }

  const cab = document.createElement("div");
  cab.className = "prop-cabecalho";
  cab.innerHTML = `<span class="prop-tipo">${ROTULO_TIPO[f.tipo]}</span>`;
  const nome = document.createElement("input");
  nome.className = "prop-nome";
  nome.value = f.nome;
  nome.onchange = () => {
    f.nome = nome.value.trim() || f.nome;
    aoAlterar(f, true);
  };
  cab.appendChild(nome);
  painel.appendChild(cab);

  if (erro) {
    const e = document.createElement("p");
    e.className = "prop-erro";
    e.textContent = erro;
    painel.appendChild(e);
  }

  for (const c of camposDe(f)) {
    if (c.tipo === "titulo") {
      const h = document.createElement("h3");
      h.className = "prop-titulo";
      h.textContent = c.rotulo;
      painel.appendChild(h);
      continue;
    }
    const linha = document.createElement("label");
    linha.className = "campo";
    linha.innerHTML = `<span class="campo-rotulo">${c.rotulo}</span>`;

    if (c.tipo === "sel") {
      const s = document.createElement("select");
      for (const [v, r] of c.opcoes) s.add(new Option(r, v));
      s.value = String(ler(f, c.caminho));
      s.onchange = () => {
        if (c.caminho === "perfil.tipo" && f.tipo === "extrusao") {
          f.perfil = structuredClone(PERFIL_PADRAO[s.value as Perfil["tipo"]]);
        } else {
          gravar(f, c.caminho, s.value);
        }
        aoAlterar(f, true);
        renderizarPropriedades(painel, f, undefined, aoAlterar, aoExcluir); // campos podem mudar
      };
      linha.appendChild(s);
    } else {
      const passo = c.passo ?? 1;
      const grupo = document.createElement("div");
      grupo.className = "num";
      const menos = document.createElement("button");
      menos.type = "button";
      menos.textContent = "−";
      const inp = document.createElement("input");
      inp.type = "number";
      inp.inputMode = "decimal";
      inp.step = String(passo);
      inp.value = String(ler(f, c.caminho));
      const mais = document.createElement("button");
      mais.type = "button";
      mais.textContent = "+";
      const un = document.createElement("span");
      un.className = "unidade";
      un.textContent = c.unidade ?? "";

      const aplicar = (v: number, final: boolean) => {
        if (!Number.isFinite(v)) return;
        if (c.min !== undefined) v = Math.max(c.min, v);
        v = Math.round(v * 1000) / 1000;
        inp.value = String(v);
        gravar(f, c.caminho, v);
        aoAlterar(f, final);
      };
      inp.oninput = () => aplicar(parseFloat(inp.value.replace(",", ".")), false);
      inp.onchange = () => aplicar(parseFloat(inp.value.replace(",", ".")), true);
      menos.onclick = () => aplicar(parseFloat(inp.value) - passo, true);
      mais.onclick = () => aplicar(parseFloat(inp.value) + passo, true);

      grupo.append(menos, inp, mais, un);
      linha.appendChild(grupo);
    }
    painel.appendChild(linha);
  }

  const rodape = document.createElement("div");
  rodape.className = "prop-rodape";
  const sup = document.createElement("button");
  sup.textContent = f.suprimida ? "Reativar" : "Suprimir";
  sup.onclick = () => {
    f.suprimida = !f.suprimida;
    aoAlterar(f, true);
    renderizarPropriedades(painel, f, undefined, aoAlterar, aoExcluir);
  };
  const exc = document.createElement("button");
  exc.className = "perigo";
  exc.textContent = "Excluir";
  exc.onclick = () => aoExcluir(f);
  rodape.append(sup, exc);
  painel.appendChild(rodape);
}
