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
const CW = A4W - 2 * MARGIN;
const CH = A4H - 2 * MARGIN - 8; // room for footer

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

export function makeTemplatePDF(layout: Layout, palette: GlassColor[], title: string): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const colorOf = (id: string) => palette.find((c) => c.id === id) ?? { id, name: id, hex: '#cccccc' };
  const all = [layout.frame[0], ...layout.panes.flatMap((p) => p.cut)];
  const b = ringsBounds(all);
  const W = b.maxX - b.minX;
  const H = b.maxY - b.minY;
  const cols = Math.max(1, Math.ceil(W / CW));
  const rows = Math.max(1, Math.ceil(H / CH));
  const ox = b.minX - (cols * CW - W) / 2;
  const oy = b.maxY + (rows * CH - H) / 2; // top edge (y up)
  const ROWS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // --- overview page
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`${title} – Glasschablonen 1:1`, MARGIN, MARGIN + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    [
      `Format ${Math.round(W)} × ${Math.round(H)} mm · ${layout.panes.length} Scheiben · ${cols * rows} Schablonenseiten (${rows} Zeilen × ${cols} Spalten)`,
      'Mit 100 % / „Originalgröße“ drucken (nicht „an Seite anpassen“). Den 50-mm-Balken nachmessen.',
      'Schnittlinie = Außenkontur der Acrylscheibe (inkl. Falz, abzüglich Spiel). Seiten an den Eckmarken aneinanderlegen.',
    ],
    MARGIN,
    MARGIN + 13,
  );
  const ovTop = MARGIN + 30;
  const ovH = 150;
  const s = Math.min(CW / (cols * CW), ovH / (rows * CH));
  const ovMap = (p: Vec2): Vec2 => [MARGIN + (p[0] - ox) * s, ovTop + (oy - p[1]) * s];
  doc.setLineWidth(0.1);
  for (const p of layout.panes) {
    const c = hexRgb(colorOf(p.fill).hex);
    doc.setFillColor(...lighten(c, 0.35));
    doc.setDrawColor(60, 60, 60);
    drawRings(doc, p.opening, ovMap, 'FD');
  }
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  drawRings(doc, layout.frame, ovMap);
  doc.setFontSize(Math.max(4, Math.min(8, 40 * s)));
  doc.setTextColor(0, 0, 0);
  for (const p of layout.panes) {
    const [x, y] = ovMap(p.label);
    doc.text(String(p.index), x, y, { align: 'center', baseline: 'middle' });
  }
  // page grid
  doc.setDrawColor(214, 51, 132);
  doc.setLineWidth(0.2);
  doc.setTextColor(214, 51, 132);
  doc.setFontSize(9);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x0, y0] = ovMap([ox + c * CW, oy - r * CH]);
      doc.rect(x0, y0, CW * s, CH * s, 'S');
      doc.text(`${ROWS[r % 26]}${c + 1}`, x0 + 1.5, y0 + 4);
    }
  }
  doc.setTextColor(0, 0, 0);
  // legend
  let ly = ovTop + rows * CH * s + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Farben', MARGIN, ly);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  ly += 5;
  const groups = new Map<string, PaneInfo[]>();
  for (const p of layout.panes) {
    if (!groups.has(p.fill)) groups.set(p.fill, []);
    groups.get(p.fill)!.push(p);
  }
  for (const [id, panes] of groups) {
    const c = colorOf(id);
    doc.setFillColor(...hexRgb(c.hex));
    doc.rect(MARGIN, ly - 3, 5, 4, 'F');
    const area = panes.reduce((a, p) => a + Math.abs(ringsArea(p.cut)), 0) / 100;
    const nums = panes.map((p) => p.index).join(', ');
    const lines = doc.splitTextToSize(`${c.name}: ${panes.length} Stück, ca. ${area.toFixed(0)} cm² – Nr. ${nums}`, CW - 8) as string[];
    doc.text(lines, MARGIN + 7, ly);
    ly += 4.5 * lines.length + 1;
    if (ly > A4H - MARGIN - 10) break;
  }

  // --- tile pages
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      doc.addPage();
      const tx0 = ox + c * CW;
      const ty1 = oy - r * CH;
      const map = (p: Vec2): Vec2 => [MARGIN + (p[0] - tx0), MARGIN + (ty1 - p[1])];
      // only panes touching this tile
      const visible = layout.panes.filter((p) => {
        const pb = ringsBounds(p.cut);
        return pb.maxX >= tx0 - 1 && pb.minX <= tx0 + CW + 1 && pb.minY <= ty1 + 1 && pb.maxY >= ty1 - CH - 1;
      });
      doc.saveGraphicsState();
      doc.rect(MARGIN, MARGIN, CW, CH, null);
      doc.clip();
      doc.discardPath();
      // lead (light grey) for orientation
      for (const p of visible) {
        doc.setFillColor(...lighten(hexRgb(colorOf(p.fill).hex), 0.82));
        drawRings(doc, p.cut, map, 'F');
      }
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.15);
      for (const p of visible) drawRings(doc, p.opening, map);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.35);
      for (const p of visible) drawRings(doc, p.cut, map);
      doc.setLineWidth(0.25);
      doc.setDrawColor(90, 90, 90);
      drawRings(doc, layout.frame, map);
      doc.setFontSize(10);
      for (const p of visible) {
        const [x, y] = map(p.label);
        if (x < MARGIN - 5 || x > MARGIN + CW + 5 || y < MARGIN - 5 || y > MARGIN + CH + 5) continue;
        doc.setFont('helvetica', 'bold');
        doc.text(String(p.index), x, y - 1, { align: 'center', baseline: 'middle' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(colorOf(p.fill).name, x, y + 3, { align: 'center', baseline: 'middle' });
        doc.setFontSize(10);
      }
      doc.restoreGraphicsState();
      // corner marks + border
      doc.setDrawColor(214, 51, 132);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([2, 2], 0);
      doc.rect(MARGIN, MARGIN, CW, CH, 'S');
      doc.setLineDashPattern([], 0);
      const L = 6;
      for (const [x, y] of [[MARGIN, MARGIN], [MARGIN + CW, MARGIN], [MARGIN, MARGIN + CH], [MARGIN + CW, MARGIN + CH]] as Vec2[]) {
        doc.line(x - L, y, x + L, y);
        doc.line(x, y - L, x, y + L);
      }
      // footer
      const label = `${ROWS[r % 26]}${c + 1}`;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      doc.text(`Seite ${label}  ·  Zeile ${ROWS[r % 26]}, Spalte ${c + 1}  ·  ${title}`, MARGIN, A4H - MARGIN - 1);
      const nb = [
        r > 0 ? `oben: ${ROWS[(r - 1) % 26]}${c + 1}` : '',
        c < cols - 1 ? `rechts: ${ROWS[r % 26]}${c + 2}` : '',
      ]
        .filter(Boolean)
        .join('  ');
      if (nb) doc.text(nb, MARGIN, A4H - MARGIN + 3.5);
      // 50 mm scale bar
      const bx = A4W - MARGIN - 50;
      const by = A4H - MARGIN - 3;
      doc.setLineWidth(0.4);
      doc.setDrawColor(0, 0, 0);
      doc.line(bx, by, bx + 50, by);
      doc.line(bx, by - 1.5, bx, by + 1.5);
      doc.line(bx + 50, by - 1.5, bx + 50, by + 1.5);
      doc.setFontSize(7);
      doc.text('50 mm', bx + 25, by - 1.2, { align: 'center' });
    }
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
