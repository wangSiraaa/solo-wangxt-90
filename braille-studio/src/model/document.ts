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
  }
  return null;
}
