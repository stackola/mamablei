// 2D layout: from shapes to lead lines, panes (openings), stem and acrylic
// cut shapes. Everything is computed with Manifold's CrossSection (Clipper2).
import type { CrossSection, ManifoldToplevel } from 'manifold-3d';
import type { Design, Params, Vec2 } from '../model/types';
import { isBlock } from '../model/types';
import {
  frameOutline,
  labelPoint,
  pointInRings,
  ringsBounds,
  segmentStroke,
  segmentsFor,
  shapeOutline,
} from './shapes2d';

export type Rings = Vec2[][];

export interface EffectiveParams {
  leadWidth: number;
  edgeRadius: number;
  stepWidth: number;
  stemWidth: number;
  glassThickness: number;
  stepDepth: number;
  capThickness: number;
  totalHeight: number;
  frameWidth: number;
  cornerRadius: number;
  minPaneWidth: number;
  paneClearance: number;
  roundOuterEdge: boolean;
  maxPiece: number;
}

export const MIN_STEM = 1.2;

export function effectiveParams(p: Params): EffectiveParams {
  const leadWidth = Math.max(1, p.leadWidth);
  const stepWidth = Math.max(0, Math.min(p.stepWidth, leadWidth / 2 - 0.4));
  const capThickness = Math.max(0.6, p.capThickness);
  const edgeRadius = Math.max(0, Math.min(p.edgeRadius, leadWidth / 2 - 0.05, capThickness));
  const glassThickness = Math.max(0.5, p.glassThickness);
  const stepDepth = glassThickness + Math.max(0, p.stepExtra);
  return {
    leadWidth,
    edgeRadius,
    stepWidth,
    stemWidth: leadWidth - 2 * stepWidth,
    glassThickness,
    stepDepth,
    capThickness,
    totalHeight: stepDepth + capThickness,
    frameWidth: Math.max(stepWidth + 1, p.frameWidth),
    cornerRadius: Math.max(0, p.cornerRadius),
    minPaneWidth: Math.max(0, p.minPaneWidth),
    paneClearance: Math.max(0, Math.min(p.paneClearance, stepWidth)),
    roundOuterEdge: p.roundOuterEdge,
    maxPiece: Math.max(40, p.bedSize - p.bedMargin),
  };
}

export interface PaneInfo {
  /** 1-based number, printed on templates. */
  index: number;
  /** Glass colour id. */
  fill: string;
  /** The block this pane comes from. */
  blockId: string;
  /** True if lead lines split the block into several panes. */
  split: boolean;
  /** Visible opening (front). */
  opening: Rings;
  /** Acrylic cut outline (opening grown by step width minus clearance). */
  cut: Rings;
  label: Vec2;
  area: number;
}

export type WarningCode = 'stem' | 'stemOverlap' | 'islands' | 'slivers' | 'empty' | 'radius';

export interface LayoutWarning {
  code: WarningCode;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Layout {
  frame: Rings;
  lead: Rings;
  stem: Rings;
  panes: PaneInfo[];
  slivers: Rings;
  islands: Rings[];
  warnings: LayoutWarning[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  eff: EffectiveParams;
  leadArea: number;
}

/** Collects WASM objects so they can be freed in one go. */
export class Gc {
  private items: { delete(): void }[] = [];
  t<T extends { delete(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
  dispose() {
    for (const i of this.items) {
      try {
        i.delete();
      } catch {
        /* already freed */
      }
    }
    this.items = [];
  }
}

const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });

export interface LayoutCS {
  frame: CrossSection;
  /** Final lead footprint (front). */
  lead: CrossSection;
  /** Union of the back openings (step outline). */
  back: CrossSection;
  /** Acrylic panes (same order as layout.panes). */
  cuts: CrossSection[];
}

export function toRings(cs: CrossSection): Rings {
  return cs.toPolygons().map((r) => r.map((p) => [p[0], p[1]] as Vec2));
}

/**
 * Compute the 2D layout. The returned `cs` objects belong to `gc` and are
 * freed by `gc.dispose()`.
 */
export function computeLayout(M: ManifoldToplevel, design: Design, gc: Gc): { layout: Layout; cs: LayoutCS } {
  const { CrossSection } = M;
  const eff = effectiveParams(design.params);
  const W = eff.leadWidth;
  const hw = W / 2;
  const segs = (r: number) => segmentsFor(Math.max(r, 0.1));
  const warnings: LayoutWarning[] = [];

  const frameRing = frameOutline(design.frame);
  const frame = gc.t(new CrossSection([frameRing], 'Positive'));
  const inner = gc.t(frame.offset(-eff.frameWidth, 'Miter', 4));

  const empty = () => gc.t(frame.subtract(frame));
  const unionOf = (list: CrossSection[]) => (list.length ? gc.t(CrossSection.union(list)) : empty());

  // Lead lines (split blocks).
  const strokes: CrossSection[] = [];
  for (const s of design.shapes) {
    if (s.kind !== 'line') continue;
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    if (len < 1e-6) continue;
    strokes.push(gc.t(new CrossSection([segmentStroke(s.a, s.b, hw)], 'Positive')));
  }
  const lineUnion = unionOf(strokes);

  // Blocks, top first: each block is cut by everything above it (grown by
  // one lead width) and by the lead lines.
  const sliverParts: CrossSection[] = [];
  const openings: { cs: CrossSection; fill: string; blockId: string }[] = [];
  const m = eff.minPaneWidth;
  const rc = eff.cornerRadius;
  const minArea = Math.max(1, m * m * 0.5);
  const blocks = design.shapes.filter(isBlock);
  let above: CrossSection | null = null;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const outline = shapeOutline(b);
    if (!outline) continue;
    const shapeCS = gc.t(new CrossSection([outline], 'Positive'));
    if (shapeCS.isEmpty()) continue;
    let region = gc.t(shapeCS.intersect(inner));
    if (above) region = gc.t(region.subtract(above));
    if (strokes.length) region = gc.t(region.subtract(lineUnion));
    const grown = gc.t(shapeCS.offset(W, 'Round', 2, segs(W)));
    above = above ? gc.t(above.add(grown)) : grown;
    if (region.isEmpty()) continue;

    let g = region;
    if (m > 0) {
      const eroded = gc.t(g.offset(-m / 2, 'Miter', 4));
      g = gc.t(gc.t(eroded.offset(m / 2, 'Miter', 4)).intersect(region));
    }
    if (rc > 0 && !g.isEmpty()) {
      const e2 = gc.t(g.offset(-rc, 'Round', 2, segs(rc)));
      g = gc.t(e2.offset(rc, 'Round', 2, segs(rc)));
    }
    const removed = gc.t(region.subtract(g));
    if (removed.area() > 0.05) sliverParts.push(removed);
    const comps = g.decompose().map((c) => gc.t(c));
    const kept = comps.filter((c) => {
      if (c.area() < minArea) {
        sliverParts.push(c);
        return false;
      }
      return true;
    });
    for (const comp of kept) {
      let fill = b.fill;
      if (kept.length > 1) {
        const rings = toRings(comp);
        for (let k = design.fills.length - 1; k >= 0; k--) {
          const f = design.fills[k];
          if (pointInRings([f.x, f.y], rings)) {
            fill = f.fill;
            break;
          }
        }
      }
      openings.push({ cs: comp, fill, blockId: b.id });
    }
  }

  const openUnion = unionOf(openings.map((o) => o.cs));
  const lead = gc.t(frame.subtract(openUnion));

  // Back: openings grown by the step width.
  const R = eff.stepWidth;
  const backs = openings.map((o) => gc.t(o.cs.offset(R, 'Round', 2, segs(R))));
  const back = unionOf(backs);
  const stem = gc.t(frame.subtract(back));
  const sumBack = backs.reduce((a, b) => a + b.area(), 0);
  if (sumBack - back.area() > 1) {
    warnings.push({
      code: 'stemOverlap',
      level: 'error',
      message: 'Auf der Rückseite überlappen sich Glasfalze – Bleisteg breiter oder Falz schmaler machen.',
    });
  }
  if (eff.stemWidth < MIN_STEM) {
    warnings.push({
      code: 'stem',
      level: 'warn',
      message: `Steg hinten nur ${fmt(eff.stemWidth)} mm breit (empfohlen ≥ ${fmt(MIN_STEM)} mm).`,
    });
  }
  if (design.params.edgeRadius > eff.edgeRadius + 1e-6) {
    warnings.push({
      code: 'radius',
      level: 'info',
      message: `Kantenradius auf ${fmt(eff.edgeRadius)} mm begrenzt (max. halbe Bleibreite / Kappenstärke).`,
    });
  }

  // Acrylic cut shapes.
  const cutGrow = R - eff.paneClearance;
  const cuts = openings.map((o) => gc.t(gc.t(cutGrow > 0 ? o.cs.offset(cutGrow, 'Round', 2, segs(cutGrow)) : o.cs).simplify(0.002)));

  // Panes with numbering (top to bottom, left to right).
  const perBlock = new Map<string, number>();
  for (const o of openings) perBlock.set(o.blockId, (perBlock.get(o.blockId) ?? 0) + 1);
  const paneData = openings.map((o, i) => {
    const opening = toRings(o.cs);
    return {
      fill: o.fill,
      blockId: o.blockId,
      opening,
      cut: toRings(cuts[i]),
      label: labelPoint(opening),
      area: o.cs.area(),
      cs: cuts[i],
    };
  });
  const order = paneData
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ra = Math.round(-a.p.label[1] / 25);
      const rb = Math.round(-b.p.label[1] / 25);
      return ra !== rb ? ra - rb : a.p.label[0] - b.p.label[0];
    });
  const panes: PaneInfo[] = order.map(({ p }, k) => ({
    index: k + 1,
    fill: p.fill,
    blockId: p.blockId,
    split: (perBlock.get(p.blockId) ?? 0) > 1,
    opening: p.opening,
    cut: p.cut,
    label: p.label,
    area: p.area,
  }));
  const orderedCuts = order.map(({ p }) => p.cs);

  // Floating lead parts (not connected to the border).
  const frameB = ringsBounds([frameRing]);
  const islands: Rings[] = [];
  for (const comp of lead.decompose()) {
    gc.t(comp);
    const b = comp.bounds();
    const touchesBorder =
      b.min[0] <= frameB.minX + 1e-3 || b.min[1] <= frameB.minY + 1e-3 || b.max[0] >= frameB.maxX - 1e-3 || b.max[1] >= frameB.maxY - 1e-3;
    if (!touchesBorder) islands.push(toRings(comp));
  }
  if (islands.length) {
    warnings.push({
      code: 'islands',
      level: 'warn',
      message: `${islands.length} Chromteil${islands.length > 1 ? 'e liegen' : ' liegt'} lose (z. B. der Ring um eine Form auf einer anderen Form). ${islands.length > 1 ? 'Sie werden' : 'Es wird'} nur von den Scheiben gehalten – gut verkleben oder mit einer Bleilinie zum Rand verbinden.`,
    });
  }
  const sliverUnion = sliverParts.length ? unionOf(sliverParts) : null;
  const slivers = sliverUnion ? toRings(sliverUnion) : [];
  if (sliverUnion && sliverUnion.area() > 0.5) {
    warnings.push({
      code: 'slivers',
      level: 'info',
      message: `Sehr schmale Glasstellen (< ${fmt(m)} mm) werden mit Chrom gefüllt.`,
    });
  }
  if (!panes.length) {
    warnings.push({ code: 'empty', level: 'info', message: 'Noch keine Glasformen – links eine Form wählen und ins Bild ziehen.' });
  }

  const layout: Layout = {
    frame: [frameRing],
    lead: toRings(lead),
    stem: toRings(stem),
    panes,
    slivers,
    islands,
    warnings,
    bounds: frameB,
    eff,
    leadArea: lead.area(),
  };
  return { layout, cs: { frame, lead, back, cuts: orderedCuts } };
}
