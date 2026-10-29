// Google Drive como cópia do cofre do WJPDM (mesma interface das outras cópias: Repositorio).
// Acesso pelo navegador com o login do Google (Google Identity Services, token de 1 hora) e
// escopo drive.file: o app só enxerga o que ele mesmo criou no Drive (a pasta WJPDM).
//
// No Drive:  Meu Drive/WJPDM/<pastas>/<arquivo>        ← arquivo atual (o Drive guarda revisões)
//            Meu Drive/WJPDM/.wjpdm/indice.json        ← índice do cofre
//            Meu Drive/WJPDM/.wjpdm/blobs/<id>         ← conteúdo de cada versão
//            Meu Drive/WJPDM/.wjpdm/visiveis.json      ← o que já foi gravado em <pastas>

import { blobAtual, caminhoDoArquivo, caminhosDasPastas, type Indice, type Repositorio } from "../pdm/sincronia";

/** Cliente OAuth do projeto WJProMaster no Google Cloud (público; a chave secreta não é usada). */
export const CLIENTE_GOOGLE = "751073631393-8tmbbv019s57975tbfv4h1g11gsahunb.apps.googleusercontent.com";
const ESCOPO = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const PASTA = "application/vnd.google-apps.folder";

/** Destino na nuvem (registrado no cofre). */
export interface DestinoNuvem {
  nome: string;
  conectado(): boolean;
  situacao(): string;
  conectar(): Promise<void>;
  /** Renova o acesso vencido (abre a janela do Google; precisa de um toque recente). */
  renovar(): Promise<boolean>;
  repositorio(): Repositorio;
}

export class ErroDrive extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

// ---------- repositório (só fetch: testável com um Drive simulado) ----------

type Buscar = typeof fetch;
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export class RepositorioDrive implements Repositorio {
  nome = "Google Drive";
  /** O Drive é cópia de publicação: só recebe o que passou por GO-IN. */
  publicado = true;
  private ids = new Map<string, string>(); // caminho de pasta → id
  private blobIds: Map<string, string> | null = null;
  constructor(private token: () => string, private buscar: Buscar = (...a) => fetch(...a)) {}

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const r = await this.buscar(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.token()}` } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new ErroDrive(r.status, r.status === 401 ? "acesso ao Google vencido (reconecte)" : r.status === 403 ? "o Google recusou o acesso (confira o usuário de teste e o escopo drive.file)" : `Drive respondeu ${r.status} ${t.slice(0, 120)}`);
    }
    return r;
  }
  private async listar(consulta: string): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    let pagina = "";
    do {
      const u = `${API}?q=${encodeURIComponent(consulta)}&fields=${encodeURIComponent("nextPageToken,files(id,name)")}&pageSize=1000&spaces=drive${pagina ? `&pageToken=${pagina}` : ""}`;
      const j = (await (await this.req(u)).json()) as { files: { id: string; name: string }[]; nextPageToken?: string };
      out.push(...j.files);
      pagina = j.nextPageToken ?? "";
    } while (pagina);
    return out;
  }
  /** Pasta pelo caminho (a partir de Meu Drive), criando o que faltar. */
  private async pasta(caminho: string[]): Promise<string> {
    let pai = "root";
    for (let k = 0; k < caminho.length; k++) {
      const chave = caminho.slice(0, k + 1).join("/");
      let id = this.ids.get(chave);
      if (!id) {
        const achadas = await this.listar(`name='${q(caminho[k])}' and '${pai}' in parents and mimeType='${PASTA}' and trashed=false`);
        id = achadas[0]?.id;
        if (!id) {
          const r = await this.req(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: caminho[k], mimeType: PASTA, parents: [pai] }) });
          id = ((await r.json()) as { id: string }).id;
        }
        this.ids.set(chave, id);
      }
      pai = id;
    }
    return pai;
  }
  /** Pasta pelo caminho, sem criar (undefined se não existe). */
  private async acharPasta(caminho: string[]): Promise<string | undefined> {
    let pai = "root";
    for (const n of caminho) {
      const id = (await this.listar(`name='${q(n)}' and '${pai}' in parents and mimeType='${PASTA}' and trashed=false`))[0]?.id;
      if (!id) return undefined;
      pai = id;
    }
    return pai;
  }
  private async arquivoNa(pasta: string, nome: string): Promise<string | undefined> {
    return (await this.listar(`name='${q(nome)}' and '${pasta}' in parents and trashed=false`))[0]?.id;
  }
  private async baixar(id: string): Promise<Blob> {
    return (await this.req(`${API}/${id}?alt=media`)).blob();
  }
  /** Cria (multipart: dados + nome/pasta) ou atualiza o conteúdo de um arquivo existente. */
  private async enviar(dados: Blob, nome: string, pasta: string, id?: string): Promise<string> {
    if (id) {
      await this.req(`${UPLOAD}/${id}?uploadType=media`, { method: "PATCH", body: dados });
      return id;
    }
    const fronteira = `wjpdm${Math.random().toString(36).slice(2)}`;
    const corpo = new Blob([
      `--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nome, parents: [pasta] })}\r\n`,
      `--${fronteira}\r\nContent-Type: ${dados.type || "application/octet-stream"}\r\n\r\n`, dados, `\r\n--${fronteira}--`,
    ]);
    const r = await this.req(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${fronteira}` }, body: corpo });
    return ((await r.json()) as { id: string }).id;
  }

  /** Texto de um arquivo fora do cofre (ex.: Meu Drive/WJTaskPlan/tarefas.json); null se não existe. */
  async lerArquivo(pasta: string[], nome: string): Promise<string | null> {
    const p = await this.acharPasta(pasta);
    const id = p && (await this.arquivoNa(p, nome));
    return id ? (await this.baixar(id)).text() : null;
  }
  /** Grava (cria ou atualiza no lugar) um arquivo fora do cofre. */
  async gravarArquivo(pasta: string[], nome: string, dados: Blob) {
    const p = await this.pasta(pasta);
    await this.enviar(dados, nome, p, await this.arquivoNa(p, nome));
  }

  private sis = () => this.pasta(["WJPDM", ".wjpdm"]);
  private blobsPasta = () => this.pasta(["WJPDM", ".wjpdm", "blobs"]);

  async lerIndice(): Promise<Indice | null> {
    const id = await this.arquivoNa(await this.sis(), "indice.json");
    if (!id) return null;
    const i = JSON.parse(await (await this.baixar(id)).text()) as Indice;
    if (i.formato !== "wjpdm-indice") throw new Error("índice do cofre inválido no Drive");
    return i;
  }
  async gravarIndice(i: Indice) {
    const sis = await this.sis();
    await this.enviar(new Blob([JSON.stringify(i)], { type: "application/json" }), "indice.json", sis, await this.arquivoNa(sis, "indice.json"));
  }
  async listarBlobs() {
    const lista = await this.listar(`'${await this.blobsPasta()}' in parents and trashed=false`);
    this.blobIds = new Map(lista.map((f) => [f.name, f.id]));
    return new Set(this.blobIds.keys());
  }
  async lerBlob(id: string) {
    if (!this.blobIds) await this.listarBlobs();
    const d = this.blobIds!.get(id);
    return d ? this.baixar(d) : undefined;
  }
  async gravarBlob(id: string, b: Blob) {
    const d = await this.enviar(b, id, await this.blobsPasta());
    this.blobIds?.set(id, d);
  }
  async apagarBlob(id: string) {
    if (!this.blobIds) await this.listarBlobs();
    const d = this.blobIds!.get(id);
    if (d) await this.req(`${API}/${d}`, { method: "DELETE" });
    this.blobIds!.delete(id);
  }

  /** Arquivos legíveis em Meu Drive/WJPDM: atualiza no lugar (o Drive guarda as revisões). */
  async gravarVisiveis(i: Indice, lerBlob: (id: string) => Promise<Blob | undefined>) {
    const sis = await this.sis();
    const idMapa = await this.arquivoNa(sis, "visiveis.json");
    type V = Record<string, { caminho: string[]; blob: string; drive: string }>;
    const antes: V = idMapa ? JSON.parse(await (await this.baixar(idMapa)).text()) : {};
    const agora: V = {};
    const igual = (a: string[], b: string[]) => a.length === b.length && a.every((x, k) => x === b[k]);
    for (const a of i.arquivos) {
      const blob = blobAtual(a);
      if (a.lixeira || !blob) continue;
      const caminho = caminhoDoArquivo(i, a);
      const v = antes[a.id];
      if (v && v.blob === blob && igual(v.caminho, caminho)) {
        agora[a.id] = v;
        continue;
      }
      const dados = await lerBlob(blob);
      if (!dados) continue;
      const mesmoLugar = v && igual(v.caminho, caminho);
      const pasta = await this.pasta(["WJPDM", ...caminho.slice(0, -1)]);
      const drive = await this.enviar(dados, caminho[caminho.length - 1], pasta, mesmoLugar ? v.drive : undefined).catch(async (e) => {
        if (mesmoLugar && e instanceof ErroDrive && e.status === 404) return this.enviar(dados, caminho[caminho.length - 1], pasta); // apagado à mão no Drive
        throw e;
      });
      agora[a.id] = { caminho, blob, drive };
    }
    for (const [id, v] of Object.entries(antes)) {
      if (agora[id]?.drive === v.drive) continue;
      await this.req(`${API}/${v.drive}`, { method: "DELETE" }).catch(() => {});
    }
    await this.enviar(new Blob([JSON.stringify(agora)], { type: "application/json" }), "visiveis.json", sis, idMapa);
    // pastas do cofre (também as vazias): cria as novas; as excluídas/renomeadas vão para a
    // lixeira do Drive (recuperáveis lá por 30 dias), as mais fundas primeiro
    const idPastas = await this.arquivoNa(sis, "pastas.json");
    const pastasAntes: string[][] = idPastas ? JSON.parse(await (await this.baixar(idPastas)).text()) : [];
    const pastasAgora = caminhosDasPastas(i);
    const chave = (c: string[]) => JSON.stringify(c);
    const tinha = new Set(pastasAntes.map(chave)), tem = new Set(pastasAgora.map(chave));
    for (const c of pastasAgora) if (!tinha.has(chave(c))) await this.pasta(["WJPDM", ...c]);
    for (const c of pastasAntes.filter((x) => !tem.has(chave(x))).sort((a, b) => b.length - a.length)) {
      const id = await this.acharPasta(["WJPDM", ...c]);
      if (id) await this.req(`${API}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).catch(() => {});
      const k = ["WJPDM", ...c].join("/");
      for (const x of [...this.ids.keys()]) if (x === k || x.startsWith(`${k}/`)) this.ids.delete(x);
    }
    await this.enviar(new Blob([JSON.stringify(pastasAgora)], { type: "application/json" }), "pastas.json", sis, idPastas);
  }
}

// ---------- login do Google (Google Identity Services) ----------

interface ClienteToken {
  requestAccessToken(o?: { prompt?: string }): void;
}
type Google = { accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback?: (e: { type?: string }) => void }): ClienteToken } } };
const CHAVE = "wjgoogle:acesso";

function lerAcesso(): { token: string; expira: number } | null {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? "null");
  } catch {
    return null;
  }
}
const autorizado = () => localStorage.getItem("wjgoogle:autorizado") === "1";

let script: Promise<Google> | null = null;
function carregarGoogle(): Promise<Google> {
  return (script ??= new Promise((ok, erro) => {
    const g = (window as unknown as { google?: Google }).google;
    if (g?.accounts) return ok(g);
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => ok((window as unknown as { google: Google }).google);
    s.onerror = () => {
      script = null;
      erro(new Error("sem internet para falar com o Google"));
    };
    document.head.append(s);
  }));
}

/** Pede o acesso (janela do Google). `consentir`: mostra a tela de permissão (1ª vez). */
async function pedirAcesso(consentir: boolean): Promise<boolean> {
  const g = await carregarGoogle();
  return new Promise((ok) => {
    const c = g.accounts.oauth2.initTokenClient({
      client_id: CLIENTE_GOOGLE,
      scope: ESCOPO,
      callback: (r) => {
        if (!r.access_token) return ok(false);
        localStorage.setItem(CHAVE, JSON.stringify({ token: r.access_token, expira: Date.now() + (r.expires_in ?? 3600) * 1000 }));
        localStorage.setItem("wjgoogle:autorizado", "1");
        ok(true);
      },
      error_callback: () => ok(false), // janela fechada ou bloqueada
    });
    c.requestAccessToken({ prompt: consentir ? "consent" : "" });
  });
}

const valido = () => {
  const a = lerAcesso();
  return !!a && a.expira - Date.now() > 120000;
};

/** Drive com o acesso atual (para pastas irmãs do cofre, como Meu Drive/WJTaskPlan). */
export const driveGoogle = () => new RepositorioDrive(() => lerAcesso()?.token ?? "");

export const nuvemGoogle: DestinoNuvem = {
  nome: "Google Drive",
  conectado: () => valido(),
  situacao() {
    if (valido()) return "Conectado: o cofre fica em Meu Drive/WJPDM.";
    if (autorizado()) return "Acesso vencido (o Google libera por 1 hora): toque em Sincronizar agora ou Reconectar.";
    return "Não conectado. Toque em Conectar e autorize com a sua conta Google (o app só vê a pasta WJPDM que ele cria).";
  },
  async conectar() {
    if (!(await pedirAcesso(!autorizado()))) throw new Error("O Google não liberou o acesso (janela fechada, bloqueada ou usuário fora da lista de teste).");
  },
  renovar: () => (valido() ? Promise.resolve(true) : autorizado() ? pedirAcesso(false).catch(() => false) : Promise.resolve(false)),
  repositorio: () => new RepositorioDrive(() => lerAcesso()?.token ?? ""),
};
