import { useEffect, useMemo, useRef } from 'react';
import type { Layout } from '../layout/engine';
import { layoutToDots } from '../layout/engine';
import { cellX, lineY } from '../braille/spec';
import type { FigureSpec } from '../model/document';

export interface PreviewProps {
  layout: Layout;
  figures: Map<string, FigureSpec>;
  zoom: number;
  showEmptyDots: boolean;
  selectedBlockId: string | null;
  /** 点击某个盲文单元时回调（块 id 与行内单元索引） */
  onPickCell(blockId: string, lineIdx: number, cellIdx: number): void;
}

const BASE_PX_PER_MM = 2.2;

export function CanvasPreview(p: PreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { geometry: geo, spec } = p.layout;
  const dots = useMemo(() => layoutToDots(p.layout), [p.layout]);
  const scale = BASE_PX_PER_MM * p.zoom;
  const gapMm = 10;
  const pageW = geo.preset.widthMm;
  const pageH = geo.preset.heightMm;
  const widthPx = Math.ceil(pageW * scale) + 24;
  const heightPx = Math.ceil(p.layout.pageCount * (pageH + gapMm) * scale) + 24;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthPx * dpr;
    canvas.height = heightPx * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, widthPx, heightPx);

    const pageOrigin = (page: number) => ({ ox: 12, oy: 12 + page * (pageH + gapMm) * scale });
    const X = (page: number, mm: number) => pageOrigin(page).ox + mm * scale;
    const Y = (page: number, mm: number) => pageOrigin(page).oy + mm * scale;

    for (let pg = 0; pg < p.layout.pageCount; pg++) {
      // 纸张
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#999';
      ctx.fillRect(X(pg, 0), Y(pg, 0), pageW * scale, pageH * scale);
      ctx.strokeRect(X(pg, 0), Y(pg, 0), pageW * scale, pageH * scale);
      // 页边距参考线
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#ddd';
      ctx.strokeRect(
        X(pg, geo.preset.marginMm.left),
        Y(pg, geo.preset.marginMm.top),
        (pageW - geo.preset.marginMm.left - geo.preset.marginMm.right) * scale,
        (pageH - geo.preset.marginMm.top - geo.preset.marginMm.bottom) * scale,
      );
      ctx.restore();

      // 空点参考（屏幕标注，不输出到 PDF）
      if (p.showEmptyDots) {
        ctx.fillStyle = '#e8e8e8';
        for (let ln = 0; ln <= geo.pageNumberLine; ln++) {
          for (let c = 0; c < geo.cellsPerLine; c++) {
            for (let d = 1; d <= 6; d++) {
              const dx = cellX(geo, c, spec) + (d <= 3 ? 0 : spec.dotPitch);
              const dy = lineY(geo, ln, spec) + ((d - 1) % 3) * spec.dotPitch;
              ctx.beginPath();
              ctx.arc(X(pg, dx), Y(pg, dy), (spec.dotDiameter / 2) * scale * 0.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    }

    // 凸起点（与 PDF 同一数据源 layoutToDots）
    ctx.fillStyle = '#111';
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(X(d.page, d.xMm), Y(d.page, d.yMm), (spec.dotDiameter / 2) * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // 选中块高亮
    if (p.selectedBlockId) {
      ctx.save();
      ctx.strokeStyle = '#2b6cb0';
      ctx.setLineDash([3, 3]);
      for (const ln of p.layout.lines) {
        if (ln.blockId !== p.selectedBlockId) continue;
        const x0 = cellX(geo, ln.colStart, spec) - 1.5;
        const y0 = lineY(geo, ln.line, spec) - 2.5;
        ctx.strokeRect(X(ln.page, x0), Y(ln.page, y0), (ln.cells.length * spec.cellPitch + 1) * scale, 8 * scale);
      }
      ctx.restore();
    }

    // 触觉图形与最小间距参考框
    for (const pf of p.layout.figures) {
      const fig = p.figures.get(pf.blockId);
      ctx.save();
      ctx.strokeStyle = '#b7791f';
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(
        X(pf.page, pf.xMm - pf.clearanceMm),
        Y(pf.page, pf.yMm - pf.clearanceMm),
        (pf.wMm + 2 * pf.clearanceMm) * scale,
        (pf.hMm + 2 * pf.clearanceMm) * scale,
      );
      ctx.restore();
      if (!fig) continue;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 0.8 * scale;
      const fx = (x: number) => X(pf.page, pf.originXMm + x);
      const fy = (y: number) => Y(pf.page, pf.originYMm + y);
      for (const s of fig.shapes) {
        ctx.beginPath();
        if (s.kind === 'line') {
          ctx.moveTo(fx(s.pts[0]), fy(s.pts[1]));
          ctx.lineTo(fx(s.pts[2]), fy(s.pts[3]));
        } else if (s.kind === 'rect') {
          ctx.rect(fx(s.pts[0]), fy(s.pts[1]), s.pts[2] * scale, s.pts[3] * scale);
        } else if (s.kind === 'circle') {
          ctx.arc(fx(s.pts[0]), fy(s.pts[1]), s.pts[2] * scale, 0, Math.PI * 2);
        } else {
          ctx.moveTo(fx(s.pts[0]), fy(s.pts[1]));
          for (let i = 2; i + 1 < s.pts.length; i += 2) ctx.lineTo(fx(s.pts[i]), fy(s.pts[i + 1]));
        }
        ctx.stroke();
      }
    }

    // 屏幕标注：图注跨页续行提示（不输出到 PDF）
    ctx.fillStyle = '#2b6cb0';
    ctx.font = '11px sans-serif';
    for (const ln of p.layout.lines) {
      if (ln.captionContinued) {
        ctx.fillText('（图注跨页续排）', X(ln.page, 4), Y(ln.page, lineY(geo, ln.line, spec)) - 2);
      }
    }
  }, [p.layout, dots, p.zoom, p.showEmptyDots, p.selectedBlockId, p.figures, scale, widthPx, heightPx, geo, spec, pageW, pageH]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = e.clientX - rect.left - 12;
    const py = e.clientY - rect.top - 12;
    const page = Math.floor(py / ((pageH + gapMm) * scale));
    const xMm = px / scale;
    const yMm = (py - page * (pageH + gapMm) * scale) / scale;
    const candidates: { lineIdx: number; cellIdx: number; dist: number }[] = [];
    p.layout.lines.forEach((ln, lineIdx) => {
      if (ln.page !== page || !ln.blockId) return;
      const dy = Math.abs(yMm - (lineY(geo, ln.line, spec) + spec.dotPitch));
      if (dy > spec.linePitch / 2) return;
      for (let i = 0; i < ln.cells.length; i++) {
        const dx = Math.abs(xMm - (cellX(geo, ln.colStart + i, spec) + spec.dotPitch / 2));
        if (dx < spec.cellPitch / 2) candidates.push({ lineIdx, cellIdx: i, dist: dx + dy });
      }
    });
    const best = candidates.sort((a, b) => a.dist - b.dist)[0];
    if (best) {
      const ln = p.layout.lines[best.lineIdx];
      p.onPickCell(ln.blockId!, best.lineIdx, best.cellIdx);
    }
  };

  return (
    <div className="preview-scroll">
      <canvas ref={ref} style={{ width: widthPx, height: heightPx }} onClick={onClick} />
      <div className="legend">
        黑点=凸起点阵（与 PDF 同源）· 灰点=空点参考 · 橙虚线=图形最小间距 {p.layout.spec.figureClearance}mm · 蓝字=屏幕标注（不输出）
      </div>
    </div>
  );
}
