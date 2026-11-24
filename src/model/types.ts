// Design data model. All lengths in millimetres.
// World coordinates: origin at the panel centre, x to the right, y UP
// (the 2D editor flips y for display). The front (visible, chrome) side of
// the printed part faces +z; the back (light side, glass inserted) is z = 0.
//
// Model: every closed shape is a BLOCK = one acrylic pane. Everything that is
// not a block is solid chrome. Blocks later in the list lie on top and cut
// into the blocks below (always leaving one lead width of chrome between).
// Lines are lead lines that split blocks into separate panes.

export type Vec2 = [number, number];

interface ShapeBase {
  id: string;
}

interface BlockBase extends ShapeBase {
  /** Glass colour id. */
  fill: string;
  /** Centre. */
  x: number;
  y: number;
  /** Rotation in degrees, counter-clockwise. */
  rotation: number;
}

export interface RectShape extends BlockBase {
  kind: 'rect';
  w: number;
  h: number;
  /** Corner radius. */
  r: number;
}

export interface EllipseShape extends BlockBase {
  kind: 'ellipse';
  rx: number;
  ry: number;
}

/** Regular polygon (triangle, hexagon …) stretched to fit its box. */
export interface NgonShape extends BlockBase {
  kind: 'ngon';
  rx: number;
  ry: number;
  sides: number;
}

export type ArchStyle = 'round' | 'pointed';

/** Window-arch: straight sides with a round or pointed top. */
export interface ArchShape extends BlockBase {
  kind: 'arch';
  w: number;
  h: number;
  style: ArchStyle;
}

/** Free polygon block (absolute points). */
export interface PolygonShape extends ShapeBase {
  kind: 'polygon';
  fill: string;
  points: Vec2[];
}

/** A lead line between two points (splits blocks). */
export interface LineShape extends ShapeBase {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}

export type BlockShape = RectShape | EllipseShape | NgonShape | ArchShape | PolygonShape;
export type Shape = BlockShape | LineShape;
export type ShapeKind = Shape['kind'];

export function isBlock(s: Shape): s is BlockShape {
  return s.kind !== 'line';
}

export type FrameKind = 'rect' | 'ellipse' | 'polygon';

export interface Frame {
  kind: FrameKind;
  /** Outer width / height (rect + ellipse). */
  w: number;
  h: number;
  /** Outer corner radius (rect). */
  r: number;
  /** Custom outline (polygon), absolute world coordinates. */
  points: Vec2[];
}

export interface GlassColor {
  id: string;
  name: string;
  hex: string;
}

/** Colour override for one pane of a block that a lead line split up. */
export interface FillSeed {
  id: string;
  x: number;
  y: number;
  fill: string;
}

export interface Params {
  /** Visible width of the lead between two panes (front). */
  leadWidth: number;
  /** Radius of the rounded top edge of the leads. leadWidth/2 = half round. */
  edgeRadius: number;
  /** Width of the step (rabbet) on the back each side of a lead. */
  stepWidth: number;
  /** Acrylic thickness. */
  glassThickness: number;
  /** Extra step depth beyond the glass thickness (glue / tolerance). */
  stepExtra: number;
  /** Material above the step (the visible cap). */
  capThickness: number;
  /** Width of the outer border. */
  frameWidth: number;
  /** Round the outer edge of the border too. */
  roundOuterEdge: boolean;
  /** Corner radius of the openings (top view). */
  cornerRadius: number;
  /** Narrower glass areas than this become solid. */
  minPaneWidth: number;
  /** Gap between acrylic pane and the step wall (per side). */
  paneClearance: number;
  /** Max piece size that fits the printer (A1 mini: 180). */
  bedSize: number;
  /** Safety margin subtracted from the bed size. */
  bedMargin: number;
  /** Let seams pass through openings (acrylic bridges the seam). */
  seamsThroughPanes: boolean;
}

export interface Design {
  version: 2;
  name: string;
  frame: Frame;
  /** Bottom to top. */
  shapes: Shape[];
  /** Per-pane colour overrides (only needed for blocks split by lines). */
  fills: FillSeed[];
  palette: GlassColor[];
  params: Params;
}
