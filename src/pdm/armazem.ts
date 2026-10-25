// Armazenamento do cofre local do WJPDM em IndexedDB (metadados + conteúdo dos arquivos).
// Funciona offline e guarda arquivos grandes (blobs); os metadados ficam também em memória.

export type Loja = "meta" | "pastas" | "arquivos" | "itens" | "blobs";
const LOJAS: Loja[] = ["meta", "pastas", "arquivos", "itens", "blobs"];

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, erro) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });

export class Armazem {
  private constructor(private db: IDBDatabase) {}

  static abrir(nome = "wjpdm"): Promise<Armazem> {
    return new Promise((ok, erro) => {
      const r = indexedDB.open(nome, 1);
      r.onupgradeneeded = () => {
        for (const l of LOJAS) if (!r.result.objectStoreNames.contains(l)) r.result.createObjectStore(l, { keyPath: "id" });
      };
      r.onsuccess = () => ok(new Armazem(r.result));
      r.onerror = () => erro(r.error);
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
    for (const l of LOJAS) await req(this.loja(l, "readwrite").clear());
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
