// Armazenamento local em IndexedDB dos apps do WJProMaster (cofre do WJPDM, cadastros do WJERP).
// Funciona offline e guarda arquivos grandes (blobs); cada loja guarda registros com "id".

export type Loja = string;
/** Lojas do cofre do WJPDM. */
export const LOJAS_PDM = ["meta", "pastas", "arquivos", "itens", "blobs"];

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, erro) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });

export class Armazem {
  private constructor(private db: IDBDatabase) {}

  private lojas: string[] = [];

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
          ok(a);
        };
        r.onerror = () => erro(r.error);
      };
      pedir();
    });
  }

  private loja(l: Loja, modo: IDBTransactionMode = "readonly") {
    return this.db.transaction(l, modo).objectStore(l);
  }
  todos<T>(l: Loja): Promise<T[]> {
    return req(this.loja(l).getAll()) as Promise<T[]>;
  }
  ler<T>(l: Loja, id: string): Promise<T | undefined> {
    return req(this.loja(l).get(id)) as Promise<T | undefined>;
  }
  async por(l: Loja, valor: { id: string }) {
    await req(this.loja(l, "readwrite").put(valor));
  }
  async apagar(l: Loja, id: string) {
    await req(this.loja(l, "readwrite").delete(id));
  }
  async limparTudo() {
    for (const l of this.lojas) await req(this.loja(l, "readwrite").clear());
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
