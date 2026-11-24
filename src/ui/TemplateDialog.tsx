import { useMemo } from 'react';
import { frameOutline, shapeOutline } from '../geometry/shapes2d';
import { TEMPLATES } from '../model/defaults';
import type { Design } from '../model/types';

function Thumb({ d }: { d: Design }) {
  const frame = frameOutline(d.frame);
  const xs = frame.map((p) => p[0]);
  const ys = frame.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 10;
  const path = (pts: [number, number][]) => `M${pts.map((p) => `${p[0]},${-p[1]}`).join('L')}Z`;
  return (
    <svg viewBox={`${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} className="thumb">
      <defs>
        <clipPath id={`clip-${d.name}`}>
          <path d={path(frame)} />
        </clipPath>
      </defs>
      <path d={path(frame)} fill="#eef3f7" stroke="#555" strokeWidth={8} />
      <g clipPath={`url(#clip-${d.name})`} stroke="#555" strokeWidth={5} fill="none">
        {d.shapes.map((s) => {
          if (s.kind === 'line') return <line key={s.id} x1={s.a[0]} y1={-s.a[1]} x2={s.b[0]} y2={-s.b[1]} />;
          const o = shapeOutline(s);
          return o ? <path key={s.id} d={path(o)} /> : null;
        })}
      </g>
    </svg>
  );
}

export function TemplateDialog({ onPick, onClose }: { onPick: (d: Design) => void; onClose: () => void }) {
  const previews = useMemo(() => TEMPLATES.map((t) => ({ t, d: t.make() })), []);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Neuer Entwurf</h2>
          <button className="mini" onClick={onClose}>✕</button>
        </header>
        <p className="muted">Vorlage wählen – alles lässt sich danach frei verändern. Der aktuelle Entwurf wird ersetzt (vorher speichern!).</p>
        <div className="templates">
          {previews.map(({ t, d }) => (
            <button key={t.id} className="template" onClick={() => onPick(t.make())}>
              <Thumb d={d} />
              <b>{t.name}</b>
              <span className="muted small">{t.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
