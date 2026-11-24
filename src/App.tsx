import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManifoldToplevel } from 'manifold-3d';
import { Canvas2D, type CanvasHandle, type GridSettings } from './editor/Canvas2D';
import { alignShapes, frameInnerBox, moveShape, reorder, shapeBounds, unionBox, type AlignOp, type Tool } from './editor/editGeom';
import { safeFileName } from './export/cutFiles';
import { computeLayout, Gc, type Layout } from './geometry/layout2d';
import { loadManifold } from './geometry/manifoldLoader';
import type { BuildOutput } from './geometry/pipeline';
import { pointInRings } from './geometry/shapes2d';
import { cachedOutline } from './editor/editGeom';
import type { BuildRequest, BuildResponse } from './geometry/worker';
import { defaultDesign, migrateDesign, newId } from './model/defaults';
import { loadStoredDesign, useDesignHistory } from './model/history';
import { Preview3D, type PreviewMode } from './preview/Preview3D';
import { download, FinishCard } from './ui/ExportPanel';
import { icons } from './ui/icons';
import { ColorsCard, FrameCard, LeadCard, SelectionCard } from './ui/Panels';
import { TemplateDialog } from './ui/TemplateDialog';

type ViewMode = '2d' | 'split' | '3d';

interface ToolDef {
  id: Tool;
  label: string;
  key: string;
  icon: string;
}

const MAIN_TOOLS: ToolDef[] = [
  { id: 'select', label: 'Auswählen', key: 'V', icon: 'select' },
  { id: 'rect', label: 'Rechteck', key: 'R', icon: 'rect' },
  { id: 'circle', label: 'Kreis', key: 'K', icon: 'circle' },
  { id: 'ellipse', label: 'Oval', key: 'O', icon: 'ellipse' },
  { id: 'triangle', label: 'Dreieck', key: 'D', icon: 'triangle' },
  { id: 'hexagon', label: 'Sechseck', key: 'S', icon: 'hexagon' },
  { id: 'arch', label: 'Bogen', key: 'B', icon: 'arch' },
  { id: 'halfcircle', label: 'Halbkreis', key: 'H', icon: 'halfcircle' },
  { id: 'fill', label: 'Einfärben', key: 'F', icon: 'fill' },
];
const MORE_TOOLS: ToolDef[] = [
  { id: 'polygon', label: 'Freie Form', key: 'P', icon: 'polygon' },
  { id: 'line', label: 'Bleilinie', key: 'L', icon: 'line' },
];

export default function App() {
  const hist = useDesignHistory(() => loadStoredDesign() ?? defaultDesign());
  const { design, update, commit, undo, redo, reset } = hist;
  const [M, setM] = useState<ManifoldToplevel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [moreTools, setMoreTools] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [activeFill, setActiveFill] = useState<string>(() => design.palette.find((c) => c.id === 'c-blau')?.id ?? design.palette[0].id);
  const [grid, setGrid] = useState<GridSettings>({ on: true, size: 5 });
  const [magnet, setMagnet] = useState(true);
  const [showNumbers, setShowNumbers] = useState(true);
  const [showSeams, setShowSeams] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
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

  // keep the active colour valid
  useEffect(() => {
    if (!design.palette.some((c) => c.id === activeFill)) setActiveFill(design.palette[0].id);
  }, [design.palette, activeFill]);

  // drop selected ids that no longer exist (undo etc.)
  useEffect(() => {
    const ids = new Set(design.shapes.map((s) => s.id));
    if (selection.some((id) => !ids.has(id))) setSelection(selection.filter((id) => ids.has(id)));
  }, [design.shapes, selection]);

  // ---- 2D layout (main thread, once per animation frame)
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
  const geomKey = useMemo(() => JSON.stringify({ f: design.frame, s: design.shapes, fl: design.fills, p: design.params }), [design]);
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
  const selectedShapes = design.shapes.filter((s) => selection.includes(s.id));
  const deleteSelected = useCallback(() => {
    if (!selection.length) return;
    update((d) => ({ ...d, shapes: d.shapes.filter((s) => !selection.includes(s.id)) }));
    setSelection([]);
  }, [selection, update]);
  const duplicateSelected = useCallback(() => {
    const sel = design.shapes.filter((x) => selection.includes(x.id));
    if (!sel.length) return;
    // place the copy right next to the original (one lead width apart),
    // preferring a side where it still fits inside the window
    const box = unionBox(sel.map(shapeBounds));
    const g = design.params.leadWidth;
    const w = box.maxX - box.minX + g;
    const h = box.maxY - box.minY + g;
    const inner = frameInnerBox(design);
    const fits = (dx: number, dy: number) =>
      box.minX + dx >= inner.minX - 1 && box.maxX + dx <= inner.maxX + 1 && box.minY + dy >= inner.minY - 1 && box.maxY + dy <= inner.maxY + 1;
    const options: [number, number][] = [[w, 0], [0, -h], [-w, 0], [0, h]];
    const [dx, dy] = options.find(([x, y]) => fits(x, y)) ?? [w, 0];
    const copies = sel.map((s) => ({ ...moveShape(s, dx, dy), id: newId() }));
    update((d) => ({ ...d, shapes: [...d.shapes, ...copies] }));
    setSelection(copies.map((c) => c.id));
  }, [design, selection, update]);
  const pickColor = (id: string) => {
    setActiveFill(id);
    const blocks = selectedShapes.filter((s) => s.kind !== 'line');
    if (blocks.length) {
      const outlines = blocks.map((b) => cachedOutline(b)).filter(Boolean) as [number, number][][];
      update((d) => ({
        ...d,
        shapes: d.shapes.map((s) => (selection.includes(s.id) && s.kind !== 'line' ? { ...s, fill: id } : s)),
        fills: d.fills.filter((f) => !outlines.some((o) => pointInRings([f.x, f.y], [o]))),
      }));
    }
  };
  const align = (op: AlignOp) => update((d) => ({ ...d, shapes: alignShapes(d.shapes, selection, op, d.params.leadWidth) }));
  const doReorder = (op: 'up' | 'down' | 'top' | 'bottom') => update((d) => ({ ...d, shapes: reorder(d.shapes, selection, op) }));

  const saveDesign = () => download(JSON.stringify(design, null, 2), `${safeFileName(design.name)}.bleiglas.json`, 'application/json');
  const openDesign = (file: File) => {
    file.text().then((t) => {
      try {
        const d = migrateDesign(JSON.parse(t));
        if (!d) throw new Error('Unbekanntes Dateiformat');
        reset(d);
        setSelection([]);
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
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        saveDesign();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        setSelection(design.shapes.map((s) => s.id));
        return;
      }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && tool !== 'polygon' && tool !== 'frame') {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === 'Escape') {
        setSelection([]);
        if (tool !== 'polygon' && tool !== 'frame') setTool('select');
        return;
      }
      if (e.key.startsWith('Arrow') && selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
        update((d) => ({ ...d, shapes: d.shapes.map((s) => (selection.includes(s.id) ? moveShape(s, dx, dy) : s)) }));
        return;
      }
      const tl = [...MAIN_TOOLS, ...MORE_TOOLS].find((x) => x.key.toLowerCase() === k);
      if (tl) setTool(tl.id);
      if (e.key === '0') canvasRef.current?.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loadError) return <div className="fatal">Fehler beim Laden: {loadError}</div>;

  const toolBtn = (t: ToolDef) => (
    <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)} title={`${t.label} (Taste ${t.key})`}>
      {icons[t.icon]}
      <span className="tl">{t.label}</span>
    </button>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Bleiglas-Editor</div>
        <input className="doc-name" value={design.name} onChange={(e) => update({ ...design, name: e.target.value })} title="Name des Entwurfs" />
        <div className="tb-group">
          <button onClick={() => setShowTemplates(true)}>Neu</button>
          <button onClick={() => fileRef.current?.click()}>Öffnen</button>
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
          <button onClick={undo} disabled={!hist.canUndo} title="Strg+Z">↶ Rückgängig</button>
          <button onClick={redo} disabled={!hist.canRedo} title="Strg+Y">↷</button>
        </div>
        <div className="spacer" />
        <div className="tb-group seg">
          {(['2d', 'split', '3d'] as ViewMode[]).map((m) => (
            <button key={m} className={viewMode === m ? 'on' : ''} onClick={() => setViewMode(m)}>
              {m === '2d' ? 'Zeichnen' : m === '3d' ? '3D' : 'Beides'}
            </button>
          ))}
        </div>
        <div className="tb-group menu-wrap">
          <button onClick={() => setViewMenu(!viewMenu)}>Anzeige ▾</button>
          {viewMenu && (
            <div className="menu" onMouseLeave={() => setViewMenu(false)}>
              <label className="check">
                <input type="checkbox" checked={magnet} onChange={(e) => setMagnet(e.target.checked)} /> Magnetisch andocken
              </label>
              <label className="check">
                <input type="checkbox" checked={grid.on} onChange={(e) => setGrid({ ...grid, on: e.target.checked })} /> Raster
                <select value={grid.size} onChange={(e) => setGrid({ ...grid, size: Number(e.target.value) })} disabled={!grid.on}>
                  {[1, 2, 5, 10, 20].map((s) => (
                    <option key={s} value={s}>
                      {s} mm
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} /> Scheiben-Nummern
              </label>
              <label className="check">
                <input type="checkbox" checked={showSeams} onChange={(e) => setShowSeams(e.target.checked)} /> Teilung für den Drucker
              </label>
            </div>
          )}
        </div>
      </header>

      <div className="main">
        <nav className="toolbar">
          {MAIN_TOOLS.map(toolBtn)}
          <button className={`more-tools ${moreTools ? 'on' : ''}`} onClick={() => setMoreTools(!moreTools)} title="Weitere Werkzeuge">
            {icons.more}
            <span className="tl">Mehr</span>
          </button>
          {moreTools && MORE_TOOLS.map(toolBtn)}
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
                  magnet={magnet}
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
                  ['finished', 'So sieht es aus'],
                  ['print', 'Druckteile'],
                  ['exploded', 'Auseinander'],
                ] as [PreviewMode, string][]).map(([m, l]) => (
                  <button key={m} className={previewMode === m ? 'on' : ''} onClick={() => setPreviewMode(m)}>
                    {l}
                  </button>
                ))}
                {previewMode === 'finished' && (
                  <span className="light-ctl" title="Farbe und Helligkeit der Hintergrundbeleuchtung">
                    Licht
                    <input type="color" value={lightColor} onChange={(e) => setLightColor(e.target.value)} />
                    <input type="range" min={0} max={3} step={0.05} value={lightIntensity} onChange={(e) => setLightIntensity(parseFloat(e.target.value))} />
                  </span>
                )}
              </div>
              <Preview3D build={build} palette={design.palette} mode={previewMode} lightColor={lightColor} lightIntensity={lightIntensity} busy={busy} />
              <div className="pv-foot">Ziehen = drehen · Mausrad = Zoom · Rechte Maustaste = verschieben</div>
            </div>
          )}
        </div>

        <aside className="sidebar">
          <SelectionCard shapes={selectedShapes} update={update} onDelete={deleteSelected} onDuplicate={duplicateSelected} onAlign={align} onReorder={doReorder} />
          <ColorsCard design={design} update={update} activeFill={activeFill} onPickColor={pickColor} layout={layout} />
          <FrameCard design={design} update={update} commit={commit} onDrawFrame={() => setTool('frame')} />
          <LeadCard design={design} update={update} commit={commit} layout={layout} />
          <FinishCard design={design} layout={layout} build={build} ready={!buildStale} update={update} buildError={buildError} />
        </aside>
      </div>

      {showTemplates && (
        <TemplateDialog
          onClose={() => setShowTemplates(false)}
          onPick={(d) => {
            reset(d);
            setSelection([]);
            setShowTemplates(false);
            setTimeout(() => canvasRef.current?.fit(), 50);
          }}
        />
      )}
    </div>
  );
}
