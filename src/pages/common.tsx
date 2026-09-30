import React from 'react';
import { LuPower, LuPowerOff, LuBatteryCharging, LuFlame, LuCalendarClock, LuCloudSnow, LuInfo } from 'react-icons/lu';
import { Explanation, fmtDayTime, fmtTime, fmtDay, Snapshot } from '../engine';
import { HourResult, reSplit } from '../opt/dispatch';

export const COL = {
  wind: '#1b7f79',
  solar: '#c08a12',
  diesel: '#b5561d',
  battery: '#5b54a8',
  battIn: '#a9a4dc',
  soc: '#5b54a8',
  heat: '#a4457a',
  boiler: '#9b2c2c',
  load: '#14243a',
  p90: '#7b8797',
  ice: '#1d5d9b',
  ok: '#2e7d32',
  warn: '#b7791f',
  bad: '#c0392b',
  muted: '#4d5d71',
  conv: '#5f6b7a',
  rule: '#a3adb9',
  ai: '#1d5d9b',
  curtail: '#8a96a5',
  gens: ['#b5561d', '#d0763a', '#e3a578'],
  blizShade: 'rgba(192,57,43,0.07)',
  planShade: 'rgba(29,93,155,0.045)',
  outShade: 'rgba(181,86,29,0.08)',
};

const KIND: Record<Explanation['kind'], { icon: React.ReactNode; color: string }> = {
  start: { icon: <LuPower />, color: COL.diesel },
  stop: { icon: <LuPowerOff />, color: COL.ok },
  battery: { icon: <LuBatteryCharging />, color: COL.battery },
  p2h: { icon: <LuFlame />, color: COL.heat },
  dr: { icon: <LuCalendarClock />, color: COL.ice },
  storm: { icon: <LuCloudSnow />, color: COL.bad },
  info: { icon: <LuInfo />, color: COL.muted },
};

/** Decision log. Every entry can be expanded ("Why?") to show the facts the optimiser used. */
export function DecisionFeed({ items, max = 40, open: openFirst = false }: { items: Explanation[]; max?: number; open?: boolean }) {
  const [open, setOpen] = React.useState<number | null>(openFirst ? 0 : null);
  if (!items.length) return <div className="note">No set-point changes in this horizon.</div>;
  return (
    <div className="feed">
      {items.slice(0, max).map((e, k) => (
        <div className="feed-item" key={k}>
          <div className="ic" style={{ color: KIND[e.kind].color }}>
            {KIND[e.kind].icon}
          </div>
          <div>
            <div className="row between" style={{ gap: 6 }}>
              <span className="ti">
                {e.title}
                <button className={`why-btn ${open === k ? 'on' : ''}`} onClick={() => setOpen(open === k ? null : k)}>
                  Why?
                </button>
              </span>
              <span className="tm">{e.t === 0 ? 'now' : fmtDayTime(e.ms)}</span>
            </div>
            {open === k ? (
              <div className="why">
                <div className="wh">Reason</div>
                <ul>
                  {e.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <div className="wh" style={{ marginTop: 6 }}>Action</div>
                <div className="act">{e.action}</div>
              </div>
            ) : (
              <div className="de">{e.detail}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Build the continuous history(72h)+plan(48h) arrays used by overview & dispatch charts. */
export function timeline(s: Snapshot) {
  const hist = s.history;
  const K = hist.ms.length;
  const plan = s.ai.hours;
  const ms = [...hist.ms, ...s.ms];
  const pick = (h: HourResult) => reSplit(h);
  const wind = [...hist.wind, ...plan.map((h) => pick(h).w)];
  const pv = [...hist.pv, ...plan.map((h) => pick(h).pv)];
  const gen = [...hist.gen, ...plan.map((h) => h.pg)];
  const batt = [...hist.batt, ...plan.map((h) => h.battery)];
  const p2h = [...hist.p2h, ...plan.map((h) => h.p2h)];
  const load = [...hist.load, ...plan.map((h) => h.load)];
  const soc = [...hist.soc, ...plan.map((h) => h.soc)];
  return {
    K,
    n: ms.length,
    ms,
    wind,
    pv,
    gen,
    battOut: batt.map((b) => Math.max(0, b)),
    battIn: batt.map((b) => Math.min(0, b)),
    p2h: p2h.map((v) => -v),
    load,
    soc: soc.map((v) => v * 100),
  };
}

export const tickEvery = (n: number, every: number, offset = 0) => {
  const out: number[] = [];
  for (let i = offset; i < n; i += every) out.push(i);
  return out;
};

export function timeTicks(ms: number[], stepH: number) {
  // ticks aligned to IST midnight / 6-hourly marks
  const out: number[] = [];
  ms.forEach((t, i) => {
    const hIST = Math.floor(((t / 3600000 + 5.5) % 24) + 24) % 24;
    if (hIST % stepH === 0) out.push(i);
  });
  return out;
}

export const labelTime = (ms: number) => {
  const hIST = Math.floor(((ms / 3600000 + 5.5) % 24) + 24) % 24;
  return hIST === 0 ? fmtDay(ms) : fmtTime(ms);
};

export { fmtDayTime, fmtTime, fmtDay };
