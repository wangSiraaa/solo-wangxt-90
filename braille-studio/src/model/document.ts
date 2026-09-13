/**
 * 工程文档模型：盲文段落 + 简单触觉示意图。
 * 所有坐标均为 mm（图形内部坐标以图形左上角为原点）。
 */

export type ShapeKind = 'line' | 'rect' | 'circle' | 'polyline';

export interface Shape {
  kind: ShapeKind;
  /** line/polyline: 折点 [x1,y1,x2,y2,...]；rect: [x,y,w,h]；circle: [cx,cy,r] */
  pts: number[];
}

export interface FigureSpec {
  widthMm: number;
  heightMm: number;
  shapes: Shape[];
}

export type Block =
  | { id: string; kind: 'heading'; level: 1 | 2; text: string }
  | { id: string; kind: 'paragraph'; text: string }
  | { id: string; kind: 'figure'; figure: FigureSpec; caption: string };

export interface StudioDocument {
  id: string;
  name: string;
  /** 语言表文件名（随项目固定的表，见 manifest） */
  tableFile: string;
  pagePresetId: string;
  showPageNumbers: boolean;
  blocks: Block[];
  updatedAt: number;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function emptyDocument(tableFile: string, pagePresetId: string): StudioDocument {
  return {
    id: newId(),
    name: '未命名工程',
    tableFile,
    pagePresetId,
    showPageNumbers: true,
    blocks: [],
    updatedAt: Date.now(),
  };
}

/** 校验并规范化图形参数；返回错误信息（null 表示合法） */
export function validateFigure(fig: FigureSpec): string | null {
  if (!(fig.widthMm > 0) || !(fig.heightMm > 0)) return '图形宽高必须为正数';
  if (fig.widthMm > 250 || fig.heightMm > 250) return '图形尺寸超出页面可用范围';
  for (const [i, s] of fig.shapes.entries()) {
    const n = s.pts.length;
    if (s.kind === 'line' && n !== 4) return `形状 ${i + 1}（line）需要 4 个坐标`;
    if (s.kind === 'rect' && n !== 4) return `形状 ${i + 1}（rect）需要 4 个坐标`;
    if (s.kind === 'circle' && n !== 3) return `形状 ${i + 1}（circle）需要 3 个坐标`;
    if (s.kind === 'polyline' && (n < 4 || n % 2 !== 0)) return `形状 ${i + 1}（polyline）需要偶数个坐标且至少 2 点`;
    if (s.pts.some((v) => !Number.isFinite(v))) return `形状 ${i + 1} 含非法坐标`;
    if (s.kind === 'rect' && (s.pts[2] <= 0 || s.pts[3] <= 0)) return `形状 ${i + 1}（rect）宽高必须为正数`;
    if (s.kind === 'circle' && s.pts[2] <= 0) return `形状 ${i + 1}（circle）半径必须为正数`;
    // 越界拒绝：所有形状的坐标（含圆半径、矩形宽高）必须落在声明的图形范围内
    const b = shapeBoundsOfShape(s);
    if (b.minX < 0 || b.minY < 0 || b.maxX > fig.widthMm || b.maxY > fig.heightMm) {
      return (
        `形状 ${i + 1}（${s.kind}）越界：占用 [${b.minX},${b.minY}]–[${b.maxX},${b.maxY}]mm，` +
        `超出图形声明范围 [0,0]–[${fig.widthMm},${fig.heightMm}]mm`
      );
    }
  }
  return null;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 单个形状的包围盒（图形局部坐标，含圆半径 / 矩形宽高） */
export function shapeBoundsOfShape(s: Shape): Bounds {
  switch (s.kind) {
    case 'line':
      return {
        minX: Math.min(s.pts[0], s.pts[2]),
        minY: Math.min(s.pts[1], s.pts[3]),
        maxX: Math.max(s.pts[0], s.pts[2]),
        maxY: Math.max(s.pts[1], s.pts[3]),
      };
    case 'rect':
      return { minX: s.pts[0], minY: s.pts[1], maxX: s.pts[0] + s.pts[2], maxY: s.pts[1] + s.pts[3] };
    case 'circle':
      return {
        minX: s.pts[0] - s.pts[2],
        minY: s.pts[1] - s.pts[2],
        maxX: s.pts[0] + s.pts[2],
        maxY: s.pts[1] + s.pts[2],
      };
    case 'polyline': {
      const xs = s.pts.filter((_, i) => i % 2 === 0);
      const ys = s.pts.filter((_, i) => i % 2 === 1);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
  }
}

/**
 * 图形全部形状的联合包围盒（图形局部坐标）。
 * 布局与自检的间距按此实际占用计算；无形状时返回 null（回退为声明框）。
 */
export function shapeBounds(fig: FigureSpec): Bounds | null {
  if (fig.shapes.length === 0) return null;
  let out: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of fig.shapes) {
    const b = shapeBoundsOfShape(s);
    out = {
      minX: Math.min(out.minX, b.minX),
      minY: Math.min(out.minY, b.minY),
      maxX: Math.max(out.maxX, b.maxX),
      maxY: Math.max(out.maxY, b.maxY),
    };
  }
  return out;
}
