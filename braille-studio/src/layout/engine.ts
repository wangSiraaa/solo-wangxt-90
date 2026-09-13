/**
 * 版面引擎：把文档块排版为分页的盲文行与触觉图形占位。
 *
 * 设计约束（与需求对应）：
 * - 行宽一律按盲文单元计（cellsPerLine 由页面几何推出）；
 * - 标题、正文、图注、页码各自占据独立的行槽，图形占据整行带，
 *   结构上不可能重叠；validateLayout 再做一次包围盒断言；
 * - 图形与点阵的最小间距 = spec.figureClearance（示例工艺参数 6mm），
 *   通过"图形行带高度 ≥ 图形高 + 2×间距"保证；
 * - 图注可跨页续排（captionContinued 标记）；
 * - 页码固定在每页最后一行、右对齐，与正文之间保留空行。
 */
import type { BrailleSpec, PageGeometry } from '../braille/spec';
import { BRAILLE_SPEC, cellX, computeGeometry, lineY, PAGE_PRESETS } from '../braille/spec';
import { charToDots } from '../braille/dots';
import type { Block, StudioDocument } from '../model/document';
import type { Translation } from '../braille/translator';

export type TranslateFn = (text: string, tableFile: string) => Translation;

export interface CellRef {
  /** Unicode 盲文字符（或空格） */
  ch: string;
  /** 原文字符索引（页码等无原文时为 -1） */
  src: number;
}

export type LineRole = 'heading' | 'body' | 'caption' | 'pagenumber';

export interface PlacedLine {
  page: number;
  /** 页内行索引（0..pageNumberLine） */
  line: number;
  colStart: number;
  cells: CellRef[];
  blockId: string | null;
  role: LineRole;
  /** 图注跨页续行 */
  captionContinued: boolean;
}

export interface PlacedFigure {
  page: number;
  blockId: string;
  /** 图形包围盒 mm（页面坐标） */
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  /** 与点阵的最小间距 mm（示例工艺参数） */
  clearanceMm: number;
}

export interface Layout {
  geometry: PageGeometry;
  spec: BrailleSpec;
  pageCount: number;
  lines: PlacedLine[];
  figures: PlacedFigure[];
}

export function lineText(line: PlacedLine): string {
  return line.cells.map((c) => c.ch).join('');
}

interface Cursor {
  page: number;
  line: number;
}

export function layoutDocument(
  doc: StudioDocument,
  translate: TranslateFn,
  spec: BrailleSpec = BRAILLE_SPEC,
): Layout {
  const preset = PAGE_PRESETS.find((p) => p.id === doc.pagePresetId) ?? PAGE_PRESETS[0];
  const geo = computeGeometry(preset, spec);
  const lines: PlacedLine[] = [];
  const figures: PlacedFigure[] = [];
  const cur: Cursor = { page: 0, line: 0 };

  const newPage = () => {
    cur.page += 1;
    cur.line = 0;
  };
  /** 推进一行；越过内容区则换页 */
  const advance = () => {
    cur.line += 1;
    if (cur.line >= geo.contentLines) newPage();
  };
  const emit = (cells: CellRef[], colStart: number, blockId: string | null, role: LineRole, captionContinued = false) => {
    lines.push({ page: cur.page, line: cur.line, colStart, cells, blockId, role, captionContinued });
    advance();
  };
  const blank = () => advance();

  /** 把一段转译结果按行宽折行并输出；长单词硬断行（不加连字符，见 README） */
  const emitWrapped = (t: Translation, blockId: string, role: LineRole, indentFirst: number) => {
    const width = geo.cellsPerLine;
    const indent = Math.min(indentFirst, Math.max(0, width - 1));
    const words: CellRef[][] = [];
    let word: CellRef[] = [];
    const pushWord = () => {
      if (word.length) words.push(word);
      word = [];
    };
    for (let i = 0; i < t.braille.length; i++) {
      const ch = t.braille[i];
      if (ch === ' ') pushWord();
      else word.push({ ch, src: t.srcMap[i] });
    }
    pushWord();

    let col = role === 'body' ? indent : 0;
    let row: CellRef[] = [];
    const flush = () => {
      if (!row.length) return;
      const colStart = role === 'heading' ? Math.max(0, Math.floor((width - row.length) / 2)) : col;
      emit(row, colStart, blockId, role);
      row = [];
      col = 0;
    };
    for (const w of words) {
      let remaining = w;
      while (remaining.length) {
        const needSpace = row.length > 0 ? 1 : 0;
        const avail = width - col - row.length - needSpace;
        if (remaining.length <= avail) {
          if (needSpace) row.push({ ch: ' ', src: -1 });
          row.push(...remaining);
          remaining = [];
        } else if (row.length > 0) {
          flush(); // 当前行放不下整个词：整词移到下一行
        } else {
          // 空行也放不下（长单词超出行宽）：硬断行，不加连字符
          const take = Math.max(1, avail);
          row.push(...remaining.slice(0, take));
          remaining = remaining.slice(take);
          flush();
        }
      }
    }
    flush();
  };

  for (const block of doc.blocks) {
    if (block.kind === 'heading') {
      if (cur.line > 0) blank();
      if (cur.line >= geo.contentLines - 2) newPage(); // 标题后不致孤立
      emitWrapped(translate(block.text, doc.tableFile), block.id, 'heading', 0);
      blank();
    } else if (block.kind === 'paragraph') {
      emitWrapped(translate(block.text, doc.tableFile), block.id, 'body', 2);
    } else {
      // 触觉图形：整行带占位，带高 ≥ 图形高 + 2×最小间距
      const clearance = spec.figureClearance;
      const rows = Math.max(1, Math.ceil((block.figure.heightMm + 2 * clearance) / spec.linePitch));
      const caption = translate(block.caption, doc.tableFile);
      if (cur.line + rows > geo.contentLines) newPage(); // 图形整体移至下页
      const bandTopY = lineY(geo, cur.line, spec) - spec.dotPitch;
      const bandH = rows * spec.linePitch;
      const contentW = geo.cellsPerLine * spec.cellPitch;
      const xMm = geo.originX + Math.max(0, (contentW - block.figure.widthMm) / 2);
      const yMm = bandTopY + (bandH - block.figure.heightMm) / 2;
      figures.push({
        page: cur.page,
        blockId: block.id,
        xMm,
        yMm,
        wMm: block.figure.widthMm,
        hMm: block.figure.heightMm,
        clearanceMm: clearance,
      });
      for (let r = 0; r < rows; r++) advance();
      // 图注：可跨页续排
      const capLinesBefore = lines.length;
      emitWrapped(caption, block.id, 'caption', 0);
      for (let i = capLinesBefore; i < lines.length; i++) {
        if (lines[i].role === 'caption' && lines[i].line === 0 && lines[i].page > 0) {
          // 跨页的第一行图注标记为续行
          const prev = lines[i - 1];
          if (prev && prev.role === 'caption' && prev.page === lines[i].page - 1) lines[i].captionContinued = true;
        }
      }
      blank();
    }
  }

  // 页码：每页最后一行右对齐（同样经 liblouis 转译，数字号等规则一致）
  if (doc.showPageNumbers) {
    for (let p = 0; p <= cur.page; p++) {
      const t = translate(String(p + 1), doc.tableFile);
      const cells: CellRef[] = [...t.braille].map((ch, i) => ({ ch, src: t.srcMap[i] }));
      lines.push({
        page: p,
        line: geo.pageNumberLine,
        colStart: Math.max(0, geo.cellsPerLine - cells.length),
        cells,
        blockId: null,
        role: 'pagenumber',
        captionContinued: false,
      });
    }
  }

  return { geometry: geo, spec, pageCount: cur.page + 1, lines, figures };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tag: string;
}

const intersects = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * 版面校验：标题/正文/图注/页码/图形两两不重叠，且均在页面范围内。
 * 返回违规描述列表（空数组 = 通过）。
 */
export function validateLayout(layout: Layout): string[] {
  const { geometry: geo, spec } = layout;
  const violations: string[] = [];
  const byPage = new Map<number, Rect[]>();
  const addRect = (page: number, r: Rect) => {
    const arr = byPage.get(page) ?? [];
    for (const other of arr) {
      if (intersects(r, other)) violations.push(`第 ${page + 1} 页：${r.tag} 与 ${other.tag} 重叠`);
    }
    arr.push(r);
    byPage.set(page, arr);
  };

  for (const ln of layout.lines) {
    if (ln.cells.length === 0) continue;
    if (ln.colStart + ln.cells.length > geo.cellsPerLine) {
      violations.push(`第 ${ln.page + 1} 页第 ${ln.line + 1} 行：超出行宽 ${geo.cellsPerLine} 单元`);
    }
    if (ln.role !== 'pagenumber' && ln.line >= geo.contentLines) {
      violations.push(`第 ${ln.page + 1} 页：内容行侵入页码保留区`);
    }
    const x0 = cellX(geo, ln.colStart, spec);
    const x1 = cellX(geo, ln.colStart + ln.cells.length - 1, spec) + spec.dotPitch;
    const y0 = lineY(geo, ln.line, spec);
    addRect(ln.page, {
      x0, y0,
      x1,
      y1: y0 + spec.dotPitch * 2,
      tag: `${ln.role} 行(行${ln.line + 1})`,
    });
  }

  for (const fig of layout.figures) {
    const { preset } = geo;
    if (fig.xMm < 0 || fig.yMm < 0 || fig.xMm + fig.wMm > preset.widthMm || fig.yMm + fig.hMm > preset.heightMm) {
      violations.push(`第 ${fig.page + 1} 页：图形超出页面`);
    }
    // 图形包围盒外扩最小间距后与任何点阵行不得相交
    addRect(fig.page, {
      x0: fig.xMm - fig.clearanceMm,
      y0: fig.yMm - fig.clearanceMm,
      x1: fig.xMm + fig.wMm + fig.clearanceMm,
      y1: fig.yMm + fig.hMm + fig.clearanceMm,
      tag: `图形+${fig.clearanceMm}mm间距(块 ${fig.blockId})`,
    });
  }
  return violations;
}

export interface Dot {
  page: number;
  xMm: number;
  yMm: number;
  /** 点号 1–6 */
  dot: number;
}

/**
 * 版面 → 全部凸起点的页面坐标（mm）。
 * Canvas 预览与 PDF 导出共用此函数，保证两者点位一致。
 */
export function layoutToDots(layout: Layout): Dot[] {
  const { geometry: geo, spec } = layout;
  const dots: Dot[] = [];
  for (const ln of layout.lines) {
    const y0 = lineY(geo, ln.line, spec);
    for (let i = 0; i < ln.cells.length; i++) {
      const bits = charToDots(ln.cells[i].ch);
      if (!bits) continue;
      const x0 = cellX(geo, ln.colStart + i, spec);
      for (let d = 1; d <= 6; d++) {
        if (bits & (1 << (d - 1))) {
          dots.push({
            page: ln.page,
            xMm: x0 + (d <= 3 ? 0 : spec.dotPitch),
            yMm: y0 + ((d - 1) % 3) * spec.dotPitch,
            dot: d,
          });
        }
      }
    }
  }
  return dots;
}
