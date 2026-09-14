/**
 * 导出记录：每次 PDF 导出留存一份快照（字节 + 元数据），
 * 旧版导出可随时回看/重新下载。纯本地存储，无云服务。
 */

export interface ExportRecord {
  id: string;
  docId: string;
  docName: string;
  /** 导出时的输出规格 */
  profileId: string;
  profileLabel: string;
  tableFile: string;
  pageCount: number;
  createdAt: number;
  bytes: ArrayBuffer;
}

export interface ExportStore {
  save(rec: ExportRecord): Promise<void>;
  list(): Promise<ExportRecord[]>;
  get(id: string): Promise<ExportRecord | undefined>;
  remove(id: string): Promise<void>;
}

/** 内存实现（测试用） */
export class MemoryExportStore implements ExportStore {
  private map = new Map<string, ExportRecord>();
  async save(rec: ExportRecord) {
    this.map.set(rec.id, rec);
  }
  async list() {
    return [...this.map.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async get(id: string) {
    return this.map.get(id);
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

const DB_NAME = 'braille-studio';
const STORE = 'exports';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB 实现（应用用） */
export class IdbExportStore implements ExportStore {
  private tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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
  async save(rec: ExportRecord) {
    await this.tx('readwrite', (s) => s.put(rec));
  }
  async list() {
    const all = (await this.tx('readonly', (s) => s.getAll())) as ExportRecord[];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }
  async get(id: string) {
    return this.tx('readonly', (s) => s.get(id)) as Promise<ExportRecord | undefined>;
  }
  async remove(id: string) {
    await this.tx('readwrite', (s) => s.delete(id));
  }
}
