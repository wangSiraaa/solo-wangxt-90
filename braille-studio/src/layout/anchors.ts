/**
 * 锚点连线（图注连线）几何：按版面（每规格独立）计算，
 * 走线限制在无点区 —— 文本锚点走行间隙 + 页边距，图形锚点走图形行带，
 * 并由 validateLeaderLines 做"连线不压盲文"的几何断言。
 */
import type { Layout } from './engine';
import { layoutToDots } from './engine';
import { cellX, lineY } from '../braille/spec';
import type { StudioDocument } from '../model/document';
import { shapeBoundsOfShape } from '../model/document';
import type { Anchor, Resolution } from '../model/anchor';
import type { ProfileOverrides } from '../model/profile';

export interface LeaderSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LeaderLine {
  anchorId: string;
  page: number;
  /** 标注编号（A1、A2…） */
  label: string;
  /** 标注位置（页面坐标 mm，已含手工微调） */
  labelX: number;
  labelY: number;
  segments: LeaderSegment[];
}

/**
 * 计算当前规格下所有已解析锚点的连线。
 * 文本锚点：标注置于右侧页边距，连线走目标行下方的行间隙，再短竖线指向单元；
 * 图形锚点：标注置于图形行带内（行带无点阵），水平指向形状包围盒边缘。
 */
export function computeLeaderLines(
  layout: Layout,
  doc: StudioDocument,
  resolutions: Map<string, Resolution>,
  numbers: Map<string, string>,
  overrides: ProfileOverrides,
): LeaderLine[] {
  const { geometry: geo, spec } = layout;
  const out: LeaderLine[] = [];
  for (const anchor of doc.anchors ?? []) {
    const res = resolutions.get(anchor.id);
    if (!res || res.status !== 'resolved') continue;
    const label = numbers.get(anchor.id) ?? '?';
    const ov = overrides.anchors[anchor.id] ?? { dxMm: 0, dyMm: 0 };

    if (anchor.target.kind === 'text') {
      const [start, end] = [res.charStart ?? 0, res.charEnd ?? 0];
      // 找到片段对应的第一个已排单元
      let hit: { page: number; line: number; col: number } | null = null;
      outer: for (const ln of layout.lines) {
        if (ln.blockId !== res.blockId) continue;
        for (let i = 0; i < ln.cells.length; i++) {
          const src = ln.cells[i].src;
          if (src >= start && src < end) {
            hit = { page: ln.page, line: ln.line, col: ln.colStart + i };
            break outer;
          }
        }
      }
      if (!hit) continue;
      const tx = cellX(geo, hit.col, spec) + spec.dotPitch / 2; // 单元中点 x
      const lineTop = lineY(geo, hit.line, spec);
      const dotBottom = lineTop + 2 * spec.dotPitch;
      // 行间隙中线（下方）；页码保留行上方无间隙时改用上方间隙
      const gapBelow = hit.line < geo.contentLines - 1;
      const gy = gapBelow
        ? dotBottom + (spec.linePitch - 2 * spec.dotPitch) / 2
        : lineTop - (spec.linePitch - 2 * spec.dotPitch) / 2;
      const labelX = geo.preset.widthMm - geo.preset.marginMm.right / 2 + ov.dxMm;
      const labelY = gy + ov.dyMm;
      const tickEnd = gapBelow ? dotBottom + spec.dotDiameter / 2 + 0.5 : lineTop - spec.dotDiameter / 2 - 0.5;
      out.push({
        anchorId: anchor.id,
        page: hit.page,
        label,
        labelX,
        labelY,
        segments: [
          { x1: labelX, y1: gy, x2: tx, y2: gy }, // 行间隙水平段
          { x1: tx, y1: gy, x2: tx, y2: tickEnd }, // 指向单元的短竖线
        ],
      });
    } else {
      const fig = layout.figures.find((f) => f.blockId === res.blockId && f.page !== undefined);
      if (!fig) continue;
      const block = doc.blocks.find((b) => b.id === res.blockId);
      if (!block || block.kind !== 'figure') continue;
      const shape = block.figure.shapes[res.shapeIndex ?? -1];
      if (!shape) continue;
      const b = shapeBoundsOfShape(shape);
      // 形状包围盒中心（页面坐标）
      const cx = fig.originXMm + (b.minX + b.maxX) / 2;
      const cy = fig.originYMm + (b.minY + b.maxY) / 2;
      // 标注放在图形行带内、实际图形右侧（行带无点阵）
      const inkRight = fig.xMm + fig.wMm;
      const labelX = Math.min(inkRight + 6, geo.preset.widthMm - geo.preset.marginMm.right - 4) + ov.dxMm;
      const labelY = cy + ov.dyMm;
      const edgeX = fig.originXMm + b.maxX;
      out.push({
        anchorId: anchor.id,
        page: fig.page,
        label,
        labelX,
        labelY,
        segments: [{ x1: labelX - 2, y1: labelY, x2: edgeX, y2: cy }],
      });
    }
  }
  return out;
}

function pointToSegment(px: number, py: number, s: LeaderSegment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
  const cx = s.x1 + t * dx;
  const cy = s.y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * 连线不压盲文：所有线段与任一凸起点保持 ≥ 点半径 + 安全余量的距离；
 * 标注位置不得落在页面外。
 */
export function validateLeaderLines(layout: Layout, leaders: LeaderLine[], safetyMm = 0.2): string[] {
  const { spec, geometry: geo } = layout;
  const violations: string[] = [];
  const dots = layoutToDots(layout);
  const minDist = spec.dotDiameter / 2 + safetyMm;
  for (const ld of leaders) {
    for (const seg of ld.segments) {
      for (const d of dots) {
        if (d.page !== ld.page) continue;
        const dist = pointToSegment(d.xMm, d.yMm, seg);
        if (dist < minDist) {
          violations.push(
            `第 ${d.page + 1} 页：连线 ${ld.label} 距盲文点 ${dist.toFixed(2)}mm < ${minDist.toFixed(2)}mm`,
          );
        }
      }
    }
    const { widthMm, heightMm } = geo.preset;
    if (ld.labelX < 0 || ld.labelX > widthMm || ld.labelY < 0 || ld.labelY > heightMm) {
      violations.push(`连线 ${ld.label} 的标注超出页面`);
    }
  }
  return violations;
}
