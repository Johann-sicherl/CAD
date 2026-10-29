// Modelo da montagem (.wjasm): peças embutidas, componentes (instâncias com posição e rotação),
// posicionamentos (mates) e a matemática das transformações. Puro: testado em
// scripts/teste-montagem.ts. Comportamento: docs/funcional/montagem.md.

import type { Documento, Referencia, Vec3 } from "../model";

// ---------- transformações (posição + rotação em quatérnio) ----------

/** Quatérnio unitário [x, y, z, w]. */
export type Quat = [number, number, number, number];

export interface Transformacao {
  pos: Vec3;
  rot: Quat;
}

export const IDENTIDADE = (): Transformacao => ({ pos: [0, 0, 0], rot: [0, 0, 0, 1] });

export function multQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function normalizarQuat(q: Quat): Quat {
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export const conjugado = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** Rotação de `graus` em torno do eixo (não precisa ser unitário). */
export function quatEixoAngulo(eixo: Vec3, graus: number): Quat {
  const n = Math.hypot(...eixo) || 1;
  const a = (graus * Math.PI) / 360;
  const s = Math.sin(a) / n;
  return [eixo[0] * s, eixo[1] * s, eixo[2] * s, Math.cos(a)];
}

/** Gira o vetor pelo quatérnio. */
export function girar(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 · (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Ponto do componente → montagem. */
export const aplicarPonto = (t: Transformacao, p: Vec3): Vec3 => {
  const r = girar(t.rot, p);
  return [r[0] + t.pos[0], r[1] + t.pos[1], r[2] + t.pos[2]];
};
/** Direção do componente → montagem (só a rotação). */
export const aplicarDirecao = (t: Transformacao, d: Vec3): Vec3 => girar(t.rot, d);

/** a ∘ b: aplica b e depois a. */
export function compor(a: Transformacao, b: Transformacao): Transformacao {
  return { pos: aplicarPonto(a, b.pos), rot: normalizarQuat(multQuat(a.rot, b.rot)) };
}

export function inverter(t: Transformacao): Transformacao {
  const ri = conjugado(t.rot);
  const p = girar(ri, t.pos);
  return { pos: [-p[0], -p[1], -p[2]], rot: ri };
}

/** Ângulos (graus) em torno de X, Y e Z da montagem, aplicados nessa ordem. */
export function quatDeEuler(rx: number, ry: number, rz: number): Quat {
  return normalizarQuat(multQuat(quatEixoAngulo([0, 0, 1], rz), multQuat(quatEixoAngulo([0, 1, 0], ry), quatEixoAngulo([1, 0, 0], rx))));
}

/** Gira a transformação em torno de um ponto da montagem (centro) por um quatérnio. */
export function girarEmTorno(t: Transformacao, q: Quat, centro: Vec3): Transformacao {
  const rel: Vec3 = [t.pos[0] - centro[0], t.pos[1] - centro[1], t.pos[2] - centro[2]];
  const r = girar(q, rel);
  return { pos: [r[0] + centro[0], r[1] + centro[1], r[2] + centro[2]], rot: normalizarQuat(multQuat(q, t.rot)) };
}

/** Matriz 4×4 em ordem de colunas (Three.js `Matrix4.fromArray`). */
export function matriz(t: Transformacao): number[] {
  const [x, y, z, w] = t.rot;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    t.pos[0], t.pos[1], t.pos[2], 1,
  ];
}

// ---------- documento ----------

/** Peça (ou submontagem, futura) usada pelos componentes, com a cópia embutida. */
export interface PecaEmbutida {
  id: string;
  /** nome do arquivo sem extensão (ex.: "Eixo") */
  nome: string;
  /** arquivo do cofre (WJPDM) de onde veio; ausente = veio do aparelho */
  arquivo?: string;
  /** versão do cofre embutida (atualização ao abrir) */
  versao?: number;
  /** marca do conteúdo embutido (compara com o cofre sem guardar outra cópia) */
  marca?: string;
  doc: Documento;
}

export interface ComponenteMontagem {
  id: string;
  /** PecaEmbutida.id */
  peca: string;
  /** número da instância: Eixo<1>, Eixo<2>… */
  instancia: number;
  t: Transformacao;
  fixo: boolean;
  oculto?: boolean;
  suprimido?: boolean;
  /** instância gerada por um padrão/espelhamento (PadraoComponentes.id): segue a semente */
  padrao?: string;
  /** de qual semente e com qual cópia (índice) veio */
  semente?: string;
  copia?: number;
}

/** Padrão de componentes (linear, circular) ou espelhamento: gera instâncias que seguem as sementes. */
export type PadraoComponentes = {
  id: string;
  nome: string;
  sementes: string[];
  suprimido?: boolean;
} & (
  /** direção 1 (e 2): passo em mm e total de cópias, contando a semente */
  | { tipo: "linear"; dir: Vec3; passo: number; n: number; dir2?: Vec3; passo2?: number; n2?: number }
  /** em torno do eixo (ponto, direção): total de instâncias e ângulo total (360 = igualmente espaçadas) */
  | { tipo: "circular"; ponto: Vec3; eixo: Vec3; n: number; angulo: number }
  /** plano (ponto, normal): cópia na posição espelhada, mesma orientação (peças simétricas) */
  | { tipo: "espelho"; ponto: Vec3; normal: Vec3 }
);

/** Um passo da vista explodida: componentes deslocados numa direção. */
export interface PassoExplosao {
  id: string;
  comps: string[];
  dir: Vec3;
  dist: number;
}

/** Entidade de um componente (face/aresta/vértice em coordenadas da peça) ou da montagem (comp null). */
export interface RefMontagem {
  comp: string | null;
  ref: Referencia;
}

export type TipoPosicionamento = "coincidente" | "paralelo" | "perpendicular" | "tangente" | "concentrico" | "travar" | "distancia" | "angulo";

export interface Posicionamento {
  id: string;
  nome: string;
  tipo: TipoPosicionamento;
  a: RefMontagem | null;
  b: RefMontagem | null;
  /** normais/eixos no mesmo sentido (alinhado) ou opostos (antialinhado); "auto": o mais perto */
  alinhamento: "alinhado" | "antialinhado" | "auto";
  /** distância (mm) ou ângulo (graus) */
  valor?: number;
  /** lado da distância/ângulo invertido */
  inverter?: boolean;
  suprimido?: boolean;
  /** Travar: posição de b vista de a, gravada ao criar */
  rel?: Transformacao;
}

export interface DocumentoMontagem {
  formato: "wjasm";
  versao: 1;
  nome: string;
  pecas: PecaEmbutida[];
  componentes: ComponenteMontagem[];
  posicionamentos: Posicionamento[];
  padroes?: PadraoComponentes[];
  explosao?: PassoExplosao[];
}

export const novoIdM = () => Math.random().toString(36).slice(2, 10);

export function montagemVazia(nome = "Montagem1"): DocumentoMontagem {
  return { formato: "wjasm", versao: 1, nome, pecas: [], componentes: [], posicionamentos: [], padroes: [], explosao: [] };
}

/** Lê um arquivo .wjasm e completa campos novos. */
export function validarMontagem(dados: unknown): DocumentoMontagem {
  const d = dados as DocumentoMontagem;
  if (!d || d.formato !== "wjasm" || !Array.isArray(d.componentes)) throw new Error("Arquivo não é uma montagem WJCAD válida (.wjasm).");
  d.pecas ??= [];
  d.posicionamentos ??= [];
  d.padroes ??= [];
  d.explosao ??= [];
  const pecas = new Set(d.pecas.map((p) => p.id));
  // componente cuja peça sumiu do arquivo: não dá para mostrar
  d.componentes = d.componentes.filter((c) => pecas.has(c.peca));
  for (const c of d.componentes) {
    c.t ??= IDENTIDADE();
    c.fixo ??= false;
  }
  return d;
}

/** Nome na árvore: "Eixo<1>". */
export function rotuloComponente(d: DocumentoMontagem, c: ComponenteMontagem): string {
  const p = d.pecas.find((x) => x.id === c.peca);
  return `${p?.nome ?? "?"}<${c.instancia}>`;
}

/** Próximo número de instância da peça (não reaproveita números de instâncias excluídas no meio). */
export function proximaInstancia(d: DocumentoMontagem, peca: string): number {
  return Math.max(0, ...d.componentes.filter((c) => c.peca === peca).map((c) => c.instancia)) + 1;
}

/** Marca curta do conteúdo (FNV-1a 32 bits em base 36): compara documentos sem guardar cópias. */
export function marcaDe(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Embute a peça (ou reaproveita a já embutida do mesmo arquivo/conteúdo) e devolve o id dela.
 */
export function embutirPeca(d: DocumentoMontagem, doc: Documento, origem: { arquivo?: string; versao?: number; nome?: string } = {}): string {
  const texto = JSON.stringify(doc.features);
  const marca = marcaDe(`${texto}|${doc.material ?? ""}`);
  const igual = d.pecas.find((p) => (origem.arquivo ? p.arquivo === origem.arquivo : !p.arquivo && p.marca === marca));
  if (igual) {
    // mesmo arquivo do cofre com conteúdo novo: atualiza a cópia embutida (todas as instâncias)
    if (igual.marca !== marca) Object.assign(igual, { doc, marca, versao: origem.versao ?? igual.versao });
    return igual.id;
  }
  const nomeBase = (origem.nome ?? doc.nome).replace(/\.(wjcad|jlscad|cadt)$/i, "") || "Peça";
  // nomes iguais de arquivos diferentes: "Eixo (2)" para distinguir na árvore
  let nome = nomeBase;
  for (let k = 2; d.pecas.some((p) => p.nome === nome); k++) nome = `${nomeBase} (${k})`;
  const p: PecaEmbutida = { id: novoIdM(), nome, arquivo: origem.arquivo, versao: origem.versao, marca, doc };
  d.pecas.push(p);
  return p.id;
}

/** Insere um componente; o primeiro da montagem entra fixo na origem (como nos CADs profissionais). */
export function inserirComponente(d: DocumentoMontagem, peca: string, t: Transformacao = IDENTIDADE()): ComponenteMontagem {
  const primeiro = d.componentes.length === 0;
  const c: ComponenteMontagem = { id: novoIdM(), peca, instancia: proximaInstancia(d, peca), t: primeiro ? IDENTIDADE() : t, fixo: primeiro };
  d.componentes.push(c);
  return c;
}

/** Exclui componentes e os posicionamentos que os usam; peças embutidas sem uso saem do arquivo. */
export function excluirComponentes(d: DocumentoMontagem, ids: string[]) {
  const sai = new Set(ids);
  d.componentes = d.componentes.filter((c) => !sai.has(c.id));
  d.posicionamentos = d.posicionamentos.filter((m) => !(m.a?.comp && sai.has(m.a.comp)) && !(m.b?.comp && sai.has(m.b.comp)));
  const usadas = new Set(d.componentes.map((c) => c.peca));
  d.pecas = d.pecas.filter((p) => usadas.has(p.id));
}

/** Quantidade de cada peça (componentes não suprimidos): base da lista de materiais e das referências do cofre. */
export function quantidades(d: DocumentoMontagem): { peca: PecaEmbutida; qtd: number }[] {
  const n = new Map<string, number>();
  for (const c of d.componentes) if (!c.suprimido) n.set(c.peca, (n.get(c.peca) ?? 0) + 1);
  return d.pecas.filter((p) => n.has(p.id)).map((p) => ({ peca: p, qtd: n.get(p.id)! }));
}

// ---------- padrões e espelhamento de componentes ----------

const unit3 = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** Transformações das cópias (sem a semente) de um padrão, aplicadas à pose da semente. */
export function copiasDoPadrao(p: PadraoComponentes, semente: Transformacao, centroLocal: Vec3 = [0, 0, 0]): Transformacao[] {
  const out: Transformacao[] = [];
  if (p.tipo === "linear") {
    const d1 = unit3(p.dir), d2 = p.dir2 ? unit3(p.dir2) : null;
    const n2 = d2 ? Math.max(1, Math.round(p.n2 ?? 1)) : 1;
    for (let j = 0; j < n2; j++) for (let i = 0; i < Math.max(1, Math.round(p.n)); i++) {
      if (!i && !j) continue;
      const o: Vec3 = [0, 1, 2].map((k) => d1[k] * p.passo * i + (d2 ? d2[k] * (p.passo2 ?? 0) * j : 0)) as Vec3;
      out.push({ pos: [semente.pos[0] + o[0], semente.pos[1] + o[1], semente.pos[2] + o[2]], rot: semente.rot });
    }
  } else if (p.tipo === "circular") {
    const n = Math.max(1, Math.round(p.n));
    // 360°: n instâncias igualmente espaçadas; menos que isso: n instâncias de 0 até o ângulo
    const passo = Math.abs(p.angulo) >= 360 - 1e-9 ? p.angulo / n : n > 1 ? p.angulo / (n - 1) : 0;
    for (let i = 1; i < n; i++) out.push(girarEmTorno(semente, quatEixoAngulo(p.eixo, passo * i), p.ponto));
  } else {
    // espelho do centro do componente pelo plano; a orientação fica (peça simétrica)
    const nn = unit3(p.normal);
    const c = aplicarPonto(semente, centroLocal);
    const dist = (c[0] - p.ponto[0]) * nn[0] + (c[1] - p.ponto[1]) * nn[1] + (c[2] - p.ponto[2]) * nn[2];
    out.push({ pos: [semente.pos[0] - 2 * dist * nn[0], semente.pos[1] - 2 * dist * nn[1], semente.pos[2] - 2 * dist * nn[2]], rot: semente.rot });
  }
  return out;
}

/**
 * Recria as instâncias de todos os padrões a partir das sementes (pose atual). Instâncias que já
 * existem mantêm o id (posicionamentos e destaques continuam valendo); as que sobram saem.
 * `centros`: centro local de cada peça (espelho).
 */
export function aplicarPadroes(d: DocumentoMontagem, centros: Map<string, Vec3> = new Map()) {
  // padrão sem nenhuma semente (excluídas) sai junto
  d.padroes = (d.padroes ?? []).filter((p) => p.sementes.some((id) => d.componentes.some((c) => c.id === id && !c.padrao)));
  const antigas = new Map(d.componentes.filter((c) => c.padrao).map((c) => [`${c.padrao}|${c.semente}|${c.copia}`, c]));
  const novas: ComponenteMontagem[] = [];
  for (const p of d.padroes ?? []) {
    if (p.suprimido) continue;
    for (const sid of p.sementes) {
      const s = d.componentes.find((c) => c.id === sid && !c.padrao);
      if (!s) continue;
      copiasDoPadrao(p, s.t, centros.get(s.peca)).forEach((t, i) => {
        const k = `${p.id}|${sid}|${i + 1}`;
        const velha = antigas.get(k);
        if (velha) {
          velha.t = t;
          velha.peca = s.peca;
          velha.suprimido = s.suprimido;
          antigas.delete(k);
          novas.push(velha);
        } else {
          novas.push({ id: novoIdM(), peca: s.peca, instancia: 0, t, fixo: false, padrao: p.id, semente: sid, copia: i + 1, ...(s.suprimido ? { suprimido: true } : {}) });
        }
      });
    }
  }
  const sai = [...antigas.values()].map((c) => c.id);
  if (sai.length) excluirComponentes(d, sai);
  const ids = new Set(d.componentes.map((c) => c.id));
  for (const c of novas) if (!ids.has(c.id)) {
    c.instancia = proximaInstancia(d, c.peca);
    d.componentes.push(c);
  }
}

/** Exclui o padrão e as instâncias dele. */
export function excluirPadrao(d: DocumentoMontagem, id: string) {
  d.padroes = (d.padroes ?? []).filter((p) => p.id !== id);
  excluirComponentes(d, d.componentes.filter((c) => c.padrao === id).map((c) => c.id));
}

// ---------- vista explodida ----------

/** Poses com os passos da explosão somados (só exibição: a montagem continua posicionada). */
export function posesExplodidas(d: DocumentoMontagem): Map<string, Transformacao> {
  const desl = new Map<string, Vec3>();
  for (const p of d.explosao ?? []) {
    const u = unit3(p.dir);
    for (const id of p.comps) {
      const a = desl.get(id) ?? [0, 0, 0];
      desl.set(id, [a[0] + u[0] * p.dist, a[1] + u[1] * p.dist, a[2] + u[2] * p.dist]);
    }
  }
  const out = new Map<string, Transformacao>();
  for (const c of d.componentes) {
    const v = desl.get(c.id);
    out.set(c.id, v ? { pos: [c.t.pos[0] + v[0], c.t.pos[1] + v[1], c.t.pos[2] + v[2]], rot: c.t.rot } : c.t);
  }
  return out;
}

/**
 * Explosão automática: cada componente (menos o fixo de referência) se afasta do centro da
 * montagem na direção do próprio centro, proporcional à distância (fator × distância).
 */
export function explosaoAutomatica(d: DocumentoMontagem, centros: Map<string, Vec3>, fator = 1): PassoExplosao[] {
  const ids = d.componentes.filter((c) => !c.suprimido && centros.has(c.id)).map((c) => c.id);
  if (!ids.length) return [];
  const g = [0, 1, 2].map((k) => ids.reduce((s, id) => s + centros.get(id)![k], 0) / ids.length) as Vec3;
  const out: PassoExplosao[] = [];
  for (const id of ids) {
    const c = d.componentes.find((x) => x.id === id)!;
    if (c.fixo) continue;
    const v: Vec3 = [0, 1, 2].map((k) => centros.get(id)![k] - g[k]) as Vec3;
    const L = Math.hypot(...v);
    if (L < 1e-6) continue;
    out.push({ id: novoIdM(), comps: [id], dir: v, dist: L * fator });
  }
  return out;
}

// ---------- propriedades de massa da montagem ----------

export interface MassaPeca {
  /** mm³, mm², centro em coordenadas da peça */
  volume: number;
  area: number;
  centro: Vec3;
  /** g/cm³ */
  densidade: number;
}

/** Soma as peças posicionadas: massa (g), volume (mm³), área (mm²) e centro de massa da montagem. */
export function massaDaMontagem(itens: { m: MassaPeca; t: Transformacao }[]): { massa: number; volume: number; area: number; centro: Vec3 } {
  let massa = 0, volume = 0, area = 0;
  const cm: Vec3 = [0, 0, 0];
  for (const { m, t } of itens) {
    const g = (m.volume * m.densidade) / 1000;
    const c = aplicarPonto(t, m.centro);
    massa += g;
    volume += m.volume;
    area += m.area;
    for (let k = 0; k < 3; k++) cm[k] += c[k] * g;
  }
  return { massa, volume, area, centro: massa > 0 ? [cm[0] / massa, cm[1] / massa, cm[2] / massa] : [0, 0, 0] };
}
