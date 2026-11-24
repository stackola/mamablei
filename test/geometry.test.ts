import { describe, expect, it, beforeAll } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { TEMPLATES } from '../src/model/defaults';
import { computeLayout, Gc } from '../src/geometry/layout2d';
import { buildPart, meshOf } from '../src/geometry/build3d';

let M: ManifoldToplevel;
beforeAll(async () => {
  M = await Module();
  M.setup();
});

describe('layout + part', () => {
  for (const t of TEMPLATES) {
    it(`builds template ${t.id}`, () => {
      const gc = new Gc();
      const d = t.make();
      const t0 = performance.now();
      const { layout, cs } = computeLayout(M, d, gc);
      const t1 = performance.now();
      const part = buildPart(M, gc, cs, layout.eff);
      const t2 = performance.now();
      expect(part.status()).toBe('NoError');
      const mesh = meshOf(part);
      const bb = part.boundingBox();
      console.log(t.id, 'panes', layout.panes.length, 'warn', layout.warnings.map((w) => w.code).join(','),
        'tris', mesh.indices.length / 3, 'vol', part.volume().toFixed(0), 'genus', part.genus(),
        'z', bb.min[2].toFixed(2), bb.max[2].toFixed(2), `layout ${(t1 - t0).toFixed(0)}ms build ${(t2 - t1).toFixed(0)}ms`);
      expect(bb.max[2]).toBeCloseTo(layout.eff.totalHeight, 3);
      expect(part.volume()).toBeGreaterThan(0);
      gc.dispose();
    });
  }
});
