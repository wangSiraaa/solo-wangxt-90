/**
 * 图形坐标越界的处理：
 *  - validateFigure / FigureEditor 门控（applyShapesJson、applyFigureSize）拒绝越界输入；
 *  - 引擎按实际形状包围盒计算占位与间距（越界数据也能正确重排）；
 *  - 超宽到超出页面时，自检（validateLayout）必须失败；
 *  - 正常验证样张不受影响。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { validateFigure, shapeBounds, type FigureSpec } from '../src/model/document';
import { applyFigureSize, applyShapesJson } from '../src/ui/figureEdit';
import { initTranslator, translate } from '../src/braille/translator';
import { layoutDocument, validateLayout } from '../src/layout/engine';
import { buildSampleDocument } from '../src/samples/sampleDoc';
import { newId, type StudioDocument } from '../src/model/document';

const base: FigureSpec = {
  widthMm: 90,
  heightMm: 55,
  shapes: [{ kind: 'rect', pts: [0, 0, 90, 55] }],
};

function docWithFigure(figure: FigureSpec): StudioDocument {
  return {
    id: newId(),
    name: 'figure-test',
    tableFile: 'en-us-g2.ctb',
    pagePresetId: 'braille-11x11.5',
    showPageNumbers: true,
    updatedAt: 0,
    blocks: [{ id: newId(), kind: 'figure', figure, caption: 'Caption.' }],
  };
}

beforeAll(async () => {
  await initTranslator();
});

describe('validateFigure：逐形状越界拒绝', () => {
  it('拒绝负坐标（line）', () => {
    const err = validateFigure({ ...base, shapes: [{ kind: 'line', pts: [-120, -30, 180, -30] }] });
    expect(err).toMatch(/越界/);
  });
  it('拒绝超宽坐标（line）', () => {
    expect(validateFigure({ ...base, shapes: [{ kind: 'line', pts: [0, 0, 200, 0] }] })).toMatch(/越界/);
    expect(validateFigure({ ...base, shapes: [{ kind: 'line', pts: [0, 0, 0, 56] }] })).toMatch(/越界/);
  });
  it('拒绝越界矩形（含 x+w、y+h 溢出与负起点）', () => {
    expect(validateFigure({ ...base, shapes: [{ kind: 'rect', pts: [80, 50, 20, 10] }] })).toMatch(/越界/);
    expect(validateFigure({ ...base, shapes: [{ kind: 'rect', pts: [-5, 0, 10, 10] }] })).toMatch(/越界/);
  });
  it('拒绝越界圆（半径伸出边界）', () => {
    expect(validateFigure({ ...base, shapes: [{ kind: 'circle', pts: [5, 5, 10] }] })).toMatch(/越界/);
    expect(validateFigure({ ...base, shapes: [{ kind: 'circle', pts: [45, 27, 50] }] })).toMatch(/越界/);
  });
  it('拒绝越界折线', () => {
    expect(validateFigure({ ...base, shapes: [{ kind: 'polyline', pts: [-1, 0, 10, 10] }] })).toMatch(/越界/);
    expect(validateFigure({ ...base, shapes: [{ kind: 'polyline', pts: [0, 0, 10, 10, 20, 99] }] })).toMatch(/越界/);
  });
  it('边界上的形状合法；非法尺寸（非正宽高/半径）拒绝', () => {
    expect(validateFigure(base)).toBeNull();
    expect(validateFigure({ ...base, shapes: [{ kind: 'circle', pts: [12, 12, 12] }] })).toBeNull();
    expect(validateFigure({ ...base, shapes: [{ kind: 'rect', pts: [0, 0, -3, 10] }] })).toMatch(/正数/);
    expect(validateFigure({ ...base, shapes: [{ kind: 'circle', pts: [10, 10, 0] }] })).toMatch(/正数/);
  });
});

describe('FigureEditor 门控（UI 拒绝）', () => {
  it('拒绝负坐标与超宽坐标的形状 JSON，不落文档', () => {
    const neg = applyShapesJson(base, JSON.stringify([{ kind: 'line', pts: [-120, -30, 180, -30] }]));
    expect(neg.figure).toBeNull();
    expect(neg.error).toMatch(/越界/);
    const wide = applyShapesJson(base, JSON.stringify([{ kind: 'line', pts: [0, 0, 500, 0] }]));
    expect(wide.figure).toBeNull();
    expect(wide.error).toMatch(/越界/);
  });
  it('拒绝非法 JSON / 非数组 / 非法形状类型', () => {
    expect(applyShapesJson(base, '{oops').error).toMatch(/JSON/);
    expect(applyShapesJson(base, '{"kind":"line"}').error).toMatch(/数组/);
    expect(applyShapesJson(base, JSON.stringify([{ kind: 'arc', pts: [0, 0, 1, 1] }])).error).toMatch(/类型/);
  });
  it('接受合法形状 JSON', () => {
    const r = applyShapesJson(base, JSON.stringify([{ kind: 'line', pts: [0, 0, 90, 55] }]));
    expect(r.error).toBeNull();
    expect(r.figure?.shapes.length).toBe(1);
  });
  it('缩小声明尺寸导致现有形状越界时拒绝', () => {
    const r = applyFigureSize(base, 30, 55); // rect [0,0,90,55] 将超出 30 宽
    expect(r.figure).toBeNull();
    expect(r.error).toMatch(/越界/);
    expect(applyFigureSize(base, 90, 55).error).toBeNull();
  });
});

describe('布局按实际形状包围盒计算', () => {
  it('形状小于声明框：占位与间距按实际包围盒', () => {
    // 声明 90×55，实际仅 rect [10,10,20,10] → 实际占用 20×10
    const small = docWithFigure({ widthMm: 90, heightMm: 55, shapes: [{ kind: 'rect', pts: [10, 10, 20, 10] }] });
    const laySmall = layoutDocument(small, translate);
    expect(laySmall.figures[0].wMm).toBeCloseTo(20);
    expect(laySmall.figures[0].hMm).toBeCloseTo(10);
    expect(validateLayout(laySmall)).toEqual([]);
    // 行带行数 = ceil((10+2*6)/10) = 3；图注紧随其后的行号应等于 3
    const capSmall = laySmall.lines.find((l) => l.role === 'caption')!;
    expect(capSmall.line).toBe(3);
    // 占满声明框的图形：行带行数 = ceil((55+12)/10) = 7
    const layFull = layoutDocument(docWithFigure(base), translate);
    const capFull = layFull.lines.find((l) => l.role === 'caption')!;
    expect(capFull.line).toBe(7);
    expect(validateLayout(layFull)).toEqual([]);
  });

  it('负坐标（外部数据绕过 UI）：按真实占用正确重排，间距仍满足', () => {
    // line [-20,10 → 50,10]：实际包围盒 minX=-20，引擎按 70mm 实际宽度居中
    const fig: FigureSpec = { widthMm: 90, heightMm: 55, shapes: [{ kind: 'line', pts: [-20, 10, 50, 10] }] };
    expect(validateFigure(fig)).toMatch(/越界/); // 自检的图形项会判失败
    const lay = layoutDocument(docWithFigure(fig), translate);
    const pf = lay.figures[0];
    expect(pf.wMm).toBeCloseTo(70);
    expect(pf.originXMm).toBeCloseTo(pf.xMm + 20); // 局部原点按包围盒反推
    expect(validateLayout(lay)).toEqual([]); // 间距仍正确（正确重排）
  });

  it('超宽到超出页面：自检（包围盒校验）必须失败', () => {
    // 用户示例：line [-120,-30,180,-30] → 实际宽 300mm，超过版面
    const fig: FigureSpec = { widthMm: 90, heightMm: 55, shapes: [{ kind: 'line', pts: [-120, -30, 180, -30] }] };
    const lay = layoutDocument(docWithFigure(fig), translate);
    expect(lay.figures[0].wMm).toBeCloseTo(300);
    const violations = validateLayout(lay);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join(';')).toMatch(/图形/);
  });

  it('shapeBounds 联合包围盒（含圆半径）', () => {
    const b = shapeBounds({
      widthMm: 90,
      heightMm: 55,
      shapes: [
        { kind: 'circle', pts: [60, 27, 12] },
        { kind: 'rect', pts: [0, 0, 90, 55] },
      ],
    })!;
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 90, maxY: 55 });
  });
});

describe('正常验证样张回归', () => {
  it('样张图形合法且版面校验全部通过', () => {
    const doc = buildSampleDocument('en-us-g2.ctb', 'braille-11x11.5');
    for (const b of doc.blocks) if (b.kind === 'figure') expect(validateFigure(b.figure)).toBeNull();
    const lay = layoutDocument(doc, translate);
    expect(validateLayout(lay)).toEqual([]);
    // 样张图形占满声明框：实际包围盒 = 90×55
    expect(lay.figures[0].wMm).toBeCloseTo(90);
    expect(lay.figures[0].hMm).toBeCloseTo(55);
  });
});
