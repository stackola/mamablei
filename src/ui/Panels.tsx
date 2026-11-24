import { useState } from 'react';
import type { AlignOp } from '../editor/editGeom';
import type { Layout } from '../geometry/layout2d';
import { MIN_STEM } from '../geometry/layout2d';
import { newId } from '../model/defaults';
import type { Updater } from '../model/history';
import type { Design, FrameKind, Params, Shape, Vec2 } from '../model/types';
import { Card, FieldRow, fmtNum, More, NumberInput, SliderRow } from './controls';
import { icons } from './icons';

type Upd = (u: Updater, transient?: boolean) => void;

// ---------------------------------------------------------------- Farben

export function ColorsCard({ design, update, activeFill, onPickColor, layout }: { design: Design; update: Upd; activeFill: string; onPickColor: (id: string) => void; layout: Layout | null }) {
  const [editing, setEditing] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const p of layout?.panes ?? []) counts.set(p.fill, (counts.get(p.fill) ?? 0) + 1);
  const setColor = (id: string, patch: { name?: string; hex?: string }) =>
    update((d) => ({ ...d, palette: d.palette.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const add = () => {
    const id = newId('c');
    update((d) => ({ ...d, palette: [...d.palette, { id, name: 'Neue Farbe', hex: '#88aadd' }] }));
    setEditing(id);
    onPickColor(id);
  };
  const remove = (id: string) => {
    if (design.palette.length <= 1) return;
    const fallback = design.palette.find((c) => c.id !== id)!.id;
    update((d) => ({
      ...d,
      palette: d.palette.filter((c) => c.id !== id),
      shapes: d.shapes.map((s) => (s.kind !== 'line' && s.fill === id ? { ...s, fill: fallback } : s)),
      fills: d.fills.map((f) => (f.fill === id ? { ...f, fill: fallback } : f)),
    }));
    if (activeFill === id) onPickColor(fallback);
    setEditing(null);
  };
  const edited = design.palette.find((c) => c.id === editing);
  return (
    <Card title="Glasfarbe">
      <div className="swatches">
        {design.palette.map((c) => (
          <button key={c.id} className={`swatch ${activeFill === c.id ? 'on' : ''}`} onClick={() => onPickColor(c.id)} title={c.name}>
            <span className="chip" style={{ background: c.hex }} />
            <span className="name">{c.name}</span>
            {counts.get(c.id) ? <span className="count">{counts.get(c.id)}</span> : null}
          </button>
        ))}
      </div>
      <p className="muted small">Neue Formen bekommen diese Farbe. Ausgewählte Formen werden sofort umgefärbt.</p>
      <More label="Farben bearbeiten" id="colors">
        <div className="color-list">
          {design.palette.map((c) => (
            <button key={c.id} className={`mini ${editing === c.id ? 'on' : ''}`} onClick={() => setEditing(c.id)}>
              <span className="chip small" style={{ background: c.hex }} /> {c.name}
            </button>
          ))}
          <button className="mini" onClick={add}>＋ Neue Farbe</button>
        </div>
        {edited && (
          <div className="color-edit">
            <input type="color" value={edited.hex} onChange={(e) => setColor(edited.id, { hex: e.target.value })} />
            <input type="text" value={edited.name} onChange={(e) => setColor(edited.id, { name: e.target.value })} />
            <button className="mini danger" onClick={() => remove(edited.id)} title="Farbe löschen">Löschen</button>
          </div>
        )}
      </More>
    </Card>
  );
}

// ---------------------------------------------------------------- Auswahl

export function SelectionCard({
  shapes, update, onDelete, onDuplicate, onAlign, onReorder,
}: {
  shapes: Shape[];
  update: Upd;
  onDelete: () => void;
  onDuplicate: () => void;
  onAlign: (op: AlignOp) => void;
  onReorder: (op: 'up' | 'down' | 'top' | 'bottom') => void;
}) {
  if (!shapes.length) return null;
  const common = (
    <div className="row-btns">
      <button onClick={onDuplicate} title="Strg+D">Duplizieren</button>
      <button onClick={() => onReorder('top')} title="Liegt dann über allen anderen Formen">Nach vorne</button>
      <button onClick={() => onReorder('bottom')} title="Liegt dann unter allen anderen Formen">Nach hinten</button>
      <button onClick={onDelete} className="danger" title="Entf">Löschen</button>
    </div>
  );
  if (shapes.length > 1) {
    const btn = (op: AlignOp, icon: string, title: string) => (
      <button className="icon-btn" onClick={() => onAlign(op)} title={title}>
        {icons[icon]}
      </button>
    );
    return (
      <Card title={`${shapes.length} Formen ausgewählt`}>
        <div className="align-row">
          {btn('left', 'alignLeft', 'Links ausrichten')}
          {btn('hcenter', 'alignHCenter', 'Mittig (waagerecht)')}
          {btn('right', 'alignRight', 'Rechts ausrichten')}
          {btn('top', 'alignTop', 'Oben ausrichten')}
          {btn('vcenter', 'alignVCenter', 'Mittig (senkrecht)')}
          {btn('bottom', 'alignBottom', 'Unten ausrichten')}
        </div>
        <div className="row-btns">
          <button onClick={() => onAlign('packH')} title="Nebeneinander, genau eine Bleibreite Abstand">
            <span className="bi">{icons.packH}</span> Aneinander ↔
          </button>
          <button onClick={() => onAlign('packV')} title="Untereinander, genau eine Bleibreite Abstand">
            <span className="bi">{icons.packV}</span> Aneinander ↕
          </button>
        </div>
        <More label="Gleichmäßig verteilen" id="distribute">
          <div className="row-btns">
            <button onClick={() => onAlign('distH')}>
              <span className="bi">{icons.distH}</span> Waagerecht verteilen
            </button>
            <button onClick={() => onAlign('distV')}>
              <span className="bi">{icons.distV}</span> Senkrecht verteilen
            </button>
          </div>
        </More>
        {common}
      </Card>
    );
  }
  const shape = shapes[0];
  const set = (patch: Partial<Shape>) => update((d) => ({ ...d, shapes: d.shapes.map((s) => (s.id === shape.id ? ({ ...s, ...patch } as Shape) : s)) }));
  const names: Record<Shape['kind'], string> = { rect: 'Rechteck', ellipse: 'Oval', ngon: 'Vieleck', arch: 'Bogen', polygon: 'Freie Form', line: 'Bleilinie' };
  let title = names[shape.kind];
  if (shape.kind === 'ellipse' && Math.abs(shape.rx - shape.ry) < 1e-6) title = 'Kreis';
  if (shape.kind === 'ngon') title = shape.sides === 3 ? 'Dreieck' : shape.sides === 6 ? 'Sechseck' : `${shape.sides}-Eck`;
  return (
    <Card title={`Ausgewählt: ${title}`}>
      {(shape.kind === 'rect' || shape.kind === 'arch') && (
        <div className="grid2">
          <FieldRow label="Breite"><NumberInput value={shape.w} step={1} min={2} onChange={(v) => set({ w: v })} /></FieldRow>
          <FieldRow label="Höhe"><NumberInput value={shape.h} step={1} min={2} onChange={(v) => set({ h: v })} /></FieldRow>
        </div>
      )}
      {(shape.kind === 'ellipse' || shape.kind === 'ngon') && (
        <div className="grid2">
          <FieldRow label="Breite"><NumberInput value={shape.rx * 2} step={1} min={2} onChange={(v) => set(shape.kind === 'ellipse' && shape.rx === shape.ry ? { rx: v / 2, ry: v / 2 } : { rx: v / 2 })} /></FieldRow>
          <FieldRow label="Höhe"><NumberInput value={shape.ry * 2} step={1} min={2} onChange={(v) => set(shape.kind === 'ellipse' && shape.rx === shape.ry ? { rx: v / 2, ry: v / 2 } : { ry: v / 2 })} /></FieldRow>
        </div>
      )}
      {shape.kind === 'rect' && (
        <SliderRow label="Ecken abrunden" value={shape.r} min={0} max={Math.min(shape.w, shape.h) / 2} step={1} onChange={(v) => set({ r: v })} />
      )}
      {shape.kind === 'ngon' && (
        <FieldRow label="Anzahl Ecken">
          <NumberInput value={shape.sides} step={1} min={3} max={24} onChange={(v) => set({ sides: Math.round(v) })} />
        </FieldRow>
      )}
      {shape.kind === 'arch' && (
        <div className="seg small">
          <button className={shape.style === 'round' ? 'on' : ''} onClick={() => set({ style: 'round' })}>Rundbogen</button>
          <button className={shape.style === 'pointed' ? 'on' : ''} onClick={() => set({ style: 'pointed' })}>Spitzbogen</button>
        </div>
      )}
      {shape.kind === 'polygon' && <p className="muted small">Die Eckpunkte lassen sich direkt im Bild verschieben.</p>}
      {shape.kind === 'line' && <p className="muted small">Eine Bleilinie teilt eine Form in zwei Scheiben.</p>}
      {common}
      {shape.kind !== 'line' && shape.kind !== 'polygon' && (
        <More label="Position & Drehung" id="pos">
          <div className="grid2">
            <FieldRow label="X"><NumberInput value={shape.x} step={1} onChange={(v) => set({ x: v })} /></FieldRow>
            <FieldRow label="Y"><NumberInput value={shape.y} step={1} onChange={(v) => set({ y: v })} /></FieldRow>
            <FieldRow label="Drehung °"><NumberInput value={shape.rotation} step={5} onChange={(v) => set({ rotation: v })} /></FieldRow>
          </div>
          <div className="row-btns">
            <button onClick={() => onReorder('up')}>Eine Ebene nach vorne</button>
            <button onClick={() => onReorder('down')}>Eine Ebene nach hinten</button>
          </div>
        </More>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Rahmen

export function FrameCard({ design, update, commit, onDrawFrame }: { design: Design; update: Upd; commit: () => void; onDrawFrame: () => void }) {
  const f = design.frame;
  const setFrame = (patch: Partial<Design['frame']>, transient = false) => update((d) => ({ ...d, frame: { ...d.frame, ...patch } }), transient);
  const setKind = (kind: FrameKind) => {
    if (kind === 'polygon' && f.points.length < 3) {
      const w = f.w / 2;
      const h = f.h / 2;
      setFrame({ kind, points: [[-w, -h], [w, -h], [w, h], [-w, h]] as Vec2[] });
      onDrawFrame();
    } else setFrame({ kind });
  };
  return (
    <Card title="Fenster">
      <div className="seg">
        {([
          ['rect', 'Eckig'],
          ['ellipse', 'Rund'],
          ['polygon', 'Eigene Form'],
        ] as [FrameKind, string][]).map(([k, label]) => (
          <button key={k} className={f.kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      {f.kind !== 'polygon' ? (
        <div className="grid2">
          <FieldRow label="Breite"><NumberInput value={f.w} step={10} min={40} onChange={(v) => setFrame({ w: v })} /></FieldRow>
          <FieldRow label="Höhe"><NumberInput value={f.h} step={10} min={40} onChange={(v) => setFrame({ h: v })} /></FieldRow>
        </div>
      ) : (
        <div className="row-btns">
          <button onClick={onDrawFrame}>Fensterform neu zeichnen</button>
        </div>
      )}
      <p className="muted small">Maße in Millimetern (Außenmaß).</p>
      <More id="frame">
        {f.kind === 'rect' && (
          <SliderRow label="Ecken abrunden" value={f.r} min={0} max={Math.min(f.w, f.h) / 2} step={1} onChange={(v, t) => setFrame({ r: v }, t)} onCommit={commit} />
        )}
        <SliderRow
          label="Randbreite"
          value={design.params.frameWidth}
          min={4}
          max={60}
          step={0.5}
          onChange={(v, t) => update((d) => ({ ...d, params: { ...d.params, frameWidth: v } }), t)}
          onCommit={commit}
        />
      </More>
    </Card>
  );
}

// ---------------------------------------------------------------- Blei

export function LeadCard({ design, update, commit, layout }: { design: Design; update: Upd; commit: () => void; layout: Layout | null }) {
  const p = design.params;
  const set = (k: keyof Params) => (v: number, t?: boolean) => update((d) => ({ ...d, params: { ...d.params, [k]: v } }), t);
  const eff = layout?.eff;
  return (
    <Card title="Bleistege">
      <SliderRow label="Breite" value={p.leadWidth} min={1.5} max={12} step={0.1} onChange={set('leadWidth')} onCommit={commit} help="Abstand zwischen zwei Scheiben" />
      <SliderRow label="Rundung" value={p.edgeRadius} min={0} max={6} step={0.1} onChange={set('edgeRadius')} onCommit={commit} help="halbe Breite = ganz rund" />
      <More id="lead">
        <SliderRow label="Acrylstärke" value={p.glassThickness} min={0.5} max={6} step={0.1} onChange={set('glassThickness')} onCommit={commit} />
        <SliderRow label="Falzbreite" value={p.stepWidth} min={0.4} max={4} step={0.1} onChange={set('stepWidth')} onCommit={commit} help="so weit greift die Scheibe unter den Steg" />
        <SliderRow label="Falz-Zugabe (Kleber)" value={p.stepExtra} min={0} max={2} step={0.05} onChange={set('stepExtra')} onCommit={commit} />
        <SliderRow label="Kappenstärke" value={p.capThickness} min={0.8} max={6} step={0.1} onChange={set('capThickness')} onCommit={commit} help="Material über der Scheibe" />
        <SliderRow label="Ecken der Öffnungen" value={p.cornerRadius} min={0} max={10} step={0.1} onChange={set('cornerRadius')} onCommit={commit} help="Rundung in der Draufsicht" />
        <SliderRow label="Mindestbreite Glas" value={p.minPaneWidth} min={0} max={15} step={0.5} onChange={set('minPaneWidth')} onCommit={commit} help="schmalere Stellen werden Chrom" />
        <SliderRow label="Spiel Acryl" value={p.paneClearance} min={0} max={1} step={0.05} onChange={set('paneClearance')} onCommit={commit} help="Luft je Seite beim Zuschnitt" />
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
      </More>
    </Card>
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
  const X = (x: number) => 50 + x * k;
  const Y = (y: number) => 78 - y * k;
  const hw = W / 2;
  const sw = hw - R;
  const pts: [number, number][] = [[-sw, 0], [sw, 0], [sw, sd], [hw, sd], [hw, H - r]];
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
