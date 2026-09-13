import { useState } from 'react';
import type { Block, FigureSpec } from '../model/document';
import { validateFigure } from '../model/document';
import { applyFigureSize, applyShapesJson } from './figureEdit';

export interface EditorProps {
  blocks: Block[];
  selectedId: string | null;
  onSelect(id: string): void;
  onChange(blocks: Block[]): void;
}

/**
 * 图形编辑器：所有修改先经 applyFigureSize/applyShapesJson 校验，
 * 越界或非法的输入被拒绝（只显示错误，不写入文档）。
 */
function FigureEditor({ fig, onChange }: { fig: FigureSpec; onChange(f: FigureSpec): void }) {
  const [wText, setWText] = useState(String(fig.widthMm));
  const [hText, setHText] = useState(String(fig.heightMm));
  const [json, setJson] = useState(JSON.stringify(fig.shapes));
  const [error, setError] = useState<string | null>(null);

  const trySize = (wText: string, hText: string) => {
    const r = applyFigureSize(fig, Number(wText), Number(hText));
    if (r.figure) {
      setError(null);
      onChange(r.figure);
    } else {
      setError(`尺寸被拒绝：${r.error}`);
    }
  };
  const tryShapes = (text: string) => {
    const r = applyShapesJson(fig, text);
    if (r.figure) {
      setError(null);
      onChange(r.figure);
    } else {
      setError(`形状被拒绝：${r.error}`);
    }
  };

  // 文档中当前图形自身的校验状态（例如打开了旧工程）
  const currentError = validateFigure(fig);

  return (
    <div className="figure-editor">
      <label>
        宽 mm
        <input
          type="number"
          value={wText}
          min={5}
          max={250}
          onChange={(e) => {
            setWText(e.target.value);
            trySize(e.target.value, hText);
          }}
        />
      </label>
      <label>
        高 mm
        <input
          type="number"
          value={hText}
          min={5}
          max={250}
          onChange={(e) => {
            setHText(e.target.value);
            trySize(wText, e.target.value);
          }}
        />
      </label>
      <label className="shapes-label">
        形状（JSON：line [x1,y1,x2,y2] / rect [x,y,w,h] / circle [cx,cy,r] / polyline [x1,y1,…]；
        坐标须在 [0,0]–[{fig.widthMm},{fig.heightMm}]mm 内）
        <textarea
          rows={4}
          value={json}
          onChange={(e) => {
            setJson(e.target.value);
            tryShapes(e.target.value);
          }}
        />
      </label>
      {error && <div className="error">{error}</div>}
      {!error && currentError && <div className="error">当前图形非法：{currentError}</div>}
    </div>
  );
}

export function Editor({ blocks, selectedId, onSelect, onChange }: EditorProps) {
  const update = (id: string, patch: Partial<Block>) =>
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (kind: Block['kind']) => {
    const id = Math.random().toString(36).slice(2, 10);
    const block: Block =
      kind === 'heading'
        ? { id, kind, level: 1, text: '新标题' }
        : kind === 'paragraph'
          ? { id, kind, text: '新段落…' }
          : {
              id,
              kind,
              figure: { widthMm: 60, heightMm: 40, shapes: [{ kind: 'rect', pts: [0, 0, 60, 40] }] },
              caption: '图注：',
            };
    onChange([...blocks, block]);
    onSelect(id);
  };

  return (
    <div className="editor">
      <div className="editor-actions">
        <button onClick={() => add('heading')}>+标题</button>
        <button onClick={() => add('paragraph')}>+段落</button>
        <button onClick={() => add('figure')}>+图形</button>
      </div>
      {blocks.map((b) => (
        <div
          key={b.id}
          className={`block ${b.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(b.id)}
        >
          <div className="block-head">
            <span className="badge">{b.kind === 'heading' ? '标题' : b.kind === 'paragraph' ? '段落' : '图形'}</span>
            <button onClick={() => move(b.id, -1)}>↑</button>
            <button onClick={() => move(b.id, 1)}>↓</button>
            <button onClick={() => remove(b.id)}>删</button>
          </div>
          {b.kind === 'figure' ? (
            <>
              <FigureEditor key={b.id} fig={b.figure} onChange={(figure) => update(b.id, { figure })} />
              <textarea
                rows={2}
                value={b.caption}
                onChange={(e) => update(b.id, { caption: e.target.value })}
                placeholder="图注文字"
              />
            </>
          ) : (
            <textarea
              rows={b.kind === 'heading' ? 1 : 3}
              value={b.text}
              onChange={(e) => update(b.id, { text: e.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  );
}
