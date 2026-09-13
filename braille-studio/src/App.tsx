import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudioDocument, FigureSpec } from './model/document';
import { emptyDocument } from './model/document';
import type { TranslatorInfo } from './braille/translator';
import { initTranslator, translate } from './braille/translator';
import { layoutDocument } from './layout/engine';
import { exportPdf } from './export/pdf';
import { buildSampleDocument } from './samples/sampleDoc';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectMeta } from './storage/db';
import { Toolbar } from './ui/Toolbar';
import { Editor } from './ui/Editor';
import { Inspector } from './ui/Inspector';
import { CanvasPreview } from './preview/CanvasPreview';

export function App() {
  const [info, setInfo] = useState<TranslatorInfo | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [doc, setDoc] = useState<StudioDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickedCell, setPickedCell] = useState<{ lineIdx: number; cellIdx: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showEmptyDots, setShowEmptyDots] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    initTranslator()
      .then((i) => {
        setInfo(i);
        setDoc(buildSampleDocument(i.tables[0]?.file ?? 'en-us-g2.ctb', 'braille-11x11.5'));
      })
      .catch((e) => setInitError(String(e?.message ?? e)));
  }, []);

  const layout = useMemo(() => (doc ? layoutDocument(doc, translate) : null), [doc]);
  const figures = useMemo(() => {
    const m = new Map<string, FigureSpec>();
    doc?.blocks.forEach((b) => b.kind === 'figure' && m.set(b.id, b.figure));
    return m;
  }, [doc]);

  const patchDoc = (patch: Partial<StudioDocument>) => doc && setDoc({ ...doc, ...patch, updatedAt: Date.now() });

  const onExportPdf = useCallback(async () => {
    if (!layout || !doc || !info) return;
    setExporting(true);
    try {
      const bytes = await exportPdf(layout, figures, {
        title: doc.name,
        tableFile: doc.tableFile,
        liblouisVersion: info.version,
      });
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${doc.name || 'braille'}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }, [layout, doc, info, figures]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  if (initError) return <div className="fatal">liblouis 初始化失败：{initError}</div>;
  if (!info || !doc || !layout) return <div className="fatal">正在加载本地 liblouis WASM 与语言表…</div>;

  const selectedBlock = doc.blocks.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="app">
      <Toolbar
        docName={doc.name}
        tableFile={doc.tableFile}
        pagePresetId={doc.pagePresetId}
        showPageNumbers={doc.showPageNumbers}
        tables={info.tables}
        liblouisVersion={info.version}
        onDocName={(name) => patchDoc({ name })}
        onTable={(tableFile) => patchDoc({ tableFile })}
        onPreset={(pagePresetId) => patchDoc({ pagePresetId })}
        onTogglePageNumbers={(showPageNumbers) => patchDoc({ showPageNumbers })}
        onLoadSample={() => setDoc(buildSampleDocument(doc.tableFile, doc.pagePresetId))}
        onSave={async () => {
          await saveProject(doc);
          flash('已保存到本地 IndexedDB');
        }}
        onOpen={async () => setProjects(await listProjects())}
        onExportPdf={onExportPdf}
        exporting={exporting}
      />
      <div className="main">
        <Editor
          blocks={doc.blocks}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={(blocks) => patchDoc({ blocks })}
        />
        <div className="preview-pane">
          <div className="preview-controls">
            <label>
              缩放
              <input type="range" min={0.5} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            </label>
            <label>
              <input type="checkbox" checked={showEmptyDots} onChange={(e) => setShowEmptyDots(e.target.checked)} />
              显示空点
            </label>
            <span>
              {layout.pageCount} 页 · 行宽 {layout.geometry.cellsPerLine} 单元 · 内容 {layout.geometry.contentLines} 行/页
            </span>
          </div>
          <CanvasPreview
            layout={layout}
            figures={figures}
            zoom={zoom}
            showEmptyDots={showEmptyDots}
            selectedBlockId={selectedId}
            onPickCell={(blockId, lineIdx, cellIdx) => {
              setSelectedId(blockId);
              setPickedCell({ lineIdx, cellIdx });
            }}
          />
        </div>
        <Inspector
          info={info}
          docName={doc.name}
          tableFile={doc.tableFile}
          block={selectedBlock}
          layout={layout}
          figures={figures}
          pickedCell={pickedCell}
        />
      </div>
      <footer>
        全部计算在本地完成（WASM + IndexedDB），不调用云服务。预览与 PDF 为版面参考；
        <strong>最终触读质量仍需在实际 embosser / 纸张上打样确认</strong>（点高、纸张厚度、压力均影响触感）。
      </footer>
      {projects && (
        <div className="modal" onClick={() => setProjects(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <h3>打开工程（本地 IndexedDB）</h3>
            {projects.length === 0 && <p>暂无已保存工程。</p>}
            {projects.map((p) => (
              <div key={p.id} className="project-row">
                <span>{p.name}</span>
                <span className="hint">{new Date(p.updatedAt).toLocaleString()}</span>
                <button
                  onClick={async () => {
                    const d = await loadProject(p.id);
                    if (d) setDoc(d);
                    setProjects(null);
                  }}
                >
                  打开
                </button>
                <button
                  onClick={async () => {
                    await deleteProject(p.id);
                    setProjects(await listProjects());
                  }}
                >
                  删除
                </button>
              </div>
            ))}
            <button onClick={() => setProjects(null)}>关闭</button>
            <button
              onClick={() => {
                setDoc(emptyDocument(doc.tableFile, doc.pagePresetId));
                setProjects(null);
              }}
            >
              新建空白工程
            </button>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
