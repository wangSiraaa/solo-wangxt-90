/**
 * FigureEditor 的输入门控（纯函数，便于测试）：
 * 任何会产生非法图形（含坐标越界）的编辑都被拒绝，不进入文档。
 */
import type { FigureSpec, Shape } from '../model/document';
import { validateFigure, newId } from '../model/document';

export type ApplyResult = { figure: FigureSpec; error: null } | { figure: null; error: string };

const SHAPE_KINDS = ['line', 'rect', 'circle', 'polyline'];

/** 应用形状 JSON；非法（含越界）时拒绝并返回错误。合法形状的缺失 ID 会被补齐（锚点绑定用） */
export function applyShapesJson(fig: FigureSpec, json: string): ApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { figure: null, error: 'JSON 解析失败' };
  }
  if (!Array.isArray(parsed)) return { figure: null, error: '形状必须是数组' };
  for (const [i, s] of parsed.entries()) {
    if (!s || typeof s !== 'object') return { figure: null, error: `形状 ${i + 1} 不是对象` };
    const { kind, pts } = s as Partial<Shape>;
    if (!kind || !SHAPE_KINDS.includes(kind)) return { figure: null, error: `形状 ${i + 1} 类型非法（须为 ${SHAPE_KINDS.join('/')}）` };
    if (!Array.isArray(pts) || pts.some((v) => typeof v !== 'number')) {
      return { figure: null, error: `形状 ${i + 1} 坐标必须是数字数组` };
    }
  }
  const shapes = (parsed as Shape[]).map((s) => (s.id ? s : { ...s, id: `shape-${newId()}` }));
  const candidate: FigureSpec = { ...fig, shapes };
  const err = validateFigure(candidate);
  return err ? { figure: null, error: err } : { figure: candidate, error: null };
}

/** 应用图形声明尺寸；若现有形状因此越界则拒绝 */
export function applyFigureSize(fig: FigureSpec, widthMm: number, heightMm: number): ApplyResult {
  const candidate: FigureSpec = { ...fig, widthMm, heightMm };
  const err = validateFigure(candidate);
  return err ? { figure: null, error: err } : { figure: candidate, error: null };
}
