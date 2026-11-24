import { useState } from 'react';
import { makeLaserZip, makeTemplatePDF, safeFileName } from '../export/cutFiles';
import { make3MF, makeSTLZip } from '../export/meshExport';
import type { Layout } from '../geometry/layout2d';
import type { BuildOutput } from '../geometry/pipeline';
import type { Updater } from '../model/history';
import type { Design, Params } from '../model/types';
import { Card, FieldRow, More, NumberInput } from './controls';

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

export function FinishCard({
  design, layout, build, ready, update, buildError,
}: {
  design: Design;
  layout: Layout | null;
  build: BuildOutput | null;
  ready: boolean;
  update: (u: Updater, transient?: boolean) => void;
  buildError: string | null;
}) {
  const [sheet, setSheet] = useState({ width: 300, height: 200 });
  const base = safeFileName(design.name || 'entwurf');
  const can3d = !!build && ready && build.pieces.length > 0;
  const canCut = !!layout && layout.panes.length > 0;
  const p = design.params;
  const setP = (patch: Partial<Params>) => update((d) => ({ ...d, params: { ...d.params, ...patch } }));
  const wrap = (fn: () => void) => () => {
    try {
      fn();
    } catch (e) {
      alert(`Export fehlgeschlagen: ${(e as Error).message}`);
    }
  };
  const bad = build && ready ? build.pieces.filter((x) => !x.fits) : [];
  const grams = build ? (build.totalVolume / 1000) * 1.24 : 0;
  const warnings = (layout?.warnings ?? []).filter((w) => w.level !== 'info' || w.code === 'islands');
  const infos = (layout?.warnings ?? []).filter((w) => !warnings.includes(w));

  return (
    <Card title="Fertig machen">
      <div className="summary">
        {layout && (
          <div>
            <b>{layout.panes.length}</b> Acrylscheiben
          </div>
        )}
        {build ? (
          <div className={ready ? '' : 'stale'}>
            <b>{build.pieces.length}</b> Druckteil{build.pieces.length === 1 ? '' : 'e'} · ca. {grams.toFixed(0)} g Filament
          </div>
        ) : (
          <div className="muted">3D wird berechnet …</div>
        )}
      </div>
      {(buildError || bad.length > 0 || warnings.length > 0) && (
        <ul className="notices">
          {buildError && <li className="error">3D-Berechnung fehlgeschlagen: {buildError}</li>}
          {bad.length > 0 && <li className="error">Teile zu groß für den Drucker: {bad.map((x) => x.label).join(', ')}</li>}
          {warnings.map((w, i) => (
            <li key={i} className={w.level}>
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <div className="big-btns">
        <button className="primary" disabled={!can3d} onClick={wrap(() => download(make3MF(build!.pieces, design.name), `${base}-druckteile.3mf`, 'model/3mf'))}>
          3D-Druckdatei herunterladen
          <span>für Bambu Studio (.3mf)</span>
        </button>
        <button className="primary alt" disabled={!canCut} onClick={wrap(() => download(makeTemplatePDF(layout!, design.palette, design.name || 'Entwurf'), `${base}-schablonen.pdf`, 'application/pdf'))}>
          Schnittvorlagen herunterladen
          <span>zum Ausdrucken auf A4 (.pdf, 1:1)</span>
        </button>
      </div>
      <More label="Weitere Dateien & Drucker" id="export">
        <h4>Laser-Zuschnitt (je Farbe)</h4>
        <FieldRow label="Plattengröße">
          <NumberInput value={sheet.width} step={10} min={50} onChange={(v) => setSheet({ ...sheet, width: v })} width={52} /> ×
          <NumberInput value={sheet.height} step={10} min={50} onChange={(v) => setSheet({ ...sheet, height: v })} width={52} /> mm
        </FieldRow>
        <div className="row-btns">
          <button disabled={!canCut} onClick={wrap(() => download(makeLaserZip(layout!, design.palette, base, { ...sheet, gap: 3 }, 'svg'), `${base}-laser-svg.zip`, 'application/zip'))}>SVG (ZIP)</button>
          <button disabled={!canCut} onClick={wrap(() => download(makeLaserZip(layout!, design.palette, base, { ...sheet, gap: 3 }, 'dxf'), `${base}-laser-dxf.zip`, 'application/zip'))}>DXF (ZIP)</button>
        </div>
        <h4>3D-Druck</h4>
        <div className="row-btns">
          <button disabled={!can3d} onClick={wrap(() => download(makeSTLZip(build!.pieces, base), `${base}-stl.zip`, 'application/zip'))}>STL-Dateien (ZIP)</button>
        </div>
        <FieldRow label="Bauraum">
          <NumberInput value={p.bedSize} step={1} min={50} onChange={(v) => setP({ bedSize: v })} /> mm
        </FieldRow>
        <FieldRow label="Sicherheitsrand">
          <NumberInput value={p.bedMargin} step={1} min={0} onChange={(v) => setP({ bedMargin: v })} /> mm
        </FieldRow>
        <label className="check">
          <input type="checkbox" checked={p.seamsThroughPanes} onChange={(e) => setP({ seamsThroughPanes: e.target.checked })} />
          Teilungsnähte dürfen durch Scheiben laufen (empfohlen)
        </label>
        {infos.length > 0 && (
          <ul className="notices">
            {infos.map((w, i) => (
              <li key={i} className="info">
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </More>
    </Card>
  );
}
