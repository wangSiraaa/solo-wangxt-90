/**
 * liblouis 转译封装（浏览器与 Node 双环境）。
 *
 * - 浏览器：index.html 以 <script> 加载本地 WASM 构建（public/liblouis/build-no-tables-utf16.js），
 *   表文件从同源 public/liblouis/tables/ fetch 后写入 emscripten MEMFS。全程不访问云服务。
 * - Node（测试）：require('liblouis')，表目录经 NODEFS 挂载。
 *
 * 语言规则全部来自 liblouis 表文件；本模块不实现任何"看似盲文"的替代算法。
 * 原文映射使用 lou_translate 的 inputPos 输出（每个输出单元对应的原文字符位置）。
 */
export interface TableInfo {
  /** 表文件名，如 en-us-g2.ctb */
  file: string;
  label: string;
  sha256: string;
}

export interface Manifest {
  liblouisVersion: string;
  packages: Record<string, string>;
  displayTable: string;
  tables: string[];
  files: Record<string, string>;
  note: string;
}

export interface Translation {
  /** Unicode 盲文（U+2800–U+28FF），空格为 U+0020 */
  braille: string;
  /** 与 braille 等长：每个输出单元对应的原文起始字符索引 */
  srcMap: number[];
  tableFile: string;
}

export interface TranslatorInfo {
  version: string;
  manifest: Manifest;
  tables: TableInfo[];
}

export const TABLE_LABELS: Record<string, string> = {
  'en-us-g1.ctb': '英语（美国）一级盲文',
  'en-us-g2.ctb': '英语（美国）二级盲文（缩写）',
  'en-ueb-g1.ctb': 'UEB 一级盲文',
  'en-ueb-g2.ctb': 'UEB 二级盲文（缩写）',
  'zh-chn.ctb': '汉语现行盲文（中国大陆）',
  'zh-hk.ctb': '粤语盲文（香港）',
};

const TABLE_DIR = 'liblouis/tables';
const MANIFEST_URL = 'liblouis/manifest.json';

interface EasyApiInstance {
  capi: any;
  version(): string;
  charSize(): number;
  getFilesystem(): any;
  translateString(table: string, inbuf: string): string | null;
  checkTable(table: string): number;
  registerLogCallback(fn: ((lvl: number, msg: string) => void) | null): void;
}

let instance: EasyApiInstance | null = null;
let manifestCache: Manifest | null = null;
let initPromise: Promise<TranslatorInfo> | null = null;

const isNode = typeof process !== 'undefined' && !!process.versions?.node;

async function fetchText(url: string): Promise<string> {
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    return readFile(join(process.cwd(), 'public', url), 'utf8');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败: ${url} (${res.status})`);
  return res.text();
}

export async function getManifest(): Promise<Manifest> {
  if (!manifestCache) manifestCache = JSON.parse(await fetchText(MANIFEST_URL)) as Manifest;
  return manifestCache;
}

async function createInstance(): Promise<EasyApiInstance> {
  if (isNode) {
    // vitest/node：经 createRequire 加载 CJS 版 liblouis（该分支不会进入浏览器包）
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const liblouis = require('liblouis');
    liblouis.registerLogCallback(null);
    liblouis.enableOnDemandTableLoading(); // NODEFS 挂载 node_modules/liblouis-build/tables 到 /tables
    liblouis.getFilesystem().chdir('/tables');
    return liblouis as EasyApiInstance;
  }
  // 浏览器：构建脚本已在 index.html 中加载为全局 liblouisBuild。
  // 直接使用 emscripten Module（ccall/FS），不引入 easy-api（避免打包器把第二份构建拉进 bundle）。
  const w = window as any;
  if (!w.liblouisBuild) throw new Error('liblouis WASM 构建未加载（检查 public/liblouis/build-no-tables-utf16.js）');
  const capi = w.liblouisBuild;
  capi.ccall('lou_setLogLevel', 'void', ['number'], [60000]); // 关闭日志输出
  const api: EasyApiInstance = {
    capi,
    version: () => capi.ccall('lou_version', 'string', [], []),
    charSize: () => capi.ccall('lou_charSize', 'number', [], []),
    getFilesystem: () => capi.FS,
    translateString: () => {
      throw new Error('浏览器环境请使用 translate()（lou_translate 直接调用）');
    },
    checkTable: (t: string) => capi.ccall('lou_checkTable', 'number', ['string'], [t]),
    registerLogCallback: () => {},
  };
  // 将随项目固定的表文件写入 MEMFS 并切换工作目录
  const FS = api.getFilesystem();
  const manifest = await getManifest();
  try { FS.mkdir('/tables'); } catch { /* 已存在 */ }
  for (const name of Object.keys(manifest.files)) {
    FS.writeFile(`/tables/${name}`, await fetchText(`${TABLE_DIR}/${name}`));
  }
  FS.chdir('/tables');
  return api;
}

export async function initTranslator(): Promise<TranslatorInfo> {
  if (!initPromise) {
    initPromise = (async () => {
      instance = await createInstance();
      const manifest = await getManifest();
      const tables: TableInfo[] = manifest.tables.map((file) => ({
        file,
        label: TABLE_LABELS[file] ?? file,
        sha256: manifest.files[file] ?? '',
      }));
      return { version: instance.version(), manifest, tables };
    })();
  }
  return initPromise;
}

function tableList(tableFile: string): string {
  // unicode.dis 必须位于表列表最前，使输出为 Unicode 盲文点位
  return `unicode.dis,${tableFile}`;
}

/**
 * 转译并返回原文映射。使用 lou_translate（非简化的 lou_translateString），
 * 以取得每个输出盲文单元对应的原文位置（inputPos）。
 */
export function translate(text: string, tableFile: string): Translation {
  if (!instance) throw new Error('转译器未初始化，请先 await initTranslator()');
  const capi = instance.capi;
  const charSize = instance.charSize(); // 本构建为 UTF-16（2 字节）
  const inLen = text.length;
  if (inLen === 0) return { braille: '', srcMap: [], tableFile };

  const outCap = inLen * 8 + 32;
  const inPtr = capi._malloc((inLen + 1) * charSize);
  const outPtr = capi._malloc(outCap * charSize);
  const inLenPtr = capi._malloc(4);
  const outLenPtr = capi._malloc(4);
  const inPosPtr = capi._malloc(outCap * 4);
  try {
    capi.setValue(inLenPtr, inLen, 'i32');
    capi.setValue(outLenPtr, outCap, 'i32');
    for (let i = 0; i < inLen; i++) capi.setValue(inPtr + i * charSize, text.charCodeAt(i), 'i16');
    capi.setValue(inPtr + inLen * charSize, 0, 'i16');

    const ok = capi.ccall(
      'lou_translate', 'number',
      ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [tableList(tableFile), inPtr, inLenPtr, outPtr, outLenPtr, null, null, null, inPosPtr, null, 0],
    );
    if (!ok) throw new Error(`liblouis 转译失败（表 ${tableFile}）`);

    const outLen = capi.getValue(outLenPtr, 'i32');
    let braille = '';
    const srcMap: number[] = [];
    for (let i = 0; i < outLen; i++) {
      braille += String.fromCharCode(capi.getValue(outPtr + i * charSize, 'i16'));
      srcMap.push(capi.getValue(inPosPtr + i * 4, 'i32'));
    }
    return { braille, srcMap, tableFile };
  } finally {
    for (const p of [inPtr, outPtr, inLenPtr, outLenPtr, inPosPtr]) capi._free(p);
  }
}

/** 读取表文件源码（规则查看面板用），来自随项目固定的本地副本 */
export async function getTableSource(tableFile: string): Promise<string> {
  return fetchText(`${TABLE_DIR}/${tableFile}`);
}

/**
 * 转译缓存：同一文本 + 同一语言表只转译一次。
 * 多个输出规格共享转译结果（版面各自独立计算）。
 */
export class TranslationCache {
  private map = new Map<string, Translation>();
  /** 实际调用 liblouis 的次数（测试与诊断用） */
  computed = 0;

  get = (text: string, tableFile: string): Translation => {
    const key = `${tableFile}${text}`;
    let t = this.map.get(key);
    if (!t) {
      t = translate(text, tableFile);
      this.computed++;
      this.map.set(key, t);
    }
    return t;
  };

  clear() {
    this.map.clear();
    this.computed = 0;
  }
}

export const translationCache = new TranslationCache();
