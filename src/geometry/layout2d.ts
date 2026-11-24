// 2D layout: from shapes to lead lines, panes (openings), stem and acrylic
// cut shapes. Everything is computed with Manifold's CrossSection (Clipper2).
import type { CrossSection, ManifoldToplevel } from 'manifold-3d';
import type { Design, Params, Vec2 } from '../model/types';
import { SOLID } from '../model/types';
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
  /** Raw glass/solid regions between the leads (for the paint bucket). */
  regions: { rings: Rings; fill: string }[];
  solids: Rings[];
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
  const border = gc.t(frame.subtract(inner));

  // Strokes of all shape outlines + lines.
  const strokes: CrossSection[] = [];
  for (const s of design.shapes) {
    if (s.kind === 'line') {
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      if (len < 1e-6) continue;
      strokes.push(gc.t(new CrossSection([segmentStroke(s.a, s.b, hw)], 'Positive')));
      continue;
    }
    const outline = shapeOutline(s);
    if (!outline) continue;
    const p = gc.t(new CrossSection([outline], 'Positive'));
    if (p.isEmpty()) continue;
    const outer = gc.t(p.offset(hw, 'Round', 2, segs(hw)));
    const innerS = gc.t(p.offset(-hw, 'Round', 2, segs(hw)));
    strokes.push(gc.t(outer.subtract(innerS)));
  }
  const empty = () => gc.t(frame.subtract(frame));
  const unionOf = (list: CrossSection[]) => (list.length ? gc.t(CrossSection.union(list)) : empty());
  const strokeUnion = unionOf(strokes);
  const lead0 = gc.t(border.add(gc.t(strokeUnion.intersect(frame))));

  // Glass regions.
  const glassAll = gc.t(frame.subtract(lead0));
  const regions = glassAll.decompose().map((r) => gc.t(r));

  const solids: Rings[] = [];
  const rawRegions: { rings: Rings; fill: string }[] = [];
  const sliverParts: CrossSection[] = [];
  const openings: { cs: CrossSection; fill: string }[] = [];
  const m = eff.minPaneWidth;
  const rc = eff.cornerRadius;
  const minArea = Math.max(1, m * m * 0.5);

  for (const region of regions) {
    const rings = toRings(region);
    let fill = design.defaultFill;
    for (let i = design.fills.length - 1; i >= 0; i--) {
      const f = design.fills[i];
      if (pointInRings([f.x, f.y], rings)) {
        fill = f.fill;
        break;
      }
    }
    rawRegions.push({ rings, fill });
    if (fill === SOLID) {
      solids.push(rings);
      continue;
    }
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
    for (const comp of g.decompose()) {
      gc.t(comp);
      if (comp.area() < minArea) {
        sliverParts.push(comp);
        continue;
      }
      openings.push({ cs: comp, fill });
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
  const paneData = openings.map((o, i) => {
    const opening = toRings(o.cs);
    return {
      fill: o.fill,
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
      message: `${islands.length} Bleiteil${islands.length > 1 ? 'e schweben' : ' schwebt'} frei (nicht mit dem Rahmen verbunden). Mit einer Linie verbinden.`,
    });
  }
  const sliverUnion = sliverParts.length ? unionOf(sliverParts) : null;
  const slivers = sliverUnion ? toRings(sliverUnion) : [];
  if (sliverUnion && sliverUnion.area() > 0.5) {
    warnings.push({
      code: 'slivers',
      level: 'info',
      message: `Schmale Glasflächen (< ${fmt(m)} mm) werden massiv gefüllt.`,
    });
  }
  if (!panes.length) {
    warnings.push({ code: 'empty', level: 'info', message: 'Noch keine Glasflächen.' });
  }

  const layout: Layout = {
    frame: [frameRing],
    lead: toRings(lead),
    stem: toRings(stem),
    panes,
    regions: rawRegions,
    solids,
    slivers,
    islands,
    warnings,
    bounds: frameB,
    eff,
    leadArea: lead.area(),
  };
  return { layout, cs: { frame, lead, back, cuts: orderedCuts } };
}
