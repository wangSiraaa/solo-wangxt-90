/**
 * 修订影响分析：对每页版面内容计算签名，编辑前后 diff 出受影响页。
 * 未受影响页面上的人工定位（按锚点 ID 挂接的微调）自然保留。
 */
import type { Layout } from './engine';
import { lineText } from './engine';

/** 每页内容签名（盲文行 + 图形 + 页码；不含屏幕标注） */
export function pageSignatures(layout: Layout): string[] {
  const sigs: string[] = [];
  for (let p = 0; p < layout.pageCount; p++) {
    const parts: string[] = [];
    for (const ln of layout.lines) {
      if (ln.page !== p) continue;
      parts.push(`${ln.role}@${ln.line}:${ln.colStart}:${lineText(ln)}`);
    }
    for (const f of layout.figures) {
      if (f.page !== p) continue;
      parts.push(`fig:${f.xMm.toFixed(2)},${f.yMm.toFixed(2)},${f.wMm.toFixed(2)},${f.hMm.toFixed(2)}`);
    }
    sigs.push(hash(parts.join('|')));
  }
  return sigs;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 受影响页（0 基）：签名变化或页数增减 */
export function affectedPages(prev: string[], next: string[]): number[] {
  const n = Math.max(prev.length, next.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (prev[i] !== next[i]) out.push(i);
  }
  return out;
}
