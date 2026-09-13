/**
 * 盲文版面工艺参数（单位：mm）。
 *
 * 以下数值为**示例工艺参数**，取自常见盲文 embosser 的通行规格
 * （点径 ≈1.5mm、点距 2.5mm、单元距 6mm、行距 10mm），
 * 用于版面编排、预览与 PDF 的真实尺寸输出。
 * 最终触读质量取决于实际打样设备与纸张，需实物打样确认。
 */

export interface BrailleSpec {
  /** 点基准直径 mm */
  dotDiameter: number;
  /** 单元内相邻点中心距 mm（横向与纵向） */
  dotPitch: number;
  /** 相邻盲文单元中心距 mm（行宽按单元计） */
  cellPitch: number;
  /** 行距 mm（相邻行同一列点的中心距） */
  linePitch: number;
  /** 触觉图形与任意盲文点之间的最小间距 mm（示例工艺参数） */
  figureClearance: number;
  /** 页码行与正文最后一行之间的最小空行数 */
  pageNumberGapLines: number;
}

export const BRAILLE_SPEC: BrailleSpec = {
  dotDiameter: 1.5,
  dotPitch: 2.5,
  cellPitch: 6.0,
  linePitch: 10.0,
  figureClearance: 6.0,
  pageNumberGapLines: 1,
};

export interface PagePreset {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  marginMm: { top: number; right: number; bottom: number; left: number };
}

export const PAGE_PRESETS: PagePreset[] = [
  {
    id: 'braille-11x11.5',
    label: '盲文纸 279×292 mm（11×11.5 in）',
    widthMm: 279.4,
    heightMm: 292.1,
    marginMm: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  },
  {
    id: 'a4',
    label: 'A4 210×297 mm（校样打印）',
    widthMm: 210,
    heightMm: 297,
    marginMm: { top: 15, right: 15, bottom: 15, left: 15 },
  },
];

export interface PageGeometry {
  preset: PagePreset;
  /** 行宽（盲文单元数）—— 行宽一律按单元计 */
  cellsPerLine: number;
  /** 每页内容行数（不含页码保留行） */
  contentLines: number;
  /** 页码所在行索引（页面最后一行） */
  pageNumberLine: number;
  /** 单元 (0,0) 的 dot-1 中心坐标（mm，页面左上原点） */
  originX: number;
  originY: number;
}

export function computeGeometry(preset: PagePreset, spec: BrailleSpec = BRAILLE_SPEC): PageGeometry {
  const usableW = preset.widthMm - preset.marginMm.left - preset.marginMm.right;
  const usableH = preset.heightMm - preset.marginMm.top - preset.marginMm.bottom;
  const cellsPerLine = Math.max(1, Math.floor((usableW + spec.cellPitch - spec.dotPitch * 2) / spec.cellPitch));
  const totalLines = Math.max(2, Math.floor((usableH + spec.linePitch - spec.dotPitch * 2) / spec.linePitch));
  const pageNumberLine = totalLines - 1;
  const contentLines = pageNumberLine - spec.pageNumberGapLines;
  return {
    preset,
    cellsPerLine,
    contentLines,
    pageNumberLine,
    originX: preset.marginMm.left,
    originY: preset.marginMm.top,
  };
}

/** 单元 col 的 dot-1 中心 x 坐标 mm */
export function cellX(geo: PageGeometry, col: number, spec: BrailleSpec = BRAILLE_SPEC): number {
  return geo.originX + col * spec.cellPitch;
}

/** 行 line 的 dot-1/dot-2/dot-3 列中心 y 坐标 mm */
export function lineY(geo: PageGeometry, line: number, spec: BrailleSpec = BRAILLE_SPEC): number {
  return geo.originY + line * spec.linePitch;
}

export const MM_TO_PT = 72 / 25.4;
