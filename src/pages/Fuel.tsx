import React, { useState } from 'react';
import { LuShip, LuFuel, LuLeaf, LuIndianRupee, LuTriangleAlert, LuCircleCheck, LuDroplets } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Kpi, Slider, kfmt, pct } from '../ui/kit';
import { TimeChart, BarChart, Gauge } from '../ui/charts';
import { COL } from './common';
import { dailyFuelByMonth, fuelProjection, nextResupply, fmtDate, fmtDay } from '../engine';
import { MONTHS } from '../opt/annual';
import { DIESEL } from '../sim/stations';

export function FuelPage() {
  const { st, annual, fuelNowL, simMs } = useApp();
  const [delay, setDelay] = useState(0);
  const [cost, setCost] = useState(250);
  const resupply = nextResupply(st, simMs);
  const daysToShip = Math.ceil((resupply - simMs) / 86400000);
  const horizon = daysToShip + delay + 20;
  const proj = fuelProjection(st, annual, simMs, fuelNowL, horizon);
  const reserveL = st.fuel.reserveKL * 1000;
  const iArrive = Math.min(proj.ms.length - 1, daysToShip + delay);
  const at = (k: 'diesel' | 'rule' | 'ai') => proj[k][iArrive];
  const breach = (k: 'diesel' | 'rule' | 'ai') => proj[k].findIndex((v, i) => i <= iArrive && v < reserveL);
  const month = new Date(simMs).getUTCMonth();
  const daily = { diesel: dailyFuelByMonth(annual, 'diesel'), rule: dailyFuelByMonth(annual, 'rule'), ai: dailyFuelByMonth(annual, 'ai') };
  const autonomy = fuelNowL / daily.ai[month];
  const autonomyConv = fuelNowL / daily.diesel[month];
  const toReserve = (fuelNowL - reserveL) / daily.ai[month];
  const savedYr = annual.diesel.fuel - annual.ai.fuel;
  const savedYrRule = annual.rule.fuel - annual.ai.fuel;
  const monthly = (k: 'diesel' | 'rule' | 'ai') => annual.months.map((m) => (m[k].fuel * m.scale) / 1000);
  const strat = [
    { k: 'diesel' as const, label: 'Diesel-only (today)', color: COL.conv },
    { k: 'rule' as const, label: 'Rule-based hybrid', color: COL.rule },
    { k: 'ai' as const, label: 'HimUrja hybrid', color: COL.ai },
  ];

  return (
    <div className="stack">
      <div className="grid g3">
        <div className="panel">
          <div className="eyebrow">Fuel reserve</div>
          <div className="big-num" style={{ marginTop: 4 }}>
            {kfmt(fuelNowL)}
            <small>L</small>
          </div>
          <div className="progress" style={{ marginTop: 10, position: 'relative', height: 10 }}>
            <i style={{ width: `${(fuelNowL / (st.fuel.tankKL * 1000)) * 100}%`, background: fuelNowL > reserveL ? COL.ice : COL.bad }} />
            <span style={{ position: 'absolute', left: `${(reserveL / (st.fuel.tankKL * 1000)) * 100}%`, top: -3, bottom: -3, width: 2, background: COL.bad }} />
          </div>
          <div className="row between note" style={{ marginTop: 4 }}>
            <span>{pct(fuelNowL / (st.fuel.tankKL * 1000))} of {kfmt(st.fuel.tankKL * 1000)} L tank farm</span>
            <span style={{ color: COL.bad }}>reserve floor {kfmt(reserveL)} L</span>
          </div>
        </div>
        <div className="panel">
          <div className="eyebrow">Expected endurance · HimUrja hybrid</div>
          <div className="big-num" style={{ marginTop: 4 }}>
            {Math.floor(autonomy)}
            <small>DAYS</small> {String(Math.floor((autonomy % 1) * 24)).padStart(2, '0')}
            <small>HOURS</small>
          </div>
          <div className="kv" style={{ marginTop: 8 }}>
            <span>To reserve floor</span>
            <b>
              {Math.max(0, Math.floor(toReserve))} d {String(Math.max(0, Math.floor((toReserve % 1) * 24))).padStart(2, '0')} h
            </b>
            <span>Burn rate ({MONTHS[month]} avg.)</span>
            <b>{kfmt(daily.ai[month])} L/day</b>
            <span>Diesel-only endurance</span>
            <b>
              {kfmt(autonomyConv)} d ({autonomy - autonomyConv >= 0 ? '+' : ''}
              {kfmt(autonomy - autonomyConv)} d with HimUrja)
            </b>
          </div>
        </div>
        <div className="panel">
          <div className="eyebrow">Resupply planning</div>
          <div className="kv" style={{ marginTop: 6, fontSize: 12.5 }}>
            <span>Next scheduled vessel</span>
            <b>{fmtDate(resupply)}</b>
            <span>Vessel</span>
            <b style={{ fontFamily: 'inherit', fontWeight: 500 }}>{st.fuel.shipName}</b>
            <span>Assumed delay</span>
            <b>{delay} days</b>
            <span>Projected fuel on arrival</span>
            <b>{kfmt(Math.max(0, at('ai')))} L</b>
            <span>Safety reserve</span>
            <b>{kfmt(reserveL)} L</b>
          </div>
          <div className={`alert ${breach('ai') < 0 ? 'ok' : 'bad'}`} style={{ marginTop: 8, padding: '6px 9px' }}>
            <span className={`dot ${breach('ai') < 0 ? 'ok' : 'bad'}`} style={{ marginTop: 5 }} />
            <div>
              <b>STATUS</b> ·{' '}
              {breach('ai') < 0
                ? `Within safe operating margin (+${kfmt(at('ai') - reserveL)} L above reserve on arrival)`
                : `Reserve breached on ${fmtDay(proj.ms[breach('ai')])} - conserve mode needed`}
            </div>
          </div>
        </div>
      </div>

      <Panel title="Tank level projection until the ship arrives" hint="what-if the expedition vessel is delayed by sea ice · hybrid = proposed retrofit">
        <div className="grid g-side">
          <div className="stack">
            <Slider label="Ship delay (sea-ice / weather)" value={delay} min={0} max={60} onChange={setDelay} fmt={(v) => `${v} days`} />
            {strat.map(({ k, label, color }) => {
              const b = breach(k);
              const ok = b < 0;
              return (
                <div key={k} className={`alert ${ok ? 'ok' : 'bad'}`}>
                  <span style={{ color: ok ? COL.ok : COL.bad }}>{ok ? <LuCircleCheck /> : <LuTriangleAlert />}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      <i className="sw" style={{ background: color, marginRight: 6 }} />
                      {label}
                    </div>
                    <div className="muted">
                      {ok
                        ? `Arrives with ${kfmt(at(k) / 1000, 1)} kL - ${kfmt((at(k) - reserveL) / 1000, 1)} kL above reserve`
                        : `Breaches reserve on ${fmtDay(proj.ms[b])} (day ${b}) - rationing / emergency airlift needed`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <TimeChart
            n={proj.ms.length}
            height={300}
            xLabel={(i) => fmtDay(proj.ms[i])}
            xTicks={Array.from({ length: 6 }, (_, k) => Math.round((k * (proj.ms.length - 1)) / 5))}
            yUnit="kL"
            yFmt={(v) => (v / 1000).toFixed(0)}
            markers={[
              { i: Math.min(proj.ms.length - 1, daysToShip), label: 'scheduled ship', color: COL.ice },
              ...(delay ? [{ i: iArrive, label: `+${delay} d`, color: COL.warn }] : []),
            ]}
            shades={[{ from: 0, to: proj.ms.length - 1, color: 'transparent' }]}
            series={[
              { key: 'res', label: 'Reserve floor', color: COL.bad, kind: 'line', data: proj.ms.map(() => reserveL), dash: '6 5', width: 1.4, fmt: (v) => `${(v / 1000).toFixed(0)} kL` },
              ...strat.map(({ k, label, color }) => ({ key: k, label, color, kind: 'line' as const, data: proj[k], width: k === 'ai' ? 2.6 : 1.8, fmt: (v: number) => `${(v / 1000).toFixed(1)} kL` })),
            ]}
          />
        </div>
      </Panel>

      <div className="grid g2">
        <Panel title="Annual diesel demand by month" hint="12 representative weeks, identical weather & demand for all strategies">
          <BarChart
            height={240}
            categories={MONTHS}
            yUnit="kL"
            valueFmt={(v) => `${v.toFixed(1)} kL`}
            groups={strat.map(({ k, label, color }) => ({ label, color, data: monthly(k) }))}
          />
        </Panel>
        <Panel title="Annual impact" hint="per station, per year">
          <div className="field" style={{ marginBottom: 12 }}>
            <Slider label="Landed cost of diesel in Antarctica (shipping, transfer, storage)" value={cost} min={120} max={600} step={10} onChange={setCost} fmt={(v) => `₹${v}/L`} />
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Per year</th>
                <th className="num">Today</th>
                <th className="num">Today + HimUrja</th>
                <th className="num">Hybrid, rules</th>
                <th className="num">Hybrid + HimUrja</th>
              </tr>
            </thead>
            <tbody>
              {[
                { k: `Fuel (kL) · ${st.fuel.type}`, f: (t: typeof annual.ai) => kfmt(t.fuel / 1000) },
                { k: 'Fuel cost (₹ crore)', f: (t: typeof annual.ai) => ((t.fuel * cost) / 1e7).toFixed(2) },
                { k: 'CO₂ (t)', f: (t: typeof annual.ai) => kfmt(t.co2t) },
                { k: 'Renewable share', f: (t: typeof annual.ai) => pct(t.renewableShare) },
                { k: 'Genset run-hours', f: (t: typeof annual.ai) => kfmt(t.genHours) },
              ].map((row) => (
                <tr key={row.k}>
                  <td>{row.k}</td>
                  <td className="num">{row.f(annual.diesel)}</td>
                  <td className="num">{row.f(annual.today)}</td>
                  <td className="num">{row.f(annual.rule)}</td>
                  <td className="num ok">{row.f(annual.ai)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note mt">Today = the station&apos;s existing gensets: {st.plant.gensetNote}. Hybrid = the proposed wind + PV + battery retrofit (none is described in the station documents).</div>
          <div className="alert ice mt">
            <LuIndianRupee style={{ color: COL.ice }} />
            <div>
              On today&apos;s plant, better genset scheduling alone saves only {pct(1 - annual.today.fuel / annual.diesel.fuel, 1)} - there, HimUrja&apos;s value is forecasting, fuel endurance and asset health.
              With the proposed hybrid retrofit, HimUrja saves <b>₹{((savedYr * cost) / 1e7).toFixed(2)} crore/yr</b> at {st.name} vs today and ₹{((savedYrRule * cost) / 1e7).toFixed(2)} crore/yr vs running the same
              hybrid on fixed rules.
            </div>
          </div>
          <div className="note mt">
            <LuDroplets style={{ verticalAlign: -2 }} /> Every litre not shipped is also a litre that cannot be spilt (Madrid Protocol, Annex III/IV). Landed cost is an adjustable assumption.
          </div>
        </Panel>
      </div>
    </div>
  );
}
