/**
 * 语义锚点 / 双规格输出 / 修订影响 的验证：
 *  - 一句文本删除：锚点按内容重新解析；删除被锚句子 → 失配等待确认，
 *    且不因旧坐标仍在页面内而认定迁移成功；
 *  - 语言表升级：转译结果剧变，文本锚点仍解析（绑定原文而非坐标）；
 *  - 图注换页：连线仍不压盲文；
 *  - 跨页编号连续：增删后编号无跳号；
 *  - 双规格：共享转译、布局独立、微调不互相污染；
 *  - 修订影响页可查看，未受影响的人工定位保留；
 *  - 旧版导出可回看。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initTranslator, translate, TranslationCache } from '../src/braille/translator';
import { layoutDocument, layoutToDots, validateLayout } from '../src/layout/engine';
import { computeLeaderLines, validateLeaderLines } from '../src/layout/anchors';
import { affectedPages, pageSignatures } from '../src/layout/revision';
import { resolveAnchors, anchorNumbers } from '../src/model/anchor';
import { defaultProfiles, getProfile } from '../src/model/profile';
import { newId, normalizeDocument, type StudioDocument } from '../src/model/document';
import { buildSampleDocument } from '../src/samples/sampleDoc';
import { MemoryExportStore } from '../src/storage/exports';
import { exportPdf } from '../src/export/pdf';
import { PDFDocument } from 'pdf-lib';
import type { FigureSpec } from '../src/model/document';

beforeAll(async () => {
  await initTranslator();
});

function textDoc(): StudioDocument {
  const p1 = newId();
  const p2 = newId();
  return normalizeDocument({
    id: newId(),
    name: 'anchor-test',
    tableFile: 'en-us-g2.ctb',
    pagePresetId: 'braille-11x11.5',
    showPageNumbers: true,
    updatedAt: 0,
    blocks: [
      { id: p1, kind: 'paragraph', text: 'First sentence here. Second sentence stays.' },
      { id: p2, kind: 'paragraph', text: 'Target phrase alpha. Other words follow.' },
    ],
    anchors: [{ id: 'anchor-1', target: { kind: 'text', blockId: p2, fragment: 'Target phrase alpha' }, note: 't' }],
  });
}

const lay = (doc: StudioDocument, profileIdx = 0) => {
  const p = doc.profiles![profileIdx];
  return layoutDocument(doc, translate, p.spec, p.pagePresetId);
};

describe('一句文本删除与锚点失配', () => {
  it('删除前文句子：锚点仍解析，连线重算', () => {
    const doc = textDoc();
    const before = resolveAnchors(doc).get('anchor-1')!;
    expect(before.status).toBe('resolved');
    // 删除第一段的第一句
    const p1 = doc.blocks[0] as any;
    p1.text = p1.text.replace('First sentence here. ', '');
    const after = resolveAnchors(doc).get('anchor-1')!;
    expect(after.status).toBe('resolved');
    if (after.status === 'resolved' && before.status === 'resolved') {
      expect(after.charStart).toBe(before.charStart); // 绑定原文，位置语义不变
    }
    const leaders = computeLeaderLines(lay(doc), doc, resolveAnchors(doc), anchorNumbers(doc), doc.profiles![0].overrides);
    expect(leaders.length).toBe(1);
    expect(validateLeaderLines(lay(doc), leaders)).toEqual([]);
  });

  it('删除被锚句子：失配等待确认 —— 旧坐标仍在页面内也不算迁移成功', () => {
    const doc = textDoc();
    const layout1 = lay(doc);
    const leaders1 = computeLeaderLines(layout1, doc, resolveAnchors(doc), anchorNumbers(doc), doc.profiles![0].overrides);
    const oldTarget = { page: leaders1[0].page, x: leaders1[0].segments[1].x2, y: leaders1[0].segments[1].y2 };

    // 删除被锚句子（后续内容上移，旧坐标区域仍有盲文）
    const p2 = doc.blocks[1] as any;
    p2.text = p2.text.replace('Target phrase alpha. ', '');
    const res = resolveAnchors(doc).get('anchor-1')!;
    expect(res.status).toBe('mismatch');
    if (res.status === 'mismatch') expect(res.reason).toMatch(/已不存在/);

    // 关键断言：旧坐标附近仍有盲文点（坐标判据会误判为"迁移成功"），但语义解析判定失配
    const layout2 = lay(doc);
    const dots = layoutToDots(layout2).filter((d) => d.page === oldTarget.page);
    const near = dots.some((d) => Math.hypot(d.xMm - oldTarget.x, d.yMm - oldTarget.y) < 12);
    expect(near).toBe(true);
    expect(res.status).toBe('mismatch');

    // 失配锚点保留在文档中等待确认，不产生连线
    expect(doc.anchors!.length).toBe(1);
    const leaders2 = computeLeaderLines(layout2, doc, resolveAnchors(doc), anchorNumbers(doc), doc.profiles![0].overrides);
    expect(leaders2.length).toBe(0);

    // 人工确认：重新绑定到现存片段后恢复
    (doc.anchors![0].target as any).fragment = 'Other words follow';
    expect(resolveAnchors(doc).get('anchor-1')!.status).toBe('resolved');
  });

  it('片段不唯一也算失配', () => {
    const doc = textDoc();
    (doc.blocks[1] as any).text = 'dup word. dup word.';
    (doc.anchors![0].target as any).fragment = 'dup word';
    const res = resolveAnchors(doc).get('anchor-1')!;
    expect(res.status).toBe('mismatch');
    if (res.status === 'mismatch') expect(res.reason).toMatch(/不唯一/);
  });
});

describe('语言表升级', () => {
  it('转译剧变但文本锚点仍解析；版面签名变化可查看', () => {
    const doc = textDoc();
    const g1 = translate('knowledge', 'en-us-g1.ctb');
    const g2 = translate('knowledge', 'en-us-g2.ctb');
    expect(g1.braille.length).not.toBe(g2.braille.length); // 表升级 → 转译结果不同

    doc.tableFile = 'en-us-g1.ctb';
    const lay1 = lay(doc);
    const res1 = resolveAnchors(doc).get('anchor-1')!;
    doc.tableFile = 'en-us-g2.ctb'; // 升级语言表
    const lay2 = lay(doc);
    const res2 = resolveAnchors(doc).get('anchor-1')!;
    expect(res1.status).toBe('resolved');
    expect(res2.status).toBe('resolved'); // 绑定原文，不受转译变化影响
    expect(affectedPages(pageSignatures(lay1), pageSignatures(lay2)).length).toBeGreaterThan(0);
  });
});

describe('跨页编号连续', () => {
  it('编号按文档顺序连续，删除确认后无跳号', () => {
    const doc = buildSampleDocument('en-us-g2.ctb', 'braille-11x11.5');
    // 样张跨多页；再加一个文本锚点
    const para = doc.blocks.find((b) => b.kind === 'paragraph')!;
    doc.anchors!.push({ id: 'a3', target: { kind: 'text', blockId: para.id, fragment: 'Long-word wrap check' }, note: 'x' });
    const n1 = [...anchorNumbers(doc).values()];
    expect(n1).toEqual(['A1', 'A2', 'A3']); // 跨页连续
    // 确认删除一个失配锚点后重新编号，仍连续
    doc.anchors = doc.anchors!.filter((a) => a.target.kind !== 'shape');
    const n2 = [...anchorNumbers(doc).values()];
    expect(n2).toEqual(['A1', 'A2']);
  });
});

describe('图注换页与连线不压盲文', () => {
  it('样张（图注跨页）两种规格下连线均不压盲文', () => {
    const doc = buildSampleDocument('en-us-g2.ctb', 'braille-11x11.5');
    for (const profile of doc.profiles!) {
      const layout = layoutDocument(doc, translate, profile.spec, profile.pagePresetId);
      expect(validateLayout(layout)).toEqual([]);
      const captions = layout.lines.filter((l) => l.role === 'caption');
      expect(new Set(captions.map((l) => l.page)).size).toBeGreaterThan(1); // 图注跨页
      const leaders = computeLeaderLines(layout, doc, resolveAnchors(doc), anchorNumbers(doc), profile.overrides);
      expect(leaders.length).toBe(2); // 文本锚点 + 图形锚点
      expect(validateLeaderLines(layout, leaders)).toEqual([]);
    }
  });
});

describe('双规格输出', () => {
  it('共享转译结果，布局约束各自独立', () => {
    const doc = buildSampleDocument('en-us-g2.ctb', 'braille-11x11.5');
    const cache = new TranslationCache();
    const [pA, pB] = doc.profiles!;
    const layA = layoutDocument(doc, cache.get, pA.spec, pA.pagePresetId);
    const afterA = cache.computed;
    const layB = layoutDocument(doc, cache.get, pB.spec, pB.pagePresetId);
    // 内容文本零新增转译；唯一新增的是 B 版多出来的页码字符串
    expect(cache.computed - afterA).toBe(Math.max(0, layB.pageCount - layA.pageCount));
    // 再次排版 B：完全命中缓存
    const beforeRe = cache.computed;
    layoutDocument(doc, cache.get, pB.spec, pB.pagePresetId);
    expect(cache.computed).toBe(beforeRe);
    expect(layA.geometry.cellsPerLine).not.toBe(layB.geometry.cellsPerLine); // 布局约束独立
    expect(pA.spec.cellPitch).not.toBe(pB.spec.cellPitch);
  });

  it('某一规格的手工微调不得污染另一版', () => {
    const doc = buildSampleDocument('en-us-g2.ctb', 'braille-11x11.5');
    const anchorId = doc.anchors![0].id;
    // 在规格 A 上微调
    getProfile(doc.profiles, 'A').overrides.anchors[anchorId] = { dxMm: 2, dyMm: 3 };
    expect(getProfile(doc.profiles, 'B').overrides.anchors[anchorId]).toBeUndefined();
    // 微调反映在本规格的连线上
    const pA = getProfile(doc.profiles, 'A');
    const layA = layoutDocument(doc, translate, pA.spec, pA.pagePresetId);
    const leaders = computeLeaderLines(layA, doc, resolveAnchors(doc), anchorNumbers(doc), pA.overrides);
    const base = computeLeaderLines(layA, doc, resolveAnchors(doc), anchorNumbers(doc), { anchors: {} });
    expect(leaders[0].labelY - base[0].labelY).toBeCloseTo(3);
    expect(leaders[0].labelX - base[0].labelX).toBeCloseTo(2);
  });
});

describe('修订影响页与人工定位保留', () => {
  it('编辑仅影响所在页；未受影响锚点的微调保留', () => {
    // 构造：标题 + 充满第 1 页的段落 + 第 2 页图形（含形状锚点）
    const figureId = newId();
    const doc = normalizeDocument({
      id: newId(),
      name: 'rev-test',
      tableFile: 'en-us-g2.ctb',
      pagePresetId: 'braille-11x11.5',
      showPageNumbers: true,
      updatedAt: 0,
      blocks: [
        { id: newId(), kind: 'heading', level: 1, text: 'Revision test' },
        { id: newId(), kind: 'paragraph', text: 'filler words here. '.repeat(200) },
        {
          id: figureId,
          kind: 'figure',
          figure: { widthMm: 60, heightMm: 40, shapes: [{ id: 'box', kind: 'rect', pts: [0, 0, 60, 40] }] },
          caption: 'Box.',
        },
      ],
      anchors: [{ id: 'fig-anchor', target: { kind: 'shape', blockId: figureId, shapeId: 'box' }, note: 'f' }],
    } as StudioDocument);
    const profile = doc.profiles![0];
    // 人工微调该锚点
    profile.overrides.anchors['fig-anchor'] = { dxMm: 1, dyMm: -2 };

    const lay1 = layoutDocument(doc, translate, profile.spec, profile.pagePresetId);
    const figPage = lay1.figures[0].page;
    expect(figPage).toBeGreaterThan(0);
    const sigs1 = pageSignatures(lay1);

    // 仅编辑第 1 页的标题
    (doc.blocks[0] as any).text = 'Revision test (edited)';
    const lay2 = layoutDocument(doc, translate, profile.spec, profile.pagePresetId);
    const affected = affectedPages(sigs1, pageSignatures(lay2));
    expect(affected).toContain(0);
    expect(affected).not.toContain(figPage); // 图形页未受影响

    // 未受影响的人工定位保留：微调仍在，且连线位置随之偏移
    expect(profile.overrides.anchors['fig-anchor']).toEqual({ dxMm: 1, dyMm: -2 });
    const leaders = computeLeaderLines(lay2, doc, resolveAnchors(doc), anchorNumbers(doc), profile.overrides);
    const base = computeLeaderLines(lay2, doc, resolveAnchors(doc), anchorNumbers(doc), { anchors: {} });
    expect(leaders[0].labelY - base[0].labelY).toBeCloseTo(-2);
    expect(validateLeaderLines(lay2, leaders)).toEqual([]);
  });
});

describe('旧版导出可回看', () => {
  it('导出记录可保存、列表、取回字节', async () => {
    const doc = buildSampleDocument('en-us-g2.ctb', 'braille-11x11.5');
    const profile = doc.profiles![0];
    const layout = layoutDocument(doc, translate, profile.spec, profile.pagePresetId);
    const figures = new Map<string, FigureSpec>();
    doc.blocks.forEach((b) => b.kind === 'figure' && figures.set(b.id, b.figure));
    const leaders = computeLeaderLines(layout, doc, resolveAnchors(doc), anchorNumbers(doc), profile.overrides);
    const bytes = await exportPdf(layout, figures, { title: doc.name, tableFile: doc.tableFile, liblouisVersion: '3.2.0' }, leaders);

    const store = new MemoryExportStore();
    await store.save({
      id: 'exp-1',
      docId: doc.id,
      docName: doc.name,
      profileId: profile.id,
      profileLabel: profile.label,
      tableFile: doc.tableFile,
      pageCount: layout.pageCount,
      createdAt: 1000,
      bytes: bytes.buffer as ArrayBuffer,
    });
    await store.save({
      id: 'exp-2',
      docId: doc.id,
      docName: doc.name,
      profileId: 'B',
      profileLabel: '规格 B',
      tableFile: doc.tableFile,
      pageCount: 1,
      createdAt: 2000,
      bytes: new ArrayBuffer(8),
    });
    const list = await store.list();
    expect(list.map((r) => r.id)).toEqual(['exp-2', 'exp-1']); // 新的在前
    const back = await store.get('exp-1');
    const pdf = await PDFDocument.load(back!.bytes);
    expect(pdf.getPageCount()).toBe(layout.pageCount); // 旧版导出可回看
  });
});
