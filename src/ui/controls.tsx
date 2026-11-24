import { useEffect, useState, type ReactNode } from 'react';

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel ${open ? 'open' : ''}`}>
      <header onClick={() => setOpen(!open)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <h3>{title}</h3>
        {right && <span className="panel-right" onClick={(e) => e.stopPropagation()}>{right}</span>}
      </header>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}

/** Number input that only commits valid numbers (allows typing "1," etc.). */
export function NumberInput({ value, onChange, step = 0.1, min, max, width = 64 }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; width?: number }) {
  const [text, setText] = useState(fmtNum(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmtNum(value));
  }, [value, focused]);
  const commit = (t: string) => {
    const v = parseFloat(t.replace(',', '.'));
    if (Number.isFinite(v)) {
      let c = v;
      if (min !== undefined) c = Math.max(min, c);
      if (max !== undefined) c = Math.min(max, c);
      onChange(c);
    }
  };
  return (
    <input
      className="num"
      style={{ width }}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit(text);
      }}
      onChange={(e) => {
        setText(e.target.value);
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const v = value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
          onChange(Math.round(v * 1000) / 1000);
        }
      }}
    />
  );
}

export function fmtNum(v: number): string {
  return (Math.round(v * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

export function SliderRow({
  label, value, onChange, min, max, step, unit = 'mm', help, onCommit,
}: {
  label: string;
  value: number;
  onChange: (v: number, transient?: boolean) => void;
  onCommit?: () => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  help?: string;
}) {
  return (
    <div className="slider-row" title={help}>
      <label>
        {label}
        {help && <span className="help">?</span>}
      </label>
      <div className="slider-line">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => onChange(parseFloat(e.target.value), true)}
          onPointerUp={() => onCommit?.()}
          onKeyUp={() => onCommit?.()}
        />
        <NumberInput value={value} onChange={(v) => onChange(v, false)} step={step} min={0} width={58} />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="field">{children}</div>
    </div>
  );
}
