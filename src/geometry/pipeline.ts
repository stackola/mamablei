// Full build: layout → part → split → pieces + pane solids.
import type { ManifoldToplevel } from 'manifold-3d';
import type { Design, Vec2 } from '../model/types';
import { buildPart, meshOf, paneSolid, type MeshData } from './build3d';
import { computeLayout, Gc, type Rings } from './layout2d';
import { splitPanel } from './split';

export interface PieceOut {
  label: string;
  mesh: MeshData;
  min: [number, number, number];
  max: [number, number, number];
  fits: boolean;
  volume: number;
  components: number;
}

export interface PaneOut {
  index: number;
  fill: string;
  mesh: MeshData;
}

export interface BuildOutput {
  pieces: PieceOut[];
  panes: PaneOut[];
  seams: Vec2[][];
  cells: { label: string; rings: Rings }[];
  totalVolume: number;
  maxPiece: number;
  timings: Record<string, number>;
}

export function buildAll(M: ManifoldToplevel, design: Design, withPanes = true): BuildOutput {
  const gc = new Gc();
  const timings: Record<string, number> = {};
  let t = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    timings[name] = Math.round(now - t);
    t = now;
  };
  try {
    const { layout, cs } = computeLayout(M, design, gc);
    lap('layout');
    const part = buildPart(M, gc, cs, layout.eff);
    lap('part');
    const split = splitPanel(M, gc, cs.frame, layout.lead, {
      maxPiece: layout.eff.maxPiece,
      leadWidth: layout.eff.leadWidth,
      seamsThroughPanes: design.params.seamsThroughPanes,
    });
    lap('split');
    const top = layout.eff.totalHeight;
    const pieces: PieceOut[] = [];
    for (const cell of split.cells) {
      const prism = gc.t(gc.t(cell.cs.extrude(top + 4)).translate([0, 0, -2]));
      const piece = split.cells.length === 1 ? part : gc.t(part.intersect(prism));
      if (piece.isEmpty()) continue;
      const bb = piece.boundingBox();
      const w = bb.max[0] - bb.min[0];
      const h = bb.max[1] - bb.min[1];
      const comps = piece.decompose();
      const components = comps.length;
      comps.forEach((c) => c.delete());
      pieces.push({
        label: cell.label,
        mesh: meshOf(piece),
        min: [bb.min[0], bb.min[1], bb.min[2]],
        max: [bb.max[0], bb.max[1], bb.max[2]],
        fits: w <= layout.eff.maxPiece + 0.01 && h <= layout.eff.maxPiece + 0.01,
        volume: piece.volume(),
        components,
      });
    }
    lap('pieces');
    const panes: PaneOut[] = [];
    if (withPanes) {
      layout.panes.forEach((p, i) => {
        panes.push({ index: p.index, fill: p.fill, mesh: meshOf(paneSolid(gc, cs.cuts[i], layout.eff)) });
      });
    }
    lap('panes');
    return {
      pieces,
      panes,
      seams: split.seams,
      cells: split.cells.map((c) => ({ label: c.label, rings: c.rings })),
      totalVolume: pieces.reduce((a, p) => a + p.volume, 0),
      maxPiece: layout.eff.maxPiece,
      timings,
    };
  } finally {
    gc.dispose();
  }
}
