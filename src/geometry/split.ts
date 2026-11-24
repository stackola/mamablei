// Automatic splitting of large panels into pieces that fit the printer bed.
//
// Seams are found as cheapest paths on a raster of the lead footprint:
// crossing material is expensive, passing through an opening is (almost)
// free. The result: seams cross lead lines at right angles at their narrowest
// spots and otherwise run through openings, so leads are never split
// lengthwise and the acrylic panes bridge (and strengthen) the seams.
// With `seamsThroughPanes = false` the seams instead follow lead centrelines.
//
// First the panel is cut into vertical columns, then every column is cut
// into rows independently (brick pattern, no 4-way corners).
import type { CrossSection, ManifoldToplevel } from 'manifold-3d';
import type { Vec2 } from '../model/types';
import type { Gc, Rings } from './layout2d';
import { ringsBounds } from './shapes2d';

export interface SplitCell {
  label: string;
  cs: CrossSection;
  rings: Rings;
}

export interface SplitResult {
  cells: SplitCell[];
  seams: Vec2[][];
  cols: number;
}

interface Grid {
  x0: number;
  y0: number;
  res: number;
  nx: number;
  ny: number;
}

/** Even-odd scanline rasterisation of rings onto the grid (cell centres). */
export function rasterize(rings: Rings, g: Grid, out?: Uint8Array): Uint8Array {
  const mask = out ?? new Uint8Array(g.nx * g.ny);
  const rows: number[][] = Array.from({ length: g.ny }, () => []);
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xa, ya] = ring[j];
      const [xb, yb] = ring[i];
      if (ya === yb) continue;
      const ymin = Math.min(ya, yb);
      const ymax = Math.max(ya, yb);
      const r0 = Math.max(0, Math.ceil((ymin - g.y0) / g.res - 0.5));
      const r1 = Math.min(g.ny - 1, Math.floor((ymax - g.y0) / g.res - 0.5));
      for (let r = r0; r <= r1; r++) {
        const yc = g.y0 + (r + 0.5) * g.res;
        if (yc < ymin || yc >= ymax) continue;
        rows[r].push(xa + ((yc - ya) * (xb - xa)) / (yb - ya));
      }
    }
  }
  for (let r = 0; r < g.ny; r++) {
    const xs = rows[r];
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.res - 0.5));
      const c1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.res - 0.5));
      for (let c = c0; c <= c1; c++) mask[r * g.nx + c] = 1;
    }
  }
  return mask;
}

/** Two-pass chamfer distance (in cells) to the nearest cell with mask == 0. */
function distanceInside(mask: Uint8Array, g: Grid): Float32Array {
  const { nx, ny } = g;
  const d = new Float32Array(nx * ny);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - nx] + a);
        if (x > 0) v = Math.min(v, d[i - nx - 1] + b);
        if (x < nx - 1) v = Math.min(v, d[i - nx + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = ny - 1; y >= 0; y--) {
    for (let x = nx - 1; x >= 0; x--) {
      const i = y * nx + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < nx - 1) v = Math.min(v, d[i + 1] + a);
      if (y < ny - 1) {
        v = Math.min(v, d[i + nx] + a);
        if (x < nx - 1) v = Math.min(v, d[i + nx + 1] + b);
        if (x > 0) v = Math.min(v, d[i + nx - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: number) {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): [number, number] {
    const keys = this.keys;
    const vals = this.vals;
    const k0 = keys[0];
    const v0 = vals[0];
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= k) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return [k0, v0];
  }
}

/**
 * Cheapest path through the window [cx0, cx1] × [cy0, cy1] of the grid,
 * from the first to the last row ('v') or column ('h').
 */
function cheapestPath(
  cost: (i: number) => number,
  g: Grid,
  cx0: number,
  cx1: number,
  cy0: number,
  cy1: number,
  dir: 'v' | 'h',
): number[] | null {
  const w = cx1 - cx0 + 1;
  const h = cy1 - cy0 + 1;
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap();
  const local = (x: number, y: number) => (y - cy0) * w + (x - cx0);
  if (dir === 'v') {
    for (let x = cx0; x <= cx1; x++) {
      const l = local(x, cy0);
      dist[l] = cost(cy0 * g.nx + x);
      heap.push(dist[l], l);
    }
  } else {
    for (let y = cy0; y <= cy1; y++) {
      const l = local(cx0, y);
      dist[l] = cost(y * g.nx + cx0);
      heap.push(dist[l], l);
    }
  }
  const nb: [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  let end = -1;
  while (heap.size) {
    const [d, l] = heap.pop();
    if (done[l]) continue;
    done[l] = 1;
    const x = (l % w) + cx0;
    const y = Math.floor(l / w) + cy0;
    if ((dir === 'v' && y === cy1) || (dir === 'h' && x === cx1)) {
      end = l;
      break;
    }
    const cHere = cost(y * g.nx + x);
    for (const [dx, dy, len] of nb) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < cx0 || xx > cx1 || yy < cy0 || yy > cy1) continue;
      const ll = local(xx, yy);
      if (done[ll]) continue;
      const nd = d + ((cHere + cost(yy * g.nx + xx)) / 2) * len;
      if (nd < dist[ll]) {
        dist[ll] = nd;
        prev[ll] = l;
        heap.push(nd, ll);
      }
    }
  }
  if (end < 0) return null;
  const path: number[] = [];
  for (let l = end; l >= 0; l = prev[l]) {
    const x = (l % w) + cx0;
    const y = Math.floor(l / w) + cy0;
    path.push(y * g.nx + x);
  }
  return path.reverse();
}

function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export interface SplitOptions {
  maxPiece: number;
  leadWidth: number;
  seamsThroughPanes: boolean;
}

const ROWS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function splitPanel(
  M: ManifoldToplevel,
  gc: Gc,
  frame: CrossSection,
  lead: Rings,
  opts: SplitOptions,
): SplitResult {
  const { CrossSection } = M;
  const fb = ringsBounds(frame.toPolygons() as Vec2[][]);
  const B = opts.maxPiece;
  const Wp = fb.maxX - fb.minX;
  const Hp = fb.maxY - fb.minY;
  const far = Math.max(Wp, Hp) + 100;
  const box = (x0: number, y0: number, x1: number, y1: number) =>
    gc.t(new CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], 'Positive'));
  const everything = box(fb.minX - far, fb.minY - far, fb.maxX + far, fb.maxY + far);

  if (Wp <= B && Hp <= B) {
    return { cells: [{ label: 'A1', cs: everything, rings: [] }], seams: [], cols: 1 };
  }

  // Fewest pieces that still leave the seam some room to wander (≥ 5 mm).
  const piecesFor = (len: number) => {
    if (len <= B) return 1;
    let n = Math.ceil(len / B);
    while ((B - len / n) / 2 < 5) n++;
    return n;
  };

  const margin = 4;
  const res = Math.max(0.5, Math.sqrt(((Wp + 2 * margin) * (Hp + 2 * margin)) / 6e6));
  const g: Grid = {
    x0: fb.minX - margin,
    y0: fb.minY - margin,
    res,
    nx: Math.ceil((Wp + 2 * margin) / res),
    ny: Math.ceil((Hp + 2 * margin) / res),
  };
  const material = rasterize(lead, g);
  const halfLead = Math.max(1, opts.leadWidth / 2 / res);
  const dIn = opts.seamsThroughPanes ? null : distanceInside(material, g);
  const baseCost = (i: number, ideal: number, along: number) => {
    const straight = 0.004 * Math.abs(along - ideal);
    if (material[i]) {
      if (dIn) return 1 + 3 * Math.max(0, 1 - dIn[i] / halfLead) + straight;
      return 1 + straight;
    }
    // opening or outside the panel
    return (opts.seamsThroughPanes ? 0.02 : 40) + straight;
  };
  const cellCenter = (i: number): Vec2 => [g.x0 + ((i % g.nx) + 0.5) * res, g.y0 + (Math.floor(i / g.nx) + 0.5) * res];
  const toCell = (v: number, origin: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor((v - origin) / res)));

  const seams: Vec2[][] = [];

  // Vertical seams → columns.
  const ncols = piecesFor(Wp);
  const colW = Wp / ncols;
  const devX = Math.max(2, (B - colW) / 2 - 1);
  const lefts: CrossSection[] = [];
  for (let c = 1; c < ncols; c++) {
    const ideal = fb.minX + c * colW;
    const cx0 = toCell(ideal - devX, g.x0, g.nx);
    const cx1 = toCell(ideal + devX, g.x0, g.nx);
    const path = cheapestPath((i) => baseCost(i, ideal, cellCenter(i)[0]), g, cx0, cx1, 0, g.ny - 1, 'v');
    let pts: Vec2[] = path ? path.map(cellCenter) : [[ideal, g.y0], [ideal, g.y0 + g.ny * res]];
    pts = simplify(pts, res * 0.5);
    seams.push(pts);
    const poly: Vec2[] = [[pts[0][0], fb.minY - far], ...pts, [pts[pts.length - 1][0], fb.maxY + far], [fb.minX - far, fb.maxY + far], [fb.minX - far, fb.minY - far]];
    lefts.push(gc.t(new CrossSection([poly], 'EvenOdd')));
  }
  const columns: CrossSection[] = [];
  for (let c = 0; c < ncols; c++) {
    let col = c < ncols - 1 ? lefts[c] : everything;
    if (c > 0) col = gc.t(col.subtract(lefts[c - 1]));
    columns.push(col);
  }

  // Horizontal seams inside each column.
  const cells: SplitCell[] = [];
  const leadCS = gc.t(new CrossSection(lead, 'EvenOdd'));
  columns.forEach((col, c) => {
    const colLead = gc.t(col.intersect(leadCS));
    if (colLead.isEmpty()) return;
    const cb = colLead.bounds();
    const ch = cb.max[1] - cb.min[1];
    const nrows = piecesFor(ch);
    const colMask = rasterize(col.toPolygons() as Vec2[][], g);
    const rowH = ch / nrows;
    const devY = Math.max(2, (B - rowH) / 2 - 1);
    const belows: CrossSection[] = [];
    const cx0 = toCell(cb.min[0] - 2, g.x0, g.nx);
    const cx1 = toCell(cb.max[0] + 2, g.x0, g.nx);
    // rows are numbered from the top
    for (let r = 1; r < nrows; r++) {
      const ideal = cb.max[1] - r * rowH;
      const cy0 = toCell(ideal - devY, g.y0, g.ny);
      const cy1 = toCell(ideal + devY, g.y0, g.ny);
      const path = cheapestPath(
        (i) => (colMask[i] ? baseCost(i, ideal, cellCenter(i)[1]) : 0.001),
        g, cx0, cx1, cy0, cy1, 'h',
      );
      let pts: Vec2[] = path ? path.map(cellCenter) : [[cb.min[0], ideal], [cb.max[0], ideal]];
      pts = simplify(pts, res * 0.5);
      const clipped = pts;
      seams.push(clipped);
      const poly: Vec2[] = [[fb.minX - far, pts[0][1]], ...pts, [fb.maxX + far, pts[pts.length - 1][1]], [fb.maxX + far, fb.minY - far], [fb.minX - far, fb.minY - far]];
      belows.push(gc.t(new CrossSection([poly], 'EvenOdd')));
    }
    for (let r = 0; r < nrows; r++) {
      let cell = col;
      if (r > 0) cell = gc.t(cell.intersect(belows[r - 1]));
      if (r < nrows - 1) cell = gc.t(cell.subtract(belows[r]));
      cells.push({ label: `${ROWS[r % 26]}${c + 1}`, cs: cell, rings: [] });
    }
  });

  for (const cell of cells) {
    const clippedToFrame = gc.t(cell.cs.intersect(frame));
    cell.rings = clippedToFrame.toPolygons() as Vec2[][];
  }
  return { cells, seams, cols: ncols };
}
