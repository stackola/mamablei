import { useState } from 'react';
import { makeLaserZip, makeTemplatePDF, safeFileName } from '../export/cutFiles';
import { make3MF, makeSTLZip } from '../export/meshExport';
import type { Layout } from '../geometry/layout2d';
import type { BuildOutput } from '../geometry/pipeline';
import type { Design } from '../model/types';
import { FieldRow, NumberInput, Section } from './controls';

export function download(data: Uint8Array | string, filename: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ExportPanel({ design, layout, build, ready }: { design: Design; layout: Layout | null; build: BuildOutput | null; ready: boolean }) {
  const [sheet, setSheet] = useState({ width: 300, height: 200 });
  const base = safeFileName(design.name || 'entwurf');
  const can3d = !!build && ready && build.pieces.length > 0;
  const canCut = !!layout && layout.panes.length > 0;
  const wrap = (fn: () => void) => () => {
    try {
      fn();
    } catch (e) {
      alert(`Export fehlgeschlagen: ${(e as Error).message}`);
    }
  };
  return (
    <Section title="Export">
      <h4>3D-Druck</h4>
      <div className="row-btns col">
        <button disabled={!can3d} onClick={wrap(() => download(make3MF(build!.pieces, design.name), `${base}-teile.3mf`, 'model/3mf'))}>
          ⬇ 3MF für Bambu Studio
        </button>
        <button disabled={!can3d} onClick={wrap(() => download(makeSTLZip(build!.pieces, base), `${base}-stl.zip`, 'application/zip'))}>
          ⬇ STL-Dateien (ZIP)
        </button>
      </div>
      {!can3d && <p className="muted small">Warte auf 3D-Berechnung …</p>}
      <h4>Acryl-Zuschnitt</h4>
      <FieldRow label="Plattengröße">
        <NumberInput value={sheet.width} step={10} min={50} onChange={(v) => setSheet({ ...sheet, width: v })} width={52} /> ×
        <NumberInput value={sheet.height} step={10} min={50} onChange={(v) => setSheet({ ...sheet, height: v })} width={52} /> mm
      </FieldRow>
      <div className="row-btns col">
        <button disabled={!canCut} onClick={wrap(() => download(makeLaserZip(layout!, design.palette, base, { ...sheet, gap: 3 }, 'svg'), `${base}-laser-svg.zip`, 'application/zip'))}>
          ⬇ Laser: SVG je Farbe (ZIP)
        </button>
        <button disabled={!canCut} onClick={wrap(() => download(makeLaserZip(layout!, design.palette, base, { ...sheet, gap: 3 }, 'dxf'), `${base}-laser-dxf.zip`, 'application/zip'))}>
          ⬇ Laser: DXF je Farbe (ZIP)
        </button>
        <button disabled={!canCut} onClick={wrap(() => download(makeTemplatePDF(layout!, design.palette, design.name || 'Entwurf'), `${base}-schablonen-a4.pdf`, 'application/pdf'))}>
          ⬇ Schablonen 1:1 (PDF, A4)
        </button>
      </div>
    </Section>
  );
}
