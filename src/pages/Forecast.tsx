import React, { useMemo, useState } from 'react';
import { LuBrain, LuTarget, LuGauge, LuShieldCheck, LuTimer } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Kpi, Seg, Toggle, Badge, kfmt } from '../ui/kit';
import { TimeChart, BarChart, useWidth } from '../ui/charts';
import { COL, timeTicks, labelTime, fmtDayTime } from './common';
import { weatherForecast } from '../sim/dataset';
import { forecastLoad, MODEL } from '../ai/forecast';
import { heatDemand } from '../sim/demand';
import { HOUR_MS, wrapH } from '../engine';
import { dayOfWeek } from '../sim/demand';

const FEATURE_NAMES: Record<string, string> = {
  lag48: 'Load 48 h earlier',
  lag168: 'Load 1 week earlier',
  local_hour: 'Hour of day',
  temp_fc: 'Forecast temperature',
  doy_cos: 'Season (cos)',
  doy_sin: 'Season (sin)',
  crew: 'Crew on station',
  station: 'Station',
  hour_cos: 'Hour (cos)',
  hour_sin: 'Hour (sin)',
  wind_fc: 'Forecast wind',
  sunday: 'Sunday routine',
  recent24: 'Last-24 h mean',
  darkness: 'Darkness (sun < 3°)',
  lead: 'Lead time',
  blizzard_fc: 'Blizzard forecast',
};

export function ForecastPage() {
  const { snap: s, st, tel } = useApp();
  const [H, setH] = useState<48 | 168>(48);
  const [showWhy, setShowWhy] = useState(true);
  const [truth, setTruth] = useState(false);
  const y = s.y;
  const windCap = st.wind.units * st.wind.unitKW;

  const data = useMemo(() => {
    const fc = H === 48 ? s.fc : weatherForecast(y, s.now, H);
    const t0 = performance.now();
    const lfRaw = forecastLoad(y, fc, tel.clean);
    const inferMs = performance.now() - t0;
    const lf = H === 48 ? s.load : lfRaw;
    const P = 72;
    const pastIdx = Array.from({ length: P }, (_, i) => wrapH(s.now - P + i));
    const n = P + H;
    const nul = (k: number) => new Array(k).fill(NaN);
    const ms = Array.from({ length: n }, (_, i) => s.nowMs + (i - P) * HOUR_MS);
    // feeder-meter data as received: rejected / missing samples are gaps, their repaired values are drawn separately
    const actualPast = pastIdx.map((h) => (tel.filled[h] ? NaN : tel.measured[h]));
    const filledPast = pastIdx.map((h, i) => (tel.filled[h] || tel.filled[pastIdx[Math.max(0, i - 1)]] || tel.filled[pastIdx[Math.min(P - 1, i + 1)]] ? tel.clean[h] : NaN));
    const nFilled = pastIdx.filter((h) => tel.filled[h]).length;
    const actualFut = fc.hours.map((h) => y.dem.crit[h]);
    // live back-test: forecast issued 48 h ago for the last 48 h
    const origin = wrapH(s.now - 48);
    const bfc = weatherForecast(y, origin, 48);
    const blf = forecastLoad(y, bfc, tel.clean);
    const bAct = bfc.hours.map((h) => y.dem.crit[h]);
    const bMape = (bAct.reduce((a, v, i) => a + Math.abs(v - blf.p50[i]) / v, 0) / 48) * 100;
    const bCover = (bAct.filter((v, i) => v >= blf.p10[i] && v <= blf.p90[i]).length / 48) * 100;
    const naive = bfc.hours.map((h) => y.dem.crit[wrapH(h - 168)]);
    const nMape = (bAct.reduce((a, v, i) => a + Math.abs(v - naive[i]) / v, 0) / 48) * 100;
    return {
      n,
      P,
      ms,
      fc,
      lf,
      inferMs,
      actual: [...actualPast, ...(truth ? actualFut : nul(H))],
      filled: [...filledPast, ...nul(H)],
      nFilled,
      p50: [...nul(P - 1), tel.clean[pastIdx[P - 1]], ...lf.p50],
      p10: [...nul(P), ...lf.p10],
      p90: [...nul(P), ...lf.p90],
      p02: [...nul(P), ...lf.p02],
      p98: [...nul(P), ...lf.p98],
      windKW: [...pastIdx.map((h) => y.windPU[h] * windCap), ...fc.windPU.map((p) => p * windCap)],
      windAct: [...nul(P), ...(truth ? fc.hours.map((h) => y.windPU[h] * windCap) : nul(H))],
      pvKW: [...pastIdx.map((h) => y.pvPU[h] * st.pv.kWp), ...fc.pvPU.map((p) => p * st.pv.kWp)],
      windMs: [...pastIdx.map((h) => y.wx.wind[h]), ...fc.wind],
      temp: [...pastIdx.map((h) => y.wx.temp[h]), ...fc.temp],
      heat: [...pastIdx.map((h) => y.dem.heat[h]), ...fc.hours.map((h, i) => heatDemand(st, fc.temp[i], fc.wind[i], y.dem.crew[h]))],
      bliz: [...pastIdx.map((h) => y.wx.bliz[h]), ...fc.bliz],
      back: { ms: bfc.hours.map((_, i) => s.nowMs + (i - 48) * HOUR_MS), act: bAct, p50: blf.p50, p10: blf.p10, p90: blf.p90, mape: bMape, cover: bCover, nMape },
    };
  }, [s, H, truth, y, st, windCap, tel]);

  const shades = data.bliz
    .map((b, i) => (b ? i : -1))
    .filter((i) => i >= 0)
    .reduce<{ from: number; to: number }[]>((acc, i) => {
      const last = acc[acc.length - 1];
      if (last && i - last.to <= 4) last.to = i;
      else acc.push({ from: i, to: i });
      return acc;
    }, [])
    .map((r) => ({ from: r.from, to: r.to + 1, color: COL.blizShade }));
  const m = MODEL.metrics.stations[st.id];
  const ticks = timeTicks(data.ms, H === 48 ? 12 : 24);
  const halfTicks = timeTicks(data.ms, H === 48 ? 24 : 48);
  const loadMin = Math.floor((Math.min(...data.actual.filter(isFinite), ...data.p02.filter(isFinite)) * 0.85) / 10) * 10;
  const common = {
    n: data.n,
    xLabel: (i: number) => labelTime(data.ms[i]),
    tipTitle: (i: number) => fmtDayTime(data.ms[i]) + (i >= data.P ? ' · forecast' : ' · measured'),
    xTicks: ticks,
    markers: [{ i: data.P, label: 'now' }],
  };

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <Seg value={H} onChange={(v) => setH(v)} options={[{ v: 48, label: 'Next 48 h' }, { v: 168, label: '7-day outlook' }]} />
          <Toggle on={truth} onChange={setTruth} label="Validation mode: overlay ground truth" />
        </div>
        <span className="note">Forecast issued {fmtDayTime(s.nowMs)} · inference {data.inferMs.toFixed(1)} ms on this device</span>
      </div>

      <DemandOutlook showWhy={showWhy} setShowWhy={setShowWhy} />

      <div className="grid g4">
        <Kpi icon={<LuTarget />} label="Load forecast error (MAPE)" value={m.mape_model.toFixed(1)} unit="%" foot={`held-out simulated year · ${st.name}`} color={COL.ok} />
        <Kpi
          icon={<LuGauge />}
          label="Better than seasonal-naive"
          value={((1 - m.mape_model / m.mape_seasonal_naive) * 100).toFixed(0)}
          unit="%"
          foot={`naive ${m.mape_seasonal_naive}% · persistence ${m.mape_persistence48}%`}
        />
        <Kpi icon={<LuShieldCheck />} label="P10-P90 interval coverage" value={MODEL.metrics.coverage_80.toFixed(1)} unit="%" foot="target 80% · split-conformal calibration" color={COL.battery} />
        <Kpi icon={<LuTimer />} label="Live back-test (last 48 h)" value={data.back.mape.toFixed(1)} unit="% MAPE" foot={`coverage ${data.back.cover.toFixed(0)}% · naive ${data.back.nMape.toFixed(1)}%`} color={COL.wind} />
      </div>

      <Panel title="Critical electrical load - probabilistic forecast" hint="gradient-boosted trees + conformal intervals" right={<Badge kind="ice"><LuBrain /> ML</Badge>}>
        <TimeChart
          {...common}
          height={270}
          yUnit="kW"
          yMin={loadMin}
          shades={shades}
          series={[
            { key: 'b2', label: 'P2.5-P97.5', color: COL.ai, kind: 'band', lo: data.p02, hi: data.p98, opacity: 0.1, from: data.P },
            { key: 'b1', label: 'P10-P90', color: COL.ai, kind: 'band', lo: data.p10, hi: data.p90, opacity: 0.22, from: data.P },
            { key: 'act', label: truth ? 'Measured / ground truth' : 'Measured (feeder meters)', color: COL.load, kind: 'line', data: data.actual, width: 1.8 },
            ...(data.nFilled ? [{ key: 'fill', label: `Gap-filled (${data.nFilled} rejected / missing)`, color: COL.warn, kind: 'line' as const, data: data.filled, width: 1.8, dash: '3 3' }] : []),
            { key: 'p50', label: 'Forecast P50', color: COL.ai, kind: 'line', data: data.p50, width: 2.2, from: data.P - 1 },
          ]}
        />
      </Panel>

      <div className="grid g2">
        <Panel title="Renewable generation forecast" hint="physics models driven by NWP-style weather forecast">
          <TimeChart
            {...common}
            xTicks={halfTicks}
            height={240}
            yUnit="kW"
            shades={shades}
            right={{ min: 0, max: Math.max(30, Math.ceil(Math.max(...data.windMs) / 5) * 5), unit: 'm/s' }}
            series={[
              { key: 'w', label: `Wind (${windCap} kW)`, color: COL.wind, kind: 'area', data: data.windKW, stack: 'r', opacity: 0.45 },
              { key: 'pv', label: `Solar (${st.pv.kWp} kWp)`, color: COL.solar, kind: 'area', data: data.pvKW, stack: 'r', opacity: 0.55 },
              ...(truth ? [{ key: 'wa', label: 'Wind ground truth', color: '#6fb7b2', kind: 'line' as const, data: data.windAct, dash: '3 3', width: 1.4 }] : []),
              { key: 'ws', label: 'Wind speed', color: COL.wind, kind: 'line', data: data.windMs, axis: 'right', width: 1.2, opacity: 0.8, fmt: (v) => `${v.toFixed(1)} m/s` },
            ]}
          />
          <div className="note mt">Turbines: cut-in 3 m/s, rated 11.5 m/s, storm stop above 25 m/s (hub) with restart below 20 m/s; air-density and icing corrections applied. PV: sun position at {Math.abs(st.lat).toFixed(1)}°S, 70° tilt bifacial panels with snow albedo and snow-cover losses.</div>
        </Panel>
        <Panel title="Weather & heating demand" hint="temperature drives heating; wind adds infiltration losses">
          <TimeChart
            {...common}
            xTicks={halfTicks}
            height={240}
            yUnit="kWth"
            shades={shades}
            right={{ min: Math.floor(Math.min(...data.temp) / 5) * 5, max: Math.max(5, Math.ceil(Math.max(...data.temp) / 5) * 5), unit: '°C' }}
            series={[
              { key: 'heat', label: 'Heat demand', color: COL.heat, kind: 'area', data: data.heat, opacity: 0.3 },
              { key: 'temp', label: 'Air temperature', color: COL.ice, kind: 'line', data: data.temp, axis: 'right', width: 1.8, fmt: (v) => `${v.toFixed(1)} °C` },
            ]}
          />
        </Panel>
      </div>

      <div className="grid g3">
        <Panel title="Accuracy vs baselines" hint={`simulated test year · ${MODEL.metrics.test_rows.toLocaleString()} forecasts`}>
          <BarChart
            height={210}
            categories={['Maitri', 'Bharati']}
            yUnit="MAPE %"
            valueFmt={(v) => `${v.toFixed(2)}%`}
            groups={[
              { label: 'Recent mean', color: '#475569', data: [MODEL.metrics.stations.maitri.mape_recent_mean, MODEL.metrics.stations.bharati.mape_recent_mean] },
              { label: 'Seasonal naive', color: '#64748b', data: [MODEL.metrics.stations.maitri.mape_seasonal_naive, MODEL.metrics.stations.bharati.mape_seasonal_naive] },
              { label: 'Persistence 48 h', color: '#94a3b8', data: [MODEL.metrics.stations.maitri.mape_persistence48, MODEL.metrics.stations.bharati.mape_persistence48] },
              { label: 'HimUrja GBT', color: COL.ai, data: [MODEL.metrics.stations.maitri.mape_model, MODEL.metrics.stations.bharati.mape_model] },
            ]}
          />
        </Panel>
        <Panel title="What the model looks at" hint="feature importance (gain)">
          <div className="bars">
            {MODEL.metrics.importance.slice(0, 8).map((f) => (
              <div className="b-row" key={f.feature}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {FEATURE_NAMES[f.feature] ?? f.feature}
                </span>
                <div className="b-track">
                  <i style={{ width: `${Math.max(2, Math.sqrt(f.value / MODEL.metrics.importance[0].value) * 100)}%`, background: COL.ai }} />
                </div>
                <span className="mono" style={{ fontSize: 11.5, textAlign: 'right' }}>
                  {(f.value * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
          <div className="note mt">Bar length on square-root scale so smaller drivers stay visible.</div>
        </Panel>
        <Panel title="Model card">
          <table className="tbl">
            <tbody>
              <tr><td className="muted">Algorithm</td><td>Gradient-boosted regression trees ({MODEL.trees.length} trees, depth {MODEL.depth})</td></tr>
              <tr><td className="muted">Target</td><td>Hourly critical load, 1-48 h ahead (7-day recursive)</td></tr>
              <tr><td className="muted">Inputs</td><td>{MODEL.features.length} features: load lags, calendar, crew roster, forecast weather, daylight</td></tr>
              <tr><td className="muted">Uncertainty</td><td>Split-conformal P10/P90 & P2.5/P97.5 per lead-time bucket</td></tr>
              <tr><td className="muted">Error by lead</td><td className="mono">{MODEL.metrics.by_lead.map((b) => `${b.lead}: ${b.mape}%`).join(' · ')}</td></tr>
              <tr><td className="muted">Runtime</td><td>Pure TypeScript, {kfmt(JSON.stringify(MODEL.trees).length / 1024)} KB model, runs offline on the station edge PC</td></tr>
              <tr><td className="muted">Retraining</td><td>Nightly on station data; HQ receives model deltas over satellite</td></tr>
            </tbody>
          </table>
        </Panel>
      </div>

      <ValidationPanel />

      <Panel title="Live back-test: the forecast issued 48 h ago vs what actually happened" hint="continuous self-validation on the edge">
        <TimeChart
          n={48}
          height={200}
          xLabel={(i) => labelTime(data.back.ms[i])}
          tipTitle={(i) => fmtDayTime(data.back.ms[i])}
          xTicks={timeTicks(data.back.ms, 12)}
          yUnit="kW"
          series={[
            { key: 'b', label: 'P10-P90', color: COL.ai, kind: 'band', lo: data.back.p10, hi: data.back.p90, opacity: 0.2 },
            { key: 'a', label: 'Actual', color: COL.load, kind: 'line', data: data.back.act, width: 1.8 },
            { key: 'f', label: 'Forecast (issued 48 h ago)', color: COL.ai, kind: 'line', data: data.back.p50, width: 2 },
          ]}
        />
      </Panel>
    </div>
  );
}


/** Next-24 h outlook in operator terms, plus the physical drivers behind the change in demand. */
function DemandOutlook({ showWhy, setShowWhy }: { showWhy: boolean; setShowWhy: (v: boolean) => void }) {
  const { snap: s, st, tel } = useApp();
  const y = s.y;
  const N = 24;
  const past = Array.from({ length: N }, (_, i) => wrapH(s.now - N + i));
  const avg = (a: ArrayLike<number>) => {
    let t = 0;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) (t += a[i]), n++;
    return n ? t / n : NaN;
  };
  const p50 = s.load.p50.slice(0, N).map((v, i) => v + s.dr.defer[i]);
  let pk = 0;
  let lo = 0;
  for (let i = 1; i < N; i++) {
    if (p50[i] > p50[pk]) pk = i;
    if (p50[i] < p50[lo]) lo = i;
  }
  const measNow = tel.measured[wrapH(s.now - 1)];
  const nowLoad = Number.isFinite(measNow) ? measNow + s.dr.defer[0] : s.ai.hours[0].load;
  const band = avg(s.load.p90.slice(0, N).map((v, i) => (v - s.load.p10[i]) / 2));
  const plan = s.ai.hours.slice(0, N);
  const reShare = plan.reduce((a, h) => a + Math.min(h.reUsed, h.load), 0) / Math.max(1, plan.reduce((a, h) => a + h.load, 0));

  // ---- drivers: next 24 h vs last 24 h ----
  const loadPast = avg(past.map((h) => tel.clean[h] + y.dem.defer[h]));
  const loadNext = avg(p50);
  const dLoad = loadNext - loadPast;
  const tPast = avg(past.map((h) => y.wx.temp[h]));
  const tNext = avg(s.fc.temp.slice(0, N));
  const hPast = avg(past.map((h) => y.dem.heat[h]));
  const hNext = avg(s.heat.slice(0, N));
  const cPast = avg(past.map((h) => y.dem.crew[h]));
  const cNext = avg(s.fc.hours.slice(0, N).map((h) => y.dem.crew[h])) + (s.crewNow - y.dem.crew[s.now]);
  const windCap = st.wind.units * st.wind.unitKW;
  const wPast = avg(past.map((h) => y.windPU[h] * windCap));
  const wNext = avg(s.wind.slice(0, N));
  const pvPast = avg(past.map((h) => y.pvPU[h] * st.pv.kWp));
  const pvNext = avg(s.pv.slice(0, N));
  const blizNext = s.fc.bliz.slice(0, N).filter(Boolean).length;
  const sunday = s.fc.hours.slice(0, N).filter((h) => dayOfWeek(h) === 0).length;
  const arrow = (d: number, eps: number) => (d > eps ? '↑' : d < -eps ? '↓' : '→');
  const drivers: { a: string; name: string; val: string; effect: string; e?: number }[] = [
    { a: arrow(tNext - tPast, 0.5), name: 'Outside temperature', val: `${tPast.toFixed(1)} → ${tNext.toFixed(1)} °C`, effect: tNext < tPast - 0.5 ? 'more trace heating & heat loss' : tNext > tPast + 0.5 ? 'less heating' : 'little effect', e: tNext < tPast - 0.5 ? 1 : tNext > tPast + 0.5 ? -1 : 0 },
    { a: arrow(hNext - hPast, 3), name: 'Heating demand', val: `${kfmt(hPast)} → ${kfmt(hNext)} kWth`, effect: hNext > hPast + 3 ? 'circulation pumps & electric heating up' : hNext < hPast - 3 ? 'lower auxiliary load' : 'steady', e: Math.sign(Math.round((hNext - hPast) / 3)) },
    { a: arrow(cNext - cPast, 0.4), name: 'Crew on station', val: `${cPast.toFixed(0)} → ${cNext.toFixed(0)}`, effect: cNext > cPast + 0.4 ? `≈ +${kfmt((cNext - cPast) * st.load.perCrew, 1)} kW habitat load` : cNext < cPast - 0.4 ? 'lower habitat load' : 'unchanged', e: Math.sign(Math.round((cNext - cPast) / 0.4)) },
    { a: sunday ? '↓' : '→', name: 'Activity schedule', val: sunday ? `${sunday} h of Sunday routine` : 'normal working day', effect: sunday ? 'labs & workshop mostly idle' : 'labs, workshop, galley as usual', e: sunday ? -1 : 0 },
    { a: blizNext ? '↑' : '→', name: 'Blizzard', val: blizNext ? `${blizNext} h forecast` : 'none forecast', effect: blizNext ? 'snow clearing, crew indoors, extra heating' : '-', e: blizNext ? 1 : 0 },
    { a: arrow(wNext - wPast, 3), name: 'Wind generation (supply)', val: `${kfmt(wPast)} → ${kfmt(wNext)} kW avg`, effect: wNext < wPast - 3 ? 'more genset / battery needed' : wNext > wPast + 3 ? 'more load covered by wind' : 'similar', e: wNext < wPast - 3 ? 1 : wNext > wPast + 3 ? -1 : 0 },
    { a: arrow(pvNext - pvPast, 2), name: 'Solar generation (supply)', val: `${kfmt(pvPast)} → ${kfmt(pvNext)} kW avg`, effect: pvNext < pvPast - 2 ? 'less daylight / snow cover' : pvNext > pvPast + 2 ? 'more daylight' : 'similar', e: pvNext < pvPast - 2 ? 1 : pvNext > pvPast + 2 ? -1 : 0 },
  ];
  const trend = dLoad > 1.5 ? 'rise' : dLoad < -1.5 ? 'fall' : 'stay flat';
  return (
    <Panel title="Energy forecast · next 24 hours" hint={`issued ${fmtDayTime(s.nowMs)} · re-issued every hour`}>
      <div className="grid g-main">
        <div>
        <div className="grid g4" style={{ alignContent: 'start' }}>
          <div className="readout">
            <div className="rl">Current load</div>
            <div className="rv">{kfmt(nowLoad)} kW</div>
            <div className="note">{Number.isFinite(measNow) ? 'feeder meters, last hour' : 'meter gap - estimate shown'}</div>
          </div>
          <div className="readout">
            <div className="rl">Forecast peak</div>
            <div className="rv">
              {kfmt(p50[pk])} kW · {labelTime(s.ms[pk])}
            </div>
            <div className="note">P90 {kfmt(s.load.p90[pk] + s.dr.defer[pk])} kW</div>
          </div>
          <div className="readout">
            <div className="rl">Uncertainty (80 % band)</div>
            <div className="rv">±{kfmt(band, 1)} kW</div>
            <div className="note">calibrated coverage {MODEL.metrics.coverage_80.toFixed(0)} % on a held-out simulated year</div>
          </div>
          <div className="readout">
            <div className="rl">Expected renewable contribution</div>
            <div className="rv">{Math.round(reShare * 100)} %</div>
            <div className="note">of load, optimised plan · minimum load {kfmt(p50[lo])} kW</div>
          </div>
        </div>
        <div className="mt">
          <TimeChart
            n={N}
            height={170}
            xLabel={(i) => labelTime(s.ms[i])}
            tipTitle={(i) => fmtDayTime(s.ms[i])}
            xTicks={timeTicks(s.ms.slice(0, N), 6)}
            yUnit="kW"
            series={[
              { key: 're', label: 'Wind + solar forecast', color: COL.wind, kind: 'area', data: s.wind.slice(0, N).map((w, i) => w + s.pv[i]), opacity: 0.18 },
              { key: 'band', label: 'Load P10-P90', color: COL.ai, kind: 'band', lo: s.load.p10.slice(0, N).map((v, i) => v + s.dr.defer[i]), hi: s.load.p90.slice(0, N).map((v, i) => v + s.dr.defer[i]), opacity: 0.2 },
              { key: 'p50', label: 'Load P50', color: COL.ai, kind: 'line', data: p50, width: 2 },
            ]}
          />
        </div>
        </div>
        <div>
          <div className="row between">
            <b style={{ fontSize: 12.5 }}>
              Why is demand expected to {trend}? <span className="mono muted">({dLoad >= 0 ? '+' : '−'}{kfmt(Math.abs(dLoad), 1)} kW avg vs last 24 h)</span>
            </b>
            <button className={`why-btn ${showWhy ? 'on' : ''}`} onClick={() => setShowWhy(!showWhy)}>
              {showWhy ? 'Hide' : 'Why?'}
            </button>
          </div>
          {showWhy && (
            <div style={{ marginTop: 6 }}>
              <div className="note" style={{ marginBottom: 2 }}>
                arrow = direction of the quantity · <span style={{ color: COL.diesel }}>orange</span> raises demand or genset need, <span style={{ color: COL.ok }}>green</span> lowers it
              </div>
              {drivers.map((d) => (
                <div className="driver" key={d.name}>
                  <span className="arr" style={{ color: d.e && d.e > 0 ? COL.diesel : d.e && d.e < 0 ? COL.ok : 'var(--dim)' }} title={d.e && d.e > 0 ? 'raises demand / genset need' : d.e && d.e < 0 ? 'lowers demand / genset need' : 'neutral'}>
                    {d.a}
                  </span>
                  <span>
                    {d.name} <span className="note">- {d.effect}</span>
                  </span>
                  <b>{d.val}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Validation on the simulated dataset: errors in kW, their distribution, and how the data was generated. */
function ValidationPanel() {
  const M = MODEL.metrics;
  const a = M.stations.maitri;
  const b = M.stations.bharati;
  const rows: [string, string, string, string][] = [
    ['MAE', `${a.mae_model.toFixed(2)} kW`, `${b.mae_model.toFixed(2)} kW`, 'mean absolute error'],
    ['RMSE', `${a.rmse_model.toFixed(2)} kW`, `${b.rmse_model.toFixed(2)} kW`, 'penalises large misses'],
    ['MAPE', `${a.mape_model.toFixed(2)} %`, `${b.mape_model.toFixed(2)} %`, `mean load ${a.mean_load} / ${b.mean_load} kW`],
    ['Bias (actual − forecast)', `${a.bias_model >= 0 ? '+' : '−'}${Math.abs(a.bias_model).toFixed(2)} kW`, `${b.bias_model >= 0 ? '+' : '−'}${Math.abs(b.bias_model).toFixed(2)} kW`, 'no systematic under/over-forecast'],
    ['95th percentile |error|', `${a.p95_abs_err.toFixed(1)} kW`, `${b.p95_abs_err.toFixed(1)} kW`, 'what the reserve must cover'],
    ['Seasonal-naive MAE / RMSE', `${a.mae_seasonal_naive} / ${a.rmse_seasonal_naive}`, `${b.mae_seasonal_naive} / ${b.rmse_seasonal_naive}`, 'same hour last week (kW)'],
    ['P10-P90 coverage', `${M.coverage_80.toFixed(1)} %`, '', 'target 80 %, both stations'],
  ];
  return (
    <Panel title="Model validation on simulated dataset" hint={`${M.test_rows.toLocaleString()} forecasts, 1-48 h ahead, on a year the model never saw`} right={<Badge kind="warn">SIMULATED DATA</Badge>}>
      <div className="grid g3">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Maitri</th>
                <th className="num">Bharati</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]} title={r[3]}>
                  <td>
                    {r[0]}
                    <div className="note">{r[3]}</div>
                  </td>
                  <td className="num">{r[1]}</td>
                  <td className="num">{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="eyebrow">Error distribution · actual − forecast (kW), both stations</div>
          <ErrorHistogram edges={M.error_hist.edges} counts={M.error_hist.counts} />
          <div className="note">
            Centred on zero and roughly symmetric. 95 % of forecasts are within ±{Math.max(a.p95_abs_err, b.p95_abs_err).toFixed(0)} kW - well inside the spinning reserve (≥ 30 % of load ≈{' '}
            {kfmt(0.3 * a.mean_load)}-{kfmt(0.3 * b.mean_load)} kW).
          </div>
        </div>
        <div>
          <div className="eyebrow">How the dataset was generated</div>
          <ul className="plain">
            <li>Digital twin of each station: stochastic weather generator (seasonal temperature, katabatic wind, Poisson blizzards), crew roster, activity profile, heating physics.</li>
            <li>5 independent simulated years per station: 3 train, 1 calibrates the intervals, 1 unseen test year.</li>
            <li>Inputs use only what is known when the forecast is issued: load lags ≥ 48 h and a weather forecast whose error grows with lead time.</li>
          </ul>
          <div className="eyebrow" style={{ marginTop: 8 }}>What this does - and does not - show</div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            It shows the pipeline learns the demand process and beats naive forecasts on data it has not seen. It does <b>not</b> show accuracy on real Maitri or Bharati meter data: that is measured in
            Phase 1 (shadow mode), after retraining on the station&apos;s own logs.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function ErrorHistogram({ edges, counts }: { edges: number[]; counts: number[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const W = Math.max(240, w);
  const H = 170;
  const pl = 34,
    pr = 16,
    pt = 8,
    pb = 26;
  const total = counts.reduce((x, y) => x + y, 0);
  const share = counts.map((c) => (c / total) * 100);
  const ymax = Math.ceil(Math.max(...share) / 5) * 5;
  const x = (v: number) => pl + ((v - edges[0]) / (edges[edges.length - 1] - edges[0])) * (W - pl - pr);
  const y = (v: number) => pt + (1 - v / ymax) * (H - pt - pb);
  return (
    <div ref={ref} style={{ margin: '6px 0 4px' }}>
      <svg className="hist" width={W} height={H} role="img" aria-label="forecast error histogram">
        {[0, ymax / 2, ymax].map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="#e6eaef" />
            <text x={pl - 5} y={y(t) + 3.5} textAnchor="end" style={{ fontSize: 10, fill: '#7b8797', fontFamily: 'var(--mono)' }}>
              {t}%
            </text>
          </g>
        ))}
        {share.map((v, i) => (
          <rect key={i} x={x(edges[i]) + 0.5} y={y(v)} width={Math.max(1, x(edges[i + 1]) - x(edges[i]) - 1)} height={y(0) - y(v)} fill={COL.ai} opacity={0.85}>
            <title>{`${edges[i]} to ${edges[i + 1]} kW: ${v.toFixed(1)} % of forecasts`}</title>
          </rect>
        ))}
        <line x1={x(0)} x2={x(0)} y1={pt} y2={y(0)} stroke={COL.load} strokeDasharray="3 3" />
        {[-15, -10, -5, 0, 5, 10, 15].map((t) => (
          <text key={t} x={x(t)} y={H - 10} textAnchor="middle" style={{ fontSize: 10, fill: '#7b8797', fontFamily: 'var(--mono)' }}>
            {t > 0 ? `+${t}` : t}
          </text>
        ))}
      </svg>
    </div>
  );
}
