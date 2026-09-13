/**
 * 将 liblouis 的 WASM 构建与指定语言表复制到 public/liblouis/，
 * 并生成带 SHA-256 的 manifest.json。
 *
 * 语言表版本固定策略：
 *  1. package.json 中 liblouis / liblouis-build 使用精确版本（无版本区间）；
 *  2. package-lock.json 锁定依赖树；
 *  3. 本脚本把表文件实体复制进项目（public/liblouis/tables/），
 *     并对每个文件计算 SHA-256 写入 manifest.json —— 表随项目固定，
 *     不依赖运行时从外部拉取。
 *
 * 表之间的 include 依赖在此递归解析，保证离线可用。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tablesDir = join(root, 'node_modules', 'liblouis-build', 'tables');
const buildFile = join(root, 'node_modules', 'liblouis-build', 'build-no-tables-utf16.js');
const outDir = join(root, 'public', 'liblouis');
const outTables = join(outDir, 'tables');

/** 工作室随项目固定发布的语言表（zh-tw.ctb 在 liblouis 3.2.0 的 JS 构建下会触发异常，故不发布） */
export const SHIPPED_TABLES = [
  'en-us-g1.ctb',
  'en-us-g2.ctb',
  'en-ueb-g1.ctb',
  'en-ueb-g2.ctb',
  'zh-chn.ctb',
  'zh-hk.ctb',
];

/** unicode.dis 必须置于表列表最前，使输出为 Unicode 盲文点位（U+2800–U+28FF） */
const DISPLAY_TABLE = 'unicode.dis';

const INCLUDE_RE = /^\s*include\s+(\S+)/gm;

function resolveIncludes(file, seen = new Set()) {
  const name = file.replace(/^.*\//, '');
  if (seen.has(name)) return seen;
  seen.add(name);
  const full = join(tablesDir, name);
  if (!existsSync(full)) {
    throw new Error(`表文件缺失: ${name}（被 include 但不存在于 liblouis-build/tables）`);
  }
  const src = readFileSync(full, 'utf8');
  for (const m of src.matchAll(INCLUDE_RE)) resolveIncludes(m[1], seen);
  return seen;
}

mkdirSync(outTables, { recursive: true });

const needed = new Set([DISPLAY_TABLE]);
for (const t of SHIPPED_TABLES) for (const f of resolveIncludes(t)) needed.add(f);

const hashes = {};
for (const name of [...needed].sort()) {
  const buf = readFileSync(join(tablesDir, name));
  writeFileSync(join(outTables, name), buf);
  hashes[name] = createHash('sha256').update(buf).digest('hex');
}

copyFileSync(buildFile, join(outDir, 'build-no-tables-utf16.js'));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = {
  liblouisVersion: '3.2.0',
  packages: {
    liblouis: pkg.dependencies.liblouis,
    'liblouis-build': pkg.dependencies['liblouis-build'],
  },
  displayTable: DISPLAY_TABLE,
  tables: SHIPPED_TABLES,
  files: hashes,
  note: '表文件已随项目固定（精确依赖版本 + 文件实体 + SHA-256）。运行时仅从本地 public/liblouis/ 加载。',
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`[prepare-liblouis] 已复制 ${needed.size} 个表文件 + WASM 构建到 public/liblouis/`);
console.log(`[prepare-liblouis] 发布表: ${SHIPPED_TABLES.join(', ')}`);
