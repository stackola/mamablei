import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Layout, Rings } from '../geometry/layout2d';
import type { BuildOutput } from '../geometry/pipeline';
import { frameOutline, pointInRings } from '../geometry/shapes2d';
import { newId } from '../model/defaults';
import type { Updater } from '../model/history';
import type { BlockShape, Design, Shape, Vec2 } from '../model/types';
import { isBlock } from '../model/types';
import {
  cachedOutline,
  edgeTargets,
  frameInnerBox,
  handlesFor,
  hitTest,
  isBoxShape,
  magneticSnap,
  moveShape,
  resizeShape,
  rot,
  shapeBounds,
  snapGrid,
  snapToLines,
  snapValue,
  unionBox,
  type Box,
  type Guide,
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
  selection: string[];
  setSelection: (ids: string[]) => void;
  activeFill: string;
  grid: GridSettings;
  magnet: boolean;
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
  | { type: 'marquee'; start: Vec2; add: boolean }
  | { type: 'move'; ids: string[]; start: Vec2; orig: Shape[] }
  | { type: 'handle'; id: string; handle: string; orig: Shape }
  | { type: 'rotate'; id: string; orig: Shape }
  | { type: 'create'; id: string; kind: Tool; start: Vec2 };

const ringsPath = (rings: Rings): string =>
  rings.map((r) => (r.length ? `M${r.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('L')}Z` : '')).join('');

const BOX_TOOLS: Tool[] = ['rect', 'circle', 'ellipse', 'triangle', 'hexagon', 'arch', 'halfcircle', 'line'];

export const Canvas2D = forwardRef<CanvasHandle, Props>(function Canvas2D(props, ref) {
  const {
    design, layout, build, buildStale, tool, setTool, selection, setSelection, activeFill, grid, magnet, showNumbers, showSeams, update, commit,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ zoom: 1.5, panX: 400, panY: 300 });
  const drag = useRef<Drag | null>(null);
  const [polyPts, setPolyPts] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [mods, setMods] = useState({ alt: false, space: false });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [dragging, setDragging] = useState(false);

  const toWorld = useCallback((sx: number, sy: number): Vec2 => [(sx - view.panX) / view.zoom, -(sy - view.panY) / view.zoom], [view]);
  const toScreen = useCallback((p: Vec2): Vec2 => [p[0] * view.zoom + view.panX, -p[1] * view.zoom + view.panY], [view]);

  const fit = useCallback(() => {
    const o = frameOutline(design.frame);
    const xs = o.map((p) => p[0]);
    const ys = o.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const zoom = Math.min((size.w - 80) / (maxX - minX || 100), (size.h - 80) / (maxY - minY || 100));
    setView({ zoom, panX: size.w / 2 - ((minX + maxX) / 2) * zoom, panY: size.h / 2 + ((minY + maxY) / 2) * zoom });
  }, [design.frame, size]);

  const userMoved = useRef(false);
  useImperativeHandle(ref, () => ({
    fit: () => {
      userMoved.current = false;
      fit();
    },
  }), [fit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      // keep the drawing centred when the panel changes size
      setView((v) => ({ ...v, panX: v.panX + (next.w - last.w) / 2, panY: v.panY + (next.h - last.h) / 2 }));
      last = next;
      setSize(next);
    });
    ro.observe(el);
    setSize(last);
    return () => ro.disconnect();
  }, []);

  // Auto-fit until the user pans or zooms by hand.
  useEffect(() => {
    if (!userMoved.current && size.w > 100) fit();
  }, [size, fit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (e.code === 'Space' && !typing) {
        if (e.type === 'keydown') e.preventDefault();
        setMods((m) => ({ ...m, space: e.type === 'keydown' }));
      }
      setMods((m) => (m.alt === e.altKey ? m : { ...m, alt: e.altKey }));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  useEffect(() => {
    if (tool !== 'polygon' && tool !== 'frame') setPolyPts([]);
  }, [tool]);

  const snapOn = grid.on && !mods.alt;
  const snap = useCallback(
    (p: Vec2, opts?: { lines?: boolean; exclude?: string }): Vec2 => {
      if (opts?.lines && !mods.alt) {
        const q = snapToLines(design, p, 9 / view.zoom, opts.exclude);
        if (q) return q;
      }
      return snapOn ? snapGrid(p, grid.size) : p;
    },
    [design, view.zoom, snapOn, grid.size, mods.alt],
  );

  const selectedShapes = design.shapes.filter((s) => selection.includes(s.id));
  const single = selectedShapes.length === 1 ? selectedShapes[0] : null;
  const handles = useMemo(() => (single ? handlesFor(single, 24 / view.zoom) : []), [single, view.zoom]);
  const inner = useMemo(() => frameInnerBox(design), [design]);
  const gap = design.params.leadWidth;

  const setShapes = (map: Map<string, Shape>, transient: boolean) =>
    update((d) => ({ ...d, shapes: d.shapes.map((x) => map.get(x.id) ?? x) }), transient);
  const setShape = (id: string, s: Shape, transient: boolean) => setShapes(new Map([[id, s]]), transient);

  const finishPolygon = (pts: Vec2[]) => {
    if (pts.length >= 3) {
      if (tool === 'frame') {
        update((d) => ({ ...d, frame: { ...d.frame, kind: 'polygon', points: pts } }));
      } else {
        const id = newId();
        update((d) => ({ ...d, shapes: [...d.shapes, { id, kind: 'polygon', points: pts, fill: activeFill }] }));
        setSelection([id]);
      }
      setTool('select');
    }
    setPolyPts([]);
  };

  const paintAt = (w: Vec2) => {
    const pane = layout?.panes.find((p) => pointInRings(w, p.opening));
    const block = pane
      ? design.shapes.find((s) => s.id === pane.blockId)
      : (hitTest(design.shapes.filter(isBlock), w, 0) as BlockShape | null);
    if (!block || block.kind === 'line') return;
    if (pane && pane.split) {
      // only this part of a block that lead lines split up
      update((d) => ({
        ...d,
        fills: [...d.fills.filter((f) => !pointInRings([f.x, f.y], pane.opening)), { id: newId('f'), x: w[0], y: w[1], fill: activeFill }],
      }));
      return;
    }
    const outline = cachedOutline(block);
    update((d) => ({
      ...d,
      shapes: d.shapes.map((s) => (s.id === block.id && s.kind !== 'line' ? { ...s, fill: activeFill } : s)),
      fills: outline ? d.fills.filter((f) => !pointInRings([f.x, f.y], [outline])) : d.fills,
    }));
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = toWorld(sx, sy);
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    setDragging(true);

    if (e.button === 1 || e.button === 2 || mods.space) {
      userMoved.current = true;
      drag.current = { type: 'pan', sx, sy, v: view };
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'polygon' || tool === 'frame') {
      const p = snap(w);
      if (polyPts.length >= 3) {
        const first = toScreen(polyPts[0]);
        if (Math.hypot(first[0] - sx, first[1] - sy) < 10 || e.detail >= 2) {
          finishPolygon(polyPts);
          return;
        }
      }
      setPolyPts([...polyPts, p]);
      return;
    }

    if (tool === 'fill') {
      paintAt(w);
      return;
    }

    if (tool === 'select') {
      if (single) {
        for (const h of handles) {
          const hp = toScreen(h.p);
          if (Math.hypot(hp[0] - sx, hp[1] - sy) <= 9) {
            drag.current = h.kind === 'rotate' ? { type: 'rotate', id: single.id, orig: single } : { type: 'handle', id: single.id, handle: h.id, orig: single };
            return;
          }
        }
      }
      const tol = Math.max(gap / 2, 6 / view.zoom);
      const hit = hitTest(design.shapes, w, tol);
      if (hit) {
        let ids = selection;
        if (e.shiftKey) {
          ids = selection.includes(hit.id) ? selection.filter((x) => x !== hit.id) : [...selection, hit.id];
          setSelection(ids);
        } else if (!selection.includes(hit.id)) {
          ids = [hit.id];
          setSelection(ids);
        }
        if (ids.includes(hit.id)) {
          drag.current = { type: 'move', ids, start: w, orig: design.shapes.filter((s) => ids.includes(s.id)) };
        }
      } else {
        if (!e.shiftKey) setSelection([]);
        drag.current = { type: 'marquee', start: w, add: e.shiftKey };
      }
      return;
    }

    // Creation tools.
    const start = snap(w, { lines: tool === 'line' });
    const id = newId();
    let shape: Shape;
    const fill = activeFill;
    const at = { x: start[0], y: start[1], rotation: 0, fill };
    switch (tool) {
      case 'rect':
        shape = { id, kind: 'rect', ...at, w: 0, h: 0, r: 0 };
        break;
      case 'triangle':
        shape = { id, kind: 'ngon', ...at, rx: 0, ry: 0, sides: 3 };
        break;
      case 'hexagon':
        shape = { id, kind: 'ngon', ...at, rx: 0, ry: 0, sides: 6 };
        break;
      case 'arch':
      case 'halfcircle':
        shape = { id, kind: 'arch', ...at, w: 0, h: 0, style: 'round' };
        break;
      case 'line':
        shape = { id, kind: 'line', a: start, b: start };
        break;
      default:
        shape = { id, kind: 'ellipse', ...at, rx: 0, ry: 0 };
    }
    update((d) => ({ ...d, shapes: [...d.shapes, shape] }), true);
    setSelection([id]);
    drag.current = { type: 'create', id, kind: tool, start };
  };

  const otherBoxes = (exclude: string[]) =>
    design.shapes.filter((s) => isBlock(s) && !exclude.includes(s.id)).map(shapeBounds);

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = toWorld(sx, sy);
    setHover(w);
    const d = drag.current;
    if (!d) return;
    const tol = 8 / view.zoom;
    switch (d.type) {
      case 'pan':
        setView({ ...d.v, panX: d.v.panX + sx - d.sx, panY: d.v.panY + sy - d.sy });
        break;
      case 'marquee':
        setMarquee({ minX: Math.min(d.start[0], w[0]), maxX: Math.max(d.start[0], w[0]), minY: Math.min(d.start[1], w[1]), maxY: Math.max(d.start[1], w[1]) });
        break;
      case 'move': {
        let dx = w[0] - d.start[0];
        let dy = w[1] - d.start[1];
        const box = unionBox(d.orig.map(shapeBounds));
        const moved: Box = { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy };
        let snapped = { dx: 0, dy: 0, guides: [] as Guide[] };
        if (magnet && !mods.alt) snapped = magneticSnap(moved, otherBoxes(d.ids), inner, gap, tol);
        const gx = snapped.guides.some((g) => g.axis === 'x');
        const gy = snapped.guides.some((g) => g.axis === 'y');
        dx += snapped.dx;
        dy += snapped.dy;
        if (snapOn) {
          // grid-snap the remaining axis by the box corner
          if (!gx) dx = Math.round((box.minX + dx) / grid.size) * grid.size - box.minX;
          if (!gy) dy = Math.round((box.minY + dy) / grid.size) * grid.size - box.minY;
        }
        setGuides(snapped.guides);
        setShapes(new Map(d.orig.map((s) => [s.id, moveShape(s, dx, dy)])), true);
        break;
      }
      case 'handle': {
        const o = d.orig;
        if (o.kind === 'line') {
          setShape(d.id, d.handle === 'a' ? { ...o, a: snap(w, { lines: true, exclude: o.id }) } : { ...o, b: snap(w, { lines: true, exclude: o.id }) }, true);
        } else if (o.kind === 'polygon') {
          const i = Number(d.handle.slice(1));
          setShape(d.id, { ...o, points: o.points.map((q, k) => (k === i ? snap(w) : q)) }, true);
        } else if (isBoxShape(o)) {
          let p: Vec2 = w;
          const g: Guide[] = [];
          if (o.rotation % 360 === 0) {
            p = snapOn ? snapGrid(w, grid.size) : w;
            if (magnet && !mods.alt) {
              const t = edgeTargets(otherBoxes([o.id]), inner, gap);
              const vx = snapValue(w[0], t.xs, tol);
              const vy = snapValue(w[1], t.ys, tol);
              if (vx !== null) {
                p = [vx, p[1]];
                g.push({ axis: 'x', v: vx, from: w[1] - 40, to: w[1] + 40 });
              }
              if (vy !== null) {
                p = [p[0], vy];
                g.push({ axis: 'y', v: vy, from: w[0] - 40, to: w[0] + 40 });
              }
            }
          }
          setGuides(g);
          const keep = e.shiftKey || (o.kind === 'ellipse' && Math.abs(o.rx - o.ry) < 1e-6);
          setShape(d.id, resizeShape(o, d.handle, p, keep), true);
        }
        break;
      }
      case 'rotate': {
        const o = d.orig;
        if (!isBoxShape(o)) break;
        let ang = (Math.atan2(w[1] - o.y, w[0] - o.x) * 180) / Math.PI - 90;
        if (!e.altKey) ang = Math.round(ang / 15) * 15;
        ang = ((ang % 360) + 360) % 360;
        setShape(d.id, { ...o, rotation: ang }, true);
        break;
      }
      case 'create': {
        const s = d.start;
        let p = snap(w, { lines: d.kind === 'line', exclude: d.id });
        const cur = design.shapes.find((x) => x.id === d.id);
        if (!cur) break;
        if (d.kind === 'line') {
          setShape(d.id, { ...(cur as Extract<Shape, { kind: 'line' }>), b: p }, true);
          break;
        }
        if (d.kind === 'circle') {
          const r = Math.hypot(p[0] - s[0], p[1] - s[1]);
          setShape(d.id, { ...(cur as BlockShape), kind: 'ellipse', x: s[0], y: s[1], rx: r, ry: r } as Shape, true);
          break;
        }
        if (e.shiftKey || d.kind === 'halfcircle') {
          // keep proportions: square box (half circle: 2:1)
          const ratio = d.kind === 'halfcircle' ? 0.5 : 1;
          const wdt = Math.max(Math.abs(p[0] - s[0]), Math.abs(p[1] - s[1]) / ratio);
          p = [s[0] + Math.sign(p[0] - s[0] || 1) * wdt, s[1] + Math.sign(p[1] - s[1] || 1) * wdt * ratio];
        }
        const x = (s[0] + p[0]) / 2;
        const y = (s[1] + p[1]) / 2;
        const bw = Math.abs(p[0] - s[0]);
        const bh = Math.abs(p[1] - s[1]);
        let next: Shape;
        if (cur.kind === 'rect' || cur.kind === 'arch') next = { ...cur, x, y, w: bw, h: bh };
        else if (cur.kind === 'ellipse' || cur.kind === 'ngon') next = { ...cur, x, y, rx: bw / 2, ry: bh / 2 };
        else break;
        setShape(d.id, next, true);
        break;
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setGuides([]);
    if (!d) return;
    if (d.type === 'marquee') {
      const m = marquee;
      setMarquee(null);
      if (m) {
        const hits = design.shapes
          .filter((s) => {
            const b = shapeBounds(s);
            return b.maxX >= m.minX && b.minX <= m.maxX && b.maxY >= m.minY && b.minY <= m.maxY;
          })
          .map((s) => s.id);
        setSelection(d.add ? [...new Set([...selection, ...hits])] : hits);
      }
      return;
    }
    if (d.type === 'create') {
      const cur = design.shapes.find((s) => s.id === d.id);
      if (cur) {
        // A plain click creates a default-sized shape.
        const D = 60;
        let fixed: Shape | null = null;
        if ((cur.kind === 'rect' || cur.kind === 'arch') && (cur.w < 3 || cur.h < 3)) {
          fixed = { ...cur, w: D, h: d.kind === 'halfcircle' ? D / 2 : d.kind === 'arch' ? D * 1.5 : D * 0.7 };
        }
        if ((cur.kind === 'ellipse' || cur.kind === 'ngon') && (cur.rx < 1.5 || cur.ry < 1.5)) {
          fixed = d.kind === 'ellipse' ? { ...cur, rx: D / 2, ry: D / 3 } : { ...cur, rx: D / 2, ry: cur.kind === 'ngon' && cur.sides === 6 ? D / Math.sqrt(3) : D / 2 };
        }
        if (cur.kind === 'line' && Math.hypot(cur.b[0] - cur.a[0], cur.b[1] - cur.a[1]) < 2) fixed = { ...cur, b: [cur.a[0] + D, cur.a[1]] };
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
    userMoved.current = true;
    const k = Math.exp(-e.deltaY * 0.0015);
    const zoom = Math.max(0.05, Math.min(60, view.zoom * k));
    const wx = (sx - view.panX) / view.zoom;
    const wy = (sy - view.panY) / view.zoom;
    setView({ zoom, panX: sx - wx * zoom, panY: sy - wy * zoom });
  };

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

  // ---------- rendering
  const gridLines = useMemo(() => {
    if (!grid.on) return null;
    let step = grid.size;
    while (step * view.zoom < 8) step *= 5;
    const [x0, y1] = toWorld(0, 0);
    const [x1, y0] = toWorld(size.w, size.h);
    const minor: string[] = [];
    const major: string[] = [];
    const majorStep = step * 5;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      (Math.abs(x / majorStep - Math.round(x / majorStep)) < 1e-6 ? major : minor).push(`M${x},${y0}V${y1}`);
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      (Math.abs(y / majorStep - Math.round(y / majorStep)) < 1e-6 ? major : minor).push(`M${x0},${y}H${x1}`);
    }
    return { minor: minor.join(''), major: major.join('') };
  }, [grid, view, size, toWorld]);

  const colorOf = (id: string) => design.palette.find((c) => c.id === id)?.hex ?? '#cccccc';
  const viewTransform = `matrix(${view.zoom},0,0,${-view.zoom},${view.panX},${view.panY})`;
  const hoverShape = !dragging && hover && (tool === 'select' || tool === 'fill') ? hitTest(design.shapes, hover, Math.max(gap / 2, 6 / view.zoom)) : null;
  const cursor = mods.space || drag.current?.type === 'pan' ? 'grab' : tool === 'select' ? (hoverShape ? 'move' : 'default') : tool === 'fill' ? 'cell' : 'crosshair';
  const noBlocks = !design.shapes.some(isBlock);

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
            <stop offset="0" stopColor="#dfe3e8" />
            <stop offset="0.5" stopColor="#aab1b9" />
            <stop offset="1" stopColor="#d3d8dd" />
          </linearGradient>
          <clipPath id="frameClip">
            <path d={ringsPath([frameOutline(design.frame)])} />
          </clipPath>
        </defs>
        <g transform={viewTransform}>
          {gridLines && (
            <>
              <path d={gridLines.minor} stroke="#e6e9ed" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
              <path d={gridLines.major} stroke="#d2d7dd" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
            </>
          )}
          {layout ? (
            <>
              <path d={ringsPath(layout.lead)} fill="url(#leadGrad)" stroke="#6b7480" strokeWidth={0.6} vectorEffect="non-scaling-stroke" fillRule="evenodd" />
              {layout.panes.map((p) => (
                <path key={`p${p.index}`} d={ringsPath(p.opening)} fill={colorOf(p.fill)} fillOpacity={0.9} fillRule="evenodd" />
              ))}
            </>
          ) : (
            <path d={ringsPath([frameOutline(design.frame)])} fill="#ddd" stroke="#999" vectorEffect="non-scaling-stroke" />
          )}
          {/* block outlines */}
          {design.shapes.map((s) => {
            const isSel = selection.includes(s.id);
            const isHover = hoverShape?.id === s.id;
            if (!isSel && !isHover) return null;
            const stroke = isSel ? '#1f6feb' : 'rgba(31,111,235,0.6)';
            if (s.kind === 'line') {
              return <line key={s.id} x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
            }
            const o = cachedOutline(s);
            return o ? <path key={s.id} d={ringsPath([o])} fill="none" stroke={stroke} strokeWidth={isSel ? 2 : 1.5} strokeDasharray={isSel ? undefined : '5 3'} vectorEffect="non-scaling-stroke" /> : null;
          })}
          {/* lines are always visible as thin centre lines */}
          {design.shapes.map((s) =>
            s.kind === 'line' && !selection.includes(s.id) ? (
              <line key={`l${s.id}`} x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} stroke="rgba(40,60,90,0.3)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            ) : null,
          )}
          {showSeams && build && build.seams.length > 0 && (
            <g opacity={buildStale ? 0.3 : 0.9} clipPath="url(#frameClip)">
              {build.seams.map((s, i) => (
                <polyline key={`s${i}`} points={s.map((p) => p.join(',')).join(' ')} fill="none" stroke="#d63384" strokeWidth={1.5} strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {guides.map((g, i) =>
            g.axis === 'x' ? (
              <line key={`g${i}`} x1={g.v} y1={g.from} x2={g.v} y2={g.to} stroke="#ff2d95" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ) : (
              <line key={`g${i}`} x1={g.from} y1={g.v} x2={g.to} y2={g.v} stroke="#ff2d95" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ),
          )}
          {marquee && (
            <rect x={marquee.minX} y={marquee.minY} width={marquee.maxX - marquee.minX} height={marquee.maxY - marquee.minY} fill="rgba(31,111,235,0.08)" stroke="#1f6feb" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          )}
          {polyPts.length > 0 && (
            <polyline
              points={[...polyPts, ...(hover ? [snap(hover)] : [])].map((p) => p.join(',')).join(' ')}
              fill="rgba(31,111,235,0.1)"
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
            const [x, y] = toScreen([(pc.min[0] + pc.max[0]) / 2, (pc.min[1] + pc.max[1]) / 2]);
            return (
              <text key={`c${pc.label}`} x={x} y={y + 16} className={pc.fits ? 'piece-label' : 'piece-label bad'} textAnchor="middle">
                {pc.label}
              </text>
            );
          })}
        {handles.map((h) => {
          const [x, y] = toScreen(h.p);
          if (h.kind === 'rotate') return <circle key={h.id} cx={x} cy={y} r={7} className="handle rot" />;
          return <rect key={h.id} x={x - 6} y={y - 6} width={12} height={12} rx={2} className={`handle ${h.kind}`} />;
        })}
        {single && isBoxShape(single) && (() => {
          const top = rot([0, single.kind === 'rect' || single.kind === 'arch' ? Math.abs(single.h) / 2 : Math.abs(single.ry)], single.rotation);
          const a = toScreen([single.x + top[0], single.y + top[1]]);
          const b = handles.find((h) => h.id === 'rot');
          if (!b) return null;
          const bs = toScreen(b.p);
          return <line x1={a[0]} y1={a[1]} x2={bs[0]} y2={bs[1]} stroke="#1f6feb" strokeWidth={1} pointerEvents="none" />;
        })()}
        {tool === 'fill' && hover && (() => {
          const [x, y] = toScreen(hover);
          return <circle cx={x + 14} cy={y + 14} r={8} fill={colorOf(activeFill)} stroke="#333" strokeWidth={1} pointerEvents="none" />;
        })()}
      </svg>
      {noBlocks && tool === 'select' && (
        <div className="canvas-empty">
          <b>Los geht's!</b>
          <span>Links eine Form wählen (z. B. Rechteck) und im Fenster aufziehen.</span>
        </div>
      )}
      <div className="canvas-status">
        {hover && (
          <span>
            {hover[0].toFixed(0)} / {hover[1].toFixed(0)} mm
          </span>
        )}
        {BOX_TOOLS.includes(tool) && <span className="hint">Ziehen = Form aufziehen · Klick = Standardgröße · Shift = Proportionen</span>}
        {(tool === 'polygon' || tool === 'frame') && <span className="hint">Punkte anklicken · Doppelklick = fertig · Esc = abbrechen</span>}
        {tool === 'fill' && <span className="hint">Scheibe anklicken, um sie einzufärben</span>}
        {tool === 'select' && !noBlocks && <span className="hint">Leertaste + Ziehen = Ansicht verschieben · Mausrad = Zoom</span>}
      </div>
      <div className="zoom-ctl">
        <button onClick={() => (userMoved.current = true) && setView((v) => ({ zoom: v.zoom * 1.25, panX: size.w / 2 - (size.w / 2 - v.panX) * 1.25, panY: size.h / 2 - (size.h / 2 - v.panY) * 1.25 }))} title="Vergrößern">+</button>
        <button onClick={() => (userMoved.current = true) && setView((v) => ({ zoom: v.zoom / 1.25, panX: size.w / 2 - (size.w / 2 - v.panX) / 1.25, panY: size.h / 2 - (size.h / 2 - v.panY) / 1.25 }))} title="Verkleinern">−</button>
        <button
          onClick={() => {
            userMoved.current = false;
            fit();
          }}
          title="Ganzes Fenster zeigen"
        >
          ⤢
        </button>
      </div>
    </div>
  );
});
