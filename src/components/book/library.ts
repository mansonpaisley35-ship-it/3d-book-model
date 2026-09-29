/*
 * Browser-local library of imported books (IndexedDB). Each record keeps the
 * original PDF, any cover images, and the book's saved look and pose, so a
 * book never has to be re-imported or re-configured.
 */
import type { BookAdjusts, BookImages } from "./Book";
import type { Aspects, BookConfig } from "./config";

export type PoseKey =
  | "front"
  | "threeQuarter"
  | "back"
  | "spineStanding"
  | "foreEdge"
  | "lyingFlat"
  | "lyingBack"
  | "spineLying";

export type StoredBook = {
  id: string;
  title: string;
  pageCount: number;
  createdAt: number;
  pdf: Blob;
  covers: Partial<Record<keyof BookImages, Blob>>;
  adjusts: BookAdjusts;
  config: BookConfig;
  aspects: Aspects;
  pose: PoseKey;
  autoSpin: boolean;
  orbit: boolean;
};

const DB = "book-canvas";
const STORE = "books";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listBooks(): Promise<StoredBook[]> {
  const all = await tx<StoredBook[]>("readonly", (s) => s.getAll() as IDBRequest<StoredBook[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const saveBook = (book: StoredBook) => tx("readwrite", (s) => s.put(book));
export const deleteBook = (id: string) => tx("readwrite", (s) => s.delete(id));

export async function updateBook(id: string, patch: Partial<StoredBook>) {
  const cur = await tx<StoredBook | undefined>("readonly", (s) => s.get(id));
  if (!cur) return;
  await saveBook({ ...cur, ...patch, id });
}

export const LAST_BOOK_KEY = "book-canvas:last";
