import { useState } from 'react';
import type { StudioDocument } from '../model/document';
import type { Anchor, Resolution } from '../model/anchor';
import { anchorNumbers, describeTarget } from '../model/anchor';
import type { OutputProfile } from '../model/profile';
import { newId } from '../model/document';

export interface AnchorsPanelProps {
  doc: StudioDocument;
  profile: OutputProfile;
  resolutions: Map<string, Resolution>;
  /** 本次修订受影响页（0 基） */
  affected: number[];
  onDocChange(doc: StudioDocument): void;
}

/** 锚点面板：状态列表、失配确认、新增锚点、按规格微调 */
export function AnchorsPanel({ doc, profile, resolutions, affected, onDocChange }: AnchorsPanelProps) {
  const anchors = doc.anchors ?? [];
  const numbers = anchorNumbers(doc);
  const [blockId, setBlockId] = useState('');
  const [kind, setKind] = useState<'text' | 'shape'>('text');
  const [fragment, setFragment] = useState('');
  const [shapeId, setShapeId] = useState('');
  const [note, setNote] = useState('');
  const [rebindId, setRebindId] = useState<string | null>(null);
  const [rebindText, setRebindText] = useState('');

  const setAnchors = (next: Anchor[]) => onDocChange({ ...doc, anchors: next });

  const addAnchor = () => {
    if (!blockId) return;
    const target =
      kind === 'text'
        ? { kind: 'text' as const, blockId, fragment }
        : { kind: 'shape' as const, blockId, shapeId };
    if (kind === 'text' && !fragment) return;
    if (kind === 'shape' && !shapeId) return;
    setAnchors([...anchors, { id: newId(), target, note: note || '标注' }]);
    setFragment('');
    setNote('');
  };

  const nudge = (anchorId: string, dx: number, dy: number) => {
    const profiles = (doc.profiles ?? []).map((p) => {
      if (p.id !== profile.id) return p;
      const cur = p.overrides.anchors[anchorId] ?? { dxMm: 0, dyMm: 0 };
      return {
        ...p,
        overrides: {
          ...p.overrides,
          anchors: { ...p.overrides.anchors, [anchorId]: { dxMm: cur.dxMm + dx, dyMm: cur.dyMm + dy } },
        },
      };
    });
    onDocChange({ ...doc, profiles });
  };

  const resetNudge = (anchorId: string) => {
    const profiles = (doc.profiles ?? []).map((p) => {
      if (p.id !== profile.id) return p;
      const anchors = { ...p.overrides.anchors };
      delete anchors[anchorId];
      return { ...p, overrides: { ...p.overrides, anchors } };
    });
    onDocChange({ ...doc, profiles });
  };

  const selectedBlock = doc.blocks.find((b) => b.id === blockId);

  return (
    <div className="anchors-panel">
      {affected.length > 0 && (
        <p className="affected">
          本次修订影响页：{affected.map((p) => p + 1).join('、')}（共 {affected.length} 页）
        </p>
      )}
      {anchors.length === 0 && <p className="hint">暂无锚点。锚点绑定原文片段或图形对象，重排后按内容重新定位。</p>}
      {anchors.map((a) => {
        const res = resolutions.get(a.id);
        const ov = profile.overrides.anchors[a.id];
        const mismatch = res?.status === 'mismatch';
        return (
          <div key={a.id} className={`anchor-row ${mismatch ? 'mismatch' : ''}`}>
            <div className="anchor-head">
              <strong>{numbers.get(a.id)}</strong> {a.note}
              <span className="hint"> · {describeTarget(a, doc)}</span>
            </div>
            {mismatch ? (
              <div className="mismatch-box">
                <div className="error">锚点失配：{res.reason}。等待确认，不会自动迁移。</div>
                {rebindId === a.id && a.target.kind === 'text' ? (
                  <div className="rebind">
                    <input
                      placeholder="输入新的原文片段"
                      value={rebindText}
                      onChange={(e) => setRebindText(e.target.value)}
                    />
                    <button
                      onClick={() => {
                        setAnchors(
                          anchors.map((x) =>
                            x.id === a.id ? { ...x, target: { kind: 'text', blockId: (a.target as any).blockId, fragment: rebindText } } : x,
                          ),
                        );
                        setRebindId(null);
                      }}
                    >
                      应用
                    </button>
                    <button onClick={() => setRebindId(null)}>取消</button>
                  </div>
                ) : (
                  <div className="rebind">
                    {a.target.kind === 'text' && (
                      <button
                        onClick={() => {
                          setRebindId(a.id);
                          setRebindText((a.target as any).fragment);
                        }}
                      >
                        重新绑定片段
                      </button>
                    )}
                    <button onClick={() => setAnchors(anchors.filter((x) => x.id !== a.id))}>确认删除锚点</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="nudge">
                微调（{profile.label}）：
                <button onClick={() => nudge(a.id, -1, 0)}>←</button>
                <button onClick={() => nudge(a.id, 1, 0)}>→</button>
                <button onClick={() => nudge(a.id, 0, -1)}>↑</button>
                <button onClick={() => nudge(a.id, 0, 1)}>↓</button>
                {ov && (
                  <>
                    <span className="hint">
                      {ov.dxMm > 0 ? '+' : ''}
                      {ov.dxMm}, {ov.dyMm > 0 ? '+' : ''}
                      {ov.dyMm}mm
                    </span>
                    <button onClick={() => resetNudge(a.id)}>复位</button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <details>
        <summary>新增锚点</summary>
        <div className="add-anchor">
          <select
            value={blockId}
            onChange={(e) => {
              setBlockId(e.target.value);
              const b = doc.blocks.find((x) => x.id === e.target.value);
              setKind(b?.kind === 'figure' ? 'shape' : 'text');
            }}
          >
            <option value="">选择块…</option>
            {doc.blocks.map((b, i) => (
              <option key={b.id} value={b.id}>
                #{i + 1} {b.kind === 'heading' ? '标题' : b.kind === 'paragraph' ? '段落' : '图形'}
              </option>
            ))}
          </select>
          {selectedBlock && selectedBlock.kind !== 'figure' && (
            <input placeholder="原文片段（须在块内唯一）" value={fragment} onChange={(e) => setFragment(e.target.value)} />
          )}
          {selectedBlock && selectedBlock.kind === 'figure' && (
            <select value={shapeId} onChange={(e) => setShapeId(e.target.value)}>
              <option value="">选择形状…</option>
              {selectedBlock.figure.shapes.map((s, i) => (
                <option key={s.id ?? i} value={s.id}>
                  #{i + 1} {s.kind}（{s.id}）
                </option>
              ))}
            </select>
          )}
          <input placeholder="标注说明" value={note} onChange={(e) => setNote(e.target.value)} />
          <button onClick={addAnchor}>添加</button>
        </div>
      </details>
    </div>
  );
}
