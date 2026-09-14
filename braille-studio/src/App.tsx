import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StudioDocument, FigureSpec } from './model/document';
import { emptyDocument, normalizeDocument } from './model/document';
import type { TranslatorInfo } from './braille/translator';
import { initTranslator, translationCache } from './braille/translator';
import { layoutDocument } from './layout/engine';
import { computeLeaderLines, validateLeaderLines } from './layout/anchors';
import { affectedPages, pageSignatures } from './layout/revision';
import { resolveAnchors, anchorNumbers } from './model/anchor';
import { getProfile } from './model/profile';
import { exportPdf } from './export/pdf';
import { buildSampleDocument } from './samples/sampleDoc';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectMeta } from './storage/db';
import { IdbExportStore, type ExportRecord } from './storage/exports';
import { Toolbar } from './ui/Toolbar';
import { Editor } from './ui/Editor';
import { Inspector } from './ui/Inspector';
import { CanvasPreview } from './preview/CanvasPreview';
import { newId } from './model/document';

const exportStore = new IdbExportStore();

export function App() {
  const [info, setInfo] = useState<TranslatorInfo | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [doc, setDoc] = useState<StudioDocument | null>(null);
  const [profileId, setProfileId] = useState('A');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickedCell, setPickedCell] = useState<{ lineIdx: number; cellIdx: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showEmptyDots, setShowEmptyDots] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [toast, setToast] = useState('');
  const [affected, setAffected] = useState<number[]>([]);
  const prevSigs = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    initTranslator()
      .then((i) => {
        setInfo(i);
        setDoc(normalizeDocument(buildSampleDocument(i.tables[0]?.file ?? 'en-us-g2.ctb', 'braille-11x11.5')));
      })
      .catch((e) => setInitError(String(e?.message ?? e)));
  }, []);

  const profile = doc ? getProfile(doc.profiles, profileId) : null;

  // 当前规格的版面（转译结果经共享缓存，两个规格不重复转译）
  const layout = useMemo(
    () => (doc && profile ? layoutDocument(doc, translationCache.get, profile.spec, profile.pagePresetId) : null),
    [doc, profile],
  );
  const figures = useMemo(() => {
    const m = new Map<string, FigureSpec>();
    doc?.blocks.forEach((b) => b.kind === 'figure' && m.set(b.id, b.figure));
    return m;
  }, [doc]);

  // 锚点：语义解析（与坐标无关）+ 连续编号 + 当前规格的连线几何
  const resolutions = useMemo(() => (doc ? resolveAnchors(doc) : new Map()), [doc]);
  const numbers = useMemo(() => (doc ? anchorNumbers(doc) : new Map()), [doc]);
  const leaders = useMemo(
    () => (doc && layout && profile ? computeLeaderLines(layout, doc, resolutions, numbers, profile.overrides) : []),
    [doc, layout, profile, resolutions, numbers],
  );
  const leaderViolations = useMemo(() => (layout ? validateLeaderLines(layout, leaders) : []), [layout, leaders]);

  // 修订影响页：与上一版签名 diff（按规格分别跟踪）
  useEffect(() => {
    if (!layout || !profile) return;
    const sigs = pageSignatures(layout);
    const prev = prevSigs.current.get(profile.id);
    if (prev) setAffected(affectedPages(prev, sigs));
    prevSigs.current.set(profile.id, sigs);
  }, [layout, profile]);

  const patchDoc = (patch: Partial<StudioDocument>) => doc && setDoc({ ...doc, ...patch, updatedAt: Date.now() });

  const refreshExports = useCallback(() => exportStore.list().then(setExports), []);
  useEffect(() => {
    refreshExports().catch(() => {});
  }, [refreshExports]);

  const onExportPdf = useCallback(async () => {
    if (!layout || !doc || !info || !profile) return;
    setExporting(true);
    try {
      const bytes = await exportPdf(
        layout,
        figures,
        { title: doc.name, tableFile: doc.tableFile, liblouisVersion: info.version, profileLabel: profile.label },
        leaders,
      );
      const buf = bytes.buffer as ArrayBuffer;
      // 留存导出记录（旧版可回看）
      await exportStore.save({
        id: newId(),
        docId: doc.id,
        docName: doc.name,
        profileId: profile.id,
        profileLabel: profile.label,
        tableFile: doc.tableFile,
        pageCount: layout.pageCount,
        createdAt: Date.now(),
        bytes: buf.slice(0),
      });
      await refreshExports();
      const blob = new Blob([buf], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${doc.name || 'braille'}-${profile.id}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }, [layout, doc, info, profile, figures, leaders, refreshExports]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  if (initError) return <div className="fatal">liblouis 初始化失败：{initError}</div>;
  if (!info || !doc || !layout || !profile) return <div className="fatal">正在加载本地 liblouis WASM 与语言表…</div>;

  const selectedBlock = doc.blocks.find((b) => b.id === selectedId) ?? null;
  const mismatchCount = [...resolutions.values()].filter((r) => r.status === 'mismatch').length;

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
        onLoadSample={() => setDoc(normalizeDocument(buildSampleDocument(doc.tableFile, doc.pagePresetId)))}
        onSave={async () => {
          await saveProject(doc);
          flash('已保存到本地 IndexedDB');
        }}
        onOpen={async () => setProjects(await listProjects())}
        onExportPdf={onExportPdf}
        exporting={exporting}
      />
      <div className="profile-bar">
        <span>输出规格：</span>
        {(doc.profiles ?? []).map((p) => (
          <button key={p.id} className={p.id === profile.id ? 'active' : ''} onClick={() => setProfileId(p.id)}>
            {p.label}
          </button>
        ))}
        <span className="hint">
          单元距 {profile.spec.cellPitch}mm · 点距 {profile.spec.dotPitch}mm · 行距 {profile.spec.linePitch}mm
          （共享转译，布局与微调各自独立）
        </span>
        {mismatchCount > 0 && <span className="mismatch-flag">⚠ {mismatchCount} 个锚点失配，等待确认</span>}
        {affected.length > 0 && <span className="affected">修订影响页：{affected.map((p) => p + 1).join('、')}</span>}
      </div>
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
            {leaderViolations.length > 0 && <span className="error">连线压盲文：{leaderViolations.length} 处</span>}
          </div>
          <CanvasPreview
            layout={layout}
            figures={figures}
            leaders={leaders}
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
          doc={doc}
          profile={profile}
          block={selectedBlock}
          layout={layout}
          figures={figures}
          leaders={leaders}
          leaderViolations={leaderViolations}
          resolutions={resolutions}
          affected={affected}
          exports={exports}
          onDocChange={setDoc}
          onDeleteExport={async (id) => {
            await exportStore.remove(id);
            await refreshExports();
          }}
          onDownloadExport={(rec) => {
            const blob = new Blob([rec.bytes], { type: 'application/pdf' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${rec.docName}-${rec.profileId}-${new Date(rec.createdAt).toISOString().slice(0, 19)}.pdf`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
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
                    if (d) setDoc(normalizeDocument(d));
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
