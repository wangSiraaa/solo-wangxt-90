/**
 * PDF 导出（pdf-lib）：以真实尺寸输出盲文点阵与触觉图形。
 * 点坐标与 Canvas 预览共用 layoutToDots()，保证预览与 PDF 点位一致。
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { Layout } from '../layout/engine';
import { layoutToDots } from '../layout/engine';
import { MM_TO_PT } from '../braille/spec';
import type { FigureSpec } from '../model/document';

export interface PdfExportInfo {
  title: string;
  tableFile: string;
  liblouisVersion: string;
}

export async function exportPdf(layout: Layout, figures: Map<string, FigureSpec>, info: PdfExportInfo): Promise<Uint8Array> {
  const { geometry: geo, spec } = layout;
  const pdf = await PDFDocument.create();
  pdf.setTitle(info.title);
  pdf.setProducer(`braille-studio (liblouis ${info.liblouisVersion}, 表 ${info.tableFile})`);

  const pageW = geo.preset.widthMm * MM_TO_PT;
  const pageH = geo.preset.heightMm * MM_TO_PT;
  const dotR = (spec.dotDiameter / 2) * MM_TO_PT;
  const ink = rgb(0, 0, 0);

  const dots = layoutToDots(layout);
  const pages = Array.from({ length: layout.pageCount }, () => pdf.addPage([pageW, pageH]));

  // PDF 坐标原点在左下角，版面坐标原点在左上角
  const toPdfY = (yMm: number) => pageH - yMm * MM_TO_PT;

  for (const d of dots) {
    pages[d.page].drawCircle({
      x: d.xMm * MM_TO_PT,
      y: toPdfY(d.yMm),
      size: dotR,
      color: ink,
    });
  }

  // 触觉图形：凸线以矢量描边输出（线宽取示例工艺值 0.8mm）
  const strokeW = 0.8 * MM_TO_PT;
  for (const pf of layout.figures) {
    const fig = figures.get(pf.blockId);
    if (!fig) continue;
    const page = pages[pf.page];
    const fx = (x: number) => (pf.xMm + x) * MM_TO_PT;
    const fy = (y: number) => toPdfY(pf.yMm + y);
    for (const s of fig.shapes) {
      if (s.kind === 'line') {
        page.drawLine({ start: { x: fx(s.pts[0]), y: fy(s.pts[1]) }, end: { x: fx(s.pts[2]), y: fy(s.pts[3]) }, thickness: strokeW, color: ink });
      } else if (s.kind === 'rect') {
        page.drawRectangle({ x: fx(s.pts[0]), y: fy(s.pts[1] + s.pts[3]), width: s.pts[2] * MM_TO_PT, height: s.pts[3] * MM_TO_PT, borderColor: ink, borderWidth: strokeW });
      } else if (s.kind === 'circle') {
        page.drawCircle({ x: fx(s.pts[0]), y: fy(s.pts[1]), size: s.pts[2] * MM_TO_PT, borderColor: ink, borderWidth: strokeW });
      } else if (s.kind === 'polyline') {
        for (let i = 0; i + 3 < s.pts.length; i += 2) {
          page.drawLine({ start: { x: fx(s.pts[i]), y: fy(s.pts[i + 1]) }, end: { x: fx(s.pts[i + 2]), y: fy(s.pts[i + 3]) }, thickness: strokeW, color: ink });
        }
      }
    }
  }

  // 元数据注释页不放任何可见内容，保持触读页面纯净
  return pdf.save();
}
