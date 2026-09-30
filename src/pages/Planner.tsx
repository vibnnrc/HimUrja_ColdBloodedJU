import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LuWind, LuSun, LuBatteryCharging, LuFuel, LuLeaf, LuIndianRupee, LuSparkles, LuPlay, LuTimer } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Kpi, Slider, Toggle, Badge, kfmt, pct } from '../ui/kit';
import { BarChart, useWidth, niceTicks } from '../ui/charts';
import { COL } from './common';
import { annualProjection, AnnualResult, MONTHS } from '../opt/annual';
import { getYear } from '../sim/dataset';
import { StationConfig, DIESEL } from '../sim/stations';

interface Cfg {
  windUnits: number;
  pv: number;
  batt: number;
  p2h: boolean;
  crew: number;
}

// Indicative installed costs in Antarctica (equipment + polar logistics + installation). Editable assumptions.
const CAPEX = { windPerUnit60kW: 2.4e7, pvPerKWp: 1.2e5, battPerKWh: 4.5e4, p2h: 1.5e6, ems: 2.5e6 };
const MAINT_PER_GEN_HOUR = 400; // Rs per genset run-hour (oil, filters, overhaul reserve)

function configure(st: StationConfig, c: Cfg): StationConfig {
  return {
    ...st,
    wind: { ...st.wind, units: c.windUnits, unitKW: 60 },
    pv: { ...st.pv, kWp: c.pv },
    battery: { ...st.battery, kWh: c.batt, kW: Math.min(300, Math.round(c.batt * 0.375)) },
    p2hKW: c.p2h ? 150 : 0,
  };
}

const capexOf = (c: Cfg) =>
  c.windUnits * CAPEX.windPerUnit60kW + c.pv * CAPEX.pvPerKWp + c.batt * CAPEX.battPerKWh + (c.p2h ? CAPEX.p2h : 0) + CAPEX.ems;

interface Point {
  c: Cfg;
  fuel: number;
  capex: number;
  lcc: number;
  re: number;
}

export function PlannerPage() {
  const { st } = useApp();
  const base: Cfg = { windUnits: st.wind.units, pv: st.pv.kWp, batt: st.battery.kWh, p2h: st.p2hKW > 0, crew: 0 };
  const [cfg, setCfg] = useState<Cfg>(base);
  const [cost, setCost] = useState(250);
  const [res, setRes] = useState<AnnualResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState<{ pts: Point[]; done: number; total: number; dieselFuel: number } | null>(null);
  const cancel = useRef(false);

  useEffect(() => {
    setCfg({ windUnits: st.wind.units, pv: st.pv.kWp, batt: st.battery.kWh, p2h: st.p2hKW > 0, crew: 0 });
    setSearch(null);
  }, [st.id]);

  useEffect(() => {
    setBusy(true);
    const id = setTimeout(() => {
      const r = annualProjection(configure(st, cfg), getYear(st), cfg.crew ? { winterDelta: cfg.crew } : undefined);
      setRes(r);
      setBusy(false);
    }, 250);
    return () => clearTimeout(id);
  }, [cfg, st]);

  const runSearch = () => {
    cancel.current = false;
    const grid: Cfg[] = [];
    for (const w of [0, 1, 2, 3, 4]) for (const pv of [0, 60, 120, 180]) for (const b of [0, 200, 400, 800]) grid.push({ windUnits: w, pv, batt: b, p2h: true, crew: cfg.crew });
    const y = getYear(st);
    const months = [0, 3, 6, 9];
    const pts: Point[] = [];
    const dieselFuel = annualProjection(configure(st, grid[0]), y, undefined, { months }).diesel.fuel;
    setSearch({ pts: [], done: 0, total: grid.length, dieselFuel });
    let i = 0;
    const step = () => {
      if (cancel.current) return;
      const t0 = performance.now();
      while (i < grid.length && performance.now() - t0 < 60) {
        const c = grid[i++];
        const r = annualProjection(configure(st, c), y, c.crew ? { winterDelta: c.crew } : undefined, { months, socLevels: 13, aiOnly: true });
        const capex = capexOf(c);
        const annualCost = r.ai.fuel * cost + r.ai.genHours * MAINT_PER_GEN_HOUR;
        pts.push({ c, fuel: r.ai.fuel, capex, lcc: capex + 15 * annualCost, re: r.ai.renewableShare });
      }
      setSearch({ pts: pts.slice(), done: i, total: grid.length, dieselFuel });
      if (i < grid.length) setTimeout(step, 0);
    };
    setTimeout(step, 30);
  };
  useEffect(() => () => void (cancel.current = true), []);

  const capex = capexOf(cfg);
  const savings = res ? (res.diesel.fuel - res.ai.fuel) * cost + (res.diesel.genHours - res.ai.genHours) * MAINT_PER_GEN_HOUR : 0;
  const payback = savings > 0 ? capex / savings : Infinity;
  const mix = useMemo(() => {
    if (!res) return null;
    return {
      wind: res.months.map((m) => (m.ai.reKWh * m.scale * (m.windKWh / Math.max(1, m.windKWh + m.pvKWh))) / 1000),
      pv: res.months.map((m) => (m.ai.reKWh * m.scale * (m.pvKWh / Math.max(1, m.windKWh + m.pvKWh))) / 1000),
      dg: res.months.map((m) => Math.max(0, (m.ai.loadKWh - m.ai.reKWh) * m.scale) / 1000),
    };
  }, [res]);
  const best = search && search.done === search.total ? search.pts.reduce((a, b) => (b.lcc < a.lcc ? b : a)) : null;

  return (
    <div className="stack">
      <div className="grid g-side">
        <Panel title="Configuration" hint="drag to explore - annual result updates live" right={busy ? <span className="spinner" /> : <Badge kind="ok">up to date</Badge>}>
          <div className="stack">
            <Slider label="Wind turbines (60 kW cold-climate)" value={cfg.windUnits} min={0} max={4} onChange={(v) => setCfg({ ...cfg, windUnits: v })} fmt={(v) => `${v} × 60 = ${v * 60} kW`} />
            <Slider label="Solar PV (bifacial, 70° tilt)" value={cfg.pv} min={0} max={250} step={10} onChange={(v) => setCfg({ ...cfg, pv: v })} fmt={(v) => `${v} kWp`} />
            <Slider label="Battery energy storage (LFP, heated)" value={cfg.batt} min={0} max={1200} step={50} onChange={(v) => setCfg({ ...cfg, batt: v })} fmt={(v) => `${v} kWh / ${Math.min(300, Math.round(v * 0.375))} kW`} />
            <Toggle on={cfg.p2h} onChange={(v) => setCfg({ ...cfg, p2h: v })} label="Electric boiler for surplus (power-to-heat, 150 kW)" />
            <Slider label="Extra wintering crew" value={cfg.crew} min={-5} max={20} onChange={(v) => setCfg({ ...cfg, crew: v })} fmt={(v) => `${v > 0 ? '+' : ''}${v}`} />
            <Slider label="Landed diesel cost" value={cost} min={120} max={600} step={10} onChange={setCost} fmt={(v) => `₹${v}/L`} />
            <button className="btn ghost" onClick={() => setCfg(base)}>Reset to station default</button>
          </div>
        </Panel>
        <div className="stack">
          <div className="grid g3">
            <Kpi icon={<LuFuel />} color={COL.ai} label="Annual diesel (HimUrja)" value={res ? kfmt(res.ai.fuel / 1000) : '-'} unit="kL" foot={res ? `diesel-only ${kfmt(res.diesel.fuel / 1000)} kL · rule-based ${kfmt(res.rule.fuel / 1000)} kL` : ''} />
            <Kpi icon={<LuLeaf />} color={COL.ok} label="Renewable share" value={res ? pct(res.ai.renewableShare) : '-'} foot={res ? `${kfmt((res.diesel.co2t - res.ai.co2t))} t CO₂ avoided / yr` : ''} bar={res?.ai.renewableShare} />
            <Kpi icon={<LuIndianRupee />} color={COL.solar} label="Simple payback" value={isFinite(payback) ? payback.toFixed(1) : '-'} unit="years" foot={`capex ₹${(capex / 1e7).toFixed(2)} cr · saves ₹${(savings / 1e7).toFixed(2)} cr/yr`} />
          </div>
          <Panel title="Monthly energy supply with HimUrja" hint="where the station's electricity comes from">
            {mix && (
              <BarChart
                height={250}
                stacked
                categories={MONTHS}
                yUnit="MWh"
                valueFmt={(v) => `${v.toFixed(1)} MWh`}
                groups={[
                  { label: 'Wind', color: COL.wind, data: mix.wind },
                  { label: 'Solar', color: COL.solar, data: mix.pv },
                  { label: 'Diesel gensets', color: COL.diesel, data: mix.dg },
                ]}
              />
            )}
            <div className="note">Solar is strong from October to February (24 h daylight around the solstice) and zero in the polar night (May-July); wind is strongest in winter - the two complement each other, which is why a hybrid plus storage works at 70°S.</div>
          </Panel>
        </div>
      </div>

      <Panel
        title="Sizing search"
        hint="searches 80 wind × PV × battery combinations and ranks them by 15-year life-cycle cost"
        right={
          <button className="btn primary" onClick={runSearch} disabled={!!search && search.done < search.total}>
            {search && search.done < search.total ? <span className="spinner" /> : <LuSparkles />} Run sizing search
          </button>
        }
      >
        {!search && (
          <div className="note">
            Use this for Maitri-II design or a Bharati retrofit: every candidate is simulated with the full HimUrja controller on 4 representative seasons (fast mode), so the recommendation already accounts
            for smart operation - not just nameplate yield.
          </div>
        )}
        {search && (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="progress" style={{ flex: 1 }}>
                <i style={{ width: `${(search.done / search.total) * 100}%`, background: COL.ai }} />
              </div>
              <span className="mono note">
                <LuTimer style={{ verticalAlign: -2 }} /> {search.done}/{search.total}
              </span>
            </div>
            <div className="grid g-main">
              <Scatter pts={search.pts} best={best} dieselFuel={search.dieselFuel} current={cfg} />
              <div>
                {best ? (
                  <>
                    <div className="alert ok">
                      <LuSparkles style={{ color: COL.ok }} />
                      <div>
                        <b>Recommended:</b> {best.c.windUnits} × 60 kW wind, {best.c.pv} kWp PV, {best.c.batt} kWh battery.
                        <div className="muted">
                          {kfmt(best.fuel / 1000)} kL/yr ({pct(1 - best.fuel / search.dieselFuel)} less than diesel-only), capex ₹{(best.capex / 1e7).toFixed(1)} cr, 15-yr cost ₹{(best.lcc / 1e7).toFixed(1)} cr.
                        </div>
                      </div>
                    </div>
                    <button className="btn mt" onClick={() => setCfg({ ...best.c })}>
                      <LuPlay /> Load into planner
                    </button>
                    <table className="tbl mt">
                      <thead>
                        <tr>
                          <th>Top configurations</th>
                          <th className="num">kL/yr</th>
                          <th className="num">15-yr ₹cr</th>
                        </tr>
                      </thead>
                      <tbody>
                        {search.pts
                          .slice()
                          .sort((a, b) => a.lcc - b.lcc)
                          .slice(0, 5)
                          .map((p, k) => (
                            <tr key={k}>
                              <td>
                                <LuWind style={{ color: COL.wind, verticalAlign: -2 }} /> {p.c.windUnits * 60} <LuSun style={{ color: COL.solar, verticalAlign: -2, marginLeft: 6 }} /> {p.c.pv}{' '}
                                <LuBatteryCharging style={{ color: COL.battery, verticalAlign: -2, marginLeft: 6 }} /> {p.c.batt}
                              </td>
                              <td className="num">{kfmt(p.fuel / 1000)}</td>
                              <td className="num">{(p.lcc / 1e7).toFixed(1)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <div className="note">Simulating candidates...</div>
                )}
              </div>
            </div>
          </>
        )}
        <div className="note mt">
          Indicative installed costs in Antarctica: wind ₹{CAPEX.windPerUnit60kW / 1e7} cr per 60 kW turbine, PV ₹{CAPEX.pvPerKWp / 1e5} lakh/kWp, battery ₹{CAPEX.battPerKWh / 1e3}k/kWh, EMS ₹
          {CAPEX.ems / 1e5} lakh; genset upkeep ₹{MAINT_PER_GEN_HOUR}/run-hour. CO₂ factor {st.fuel.co2PerL} kg/L ({st.fuel.type}, IPCC 2006 default factors). All are editable assumptions.
        </div>
      </Panel>
    </div>
  );
}

function Scatter({ pts, best, dieselFuel, current }: { pts: Point[]; best: Point | null; dieselFuel: number; current: Cfg }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hov, setHov] = useState<Point | null>(null);
  const H = 300,
    pl = 50,
    pr = 12,
    pt = 24,
    pb = 34;
  const w = W - pl - pr,
    h = H - pt - pb;
  const xMax = Math.max(1, ...pts.map((p) => p.capex / 1e7)) * 1.05;
  const yMax = (dieselFuel / 1000) * 1.05;
  const xt = niceTicks(0, xMax, 5);
  const yt = niceTicks(0, yMax, 5);
  const x = (v: number) => pl + (v / xt[xt.length - 1]) * w;
  const y = (v: number) => pt + h - (v / yt[yt.length - 1]) * h;
  const same = (a: Cfg, b: Cfg) => a.windUnits === b.windUnits && a.pv === b.pv && a.batt === b.batt;
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H}>
        {yt.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pl} x2={pl + w} y1={y(t)} y2={y(t)} />
            <text className="ax" x={pl - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={t} className="ax" x={x(t)} y={H - 16} textAnchor="middle">
            {t}
          </text>
        ))}
        <text className="axl" x={pl + w / 2} y={H - 2} textAnchor="middle">
          capex (₹ crore)
        </text>
        <text className="axl" x={4} y={11}>
          diesel kL/yr
        </text>
        <line x1={pl} x2={pl + w} y1={y(dieselFuel / 1000)} y2={y(dieselFuel / 1000)} stroke={COL.bad} strokeDasharray="5 5" />
        <text className="ax" x={pl + w - 4} y={y(dieselFuel / 1000) - 5} textAnchor="end" style={{ fill: COL.bad }}>
          diesel-only today
        </text>
        {pts.map((p, k) => {
          const isBest = best && same(p.c, best.c);
          const isCur = same(p.c, current);
          const r = 3 + p.c.batt / 200;
          return (
            <circle
              key={k}
              cx={x(p.capex / 1e7)}
              cy={y(p.fuel / 1000)}
              r={isBest ? r + 3 : r}
              fill={isBest ? COL.ok : `hsl(${170 + p.re * 60}, 70%, ${45 + p.re * 20}%)`}
              fillOpacity={isBest ? 1 : 0.7}
              stroke={isCur ? '#14243a' : isBest ? COL.ok : 'none'}
              strokeWidth={isCur ? 2 : 1.5}
              onMouseEnter={() => setHov(p)}
              onMouseLeave={() => setHov(null)}
            />
          );
        })}
      </svg>
      {hov && (
        <div className="tip" style={{ left: Math.min(x(hov.capex / 1e7) + 10, W - 190), top: Math.max(0, y(hov.fuel / 1000) - 60) }}>
          <div className="tt">
            {hov.c.windUnits * 60} kW wind · {hov.c.pv} kWp PV · {hov.c.batt} kWh
          </div>
          <div className="tr"><span>Diesel</span><b>{kfmt(hov.fuel / 1000)} kL/yr</b></div>
          <div className="tr"><span>Renewable share</span><b>{pct(hov.re)}</b></div>
          <div className="tr"><span>Capex</span><b>₹{(hov.capex / 1e7).toFixed(2)} cr</b></div>
          <div className="tr"><span>15-yr cost</span><b>₹{(hov.lcc / 1e7).toFixed(1)} cr</b></div>
        </div>
      )}
      <div className="legend">
        <span><i className="sw" style={{ background: COL.ok }} />lowest life-cycle cost</span>
        <span><i className="sw" style={{ background: 'transparent', border: '2px solid #14243a' }} />current planner setting</span>
        <span>dot size = battery · colour = renewable share</span>
      </div>
    </div>
  );
}
