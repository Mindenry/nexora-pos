export interface OutboxItem {
  operationId: string;
  payload: unknown;
  queuedAt: string;
  status: 'pending' | 'synced' | 'failed';
  attempts: number;
  error?: string;
  saleNumber?: string;
  receipt?: unknown;
}

const DB_NAME = 'nexora-pos';
const DB_VERSION = 1;
const OUTBOX = 'outbox';
const CACHE_KEY = 'nexora.pos.bootstrap';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: 'operationId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX, mode);
    const store = tx.objectStore(OUTBOX);
    let request: IDBRequest<T> | void;
    try {
      request = fn(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function enqueueSale(item: OutboxItem): Promise<void> {
  await withStore('readwrite', (store) => store.put(item));
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const result = await withStore<OutboxItem[]>('readonly', (store) => store.getAll());
  return (result ?? []).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function updateOutbox(item: OutboxItem): Promise<void> {
  await withStore('readwrite', (store) => store.put(item));
}

export async function clearSynced(): Promise<void> {
  const items = await listOutbox();
  await Promise.all(
    items
      .filter((item) => item.status === 'synced')
      .map((item) => withStore('readwrite', (store) => store.delete(item.operationId))),
  );
}

export function cacheBootstrap(value: unknown): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), value }));
  } catch {
    // Cache is best-effort; the server remains the source of truth.
  }
}

export function readCachedBootstrap<T>(): { at: string; value: T } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { at: string; value: T };
  } catch {
    return null;
  }
}
