// 3D construction of the printable part: a lead lattice with rounded top
// edges (front, +z) and a step on the back (z = 0) for the acrylic panes.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { EffectiveParams, Gc, LayoutCS } from './layout2d';
import { segmentsFor } from './shapes2d';

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

type Ring = [number, number][];

/** Rounded profile levels: inward offset d and height h above fillet start. */
export function filletLevels(r: number): { d: number; h: number }[] {
  if (r <= 1e-3) return [{ d: 0, h: 0 }];
  const n = Math.max(6, Math.min(16, Math.ceil(r / 0.14)));
  const out: { d: number; h: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2);
    out.push({ d: r * (1 - Math.cos(t)), h: r * Math.sin(t) });
  }
  return out;
}

/**
 * Builds a closed solid over `region` from z = 0 to z = top whose top edges
 * are rounded with radius r (quarter circle profile). The surface is
 * generated as stacked offset contours stitched by constrained triangulation,
 * which keeps every contour edge shared between neighbouring bands, so the
 * mesh is watertight by construction.
 */
export function roundedSlab(M: ManifoldToplevel, gc: Gc, region: CrossSection, top: number, r: number): Manifold {
  const levels = filletLevels(r);
  const z0 = top - (levels.length > 1 ? r : 0);
  const ringsPerLevel: Ring[][] = [];
  for (let k = 0; k < levels.length; k++) {
    const d = levels[k].d;
    const cs = k === 0 ? region : gc.t(region.offset(-d, 'Round', 2, segmentsFor(Math.max(d, 0.2))));
    const rings = cs.toPolygons().filter((p) => p.length >= 3) as Ring[];
    ringsPerLevel.push(rings);
    if (!rings.length) break;
  }

  const pos: number[] = [];
  const tri: number[] = [];
  const addRingVerts = (rings: Ring[], z: number): number[] => {
    const ids: number[] = [];
    for (const ring of rings) {
      for (const p of ring) {
        ids.push(pos.length / 3);
        pos.push(p[0], p[1], z);
      }
    }
    return ids;
  };

  const L0 = ringsPerLevel[0];
  // Bottom face (z = 0), facing down.
  const bottomIds = addRingVerts(L0, 0);
  for (const t of M.triangulate(L0)) tri.push(bottomIds[t[0]], bottomIds[t[2]], bottomIds[t[1]]);

  // Level vertex ids (level 0 at z0).
  const levelIds: number[][] = [addRingVerts(L0, z0)];
  // Walls from z = 0 to z0.
  let off = 0;
  for (const ring of L0) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const bi = bottomIds[off + i];
      const bj = bottomIds[off + j];
      const ti = levelIds[0][off + i];
      const tj = levelIds[0][off + j];
      tri.push(bi, bj, tj, bi, tj, ti);
    }
    off += n;
  }

  // Bands between consecutive levels.
  for (let k = 0; k + 1 < ringsPerLevel.length; k++) {
    const a = ringsPerLevel[k];
    const b = ringsPerLevel[k + 1];
    const zb = z0 + levels[k + 1].h;
    const idsB = addRingVerts(b, zb);
    levelIds.push(idsB);
    // Reverse the inner level's rings so they act as holes.
    const bRev: Ring[] = [];
    const bRevIds: number[] = [];
    let o = 0;
    for (const ring of b) {
      const n = ring.length;
      const rr: Ring = [];
      for (let i = n - 1; i >= 0; i--) {
        rr.push(ring[i]);
        bRevIds.push(idsB[o + i]);
      }
      bRev.push(rr);
      o += n;
    }
    const polys = [...a, ...bRev];
    const ids = [...levelIds[k], ...bRevIds];
    for (const t of M.triangulate(polys)) tri.push(ids[t[0]], ids[t[1]], ids[t[2]]);
  }
  // Top face on the last level.
  const last = ringsPerLevel.length - 1;
  if (ringsPerLevel[last].length) {
    for (const t of M.triangulate(ringsPerLevel[last])) {
      tri.push(levelIds[last][t[0]], levelIds[last][t[1]], levelIds[last][t[2]]);
    }
  }

  const mesh = new M.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(pos),
    triVerts: new Uint32Array(tri),
  });
  mesh.merge();
  return gc.t(new M.Manifold(mesh));
}

/** The whole printable part (not yet split). */
export function buildPart(M: ManifoldToplevel, gc: Gc, cs: LayoutCS, eff: EffectiveParams): Manifold {
  const top = eff.totalHeight;
  let slab: Manifold;
  if (eff.roundOuterEdge) {
    slab = roundedSlab(M, gc, cs.lead, top, eff.edgeRadius);
  } else {
    // Extend the lead past the frame so only inner edges get rounded, then
    // cut the outside back with a straight wall.
    const pad = Math.max(eff.edgeRadius * 2, 1);
    const grown = gc.t(cs.frame.offset(pad, 'Miter', 4));
    const outside = gc.t(grown.subtract(cs.frame));
    const region = gc.t(cs.lead.add(outside));
    const raw = roundedSlab(M, gc, region, top, eff.edgeRadius);
    const clip = gc.t(gc.t(cs.frame.extrude(top + 2)).translate([0, 0, -1]));
    slab = gc.t(raw.intersect(clip));
  }
  if (cs.back.isEmpty() || eff.stepDepth <= 0) return slab;
  const cutter = gc.t(gc.t(cs.back.extrude(eff.stepDepth + 1)).translate([0, 0, -1]));
  return gc.t(slab.subtract(cutter));
}

export function meshOf(m: Manifold): MeshData {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = mesh.vertProperties[i * np];
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

/** Acrylic pane solid for the preview (sits against the underside of the cap). */
export function paneSolid(gc: Gc, cut: CrossSection, eff: EffectiveParams): Manifold {
  return gc.t(gc.t(cut.extrude(eff.glassThickness)).translate([0, 0, eff.stepDepth - eff.glassThickness]));
}
