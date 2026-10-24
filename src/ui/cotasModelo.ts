// Cotas de um recurso mostradas sobre o modelo (duplo clique numa face): rótulos HTML presos a
// pontos 3D, que acompanham a câmera. Tocar um rótulo abre a edição no próprio lugar; Enter
// aplica (aceita expressões como "=largura/2"), Esc desiste.

import type { Vec3 } from "../model";
import type { Viewport } from "../viewport";

export interface RotuloModelo {
  /** Texto mostrado (ex.: "Ø20", "D1 10 mm"). */
  texto: string;
  /** Valor que aparece na caixa ao editar (ou a expressão, se houver). */
  edicao: string;
  pos: Vec3;
  /** Deslocamento na tela (px) para rótulos que caem no mesmo ponto. */
  desloc?: number;
  /** Só leitura (cota de referência). */
  fixo?: boolean;
  /** Aplica o texto digitado; false = valor inválido (a caixa continua aberta). */
  aplicar(t: string): boolean;
}

export class CotasNoModelo {
  private itens: { el: HTMLElement; r: RotuloModelo }[] = [];
  private readonly ouvinte = () => this.posicionar();

  constructor(private vp: Viewport, private camada: HTMLElement) {}

  get ativo(): boolean {
    return this.itens.length > 0;
  }

  mostrar(rotulos: RotuloModelo[]) {
    this.limpar();
    for (const r of rotulos) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `cota-modelo${r.fixo ? " fixa" : ""}`;
      el.textContent = r.texto;
      el.title = r.fixo ? "Cota de referência (só mede)" : "Toque para editar";
      // edição já no pointerdown: outros ouvintes do documento mexem na tela antes do "click"
      el.onpointerdown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!r.fixo) this.editar(el, r);
      };
      this.camada.appendChild(el);
      this.itens.push({ el, r });
    }
    this.vp.ouvintesCamera.add(this.ouvinte);
    this.posicionar();
  }

  private editar(el: HTMLElement, r: RotuloModelo) {
    const inp = document.createElement("input");
    inp.className = "cota-modelo-edicao";
    inp.inputMode = "decimal";
    inp.value = r.edicao;
    el.replaceWith(inp);
    inp.focus();
    inp.select();
    let feito = false; // replaceWith dispara blur: sem isso voltaria duas vezes
    const voltar = () => {
      if (feito || !inp.isConnected) return;
      feito = true;
      inp.replaceWith(el);
    };
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && r.aplicar(inp.value)) voltar();
      else if (e.key === "Enter") inp.classList.add("invalido");
      else if (e.key === "Escape") voltar();
    };
    inp.onblur = () => voltar();
    const i = this.itens.findIndex((x) => x.el === el);
    if (i >= 0) this.itens[i].el = el; // o rótulo volta no lugar da caixa
    Object.assign(inp.style, { left: el.style.left, top: el.style.top });
  }

  posicionar() {
    for (const { el, r } of this.itens) {
      const t = this.vp.mundoParaTela(r.pos);
      el.style.left = `${t.x}px`;
      el.style.top = `${t.y + (r.desloc ?? 0)}px`;
    }
    for (const inp of this.camada.querySelectorAll<HTMLElement>(".cota-modelo-edicao")) inp.style.zIndex = "2";
  }

  limpar() {
    for (const { el } of this.itens) el.remove();
    this.camada.querySelectorAll(".cota-modelo-edicao").forEach((x) => x.remove());
    this.itens = [];
    this.vp.ouvintesCamera.delete(this.ouvinte);
  }
}
