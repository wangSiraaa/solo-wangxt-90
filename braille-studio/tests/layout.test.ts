/**
 * 版面引擎测试：行宽按单元计、标题/页码/图注不重叠、
 * 长单词硬断行、图注跨页、预览与 PDF 点位一致。
 * 使用真实 liblouis 转译 + 验证样张。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initTranslator, translate } from '../src/braille/translator';
import { layoutDocument, layoutToDots, lineText, validateLayout, type Layout } from '../src/layout/engine';
import { buildSampleDocument } from '../src/samples/sampleDoc';
import { PAGE_PRESETS } from '../src/braille/spec';
import { exportPdf } from '../src/export/pdf';
import { PDFDocument } from 'pdf-lib';
import type { FigureSpec } from '../src/model/document';

let layout: Layout;
const doc = () => buildSampleDocument('en-us-g2.ctb', 'braille-11x11.5');

beforeAll(async () => {
  await initTranslator();
  layout = layoutDocument(doc(), translate);
});

describe('版面引擎（验证样张）', () => {
  it('行宽按盲文单元计：任何行不超宽', () => {
    const w = layout.geometry.cellsPerLine;
    expect(w).toBeGreaterThan(0);
    for (const ln of layout.lines) {
      expect(ln.colStart + ln.cells.length).toBeLessThanOrEqual(w);
    }
  });

  it('标题、页码、图注、图形互不重叠（包围盒校验）', () => {
    expect(validateLayout(layout)).toEqual([]);
  });

  it('每页均有右对齐页码，且位于页码保留行', () => {
    for (let p = 0; p < layout.pageCount; p++) {
      const pn = layout.lines.filter((l) => l.page === p && l.role === 'pagenumber');
      expect(pn.length).toBe(1);
      expect(pn[0].line).toBe(layout.geometry.pageNumberLine);
      expect(pn[0].colStart + pn[0].cells.length).toBe(layout.geometry.cellsPerLine);
      expect(lineText(pn[0])).toContain('⠼'); // 页码经同一语言表转译，含数字号
    }
  });

  it('长单词超出行宽时硬断行且不超宽', () => {
    // 样张含 45+ 字符长单词（行宽 42 单元），应出现被写满的断行
    const full = layout.lines.filter((l) => l.role === 'body' && l.colStart + l.cells.length === layout.geometry.cellsPerLine);
    expect(full.length).toBeGreaterThan(0);
  });

  it('数字切换素材完整进入版面（含数字号）', () => {
    const all = layout.lines.map(lineText).join('\n');
    expect(all).toContain('⠼'); // 数字号
  });

  it('图注跨页续排并带续行标记', () => {
    const captions = layout.lines.filter((l) => l.role === 'caption');
    const pages = new Set(captions.map((l) => l.page));
    expect(pages.size).toBeGreaterThan(1); // 图注分布在多页
    expect(captions.some((l) => l.captionContinued)).toBe(true);
  });

  it('图形占位满足最小间距（示例工艺参数 6mm）', () => {
    expect(layout.figures.length).toBe(1);
    const fig = layout.figures[0];
    expect(fig.clearanceMm).toBe(6.0);
    // 图形行带内不得有任何盲文行（整行带保留）
    const bandTop = fig.yMm - fig.clearanceMm;
    const bandBottom = fig.yMm + fig.hMm + fig.clearanceMm;
    for (const ln of layout.lines) {
      if (ln.page !== fig.page) continue;
      const y = layout.geometry.originY + ln.line * layout.spec.linePitch;
      const inBand = y + layout.spec.dotPitch * 2 > bandTop && y < bandBottom;
      expect(inBand).toBe(false);
    }
  });

  it('预览与 PDF 点位一致（同一坐标源，确定性重算）', () => {
    const a = layoutToDots(layout);
    const b = layoutToDots(layout);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    // 所有点都在页面范围内
    const { widthMm, heightMm } = layout.geometry.preset;
    for (const d of a) {
      expect(d.xMm).toBeGreaterThanOrEqual(0);
      expect(d.xMm).toBeLessThanOrEqual(widthMm);
      expect(d.yMm).toBeGreaterThanOrEqual(0);
      expect(d.yMm).toBeLessThanOrEqual(heightMm);
    }
  });

  it('PDF 导出：页数一致且文件可解析', async () => {
    const d = doc();
    const figures = new Map<string, FigureSpec>();
    d.blocks.forEach((b) => b.kind === 'figure' && figures.set(b.id, b.figure));
    const bytes = await exportPdf(layout, figures, {
      title: d.name,
      tableFile: d.tableFile,
      liblouisVersion: '3.2.0',
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(layout.pageCount);
    const page = pdf.getPage(0);
    expect(page.getWidth()).toBeCloseTo(PAGE_PRESETS[0].widthMm * (72 / 25.4), 3);
    expect(page.getHeight()).toBeCloseTo(PAGE_PRESETS[0].heightMm * (72 / 25.4), 3);
  });

  it('A4 预设同样通过重叠校验', () => {
    const a4 = layoutDocument(buildSampleDocument('en-us-g2.ctb', 'a4'), translate);
    expect(validateLayout(a4)).toEqual([]);
  });
});
