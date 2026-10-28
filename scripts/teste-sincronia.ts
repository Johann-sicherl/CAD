// Teste da sincronia entre cópias do cofre do WJPDM (src/pdm/sincronia.ts), com cópias em memória:
// arquivo novo, versão nova, conflito (mais recente vence, o outro vai para a lixeira), exclusão,
// lixeira vencida, cópia que falha no meio e repetição sem efeito.
import { caminhoDoArquivo, indiceVazio, sincronizar, type Indice, type Repositorio } from "../src/pdm/sincronia";
import type { Arquivo } from "../src/pdm/regras";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

class Memoria implements Repositorio {
  publicado = false;
  indice: Indice | null = null;
  blobs = new Map<string, string>();
  visiveis = new Map<string, string>();
  quebrado = false;
  constructor(public nome: string) {}
  async lerIndice() {
    if (this.quebrado) throw new Error("desconectado");
    return this.indice ? JSON.parse(JSON.stringify(this.indice)) : null;
  }
  async gravarIndice(i: Indice) {
    this.indice = JSON.parse(JSON.stringify(i));
  }
  async listarBlobs() {
    return new Set(this.blobs.keys());
  }
  async lerBlob(id: string) {
    const t = this.blobs.get(id);
    return t === undefined ? undefined : new Blob([t]);
  }
  async gravarBlob(id: string, b: Blob) {
    this.blobs.set(id, await b.text());
  }
  async apagarBlob(id: string) {
    this.blobs.delete(id);
  }
  async gravarVisiveis(i: Indice) {
    this.visiveis.clear();
    for (const a of i.arquivos) if (!a.lixeira) this.visiveis.set(caminhoDoArquivo(i, a).join("/"), (a.trabalho?.blob ?? a.versoes[a.versoes.length - 1].blob));
  }
}

const arq = (id: string, blobs: string[], mod: string, extra: Partial<Arquivo> = {}): Arquivo => ({
  id, nome: `${id}.wjcad`, pasta: "p1", revisao: "", estado: "trabalho", cartao: {}, historico: [], mod,
  versoes: blobs.map((b, i) => ({ n: i + 1, blob: b, tamanho: 1, autor: "J", data: mod, comentario: "", revisao: "", estado: "trabalho" })),
  ...extra,
});
const com = (r: Memoria, arquivos: Arquivo[], blobs: Record<string, string>) => {
  r.indice = { ...indiceVazio(), pastas: [{ id: "p1", nome: "CAD", pai: null, mod: "2026-10-01T00:00:00.000Z" }], arquivos };
  for (const [k, v] of Object.entries(blobs)) r.blobs.set(k, v);
};
const AGORA = "2026-10-28T12:00:00.000Z";

// 1. pendrive vazio recebe o cofre do tablet (arquivo, blob e arquivo visível)
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [arq("Eixo", ["b1"], "2026-10-27T10:00:00.000Z")], { b1: "eixo v1" });
  const r = await sincronizar([tab, pen], AGORA);
  igual("pendrive recebeu o arquivo", pen.indice?.arquivos.map((a) => a.id), ["Eixo"]);
  igual("pendrive recebeu o conteúdo", pen.blobs.get("b1"), "eixo v1");
  igual("arquivo visível em CAD/Eixo.wjcad", [...pen.visiveis.keys()], ["CAD/Eixo.wjcad"]);
  igual("1 blob copiado, sem conflito", [r.copiados, r.conflitos.length], [1, 0]);
  const r2 = await sincronizar([tab, pen], AGORA);
  igual("repetir não copia nada", [r2.copiados, r2.conflitos.length], [0, 0]);
}

// 2. versão nova no pendrive (o tablet tem só a v1): sobe para o tablet
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [arq("Eixo", ["b1"], "2026-10-27T10:00:00.000Z")], { b1: "v1" });
  com(pen, [arq("Eixo", ["b1", "b2"], "2026-10-28T09:00:00.000Z")], { b1: "v1", b2: "v2" });
  const r = await sincronizar([tab, pen], AGORA);
  igual("tablet agora tem 2 versões", tab.indice?.arquivos[0].versoes.length, 2);
  igual("tablet recebeu o conteúdo da v2", tab.blobs.get("b2"), "v2");
  igual("sem conflito (a v2 contém a v1)", r.conflitos, []);
}

// 3. conflito: v2 diferente nos dois lados; vence a mais recente, a outra vai para a lixeira
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [arq("Eixo", ["b1", "bT"], "2026-10-28T08:00:00.000Z")], { b1: "v1", bT: "v2 do tablet" });
  com(pen, [arq("Eixo", ["b1", "bP"], "2026-10-28T09:00:00.000Z")], { b1: "v1", bP: "v2 do pendrive" });
  const r = await sincronizar([tab, pen], AGORA);
  const atual = tab.indice!.arquivos.find((a) => a.id === "Eixo")!;
  igual("vence a mais recente (pendrive)", atual.versoes[1].blob, "bP");
  const lix = tab.indice!.arquivos.find((a) => a.lixeira)!;
  igual("a do tablet foi para a lixeira", [lix?.nome, lix?.versoes[1].blob], ["Eixo (conflito 2026-10-28).wjcad", "bT"]);
  igual("conteúdo perdedor guardado nas duas cópias", [tab.blobs.get("bT"), pen.blobs.get("bT")], ["v2 do tablet", "v2 do tablet"]);
  igual("conflito avisado", r.conflitos, ["Eixo.wjcad"]);
  const r2 = await sincronizar([tab, pen], AGORA);
  igual("repetir não duplica a cópia de conflito", [r2.conflitos.length, tab.indice!.arquivos.length], [0, 2]);
}

// 4. exclusão (destruído no tablet) some do pendrive e libera o conteúdo
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [], {});
  tab.indice!.exclusoes = [{ id: "Eixo", tipo: "arquivo", data: "2026-10-28T10:00:00.000Z" }];
  com(pen, [arq("Eixo", ["b1"], "2026-10-27T10:00:00.000Z")], { b1: "v1" });
  await sincronizar([tab, pen], AGORA);
  igual("excluído no pendrive", pen.indice!.arquivos.length, 0);
  igual("conteúdo apagado do pendrive", pen.blobs.has("b1"), false);
  igual("visível apagado", pen.visiveis.size, 0);
}

// 5. alterado DEPOIS da exclusão (em outra cópia): o arquivo vale
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [], {});
  tab.indice!.exclusoes = [{ id: "Eixo", tipo: "arquivo", data: "2026-10-27T10:00:00.000Z" }];
  com(pen, [arq("Eixo", ["b1", "b2"], "2026-10-28T09:00:00.000Z")], { b1: "v1", b2: "v2" });
  await sincronizar([tab, pen], AGORA);
  igual("alteração mais nova que a exclusão mantém o arquivo", tab.indice!.arquivos.map((a) => a.id), ["Eixo"]);
}

// 6. lixeira com mais de 30 dias é destruída
{
  const tab = new Memoria("tablet");
  com(tab, [arq("Velho", ["b9"], "2026-09-01T00:00:00.000Z", { lixeira: true, lixeiraData: "2026-09-01T00:00:00.000Z" }), arq("Novo", ["b8"], "2026-10-20T00:00:00.000Z", { lixeira: true, lixeiraData: "2026-10-20T00:00:00.000Z" })], { b9: "x", b8: "y" });
  await sincronizar([tab], AGORA);
  igual("só a lixeira vencida foi destruída", tab.indice!.arquivos.map((a) => a.id), ["Novo"]);
  igual("exclusão registrada", tab.indice!.exclusoes.map((e) => e.id), ["Velho"]);
}

// 7. pendrive arrancado: o tablet e o Drive continuam se igualando
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive"), drive = new Memoria("drive");
  com(tab, [arq("Eixo", ["b1"], "2026-10-27T10:00:00.000Z")], { b1: "v1" });
  pen.quebrado = true;
  const r = await sincronizar([tab, pen, drive], AGORA);
  igual("falha só do pendrive", r.falhas.map((f) => f.repo), ["pendrive"]);
  igual("Drive recebeu o arquivo", drive.indice?.arquivos.map((a) => a.id), ["Eixo"]);
}

// 8. cópia de trabalho (salvar no app sem GO-IN) também viaja
{
  const tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  com(tab, [arq("Eixo", ["b1"], "2026-10-28T11:00:00.000Z", { trabalho: { blob: "w1", tamanho: 1, data: "2026-10-28T11:00:00.000Z", autor: "J" } })], { b1: "v1", w1: "trabalho" });
  await sincronizar([tab, pen], AGORA);
  igual("pendrive tem a cópia de trabalho", [pen.blobs.get("w1"), pen.visiveis.get("CAD/Eixo.wjcad")], ["trabalho", "w1"]);
}

// 9. GO-OUT fica no dispositivo: pendrive (publicação) não recebe arquivo novo nem cópia de trabalho
{
  const ap = new Memoria("aparelho"), tab = new Memoria("tablet"), pen = new Memoria("pendrive");
  pen.publicado = true;
  com(ap, [
    arq("Novo", ["n1"], "2026-10-28T11:00:00.000Z", { soLocal: true, checkout: { usuario: "J", data: "x" } }),
    arq("Eixo", ["b1"], "2026-10-28T11:00:00.000Z", { trabalho: { blob: "w1", tamanho: 1, data: "x", autor: "J" } }),
  ], { n1: "novo", b1: "v1", w1: "trabalho" });
  await sincronizar([ap, tab, pen], AGORA);
  igual("pasta do dispositivo recebe tudo", [tab.indice!.arquivos.length, tab.blobs.has("n1"), tab.blobs.has("w1")], [2, true, true]);
  igual("pendrive só recebe o publicado", [pen.indice!.arquivos.map((a) => a.id), pen.blobs.has("n1"), pen.blobs.has("w1")], [["Eixo"], false, false]);
  igual("pendrive mostra a versão publicada", [pen.indice!.arquivos[0].trabalho, pen.visiveis.get("CAD/Eixo.wjcad")], [undefined, "b1"]);
  const r2 = await sincronizar([ap, tab, pen], AGORA);
  igual("cópia de trabalho continua no aparelho (sem conflito)", [ap.indice!.arquivos.find((a) => a.id === "Eixo")!.trabalho?.blob, r2.conflitos.length], ["w1", 0]);
  // GO-IN: vira versão 2, sai do "só no dispositivo" e chega ao pendrive
  const novo = ap.indice!.arquivos.find((a) => a.id === "Novo")!;
  novo.soLocal = undefined;
  novo.mod = "2026-10-28T11:30:00.000Z";
  const eixo = ap.indice!.arquivos.find((a) => a.id === "Eixo")!;
  eixo.versoes.push({ ...eixo.versoes[0], n: 2, blob: "w1" });
  eixo.trabalho = undefined;
  eixo.mod = "2026-10-28T11:30:00.000Z";
  await sincronizar([ap, tab, pen], AGORA);
  igual("depois do GO-IN o pendrive tem os dois", [pen.indice!.arquivos.map((a) => a.id).sort(), pen.blobs.has("n1"), pen.blobs.has("w1")], [["Eixo", "Novo"], true, true]);
}

// 10. salvar de novo (cópia de trabalho ou rascunho nunca publicado substituídos) não é conflito
{
  const ap = new Memoria("aparelho"), tab = new Memoria("tablet");
  com(ap, [
    arq("Novo", ["n1"], "2026-10-28T11:00:00.000Z", { soLocal: true }),
    arq("Eixo", ["b1"], "2026-10-28T11:00:00.000Z", { trabalho: { blob: "w1", tamanho: 1, data: "x", autor: "J" } }),
  ], { n1: "rascunho 1", b1: "v1", w1: "trabalho 1" });
  await sincronizar([ap, tab], AGORA);
  const novo = ap.indice!.arquivos.find((a) => a.id === "Novo")!, eixo = ap.indice!.arquivos.find((a) => a.id === "Eixo")!;
  novo.versoes[0].blob = "n2"; novo.mod = "2026-10-28T11:10:00.000Z";
  eixo.trabalho = { blob: "w2", tamanho: 1, data: "y", autor: "J" }; eixo.mod = "2026-10-28T11:10:00.000Z";
  ap.blobs.set("n2", "rascunho 2"); ap.blobs.set("w2", "trabalho 2");
  const r = await sincronizar([ap, tab], AGORA);
  igual("salvar seguido não gera conflito", [r.conflitos, tab.indice!.arquivos.length], [[], 2]);
  igual("pasta do dispositivo fica com o conteúdo novo e libera o antigo", [tab.blobs.has("n2"), tab.blobs.has("w2"), tab.blobs.has("n1"), tab.blobs.has("w1")], [true, true, false, false]);
}

console.log(falhas ? `\nsincronia: ${falhas} falha(s)` : "\nsincronia: tudo certo");
if (falhas) process.exit(1);
