import { describe, expect, it, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { TEMPLATES } from '../src/model/defaults';
import { buildAll } from '../src/geometry/pipeline';
import { computeLayout, Gc } from '../src/geometry/layout2d';
import { make3MF, makeSTLZip } from '../src/export/meshExport';
import { makeLaserZip, makeTemplatePDF } from '../src/export/cutFiles';

let M: ManifoldToplevel;
const OUT = process.env.EXPORT_OUT;
beforeAll(async () => {
  M = await Module();
  M.setup();
  if (OUT) mkdirSync(OUT, { recursive: true });
});

describe('exports', () => {
  it('writes 3MF, STL, SVG, DXF and PDF', () => {
    const d = TEMPLATES.find((t) => t.id === 'rosette')!.make();
    const out = buildAll(M, d, false);
    const gc = new Gc();
    const { layout } = computeLayout(M, d, gc);
    gc.dispose();

    const tmf = make3MF(out.pieces, d.name);
    const files = unzipSync(tmf);
    expect(Object.keys(files)).toContain('3D/3dmodel.model');
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model.match(/<object /g)!.length).toBe(out.pieces.length);

    const stl = unzipSync(makeSTLZip(out.pieces, 'rosette'));
    expect(Object.keys(stl).length).toBe(out.pieces.length);

    const svg = unzipSync(makeLaserZip(layout, d.palette, 'Rosette', { width: 300, height: 200, gap: 3 }, 'svg'));
    const svgNames = Object.keys(svg).filter((n) => n.endsWith('.svg'));
    expect(svgNames.length).toBeGreaterThan(0);
    const paths = svgNames.reduce((a, n) => a + (strFromU8(svg[n]).match(/<path /g)?.length ?? 0), 0);
    expect(paths).toBe(layout.panes.length);

    const dxf = unzipSync(makeLaserZip(layout, d.palette, 'Rosette', { width: 300, height: 200, gap: 3 }, 'dxf'));
    expect(Object.keys(dxf).some((n) => n.endsWith('.dxf'))).toBe(true);

    const pdf = makeTemplatePDF(layout, d.palette, 'Rosette');
    expect(strFromU8(pdf.slice(0, 5))).toBe('%PDF-');

    for (const id of ['raster', 'waben', 'blume']) {
      const dd = TEMPLATES.find((t) => t.id === id)!.make();
      const g2 = new Gc();
      const l2 = computeLayout(M, dd, g2).layout;
      g2.dispose();
      const p2 = makeTemplatePDF(l2, dd.palette, dd.name);
      expect(strFromU8(p2.slice(0, 5))).toBe('%PDF-');
      if (OUT) writeFileSync(`${OUT}/${id}.pdf`, p2);
    }
    if (OUT) {
      writeFileSync(`${OUT}/rosette.3mf`, tmf);
      writeFileSync(`${OUT}/rosette.pdf`, pdf);
      for (const n of svgNames) writeFileSync(`${OUT}/${n}`, svg[n]);
    }
    console.log('pieces', out.pieces.length, 'panes', layout.panes.length, 'svg sheets', svgNames.join(' '), 'pdf bytes', pdf.length);
  });
});
