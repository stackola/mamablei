// Helpers for interactive editing: hit tests, handles, resize, snapping.
import { shapeOutline, frameOutline, pointInRings, signedArea } from '../geometry/shapes2d';
import type { Design, Shape, Vec2 } from '../model/types';

export type Tool = 'select' | 'rect' | 'ellipse' | 'circle' | 'line' | 'polygon' | 'fill' | 'frame';

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

/** Topmost shape whose lead line is near p, else smallest shape containing p. */
export function hitTest(shapes: Shape[], p: Vec2, tol: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.kind === 'line') {
      if (distToSeg(p, s.a, s.b).d <= tol) return s;
      continue;
    }
    const o = cachedOutline(s);
    if (o && distToRing(p, o).d <= tol) return s;
  }
  let best: Shape | null = null;
  let bestArea = Infinity;
  for (const s of shapes) {
    if (s.kind === 'line') continue;
    const o = cachedOutline(s);
    if (!o || !pointInRings(p, [o])) continue;
    const a = Math.abs(signedArea(o));
    if (a < bestArea) {
      bestArea = a;
      best = s;
    }
  }
  return best;
}

export interface Handle {
  id: string;
  p: Vec2;
  kind: 'resize' | 'rotate' | 'vertex' | 'end';
}

/** Local half extents for rect / ellipse. */
function halfExtents(s: Shape): [number, number] {
  if (s.kind === 'rect') return [Math.abs(s.w) / 2, Math.abs(s.h) / 2];
  if (s.kind === 'ellipse') return [Math.abs(s.rx), Math.abs(s.ry)];
  return [0, 0];
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

/** Apply a resize-handle drag to a rect/ellipse. `p` is the pointer (world). */
export function resizeShape(orig: Shape, handle: string, p: Vec2, keepAspect: boolean): Shape {
  if (orig.kind !== 'rect' && orig.kind !== 'ellipse') return orig;
  const [sx, sy] = handle.split(',').map(Number);
  const [hx, hy] = halfExtents(orig);
  const local = rot([p[0] - orig.x, p[1] - orig.y], -orig.rotation);
  const ax = -sx * hx;
  const ay = -sy * hy;
  let w = 2 * hx;
  let h = 2 * hy;
  if (sx) w = Math.max(1, (local[0] - ax) * sx);
  if (sy) h = Math.max(1, (local[1] - ay) * sy);
  if (keepAspect && sx && sy) {
    const k = Math.max(w / (2 * hx || 1), h / (2 * hy || 1));
    w = 2 * hx * k;
    h = 2 * hy * k;
  }
  const cx = sx ? ax + (sx * w) / 2 : 0;
  const cy = sy ? ay + (sy * h) / 2 : 0;
  const c = rot([cx, cy], orig.rotation);
  const x = orig.x + c[0];
  const y = orig.y + c[1];
  if (orig.kind === 'rect') return { ...orig, x, y, w, h, r: Math.min(orig.r, w / 2, h / 2) };
  return { ...orig, x, y, rx: w / 2, ry: h / 2 };
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

export function anchorOf(s: Shape): Vec2 {
  switch (s.kind) {
    case 'line':
      return s.a;
    case 'polygon':
      return s.points[0] ?? [0, 0];
    default:
      return [s.x, s.y];
  }
}

export function snapGrid(p: Vec2, size: number): Vec2 {
  return [Math.round(p[0] / size) * size, Math.round(p[1] / size) * size];
}

/** Snap a point onto nearby lead lines (shape outlines, lines, frame). */
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

export function shapeBounds(s: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
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
