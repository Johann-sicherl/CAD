// Motor de agendamento do WJCronProject (puro, sem DOM; testado em scripts/teste-agenda.ts).
// Tempo medido em dias úteis a partir do início do projeto: t = 0 é o começo do primeiro dia útil.
// Uma tarefa ocupa [es, ef); o término exibido é o último dia útil tocado (ceil(ef) - 1).
// CPM com vínculos TI/II/TT/IT e latência (dias ou % da predecessora), restrições, resumos por
// nível de estrutura, folgas, caminho crítico, trabalho/custo e superalocação de recursos.

export type TipoVinculo = "TI" | "II" | "TT" | "IT";
export type Restricao = "ASAP" | "ALAP" | "MSO" | "MFO" | "SNET" | "SNLT" | "FNET" | "FNLT";

export const RESTRICOES: [Restricao, string][] = [
  ["ASAP", "O mais cedo possível"],
  ["ALAP", "O mais tarde possível"],
  ["MSO", "Deve iniciar em"],
  ["MFO", "Deve terminar em"],
  ["SNET", "Não iniciar antes de"],
  ["SNLT", "Não iniciar depois de"],
  ["FNET", "Não terminar antes de"],
  ["FNLT", "Não terminar depois de"],
];

export interface Vinculo {
  /** id da predecessora */
  de: string;
  tipo: TipoVinculo;
  /** latência (negativa = antecipação) */
  lat: number;
  latUn: "d" | "%";
}

export interface Atribuicao {
  r: string;
  /** % de unidades (trabalho), quantidade (material) ou valor (custo) */
  un: number;
}

export interface Tarefa {
  id: string;
  nome: string;
  nivel: number;
  /** duração em dias úteis */
  dur: number;
  marco?: boolean;
  pred: Vinculo[];
  restricao?: Restricao;
  /** data da restrição (aaaa-mm-dd) */
  dataRestricao?: string;
  /** data limite (aaaa-mm-dd) */
  limite?: string;
  pct: number;
  recursos: Atribuicao[];
  notas?: string;
  prioridade?: number;
  inativa?: boolean;
  /** resumo recolhido na tabela */
  recolhida?: boolean;
  /** linha de base */
  base?: { ini: string; fim: string; dur: number; custo: number };
}

export interface Recurso {
  id: string;
  nome: string;
  tipo: "trabalho" | "material" | "custo";
  /** unidades máximas (%) */
  max: number;
  /** R$/h (trabalho) ou R$/unidade (material) */
  taxa: number;
  custoUso: number;
  unidade?: string;
  grupo?: string;
}

export interface ConfigCalendario {
  /** dom..sáb */
  uteis: boolean[];
  feriadosNacionais: boolean;
  /** carnaval (seg/ter) e Corpus Christi: pontos facultativos */
  facultativos: boolean;
  excecoes: { data: string; nome: string }[];
  horasDia: number;
}

export interface Projeto {
  formato: "wjcron";
  versao: 1;
  nome: string;
  inicio: string;
  /** data de status (aaaa-mm-dd) */
  status?: string;
  moeda?: string;
  calendario: ConfigCalendario;
  tarefas: Tarefa[];
  recursos: Recurso[];
}

export interface Calc {
  es: number;
  ef: number;
  ls: number;
  lf: number;
  folgaTotal: number;
  folgaLivre: number;
  critica: boolean;
  resumo: boolean;
  /** duração calculada (resumos: do primeiro início ao último término) */
  dur: number;
  inicio: string;
  termino: string;
  trabalho: number;
  custo: number;
  pct: number;
  limiteUltrapassado: boolean;
  superalocada: boolean;
  /** restrição não pôde ser atendida (folga negativa) */
  conflito: boolean;
}

export interface Resultado {
  t: Map<string, Calc>;
  inicio: string;
  termino: string;
  dur: number;
  trabalho: number;
  custo: number;
  superalocados: Set<string>;
  erros: string[];
  cal: Calendario;
}

// ---------- datas ----------

const DIA = 86400000;
export const serial = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(a, m - 1, d) / DIA);
};
export const iso = (s: number) => new Date(s * DIA).toISOString().slice(0, 10);
/** 0 = domingo */
export const diaDaSemana = (s: number) => (((s + 4) % 7) + 7) % 7;
export const hojeIso = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
};
export const dataBR = (isoD: string) => (isoD ? `${isoD.slice(8, 10)}/${isoD.slice(5, 7)}/${isoD.slice(0, 4)}` : "");
/** dd/mm/aaaa, dd/mm/aa ou aaaa-mm-dd → aaaa-mm-dd (ou null) */
export function lerDataBR(t: string): string | null {
  t = t.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(t);
  if (!m) return null;
  let a = m[3] ? +m[3] : new Date().getFullYear();
  if (a < 100) a += 2000;
  return valida(a, +m[2], +m[1]);
}
function valida(a: number, m: number, d: number) {
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano: number): number {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Math.round(Date.UTC(ano, mes - 1, dia) / DIA);
}

/** Feriados de um ano (serial → nome). */
export function feriados(ano: number, cfg: ConfigCalendario): Map<number, string> {
  const r = new Map<number, string>();
  const f = (m: number, d: number, n: string) => r.set(Math.round(Date.UTC(ano, m - 1, d) / DIA), n);
  if (cfg.feriadosNacionais) {
    f(1, 1, "Confraternização Universal");
    f(4, 21, "Tiradentes");
    f(5, 1, "Dia do Trabalho");
    f(9, 7, "Independência do Brasil");
    f(10, 12, "Nossa Senhora Aparecida");
    f(11, 2, "Finados");
    f(11, 15, "Proclamação da República");
    if (ano >= 2024) f(11, 20, "Dia Nacional de Zumbi e da Consciência Negra");
    f(12, 25, "Natal");
    const p = pascoa(ano);
    r.set(p - 2, "Sexta-feira Santa");
    if (cfg.facultativos) {
      r.set(p - 48, "Carnaval");
      r.set(p - 47, "Carnaval");
      r.set(p + 60, "Corpus Christi");
    }
  }
  for (const e of cfg.excecoes) if (e.data.startsWith(String(ano))) r.set(serial(e.data), e.nome);
  return r;
}

/** Calendário de dias úteis com índice a partir do início do projeto. */
export class Calendario {
  readonly base: number;
  private pos: number[] = [];
  private neg: number[] = [];
  private anos = new Map<number, Map<number, string>>();
  constructor(readonly cfg: ConfigCalendario, inicio: string) {
    if (!cfg.uteis.some(Boolean)) cfg = { ...cfg, uteis: [false, true, true, true, true, true, false] };
    this.cfg = cfg;
    let s = serial(inicio);
    while (!this.util(s)) s++;
    this.base = s;
    this.pos.push(s);
  }
  feriado(s: number): string | undefined {
    const ano = new Date(s * DIA).getUTCFullYear();
    let m = this.anos.get(ano);
    if (!m) this.anos.set(ano, (m = feriados(ano, this.cfg)));
    return m.get(s);
  }
  util(s: number) {
    return this.cfg.uteis[diaDaSemana(s)] && !this.feriado(s);
  }
  /** Data (serial) do dia útil de índice i (inteiro, pode ser negativo). */
  data(i: number): number {
    if (i >= 0) {
      while (this.pos.length <= i) {
        let s = this.pos[this.pos.length - 1] + 1;
        while (!this.util(s)) s++;
        this.pos.push(s);
      }
      return this.pos[i];
    }
    const k = -i - 1;
    while (this.neg.length <= k) {
      let s = (this.neg.length ? this.neg[this.neg.length - 1] : this.base) - 1;
      while (!this.util(s)) s--;
      this.neg.push(s);
    }
    return this.neg[k];
  }
  /** Índice do dia útil da data (se não for útil: o próximo, ou o anterior com `anterior`). */
  indice(s: number, anterior = false): number {
    if (s >= this.base) {
      while (this.pos[this.pos.length - 1] < s) this.data(this.pos.length);
      let lo = 0, hi = this.pos.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (this.pos[m] < s) lo = m + 1;
        else hi = m;
      }
      return this.pos[lo] === s || !anterior ? lo : lo - 1;
    }
    let i = -1;
    while (this.data(i) > s) i--;
    return this.data(i) === s || anterior ? i : i + 1;
  }
  /** Data (aaaa-mm-dd) do início de t. */
  dataInicio(t: number) {
    return iso(this.data(Math.floor(t + 1e-9)));
  }
  /** Data do término em t (último dia tocado). */
  dataTermino(t: number) {
    return iso(this.data(Math.ceil(t - 1e-9) - 1));
  }
  /** Dias úteis entre duas datas (aaaa-mm-dd), contando as duas. */
  diasUteis(a: string, b: string) {
    return this.indice(serial(b), true) - this.indice(serial(a)) + 1;
  }
}

// ---------- texto: duração e predecessoras ----------

export function formatarDuracao(d: number, marco = false): string {
  const n = Math.round(d * 100) / 100;
  const t = String(n).replace(".", ",");
  return `${t} ${Math.abs(n) === 1 ? "dia" : "dias"}${marco && n !== 0 ? " (marco)" : ""}`;
}

/** "5", "5d", "5 dias", "2 sem", "1 mês", "4h", "1,5" → dias úteis */
export function lerDuracao(t: string, horasDia = 8): number | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(d|dia|dias|s|sem|semana|semanas|m|mes|mês|meses|h|hr|hora|horas)?\??\s*$/i.exec(t);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  const u = (m[2] ?? "d").toLowerCase();
  const d = u.startsWith("s") ? v * 5 : u.startsWith("m") ? v * 20 : u.startsWith("h") ? v / horasDia : v;
  return d < 0 ? null : Math.round(d * 1000) / 1000;
}

const TIPO_EN: Record<string, TipoVinculo> = { FS: "TI", SS: "II", FF: "TT", SF: "IT" };

/** "3;5II+2d;7TT-25%" (Id = número da linha). */
export function lerPredecessoras(t: string, idDaLinha: (n: number) => string | undefined, horasDia = 8): Vinculo[] | string {
  const r: Vinculo[] = [];
  for (const parte of t.split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(TI|II|TT|IT|FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*(d|dias?|%|sem|h)?)?$/i.exec(parte);
    if (!m) return `Predecessora inválida: "${parte}" (use por exemplo 3, 5II+2d ou 7TT-25%).`;
    const id = idDaLinha(Number(m[1]));
    if (!id) return `Não existe a tarefa ${m[1]}.`;
    const tp = m[2]?.toUpperCase() ?? "TI";
    let lat = m[4] ? Number(m[4].replace(",", ".")) : 0;
    const un = (m[5] ?? "d").toLowerCase();
    if (un === "sem") lat *= 5;
    else if (un === "h") lat /= horasDia;
    if (m[3] === "-") lat = -lat;
    r.push({ de: id, tipo: TIPO_EN[tp] ?? (tp as TipoVinculo), lat, latUn: un === "%" ? "%" : "d" });
  }
  return r;
}

export function formatarPredecessoras(v: Vinculo[], linhaDoId: (id: string) => number | undefined): string {
  return v
    .map((x) => {
      const n = linhaDoId(x.de);
      if (n === undefined) return "";
      const lat = x.lat ? `${x.lat > 0 ? "+" : "-"}${String(Math.abs(Math.round(x.lat * 100) / 100)).replace(".", ",")}${x.latUn === "%" ? "%" : "d"}` : "";
      return `${n}${x.tipo !== "TI" || lat ? x.tipo : ""}${lat}`;
    })
    .filter(Boolean)
    .join(";");
}

// ---------- estrutura ----------

/** Índices dos filhos diretos e se é resumo, pela sequência de níveis. */
export function estrutura(ts: Tarefa[]) {
  const pai: number[] = [];
  const resumo: boolean[] = ts.map((t, i) => i + 1 < ts.length && ts[i + 1].nivel > t.nivel);
  const pilha: number[] = [];
  ts.forEach((t, i) => {
    while (pilha.length && ts[pilha[pilha.length - 1]].nivel >= t.nivel) pilha.pop();
    pai[i] = pilha.length ? pilha[pilha.length - 1] : -1;
    pilha.push(i);
  });
  return { pai, resumo };
}

/** Códigos de EAP (1, 1.1, 1.2, 2…). */
export function codigosEAP(ts: Tarefa[]): string[] {
  const cont: number[] = [];
  return ts.map((t) => {
    const n = Math.max(1, t.nivel);
    cont.length = n;
    cont[n - 1] = (cont[n - 1] ?? 0) + 1;
    for (let k = 0; k < n - 1; k++) cont[k] ??= 1;
    return cont.slice(0, n).join(".");
  });
}

// ---------- cálculo ----------

export function calcular(p: Projeto): Resultado {
  const cal = new Calendario(p.calendario, p.inicio);
  const ts = p.tarefas;
  const { pai, resumo } = estrutura(ts);
  const erros: string[] = [];
  const idx = new Map(ts.map((t, i) => [t.id, i]));
  // folhas descendentes de cada linha
  const folhas: number[][] = ts.map(() => []);
  ts.forEach((t, i) => {
    if (resumo[i] || t.inativa) return;
    for (let k = i; k >= 0; k = pai[k]) folhas[k].push(i);
  });
  // inatividade herdada do resumo
  const inativa = ts.map((t) => !!t.inativa);
  ts.forEach((_, i) => {
    if (pai[i] >= 0 && inativa[pai[i]]) inativa[i] = true;
  });

  const dur = ts.map((t, i) => (resumo[i] ? 0 : t.marco ? 0 : Math.max(0, t.dur)));
  // arestas entre folhas (vínculos de/para resumos valem para as folhas dele)
  interface Aresta { a: number; b: number; tipo: TipoVinculo; lat: number }
  const arestas: Aresta[] = [];
  ts.forEach((t, i) => {
    if (inativa[i]) return;
    for (const v of t.pred) {
      const j = idx.get(v.de);
      if (j === undefined || inativa[j] || j === i) continue;
      for (const a of folhas[j]) for (const b of folhas[i]) {
        if (a === b || inativa[a] || inativa[b]) continue;
        const lat = v.latUn === "%" ? (v.lat / 100) * (resumo[j] ? 0 : dur[j]) : v.lat;
        arestas.push({ a, b, tipo: v.tipo, lat });
      }
    }
  });
  const ativas = ts.map((_, i) => i).filter((i) => !resumo[i] && !inativa[i]);
  const saem = new Map<number, Aresta[]>(), entram = new Map<number, Aresta[]>();
  for (const i of ativas) (saem.set(i, []), entram.set(i, []));
  for (const e of arestas) (saem.get(e.a)!.push(e), entram.get(e.b)!.push(e));

  // ordem topológica (Kahn)
  const grau = new Map(ativas.map((i) => [i, entram.get(i)!.length]));
  const fila = ativas.filter((i) => grau.get(i) === 0);
  const ordem: number[] = [];
  while (fila.length) {
    const i = fila.shift()!;
    ordem.push(i);
    for (const e of saem.get(i)!) {
      const g = grau.get(e.b)! - 1;
      grau.set(e.b, g);
      if (g === 0) fila.push(e.b);
    }
  }
  const emCiclo = new Set(ativas.filter((i) => !ordem.includes(i)));
  if (emCiclo.size) {
    erros.push(`Vínculo circular entre as tarefas ${[...emCiclo].map((i) => i + 1).join(", ")}: os vínculos delas foram ignorados.`);
    for (const i of emCiclo) ordem.push(i);
  }
  const vale = (e: Aresta) => !emCiclo.has(e.a) && !emCiclo.has(e.b);

  const ini = (d?: string) => (d ? cal.indice(serial(d)) : 0);
  const fim = (d?: string) => (d ? cal.indice(serial(d), true) + 1 : 0);
  const es = new Map<number, number>(), ef = new Map<number, number>();
  // passagem para frente
  for (const i of ordem) {
    const t = ts[i], d = dur[i];
    let s = 0;
    for (const e of entram.get(i)!) {
      if (!vale(e)) continue;
      const a = es.get(e.a)!, b = ef.get(e.a)!;
      const lim = e.tipo === "TI" ? b + e.lat : e.tipo === "II" ? a + e.lat : e.tipo === "TT" ? b + e.lat - d : a + e.lat - d;
      s = Math.max(s, lim);
    }
    switch (t.restricao) {
      case "SNET":
        s = Math.max(s, ini(t.dataRestricao));
        break;
      case "FNET":
        s = Math.max(s, fim(t.dataRestricao) - d);
        break;
      case "MSO":
        s = ini(t.dataRestricao);
        break;
      case "MFO":
        s = fim(t.dataRestricao) - d;
        break;
    }
    es.set(i, s);
    ef.set(i, s + d);
  }
  let fimProj = 0;
  for (const i of ativas) fimProj = Math.max(fimProj, ef.get(i)!);

  // passagem para trás
  const ls = new Map<number, number>(), lf = new Map<number, number>();
  for (const i of [...ordem].reverse()) {
    const t = ts[i], d = dur[i];
    let f = fimProj;
    for (const e of saem.get(i)!) {
      if (!vale(e)) continue;
      const a = ls.get(e.b)!, b = lf.get(e.b)!;
      const lim = e.tipo === "TI" ? a - e.lat : e.tipo === "II" ? a - e.lat + d : e.tipo === "TT" ? b - e.lat : b - e.lat + d;
      f = Math.min(f, lim);
    }
    switch (t.restricao) {
      case "FNLT":
        f = Math.min(f, fim(t.dataRestricao));
        break;
      case "SNLT":
        f = Math.min(f, ini(t.dataRestricao) + d);
        break;
      case "MFO":
        f = fim(t.dataRestricao);
        break;
      case "MSO":
        f = ini(t.dataRestricao) + d;
        break;
    }
    lf.set(i, f);
    ls.set(i, f - d);
  }

  // "o mais tarde possível": empurra para o fim respeitando as sucessoras já posicionadas
  for (const i of [...ordem].reverse()) {
    if (ts[i].restricao !== "ALAP") continue;
    const d = dur[i];
    let f = fimProj;
    for (const e of saem.get(i)!) {
      if (!vale(e)) continue;
      const a = es.get(e.b)!, b = ef.get(e.b)!;
      const lim = e.tipo === "TI" ? a - e.lat : e.tipo === "II" ? a - e.lat + d : e.tipo === "TT" ? b - e.lat : b - e.lat + d;
      f = Math.min(f, lim);
    }
    if (f - d > es.get(i)!) (es.set(i, f - d), ef.set(i, f));
  }

  // folgas
  const ffMap = new Map<number, number>();
  for (const i of ativas) {
    let ff = fimProj - ef.get(i)!;
    for (const e of saem.get(i)!) {
      if (!vale(e)) continue;
      const a = es.get(e.b)!, b = ef.get(e.b)!, sa = es.get(i)!, sb = ef.get(i)!;
      const v = e.tipo === "TI" ? a - e.lat - sb : e.tipo === "II" ? a - e.lat - sa : e.tipo === "TT" ? b - e.lat - sb : b - e.lat - sa;
      ff = Math.min(ff, v);
    }
    ffMap.set(i, Math.max(0, ff));
  }

  // recursos: trabalho, custo, superalocação
  const recs = new Map(p.recursos.map((r) => [r.id, r]));
  const horas = p.calendario.horasDia || 8;
  const trabalho = ts.map(() => 0), custo = ts.map(() => 0);
  const carga = new Map<string, Map<number, number>>();
  const superalocados = new Set<string>();
  for (const i of ativas) {
    const d = dur[i];
    for (const a of ts[i].recursos) {
      const r = recs.get(a.r);
      if (!r) continue;
      if (r.tipo === "trabalho") {
        const h = d * horas * (a.un / 100);
        trabalho[i] += h;
        custo[i] += h * r.taxa + r.custoUso;
        let m = carga.get(r.id);
        if (!m) carga.set(r.id, (m = new Map()));
        for (let k = Math.floor(es.get(i)! + 1e-9); k < Math.ceil(ef.get(i)! - 1e-9); k++) m.set(k, (m.get(k) ?? 0) + a.un);
      } else if (r.tipo === "material") custo[i] += a.un * r.taxa + r.custoUso;
      else custo[i] += a.un;
    }
  }
  const superTarefa = new Set<number>();
  for (const [rid, m] of carga) {
    const r = recs.get(rid)!;
    const dias = [...m].filter(([, u]) => u > r.max + 1e-6).map(([k]) => k);
    if (!dias.length) continue;
    superalocados.add(rid);
    for (const i of ativas) {
      if (!ts[i].recursos.some((a) => a.r === rid)) continue;
      const a = Math.floor(es.get(i)! + 1e-9), b = Math.ceil(ef.get(i)! - 1e-9);
      if (dias.some((k) => k >= a && k < b)) superTarefa.add(i);
    }
  }

  // resultado por tarefa (resumos acumulam)
  const t = new Map<string, Calc>();
  const montar = (i: number): Calc => {
    const tf = ls.get(i)! - es.get(i)!;
    const d = dur[i], e0 = es.get(i)!, e1 = ef.get(i)!;
    const lim = ts[i].limite ? fim(ts[i].limite) : Infinity;
    // marco no fim de um dia: início e término são esse dia (o término da predecessora)
    const diaMarco = e0 > 0 && Math.abs(e0 - Math.round(e0)) < 1e-9 ? cal.dataTermino(e0) : cal.dataInicio(e0);
    return {
      es: e0, ef: e1, ls: ls.get(i)!, lf: lf.get(i)!,
      folgaTotal: tf, folgaLivre: ffMap.get(i)!, critica: tf <= 1e-6, resumo: false, dur: d,
      inicio: d === 0 ? diaMarco : cal.dataInicio(e0),
      termino: d === 0 ? diaMarco : cal.dataTermino(e1),
      trabalho: trabalho[i], custo: custo[i], pct: ts[i].pct, limiteUltrapassado: e1 > lim + 1e-9,
      superalocada: superTarefa.has(i), conflito: tf < -1e-6,
    };
  };
  for (const i of ativas) t.set(ts[i].id, montar(i));
  for (let i = ts.length - 1; i >= 0; i--) {
    if (!resumo[i] || inativa[i]) continue;
    const fs = folhas[i].filter((k) => !inativa[k]).map((k) => t.get(ts[k].id)!);
    if (!fs.length) continue;
    const e0 = Math.min(...fs.map((c) => c.es)), e1 = Math.max(...fs.map((c) => c.ef));
    const pesos = fs.reduce((s, c) => s + c.dur, 0);
    const pct = pesos ? fs.reduce((s, c) => s + c.dur * c.pct, 0) / pesos : fs.reduce((s, c) => s + c.pct, 0) / fs.length;
    const lim = ts[i].limite ? fim(ts[i].limite) : Infinity;
    t.set(ts[i].id, {
      es: e0, ef: e1, ls: Math.min(...fs.map((c) => c.ls)), lf: Math.max(...fs.map((c) => c.lf)),
      folgaTotal: Math.min(...fs.map((c) => c.folgaTotal)), folgaLivre: 0, critica: fs.some((c) => c.critica), resumo: true,
      dur: e1 - e0, inicio: cal.dataInicio(e0), termino: e1 > e0 ? cal.dataTermino(e1) : cal.dataInicio(e0),
      trabalho: fs.reduce((s, c) => s + c.trabalho, 0), custo: fs.reduce((s, c) => s + c.custo, 0),
      pct: Math.round(pct), limiteUltrapassado: e1 > lim + 1e-9, superalocada: fs.some((c) => c.superalocada), conflito: fs.some((c) => c.conflito),
    });
  }
  const conflitos = ativas.filter((i) => t.get(ts[i].id)!.conflito).map((i) => i + 1);
  if (conflitos.length) erros.push(`Restrições não atendidas (folga negativa) nas tarefas ${conflitos.join(", ")}.`);
  const todos = ativas.map((i) => t.get(ts[i].id)!);
  return {
    t,
    inicio: cal.dataInicio(0),
    termino: todos.length ? cal.dataTermino(fimProj) : cal.dataInicio(0),
    dur: fimProj,
    trabalho: todos.reduce((s, c) => s + c.trabalho, 0),
    custo: todos.reduce((s, c) => s + c.custo, 0),
    superalocados,
    erros,
    cal,
  };
}

export const calendarioPadrao = (): ConfigCalendario => ({
  uteis: [false, true, true, true, true, true, false],
  feriadosNacionais: true,
  facultativos: false,
  excecoes: [],
  horasDia: 8,
});

export function validarProjeto(d: unknown): Projeto {
  const x = d as Projeto;
  if (!x || x.formato !== "wjcron" || !Array.isArray(x.tarefas)) throw new Error("Arquivo não é um cronograma do WJCronProject (.wjcron).");
  x.calendario = { ...calendarioPadrao(), ...(x.calendario ?? {}) };
  x.recursos ??= [];
  for (const t of x.tarefas) {
    t.pred ??= [];
    t.recursos ??= [];
    t.pct ??= 0;
    t.nivel = Math.max(1, t.nivel ?? 1);
  }
  return x;
}
