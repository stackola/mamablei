import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManifoldToplevel } from 'manifold-3d';
import { Canvas2D, type CanvasHandle, type GridSettings } from './editor/Canvas2D';
import { moveShape, type Tool } from './editor/editGeom';
import { computeLayout, Gc, type Layout } from './geometry/layout2d';
import { loadManifold } from './geometry/manifoldLoader';
import type { BuildOutput } from './geometry/pipeline';
import type { BuildRequest, BuildResponse } from './geometry/worker';
import { defaultDesign, newId } from './model/defaults';
import { loadStoredDesign, useDesignHistory } from './model/history';
import type { Design } from './model/types';
import { Preview3D, type PreviewMode } from './preview/Preview3D';
import { download, ExportPanel } from './ui/ExportPanel';
import { FramePanel, PalettePanel, ParamsPanel, PrintPanel, SelectionPanel, WarningsPanel } from './ui/Panels';
import { TemplateDialog } from './ui/TemplateDialog';
import { safeFileName } from './export/cutFiles';

type ViewMode = '2d' | 'split' | '3d';

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Auswählen / Verschieben', key: 'V', icon: '➤' },
  { id: 'line', label: 'Linie', key: 'L', icon: '╱' },
  { id: 'rect', label: 'Rechteck', key: 'R', icon: '▭' },
  { id: 'circle', label: 'Kreis (von der Mitte)', key: 'K', icon: '◯' },
  { id: 'ellipse', label: 'Oval', key: 'O', icon: '⬭' },
  { id: 'polygon', label: 'Vieleck', key: 'P', icon: '⬠' },
  { id: 'fill', label: 'Farbeimer', key: 'F', icon: '🪣' },
];

export default function App() {
  const hist = useDesignHistory(() => loadStoredDesign() ?? defaultDesign());
  const { design, update, commit, undo, redo, reset } = hist;
  const [M, setM] = useState<ManifoldToplevel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<string | null>(null);
  const [activeFill, setActiveFill] = useState<string>('c-rot');
  const [grid, setGrid] = useState<GridSettings>({ on: true, size: 5 });
  const [showNumbers, setShowNumbers] = useState(true);
  const [showSeams, setShowSeams] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('finished');
  const [lightColor, setLightColor] = useState('#fff1d6');
  const [lightIntensity, setLightIntensity] = useState(1.0);
  const [showTemplates, setShowTemplates] = useState(false);
  const canvasRef = useRef<CanvasHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadManifold().then(setM, (e) => setLoadError(String(e)));
  }, []);

  // ---- 2D layout (main thread, throttled to animation frames)
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    if (!M) return;
    const raf = requestAnimationFrame(() => {
      const gc = new Gc();
      try {
        setLayout(computeLayout(M, design, gc).layout);
      } catch (e) {
        console.error(e);
      } finally {
        gc.dispose();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [M, design]);

  // ---- 3D build (worker, debounced)
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const [build, setBuild] = useState<BuildOutput | null>(null);
  const [builtId, setBuiltId] = useState(0);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const geomKey = useMemo(() => JSON.stringify({ f: design.frame, s: design.shapes, fl: design.fills, p: design.params, d: design.defaultFill }), [design]);
  const builtKey = useRef('');
  useEffect(() => {
    const w = new Worker(new URL('./geometry/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<BuildResponse>) => {
      const r = ev.data;
      if (r.id !== reqId.current) return;
      setBusy(false);
      setBuiltId(r.id);
      if (r.ok) {
        setBuild(r.out);
        setBuildError(null);
      } else setBuildError(r.error);
    };
    return () => w.terminate();
  }, []);
  useEffect(() => {
    if (geomKey === builtKey.current) return;
    const t = setTimeout(() => {
      builtKey.current = geomKey;
      reqId.current += 1;
      setBusy(true);
      workerRef.current?.postMessage({ id: reqId.current, design } satisfies BuildRequest);
    }, 450);
    return () => clearTimeout(t);
  }, [geomKey, design]);
  const buildStale = busy || builtId !== reqId.current || geomKey !== builtKey.current;

  // ---- actions
  const selectedShape = design.shapes.find((s) => s.id === selection) ?? null;
  const deleteSelected = useCallback(() => {
    if (!selection) return;
    update((d) => ({ ...d, shapes: d.shapes.filter((s) => s.id !== selection) }));
    setSelection(null);
  }, [selection, update]);
  const duplicateSelected = useCallback(() => {
    const s = design.shapes.find((x) => x.id === selection);
    if (!s) return;
    const copy = { ...moveShape(s, 10, -10), id: newId() };
    update((d) => ({ ...d, shapes: [...d.shapes, copy] }));
    setSelection(copy.id);
  }, [design.shapes, selection, update]);

  const saveDesign = () => download(JSON.stringify(design, null, 2), `${safeFileName(design.name)}.bleiglas.json`, 'application/json');
  const openDesign = (file: File) => {
    file.text().then((t) => {
      try {
        const d = JSON.parse(t) as Design;
        if (d.version !== 1 || !d.frame || !Array.isArray(d.shapes)) throw new Error('Unbekanntes Format');
        reset(d);
        setSelection(null);
        setTimeout(() => canvasRef.current?.fit(), 50);
      } catch (e) {
        alert(`Datei konnte nicht geöffnet werden: ${(e as Error).message}`);
      }
    });
  };

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDesign();
        return;
      }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && tool !== 'polygon' && tool !== 'frame') {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === 'Escape') {
        setSelection(null);
        if (tool !== 'polygon' && tool !== 'frame') setTool('select');
        return;
      }
      if (e.key.startsWith('Arrow') && selectedShape) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : grid.on ? grid.size : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
        update((d) => ({ ...d, shapes: d.shapes.map((s) => (s.id === selectedShape.id ? moveShape(s, dx, dy) : s)) }));
        return;
      }
      const tl = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (tl) setTool(tl.id);
      if (e.key === '0') canvasRef.current?.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loadError) return <div className="fatal">Fehler beim Laden der Geometrie-Bibliothek: {loadError}</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">◈ Bleiglas-Editor</div>
        <input className="doc-name" value={design.name} onChange={(e) => update({ ...design, name: e.target.value })} title="Name des Entwurfs" />
        <div className="tb-group">
          <button onClick={() => setShowTemplates(true)}>Neu …</button>
          <button onClick={() => fileRef.current?.click()}>Öffnen …</button>
          <button onClick={saveDesign} title="Strg+S">Speichern</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openDesign(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="tb-group">
          <button onClick={undo} disabled={!hist.canUndo} title="Rückgängig (Strg+Z)">↶</button>
          <button onClick={redo} disabled={!hist.canRedo} title="Wiederholen (Strg+Y)">↷</button>
        </div>
        <div className="tb-group">
          <label className="check inline">
            <input type="checkbox" checked={grid.on} onChange={(e) => setGrid({ ...grid, on: e.target.checked })} /> Raster
          </label>
          <select value={grid.size} onChange={(e) => setGrid({ ...grid, size: Number(e.target.value) })} disabled={!grid.on}>
            {[1, 2, 2.5, 5, 10, 20].map((s) => (
              <option key={s} value={s}>
                {s.toLocaleString('de-DE')} mm
              </option>
            ))}
          </select>
          <label className="check inline">
            <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} /> Nummern
          </label>
          <label className="check inline">
            <input type="checkbox" checked={showSeams} onChange={(e) => setShowSeams(e.target.checked)} /> Nähte
          </label>
        </div>
        <div className="tb-group seg">
          {(['2d', 'split', '3d'] as ViewMode[]).map((m) => (
            <button key={m} className={viewMode === m ? 'on' : ''} onClick={() => setViewMode(m)}>
              {m === '2d' ? '2D' : m === '3d' ? '3D' : '2D + 3D'}
            </button>
          ))}
        </div>
      </header>

      <div className="main">
        <nav className="toolbar">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
              <span className="ti">{t.icon}</span>
              <span className="tk">{t.key}</span>
            </button>
          ))}
        </nav>

        <div className={`stage mode-${viewMode}`}>
          {viewMode !== '3d' && (
            <div className="pane2d">
              {M ? (
                <Canvas2D
                  ref={canvasRef}
                  design={design}
                  layout={layout}
                  build={build}
                  buildStale={buildStale}
                  tool={tool}
                  setTool={setTool}
                  selection={selection}
                  setSelection={setSelection}
                  activeFill={activeFill}
                  grid={grid}
                  showNumbers={showNumbers}
                  showSeams={showSeams}
                  update={update}
                  commit={commit}
                />
              ) : (
                <div className="preview-msg">Lade …</div>
              )}
            </div>
          )}
          {viewMode !== '2d' && (
            <div className="pane3d">
              <div className="pv-tabs">
                {([
                  ['finished', 'Fertig (beleuchtet)'],
                  ['print', 'Druckteile'],
                  ['exploded', 'Explosion'],
                ] as [PreviewMode, string][]).map(([m, l]) => (
                  <button key={m} className={previewMode === m ? 'on' : ''} onClick={() => setPreviewMode(m)}>
                    {l}
                  </button>
                ))}
                {previewMode === 'finished' && (
                  <span className="light-ctl">
                    Licht
                    <input type="color" value={lightColor} onChange={(e) => setLightColor(e.target.value)} />
                    <input type="range" min={0} max={3} step={0.05} value={lightIntensity} onChange={(e) => setLightIntensity(parseFloat(e.target.value))} />
                  </span>
                )}
              </div>
              <Preview3D build={build} palette={design.palette} mode={previewMode} lightColor={lightColor} lightIntensity={lightIntensity} busy={busy} />
              {build && (
                <div className="pv-foot">
                  {build.pieces.length} Teil{build.pieces.length === 1 ? '' : 'e'} · {build.panes.length} Scheiben · berechnet in{' '}
                  {Object.values(build.timings).reduce((a, b) => a + b, 0)} ms
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="sidebar">
          <SelectionPanel shape={selectedShape} update={update} onDelete={deleteSelected} onDuplicate={duplicateSelected} />
          <PalettePanel design={design} update={update} activeFill={activeFill} setActiveFill={setActiveFill} layout={layout} onPick={() => setTool('fill')} />
          <FramePanel design={design} update={update} commit={commit} onDrawFrame={() => setTool('frame')} />
          <ParamsPanel design={design} update={update} commit={commit} layout={layout} />
          <PrintPanel design={design} update={update} build={build} buildStale={buildStale} />
          <WarningsPanel layout={layout} build={buildStale ? null : build} buildError={buildError} />
          <ExportPanel design={design} layout={layout} build={build} ready={!buildStale} />
        </aside>
      </div>

      {showTemplates && (
        <TemplateDialog
          onClose={() => setShowTemplates(false)}
          onPick={(d) => {
            reset(d);
            setSelection(null);
            setShowTemplates(false);
            setTimeout(() => canvasRef.current?.fit(), 50);
          }}
        />
      )}
    </div>
  );
}
