// Convert design shapes into plain polygons (world coordinates, y up).
import type { Frame, Shape, Vec2 } from '../model/types';

/** Max chord error when discretising curves (mm). */
export const CURVE_TOLERANCE = 0.03;

export function segmentsFor(radius: number, tol = CURVE_TOLERANCE): number {
  if (radius <= tol * 2) return 8;
  const n = Math.ceil(Math.PI / Math.acos(1 - tol / radius));
  return Math.max(12, Math.min(720, n));
}

export function signedArea(p: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  }
  return a / 2;
}

export function ensureCCW(p: Vec2[]): Vec2[] {
  return signedArea(p) < 0 ? p.slice().reverse() : p;
}

function rotateAround(points: Vec2[], cx: number, cy: number, deg: number): Vec2[] {
  if (!deg) return points.map(([x, y]) => [x + cx, y + cy]);
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return points.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

export function ellipsePoints(rx: number, ry: number): Vec2[] {
  const n = segmentsFor(Math.max(rx, ry));
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([Math.cos(t) * rx, Math.sin(t) * ry]);
  }
  return pts;
}

export function roundedRectPoints(w: number, h: number, r: number): Vec2[] {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.max(0, Math.min(r, hw, hh));
  if (rr < 1e-3) {
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  }
  const n = Math.max(2, Math.ceil(segmentsFor(rr) / 4));
  const pts: Vec2[] = [];
  const corners: [number, number, number][] = [
    [hw - rr, -hh + rr, -90],
    [hw - rr, hh - rr, 0],
    [-hw + rr, hh - rr, 90],
    [-hw + rr, -hh + rr, 180],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= n; i++) {
      const t = ((start + (90 * i) / n) * Math.PI) / 180;
      pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
    }
  }
  return pts;
}

/** Outline of a closed shape (CCW). Returns null for open shapes (lines). */
export function shapeOutline(s: Shape): Vec2[] | null {
  switch (s.kind) {
    case 'rect':
      return ensureCCW(rotateAround(roundedRectPoints(Math.abs(s.w), Math.abs(s.h), s.r), s.x, s.y, s.rotation));
    case 'ellipse':
      return ensureCCW(rotateAround(ellipsePoints(Math.abs(s.rx), Math.abs(s.ry)), s.x, s.y, s.rotation));
    case 'polygon':
      return s.points.length >= 3 ? ensureCCW(s.points.map((p) => [p[0], p[1]] as Vec2)) : null;
    case 'line':
      return null;
  }
}

/** Stadium-shaped stroke around a segment (round caps), CCW. */
export function segmentStroke(a: Vec2, b: Vec2, halfWidth: number): Vec2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const n = Math.max(4, Math.ceil(segmentsFor(halfWidth) / 2));
  const base = len < 1e-9 ? 0 : Math.atan2(dy, dx);
  const pts: Vec2[] = [];
  // cap around b: from -90° to +90° relative to direction
  for (let i = 0; i <= n; i++) {
    const t = base - Math.PI / 2 + (Math.PI * i) / n;
    pts.push([b[0] + Math.cos(t) * halfWidth, b[1] + Math.sin(t) * halfWidth]);
  }
  for (let i = 0; i <= n; i++) {
    const t = base + Math.PI / 2 + (Math.PI * i) / n;
    pts.push([a[0] + Math.cos(t) * halfWidth, a[1] + Math.sin(t) * halfWidth]);
  }
  return ensureCCW(pts);
}

export function frameOutline(f: Frame): Vec2[] {
  switch (f.kind) {
    case 'rect':
      return ensureCCW(roundedRectPoints(f.w, f.h, f.r));
    case 'ellipse':
      return ensureCCW(ellipsePoints(f.w / 2, f.h / 2));
    case 'polygon':
      if (f.points.length >= 3) return ensureCCW(f.points.map((p) => [p[0], p[1]] as Vec2));
      return ensureCCW(roundedRectPoints(f.w, f.h, 0));
  }
}

/** Even-odd point in polygon test over a set of rings. */
export function pointInRings(pt: Vec2, rings: Vec2[][]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function distToSegmentSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** Signed distance: positive inside the rings, negative outside. */
export function signedDistance(p: Vec2, rings: Vec2[][]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      best = Math.min(best, distToSegmentSq(p, ring[j], ring[i]));
    }
  }
  const d = Math.sqrt(best);
  return pointInRings(p, rings) ? d : -d;
}

export function ringsBounds(rings: Vec2[][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** A good spot for a label: approximately the most interior point. */
export function labelPoint(rings: Vec2[][]): Vec2 {
  const b = ringsBounds(rings);
  let best: Vec2 = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  let bestD = signedDistance(best, rings);
  let cx = best[0];
  let cy = best[1];
  let spanX = b.maxX - b.minX;
  let spanY = b.maxY - b.minY;
  const steps = 9;
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const p: Vec2 = [cx - spanX / 2 + (spanX * i) / steps, cy - spanY / 2 + (spanY * j) / steps];
        const d = signedDistance(p, rings);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    cx = best[0];
    cy = best[1];
    spanX /= 3;
    spanY /= 3;
  }
  return best;
}
