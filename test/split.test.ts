import { describe, expect, it, beforeAll } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { TEMPLATES } from '../src/model/defaults';
import { buildAll } from '../src/geometry/pipeline';
import type { Design } from '../src/model/types';

let M: ManifoldToplevel;
beforeAll(async () => {
  M = await Module();
  M.setup();
});

function scaled(d: Design, k: number): Design {
  const s = structuredClone(d);
  s.frame.w *= k; s.frame.h *= k; s.frame.r *= k;
  s.frame.points = s.frame.points.map(([x, y]) => [x * k, y * k]);
  s.shapes = s.shapes.map((sh) => {
    switch (sh.kind) {
      case 'line': return { ...sh, a: [sh.a[0] * k, sh.a[1] * k], b: [sh.b[0] * k, sh.b[1] * k] };
      case 'rect': return { ...sh, x: sh.x * k, y: sh.y * k, w: sh.w * k, h: sh.h * k, r: sh.r * k };
      case 'ellipse': return { ...sh, x: sh.x * k, y: sh.y * k, rx: sh.rx * k, ry: sh.ry * k };
      case 'polygon': return { ...sh, points: sh.points.map(([x, y]) => [x * k, y * k]) };
    }
  });
  s.fills = s.fills.map((f) => ({ ...f, x: f.x * k, y: f.y * k }));
  return s;
}

describe('split', () => {
  for (const id of ['raster', 'rosette', 'rauten']) {
    for (const through of [true, false]) {
      it(`${id} x2 through=${through}`, () => {
        const d = scaled(TEMPLATES.find((t) => t.id === id)!.make(), 2);
        d.params.seamsThroughPanes = through;
        const out = buildAll(M, d, false);
        console.log(id, through, 'pieces', out.pieces.length, out.pieces.map((p) => `${p.label}:${(p.max[0]-p.min[0]).toFixed(0)}x${(p.max[1]-p.min[1]).toFixed(0)}${p.fits ? '' : '!'}(${p.components})`).join(' '), JSON.stringify(out.timings));
        expect(out.pieces.every((p) => p.fits)).toBe(true);
        const sum = out.totalVolume;
        expect(sum).toBeGreaterThan(0);
      });
    }
  }
});
