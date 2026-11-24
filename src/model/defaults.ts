import type { Design, GlassColor, Params, Shape, Vec2 } from './types';

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
    version: 1,
    name,
    frame: { kind: 'rect', w: 300, h: 400, r: 0, points: [] },
    shapes: [],
    fills: [],
    palette: DEFAULT_PALETTE.map((c) => ({ ...c })),
    defaultFill: 'c-klar',
    params: { ...DEFAULT_PARAMS },
  };
}

export const line = (a: Vec2, b: Vec2): Shape => ({ id: newId(), kind: 'line', a, b });
export const circle = (x: number, y: number, r: number): Shape => ({
  id: newId(), kind: 'ellipse', x, y, rx: r, ry: r, rotation: 0,
});
export const ellipse = (x: number, y: number, rx: number, ry: number, rotation = 0): Shape => ({
  id: newId(), kind: 'ellipse', x, y, rx, ry, rotation,
});
export const rect = (x: number, y: number, w: number, h: number, r = 0, rotation = 0): Shape => ({
  id: newId(), kind: 'rect', x, y, w, h, r, rotation,
});
const seed = (x: number, y: number, fill: string) => ({ id: newId('f'), x, y, fill });

export interface Template {
  id: string;
  name: string;
  description: string;
  make: () => Design;
}

export const TEMPLATES: Template[] = [
  {
    id: 'leer',
    name: 'Leer',
    description: 'Rechteckiger Rahmen ohne Formen',
    make: () => base('Neuer Entwurf'),
  },
  {
    id: 'raster',
    name: 'Raster',
    description: '3 × 4 Felder mit Kreis in der Mitte',
    make: () => {
      const d = base('Raster');
      d.frame = { kind: 'rect', w: 300, h: 400, r: 0, points: [] };
      for (const x of [-50, 50]) d.shapes.push(line([x, -250], [x, 250]));
      for (const y of [-100, 0, 100]) d.shapes.push(line([-200, y], [200, y]));
      d.shapes.push(circle(0, 0, 40));
      d.fills.push(
        seed(0, 20, 'c-rot'), seed(0, -20, 'c-rot'),
        seed(-100, 150, 'c-blau'), seed(100, -150, 'c-blau'), seed(100, 150, 'c-tuerkis'), seed(-100, -150, 'c-tuerkis'),
        seed(0, 150, 'c-gelb'), seed(0, -150, 'c-gelb'),
      );
      return d;
    },
  },
  {
    id: 'rosette',
    name: 'Rosette',
    description: 'Rundes Fenster mit Speichen',
    make: () => {
      const d = base('Rosette');
      d.frame = { kind: 'ellipse', w: 400, h: 400, r: 0, points: [] };
      d.shapes.push(circle(0, 0, 50), circle(0, 0, 120));
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        d.shapes.push(line([Math.cos(a) * 50, Math.sin(a) * 50], [Math.cos(a) * 200, Math.sin(a) * 200]));
      }
      d.fills.push(seed(0, 0, 'c-gelb'));
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * Math.PI * 2;
        d.fills.push(seed(Math.cos(a) * 85, Math.sin(a) * 85, i % 2 ? 'c-rot' : 'c-rosa'));
        d.fills.push(seed(Math.cos(a) * 160, Math.sin(a) * 160, i % 2 ? 'c-blau' : 'c-tuerkis'));
      }
      return d;
    },
  },
  {
    id: 'sonne',
    name: 'Sonnenaufgang',
    description: 'Strahlen über einem Halbkreis',
    make: () => {
      const d = base('Sonnenaufgang');
      d.frame = { kind: 'rect', w: 420, h: 280, r: 0, points: [] };
      d.shapes.push(circle(0, -140, 80));
      const n = 9;
      for (let i = 1; i < n; i++) {
        const a = (i / n) * Math.PI;
        d.shapes.push(line([Math.cos(a) * 80, -140 + Math.sin(a) * 80], [Math.cos(a) * 400, -140 + Math.sin(a) * 400]));
      }
      d.fills.push(seed(0, -100, 'c-orange'));
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * Math.PI;
        d.fills.push(seed(Math.cos(a) * 150, -140 + Math.sin(a) * 150, i % 2 ? 'c-gelb' : 'c-klar'));
      }
      return d;
    },
  },
  {
    id: 'rauten',
    name: 'Rauten',
    description: 'Diagonales Rautenmuster',
    make: () => {
      const d = base('Rauten');
      d.frame = { kind: 'rect', w: 300, h: 300, r: 0, points: [] };
      for (let k = -300; k <= 300; k += 75) {
        d.shapes.push(line([k - 200, -200], [k + 200, 200]));
        d.shapes.push(line([k - 200, 200], [k + 200, -200]));
      }
      d.fills.push(seed(0, 37.5, 'c-violett'), seed(0, -37.5, 'c-violett'));
      return d;
    },
  },
  {
    id: 'blume',
    name: 'Blume',
    description: 'Blüte aus Ovalen mit Blättern',
    make: () => {
      const d = base('Blume');
      d.frame = { kind: 'rect', w: 320, h: 320, r: 20, points: [] };
      d.shapes.push(circle(0, 20, 28));
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 360;
        const rad = (a * Math.PI) / 180;
        d.shapes.push(ellipse(Math.cos(rad) * 62, 20 + Math.sin(rad) * 62, 42, 26, a));
      }
      d.shapes.push(line([0, -60], [0, -170]));
      d.shapes.push(ellipse(-36, -112, 40, 16, 30), ellipse(36, -112, 40, 16, -30));
      d.fills.push(seed(0, 20, 'c-gelb'));
      for (let i = 0; i < n; i++) {
        const rad = (((i / n) * 360) * Math.PI) / 180;
        d.fills.push(seed(Math.cos(rad) * 70, 20 + Math.sin(rad) * 70, 'c-rot'));
      }
      d.fills.push(seed(-40, -114, 'c-gruen'), seed(40, -114, 'c-gruen'));
      d.fills.push(seed(-120, 120, 'c-tuerkis'));
      return d;
    },
  },
];

export function defaultDesign(): Design {
  return TEMPLATES[1].make();
}
