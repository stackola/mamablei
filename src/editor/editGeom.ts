// Helpers for interactive editing: hit tests, handles, resize, snapping,
// align & distribute.
import { shapeOutline, frameOutline, pointInRings } from '../geometry/shapes2d';
import type { BlockShape, Design, Shape, Vec2 } from '../model/types';

export type Tool =
  | 'select'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'hexagon'
  | 'arch'
  | 'halfcircle'
  | 'polygon'
  | 'line'
  | 'fill'
  | 'frame';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const outlineCache = new WeakMap<Shape, Vec2[] | null>();
export function cachedOutline(s: Shape): Vec2[] | null {
  if (!outlineCache.has(s)) outlineCache.set(s, shapeOutline(s));
  return outlineCache.get(s)!;
}

export function rot(p: Vec2, deg: number): Vec2 {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

export function distToSeg(p: Vec2, a: Vec2, b: Vec2): { d: number; q: Vec2 } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

function distToRing(p: Vec2, ring: Vec2[]): { d: number; q: Vec2 } {
  let best = { d: Infinity, q: p };
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const r = distToSeg(p, ring[j], ring[i]);
    if (r.d < best.d) best = r;
  }
  return best;
}

/** Lines near p first, then the topmost block containing p. */
export function hitTest(shapes: Shape[], p: Vec2, tol: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.kind === 'line' && distToSeg(p, s.a, s.b).d <= tol) return s;
  }
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.kind === 'line') continue;
    const o = cachedOutline(s);
    if (o && (pointInRings(p, [o]) || distToRing(p, o).d <= tol * 0.5)) return s;
  }
  return null;
}

export interface Handle {
  id: string;
  p: Vec2;
  kind: 'resize' | 'rotate' | 'vertex' | 'end';
}

/** Local half extents for box-like shapes. */
export function halfExtents(s: Shape): [number, number] {
  switch (s.kind) {
    case 'rect':
    case 'arch':
      return [Math.abs(s.w) / 2, Math.abs(s.h) / 2];
    case 'ellipse':
    case 'ngon':
      return [Math.abs(s.rx), Math.abs(s.ry)];
    default:
      return [0, 0];
  }
}

export function isBoxShape(s: Shape): s is Extract<BlockShape, { rotation: number }> {
  return s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'ngon' || s.kind === 'arch';
}

export function handlesFor(s: Shape, rotOffset: number): Handle[] {
  if (s.kind === 'line') {
    return [
      { id: 'a', p: s.a, kind: 'end' },
      { id: 'b', p: s.b, kind: 'end' },
    ];
  }
  if (s.kind === 'polygon') {
    return s.points.map((p, i) => ({ id: `v${i}`, p, kind: 'vertex' as const }));
  }
  const [hx, hy] = halfExtents(s);
  const out: Handle[] = [];
  for (const sx of [-1, 0, 1]) {
    for (const sy of [-1, 0, 1]) {
      if (!sx && !sy) continue;
      const l = rot([sx * hx, sy * hy], s.rotation);
      out.push({ id: `${sx},${sy}`, p: [s.x + l[0], s.y + l[1]], kind: 'resize' });
    }
  }
  const r = rot([0, hy + rotOffset], s.rotation);
  out.push({ id: 'rot', p: [s.x + r[0], s.y + r[1]], kind: 'rotate' });
  return out;
}

function withExtents(s: Shape, x: number, y: number, w: number, h: number): Shape {
  switch (s.kind) {
    case 'rect':
      return { ...s, x, y, w, h, r: Math.min(s.r, w / 2, h / 2) };
    case 'arch':
      return { ...s, x, y, w, h };
    case 'ellipse':
    case 'ngon':
      return { ...s, x, y, rx: w / 2, ry: h / 2 };
    default:
      return s;
  }
}

/** Apply a resize-handle drag to a box-like shape. `p` is the pointer (world). */
export function resizeShape(orig: Shape, handle: string, p: Vec2, keepAspect: boolean): Shape {
  if (!isBoxShape(orig)) return orig;
  const [sx, sy] = handle.split(',').map(Number);
  const [hx, hy] = halfExtents(orig);
  const local = rot([p[0] - orig.x, p[1] - orig.y], -orig.rotation);
  const ax = -sx * hx;
  const ay = -sy * hy;
  let w = 2 * hx;
  let h = 2 * hy;
  if (sx) w = Math.max(2, (local[0] - ax) * sx);
  if (sy) h = Math.max(2, (local[1] - ay) * sy);
  if (keepAspect) {
    const k = sx && sy ? Math.max(w / (2 * hx || 1), h / (2 * hy || 1)) : sx ? w / (2 * hx || 1) : h / (2 * hy || 1);
    w = 2 * hx * k;
    h = 2 * hy * k;
  }
  const cx = sx ? ax + (sx * w) / 2 : 0;
  const cy = sy ? ay + (sy * h) / 2 : 0;
  const c = rot([cx, cy], orig.rotation);
  return withExtents(orig, orig.x + c[0], orig.y + c[1], w, h);
}

export function moveShape(orig: Shape, dx: number, dy: number): Shape {
  switch (orig.kind) {
    case 'line':
      return { ...orig, a: [orig.a[0] + dx, orig.a[1] + dy], b: [orig.b[0] + dx, orig.b[1] + dy] };
    case 'polygon':
      return { ...orig, points: orig.points.map(([x, y]) => [x + dx, y + dy] as Vec2) };
    default:
      return { ...orig, x: orig.x + dx, y: orig.y + dy };
  }
}

export function snapGrid(p: Vec2, size: number): Vec2 {
  return [Math.round(p[0] / size) * size, Math.round(p[1] / size) * size];
}

/** Snap a point onto nearby block outlines, lines or the frame. */
export function snapToLines(design: Design, p: Vec2, tol: number, excludeId?: string): Vec2 | null {
  let best: { d: number; q: Vec2 } | null = null;
  const consider = (r: { d: number; q: Vec2 }) => {
    if (r.d <= tol && (!best || r.d < best.d)) best = r;
  };
  for (const s of design.shapes) {
    if (s.id === excludeId) continue;
    if (s.kind === 'line') {
      for (const e of [s.a, s.b]) {
        const d = Math.hypot(p[0] - e[0], p[1] - e[1]);
        if (d <= tol) consider({ d: d * 0.5, q: e });
      }
      consider(distToSeg(p, s.a, s.b));
    } else {
      const o = cachedOutline(s);
      if (o) consider(distToRing(p, o));
    }
  }
  consider(distToRing(p, frameOutline(design.frame)));
  return best ? (best as { d: number; q: Vec2 }).q : null;
}

export function shapeBounds(s: Shape): Box {
  const pts = s.kind === 'line' ? [s.a, s.b] : (cachedOutline(s) ?? []);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function unionBox(boxes: Box[]): Box {
  return boxes.reduce(
    (a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function frameInnerBox(design: Design): Box {
  const o = frameOutline(design.frame);
  const b = unionBox([{ minX: Math.min(...o.map((p) => p[0])), maxX: Math.max(...o.map((p) => p[0])), minY: Math.min(...o.map((p) => p[1])), maxY: Math.max(...o.map((p) => p[1])) }]);
  const f = design.params.frameWidth;
  return { minX: b.minX + f, minY: b.minY + f, maxX: b.maxX - f, maxY: b.maxY - f };
}

// ---------------------------------------------------------------- magnetic snapping

export interface Guide {
  /** 'x': vertical guide line at x = v; 'y': horizontal at y = v. */
  axis: 'x' | 'y';
  v: number;
  from: number;
  to: number;
}

interface Cand {
  delta: number;
  guide: Guide;
}

/**
 * Magnetic snapping of a moving box against other blocks: edge-to-edge with a
 * gap of one lead width, aligned edges and centres, and the frame's inner edge.
 * Returns the correction to apply and guides to draw.
 */
export function magneticSnap(moving: Box, others: Box[], inner: Box, gap: number, tol: number): { dx: number; dy: number; guides: Guide[] } {
  const xs: Cand[] = [];
  const ys: Cand[] = [];
  const mcx = (moving.minX + moving.maxX) / 2;
  const mcy = (moving.minY + moving.maxY) / 2;
  const overlapY = (o: Box) => o.maxY > moving.minY - tol && o.minY < moving.maxY + tol;
  const overlapX = (o: Box) => o.maxX > moving.minX - tol && o.minX < moving.maxX + tol;
  const vSpan = (o: Box): [number, number] => [Math.min(o.minY, moving.minY), Math.max(o.maxY, moving.maxY)];
  const hSpan = (o: Box): [number, number] => [Math.min(o.minX, moving.minX), Math.max(o.maxX, moving.maxX)];
  for (const o of others) {
    const ocx = (o.minX + o.maxX) / 2;
    const ocy = (o.minY + o.maxY) / 2;
    const [y0, y1] = vSpan(o);
    const [x0, x1] = hSpan(o);
    if (overlapY(o)) {
      // side by side with a lead-width gap
      xs.push({ delta: o.maxX + gap - moving.minX, guide: { axis: 'x', v: o.maxX + gap / 2, from: y0, to: y1 } });
      xs.push({ delta: o.minX - gap - moving.maxX, guide: { axis: 'x', v: o.minX - gap / 2, from: y0, to: y1 } });
    }
    if (overlapX(o)) {
      ys.push({ delta: o.maxY + gap - moving.minY, guide: { axis: 'y', v: o.maxY + gap / 2, from: x0, to: x1 } });
      ys.push({ delta: o.minY - gap - moving.maxY, guide: { axis: 'y', v: o.minY - gap / 2, from: x0, to: x1 } });
    }
    // alignment
    xs.push({ delta: o.minX - moving.minX, guide: { axis: 'x', v: o.minX, from: y0, to: y1 } });
    xs.push({ delta: o.maxX - moving.maxX, guide: { axis: 'x', v: o.maxX, from: y0, to: y1 } });
    xs.push({ delta: ocx - mcx, guide: { axis: 'x', v: ocx, from: y0, to: y1 } });
    ys.push({ delta: o.minY - moving.minY, guide: { axis: 'y', v: o.minY, from: x0, to: x1 } });
    ys.push({ delta: o.maxY - moving.maxY, guide: { axis: 'y', v: o.maxY, from: x0, to: x1 } });
    ys.push({ delta: ocy - mcy, guide: { axis: 'y', v: ocy, from: x0, to: x1 } });
  }
  // frame inner edge and centre
  const icx = (inner.minX + inner.maxX) / 2;
  const icy = (inner.minY + inner.maxY) / 2;
  xs.push({ delta: inner.minX - moving.minX, guide: { axis: 'x', v: inner.minX, from: inner.minY, to: inner.maxY } });
  xs.push({ delta: inner.maxX - moving.maxX, guide: { axis: 'x', v: inner.maxX, from: inner.minY, to: inner.maxY } });
  xs.push({ delta: icx - mcx, guide: { axis: 'x', v: icx, from: inner.minY, to: inner.maxY } });
  ys.push({ delta: inner.minY - moving.minY, guide: { axis: 'y', v: inner.minY, from: inner.minX, to: inner.maxX } });
  ys.push({ delta: inner.maxY - moving.maxY, guide: { axis: 'y', v: inner.maxY, from: inner.minX, to: inner.maxX } });
  ys.push({ delta: icy - mcy, guide: { axis: 'y', v: icy, from: inner.minX, to: inner.maxX } });

  const pick = (cands: Cand[]) => {
    let best: Cand | null = null;
    for (const c of cands) if (Math.abs(c.delta) <= tol && (!best || Math.abs(c.delta) < Math.abs(best.delta))) best = c;
    return best;
  };
  const bx = pick(xs);
  const by = pick(ys);
  const guides: Guide[] = [];
  if (bx) guides.push(bx.guide);
  if (by) guides.push(by.guide);
  return { dx: bx?.delta ?? 0, dy: by?.delta ?? 0, guides };
}

/** Candidate coordinates for snapping a single edge while resizing. */
export function edgeTargets(others: Box[], inner: Box, gap: number): { xs: number[]; ys: number[] } {
  const xs = [inner.minX, inner.maxX];
  const ys = [inner.minY, inner.maxY];
  for (const o of others) {
    xs.push(o.minX, o.maxX, o.minX - gap, o.maxX + gap);
    ys.push(o.minY, o.maxY, o.minY - gap, o.maxY + gap);
  }
  return { xs, ys };
}

export function snapValue(v: number, targets: number[], tol: number): number | null {
  let best: number | null = null;
  for (const t of targets) if (Math.abs(t - v) <= tol && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  return best;
}

// ---------------------------------------------------------------- align & distribute

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'distH' | 'distV' | 'packH' | 'packV';

export function alignShapes(shapes: Shape[], ids: string[], op: AlignOp, gap: number): Shape[] {
  const sel = shapes.filter((s) => ids.includes(s.id));
  if (sel.length < 2) return shapes;
  const boxes = new Map(sel.map((s) => [s.id, shapeBounds(s)]));
  const all = unionBox([...boxes.values()]);
  const moves = new Map<string, [number, number]>();
  const set = (id: string, dx: number, dy: number) => moves.set(id, [dx, dy]);
  switch (op) {
    case 'left':
      for (const [id, b] of boxes) set(id, all.minX - b.minX, 0);
      break;
    case 'right':
      for (const [id, b] of boxes) set(id, all.maxX - b.maxX, 0);
      break;
    case 'hcenter':
      for (const [id, b] of boxes) set(id, (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2, 0);
      break;
    case 'top':
      for (const [id, b] of boxes) set(id, 0, all.maxY - b.maxY);
      break;
    case 'bottom':
      for (const [id, b] of boxes) set(id, 0, all.minY - b.minY);
      break;
    case 'vcenter':
      for (const [id, b] of boxes) set(id, 0, (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2);
      break;
    case 'distH':
    case 'packH': {
      const order = [...boxes.entries()].sort((a, b) => a[1].minX - b[1].minX);
      const total = order.reduce((a, [, b]) => a + (b.maxX - b.minX), 0);
      const g = op === 'packH' ? gap : (all.maxX - all.minX - total) / (order.length - 1);
      let x = order[0][1].minX;
      for (const [id, b] of order) {
        set(id, x - b.minX, 0);
        x += b.maxX - b.minX + g;
      }
      break;
    }
    case 'distV':
    case 'packV': {
      const order = [...boxes.entries()].sort((a, b) => b[1].maxY - a[1].maxY);
      const total = order.reduce((a, [, b]) => a + (b.maxY - b.minY), 0);
      const g = op === 'packV' ? gap : (all.maxY - all.minY - total) / (order.length - 1);
      let y = order[0][1].maxY;
      for (const [id, b] of order) {
        set(id, 0, y - b.maxY);
        y -= b.maxY - b.minY + g;
      }
      break;
    }
  }
  return shapes.map((s) => {
    const m = moves.get(s.id);
    return m ? moveShape(s, m[0], m[1]) : s;
  });
}

/** Move the given shapes one step up/down the stack, or to the top/bottom. */
export function reorder(shapes: Shape[], ids: string[], op: 'up' | 'down' | 'top' | 'bottom'): Shape[] {
  const sel = new Set(ids);
  if (op === 'top') return [...shapes.filter((s) => !sel.has(s.id)), ...shapes.filter((s) => sel.has(s.id))];
  if (op === 'bottom') return [...shapes.filter((s) => sel.has(s.id)), ...shapes.filter((s) => !sel.has(s.id))];
  const arr = shapes.slice();
  if (op === 'up') {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    }
  } else {
    for (let i = 1; i < arr.length; i++) {
      if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
  }
  return arr;
}
