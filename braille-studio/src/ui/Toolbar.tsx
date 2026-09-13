import type { TableInfo } from '../braille/translator';
import { PAGE_PRESETS } from '../braille/spec';

export interface ToolbarProps {
  docName: string;
  tableFile: string;
  pagePresetId: string;
  showPageNumbers: boolean;
  tables: TableInfo[];
  liblouisVersion: string;
  onDocName(name: string): void;
  onTable(file: string): void;
  onPreset(id: string): void;
  onTogglePageNumbers(v: boolean): void;
  onLoadSample(): void;
  onSave(): void;
  onOpen(): void;
  onExportPdf(): void;
  exporting: boolean;
}

export function Toolbar(p: ToolbarProps) {
  return (
    <header className="toolbar">
      <strong>无障碍出版工作室</strong>
      <input
        aria-label="工程名"
        value={p.docName}
        onChange={(e) => p.onDocName(e.target.value)}
        style={{ width: 180 }}
      />
      <label>
        语言表
        <select value={p.tableFile} onChange={(e) => p.onTable(e.target.value)}>
          {p.tables.map((t) => (
            <option key={t.file} value={t.file}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        页面
        <select value={p.pagePresetId} onChange={(e) => p.onPreset(e.target.value)}>
          {PAGE_PRESETS.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input type="checkbox" checked={p.showPageNumbers} onChange={(e) => p.onTogglePageNumbers(e.target.checked)} />
        页码
      </label>
      <span className="spacer" />
      <button onClick={p.onLoadSample}>载入验证样例</button>
      <button onClick={p.onSave}>保存</button>
      <button onClick={p.onOpen}>打开</button>
      <button onClick={p.onExportPdf} disabled={p.exporting}>
        {p.exporting ? '导出中…' : '导出 PDF'}
      </button>
      <span className="version">liblouis {p.liblouisVersion}（本地 WASM）</span>
    </header>
  );
}
