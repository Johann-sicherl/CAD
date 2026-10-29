// Teste do Google Drive como cópia do cofre (src/comum/drive.ts) contra um Drive simulado que
// responde como a API REST v3 (consulta q, pastas, upload multipart, atualização de conteúdo,
// download e exclusão). Confere a estrutura Meu Drive/WJPDM/..., atualização no lugar (mesmo id,
// o Drive guarda as revisões), exclusão e acesso vencido (401).
import { RepositorioDrive } from "../src/comum/drive";
import { caminhoDoArquivo, indiceVazio, sincronizar, type Indice, type Repositorio } from "../src/pdm/sincronia";
import type { Arquivo } from "../src/pdm/regras";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

// ---------- Drive simulado ----------
interface Item { id: string; name: string; parents: string[]; mimeType: string; dados: string; revisoes: number; lixo?: boolean }
class DriveFalso {
  itens = new Map<string, Item>();
  n = 0;
  token = "ok";
  chamadas = 0;
  responder = async (url: string, init: RequestInit = {}): Promise<Response> => {
    this.chamadas++;
    if ((init.headers as Record<string, string>)?.Authorization !== `Bearer ${this.token}`) return new Response("unauthorized", { status: 401 });
    const u = new URL(url);
    const m = init.method ?? "GET";
    const id = u.pathname.match(/\/files\/([^/]+)$/)?.[1];
    if (m === "GET" && !id) {
      const qq = u.searchParams.get("q")!;
      const nome = /name='((?:[^'\\]|\\.)*)'/.exec(qq)?.[1]?.replace(/\\'/g, "'");
      const pai = /'([^']+)' in parents/.exec(qq)![1];
      const soPasta = qq.includes("mimeType='application/vnd.google-apps.folder'");
      const files = [...this.itens.values()].filter((x) => !x.lixo && x.parents.includes(pai) && (nome === undefined || x.name === nome) && (!soPasta || x.mimeType.endsWith("folder"))).map((x) => ({ id: x.id, name: x.name }));
      return Response.json({ files });
    }
    if (m === "GET" && id && u.searchParams.get("alt") === "media") {
      const x = this.itens.get(id);
      return x ? new Response(x.dados) : new Response("nf", { status: 404 });
    }
    if (m === "POST" && u.pathname === "/drive/v3/files") {
      const meta = JSON.parse(String(init.body));
      const x: Item = { id: `d${++this.n}`, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, dados: "", revisoes: 0 };
      this.itens.set(x.id, x);
      return Response.json({ id: x.id });
    }
    if (m === "POST" && u.pathname === "/upload/drive/v3/files") {
      const fronteira = /boundary=(\S+)/.exec((init.headers as Record<string, string>)["Content-Type"])![1];
      const corpo = await (init.body as Blob).text();
      const partes = corpo.split(`--${fronteira}`).slice(1, -1).map((p) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""));
      const meta = JSON.parse(partes[0]);
      const x: Item = { id: `d${++this.n}`, name: meta.name, parents: meta.parents, mimeType: "file", dados: partes[1], revisoes: 1 };
      this.itens.set(x.id, x);
      return Response.json({ id: x.id });
    }
    if (m === "PATCH" && id) {
      const x = this.itens.get(id);
      if (!x) return new Response("nf", { status: 404 });
      if (typeof init.body === "string") {
        if (JSON.parse(init.body).trashed) x.lixo = true; // metadados: para a lixeira do Drive
        return Response.json({ id });
      }
      x.dados = await (init.body as Blob).text();
      x.revisoes++;
      return Response.json({ id });
    }
    if (m === "DELETE" && id) {
      this.itens.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response("?", { status: 400 });
  };
  /** Caminho legível de um item (Meu Drive/...). */
  caminho(x: Item): string {
    const n: string[] = [x.name];
    for (let p = this.itens.get(x.parents[0]); p; p = this.itens.get(p.parents[0])) n.unshift(p.name);
    return n.join("/");
  }
  arquivos = () => [...this.itens.values()].filter((x) => x.mimeType === "file").map((x) => this.caminho(x)).sort();
}

class Memoria implements Repositorio {
  indice: Indice | null = null;
  blobs = new Map<string, string>();
  constructor(public nome: string) {}
  async lerIndice() { return this.indice ? JSON.parse(JSON.stringify(this.indice)) : null; }
  async gravarIndice(i: Indice) { this.indice = JSON.parse(JSON.stringify(i)); }
  async listarBlobs() { return new Set(this.blobs.keys()); }
  async lerBlob(id: string) { const t = this.blobs.get(id); return t === undefined ? undefined : new Blob([t]); }
  async gravarBlob(id: string, b: Blob) { this.blobs.set(id, await b.text()); }
  async apagarBlob(id: string) { this.blobs.delete(id); }
}
const arq = (id: string, nome: string, blobs: string[], mod: string, extra: Partial<Arquivo> = {}): Arquivo => ({
  id, nome, pasta: "p1", revisao: "", estado: "trabalho", cartao: {}, historico: [], mod,
  versoes: blobs.map((b, i) => ({ n: i + 1, blob: b, tamanho: 1, autor: "J", data: mod, comentario: "", revisao: "", estado: "trabalho" })), ...extra,
});
const AGORA = "2026-10-28T12:00:00.000Z";

const drive = new DriveFalso();
const tab = new Memoria("aparelho");
tab.indice = { ...indiceVazio(), pastas: [{ id: "p1", nome: "CAD", pai: null, mod: "2026-10-01T00:00:00.000Z" }], arquivos: [arq("a1", "Eixo.wjcad", ["b1"], "2026-10-27T10:00:00.000Z")] };
tab.blobs.set("b1", "eixo v1");
const repo = () => new RepositorioDrive(() => drive.token, drive.responder as typeof fetch);

// 1. primeiro envio: estrutura no Drive
let r = await sincronizar([tab, repo()], AGORA);
igual("sem falhas", r.falhas, []);
igual("estrutura em Meu Drive/WJPDM", drive.arquivos(), ["WJPDM/.wjpdm/blobs/b1", "WJPDM/.wjpdm/indice.json", "WJPDM/.wjpdm/pastas.json", "WJPDM/.wjpdm/visiveis.json", "WJPDM/CAD/Eixo (versões)/Eixo v1.wjcad", "WJPDM/CAD/Eixo.wjcad"]);
const visivel = [...drive.itens.values()].find((x) => x.name === "Eixo.wjcad")!;
igual("conteúdo legível", visivel.dados, "eixo v1");

// 2. nova versão: atualiza o mesmo arquivo no Drive (revisão), sem criar outro
tab.indice.arquivos[0] = arq("a1", "Eixo.wjcad", ["b1", "b2"], "2026-10-28T09:00:00.000Z");
tab.blobs.set("b2", "eixo v2");
r = await sincronizar([tab, repo()], AGORA);
const v2 = [...drive.itens.values()].filter((x) => x.name === "Eixo.wjcad");
igual("mesmo arquivo atualizado (o Drive guarda a revisão)", [v2.length, v2[0].id === visivel.id, v2[0].dados, v2[0].revisoes], [1, true, "eixo v2", 2]);

// 3. repetir: nada é enviado de novo (só leituras)
const antes = drive.n;
r = await sincronizar([tab, repo()], AGORA);
igual("repetir não cria nada", [drive.n - antes, r.copiados], [0, 0]);

// 4. arquivo novo vindo do Drive (outro aparelho) chega ao tablet
const outro = new Memoria("notebook");
r = await sincronizar([outro, repo()], AGORA);
igual("outro aparelho recebe o cofre do Drive", [outro.indice?.arquivos.map((a) => a.nome), outro.blobs.get("b2")], [["Eixo.wjcad"], "eixo v2"]);

// 5. renomeado e movido: o arquivo antigo sai do Drive
tab.indice.pastas.push({ id: "p2", nome: "Projetos", pai: null, mod: "2026-10-28T10:00:00.000Z" });
tab.indice.arquivos[0] = { ...tab.indice.arquivos[0], nome: "Eixo motor.wjcad", pasta: "p2", mod: "2026-10-28T11:00:00.000Z" };
r = await sincronizar([tab, repo()], AGORA);
igual("movido: arquivo e versões só no caminho novo (pasta de versões antiga some)", drive.arquivos().filter((x) => !x.includes(".wjpdm")), ["WJPDM/Projetos/Eixo motor (versões)/Eixo motor v1.wjcad", "WJPDM/Projetos/Eixo motor (versões)/Eixo motor v2.wjcad", "WJPDM/Projetos/Eixo motor.wjcad"]);

// 6. destruído no tablet: some do Drive (arquivo visível e conteúdo)
tab.indice.arquivos = [];
tab.indice.exclusoes = [{ id: "a1", tipo: "arquivo", data: "2026-10-28T11:30:00.000Z" }];
r = await sincronizar([tab, repo()], AGORA);
igual("excluído: só o índice fica", drive.arquivos(), ["WJPDM/.wjpdm/indice.json", "WJPDM/.wjpdm/pastas.json", "WJPDM/.wjpdm/visiveis.json"]);

// 7. acesso vencido (401): o Drive falha sozinho, o resto segue
drive.token = "novo"; // o Google trocou o token; o app ainda tem o antigo
const pen = new Memoria("pendrive");
r = await sincronizar([tab, pen, new RepositorioDrive(() => "ok", drive.responder as typeof fetch)], AGORA);
igual("acesso vencido: falha só no Drive, com mensagem clara", r.falhas.map((f) => `${f.repo}: ${f.erro}`), ["Google Drive: acesso ao Google vencido (reconecte)"]);
igual("pendrive igualado mesmo assim", pen.indice?.exclusoes.map((e) => e.id), ["a1"]);

// 8. nome com apóstrofo na consulta
tab.indice.arquivos = [arq("a9", "D'água.wjcad", ["b9"], "2026-10-28T11:40:00.000Z")];
tab.blobs.set("b9", "x");
drive.token = "ok";
const rr = repo();
r = await sincronizar([tab, rr], AGORA);
r = await sincronizar([tab, repo()], AGORA);
igual("apóstrofo no nome não duplica", drive.arquivos().filter((x) => x.endsWith("D'água.wjcad")).length, 1);
igual("caminho", caminhoDoArquivo(tab.indice, tab.indice.arquivos[0]), ["CAD", "D'água.wjcad"]);

// 9. pastas: a vazia é criada; a excluída (com subpasta) vai para a lixeira do Drive
const pastaNoDrive = (nome: string) => [...drive.itens.values()].find((x) => x.name === nome && x.mimeType.endsWith("folder"));
tab.indice.pastas.push({ id: "p3", nome: "Vazia", pai: null, mod: "2026-10-28T11:50:00.000Z" }, { id: "p4", nome: "Sub", pai: "p2", mod: "2026-10-28T11:50:00.000Z" });
r = await sincronizar([tab, repo()], AGORA);
igual("pastas vazias criadas no Drive", [!!pastaNoDrive("Vazia"), !!pastaNoDrive("Sub"), pastaNoDrive("Projetos")?.lixo], [true, true, undefined]);
tab.indice.pastas = tab.indice.pastas.filter((p) => p.id !== "p2" && p.id !== "p4");
tab.indice.exclusoes.push({ id: "p2", tipo: "pasta", data: "2026-10-28T11:55:00.000Z" }, { id: "p4", tipo: "pasta", data: "2026-10-28T11:55:00.000Z" });
r = await sincronizar([tab, repo()], AGORA);
igual("pasta excluída vai para a lixeira do Drive", [pastaNoDrive("Projetos")?.lixo, pastaNoDrive("Sub")?.lixo, pastaNoDrive("Vazia")?.lixo], [true, true, undefined]);

console.log(falhas ? `\ndrive: ${falhas} falha(s)` : "\ndrive: tudo certo");
if (falhas) process.exit(1);
