/**
 * IndexedDB 工程存储（纯本地，无云服务）。
 */
import type { StudioDocument } from '../model/document';

const DB_NAME = 'braille-studio';
const STORE = 'projects';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  tableFile: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export async function saveProject(doc: StudioDocument): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...doc, updatedAt: Date.now() }));
}

export async function loadProject(id: string): Promise<StudioDocument | undefined> {
  return tx('readonly', (s) => s.get(id)) as Promise<StudioDocument | undefined>;
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = (await tx('readonly', (s) => s.getAll())) as StudioDocument[];
  return all
    .map(({ id, name, updatedAt, tableFile }) => ({ id, name, updatedAt, tableFile }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
