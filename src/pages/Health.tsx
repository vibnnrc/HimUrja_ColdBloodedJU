import React, { useMemo } from 'react';
import { LuWrench, LuTriangleAlert, LuCircleCheck, LuWind, LuSun, LuBatteryFull, LuActivity } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Kpi, Badge, kfmt, pct } from '../ui/kit';
import { TimeChart, useWidth } from '../ui/charts';
import { COL } from './common';
import { mulberry32, gaussian } from '../sim/rng';
import { hubWind, densityRatio } from '../sim/assets';
import { wrapH, fmtDay } from '../engine';
import { DIESEL } from '../sim/stations';

const SERVICE_H = 500;

/** Synthetic 60-day specific-fuel-consumption history per genset, with an injector-fouling drift on one unit. */
function sfcHistory(seed: number, faulty: boolean) {
  const g = gaussian(mulberry32(seed));
  const base = DIESEL.F0 / 0.7 + DIESEL.F1; // L/kWh at 70% load
  return Array.from({ length: 60 }, (_, d) => base + 0.004 * g() + (faulty && d > 38 ? 0.0016 * (d - 38) : 0));
}

function ewma(x: number[], lambda = 0.25, nBase = 30) {
  const mu = x.slice(0, nBase).reduce((a, b) => a + b, 0) / nBase;
  const sd = Math.sqrt(x.slice(0, nBase).reduce((a, b) => a + (b - mu) ** 2, 0) / (nBase - 1));
  const lim = 3 * sd * Math.sqrt(lambda / (2 - lambda));
  const z: number[] = [];
  let e = mu;
  x.forEach((v) => {
    e = lambda * v + (1 - lambda) * e;
    z.push(e);
  });
  const alarm = z.findIndex((v, i) => i >= nBase && v > mu + lim);
  return { z, ucl: mu + lim, lcl: mu - lim, mu, alarm };
}

export function HealthPage() {
  const { snap: s, st, annual, simMs } = useApp();
  const faultyIdx = st.id === 'maitri' ? 1 : 0;
  const gens = useMemo(
    () =>
      st.gens.map((g, u) => {
        const sfc = sfcHistory(st.seed * 13 + u, u === faultyIdx);
        const cc = ewma(sfc);
        const planHours = s.ai.hours.filter((h) => h.on & (1 << u)).length;
        const perDay = planHours / 2;
        const left = SERVICE_H - g.hoursSinceService;
        return { g, u, sfc, cc, perDay, left, daysToService: perDay > 0.05 ? left / perDay : Infinity };
      }),
    [st, s, faultyIdx],
  );
  const days = Array.from({ length: 60 }, (_, d) => simMs - (59 - d) * 86400000);

  // wind turbine power-curve monitoring over the last 30 days
  const pc = useMemo(() => {
    const pts: { v: number; p: number; ice: boolean }[] = [];
    let iceH = 0,
      lostKWh = 0;
    for (let i = 0; i < 720; i++) {
      const h = wrapH(s.now - 720 + i);
      const v = hubWind(s.y.wx.wind[h], st.wind.hubHeight);
      const p = s.y.windPU[h];
      const ice = s.y.wx.icing[h] > 0.08;
      if (ice) {
        iceH++;
        lostKWh += (p / Math.max(0.05, 1 - s.y.wx.icing[h])) * s.y.wx.icing[h] * st.wind.unitKW * st.wind.units;
      }
      if (v < 28) pts.push({ v, p, ice });
    }
    const energy = Array.from({ length: 720 }, (_, i) => s.y.windPU[wrapH(s.now - 720 + i)]).reduce((a, b) => a + b, 0) * st.wind.unitKW * st.wind.units;
    return { pts, iceH, lostKWh, energy };
  }, [s, st]);

  // PV performance ratio last 14 days
  const pv = useMemo(() => {
    const n = 14 * 24;
    const act: number[] = [],
      exp: number[] = [],
      ms: number[] = [];
    let snowH = 0;
    for (let i = 0; i < n; i++) {
      const h = wrapH(s.now - n + i);
      const a = s.y.pvPU[h] * st.pv.kWp;
      const e = s.y.wx.snowPV[h] > 0.02 ? a / Math.max(0.1, 1 - s.y.wx.snowPV[h]) : a;
      if (s.y.wx.snowPV[h] > 0.2 && e > 1) snowH++;
      act.push(a);
      exp.push(e);
      ms.push(s.nowMs - (n - i) * 3600000);
    }
    const pr = act.reduce((x, y) => x + y, 0) / Math.max(1, exp.reduce((x, y) => x + y, 0));
    return { act, exp, ms, snowH, pr };
  }, [s, st]);

  const cycles = annual.ai.batteryThroughput / 2 / Math.max(1, st.battery.kWh);
  const soh = 1 - 0.00004 * cycles * 2 - 0.008; // ~2 years in service, LFP calendar + cycle ageing
  const alarms = gens.filter((x) => x.cc.alarm >= 0);

  return (
    <div className="stack">
      {alarms.map((x) => (
        <div key={x.g.id} className="alert bad">
          <LuTriangleAlert style={{ color: COL.bad }} />
          <div>
            <b>{x.g.name}: specific fuel consumption drifting up</b> (+{(((x.sfc[59] - x.cc.mu) / x.cc.mu) * 100).toFixed(1)}% vs its own baseline, EWMA control limit crossed on{' '}
            {fmtDay(days[x.cc.alarm])}).
            <div className="muted">
              Likely injector fouling / air-filter restriction from low-load running. Recommended: inspect injectors & filters at next service. Until then HimUrja lowers this unit's priority in the commitment
              order, costing nothing in reliability.
            </div>
          </div>
        </div>
      ))}

      <div className="grid g3">
        {gens.map(({ g, u, sfc, cc, perDay, left, daysToService }) => (
          <Panel key={g.id} title={`${g.name} · ${g.rated} kW`} right={cc.alarm >= 0 ? <Badge kind="bad">anomaly</Badge> : left < 100 ? <Badge kind="warn">service soon</Badge> : <Badge kind="ok">healthy</Badge>}>
            <div className="row between" style={{ fontSize: 12.5 }}>
              <span className="muted">Service interval</span>
              <span className="mono">
                {g.hoursSinceService} / {SERVICE_H} h
              </span>
            </div>
            <div className="progress" style={{ margin: '6px 0 10px' }}>
              <i style={{ width: `${(g.hoursSinceService / SERVICE_H) * 100}%`, background: left < 100 ? COL.warn : COL.ok }} />
            </div>
            <div className="grid g2" style={{ gap: 8, fontSize: 12.5 }}>
              <div>
                <div className="muted">Total run-hours</div>
                <div className="mono">{kfmt(g.runHours + (u === 0 ? 0 : 0))}</div>
              </div>
              <div>
                <div className="muted">Planned use</div>
                <div className="mono">{perDay.toFixed(1)} h/day</div>
              </div>
              <div>
                <div className="muted">Next service in</div>
                <div className="mono">{isFinite(daysToService) ? `${kfmt(daysToService)} days` : 'standby'}</div>
              </div>
              <div>
                <div className="muted">SFC today</div>
                <div className="mono">{sfc[59].toFixed(3)} L/kWh</div>
              </div>
            </div>
            <div className="eyebrow mt">SFC trend · EWMA control chart (60 days)</div>
            <TimeChart
              n={60}
              height={130}
              legend={false}
              xLabel={(i) => fmtDay(days[i])}
              xTicks={[0, 30, 59]}
              yMin={Math.min(cc.lcl, ...sfc) - 0.004}
              yMax={Math.max(cc.ucl, ...sfc) + 0.004}
              yFmt={(v) => v.toFixed(3)}
              series={[
                { key: 'raw', label: 'Daily SFC', color: '#64748b', kind: 'line', data: sfc, width: 1, fmt: (v) => v.toFixed(3) },
                { key: 'ew', label: 'EWMA', color: cc.alarm >= 0 ? COL.bad : COL.ok, kind: 'line', data: cc.z, width: 2, fmt: (v) => v.toFixed(3) },
                { key: 'ucl', label: 'Upper control limit', color: COL.warn, kind: 'line', data: sfc.map(() => cc.ucl), dash: '4 4', width: 1, fmt: (v) => v.toFixed(3) },
              ]}
            />
          </Panel>
        ))}
      </div>

      <div className="grid g4">
        <Kpi icon={<LuWind />} color={COL.wind} label="Turbine icing (30 days)" value={pc.iceH} unit="h" foot={`${kfmt(pc.lostKWh)} kWh lost · ${pct(pc.lostKWh / Math.max(1, pc.energy + pc.lostKWh), 1)} of yield`} />
        <Kpi icon={<LuSun />} color={COL.solar} label="PV performance ratio (14 d)" value={pct(pv.pr, 1)} foot={`${pv.snowH} h with snow on panels detected`} />
        <Kpi icon={<LuBatteryFull />} color={COL.battery} label="Battery state of health" value={pct(soh, 1)} foot={`${kfmt(cycles)} equivalent cycles/yr · enclosure 18 °C`} bar={soh} />
        <Kpi icon={<LuActivity />} color={COL.ice} label="Genset run-hours avoided / yr" value={kfmt(annual.diesel.genHours - annual.ai.genHours)} unit="h" foot={`≈ ${kfmt((annual.diesel.genHours - annual.ai.genHours) / SERVICE_H)} fewer services per year`} />
      </div>

      <div className="grid g2">
        <Panel title="Wind turbine power-curve monitoring (30 days)" hint="proposed turbines · measured points vs cold-climate reference curve">
          <PowerCurve pts={pc.pts} />
        </Panel>
        <Panel title="PV: measured vs expected output (14 days)" hint="proposed PV · gap = snow cover / soiling → dispatch cleaning when safe">
          <TimeChart
            n={pv.ms.length}
            height={250}
            xLabel={(i) => fmtDay(pv.ms[i])}
            xTicks={[0, 84, 168, 252, pv.ms.length - 1]}
            yUnit="kW"
            series={[
              { key: 'e', label: 'Expected (clean panels)', color: '#e6c46a', kind: 'area', data: pv.exp, opacity: 0.2 },
              { key: 'a', label: 'Measured', color: COL.solar, kind: 'line', data: pv.act, width: 1.6 },
            ]}
          />
        </Panel>
      </div>
      <div className="alert ok">
        <LuCircleCheck style={{ color: COL.ok }} />
        <div>
          <b>Maintenance planning is fuel-aware:</b> HimUrja schedules genset services for windy days when the unit is not needed, so no service ever forces an extra genset to run.
          <span className="muted"> Condition-based alerts are sent to the station engineer and summarised in the daily HQ report.</span>
        </div>
      </div>
    </div>
  );
}

function PowerCurve({ pts }: { pts: { v: number; p: number; ice: boolean }[] }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 250,
    pl = 44,
    pr = 10,
    pt = 10,
    pb = 30;
  const w = W - pl - pr,
    h = H - pt - pb;
  const x = (v: number) => pl + (v / 28) * w;
  const y = (p: number) => pt + h - (p / 1.1) * h;
  const ref_ = Array.from({ length: 57 }, (_, i) => {
    const v = i * 0.5;
    const p = v < 3 || v > 25 ? 0 : v >= 11.5 ? 1 : Math.min(1, ((v ** 3 - 27) / (11.5 ** 3 - 27)) * densityRatio(-10)) * 0.97;
    return `${x(v).toFixed(1)},${y(p).toFixed(1)}`;
  });
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pl} x2={pl + w} y1={y(t)} y2={y(t)} />
            <text className="ax" x={pl - 6} y={y(t) + 4} textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {[0, 5, 10, 15, 20, 25].map((v) => (
          <text key={v} className="ax" x={x(v)} y={H - 14} textAnchor="middle">
            {v}
          </text>
        ))}
        <text className="axl" x={pl + w / 2} y={H - 1} textAnchor="middle">
          hub-height wind (m/s)
        </text>
        {pts.map((p, k) => (
          <circle key={k} cx={x(p.v)} cy={y(p.p)} r={2.2} fill={p.ice ? COL.bad : COL.wind} opacity={p.ice ? 0.85 : 0.35} />
        ))}
        <polyline points={ref_.join(' ')} fill="none" stroke="#14243a" strokeWidth={1.6} strokeDasharray="5 4" />
      </svg>
      <div className="legend">
        <span><i className="sw" style={{ background: COL.wind }} />normal operation</span>
        <span><i className="sw" style={{ background: COL.bad }} />icing detected (below curve)</span>
        <span><i className="sw" style={{ background: 'transparent', borderTop: '2px dashed #14243a', height: 0, width: 14 }} />reference curve</span>
      </div>
    </div>
  );
}
