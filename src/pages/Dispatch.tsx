import React from 'react';
import { LuTrophy, LuDownload, LuCircleCheck, LuTriangleAlert, LuMinus } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Seg, Toggle, Slider, Badge, kfmt, pct } from '../ui/kit';
import { TimeChart } from '../ui/charts';
import { COL, DecisionFeed, timeTicks, labelTime, fmtDayTime } from './common';
import { DEFAULT_SCENARIO } from '../engine';
import { DispatchResult, reSplit, constraintReport, COSTS, CONV_MARGIN, MIN_UPDOWN_H } from '../opt/dispatch';
import { DIESEL } from '../sim/stations';

export function DispatchPage() {
  const { snap: s, st, scenario: sc, setScenario } = useApp();
  const set = (patch: Partial<typeof sc>) => setScenario({ ...sc, ...patch });
  const ms = s.ms;
  const ai = s.ai.hours;
  const windUsed = ai.map((h) => reSplit(h).w);
  const pvUsed = ai.map((h) => reSplit(h).pv);
  const blizShades = s.fc.bliz
    .map((b, i) => (b ? i : -1))
    .filter((i) => i >= 0)
    .reduce<{ from: number; to: number }[]>((acc, i) => {
      const last = acc[acc.length - 1];
      if (last && i - last.to <= 4) last.to = i;
      else acc.push({ from: i, to: i });
      return acc;
    }, [])
    .map((r) => ({ from: r.from, to: r.to + 1, color: COL.blizShade, label: 'blizzard' }));
  const outShade = sc.outageMask ? [{ from: sc.outageFrom, to: Math.min(47, sc.outageTo), color: COL.outShade, label: 'genset outage' }] : [];
  const ticks = timeTicks(ms, 6);
  const best = s.ai.totals;
  const cmp: { r: DispatchResult; title: string; sub: string; cls?: string }[] = [
    { r: s.diesel, title: 'Today: gensets only', sub: 'current plant, 30% spinning margin' },
    { r: s.rule, title: 'Hybrid, rule-based', sub: 'proposed wind/PV/battery as fuel-savers, gensets kept on' },
    { r: s.ai, title: 'Hybrid + HimUrja', sub: 'proposed wind/PV/battery, forecast + optimal dispatch', cls: 'best' },
  ];

  return (
    <div className="stack">
      <SetpointTable />

      <div className="compare">
        {cmp.map(({ r, title, sub, cls }) => {
          const t = r.totals;
          const save = 1 - best.fuel / t.fuel;
          return (
            <div className={`cmp ${cls ?? ''}`} key={title}>
              <h4>
                {cls && <LuTrophy style={{ color: COL.ai }} />}
                {title}
              </h4>
              <div className="note" style={{ marginTop: -4, marginBottom: 8 }}>{sub}</div>
              <div className="big">
                {kfmt(t.fuel)} <small className="muted" style={{ fontSize: 13 }}>L / 48 h</small>
              </div>
              <div style={{ margin: '4px 0 8px', fontSize: 12.5 }} className={cls ? 'ok' : 'muted'}>
                {cls ? `saves ${kfmt(s.diesel.totals.fuel - t.fuel)} L vs diesel-only (${pct(1 - t.fuel / s.diesel.totals.fuel)})` : `HimUrja uses ${pct(save)} less fuel`}
              </div>
              <div className="li"><span>Genset fuel / boiler oil</span><b>{kfmt(t.fuelGen)} / {kfmt(t.fuelBoiler)} L</b></div>
              <div className="li"><span>CO₂ emitted</span><b>{kfmt(t.co2t, 2)} t</b></div>
              <div className="li"><span>Renewable share</span><b>{pct(t.renewableShare)}</b></div>
              <div className="li"><span>Genset run-hours · starts</span><b>{kfmt(t.genHours)} h · {t.starts}</b></div>
              <div className="li"><span>Low-load (&lt;40%) unit-hours</span><b className={t.lowLoadHours > 5 ? 'warn' : ''}>{kfmt(t.lowLoadHours)}</b></div>
              <div className="li"><span>Curtailed · to heat</span><b>{kfmt(t.curtailKWh)} · {kfmt(t.p2hKWh)} kWh</b></div>
              <div className="li" style={{ borderBottom: 0 }}><span>Unserved energy</span><b className={t.unservedKWh > 0.5 ? 'bad' : 'ok'}>{kfmt(t.unservedKWh, 1)} kWh</b></div>
            </div>
          );
        })}
      </div>

      <Panel
        title="Optimised dispatch - next 48 h"
        hint="dynamic-programming unit commitment · battery · power-to-heat"
        right={
          <button className="btn" onClick={() => exportPlan(s)}>
            <LuDownload /> Export set-points (CSV)
          </button>
        }
      >
        <TimeChart
          n={48}
          height={300}
          xLabel={(i) => labelTime(ms[i])}
          tipTitle={(i) => fmtDayTime(ms[i])}
          xTicks={ticks}
          yUnit="kW"
          zeroLine
          shades={[...blizShades, ...outShade]}
          right={{ min: 0, max: 100, unit: 'SOC %' }}
          series={[
            { key: 'w', label: 'Wind', color: COL.wind, kind: 'bar', data: windUsed, stack: 's' },
            { key: 'pv', label: 'Solar', color: COL.solar, kind: 'bar', data: pvUsed, stack: 's' },
            { key: 'bo', label: 'Battery discharge', color: COL.battery, kind: 'bar', data: ai.map((h) => Math.max(0, h.battery)), stack: 's' },
            ...st.gens.map((g, u) => ({ key: 'g' + u, label: g.name, color: COL.gens[u % 3], kind: 'bar' as const, data: ai.map((h) => h.unitPg[u]), stack: 's' })),
            { key: 'bi', label: 'Battery charge', color: COL.battIn, kind: 'bar', data: ai.map((h) => Math.min(0, h.battery)), stack: 's', opacity: 0.6, fmt: (v) => Math.abs(v).toFixed(1) },
            { key: 'p2h', label: 'Power-to-heat', color: COL.heat, kind: 'bar', data: ai.map((h) => -h.p2h), stack: 's', opacity: 0.6, fmt: (v) => Math.abs(v).toFixed(1) },
            { key: 'load', label: 'Load (plan)', color: COL.load, kind: 'line', data: ai.map((h) => h.load), width: 2 },
            { key: 'p90', label: 'Load P90', color: COL.p90, kind: 'line', data: s.load.p90.map((v, i) => v + s.dr.defer[i]), dash: '2 4', width: 1.2 },
            { key: 'soc', label: 'SOC', color: COL.soc, kind: 'line', data: ai.map((h) => h.soc * 100), axis: 'right', dash: '5 4', width: 1.6, fmt: (v) => `${v.toFixed(0)}%` },
          ]}
        />
      </Panel>

      <div className="grid g-main">
        <Panel title="Genset commitment - optimised vs rule-based" hint="each bar = unit running in that hour">
          <Gantt title="Optimised (HimUrja)" r={s.ai} st={st} ms={ms} />
          <div style={{ height: 10 }} />
          <Gantt title="Rule-based" r={s.rule} st={st} ms={ms} />
          <div className="note mt">
            Why the optimised plan runs fewer gensets: the battery counts as spinning reserve (it responds in milliseconds), so one genset can run near its efficient 70-90% loading instead of two lightly-loaded sets. Every hour a
            running {st.gens[0].rated} kW set burns ~{(DIESEL.F0 * st.gens[0].rated).toFixed(1)} L just to idle (no-load fuel).
          </div>
        </Panel>
        <Panel title="Decision log" hint="every set-point change · press Why? for the facts behind it">
          <DecisionFeed items={s.explanations} open />
        </Panel>
      </div>

      <ConstraintTable />

      <Panel title="How the optimiser decides" hint="formulation">
        <div className="grid g2">
          <div>
            <div className="eyebrow">Objective</div>
            <p className="muted" style={{ marginTop: 6 }}>
              Minimise genset fuel (Willans line F = {DIESEL.F0}·P<sub>rated</sub> + {DIESEL.F1}·P L/h) + boiler oil for unmet heat + start-up, run-hour, low-load and battery-wear costs
              (litre-equivalent) over a 48 h rolling horizon, re-planned every hour (model-predictive control).
            </p>
          </div>
          <div>
            <div className="eyebrow">Solver</div>
            <p className="muted" style={{ marginTop: 6 }}>
              Exact dynamic programming over (battery SOC × genset set in the last two hours): 31 × {(1 << st.gens.length) ** 2} states per hour, solved in tens of milliseconds on the station PC -
              no commercial solver licence, deterministic and fully auditable. The same formulation can be written as a MILP for larger fleets.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function exportPlan(s: ReturnType<typeof useApp>['snap']) {
  const head = ['time_IST', 'load_kW', 'wind_kW', 'solar_kW', ...s.st.gens.map((g) => `${g.name}_kW`), 'battery_kW(+out)', 'soc_pct', 'p2h_kW', 'boiler_kWth', 'fuel_L'];
  const rows = s.ai.hours.map((h, i) => [
    fmtDayTime(s.ms[i]),
    h.load.toFixed(1),
    Math.min(h.wind, h.reUsed).toFixed(1),
    Math.max(0, h.reUsed - Math.min(h.wind, h.reUsed)).toFixed(1),
    ...h.unitPg.map((v) => v.toFixed(1)),
    h.battery.toFixed(1),
    (h.soc * 100).toFixed(0),
    h.p2h.toFixed(1),
    h.boilerHeat.toFixed(1),
    (h.fuelGen + h.fuelBoiler).toFixed(2),
  ]);
  const csv = [head, ...rows].map((r) => r.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `himurja_${s.st.id}_plan_${new Date(s.nowMs).toISOString().slice(0, 13)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Gantt({ title, r, st, ms }: { title: string; r: DispatchResult; st: ReturnType<typeof useApp>['st']; ms: number[] }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        {title} · {kfmt(r.totals.genHours)} unit-hours
      </div>
      {st.gens.map((g, u) => (
        <div key={g.id} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span className="mono" style={{ fontSize: 12 }}>{g.name}</span>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${r.hours.length}, 1fr)`, gap: 1, height: 16 }}>
            {r.hours.map((h, i) => {
              const on = !!(h.on & (1 << u));
              const low = on && h.loading < 0.4;
              return <div key={i} title={`${fmtDayTime(ms[i])} ${on ? `ON ${(h.loading * 100).toFixed(0)}%` : 'off'}`} style={{ background: on ? (low ? COL.warn : COL.diesel) : '#e6eaef', borderRadius: 2 }} />;
            })}
          </div>
        </div>
      ))}
      <div className="legend" style={{ marginTop: 4 }}>
        <span><i className="sw" style={{ background: COL.diesel }} />running</span>
        <span><i className="sw" style={{ background: COL.warn }} />running below 40% (wet-stacking risk)</span>
      </div>
    </div>
  );
}

/** This hour's set-points: what fixed rules would do vs what the optimiser commands. */
function SetpointTable() {
  const { snap: s, st, scenario: sc, setScenario } = useApp();
  const set = (patch: Partial<typeof sc>) => setScenario({ ...sc, ...patch });
  const r = s.rule.hours[0];
  const o = s.ai.hours[0];
  const wU = (h: typeof r) => reSplit(h).w;
  const pU = (h: typeof r) => reSplit(h).pv;
  const rows: { k: string; a: number; b: number; unit?: string; note?: string }[] = [
    { k: 'Solar PV', a: pU(r), b: pU(o) },
    { k: 'Wind turbines', a: wU(r), b: wU(o) },
    { k: 'Battery (+ discharge / − charge)', a: r.battery, b: o.battery },
    ...st.gens.map((g, u) => ({ k: `${g.name} (${g.rated} kW)`, a: r.unitPg[u], b: o.unitPg[u], note: 'gen' })),
    { k: 'Electric boiler (consumes)', a: -r.p2h, b: -o.p2h },
    { k: 'Renewables curtailed (spilled)', a: r.curtail, b: o.curtail },
  ];
  const cell = (v: number, gen?: boolean, u?: number, h?: typeof r) => {
    if (gen && h && !(h.on & (1 << (u ?? 0)))) return <span className="dim">OFF</span>;
    return `${v < -0.5 ? '−' : ''}${kfmt(Math.abs(v))} kW`;
  };
  const fr = r.fuelGen + r.fuelBoiler;
  const fo = o.fuelGen + o.fuelBoiler;
  const save = fr > 0 ? 1 - fo / fr : 0;
  let gi = -1;
  return (
    <Panel
      title="Set-points for this hour"
      hint={`${labelTime(s.nowMs)} - ${labelTime(s.nowMs + 3600000)} · load ${kfmt(o.load)} kW · heat ${kfmt(o.heat)} kWth`}
      right={
        <div className="row">
          <span className="note">Planning basis</span>
          <Seg value={sc.risk} onChange={(v) => set({ risk: v })} options={[{ v: 'p50', label: 'Expected P50' }, { v: 'p90', label: 'Cautious P90' }]} />
          <Toggle on={sc.drEnabled} onChange={(v) => set({ drEnabled: v })} label="Flexible-load scheduling" />
        </div>
      }
    >
      <div className="grid g-main">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Rule-based (current practice)</th>
                <th className="num">Optimised plan</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isGen = row.note === 'gen';
                if (isGen) gi++;
                const d = row.b - row.a;
                return (
                  <tr key={row.k}>
                    <td>{row.k}</td>
                    <td className="num">{cell(row.a, isGen, gi, r)}</td>
                    <td className="num">
                      <b>{cell(row.b, isGen, gi, o)}</b>
                    </td>
                    <td className="num" style={{ color: Math.abs(d) < 0.5 ? 'var(--dim)' : 'var(--text)' }}>
                      {Math.abs(d) < 0.5 ? '-' : `${d > 0 ? '+' : '−'}${kfmt(Math.abs(d))}`}
                    </td>
                  </tr>
                );
              })}
              <tr className="total">
                <td>Station load served</td>
                <td className="num">{kfmt(r.load)} kW</td>
                <td className="num">{kfmt(o.load)} kW</td>
                <td className="num note">{Math.abs(o.load - r.load) > 0.5 ? 'flexible load moved' : ''}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="stack">
          <div className="readout">
            <div className="rl">Diesel this hour (gensets + boiler)</div>
            <div className="rv">
              {fr.toFixed(1)} → {fo.toFixed(1)} L/h
            </div>
            <div className={save > 0.005 ? 'ok' : 'muted'} style={{ fontSize: 12 }}>
              {save > 0.005 ? `↓ ${pct(save, 1)} vs rule-based` : 'no change this hour'}
            </div>
          </div>
          <div className="readout">
            <div className="rl">CO₂ this hour</div>
            <div className="rv">{(((fr - fo) * st.fuel.co2PerL) as number).toFixed(1)} kg/h avoided</div>
          </div>
          <div className="readout">
            <div className="rl">Next 48 h (optimised vs rule-based)</div>
            <div className="rv">
              {kfmt(s.rule.totals.fuel - s.ai.totals.fuel)} L saved
            </div>
            <div className="note">
              {kfmt(s.ai.totals.genHours)} vs {kfmt(s.rule.totals.genHours)} genset-hours · {s.ai.totals.starts} vs {s.rule.totals.starts} starts
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Every operating constraint the optimiser respects, its limit, how it is enforced and where this plan sits. */
function ConstraintTable() {
  const { snap: s, st } = useApp();
  const r = constraintReport(st, s.ai, s.reserve, s.soc0, s.prevOn);
  const h0 = s.ai.hours[0];
  const B = st.battery;
  const sfc = h0.pg > 1 ? h0.fuelGen / h0.pg : null;
  const moved = s.dr.moves.filter((m) => m.to.join() !== m.from.join()).length;
  type St = 'ok' | 'warn' | 'na';
  const rows: { c: string; lim: React.ReactNode; how: string; now: React.ReactNode; st: St }[] = [
    { c: 'Power balance', lim: 'supply = load, every hour', how: 'hard; any unserved kWh costs 1,000 L-eq', now: `${kfmt(r.unservedKWh, 1)} kWh unserved`, st: r.unservedKWh < 0.5 ? 'ok' : 'warn' },
    {
      c: 'Genset minimum loading',
      lim: `≥ ${pct(st.gens[0].minFrac)} of rating (${st.gens.map((g) => `${g.name} ${kfmt(g.minFrac * g.rated)} kW`).join(', ')})`,
      how: 'hard lower bound on each running set',
      now: r.minLoading < 1 ? `lowest loading ${pct(r.minLoading)}` : 'no set running',
      st: 'ok',
    },
    { c: 'Low-load running (wet stacking)', lim: 'avoid < 40 % loading', how: `penalty ${COSTS.LOWLOAD_L} L-eq per unit-hour`, now: `${kfmt(r.lowLoadUnitHours)} unit-hours`, st: r.lowLoadUnitHours > 2 ? 'warn' : 'ok' },
    { c: 'Start / stop cost', lim: `${COSTS.START_L} L-eq per start · ${COSTS.RUNHOUR_L} L-eq per run-hour`, how: 'in the objective (warm-up fuel, wear, maintenance)', now: `${r.starts} starts in ${r.hours} h`, st: 'ok' },
    {
      c: 'Minimum up / down time',
      lim: `${MIN_UPDOWN_H} h run · ${MIN_UPDOWN_H} h rest`,
      how: 'DP state carries the last two hours of commitment; relaxed only if load cannot be served otherwise',
      now: `shortest run ${r.shortestRun ?? '-'} h · shortest stop ${r.shortestRest ?? '-'} h`,
      st: (r.shortestRun ?? 99) >= MIN_UPDOWN_H && (r.shortestRest ?? 99) >= MIN_UPDOWN_H ? 'ok' : 'warn',
    },
    { c: 'Start-up time', lim: '< 1 min to synchronise a diesel set', how: 'shorter than the 1 h step; spinning reserve carries the load until a started set is on-line', now: 'covered by reserve', st: 'na' },
    { c: 'Fuel-consumption curve', lim: `F = ${DIESEL.F0}·P_rated + ${DIESEL.F1}·P L/h`, how: 'exact in the objective - no-load fuel makes part-load running expensive', now: sfc ? `${sfc.toFixed(3)} L/kWh this hour` : 'no set running', st: 'na' },
    { c: 'Battery state of charge', lim: `${pct(B.socMin)} - ${pct(B.socMax)}`, how: 'hard; the DP grid only spans this range', now: `${pct(r.socMin)} - ${pct(r.socMax)} in plan`, st: 'ok' },
    { c: 'Battery charge / discharge rate', lim: `± ${B.kW} kW · ${pct(B.etaC)} one-way efficiency`, how: 'hard; limits the SOC step per hour', now: `peak ${kfmt(r.battMaxKW)} kW`, st: r.battMaxKW <= B.kW + 0.5 ? 'ok' : 'warn' },
    {
      c: 'Renewable intermittency',
      lim: 'hold 25 % of wind (80 % in a blizzard) + 10 % of PV',
      how: 'added to the reserve requirement; Cautious P90 mode plans on the high-load forecast',
      now: s.fc.bliz.some((b) => b) ? 'blizzard in horizon - 80 % of wind covered' : 'normal weather',
      st: 'na',
    },
    {
      c: 'Spinning reserve',
      lim: `≥ max(${pct(CONV_MARGIN - 1)} of load, 10 % of load + (P90 − P50) + renewable terms)`,
      how: 'hard; genset headroom + battery (15 min of energy) count',
      now: `min margin ${r.reserveMargin >= 0 ? '+' : '−'}${kfmt(Math.abs(r.reserveMargin))} kW`,
      st: r.reserveMargin >= -0.5 ? 'ok' : 'warn',
    },
    {
      c: 'N-1 security',
      lim: 'trip of the largest running set',
      how: 'hard; the other sets + battery + renewables must still carry the load',
      now: r.n1Margin === null ? 'no set running (battery + renewables)' : `min margin ${r.n1Margin >= 0 ? '+' : '−'}${kfmt(Math.abs(r.n1Margin))} kW`,
      st: r.n1Margin === null || r.n1Margin >= -0.5 ? 'ok' : 'warn',
    },
    {
      c: 'Critical vs non-critical load',
      lim: 'Tier 1 life support & comms never moved; Tier 3 jobs movable in their time window',
      how: 'flexible-load scheduler before dispatch; shed order Tier 3 → Tier 2',
      now: `${moved} flexible job${moved === 1 ? '' : 's'} moved`,
      st: 'ok',
    },
  ];
  const icon = (x: St) => (x === 'ok' ? <LuCircleCheck className="ok" /> : x === 'warn' ? <LuTriangleAlert className="warn" /> : <LuMinus className="dim" />);
  return (
    <Panel title="Operating constraints" hint={`limits the optimiser must respect · where this ${r.hours} h plan sits against each`}>
      <div className="tbl-wrap">
        <table className="tbl cons">
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              <th>Constraint</th>
              <th>Limit</th>
              <th>How it is enforced</th>
              <th>This plan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.c}>
                <td>{icon(x.st)}</td>
                <td><b>{x.c}</b></td>
                <td className="mono">{x.lim}</td>
                <td className="muted">{x.how}</td>
                <td className="mono">{x.now}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
