// Armazenamento local em IndexedDB dos apps do WJProMaster (cofre do WJPDM, cadastros do WJERP).
// Funciona offline e guarda arquivos grandes (blobs); cada loja guarda registros com "id".

export type Loja = string;
/** Lojas do cofre do WJPDM. */
export const LOJAS_PDM = ["meta", "pastas", "arquivos", "itens", "blobs", "exclusoes", "referencias"];

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, erro) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });

export class Armazem {
  private constructor(private db: IDBDatabase) {
    this.vigiar(db);
  }

  private lojas: string[] = [];
  private nome = "";
  /** Outra página subiu a versão do banco (tabela nova): esta conexão fecha e reabre sozinha. */
  private reabrindo: Promise<void> | null = null;

  private vigiar(db: IDBDatabase) {
    db.onversionchange = () => {
      db.close();
      this.reabrindo = Armazem.abrir(this.nome, this.lojas).then((a) => {
        this.db = a.db;
        this.vigiar(a.db);
        this.reabrindo = null;
      });
    };
  }

  /** Abre (ou cria) o banco com as lojas pedidas; lojas novas sobem a versão do banco. */
  static abrir(nome = "wjpdm", lojas: string[] = LOJAS_PDM): Promise<Armazem> {
    return new Promise((ok, erro) => {
      const pedir = (versao?: number) => {
        const r = indexedDB.open(nome, versao);
        r.onupgradeneeded = () => {
          for (const l of lojas) if (!r.result.objectStoreNames.contains(l)) r.result.createObjectStore(l, { keyPath: "id" });
        };
        r.onsuccess = () => {
          const db = r.result;
          if (lojas.some((l) => !db.objectStoreNames.contains(l))) {
            const v = db.version + 1;
            db.close();
            return pedir(v);
          }
          const a = new Armazem(db);
          a.lojas = lojas;
          a.nome = nome;
          ok(a);
        };
        r.onerror = () => erro(r.error);
        // outra aba com o banco aberto na versão antiga: ela fecha (onversionchange) e o pedido segue
        r.onblocked = () => {};
      };
      pedir();
    });
  }

  private async loja(l: Loja, modo: IDBTransactionMode = "readonly") {
    if (this.reabrindo) await this.reabrindo;
    return this.db.transaction(l, modo).objectStore(l);
  }
  async todos<T>(l: Loja): Promise<T[]> {
    return (await req((await this.loja(l)).getAll())) as T[];
  }
  async chaves(l: Loja): Promise<string[]> {
    return (await req((await this.loja(l)).getAllKeys())) as string[];
  }
  async ler<T>(l: Loja, id: string): Promise<T | undefined> {
    return (await req((await this.loja(l)).get(id))) as T | undefined;
  }
  async por(l: Loja, valor: { id: string }) {
    await req((await this.loja(l, "readwrite")).put(valor));
  }
  async apagar(l: Loja, id: string) {
    await req((await this.loja(l, "readwrite")).delete(id));
  }
  async limparTudo() {
    for (const l of this.lojas) await req((await this.loja(l, "readwrite")).clear());
  }
  async blob(id: string): Promise<Blob | undefined> {
    return (await this.ler<{ id: string; dados: Blob }>("blobs", id))?.dados;
  }
  async porBlob(id: string, dados: Blob) {
    await this.por("blobs", { id, dados } as { id: string });
  }
}

/** Blob → base64 (para a cópia de segurança). */
export function paraBase64(b: Blob): Promise<string> {
  return new Promise((ok, erro) => {
    const f = new FileReader();
    f.onload = () => ok(String(f.result).replace(/^data:[^,]*,/, ""));
    f.onerror = () => erro(f.error);
    f.readAsDataURL(b);
  });
}

export function deBase64(s: string, tipo = "application/octet-stream"): Blob {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: tipo });
}
