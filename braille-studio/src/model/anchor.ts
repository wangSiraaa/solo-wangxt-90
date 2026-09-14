/**
 * 语义锚点：绑定「原文片段」或「稳定图形对象」，而非固定页面坐标。
 *
 * 重排（正文编辑、语言表升级、规格切换）后，锚点按**内容**重新解析：
 *  - 原文锚点：在所属块中查找片段，唯一命中才视为解析成功；
 *  - 图形锚点：按形状的稳定 ID 查找；
 *  - 解析失败 = 失配（mismatch），等待人工确认，不自动删除、
 *    也不因"旧坐标仍落在页面内"而认定迁移成功——坐标不参与判定。
 */
import type { StudioDocument } from './document';

export type AnchorTarget =
  | { kind: 'text'; blockId: string; fragment: string }
  | { kind: 'shape'; blockId: string; shapeId: string };

export interface Anchor {
  id: string;
  target: AnchorTarget;
  /** 标注说明（校样用） */
  note: string;
}

export type Resolution =
  | { status: 'resolved'; blockId: string; charStart?: number; charEnd?: number; shapeIndex?: number }
  | { status: 'mismatch'; reason: string };

/** 按内容解析全部锚点（与版面坐标无关） */
export function resolveAnchors(doc: StudioDocument): Map<string, Resolution> {
  const out = new Map<string, Resolution>();
  for (const a of doc.anchors ?? []) {
    const target = a.target;
    const block = doc.blocks.find((b) => b.id === target.blockId);
    if (!block) {
      out.set(a.id, { status: 'mismatch', reason: '目标块已删除' });
      continue;
    }
    if (target.kind === 'text') {
      if (block.kind === 'figure') {
        out.set(a.id, { status: 'mismatch', reason: '目标块不是文本块' });
        continue;
      }
      const text = block.text;
      const frag = target.fragment;
      if (!frag) {
        out.set(a.id, { status: 'mismatch', reason: '锚点片段为空' });
        continue;
      }
      const first = text.indexOf(frag);
      if (first < 0) {
        out.set(a.id, { status: 'mismatch', reason: `原文片段已不存在：“${frag.slice(0, 20)}${frag.length > 20 ? '…' : ''}”` });
        continue;
      }
      if (text.indexOf(frag, first + 1) >= 0) {
        out.set(a.id, { status: 'mismatch', reason: `原文片段不唯一：“${frag.slice(0, 20)}…”` });
        continue;
      }
      out.set(a.id, { status: 'resolved', blockId: block.id, charStart: first, charEnd: first + frag.length });
    } else {
      if (block.kind !== 'figure') {
        out.set(a.id, { status: 'mismatch', reason: '目标块不是图形块' });
        continue;
      }
      const idx = block.figure.shapes.findIndex((s) => s.id === target.shapeId);
      if (idx < 0) {
        out.set(a.id, { status: 'mismatch', reason: `图形对象已删除（${target.shapeId}）` });
        continue;
      }
      out.set(a.id, { status: 'resolved', blockId: block.id, shapeIndex: idx });
    }
  }
  return out;
}

/**
 * 锚点编号：按文档顺序（块序 → 块内位置）编为 A1、A2…，
 * 与分页无关 —— 增删内容后编号始终连续、无跳号。
 */
export function anchorNumbers(doc: StudioDocument): Map<string, string> {
  const anchors = doc.anchors ?? [];
  const blockOrder = new Map(doc.blocks.map((b, i) => [b.id, i]));
  const sorted = [...anchors].sort((x, y) => {
    const bx = blockOrder.get(x.target.blockId) ?? Infinity;
    const by = blockOrder.get(y.target.blockId) ?? Infinity;
    if (bx !== by) return bx - by;
    const pos = (a: Anchor) =>
      a.target.kind === 'text'
        ? (() => {
            const b = doc.blocks.find((bb) => bb.id === a.target.blockId);
            if (!b || b.kind === 'figure') return Infinity;
            const i = b.text.indexOf((a.target as { fragment: string }).fragment);
            return i < 0 ? Infinity : i;
          })()
        : (() => {
            const b = doc.blocks.find((bb) => bb.id === a.target.blockId);
            if (!b || b.kind !== 'figure') return Infinity;
            return b.figure.shapes.findIndex((s) => s.id === (a.target as { shapeId: string }).shapeId);
          })();
    return pos(x) - pos(y);
  });
  return new Map(sorted.map((a, i) => [a.id, `A${i + 1}`]));
}

/** 目标的可读描述（面板显示用） */
export function describeTarget(a: Anchor, doc: StudioDocument): string {
  const target = a.target;
  const block = doc.blocks.find((b) => b.id === target.blockId);
  if (target.kind === 'text') {
    return `文本“${target.fragment.length > 16 ? target.fragment.slice(0, 16) + '…' : target.fragment}”`;
  }
  if (block && block.kind === 'figure') {
    const idx = block.figure.shapes.findIndex((s) => s.id === target.shapeId);
    return `图形形状 #${idx >= 0 ? idx + 1 : '?'}（${target.shapeId}）`;
  }
  return `图形形状（${target.shapeId}）`;
}
