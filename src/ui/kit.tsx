import React from 'react';

export function Panel({ title, hint, right, children, className = '', tight }: { title?: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; tight?: boolean }) {
  return (
    <section className={`panel ${tight ? 'tight' : ''} ${className}`}>
      {(title || right) && (
        <div className="ph">
          {title && <h3>{title}</h3>}
          {hint && <span className="hint">{hint}</span>}
          <span className="grow" />
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ icon, label, value, unit, foot, color, bar }: { icon?: React.ReactNode; label: string; value: React.ReactNode; unit?: string; foot?: React.ReactNode; color?: string; bar?: number }) {
  return (
    <div className="panel kpi">
      <div className="k-label" style={{ color: color ? undefined : undefined }}>
        <span style={{ color: color ?? 'var(--ice)', display: 'inline-flex' }}>{icon}</span>
        {label}
      </div>
      <div className="k-val">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="k-foot">{foot}</div>}
      {bar != null && (
        <div className="k-bar">
          <i style={{ width: `${Math.max(0, Math.min(100, bar * 100))}%`, background: color ?? 'var(--ice)' }} />
        </div>
      )}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: React.ReactNode }) {
  return (
    <span className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="t" />
      {label}
    </span>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, fmt }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div className="field">
      <div className="lbl">
        <span>{label}</span>
        <b>{fmt ? fmt(value) : value}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

export function Badge({ kind = '', children }: { kind?: '' | 'ok' | 'warn' | 'bad' | 'ice'; children: React.ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className="sw" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export const kfmt = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
