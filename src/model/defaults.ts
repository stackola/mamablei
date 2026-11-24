import type { BlockShape, Design, GlassColor, Params, Shape, Vec2 } from './types';

let idCounter = 0;
export function newId(prefix = 's'): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export const DEFAULT_PARAMS: Params = {
  leadWidth: 4,
  edgeRadius: 1.6,
  stepWidth: 1.2,
  glassThickness: 2,
  stepExtra: 0.4,
  capThickness: 2,
  frameWidth: 12,
  roundOuterEdge: true,
  cornerRadius: 0.6,
  minPaneWidth: 4,
  paneClearance: 0.2,
  bedSize: 180,
  bedMargin: 5,
  seamsThroughPanes: true,
};

export const DEFAULT_PALETTE: GlassColor[] = [
  { id: 'c-klar', name: 'Klar', hex: '#dfeef2' },
  { id: 'c-rot', name: 'Rot', hex: '#c0392b' },
  { id: 'c-rosa', name: 'Rosa', hex: '#e79aa6' },
  { id: 'c-orange', name: 'Orange', hex: '#e67e22' },
  { id: 'c-gelb', name: 'Bernstein', hex: '#e9b44c' },
  { id: 'c-gruen', name: 'Grün', hex: '#4f9a4a' },
  { id: 'c-tuerkis', name: 'Türkis', hex: '#3fb0ac' },
  { id: 'c-blau', name: 'Blau', hex: '#2e6fb7' },
  { id: 'c-violett', name: 'Violett', hex: '#7d4f9e' },
];

function base(name: string): Design {
  return {
    version: 2,
    name,
    frame: { kind: 'rect', w: 300, h: 400, r: 0, points: [] },
    shapes: [],
    fills: [],
    palette: DEFAULT_PALETTE.map((c) => ({ ...c })),
    params: { ...DEFAULT_PARAMS },
  };
}

// ---- block factories
export const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0, rotation = 0): BlockShape => ({
  id: newId(), kind: 'rect', x, y, w, h, r, rotation, fill,
});
export const circle = (x: number, y: number, r: number, fill: string): BlockShape => ({
  id: newId(), kind: 'ellipse', x, y, rx: r, ry: r, rotation: 0, fill,
});
export const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, rotation = 0): BlockShape => ({
  id: newId(), kind: 'ellipse', x, y, rx, ry, rotation, fill,
});
export const ngon = (x: number, y: number, rx: number, ry: number, sides: number, fill: string, rotation = 0): BlockShape => ({
  id: newId(), kind: 'ngon', x, y, rx, ry, sides, rotation, fill,
});
export const arch = (x: number, y: number, w: number, h: number, fill: string, style: 'round' | 'pointed' = 'round'): BlockShape => ({
  id: newId(), kind: 'arch', x, y, w, h, style, rotation: 0, fill,
});
export const line = (a: Vec2, b: Vec2): Shape => ({ id: newId(), kind: 'line', a, b });

/** Rectangles filling [x0,x1]×[y0,y1] with `gap` between them. */
function grid(x0: number, y0: number, x1: number, y1: number, cols: number, rows: number, gap: number, fillAt: (c: number, r: number) => string): BlockShape[] {
  const w = (x1 - x0 - (cols - 1) * gap) / cols;
  const h = (y1 - y0 - (rows - 1) * gap) / rows;
  const out: BlockShape[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(rect(x0 + c * (w + gap) + w / 2, y1 - r * (h + gap) - h / 2, w, h, fillAt(c, r)));
    }
  }
  return out;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  make: () => Design;
}

const G = DEFAULT_PARAMS.leadWidth;
const F = DEFAULT_PARAMS.frameWidth;

export const TEMPLATES: Template[] = [
  {
    id: 'leer',
    name: 'Leer',
    description: 'Nur der Rahmen',
    make: () => base('Neuer Entwurf'),
  },
  {
    id: 'raster',
    name: 'Fenster',
    description: '3 × 4 Scheiben mit Kreis',
    make: () => {
      const d = base('Fenster');
      const hw = 150 - F;
      const hh = 200 - F;
      const colors = ['c-blau', 'c-klar', 'c-tuerkis'];
      d.shapes.push(...grid(-hw, -hh, hw, hh, 3, 4, G, (c, r) => (r === 0 || r === 3 ? colors[(c + r) % 3] : 'c-klar')));
      d.shapes.push(circle(0, 0, 50, 'c-rot'));
      return d;
    },
  },
  {
    id: 'rosette',
    name: 'Rosette',
    description: 'Rundes Fenster mit Blütenblättern',
    make: () => {
      const d = base('Rosette');
      d.frame = { kind: 'ellipse', w: 400, h: 400, r: 0, points: [] };
      d.shapes.push(circle(0, 0, 200, 'c-blau'));
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 360;
        const t = (a * Math.PI) / 180;
        d.shapes.push(ellipse(Math.cos(t) * 112, Math.sin(t) * 112, 52, 22, i % 2 ? 'c-rot' : 'c-rosa', a));
      }
      d.shapes.push(circle(0, 0, 44, 'c-gelb'));
      return d;
    },
  },
  {
    id: 'bogen',
    name: 'Bogenfenster',
    description: 'Rundbogen mit Rose und zwei Feldern',
    make: () => {
      const d = base('Bogenfenster');
      d.frame = { kind: 'rect', w: 280, h: 420, r: 0, points: [] };
      const hw = 140 - F;
      const hh = 210 - F;
      const split = -70;
      d.shapes.push(arch(0, (split + G + hh) / 2, 2 * hw, hh - split - G, 'c-tuerkis'));
      d.shapes.push(...grid(-hw, -hh, hw, split, 2, 1, G, (c) => (c ? 'c-gelb' : 'c-orange')));
      d.shapes.push(circle(0, 70, 52, 'c-rot'));
      return d;
    },
  },
  {
    id: 'waben',
    name: 'Waben',
    description: 'Sechsecke in Bienenwaben-Anordnung',
    make: () => {
      const d = base('Waben');
      d.frame = { kind: 'rect', w: 320, h: 320, r: 0, points: [] };
      const R = 34;
      const across = Math.sqrt(3) * R + G;
      const colors = ['c-gelb', 'c-orange', 'c-gelb', 'c-klar', 'c-rot'];
      let k = 0;
      for (let row = -4; row <= 4; row++) {
        const y = row * across * (Math.sqrt(3) / 2);
        const off = row % 2 ? across / 2 : 0;
        for (let col = -4; col <= 4; col++) {
          const x = col * across + off;
          if (Math.abs(x) > 190 || Math.abs(y) > 190) continue;
          d.shapes.push(ngon(x, y, (Math.sqrt(3) * R) / 2, R, 6, colors[k++ % colors.length]));
        }
      }
      return d;
    },
  },
  {
    id: 'blume',
    name: 'Blume',
    description: 'Blüte mit Stiel und Blättern',
    make: () => {
      const d = base('Blume');
      d.frame = { kind: 'rect', w: 320, h: 320, r: 20, points: [] };
      const hw = 160 - F;
      d.shapes.push(rect(0, 0, 2 * hw, 2 * hw, 'c-klar'));
      d.shapes.push(rect(0, -95, 8, 110, 'c-gruen'));
      d.shapes.push(ellipse(-34, -105, 34, 14, 'c-gruen', 30), ellipse(34, -105, 34, 14, 'c-gruen', -30));
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 360 + 90;
        const t = (a * Math.PI) / 180;
        d.shapes.push(ellipse(Math.cos(t) * 58, 30 + Math.sin(t) * 58, 40, 24, 'c-rot', a));
      }
      d.shapes.push(circle(0, 30, 26, 'c-gelb'));
      return d;
    },
  },
  {
    id: 'rauten',
    name: 'Rauten',
    description: 'Rautenmuster',
    make: () => {
      const d = base('Rauten');
      d.frame = { kind: 'rect', w: 300, h: 300, r: 0, points: [] };
      const s = 34;
      const a = s + G / Math.SQRT2;
      let k = 0;
      for (let j = -5; j <= 5; j++) {
        for (let i = -5; i <= 5; i++) {
          for (const off of [0, a]) {
            const x = i * 2 * a + off;
            const y = j * 2 * a + off;
            if (Math.abs(x) > 175 || Math.abs(y) > 175) continue;
            d.shapes.push(ngon(x, y, s, s, 4, off ? 'c-violett' : (k++ % 3 ? 'c-klar' : 'c-rosa')));
          }
        }
      }
      return d;
    },
  },
];

export function defaultDesign(): Design {
  return TEMPLATES[1].make();
}

/** Bring older or foreign files into the current format. */
export function migrateDesign(raw: unknown): Design | null {
  const d = raw as Record<string, unknown> & { version?: number };
  if (!d || typeof d !== 'object' || !d.frame || !Array.isArray(d.shapes)) return null;
  if (d.version === 2) return d as unknown as Design;
  if (d.version === 1) {
    // v1: shapes were lead outlines; turn them into blocks with the default colour.
    const fill = (d.defaultFill as string) || 'c-klar';
    const shapes = (d.shapes as Record<string, unknown>[]).map((s) => (s.kind === "line" ? s : { ...s, fill })) as unknown as Shape[];
    return {
      version: 2,
      name: (d.name as string) || 'Entwurf',
      frame: d.frame as Design['frame'],
      shapes,
      fills: [],
      palette: (d.palette as GlassColor[]) || DEFAULT_PALETTE,
      params: { ...DEFAULT_PARAMS, ...(d.params as Partial<Params>) },
    };
  }
  return null;
}
