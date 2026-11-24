// Design data model. All lengths in millimetres.
// World coordinates: origin at the panel centre, x to the right, y UP
// (the 2D editor flips y for display). The front (visible, chrome) side of
// the printed part faces +z; the back (light side, glass inserted) is z = 0.

export type Vec2 = [number, number];

interface ShapeBase {
  id: string;
}

/** Closed shapes have a centre and a rotation (degrees, counter-clockwise). */
export interface RectShape extends ShapeBase {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius of the drawn outline (not the opening corner radius). */
  r: number;
  rotation: number;
}

export interface EllipseShape extends ShapeBase {
  kind: 'ellipse';
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotation: number;
}

/** A straight lead line between two points. */
export interface LineShape extends ShapeBase {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}

/** A closed polygon (absolute points). */
export interface PolygonShape extends ShapeBase {
  kind: 'polygon';
  points: Vec2[];
}

export type Shape = RectShape | EllipseShape | LineShape | PolygonShape;
export type ShapeKind = Shape['kind'];

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

/** Paint-bucket seed: the region that contains (x, y) gets this fill. */
export interface FillSeed {
  id: string;
  x: number;
  y: number;
  /** A GlassColor id, or 'solid' for filled chrome. */
  fill: string;
}

export const SOLID = 'solid';

export interface Params {
  /** Visible width of the lead lines on the front (= gap between panes). */
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
  version: 1;
  name: string;
  frame: Frame;
  shapes: Shape[];
  fills: FillSeed[];
  palette: GlassColor[];
  /** Colour id used for regions without a seed. */
  defaultFill: string;
  params: Params;
}
