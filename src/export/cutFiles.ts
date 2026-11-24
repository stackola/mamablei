// Cutting files for the acrylic panes: SVG + DXF (laser, one sheet set per
// colour) and a 1:1 PDF on A4 pages (paper templates).
import { strToU8, zipSync } from 'fflate';
import { jsPDF } from 'jspdf';
import type { Layout, PaneInfo, Rings } from '../geometry/layout2d';
import { ringsBounds } from '../geometry/shapes2d';
import type { GlassColor, Vec2 } from '../model/types';

export interface SheetOptions {
  width: number;
  height: number;
  gap: number;
}

interface Placed {
  pane: PaneInfo;
  rings: Rings;
  label: Vec2;
}

interface Sheet {
  placed: Placed[];
  w: number;
  h: number;
}

const safe = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'entwurf';

function transform(rings: Rings, f: (p: Vec2) => Vec2): Rings {
  return rings.map((r) => r.map(f));
}

/** Shelf packing of panes onto sheets (y up, origin bottom-left). */
export function packPanes(panes: PaneInfo[], opt: SheetOptions): Sheet[] {
  const items = panes.map((p) => {
    const b = ringsBounds(p.cut);
    let w = b.maxX - b.minX;
    let h = b.maxY - b.minY;
    let rotate = false;
    if (w > opt.width - 2 * opt.gap && h <= opt.width - 2 * opt.gap) {
      rotate = true;
      [w, h] = [h, w];
    }
    return { p, b, w, h, rotate };
  });
  items.sort((a, b) => b.h - a.h);
  const sheets: Sheet[] = [];
  let cur: Sheet | null = null;
  let x = 0;
  let y = 0;
  let shelfH = 0;
  const startSheet = (w: number, h: number): Sheet => {
    const sh: Sheet = { placed: [], w: Math.max(opt.width, w + 2 * opt.gap), h: Math.max(opt.height, h + 2 * opt.gap) };
    sheets.push(sh);
    x = opt.gap;
    y = opt.gap;
    shelfH = 0;
    return sh;
  };
  for (const it of items) {
    const fitsSheet = it.w + 2 * opt.gap <= opt.width && it.h + 2 * opt.gap <= opt.height;
    let sheet: Sheet = cur ?? startSheet(it.w, it.h);
    if (x + it.w + opt.gap > sheet.w) {
      x = opt.gap;
      y += shelfH + opt.gap;
      shelfH = 0;
    }
    if (y + it.h + opt.gap > sheet.h || !fitsSheet) sheet = startSheet(it.w, it.h);
    cur = sheet;
    const ox = x;
    const oy = y;
    const f = (q: Vec2): Vec2 => {
      const lx = q[0] - it.b.minX;
      const ly = q[1] - it.b.minY;
      return it.rotate ? [ox + (it.b.maxY - it.b.minY) - ly, oy + lx] : [ox + lx, oy + ly];
    };
    sheet.placed.push({ pane: it.p, rings: transform(it.p.cut, f), label: f(it.p.label) });
    x += it.w + opt.gap;
    shelfH = Math.max(shelfH, it.h);
    // an oversize pane gets a sheet of its own
    if (!fitsSheet) cur = null;
  }
  return sheets;
}

function svgOf(sheet: Sheet, colorName: string): string {
  const H = sheet.h;
  const paths = sheet.placed
    .map((pl) => {
      const d = pl.rings
        .map((r) => `M${r.map(([x, y]) => `${x.toFixed(3)},${(H - y).toFixed(3)}`).join('L')}Z`)
        .join('');
      return `<path d="${d}"/>`;
    })
    .join('\n    ');
  const texts = sheet.placed
    .map((pl) => `<text x="${pl.label[0].toFixed(2)}" y="${(H - pl.label[1]).toFixed(2)}">${pl.pane.index}</text>`)
    .join('\n    ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.w}mm" height="${H}mm" viewBox="0 0 ${sheet.w} ${H}">
  <title>${colorName}</title>
  <!-- rot = schneiden, blau = Nummern (optional gravieren) -->
  <g id="schnitt" fill="none" stroke="#ff0000" stroke-width="0.1">
    ${paths}
  </g>
  <g id="nummern" fill="#0000ff" font-family="Arial, Helvetica, sans-serif" font-size="5" text-anchor="middle" dominant-baseline="central">
    ${texts}
  </g>
</svg>
`;
}

function dxfOf(sheet: Sheet): string {
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const pl of sheet.placed) {
    for (const r of pl.rings) {
      out.push('0', 'POLYLINE', '8', 'SCHNITT', '66', '1', '70', '1');
      for (const [x, y] of r) out.push('0', 'VERTEX', '8', 'SCHNITT', '10', x.toFixed(4), '20', y.toFixed(4));
      out.push('0', 'SEQEND', '8', 'SCHNITT');
    }
    out.push('0', 'TEXT', '8', 'NUMMER', '10', (pl.label[0] - 1.5).toFixed(3), '20', (pl.label[1] - 2).toFixed(3), '40', '4', '1', String(pl.pane.index));
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

function byColor(layout: Layout, palette: GlassColor[]) {
  const groups = new Map<string, PaneInfo[]>();
  for (const p of layout.panes) {
    if (!groups.has(p.fill)) groups.set(p.fill, []);
    groups.get(p.fill)!.push(p);
  }
  return [...groups.entries()].map(([id, panes]) => ({
    color: palette.find((c) => c.id === id) ?? { id, name: id, hex: '#cccccc' },
    panes,
  }));
}

export function makeLaserZip(layout: Layout, palette: GlassColor[], base: string, opt: SheetOptions, kind: 'svg' | 'dxf'): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const { color, panes } of byColor(layout, palette)) {
    const sheets = packPanes(panes, opt);
    sheets.forEach((s, i) => {
      const name = `${safe(base)}-${safe(color.name)}-${i + 1}.${kind}`;
      files[name] = strToU8(kind === 'svg' ? svgOf(s, color.name) : dxfOf(s));
    });
  }
  const list = layout.panes.map((p) => `${p.index}\t${palette.find((c) => c.id === p.fill)?.name ?? p.fill}`).join('\n');
  files['liste.txt'] = strToU8(`Nr\tFarbe\n${list}\n`);
  return zipSync(files);
}

// ---------------------------------------------------------------- PDF

const A4W = 210;
const A4H = 297;
const MARGIN = 10;

function drawRings(doc: jsPDF, rings: Rings, map: (p: Vec2) => Vec2, style: 'S' | 'F' | 'FD' = 'S') {
  for (const r of rings) {
    if (r.length < 2) continue;
    const [x0, y0] = map(r[0]);
    doc.moveTo(x0, y0);
    for (let i = 1; i < r.length; i++) {
      const [x, y] = map(r[i]);
      doc.lineTo(x, y);
    }
    doc.close();
  }
  if (style === 'S') doc.stroke();
  else if (style === 'F') doc.fillEvenOdd();
  else doc.fillStrokeEvenOdd();
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lighten([r, g, b]: [number, number, number], k: number): [number, number, number] {
  return [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k].map(Math.round) as [number, number, number];
}

export interface TemplateOptions {
  /** Free space between two templates (mm), room for scissors / saw. */
  gap: number;
}

interface PdfItem {
  pane: PaneInfo;
  /** Pane outline turned to its tightest upright position (never mirrored). */
  rings: Rings;
  label: Vec2;
  b: { minX: number; minY: number; maxX: number; maxY: number };
  w: number;
  h: number;
}

function rotateRings(rings: Rings, deg: number): Rings {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return rings.map((r) => r.map(([x, y]) => [x * c - y * sn, x * sn + y * c] as Vec2));
}

/** Rotation (degrees) that gives the smallest bounding box, landscape first. */
function bestRotation(rings: Rings, maxW: number, maxH: number): number {
  const pts = rings.flat();
  let best = 0;
  let bestArea = Infinity;
  for (let deg = 0; deg < 180; deg += 1) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      const rx = x * c - y * sn;
      const ry = x * sn + y * c;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea - 1e-6) {
      bestArea = area;
      best = deg;
    }
  }
  // prefer landscape, unless only portrait fits the page
  const b = ringsBounds(rotateRings(rings, best));
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (h > w && h <= maxW && w <= maxH) best += 90;
  else if (w > maxW && h <= maxW && w <= maxH) best += 90;
  return best;
}

/** Item coordinates (y up) → paper (y down) with the item's top-left at (px, py). */
function itemMap(it: PdfItem, px: number, py: number) {
  return (q: Vec2): Vec2 => [px + q[0] - it.b.minX, py + (it.b.maxY - q[1])];
}

/**
 * Paper templates: an overview page (where each numbered pane goes) followed
 * by every pane as a separate 1:1 template with generous space around it, so
 * a single print can be cut apart by hand. Sorted by colour.
 */
export function makeTemplatePDF(layout: Layout, palette: GlassColor[], title: string, opt: TemplateOptions = { gap: 12 }): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const colorOf = (id: string) => palette.find((c) => c.id === id) ?? { id, name: id, hex: '#cccccc' };
  const G = Math.max(0, opt.gap);
  const PW = A4W - 2 * MARGIN; // usable width
  const PH = A4H - 2 * MARGIN - 10; // usable height (footer below)

  // ---------------- overview page
  const fb = ringsBounds(layout.frame);
  const W = fb.maxX - fb.minX;
  const H = fb.maxY - fb.minY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`${title} – Schnittvorlagen`, MARGIN, MARGIN + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    [
      `Fenster ${Math.round(W)} × ${Math.round(H)} mm · ${layout.panes.length} Scheiben. Diese Übersicht zeigt, wohin jede Nummer gehört.`,
      'Mit 100 % / „Originalgröße“ drucken (nicht „an Seite anpassen“) und den 50-mm-Balken nachmessen.',
      'Jede Schablone entlang der schwarzen Linie ausschneiden, auf Acryl in der angegebenen Farbe kleben und aussägen.',
    ],
    MARGIN,
    MARGIN + 13,
  );
  const ovTop = MARGIN + 30;
  const ovH = 170;
  const s = Math.min(PW / W, ovH / H);
  const ox = MARGIN + (PW - W * s) / 2;
  const ovMap = (q: Vec2): Vec2 => [ox + (q[0] - fb.minX) * s, ovTop + (fb.maxY - q[1]) * s];
  doc.setFillColor(205, 210, 216);
  doc.setDrawColor(90, 90, 90);
  doc.setLineWidth(0.3);
  drawRings(doc, layout.frame, ovMap, 'FD');
  doc.setLineWidth(0.1);
  for (const p of layout.panes) {
    doc.setFillColor(...lighten(hexRgb(colorOf(p.fill).hex), 0.3));
    drawRings(doc, p.opening, ovMap, 'FD');
  }
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(5, Math.min(10, 60 * s)));
  for (const p of layout.panes) {
    const [x, y] = ovMap(p.label);
    doc.text(String(p.index), x, y, { align: 'center', baseline: 'middle' });
  }
  // colour list
  let ly = ovTop + H * s + 10;
  doc.setFontSize(10);
  doc.text('Farben', MARGIN, ly);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  ly += 5;
  const order = palette.map((c) => c.id);
  const groups = new Map<string, PaneInfo[]>();
  for (const p of layout.panes) {
    if (!groups.has(p.fill)) groups.set(p.fill, []);
    groups.get(p.fill)!.push(p);
  }
  const groupIds = [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const id of groupIds) {
    const panes = groups.get(id)!;
    const c = colorOf(id);
    doc.setFillColor(...hexRgb(c.hex));
    doc.rect(MARGIN, ly - 3, 5, 4, 'F');
    const area = panes.reduce((a, p) => a + Math.abs(ringsArea(p.cut)), 0) / 100;
    const nums = panes.map((p) => p.index).join(', ');
    const lines = doc.splitTextToSize(`${c.name}: ${panes.length} Stück, ca. ${area.toFixed(0)} cm² – Nr. ${nums}`, PW - 8) as string[];
    doc.text(lines, MARGIN + 7, ly);
    ly += 4.5 * lines.length + 1;
    if (ly > A4H - MARGIN - 12) break;
  }

  // ---------------- template pages
  const items: PdfItem[] = layout.panes.map((pane) => {
    const deg = bestRotation(pane.cut, PW, PH);
    const rings = rotateRings(pane.cut, deg);
    const label = rotateRings([[pane.label]], deg)[0][0];
    const b = ringsBounds(rings);
    return { pane, rings, label, b, w: b.maxX - b.minX, h: b.maxY - b.minY };
  });
  items.sort((a, b) => order.indexOf(a.pane.fill) - order.indexOf(b.pane.fill) || b.h - a.h || a.pane.index - b.pane.index);
  const normal = items.filter((it) => it.w <= PW && it.h <= PH);
  const oversize = items.filter((it) => it.w > PW || it.h > PH);

  const drawTemplate = (it: PdfItem, map: (q: Vec2) => Vec2) => {
    const c = colorOf(it.pane.fill);
    doc.setFillColor(...lighten(hexRgb(c.hex), 0.8));
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.35);
    drawRings(doc, it.rings, map, 'FD');
    const [x, y] = map(it.label);
    const small = Math.min(it.w, it.h) < 18;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(small ? 8 : 14);
    doc.text(String(it.pane.index), x, y - (small ? 0.8 : 1.5), { align: 'center', baseline: 'middle' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(small ? 5.5 : 8);
    doc.text(c.name, x, y + (small ? 2 : 3.5), { align: 'center', baseline: 'middle' });
  };

  // shelf packing with generous gaps; small panes may fill gaps in earlier
  // shelves of the same page (first fit)
  interface Shelf {
    y: number;
    h: number;
    x: number;
  }
  let shelves: Shelf[] | null = null;
  const nextY = () => (shelves && shelves.length ? shelves[shelves.length - 1].y + shelves[shelves.length - 1].h + G : 0);
  for (const it of normal) {
    let spot = shelves?.find((sh) => sh.h >= it.h && sh.x + it.w <= PW) ?? null;
    if (!spot) {
      if (!shelves || nextY() + it.h > PH) {
        doc.addPage();
        shelves = [];
      }
      spot = { y: nextY(), h: it.h, x: 0 };
      shelves!.push(spot);
    }
    drawTemplate(it, itemMap(it, MARGIN + spot.x, MARGIN + spot.y));
    spot.x += it.w + G;
  }

  // panes larger than a page: tiled across several sheets
  for (const it of oversize) {
    const cols = Math.ceil(it.w / PW);
    const rows = Math.ceil(it.h / PH);
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        doc.addPage();
        const map0 = itemMap(it, MARGIN - cIdx * PW, MARGIN - r * PH);
        doc.saveGraphicsState();
        doc.rect(MARGIN, MARGIN, PW, PH, null);
        doc.clip();
        doc.discardPath();
        drawTemplate(it, map0);
        doc.restoreGraphicsState();
        doc.setDrawColor(214, 51, 132);
        doc.setLineWidth(0.2);
        doc.setLineDashPattern([2, 2], 0);
        doc.rect(MARGIN, MARGIN, PW, PH, 'S');
        doc.setLineDashPattern([], 0);
        doc.setTextColor(214, 51, 132);
        doc.setFontSize(9);
        doc.text(
          `Große Scheibe ${it.pane.index}: Blatt ${r * cols + cIdx + 1} von ${rows * cols} (Zeile ${r + 1}, Spalte ${cIdx + 1}) – Blätter an der gestrichelten Linie aneinanderkleben`,
          MARGIN,
          MARGIN - 3,
        );
      }
    }
  }

  // footers with page numbers + scale bar
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${title} · Schnittvorlagen · Seite ${i - 1} von ${total - 1}`, MARGIN, A4H - MARGIN);
    const bx = A4W - MARGIN - 50;
    const by = A4H - MARGIN - 1;
    doc.setLineWidth(0.4);
    doc.setDrawColor(0, 0, 0);
    doc.line(bx, by, bx + 50, by);
    doc.line(bx, by - 1.5, bx, by + 1.5);
    doc.line(bx + 50, by - 1.5, bx + 50, by + 1.5);
    doc.setFontSize(7);
    doc.text('50 mm', bx + 25, by - 1.2, { align: 'center' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

function ringsArea(rings: Rings): number {
  let a = 0;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  }
  return a / 2;
}

export { safe as safeFileName };
