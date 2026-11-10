// Tiny IndexedDB wrapper. Everything Offcut persists lives here, on this device.
const DB_NAME = 'offcut';
const STORES = ['kv', 'media'] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key));
export const idbSet = (store: StoreName, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key));
export const idbDel = (store: StoreName, key: string) => tx(store, 'readwrite', (s) => s.delete(key));
export const idbKeys = (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
