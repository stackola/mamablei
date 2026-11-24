// 3MF and STL export of the printable pieces.
import { strToU8, zipSync } from 'fflate';
import type { PieceOut } from '../geometry/pipeline';

function fmt(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 1e4) / 1e4).toString() : '0';
}

/** Lay pieces out in a grid around the origin (each centred on its own spot). */
function layout(pieces: PieceOut[], gap = 10) {
  const cols = Math.ceil(Math.sqrt(pieces.length));
  const cell = Math.max(...pieces.map((p) => Math.max(p.max[0] - p.min[0], p.max[1] - p.min[1])), 10) + gap;
  return pieces.map((p, i) => {
    const cx = (p.min[0] + p.max[0]) / 2;
    const cy = (p.min[1] + p.max[1]) / 2;
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { dx: col * cell - cx, dy: -row * cell - cy, dz: -p.min[2] };
  });
}

export function make3MF(pieces: PieceOut[], title: string): Uint8Array {
  const offsets = layout(pieces);
  const objects: string[] = [];
  const items: string[] = [];
  pieces.forEach((p, i) => {
    const id = i + 1;
    const { dx, dy, dz } = offsets[i];
    const pos = p.mesh.positions;
    const idx = p.mesh.indices;
    const v: string[] = [];
    for (let k = 0; k < pos.length; k += 3) {
      v.push(`<vertex x="${fmt(pos[k] + dx)}" y="${fmt(pos[k + 1] + dy)}" z="${fmt(pos[k + 2] + dz)}"/>`);
    }
    const t: string[] = [];
    for (let k = 0; k < idx.length; k += 3) t.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`);
    objects.push(
      `<object id="${id}" name="Teil ${p.label}" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`,
    );
    items.push(`<item objectid="${id}" printable="1"/>`);
  });
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">Bleiglas-Editor</metadata>
<resources>${objects.join('\n')}</resources>
<build>${items.join('')}</build>
</model>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  });
}

export function makeSTL(p: PieceOut): Uint8Array {
  const pos = p.mesh.positions;
  const idx = p.mesh.indices;
  const n = idx.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const header = `Bleiglas-Editor Teil ${p.label}`;
  for (let i = 0; i < Math.min(80, header.length); i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  const cx = (p.min[0] + p.max[0]) / 2;
  const cy = (p.min[1] + p.max[1]) / 2;
  const z0 = p.min[2];
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const k of [a, b, c]) {
      dv.setFloat32(o, pos[k] - cx, true);
      dv.setFloat32(o + 4, pos[k + 1] - cy, true);
      dv.setFloat32(o + 8, pos[k + 2] - z0, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

export function makeSTLZip(pieces: PieceOut[], base: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const p of pieces) files[`${base}-teil-${p.label}.stl`] = makeSTL(p);
  return zipSync(files);
}
