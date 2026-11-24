import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import type { Layout, Rings } from '../geometry/layout2d';
import type { BuildOutput } from '../geometry/pipeline';
import { frameOutline, pointInRings } from '../geometry/shapes2d';
import { newId } from '../model/defaults';
import type { Updater } from '../model/history';
import type { Design, Shape, Vec2 } from '../model/types';
import { SOLID } from '../model/types';
import {
  anchorOf,
  cachedOutline,
  handlesFor,
  hitTest,
  moveShape,
  resizeShape,
  rot,
  snapGrid,
  snapToLines,
  type Tool,
} from './editGeom';

export interface GridSettings {
  on: boolean;
  size: number;
}

interface Props {
  design: Design;
  layout: Layout | null;
  build: BuildOutput | null;
  buildStale: boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: string | null;
  setSelection: (id: string | null) => void;
  activeFill: string;
  grid: GridSettings;
  showNumbers: boolean;
  showSeams: boolean;
  update: (u: Updater, transient?: boolean) => void;
  commit: () => void;
}

export interface CanvasHandle {
  fit: () => void;
}

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

type Drag =
  | { type: 'pan'; sx: number; sy: number; v: View }
  | { type: 'move'; id: string; start: Vec2; orig: Shape }
  | { type: 'handle'; id: string; handle: string; orig: Shape }
  | { type: 'rotate'; id: string; orig: Shape }
  | { type: 'create'; id: string; kind: Tool; start: Vec2 };

const ringsPath = (rings: Rings): string =>
  rings
    .map((r) => (r.length ? `M${r.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('L')}Z` : ''))
    .join('');

export const Canvas2D = forwardRef<CanvasHandle, Props>(function Canvas2D(props, ref) {
  const {
    design, layout, build, buildStale, tool, setTool, selection, setSelection, activeFill, grid, showNumbers, showSeams, update, commit,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ zoom: 1.5, panX: 400, panY: 300 });
  const drag = useRef<Drag | null>(null);
  const [polyPts, setPolyPts] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [altDown, setAltDown] = useState(false);

  const toWorld = useCallback(
    (sx: number, sy: number): Vec2 => [(sx - view.panX) / view.zoom, -(sy - view.panY) / view.zoom],
    [view],
  );
  const toScreen = useCallback((p: Vec2): Vec2 => [p[0] * view.zoom + view.panX, -p[1] * view.zoom + view.panY], [view]);

  const fit = useCallback(() => {
    const o = frameOutline(design.frame);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of o) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const w = maxX - minX || 100;
    const h = maxY - minY || 100;
    const zoom = Math.min((size.w - 60) / w, (size.h - 60) / h);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({ zoom, panX: size.w / 2 - cx * zoom, panY: size.h / 2 + cy * zoom });
  }, [design.frame, size]);

  useImperativeHandle(ref, () => ({ fit }), [fit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit once the size is known.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w > 100) {
      fitted.current = true;
      fit();
    }
  }, [size, fit]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => setAltDown(e.altKey);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', down);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', down);
    };
  }, []);

  // Cancel polygon drawing when switching tools.
  useEffect(() => {
    if (tool !== 'polygon' && tool !== 'frame') setPolyPts([]);
  }, [tool]);

  const snapOn = grid.on && !altDown;
  const snap = useCallback(
    (p: Vec2, opts?: { lines?: boolean; exclude?: string }): Vec2 => {
      if (opts?.lines && !altDown) {
        const q = snapToLines(design, p, 9 / view.zoom, opts.exclude);
        if (q) return q;
      }
      return snapOn ? snapGrid(p, grid.size) : p;
    },
    [design, view.zoom, snapOn, grid.size, altDown],
  );

  const selected = design.shapes.find((s) => s.id === selection) ?? null;
  const handles = useMemo(() => (selected ? handlesFor(selected, 22 / view.zoom) : []), [selected, view.zoom]);

  const setShape = (id: string, s: Shape, transient: boolean) =>
    update((d) => ({ ...d, shapes: d.shapes.map((x) => (x.id === id ? s : x)) }), transient);

  const finishPolygon = (pts: Vec2[]) => {
    if (pts.length >= 3) {
      if (tool === 'frame') {
        update((d) => ({ ...d, frame: { ...d.frame, kind: 'polygon', points: pts } }));
      } else {
        const id = newId();
        update((d) => ({ ...d, shapes: [...d.shapes, { id, kind: 'polygon', points: pts }] }));
        setSelection(id);
      }
      setTool('select');
    }
    setPolyPts([]);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = toWorld(sx, sy);
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);

    if (e.button === 1 || e.button === 2) {
      drag.current = { type: 'pan', sx, sy, v: view };
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'polygon' || tool === 'frame') {
      const p = snap(w);
      if (polyPts.length >= 3) {
        const first = toScreen(polyPts[0]);
        if (Math.hypot(first[0] - sx, first[1] - sy) < 10) {
          finishPolygon(polyPts);
          return;
        }
      }
      if (e.detail >= 2 && polyPts.length >= 3) {
        finishPolygon(polyPts);
        return;
      }
      setPolyPts([...polyPts, p]);
      return;
    }

    if (tool === 'fill') {
      if (!layout) return;
      const region = layout.regions.find((r) => pointInRings(w, r.rings));
      if (!region) return;
      update((d) => ({
        ...d,
        fills: [
          ...d.fills.filter((f) => !pointInRings([f.x, f.y], region.rings)),
          { id: newId('f'), x: w[0], y: w[1], fill: activeFill },
        ],
      }));
      return;
    }

    if (tool === 'select') {
      // Handles of the selected shape first.
      if (selected) {
        for (const h of handles) {
          const hp = toScreen(h.p);
          if (Math.hypot(hp[0] - sx, hp[1] - sy) <= 8) {
            if (h.kind === 'rotate') drag.current = { type: 'rotate', id: selected.id, orig: selected };
            else drag.current = { type: 'handle', id: selected.id, handle: h.id, orig: selected };
            return;
          }
        }
      }
      const tol = Math.max(design.params.leadWidth / 2, 6 / view.zoom);
      const hit = hitTest(design.shapes, w, tol);
      if (hit) {
        setSelection(hit.id);
        drag.current = { type: 'move', id: hit.id, start: w, orig: hit };
      } else {
        setSelection(null);
        drag.current = { type: 'pan', sx, sy, v: view };
      }
      return;
    }

    // Creation tools.
    const start = snap(w, { lines: tool === 'line' });
    const id = newId();
    let shape: Shape;
    if (tool === 'rect') shape = { id, kind: 'rect', x: start[0], y: start[1], w: 0, h: 0, r: 0, rotation: 0 };
    else if (tool === 'line') shape = { id, kind: 'line', a: start, b: start };
    else shape = { id, kind: 'ellipse', x: start[0], y: start[1], rx: 0, ry: 0, rotation: 0 };
    update((d) => ({ ...d, shapes: [...d.shapes, shape] }), true);
    setSelection(id);
    drag.current = { type: 'create', id, kind: tool, start };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = toWorld(sx, sy);
    setHover(w);
    const d = drag.current;
    if (!d) return;
    switch (d.type) {
      case 'pan':
        setView({ ...d.v, panX: d.v.panX + sx - d.sx, panY: d.v.panY + sy - d.sy });
        break;
      case 'move': {
        const a0 = anchorOf(d.orig);
        const target = snap([a0[0] + w[0] - d.start[0], a0[1] + w[1] - d.start[1]]);
        setShape(d.id, moveShape(d.orig, target[0] - a0[0], target[1] - a0[1]), true);
        break;
      }
      case 'handle': {
        const o = d.orig;
        if (o.kind === 'line') {
          const p = snap(w, { lines: true, exclude: o.id });
          setShape(d.id, d.handle === 'a' ? { ...o, a: p } : { ...o, b: p }, true);
        } else if (o.kind === 'polygon') {
          const i = Number(d.handle.slice(1));
          const p = snap(w);
          setShape(d.id, { ...o, points: o.points.map((q, k) => (k === i ? p : q)) }, true);
        } else {
          const p = o.rotation % 360 === 0 ? snap(w) : w;
          const keep = e.shiftKey || (o.kind === 'ellipse' && Math.abs(o.rx - o.ry) < 1e-6);
          setShape(d.id, resizeShape(o, d.handle, p, keep), true);
        }
        break;
      }
      case 'rotate': {
        const o = d.orig;
        if (o.kind !== 'rect' && o.kind !== 'ellipse') break;
        let ang = (Math.atan2(w[1] - o.y, w[0] - o.x) * 180) / Math.PI - 90;
        if (!e.altKey) ang = Math.round(ang / 15) * 15;
        ang = ((ang % 360) + 360) % 360;
        setShape(d.id, { ...o, rotation: ang }, true);
        break;
      }
      case 'create': {
        const p = snap(w, { lines: d.kind === 'line', exclude: d.id });
        const s = d.start;
        let shape: Shape;
        if (d.kind === 'rect') {
          shape = { id: d.id, kind: 'rect', x: (s[0] + p[0]) / 2, y: (s[1] + p[1]) / 2, w: Math.abs(p[0] - s[0]), h: Math.abs(p[1] - s[1]), r: 0, rotation: 0 };
        } else if (d.kind === 'ellipse') {
          shape = { id: d.id, kind: 'ellipse', x: (s[0] + p[0]) / 2, y: (s[1] + p[1]) / 2, rx: Math.abs(p[0] - s[0]) / 2, ry: Math.abs(p[1] - s[1]) / 2, rotation: 0 };
        } else if (d.kind === 'circle') {
          const r = Math.hypot(p[0] - s[0], p[1] - s[1]);
          shape = { id: d.id, kind: 'ellipse', x: s[0], y: s[1], rx: r, ry: r, rotation: 0 };
        } else {
          shape = { id: d.id, kind: 'line', a: s, b: p };
        }
        setShape(d.id, shape, true);
        break;
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.type === 'create') {
      // A plain click creates a default-sized shape.
      const cur = design.shapes.find((s) => s.id === d.id);
      if (cur) {
        let fixed: Shape | null = null;
        if (cur.kind === 'rect' && (cur.w < 2 || cur.h < 2)) fixed = { ...cur, w: 60, h: 40 };
        if (cur.kind === 'ellipse' && (cur.rx < 1 || cur.ry < 1)) fixed = d.kind === 'circle' ? { ...cur, rx: 30, ry: 30 } : { ...cur, rx: 40, ry: 25 };
        if (cur.kind === 'line' && Math.hypot(cur.b[0] - cur.a[0], cur.b[1] - cur.a[1]) < 2) fixed = { ...cur, b: [cur.a[0] + 60, cur.a[1]] };
        if (fixed) setShape(d.id, fixed, true);
      }
      commit();
      setTool('select');
      return;
    }
    if (d.type !== 'pan') commit();
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const zoom = Math.max(0.05, Math.min(60, view.zoom * k));
    const wx = (sx - view.panX) / view.zoom;
    const wy = (sy - view.panY) / view.zoom;
    setView({ zoom, panX: sx - wx * zoom, panY: sy - wy * zoom });
  };

  // Keyboard: finish polygon, delete etc. are handled in App; polygon here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((tool === 'polygon' || tool === 'frame') && polyPts.length) {
        if (e.key === 'Enter') finishPolygon(polyPts);
        if (e.key === 'Escape') setPolyPts([]);
        if (e.key === 'Backspace') setPolyPts(polyPts.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- rendering ----------
  const gridLines = useMemo(() => {
    if (!grid.on) return null;
    let step = grid.size;
    while (step * view.zoom < 7) step *= 5;
    const [x0, y1] = toWorld(0, 0);
    const [x1, y0] = toWorld(size.w, size.h);
    const minor: string[] = [];
    const major: string[] = [];
    const majorStep = step * 5;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const isMajor = Math.abs(x / majorStep - Math.round(x / majorStep)) < 1e-6;
      (isMajor ? major : minor).push(`M${x},${y0}V${y1}`);
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const isMajor = Math.abs(y / majorStep - Math.round(y / majorStep)) < 1e-6;
      (isMajor ? major : minor).push(`M${x0},${y}H${x1}`);
    }
    return { minor: minor.join(''), major: major.join('') };
  }, [grid, view, size, toWorld]);

  const colorOf = (id: string) => design.palette.find((c) => c.id === id)?.hex ?? '#cccccc';
  const viewTransform = `matrix(${view.zoom},0,0,${-view.zoom},${view.panX},${view.panY})`;

  const cursor =
    tool === 'select' ? (drag.current?.type === 'pan' ? 'grabbing' : 'default') : tool === 'fill' ? 'cell' : 'crosshair';

  const fillPreview = activeFill === SOLID ? '#9aa1a9' : colorOf(activeFill);

  return (
    <div className="canvas2d" ref={wrapRef}>
      <svg
        width={size.w}
        height={size.h}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <linearGradient id="leadGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d9dde2" />
            <stop offset="0.5" stopColor="#a7aeb6" />
            <stop offset="1" stopColor="#cfd4d9" />
          </linearGradient>
          <clipPath id="frameClip">
            <path d={ringsPath([frameOutline(design.frame)])} />
          </clipPath>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#d64545" strokeWidth="2" />
          </pattern>
        </defs>
        <g transform={viewTransform}>
          {gridLines && (
            <>
              <path d={gridLines.minor} stroke="#e3e6ea" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
              <path d={gridLines.major} stroke="#cfd4da" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
            </>
          )}
          {layout && (
            <>
              {layout.panes.map((p) => (
                <path key={`p${p.index}`} d={ringsPath(p.opening)} fill={colorOf(p.fill)} fillOpacity={0.85} fillRule="evenodd" />
              ))}
              <path d={ringsPath(layout.lead)} fill="url(#leadGrad)" stroke="#6b7480" strokeWidth={0.6} vectorEffect="non-scaling-stroke" fillRule="evenodd" />
              {layout.slivers.length > 0 && <path d={ringsPath(layout.slivers)} fill="url(#hatch)" fillOpacity={0.5} fillRule="evenodd" />}
              {layout.islands.map((r, i) => (
                <path key={`i${i}`} d={ringsPath(r)} fill="none" stroke="#e67e22" strokeWidth={2.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
              ))}
            </>
          )}
          {!layout && <path d={ringsPath([frameOutline(design.frame)])} fill="#eee" stroke="#999" vectorEffect="non-scaling-stroke" />}
          {/* design lines */}
          {design.shapes.map((s) => {
            const isSel = s.id === selection;
            const stroke = isSel ? '#1f6feb' : 'rgba(40,60,90,0.35)';
            const sw = isSel ? 1.6 : 1;
            if (s.kind === 'line') {
              return <line key={s.id} x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} stroke={stroke} strokeWidth={sw} strokeDasharray={isSel ? undefined : '4 3'} vectorEffect="non-scaling-stroke" />;
            }
            const o = cachedOutline(s);
            if (!o) return null;
            return <path key={s.id} d={ringsPath([o])} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={isSel ? undefined : '4 3'} vectorEffect="non-scaling-stroke" />;
          })}
          {showSeams && build && (
            <g opacity={buildStale ? 0.35 : 1} clipPath="url(#frameClip)">
              {build.seams.map((s, i) => (
                <polyline key={`s${i}`} points={s.map((p) => p.join(',')).join(' ')} fill="none" stroke="#d63384" strokeWidth={1.6} strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {polyPts.length > 0 && (
            <polyline
              points={[...polyPts, ...(hover ? [snap(hover)] : [])].map((p) => p.join(',')).join(' ')}
              fill="rgba(31,111,235,0.08)"
              stroke="#1f6feb"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
        {/* screen-space overlay */}
        {layout && showNumbers && view.zoom > 0.6 &&
          layout.panes.map((p) => {
            const [x, y] = toScreen(p.label);
            return (
              <text key={`n${p.index}`} x={x} y={y} className="pane-num" textAnchor="middle" dominantBaseline="central">
                {p.index}
              </text>
            );
          })}
        {showSeams && build && !buildStale && build.cells.length > 1 &&
          build.pieces.map((pc) => {
            const c: Vec2 = [(pc.min[0] + pc.max[0]) / 2, (pc.min[1] + pc.max[1]) / 2];
            const [x, y] = toScreen(c);
            return (
              <text key={`c${pc.label}`} x={x} y={y + 16} className={pc.fits ? 'piece-label' : 'piece-label bad'} textAnchor="middle">
                {pc.label}
              </text>
            );
          })}
        {handles.map((h) => {
          const [x, y] = toScreen(h.p);
          if (h.kind === 'rotate') return <circle key={h.id} cx={x} cy={y} r={6} className="handle rot" />;
          return <rect key={h.id} x={x - 5} y={y - 5} width={10} height={10} className={`handle ${h.kind}`} />;
        })}
        {selected && (selected.kind === 'rect' || selected.kind === 'ellipse') && (() => {
          const top = rot([0, (selected.kind === 'rect' ? Math.abs(selected.h) / 2 : Math.abs(selected.ry))], selected.rotation);
          const a = toScreen([selected.x + top[0], selected.y + top[1]]);
          const b = handles.find((h) => h.id === 'rot');
          if (!b) return null;
          const bs = toScreen(b.p);
          return <line x1={a[0]} y1={a[1]} x2={bs[0]} y2={bs[1]} stroke="#1f6feb" strokeWidth={1} pointerEvents="none" />;
        })()}
        {tool === 'fill' && hover && (() => {
          const [x, y] = toScreen(hover);
          return <circle cx={x + 12} cy={y + 12} r={7} fill={fillPreview} stroke="#333" strokeWidth={1} pointerEvents="none" />;
        })()}
      </svg>
      <div className="canvas-status">
        {hover && (
          <span>
            x {hover[0].toFixed(1)} · y {hover[1].toFixed(1)} mm
          </span>
        )}
        {(tool === 'polygon' || tool === 'frame') && (
          <span className="hint">Klicken = Punkt setzen · Doppelklick / Enter = schließen · Esc = abbrechen</span>
        )}
        {tool === 'fill' && <span className="hint">Fläche anklicken, um sie zu färben</span>}
      </div>
      <div className="zoom-ctl">
        <button onClick={() => setView((v) => ({ ...v, zoom: v.zoom * 1.25, panX: size.w / 2 - (size.w / 2 - v.panX) * 1.25, panY: size.h / 2 - (size.h / 2 - v.panY) * 1.25 }))} title="Vergrößern">+</button>
        <button onClick={() => setView((v) => ({ ...v, zoom: v.zoom / 1.25, panX: size.w / 2 - (size.w / 2 - v.panX) / 1.25, panY: size.h / 2 - (size.h / 2 - v.panY) / 1.25 }))} title="Verkleinern">−</button>
        <button onClick={fit} title="Ganzes Fenster zeigen">⤢</button>
      </div>
    </div>
  );
});
