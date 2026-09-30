// Lightweight SVG chart kit (no external charting dependency -> tiny bundle, works offline).
import React, { useEffect, useMemo, useRef, useState } from 'react';

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(200, Math.floor(e.contentRect.width)));
    });
    ro.observe(el);
    setW(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (max === min) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  const end = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= end + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  kind: 'line' | 'area' | 'band' | 'bar';
  data?: number[];
  lo?: number[];
  hi?: number[];
  stack?: string;
  axis?: 'left' | 'right';
  dash?: string;
  width?: number;
  opacity?: number;
  noTip?: boolean;
  noLegend?: boolean;
  fmt?: (v: number) => string;
  from?: number; // first index where the series is defined
}

export interface TimeChartProps {
  n: number;
  series: Series[];
  height?: number;
  xLabel: (i: number) => string;
  xTicks?: number[];
  tipTitle?: (i: number) => string;
  yMin?: number;
  yMax?: number;
  yUnit?: string;
  yFmt?: (v: number) => string;
  right?: { min: number; max: number; unit?: string; fmt?: (v: number) => string };
  markers?: { i: number; label: string; color?: string }[];
  shades?: { from: number; to: number; color: string; label?: string }[];
  legend?: boolean;
  zeroLine?: boolean;
}

const fmtDefault = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

export function TimeChart(p: TimeChartProps) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = p.height ?? 240;
  const pl = 46,
    pr = p.right ? 46 : 12,
    pt = p.yUnit || p.right?.unit ? 20 : 10,
    pb = 26;
  const w = Math.max(10, W - pl - pr),
    h = H - pt - pb;
  const n = p.n;
  const hasBars = p.series.some((s) => s.kind === 'bar');
  const x = (i: number) => (hasBars ? pl + ((i + 0.5) / n) * w : pl + (n <= 1 ? 0 : (i / (n - 1)) * w));

  // stacked areas / bars
  const stacked = useMemo(() => {
    const pos: Record<string, number[]> = {};
    const neg: Record<string, number[]> = {};
    const res: Record<string, { lo: number[]; hi: number[] }> = {};
    for (const s of p.series) {
      if ((s.kind !== 'area' && s.kind !== 'bar') || !s.data) continue;
      const g = s.stack ?? s.key;
      pos[g] = pos[g] ?? new Array(n).fill(0);
      neg[g] = neg[g] ?? new Array(n).fill(0);
      const lo: number[] = [],
        hi: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = s.data[i] ?? 0;
        if (v >= 0) {
          lo.push(pos[g][i]);
          pos[g][i] += v;
          hi.push(pos[g][i]);
        } else {
          hi.push(neg[g][i]);
          neg[g][i] += v;
          lo.push(neg[g][i]);
        }
      }
      res[s.key] = { lo, hi };
    }
    return res;
  }, [p.series, n]);

  const [yMin, yMax] = useMemo(() => {
    let mn = Infinity,
      mx = -Infinity;
    for (const s of p.series) {
      if (s.axis === 'right') continue;
      const arrs: number[][] = [];
      if (stacked[s.key]) arrs.push(stacked[s.key].lo, stacked[s.key].hi);
      else if (s.kind === 'band') arrs.push(s.lo!, s.hi!);
      else if (s.data) arrs.push(s.data);
      for (const a of arrs)
        for (let i = s.from ?? 0; i < a.length; i++) {
          const v = a[i];
          if (v == null || !isFinite(v)) continue;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
    }
    if (!isFinite(mn)) (mn = 0), (mx = 1);
    mn = p.yMin ?? Math.min(0, mn);
    mx = p.yMax ?? mx + (mx - mn) * 0.08;
    const t = niceTicks(mn, mx, 5);
    return [p.yMin ?? Math.min(mn, t[0]), p.yMax ?? Math.max(mx, t[t.length - 1])];
  }, [p.series, stacked, p.yMin, p.yMax]);

  const y = (v: number) => pt + h - ((v - yMin) / (yMax - yMin || 1)) * h;
  const yr = (v: number) => (p.right ? pt + h - ((v - p.right.min) / (p.right.max - p.right.min || 1)) * h : 0);
  const ticks = niceTicks(yMin, yMax, 5).filter((t) => t >= yMin - 1e-9 && t <= yMax + 1e-9);
  const rticks = p.right ? niceTicks(p.right.min, p.right.max, 4).filter((t) => t >= p.right!.min - 1e-9 && t <= p.right!.max + 1e-9) : [];
  const xt0 = p.xTicks ?? Array.from({ length: 7 }, (_, k) => Math.round((k * (n - 1)) / 6));
  const xt: number[] = [];
  for (const i of xt0) if (!xt.length || x(i) - x(xt[xt.length - 1]) >= 62) xt.push(i);
  const yFmt = p.yFmt ?? ((v: number) => `${+v.toFixed(1)}`);
  const barGroups = Array.from(new Set(p.series.filter((s) => s.kind === 'bar').map((s) => s.stack ?? s.key)));
  const G = Math.max(1, barGroups.length);
  const bw = hasBars ? Math.max(1, ((w / n) * 0.78) / G) : 0;
  const bOff = (s: Series) => (barGroups.indexOf(s.stack ?? s.key) - (G - 1) / 2) * bw;

  const pathLine = (d: number[], ys: (v: number) => number, from = 0) => {
    let s = '';
    let pen = false;
    for (let i = from; i < n; i++) {
      const v = d[i];
      if (v == null || !isFinite(v)) {
        pen = false;
        continue;
      }
      s += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${ys(v).toFixed(1)}`;
      pen = true;
    }
    return s;
  };
  const pathArea = (lo: number[], hi: number[], from = 0) => {
    let s = '';
    for (let i = from; i < n; i++) s += `${i === from ? 'M' : 'L'}${x(i).toFixed(1)},${y(hi[i]).toFixed(1)}`;
    for (let i = n - 1; i >= from; i--) s += `L${x(i).toFixed(1)},${y(lo[i]).toFixed(1)}`;
    return s + 'Z';
  };

  const onMove = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = clientX - r.left;
    let i = hasBars ? Math.floor(((mx - pl) / w) * n) : Math.round(((mx - pl) / w) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
  };

  const tipLeft = hover != null ? Math.min(Math.max(x(hover) + 12, 0), W - 190) : 0;
  const tipFlip = hover != null && x(hover) > W * 0.6;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={W}
        height={H}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        {p.shades?.map((s, k) => (
          <g key={k}>
            <rect x={x(Math.max(0, s.from)) - (hasBars ? bw / 2 : 0)} y={pt} width={Math.max(2, x(Math.min(n - 1, s.to)) - x(Math.max(0, s.from)))} height={h} fill={s.color} />
            {s.label && x(Math.min(n - 1, s.to)) - x(Math.max(0, s.from)) > 56 && (
              <text x={x(Math.max(0, s.from)) + 4} y={pt + 12} className="ax" style={{ fill: 'var(--muted)' }}>
                {s.label}
              </text>
            )}
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pl} x2={pl + w} y1={y(t)} y2={y(t)} />
            <text className="ax" x={pl - 6} y={y(t) + 4} textAnchor="end">
              {yFmt(t)}
            </text>
          </g>
        ))}
        {p.zeroLine && yMin < 0 && <line x1={pl} x2={pl + w} y1={y(0)} y2={y(0)} stroke="#8795a6" />}
        {p.right &&
          rticks.map((t) => (
            <text key={t} className="ax" x={pl + w + 6} y={yr(t) + 4}>
              {(p.right!.fmt ?? String)(t)}
            </text>
          ))}
        {p.yUnit && (
          <text className="axl" x={pl - 40} y={10} style={{ fontSize: 10.5 }}>
            {p.yUnit}
          </text>
        )}
        {p.right?.unit && (
          <text className="axl" x={pl + w + 6} y={10} style={{ fontSize: 10.5 }}>
            {p.right.unit}
          </text>
        )}
        {xt.map((i) => (
          <text key={i} className="ax" x={x(i)} y={H - 7} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {p.xLabel(i)}
          </text>
        ))}
        {/* areas & bars */}
        {p.series.map((s) => {
          const st = stacked[s.key];
          if (s.kind === 'area' && st)
            return <path key={s.key} d={pathArea(st.lo, st.hi, s.from ?? 0)} fill={s.color} fillOpacity={s.opacity ?? 0.55} stroke={s.color} strokeWidth={1} strokeOpacity={0.9} />;
          if (s.kind === 'bar' && st)
            return (
              <g key={s.key}>
                {st.hi.map((hi, i) => {
                  const top = y(Math.max(hi, st.lo[i])),
                    bot = y(Math.min(hi, st.lo[i]));
                  if (bot - top < 0.3) return null;
                  return <rect key={i} x={x(i) + bOff(s) - bw / 2} y={top} width={bw} height={bot - top} fill={s.color} opacity={s.opacity ?? 0.9} rx={1} />;
                })}
              </g>
            );
          if (s.kind === 'band' && s.lo && s.hi)
            return <path key={s.key} d={pathArea(s.lo, s.hi, s.from ?? 0)} fill={s.color} fillOpacity={s.opacity ?? 0.18} stroke="none" />;
          return null;
        })}
        {p.series
          .filter((s) => s.kind === 'line' && s.data)
          .map((s) => (
            <path
              key={s.key}
              d={pathLine(s.data!, s.axis === 'right' ? yr : y, s.from ?? 0)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={s.opacity ?? 1}
            />
          ))}
        {p.markers?.map((m, k) => (
          <g key={k}>
            <line x1={x(m.i)} x2={x(m.i)} y1={pt} y2={pt + h} stroke={m.color ?? 'var(--ice)'} strokeDasharray="3 4" strokeWidth={1.2} />
            <text x={x(m.i) + 5} y={pt + h - 6} className="ax" style={{ fill: m.color ?? 'var(--ice)' }}>
              {m.label}
            </text>
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pt} y2={pt + h} stroke="#7b8797" strokeWidth={1} />}
        {hover != null &&
          p.series
            .filter((s) => s.kind === 'line' && s.data && s.data[hover] != null && isFinite(s.data[hover]) && hover >= (s.from ?? 0))
            .map((s) => <circle key={s.key} cx={x(hover)} cy={(s.axis === 'right' ? yr : y)(s.data![hover])} r={3.5} fill={s.color} stroke="#ffffff" strokeWidth={1.5} />)}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: tipFlip ? Math.max(0, x(hover) - 200) : tipLeft, top: 8 }}>
          <div className="tt">{p.tipTitle ? p.tipTitle(hover) : p.xLabel(hover)}</div>
          {p.series
            .filter((s) => !s.noTip && hover >= (s.from ?? 0))
            .map((s) => {
              let v: string | null = null;
              if (s.kind === 'band' && s.lo && s.hi) v = `${(s.fmt ?? fmtDefault)(s.lo[hover])} - ${(s.fmt ?? fmtDefault)(s.hi[hover])}`;
              else if (s.data && s.data[hover] != null && isFinite(s.data[hover])) v = (s.fmt ?? fmtDefault)(s.data[hover]);
              if (v == null) return null;
              return (
                <div className="tr" key={s.key}>
                  <span>
                    <i className="sw" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <b>{v}</b>
                </div>
              );
            })}
        </div>
      )}
      {p.legend !== false && (
        <div className="legend">
          {p.series
            .filter((s) => !s.noLegend)
            .map((s) => (
              <span key={s.key}>
                <i
                  className="sw"
                  style={{
                    background: s.kind === 'line' ? 'transparent' : s.color,
                    opacity: s.kind === 'band' ? 0.5 : 1,
                    borderTop: s.kind === 'line' ? `2px ${s.dash ? 'dashed' : 'solid'} ${s.color}` : undefined,
                    height: s.kind === 'line' ? 0 : 9,
                    width: s.kind === 'line' ? 14 : 9,
                  }}
                />
                {s.label}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

/** Grouped (or stacked) categorical bar chart. */
export function BarChart(p: {
  categories: string[];
  groups: { label: string; color: string; data: number[] }[];
  height?: number;
  stacked?: boolean;
  yFmt?: (v: number) => string;
  yUnit?: string;
  valueFmt?: (v: number) => string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = p.height ?? 220;
  const pl = 46,
    pr = 10,
    pt = p.yUnit ? 22 : 12,
    pb = 26;
  const w = W - pl - pr,
    h = H - pt - pb;
  const n = p.categories.length;
  const maxV = Math.max(
    1e-9,
    ...(p.stacked ? p.categories.map((_, i) => p.groups.reduce((a, g) => a + Math.max(0, g.data[i]), 0)) : p.groups.flatMap((g) => g.data)),
  );
  const ticks = niceTicks(0, maxV * 1.05, 4);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => pt + h - (v / top) * h;
  const slot = w / n;
  const gw = p.stacked ? slot * 0.6 : (slot * 0.78) / p.groups.length;
  const fmt = p.yFmt ?? ((v: number) => `${+v.toFixed(1)}`);
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pl} x2={pl + w} y1={y(t)} y2={y(t)} />
            <text className="ax" x={pl - 6} y={y(t) + 4} textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {p.yUnit && (
          <text className="axl" x={pl - 40} y={10} style={{ fontSize: 10.5 }}>
            {p.yUnit}
          </text>
        )}
        {p.categories.map((c, i) => {
          let acc = 0;
          return (
            <g key={c} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={pl + i * slot} y={pt} width={slot} height={h} fill={hover === i ? 'rgba(29,93,155,0.06)' : 'transparent'} />
              {p.groups.map((g, k) => {
                const v = Math.max(0, g.data[i]);
                if (p.stacked) {
                  const r = <rect key={k} x={pl + i * slot + (slot - gw) / 2} y={y(acc + v)} width={gw} height={Math.max(0, y(acc) - y(acc + v))} fill={g.color} rx={2} />;
                  acc += v;
                  return r;
                }
                return <rect key={k} x={pl + i * slot + slot * 0.11 + k * gw} y={y(v)} width={gw - 2} height={Math.max(0, y(0) - y(v))} fill={g.color} rx={2} />;
              })}
              <text className="ax" x={pl + i * slot + slot / 2} y={H - 8} textAnchor="middle">
                {c}
              </text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: Math.min(pl + hover * slot + slot, W - 190), top: 6 }}>
          <div className="tt">{p.categories[hover]}</div>
          {p.groups.map((g) => (
            <div className="tr" key={g.label}>
              <span>
                <i className="sw" style={{ background: g.color }} />
                {g.label}
              </span>
              <b>{(p.valueFmt ?? fmt)(g.data[hover])}</b>
            </div>
          ))}
        </div>
      )}
      <div className="legend">
        {p.groups.map((g) => (
          <span key={g.label}>
            <i className="sw" style={{ background: g.color }} />
            {g.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Semi-circular gauge. */
export function Gauge({ value, max, color, label, sub, size = 180 }: { value: number; max: number; color: string; label: string; sub?: string; size?: number }) {
  const f = Math.max(0, Math.min(1, value / max));
  const r = size / 2 - 12;
  const cx = size / 2,
    cy = size / 2 + 4;
  const a0 = Math.PI,
    a1 = Math.PI * (1 - f);
  const arc = (a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [x0, y0] = arc(a0);
  const [x1, y1] = arc(a1);
  const [xe, ye] = arc(0);
  return (
    <svg width={size} height={size / 2 + 26} viewBox={`0 0 ${size} ${size / 2 + 26}`}>
      <path d={`M${x0},${y0} A${r},${r} 0 0 1 ${xe},${ye}`} stroke="#e3e8ee" strokeWidth={12} fill="none" strokeLinecap="round" />
      <path d={`M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`} stroke={color} strokeWidth={12} fill="none" strokeLinecap="round" />
      <text x={cx} y={cy - 12} textAnchor="middle" style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600, fill: 'var(--text)' }}>
        {label}
      </text>
      {sub && (
        <text x={cx} y={cy + 8} textAnchor="middle" style={{ fontSize: 11.5, fill: 'var(--muted)' }}>
          {sub}
        </text>
      )}
    </svg>
  );
}

export function Sparkline({ data, color, height = 36 }: { data: number[]; color: string; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const mn = Math.min(...data),
    mx = Math.max(...data);
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(height - 3 - ((v - mn) / (mx - mn || 1)) * (height - 6)).toFixed(1)}`);
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={W} height={height}>
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.8} />
      </svg>
    </div>
  );
}
