import { useState } from 'react';
import type { Layout } from '../geometry/layout2d';
import { MIN_STEM } from '../geometry/layout2d';
import type { BuildOutput } from '../geometry/pipeline';
import { newId } from '../model/defaults';
import type { Updater } from '../model/history';
import type { Design, FrameKind, Params, Shape, Vec2 } from '../model/types';
import { SOLID } from '../model/types';
import { FieldRow, NumberInput, Section, SliderRow, fmtNum } from './controls';

type Upd = (u: Updater, transient?: boolean) => void;

// ---------------------------------------------------------------- Rahmen

export function FramePanel({ design, update, commit, onDrawFrame }: { design: Design; update: Upd; commit: () => void; onDrawFrame: () => void }) {
  const f = design.frame;
  const setFrame = (patch: Partial<Design['frame']>, transient = false) => update((d) => ({ ...d, frame: { ...d.frame, ...patch } }), transient);
  const setKind = (kind: FrameKind) => {
    if (kind === 'polygon' && f.points.length < 3) {
      // start from the current outline as a rectangle the user can redraw
      const w = f.w / 2;
      const h = f.h / 2;
      setFrame({ kind, points: [[-w, -h], [w, -h], [w, h], [-w, h]] as Vec2[] });
    } else setFrame({ kind });
  };
  return (
    <Section title="Rahmen">
      <div className="seg">
        {([
          ['rect', 'Rechteck'],
          ['ellipse', 'Kreis / Oval'],
          ['polygon', 'Eigene Form'],
        ] as [FrameKind, string][]).map(([k, label]) => (
          <button key={k} className={f.kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      {f.kind !== 'polygon' && (
        <>
          <FieldRow label="Breite">
            <NumberInput value={f.w} step={5} min={20} onChange={(v) => setFrame({ w: v })} /> mm
          </FieldRow>
          <FieldRow label="Höhe">
            <NumberInput value={f.h} step={5} min={20} onChange={(v) => setFrame({ h: v })} /> mm
          </FieldRow>
        </>
      )}
      {f.kind === 'rect' && (
        <SliderRow label="Eckenradius außen" value={f.r} min={0} max={Math.min(f.w, f.h) / 2} step={1} onChange={(v, t) => setFrame({ r: v }, t)} onCommit={commit} />
      )}
      {f.kind === 'polygon' && (
        <div className="row-btns">
          <button onClick={onDrawFrame}>✎ Rahmenform zeichnen</button>
          <span className="muted">{f.points.length} Punkte</span>
        </div>
      )}
      <SliderRow
        label="Rahmenbreite"
        value={design.params.frameWidth}
        min={4}
        max={60}
        step={0.5}
        help="Breite des äußeren Randes."
        onChange={(v, t) => update((d) => ({ ...d, params: { ...d.params, frameWidth: v } }), t)}
        onCommit={commit}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- Maße

export function ParamsPanel({ design, update, commit, layout }: { design: Design; update: Upd; commit: () => void; layout: Layout | null }) {
  const p = design.params;
  const set = (k: keyof Params) => (v: number, t?: boolean) => update((d) => ({ ...d, params: { ...d.params, [k]: v } }), t);
  const eff = layout?.eff;
  return (
    <Section title="Maße & Profil">
      <SliderRow label="Bleibreite (vorne)" value={p.leadWidth} min={1.5} max={12} step={0.1} onChange={set('leadWidth')} onCommit={commit}
        help="Sichtbare Breite der Bleistege = Abstand zwischen zwei Scheiben." />
      <SliderRow label="Kantenradius" value={p.edgeRadius} min={0} max={6} step={0.1} onChange={set('edgeRadius')} onCommit={commit}
        help="Rundung der Oberkante. Halbe Bleibreite = ganz rund wie echtes Blei." />
      <SliderRow label="Falzbreite (hinten)" value={p.stepWidth} min={0.4} max={4} step={0.1} onChange={set('stepWidth')} onCommit={commit}
        help="So weit greift die Acrylscheibe auf jeder Seite unter den Steg." />
      <SliderRow label="Acrylstärke" value={p.glassThickness} min={0.5} max={6} step={0.1} onChange={set('glassThickness')} onCommit={commit} />
      <SliderRow label="Falz-Zugabe (Kleber)" value={p.stepExtra} min={0} max={2} step={0.05} onChange={set('stepExtra')} onCommit={commit}
        help="Zusätzliche Falztiefe über die Acrylstärke hinaus." />
      <SliderRow label="Kappenstärke" value={p.capThickness} min={0.8} max={6} step={0.1} onChange={set('capThickness')} onCommit={commit}
        help="Material über dem Falz (sichtbarer Teil des Stegs)." />
      <SliderRow label="Eckenradius Öffnungen" value={p.cornerRadius} min={0} max={10} step={0.1} onChange={set('cornerRadius')} onCommit={commit}
        help="Rundet die Ecken der Glasöffnungen (Draufsicht)." />
      <SliderRow label="Mindestbreite Glas" value={p.minPaneWidth} min={0} max={15} step={0.5} onChange={set('minPaneWidth')} onCommit={commit}
        help="Schmalere Glasflächen werden massiv gefüllt." />
      <SliderRow label="Spiel Acryl" value={p.paneClearance} min={0} max={1} step={0.05} onChange={set('paneClearance')} onCommit={commit}
        help="Luft zwischen Acrylkante und Steg (je Seite) – für die Zuschnittdateien." />
      <label className="check">
        <input type="checkbox" checked={p.roundOuterEdge} onChange={(e) => update((d) => ({ ...d, params: { ...d.params, roundOuterEdge: e.target.checked } }))} />
        Außenkante abrunden
      </label>
      {eff && (
        <div className="derived">
          <ProfileSketch eff={eff} />
          <div>
            Steg hinten: <b className={eff.stemWidth < MIN_STEM ? 'bad' : ''}>{fmtNum(eff.stemWidth)} mm</b>
            <br />
            Falztiefe: <b>{fmtNum(eff.stepDepth)} mm</b>
            <br />
            Gesamthöhe: <b>{fmtNum(eff.totalHeight)} mm</b>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Small cross-section sketch of one lead. */
function ProfileSketch({ eff }: { eff: Layout['eff'] }) {
  const W = eff.leadWidth;
  const R = eff.stepWidth;
  const r = eff.edgeRadius;
  const H = eff.totalHeight;
  const sd = eff.stepDepth;
  const t = eff.glassThickness;
  const k = 70 / Math.max(W + 6, H + 2);
  const cx = 50;
  const by = 78;
  const X = (x: number) => cx + x * k;
  const Y = (y: number) => by - y * k;
  const hw = W / 2;
  const sw = hw - R;
  // profile path (right half mirrored)
  const pts: [number, number][] = [];
  pts.push([-sw, 0], [sw, 0], [sw, sd], [hw, sd], [hw, H - r]);
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push([hw - r + r * Math.cos(a), H - r + r * Math.sin(a)]);
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (i / 8) * (Math.PI / 2);
    pts.push([-hw + r + r * Math.cos(a), H - r + r * Math.sin(a)]);
  }
  pts.push([-hw, sd], [-sw, sd]);
  const d = `M${pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('L')}Z`;
  const gx0 = X(-hw - 3);
  const gx1 = X(hw + 3);
  return (
    <svg className="profile" viewBox="0 0 100 90" width={110} height={99}>
      <rect x={gx0} y={Y(sd)} width={X(-sw - eff.paneClearance) - gx0} height={t * k} fill="#7fb3d5" opacity={0.7} />
      <rect x={X(sw + eff.paneClearance)} y={Y(sd)} width={gx1 - X(sw + eff.paneClearance)} height={t * k} fill="#e79aa6" opacity={0.7} />
      <path d={d} fill="#b8bec6" stroke="#4b5563" strokeWidth={0.8} />
      <text x={50} y={8} textAnchor="middle" fontSize={7} fill="#555">vorne</text>
      <text x={50} y={88} textAnchor="middle" fontSize={7} fill="#555">hinten (Licht)</text>
    </svg>
  );
}

// ---------------------------------------------------------------- Drucker

export function PrintPanel({ design, update, build, buildStale }: { design: Design; update: Upd; build: BuildOutput | null; buildStale: boolean }) {
  const p = design.params;
  const setP = (patch: Partial<Params>) => update((d) => ({ ...d, params: { ...d.params, ...patch } }));
  const grams = build ? (build.totalVolume / 1000) * 1.24 : 0;
  const bad = build ? build.pieces.filter((x) => !x.fits) : [];
  return (
    <Section title="Drucker & Teilung">
      <FieldRow label="Bauraum">
        <NumberInput value={p.bedSize} step={1} min={50} onChange={(v) => setP({ bedSize: v })} /> mm
      </FieldRow>
      <FieldRow label="Sicherheitsrand">
        <NumberInput value={p.bedMargin} step={1} min={0} onChange={(v) => setP({ bedMargin: v })} /> mm
      </FieldRow>
      <label className="check" title="Empfohlen: Nähte laufen durch Glasflächen und kreuzen Bleistege nur quer. Die Acrylscheiben überbrücken die Naht.">
        <input type="checkbox" checked={p.seamsThroughPanes} onChange={(e) => setP({ seamsThroughPanes: e.target.checked })} />
        Nähte dürfen durch Glasflächen laufen
      </label>
      <p className="muted small">
        {p.seamsThroughPanes
          ? 'Nähte kreuzen Bleistege nur quer an der schmalsten Stelle; Scheiben überbrücken die Naht.'
          : 'Nähte laufen längs in der Mitte der Bleistege (jede Scheibe bleibt in einem Teil, Stege werden halbiert).'}
      </p>
      {build && (
        <div className={`stats ${buildStale ? 'stale' : ''}`}>
          <div>
            <b>{build.pieces.length}</b> Druckteil{build.pieces.length === 1 ? '' : 'e'}
            {bad.length ? <span className="bad"> · {bad.length} zu groß!</span> : <span className="good"> · alle passen</span>}
          </div>
          <div>
            ca. <b>{grams.toFixed(0)} g</b> PLA · {(build.totalVolume / 1000).toFixed(1)} cm³
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- Farben

export function PalettePanel({ design, update, activeFill, setActiveFill, layout, onPick }: { design: Design; update: Upd; activeFill: string; setActiveFill: (id: string) => void; layout: Layout | null; onPick: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const p of layout?.panes ?? []) counts.set(p.fill, (counts.get(p.fill) ?? 0) + 1);
  const setColor = (id: string, patch: { name?: string; hex?: string }) =>
    update((d) => ({ ...d, palette: d.palette.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const add = () => {
    const id = newId('c');
    update((d) => ({ ...d, palette: [...d.palette, { id, name: 'Neue Farbe', hex: '#88aadd' }] }));
    setEditing(id);
    setActiveFill(id);
  };
  const remove = (id: string) => {
    if (design.palette.length <= 1) return;
    update((d) => {
      const palette = d.palette.filter((c) => c.id !== id);
      const fallback = d.defaultFill === id ? palette[0].id : d.defaultFill;
      return { ...d, palette, defaultFill: fallback, fills: d.fills.map((f) => (f.fill === id ? { ...f, fill: fallback } : f)) };
    });
    if (activeFill === id) setActiveFill(design.palette[0].id);
    setEditing(null);
  };
  return (
    <Section title="Glasfarben" right={<button className="mini" onClick={add} title="Farbe hinzufügen">＋</button>}>
      <p className="muted small">Farbe wählen, dann mit dem Farbeimer (F) eine Fläche anklicken.</p>
      <div className="swatches">
        {design.palette.map((c) => (
          <div
            key={c.id}
            className={`swatch ${activeFill === c.id ? 'on' : ''}`}
            onClick={() => {
              setActiveFill(c.id);
              onPick();
            }}
            onDoubleClick={() => setEditing(c.id)}
            title={`${c.name} – Doppelklick zum Bearbeiten`}
          >
            <span className="chip" style={{ background: c.hex }} />
            <span className="name">{c.name}</span>
            {counts.get(c.id) ? <span className="count">{counts.get(c.id)}</span> : null}
          </div>
        ))}
        <div
          className={`swatch ${activeFill === SOLID ? 'on' : ''}`}
          onClick={() => {
            setActiveFill(SOLID);
            onPick();
          }}
          title="Fläche massiv (Chrom) füllen"
        >
          <span className="chip chrome" />
          <span className="name">Massiv</span>
        </div>
      </div>
      {editing && design.palette.find((c) => c.id === editing) && (() => {
        const c = design.palette.find((x) => x.id === editing)!;
        return (
          <div className="color-edit">
            <input type="color" value={c.hex} onChange={(e) => setColor(c.id, { hex: e.target.value })} />
            <input type="text" value={c.name} onChange={(e) => setColor(c.id, { name: e.target.value })} />
            <button className="mini" onClick={() => remove(c.id)} title="Farbe löschen">🗑</button>
            <button className="mini" onClick={() => setEditing(null)}>OK</button>
          </div>
        );
      })()}
      <FieldRow label="Standardfarbe">
        <select value={design.defaultFill} onChange={(e) => update((d) => ({ ...d, defaultFill: e.target.value }))}>
          {design.palette.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FieldRow>
    </Section>
  );
}

// ---------------------------------------------------------------- Auswahl

export function SelectionPanel({ shape, update, onDelete, onDuplicate }: { shape: Shape | null; update: Upd; onDelete: () => void; onDuplicate: () => void }) {
  if (!shape) {
    return (
      <Section title="Auswahl">
        <p className="muted small">Nichts ausgewählt. Form anklicken oder mit den Werkzeugen links zeichnen.</p>
      </Section>
    );
  }
  const set = (patch: Partial<Shape>) => update((d) => ({ ...d, shapes: d.shapes.map((s) => (s.id === shape.id ? ({ ...s, ...patch } as Shape) : s)) }));
  const names: Record<Shape['kind'], string> = { rect: 'Rechteck', ellipse: 'Oval / Kreis', line: 'Linie', polygon: 'Vieleck' };
  return (
    <Section title={`Auswahl: ${shape.kind === 'ellipse' && Math.abs(shape.rx - shape.ry) < 1e-6 ? 'Kreis' : names[shape.kind]}`}>
      {(shape.kind === 'rect' || shape.kind === 'ellipse') && (
        <div className="grid2">
          <FieldRow label="X"><NumberInput value={shape.x} step={1} onChange={(v) => set({ x: v })} /></FieldRow>
          <FieldRow label="Y"><NumberInput value={shape.y} step={1} onChange={(v) => set({ y: v })} /></FieldRow>
          {shape.kind === 'rect' ? (
            <>
              <FieldRow label="Breite"><NumberInput value={shape.w} step={1} min={1} onChange={(v) => set({ w: v })} /></FieldRow>
              <FieldRow label="Höhe"><NumberInput value={shape.h} step={1} min={1} onChange={(v) => set({ h: v })} /></FieldRow>
              <FieldRow label="Ecken"><NumberInput value={shape.r} step={1} min={0} onChange={(v) => set({ r: v })} /></FieldRow>
            </>
          ) : (
            <>
              <FieldRow label="Breite"><NumberInput value={shape.rx * 2} step={1} min={1} onChange={(v) => set({ rx: v / 2 })} /></FieldRow>
              <FieldRow label="Höhe"><NumberInput value={shape.ry * 2} step={1} min={1} onChange={(v) => set({ ry: v / 2 })} /></FieldRow>
            </>
          )}
          <FieldRow label="Drehung"><NumberInput value={shape.rotation} step={5} onChange={(v) => set({ rotation: v })} /></FieldRow>
        </div>
      )}
      {shape.kind === 'line' && (
        <div className="grid2">
          <FieldRow label="X1"><NumberInput value={shape.a[0]} step={1} onChange={(v) => set({ a: [v, shape.a[1]] })} /></FieldRow>
          <FieldRow label="Y1"><NumberInput value={shape.a[1]} step={1} onChange={(v) => set({ a: [shape.a[0], v] })} /></FieldRow>
          <FieldRow label="X2"><NumberInput value={shape.b[0]} step={1} onChange={(v) => set({ b: [v, shape.b[1]] })} /></FieldRow>
          <FieldRow label="Y2"><NumberInput value={shape.b[1]} step={1} onChange={(v) => set({ b: [shape.b[0], v] })} /></FieldRow>
        </div>
      )}
      {shape.kind === 'polygon' && <p className="muted small">{shape.points.length} Punkte – Punkte direkt im Bild ziehen.</p>}
      <div className="row-btns">
        <button onClick={onDuplicate} title="Strg+D">⧉ Duplizieren</button>
        <button onClick={onDelete} className="danger" title="Entf">🗑 Löschen</button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Hinweise

export function WarningsPanel({ layout, build, buildError }: { layout: Layout | null; build: BuildOutput | null; buildError: string | null }) {
  const items = [...(layout?.warnings ?? [])];
  const bad = build?.pieces.filter((p) => !p.fits) ?? [];
  return (
    <Section title={`Hinweise${items.length || bad.length || buildError ? ` (${items.length + (bad.length ? 1 : 0) + (buildError ? 1 : 0)})` : ''}`}>
      {!items.length && !bad.length && !buildError && <p className="muted small">Alles in Ordnung.</p>}
      <ul className="warnings">
        {buildError && <li className="error">3D-Berechnung fehlgeschlagen: {buildError}</li>}
        {bad.length > 0 && <li className="error">Teile zu groß für den Drucker: {bad.map((p) => p.label).join(', ')}</li>}
        {items.map((w, i) => (
          <li key={i} className={w.level}>
            {w.message}
          </li>
        ))}
      </ul>
    </Section>
  );
}
