import React, { useState } from 'react';
import { LuPlay, LuRotateCcw } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Slider, Toggle, Badge, kfmt, pct } from '../ui/kit';
import { TimeChart } from '../ui/charts';
import { COL, DecisionFeed, timeTicks, labelTime, fmtDayTime } from './common';
import { DEFAULT_SCENARIO, Scenario, Snapshot, fuelProjection, nextResupply, isDefaultScenario } from '../engine';
import { AnnualResult } from '../opt/annual';
import { StationConfig } from '../sim/stations';
import { reSplit } from '../opt/dispatch';

const PRESETS: { name: string; desc: string; sc: Partial<Scenario> }[] = [
  { name: 'Winter storm', desc: 'blizzard in 10 h for 30 h, −12 °C', sc: { blizzardIn: 10, blizzardHours: 30, tempOffset: -12, solarFactor: 0.3 } },
  { name: 'Genset trip in blizzard', desc: 'largest unit out 36 h + blizzard', sc: { blizzardIn: 6, blizzardHours: 24, outageMask: 1, outageFrom: 0, outageTo: 36, tempOffset: -6 } },
  { name: 'Calm & overcast', desc: 'wind 30 %, solar 40 %', sc: { windFactor: 0.3, solarFactor: 0.4 } },
  { name: 'Relief flight', desc: '+20 crew, summer traffic', sc: { crewDelta: 20 } },
  { name: 'Late ship', desc: 'vessel 25 days late, cold spell', sc: { shipDelay: 25, tempOffset: -5 } },
];

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

/** Share of critical (Tier 1-2) energy served: any shortfall is first taken from the flexible Tier-3 load of that hour. */
function critServed(s: Snapshot) {
  let crit = 0,
    shed = 0;
  s.ai.hours.forEach((h, t) => {
    crit += s.planCrit[t];
    shed += Math.max(0, h.unserved - s.dr.defer[t]);
  });
  return crit > 0 ? 1 - shed / crit : 1;
}

/** One line of operator advice, built from the optimised scenario plan. */
function recommend(s: Snapshot, st: StationConfig, arrivalL: number, reserveL: number): string[] {
  const out: string[] = [];
  const h = s.ai.hours;
  const clock = (t: number) => fmtDayTime(s.ms[t]).split(' ').pop();
  const bz = s.fc.bliz.indexOf(1);
  if (bz >= 0) {
    const socIn = h[Math.max(0, bz - 1)].soc;
    const rise = socIn - s.soc0 > 0.03;
    out.push(bz === 0 ? `blizzard now - hold battery ≥ ${pct(Math.min(...h.map((x) => x.soc)))}` : rise ? `pre-charge battery to ${pct(socIn)} before the blizzard at ${clock(bz)}` : `enter the blizzard at ${clock(bz)} with battery at ${pct(socIn)} (reserve only - gensets carry the load)`);
  } else {
    const smin = Math.min(...h.map((x) => x.soc));
    out.push(smin < st.battery.socMin + 0.08 ? `battery will reach its ${pct(st.battery.socMin)} floor - keep a genset on standby` : `use the battery as spinning reserve (SOC ≥ ${pct(smin)})`);
  }
  // most-used genset set and its loading
  const use = new Map<number, { n: number; load: number }>();
  h.forEach((x) => {
    const u = use.get(x.on) ?? { n: 0, load: 0 };
    u.n++;
    u.load += x.loading;
    use.set(x.on, u);
  });
  const [on, u] = [...use.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const names = st.gens.filter((_, k) => on & (1 << k)).map((g) => g.name);
  out.push(names.length ? `run ${names.join(' + ')} at ≈ ${pct(u.load / u.n)} load (${u.n} of ${h.length} h)` : `gensets off for ${u.n} of ${h.length} h - renewables + battery carry the load`);
  const moved = s.dr.moves.filter((m) => m.to.length && m.to.some((x) => !m.from.includes(x)));
  const short = (j: string) => (/laundry/i.test(j) ? 'laundry & workshop' : /RO /.test(j) ? 'RO desalination' : /water/i.test(j) ? 'water pumping' : j.toLowerCase());
  if (moved.length) out.push(`move ${moved.map((m) => short(m.job)).join(' and ')} into the renewable-surplus hours (from ${clock(Math.max(0, moved[0].to[0] - s.now))})`);
  const shed = h.reduce((a, x) => a + x.unserved, 0);
  if (shed > 0.5) out.push(`shed Tier-3 loads (${kfmt(shed)} kWh short)`);
  out.push(arrivalL > reserveL ? `fuel reserve holds (${kfmt(arrivalL / 1000)} kL on vessel arrival)` : `fuel reserve breached - cut non-essential heating and request earlier resupply`);
  return out;
}

export function ScenarioPage() {
  const { st, scenario, setScenario, snap, baseSnap, fuelNowL, annual, simMs, scenarioActive } = useApp();
  const [draft, setDraft] = useState<Scenario>(scenario);
  const set = (p: Partial<Scenario>) => setDraft({ ...draft, ...p });
  const dirty = JSON.stringify(draft) !== JSON.stringify(scenario);
  const b = baseSnap;
  const t0 = mean(b.fc.temp);
  const w0 = mean(b.fc.wind);

  return (
    <div className="stack">
      <Panel
        title="Scenario definition"
        hint="set the conditions, then simulate - the forecast, dispatch and fuel models all re-run"
        right={
          <div className="row">
            <button className="btn" onClick={() => { setDraft(DEFAULT_SCENARIO); setScenario(DEFAULT_SCENARIO); }}>
              <LuRotateCcw /> Reset
            </button>
            <button className="btn primary" disabled={!dirty} onClick={() => setScenario(draft)}>
              <LuPlay /> Simulate
            </button>
          </div>
        }
      >
        <div className="row" style={{ marginBottom: 12, gap: 6 }}>
          <span className="note">Presets:</span>
          {PRESETS.map((p) => (
            <button key={p.name} className="btn" title={p.desc} onClick={() => setDraft({ ...DEFAULT_SCENARIO, risk: draft.risk, drEnabled: draft.drEnabled, ...p.sc })}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Slider label={`Temperature vs forecast (48 h mean ${(t0 + draft.tempOffset).toFixed(1)} °C)`} value={draft.tempOffset} min={-20} max={10} onChange={(v) => set({ tempOffset: v })} fmt={(v) => `${v > 0 ? '+' : ''}${v} °C`} />
          <Slider label={`Wind vs forecast (48 h mean ${(w0 * draft.windFactor).toFixed(1)} m/s)`} value={Math.round(draft.windFactor * 100)} min={0} max={200} step={10} onChange={(v) => set({ windFactor: v / 100 })} fmt={(v) => `${v} %`} />
          <Slider label="Solar output vs forecast (cloud, snow on panels)" value={Math.round(draft.solarFactor * 100)} min={0} max={100} step={10} onChange={(v) => set({ solarFactor: v / 100 })} fmt={(v) => `${v} %`} />
          <div className="field">
            <Toggle on={draft.blizzardIn !== null} onChange={(v) => set({ blizzardIn: v ? 12 : null })} label="Blizzard (wind 14-30 m/s, whiteout)" />
            {draft.blizzardIn !== null && (
              <div className="grid g2" style={{ marginTop: 4 }}>
                <Slider label="Starts in" value={draft.blizzardIn} min={2} max={36} onChange={(v) => set({ blizzardIn: v })} fmt={(v) => `${v} h`} />
                <Slider label="Lasts" value={draft.blizzardHours} min={6} max={40} onChange={(v) => set({ blizzardHours: v })} fmt={(v) => `${v} h`} />
              </div>
            )}
          </div>
          <Slider label={`Crew change (on station: ${b.crewNow + draft.crewDelta})`} value={draft.crewDelta} min={-10} max={30} onChange={(v) => set({ crewDelta: v })} fmt={(v) => `${v > 0 ? '+' : ''}${v}`} />
          <Slider label="Resupply vessel delay" value={draft.shipDelay} min={0} max={60} onChange={(v) => set({ shipDelay: v })} fmt={(v) => `+${v} days`} />
          <div className="field">
            <span className="lbl">Generators out of service</span>
            <div className="row">
              {st.gens.map((g, u) => (
                <label key={g.id} className="chk">
                  <input type="checkbox" checked={!!(draft.outageMask & (1 << u))} onChange={(e) => set({ outageMask: e.target.checked ? draft.outageMask | (1 << u) : draft.outageMask & ~(1 << u), outageFrom: 0 })} />
                  {g.name} FAILED
                </label>
              ))}
            </div>
            {draft.outageMask !== 0 && <Slider label="For" value={draft.outageTo} min={4} max={48} onChange={(v) => set({ outageTo: v })} fmt={(v) => `next ${v} h`} />}
          </div>
        </div>
        {dirty && <div className="note mt">Draft changed - press Simulate to run it.</div>}
      </Panel>

      {!scenarioActive ? (
        <div className="alert ice">
          <div>
            No scenario running. Pick a preset or set the conditions above and press <b>Simulate</b>. The result is compared with the baseline (the same 48 hours under the normal
            forecast).
          </div>
        </div>
      ) : (
        <Result base={b} scn={snap} fuelNowL={fuelNowL} annual={annual} simMs={simMs} daysToShip={(nextResupply(st, simMs) - simMs) / 86400000} delay={scenario.shipDelay} reserveL={st.fuel.reserveKL * 1000} />
      )}
    </div>
  );
}

function Result({ base, scn, fuelNowL, annual, simMs, daysToShip, delay, reserveL }: { base: Snapshot; scn: Snapshot; fuelNowL: number; annual: AnnualResult; simMs: number; daysToShip: number; delay: number; reserveL: number }) {
  const st = scn.st;
  const m = (s: Snapshot) => {
    const h = s.ai.hours;
    const burn48 = s.ai.totals.fuel;
    const endurance = fuelNowL / Math.max(1, burn48 / 2);
    // after the 48 h plan, the seasonal optimised burn (month by month) until the vessel arrives
    const nDays = Math.max(0, Math.round(daysToShip - 2 + (s === scn ? delay : 0)));
    const proj = fuelProjection(st, annual, simMs + 2 * 86400000, fuelNowL - burn48, nDays);
    const arrival = proj.ai[proj.ai.length - 1];
    return {
      temp: mean(s.fc.temp),
      wind: mean(s.fc.wind),
      loadAvg: mean(h.map((x) => x.load)),
      loadPk: Math.max(...h.map((x) => x.load)),
      re: s.ai.totals.reKWh / 1000,
      reShare: s.ai.totals.renewableShare,
      socMin: Math.min(...h.map((x) => x.soc)),
      fuel: burn48,
      fuelRule: s.rule.totals.fuel,
      genH: s.ai.totals.genHours,
      starts: s.ai.totals.starts,
      unserved: s.ai.totals.unservedKWh,
      perDay: burn48 / 2,
      critServed: critServed(s),
      endurance,
      arrival,
    };
  };
  const a = m(base);
  const c = m(scn);
  const rows: { k: string; a: number; c: number; f: (v: number) => string; good?: 'up' | 'down' }[] = [
    { k: 'Mean outside temperature', a: a.temp, c: c.temp, f: (v) => `${v.toFixed(1)} °C` },
    { k: 'Mean wind speed (10 m)', a: a.wind, c: c.wind, f: (v) => `${v.toFixed(1)} m/s` },
    { k: 'Average load', a: a.loadAvg, c: c.loadAvg, f: (v) => `${kfmt(v)} kW` },
    { k: 'Peak load', a: a.loadPk, c: c.loadPk, f: (v) => `${kfmt(v)} kW` },
    { k: 'Renewable energy used', a: a.re, c: c.re, f: (v) => `${v.toFixed(2)} MWh`, good: 'up' },
    { k: 'Renewable share', a: a.reShare, c: c.reShare, f: (v) => pct(v), good: 'up' },
    { k: 'Minimum battery SOC', a: a.socMin, c: c.socMin, f: (v) => pct(v), good: 'up' },
    { k: 'Diesel - optimised dispatch', a: a.fuel, c: c.fuel, f: (v) => `${kfmt(v)} L`, good: 'down' },
    { k: 'Diesel - rule-based (reference)', a: a.fuelRule, c: c.fuelRule, f: (v) => `${kfmt(v)} L`, good: 'down' },
    { k: 'Genset running hours', a: a.genH, c: c.genH, f: (v) => `${kfmt(v)} h`, good: 'down' },
    { k: 'Genset starts', a: a.starts, c: c.starts, f: (v) => `${v}`, good: 'down' },
    { k: 'Diesel per day (optimised)', a: a.perDay, c: c.perDay, f: (v) => `${kfmt(v)} L/d`, good: 'down' },
    { k: 'Unserved energy', a: a.unserved, c: c.unserved, f: (v) => `${v.toFixed(1)} kWh`, good: 'down' },
    { k: 'Critical load served', a: a.critServed, c: c.critServed, f: (v) => pct(v, v < 0.9995 ? 1 : 0), good: 'up' },
    { k: 'Fuel endurance at this burn rate', a: a.endurance, c: c.endurance, f: (v) => `${v.toFixed(1)} d`, good: 'up' },
    { k: 'Fuel on vessel arrival', a: a.arrival, c: c.arrival, f: (v) => `${kfmt(v)} L`, good: 'up' },
  ];
  const ai = scn.ai.hours;
  const ms = scn.ms;
  const windU = ai.map((h) => reSplit(h).w);
  const blizShades = scn.fc.bliz
    .map((b, i) => (b ? i : -1))
    .filter((i) => i >= 0)
    .reduce<{ from: number; to: number }[]>((acc, i) => {
      const last = acc[acc.length - 1];
      if (last && i - last.to <= 4) last.to = i;
      else acc.push({ from: i, to: i });
      return acc;
    }, [])
    .map((r) => ({ from: r.from, to: r.to + 1, color: COL.blizShade, label: 'blizzard' }));
  const ok = c.unserved < 0.5 && c.arrival > reserveL;
  return (
    <>
      <div className="grid g-main">
        <Panel title="Result · next 48 h" hint="baseline = same hours under the normal forecast" right={<Badge kind={ok ? 'ok' : 'bad'}>{ok ? 'station secure' : c.unserved >= 0.5 ? 'load shed required' : 'fuel reserve breached'}</Badge>}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th className="num">Baseline</th>
                  <th className="num">Scenario</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = r.c - r.a;
                  const small = Math.abs(d) < Math.max(1e-6, Math.abs(r.a) * 0.0005);
                  const better = r.good ? (r.good === 'up' ? d > 0 : d < 0) : null;
                  return (
                    <tr key={r.k}>
                      <td>{r.k}</td>
                      <td className="num">{r.f(r.a)}</td>
                      <td className="num">
                        <b>{r.f(r.c)}</b>
                      </td>
                      <td className="num" style={{ color: small || better === null ? 'var(--muted)' : better ? COL.ok : COL.bad }}>
                        {small ? '-' : `${d > 0 ? '+' : '−'}${r.f(Math.abs(d)).replace(/^[-−]/, '')}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="recommend mt">
            <b>HimUrja recommends:</b> {recommend(scn, st, c.arrival, reserveL).join(' → ')}
          </div>
          <div className="note mt">
            Endurance = fuel in tanks ÷ the 48-h optimised burn rate. Arrival = today&apos;s tank level minus the 48-h plan and the month-by-month optimised burn until the vessel
            (scheduled {kfmt(daysToShip)} days away{delay ? `, +${delay} days late` : ''}). Reserve floor {kfmt(reserveL)} L.
          </div>
        </Panel>
        <Panel title="How the optimiser responds" hint="press Why? for the facts behind each action">
          <DecisionFeed items={scn.explanations} max={24} open />
        </Panel>
      </div>
      <Panel title="Scenario dispatch - next 48 h" hint="stacked supply · load line · dashed = baseline load">
        <TimeChart
          n={48}
          height={280}
          xLabel={(i) => labelTime(ms[i])}
          tipTitle={(i) => fmtDayTime(ms[i])}
          xTicks={timeTicks(ms, 6)}
          yUnit="kW"
          zeroLine
          shades={blizShades}
          right={{ min: 0, max: 100, unit: 'SOC %' }}
          series={[
            { key: 'w', label: 'Wind', color: COL.wind, kind: 'bar', data: windU, stack: 's' },
            { key: 'pv', label: 'Solar', color: COL.solar, kind: 'bar', data: ai.map((h) => reSplit(h).pv), stack: 's' },
            { key: 'bo', label: 'Battery discharge', color: COL.battery, kind: 'bar', data: ai.map((h) => Math.max(0, h.battery)), stack: 's' },
            { key: 'dg', label: 'Gensets', color: COL.diesel, kind: 'bar', data: ai.map((h) => h.pg), stack: 's' },
            { key: 'bi', label: 'Battery charge', color: COL.battIn, kind: 'bar', data: ai.map((h) => Math.min(0, h.battery)), stack: 's', fmt: (v) => Math.abs(v).toFixed(1) },
            { key: 'load', label: 'Load (scenario)', color: COL.load, kind: 'line', data: ai.map((h) => h.load), width: 1.8 },
            { key: 'bl', label: 'Load (baseline)', color: COL.p90, kind: 'line', data: base.ai.hours.map((h) => h.load), dash: '3 4', width: 1.3 },
            { key: 'soc', label: 'SOC', color: COL.soc, kind: 'line', data: ai.map((h) => h.soc * 100), axis: 'right', dash: '5 4', width: 1.3, fmt: (v) => `${v.toFixed(0)}%` },
          ]}
        />
      </Panel>
    </>
  );
}

export { isDefaultScenario };
