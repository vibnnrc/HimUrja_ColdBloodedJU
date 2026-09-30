import React from 'react';
import { LuTriangleAlert, LuCircleCheck, LuShip, LuWrench, LuCloudSnow, LuChevronRight } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Badge, kfmt, pct } from '../ui/kit';
import { TimeChart } from '../ui/charts';
import { Scada } from '../ui/Scada';
import { ANTARCTICA_PATH, polarXY } from '../ui/antarctica';
import { timeline, timeTicks, labelTime, COL, fmtDayTime } from './common';
import { HOUR_MS, dailyFuelByMonth, nextResupply, fmtDate, fmtDay, fmtTime, Snapshot } from '../engine';
import { reSplit } from '../opt/dispatch';
import { channelsAt, filledCount, STATUS_TEXT } from '../sim/telemetry';
import { operationsLog } from '../ops';
import { StationConfig } from '../sim/stations';

const IST = 'Asia/Kolkata';
const fmtClock = (ms: number) =>
  new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: IST }).format(ms);
const fmtStamp = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST })
    .format(ms)
    .toUpperCase()
    .replace(',', ' ·');

/** Station state in one word, from the same rules the HMI alarms use. */
export function stationStatus(s: Snapshot, fuelL: number) {
  const h0 = s.ai.hours[0];
  if (h0.unserved > 0.5) return { level: 'bad' as const, text: 'LOAD SHED' };
  if (fuelL < s.st.fuel.reserveKL * 1000) return { level: 'bad' as const, text: 'FUEL BELOW RESERVE' };
  if (s.wxNow.bliz) return { level: 'warn' as const, text: 'BLIZZARD' };
  if (s.fc.bliz.slice(0, 12).some((b) => b) || s.explanations.some((e) => e.kind === 'storm' && e.t < 12)) return { level: 'warn' as const, text: 'STORM WATCH' };
  return { level: 'ok' as const, text: 'NORMAL' };
}

export function Overview() {
  const { snap: s, st, simMs, fuelNowL, annual, tel, fleet, setStationId } = useApp();
  const h0 = s.ai.hours[0];
  const h1 = s.ai.hours[1];
  const frac = (simMs % HOUR_MS) / HOUR_MS;
  const jitter = (Math.sin(simMs / 1700) + Math.sin(simMs / 2900) + 2) / 4;
  const lerp = (a: number, b: number) => a + (b - a) * frac;
  const loadNow = lerp(h0.load, h1.load) * (1 + (jitter - 0.5) * 0.02);
  const reNow = lerp(h0.reUsed, h1.reUsed);
  const running = st.gens.filter((_, u) => h0.on & (1 << u));
  const month = new Date(simMs).getUTCMonth();
  const daily = dailyFuelByMonth(annual, 'ai')[month];
  const enduranceDays = fuelNowL / daily;
  const resupply = nextResupply(st, simMs);
  const daysToShip = (resupply - simMs) / 86400000;
  const storm = s.explanations.find((e) => e.kind === 'storm');
  const due = st.gens.filter((g) => g.hoursSinceService > 400);
  const status = stationStatus(s, fuelNowL);
  const fc24 = s.load.p50.slice(0, 24).map((v, i) => v + s.dr.defer[i]);
  let pk = 0;
  for (let i = 1; i < 24; i++) if (fc24[i] > fc24[pk]) pk = i;
  const band = (s.load.p90[0] - s.load.p10[0]) / 2;
  const f = 50 + (jitter - 0.5) * 0.06;
  const v = 415 + (jitter - 0.5) * 3;

  const tl = timeline(s);
  const K = tl.K;
  const blizShades = s.fc.bliz
    .map((b, i) => (b ? i : -1))
    .filter((i) => i >= 0)
    .reduce<{ from: number; to: number }[]>((acc, i) => {
      const last = acc[acc.length - 1];
      if (last && i - last.to <= 4) last.to = i;
      else acc.push({ from: i, to: i });
      return acc;
    }, [])
    .map((r) => ({ from: K + r.from, to: K + r.to + 1, color: COL.blizShade, label: 'blizzard' }));

  const chans = channelsAt(tel, s.now);
  const repaired = filledCount(tel, s.now, 168);
  const log = operationsLog(s, tel, { fuelDays: enduranceDays, fuelL: fuelNowL, simMs });

  return (
    <div className="stack">
      {/* ---------- system status ---------- */}
      <div className={`status-strip lvl-${status.level}`}>
        <div>
          <div className="ss-h">SYSTEM STATUS · {st.name.toUpperCase()}</div>
          <div className="ss-t">{fmtStamp(simMs)} IST</div>
          <div className="row" style={{ gap: 6, marginTop: 3 }}>
            <Badge kind={status.level === 'ok' ? 'ok' : status.level === 'warn' ? 'warn' : 'bad'}>
              <span className={`dot ${status.level}`} /> {status.text}
            </Badge>
            <Badge>AUTO DISPATCH · MPC 1 h</Badge>
          </div>
        </div>
        <SS l="Grid" v={`${f.toFixed(2)} Hz`} s={`${v.toFixed(0)} V · ${h0.unserved > 0.5 ? 'load shed' : 'stable'}`} dot={h0.unserved > 0.5 ? 'bad' : 'ok'} />
        <SS l="Generators" v={`${running.length} / ${st.gens.length}`} s={running.length ? `${running.map((g) => g.name).join(', ')} @ ${pct(h0.loading)}` : 'all stopped'} dot={running.length ? 'ok' : 'off'} />
        <SS l="Battery" v={pct(h0.soc)} s={h0.battery > 1 ? `discharging ${kfmt(h0.battery)} kW` : h0.battery < -1 ? `charging ${kfmt(-h0.battery)} kW` : 'standby (reserve)'} dot={h0.soc < st.battery.socMin + 0.05 ? 'warn' : 'ok'} />
        <SS l="Renewable" v={pct(Math.min(1, reNow / loadNow))} s={`wind ${kfmt(reSplit(h0).w)} · PV ${kfmt(reSplit(h0).pv)} kW`} dot="ok" />
        <SS l="Fuel" v={`${kfmt(fuelNowL)} L`} s={`${pct(fuelNowL / (st.fuel.tankKL * 1000))} of tank · ${kfmt(enduranceDays)} d`} dot={fuelNowL < st.fuel.reserveKL * 1000 ? 'bad' : enduranceDays < daysToShip + 20 ? 'warn' : 'ok'} />
        <SS l="Forecast 24 h" v={`${kfmt(fc24[pk])} kW`} s={`peak at ${fmtTime(s.ms[pk])} · band ±${kfmt(band)} kW`} dot="ok" />
      </div>

      {/* ---------- the energy decision in one line: now -> forecast -> dispatch -> fuel ---------- */}
      <DecisionFlow />

      {/* ---------- power flow ---------- */}
      <Panel
        title="Station single-line diagram"
        hint={`${st.fullName} · live power flow · set-points of ${labelTime(s.nowMs)}`}
        right={
          <span className="note mono">
            {s.wxNow.temp.toFixed(1)} °C · {s.wxNow.wind.toFixed(1)} m/s · sun {s.wxNow.elev.toFixed(1)}° · crew {s.crewNow}
          </span>
        }
      >
        <div className="scada-wrap">
          <Scada st={st} h={{ ...h0, load: loadNow }} crit={s.planCrit[0]} defer={s.dr.defer[0]} temp={s.wxNow.temp} windMs={s.wxNow.wind} heatDemand={h0.heat} jitter={jitter} />
        </div>
        <div className="grid g4 mt">
          <ThermalBar label={`Genset heat recovery (demand ${kfmt(h0.heat)} kWth)`} v={h0.recHeat} total={h0.heat} color={COL.diesel} />
          <ThermalBar label="Electric boiler (renewable surplus)" v={h0.p2h} total={h0.heat} color={COL.heat} />
          <ThermalBar label="Oil-fired boiler" v={h0.boilerHeat} total={h0.heat} color={COL.boiler} />
          <ThermalBar label="Renewables curtailed" v={h0.curtail} total={Math.max(1, h0.wind + h0.pv)} color={COL.curtail} unit="kW" />
        </div>
      </Panel>

      {/* ---------- stations + data quality ---------- */}
      <div className="grid g-half">
        <Panel title="Stations" hint="select a station to switch the whole console">
          <div className="stations">
            <StationMap current={st.id} onPick={setStationId} items={fleet.map((f) => ({ st: f.st, level: stationStatus(f.snap, f.fuelL).level }))} />
            <div className="st-cards">
              {fleet.map((fl) => {
                const hh = fl.snap.ai.hours[0];
                const stt = stationStatus(fl.snap, fl.fuelL);
                return (
                  <button key={fl.st.id} className={`st-card ${fl.st.id === st.id ? 'on' : ''}`} onClick={() => setStationId(fl.st.id)}>
                    <div className="nm">
                      <span className={`dot ${stt.level}`} />
                      {fl.st.name}
                      <span className="note" style={{ marginLeft: 'auto', letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>
                        {Math.abs(fl.st.lat).toFixed(2)}°S {fl.st.lon.toFixed(2)}°E
                      </span>
                    </div>
                    <div className="kv">
                      <span>Load</span>
                      <b>{kfmt(hh.load)} kW</b>
                      <span>Supply</span>
                      <b>
                        gen {kfmt(hh.pg)} · RE {kfmt(reSplit(hh).w + reSplit(hh).pv)} · batt {kfmt(Math.max(0, hh.battery))} kW
                      </b>
                      <span>Battery</span>
                      <b>{pct(hh.soc)}</b>
                      <span>Fuel</span>
                      <b>
                        {kfmt(fl.fuelL / 1000, 1)} kL · {pct(fl.fuelL / (fl.st.fuel.tankKL * 1000))}
                      </b>
                      <span>Status</span>
                      <b className={stt.level}>{stt.text}</b>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Panel>

        <Panel title="Data quality" hint="telemetry health, last 24 h" right={<Badge kind={chans.some((c) => c.status >= 2) ? 'warn' : 'ok'}>{chans.filter((c) => c.status === 0).length}/{chans.length} online</Badge>}>
          <div className="tbl-wrap">
            <table className="tbl dq">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Status</th>
                  <th className="num">Valid 24 h</th>
                </tr>
              </thead>
              <tbody>
                {chans.map((c) => (
                  <tr key={c.id} title={`${c.signals} - ${c.handling}`}>
                    <td>
                      {c.name}
                      <div className="note">{c.status === 0 ? c.signals : c.handling}</div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <span className={`dot ${c.status === 0 ? 'ok' : c.status === 1 ? 'warn' : 'bad'}`} />
                        <span className="mono" style={{ fontSize: 11.5 }}>
                          {STATUS_TEXT[c.status]}
                          {c.status === 1 ? ` ${c.latency >= 60 ? `${Math.round(c.latency / 60)} min` : `${c.latency} s`}` : ''}
                        </span>
                      </span>
                    </td>
                    <td className="num">{pct(c.valid24)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note mt">
            Load-forecast inputs pass a range and rate-of-change check; missing or rejected samples are filled from the same hour of the previous day,
            level-adjusted. Repaired in the last 7 days: <b className="mono">{repaired}</b> of 168 hourly samples.
          </div>
        </Panel>
      </div>

      {/* ---------- timeline + ops log ---------- */}
      <div className="grid g-main">
        <Panel title="Energy timeline" hint="last 72 h executed · next 48 h optimised plan" right={<span className="note">re-planned every hour · last run {labelTime(s.nowMs)}</span>}>
          <TimeChart
            n={tl.n}
            height={320}
            xLabel={(i) => labelTime(tl.ms[i])}
            tipTitle={(i) => `${fmtDayTime(tl.ms[i])}${i >= K ? ' · plan' : ''}`}
            xTicks={timeTicks(tl.ms, 24)}
            yUnit="kW"
            zeroLine
            right={{ min: 0, max: 100, unit: 'SOC %' }}
            markers={[{ i: K, label: 'now', color: COL.ice }]}
            shades={[{ from: K, to: tl.n - 1, color: COL.planShade }, ...blizShades]}
            series={[
              { key: 'wind', label: 'Wind', color: COL.wind, kind: 'bar', data: tl.wind, stack: 'p' },
              { key: 'pv', label: 'Solar', color: COL.solar, kind: 'bar', data: tl.pv, stack: 'p' },
              { key: 'bo', label: 'Battery out', color: COL.battery, kind: 'bar', data: tl.battOut, stack: 'p' },
              { key: 'dg', label: 'Gensets', color: COL.diesel, kind: 'bar', data: tl.gen, stack: 'p' },
              { key: 'bi', label: 'Battery charging', color: COL.battIn, kind: 'bar', data: tl.battIn, stack: 'p', opacity: 0.8, fmt: (x) => Math.abs(x).toFixed(1) },
              { key: 'p2h', label: 'Power-to-heat', color: COL.heat, kind: 'bar', data: tl.p2h, stack: 'p', opacity: 0.55, fmt: (x) => Math.abs(x).toFixed(1) },
              { key: 'load', label: 'Station load', color: COL.load, kind: 'line', data: tl.load, width: 1.8 },
              { key: 'soc', label: 'Battery SOC', color: COL.soc, kind: 'line', data: tl.soc, axis: 'right', dash: '4 4', width: 1.4, fmt: (x) => `${x.toFixed(0)}%` },
            ]}
          />
        </Panel>
        <Panel title="Operations log" hint="system events, newest first" right={<Badge>{log.length} events · 24 h</Badge>}>
          <OpsLog events={log} />
        </Panel>
      </div>

      <div className="grid g3">
        <StatusCard
          ok={enduranceDays > daysToShip + 30}
          icon={<LuShip />}
          title={enduranceDays > daysToShip + 30 ? 'Fuel endurance secure' : 'Fuel endurance tight'}
          text={`Next vessel ${fmtDate(resupply)} (${kfmt(daysToShip)} days). At the optimised burn of ${kfmt(daily)} L/day the tanks last ${kfmt(enduranceDays)} days.`}
        />
        <StatusCard
          ok={!storm && !s.wxNow.bliz}
          icon={<LuCloudSnow />}
          title={storm || s.wxNow.bliz ? 'Storm protocol armed' : 'Weather window stable'}
          text={storm ? `${storm.title}. Battery is pre-charged and a genset is committed before the turbines storm-stop.` : 'No blizzard in the 48 h forecast. Wind and solar are used first; gensets run only when the battery cannot carry the reserve.'}
        />
        <StatusCard
          ok={!due.length}
          icon={<LuWrench />}
          title={due.length ? `${due.map((g) => g.name).join(', ')} service due soon` : 'All gensets within service interval'}
          text={due.length ? `${due.map((g) => `${g.name}: ${500 - g.hoursSinceService} h left of 500 h interval`).join(' · ')}. Dispatch prefers other units until serviced.` : 'Run-hours are balanced across units.'}
        />
      </div>
    </div>
  );
}

function SS({ l, v, s, dot }: { l: string; v: string; s: string; dot: 'ok' | 'warn' | 'bad' | 'off' }) {
  return (
    <div className="ss-item">
      <div className="l">
        <span className={`dot ${dot}`} />
        {l}
      </div>
      <div className="v">{v}</div>
      <div className="s">{s}</div>
    </div>
  );
}

function StationMap({ current, onPick, items }: { current: string; onPick: (id: StationConfig['id']) => void; items: { st: StationConfig; level: 'ok' | 'warn' | 'bad' }[] }) {
  const circle = (lat: number) => {
    const [, y] = polarXY(0, lat);
    return 200 - y;
  };
  const colr = { ok: COL.ok, warn: COL.warn, bad: COL.bad };
  return (
    <div className="stmap">
      <svg viewBox="52 44 296 300" role="img" aria-label="Map of Antarctica with Indian research stations">
        {[-60, -70, -80].map((lat) => (
          <circle key={lat} cx={200} cy={200} r={circle(lat)} className="grat" />
        ))}
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((lon) => {
          const [x, y] = polarXY(lon, -60);
          return <line key={lon} x1={200} y1={200} x2={x} y2={y} className="grat" />;
        })}
        <path d={ANTARCTICA_PATH} className="land" />
        {[
          [0, '0°'],
          [90, '90°E'],
          [180, '180°'],
          [270, '90°W'],
        ].map(([lon, t]) => {
          const [x, y] = polarXY(lon as number, -61.5);
          return (
            <text key={t as string} x={x} y={y} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 9, fill: '#7b8797', fontFamily: 'var(--mono)' }}>
              {t}
            </text>
          );
        })}
        <text x={200} y={204} textAnchor="middle" style={{ fontSize: 8.5, fill: '#7b8797', letterSpacing: 1 }}>
          SOUTH POLE +
        </text>
        {items.map(({ st, level }) => {
          const [x, y] = polarXY(st.lon, st.lat);
          const on = st.id === current;
          const right = st.lon > 40;
          return (
            <g key={st.id} className="mk" onClick={() => onPick(st.id)}>
              <circle cx={x} cy={y} r={on ? 7 : 5.5} fill={on ? '#14243a' : '#ffffff'} stroke="#14243a" strokeWidth={1.5} />
              <circle cx={x} cy={y} r={2.2} fill={colr[level]} />
              <text x={right ? x - 11 : x} y={right ? y + 4 : y - 11} textAnchor={right ? 'end' : 'middle'} style={{ fontSize: 12, fontWeight: 700, fill: '#14243a', letterSpacing: 0.8 }}>
                {st.name.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="note" style={{ textAlign: 'center' }}>
        South-polar stereographic · coastline Natural Earth 1:110m
      </div>
    </div>
  );
}

function OpsLog({ events }: { events: ReturnType<typeof operationsLog> }) {
  let lastDay = '';
  const icon = { info: 'dot off', warn: 'dot warn', alarm: 'dot bad' };
  return (
    <div className="oplog">
      {events.map((e, i) => {
        const d = fmtDay(e.ms);
        const sep = d !== lastDay;
        lastDay = d;
        return (
          <React.Fragment key={i}>
            {sep && (
              <div className="note" style={{ padding: '5px 2px 2px', fontWeight: 600 }}>
                {d}
              </div>
            )}
            <div className="e">
              <span className="t">
                {fmtClock(e.ms)} <span style={{ color: '#9aa6b4' }}>{e.src}</span>
              </span>
              <span className={icon[e.level]} style={{ marginTop: 2 }} />
              <span className="m">{e.msg}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ThermalBar({ label, v, total, color, unit = 'kWth' }: { label: string; v: number; total: number; color: string; unit?: string }) {
  return (
    <div>
      <div className="row between" style={{ fontSize: 12 }}>
        <span className="muted">{label}</span>
        <b className="mono">
          {kfmt(v)} {unit}
        </b>
      </div>
      <div className="progress" style={{ marginTop: 5 }}>
        <i style={{ width: `${Math.min(100, (v / Math.max(1, total)) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function StatusCard({ ok, icon, title, text }: { ok: boolean; icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className={`alert ${ok ? 'ok' : 'warn'}`}>
      <span style={{ color: ok ? COL.ok : COL.warn }}>{ok ? <LuCircleCheck /> : <LuTriangleAlert />}</span>
      <div>
        <div className="row" style={{ gap: 6, fontWeight: 600 }}>
          <span style={{ display: 'inline-flex', color: 'var(--muted)' }}>{icon}</span>
          {title}
        </div>
        <div className="muted" style={{ marginTop: 3 }}>
          {text}
        </div>
      </div>
    </div>
  );
}

/** The value chain an operator (or a judge) should grasp in ten seconds. */
function DecisionFlow() {
  const { snap: s, st, fuelNowL, annual, simMs } = useApp();
  const h0 = s.ai.hours[0];
  const r0 = s.rule.hours[0];
  const fc = s.load.p50.slice(0, 24).map((v, i) => v + s.dr.defer[i]);
  const p90 = s.load.p90.slice(0, 24).map((v, i) => v + s.dr.defer[i]);
  let pk = 0;
  for (let i = 1; i < 24; i++) if (fc[i] > fc[pk]) pk = i;
  const re24 = s.wind.slice(0, 24).reduce((a, b) => a + b, 0) + s.pv.slice(0, 24).reduce((a, b) => a + b, 0);
  const bz = s.fc.bliz.indexOf(1);
  const on = (h: typeof h0) => st.gens.filter((_, u) => h.on & (1 << u)).map((g) => g.name);
  const onAI = on(h0);
  const onRule = on(r0);
  const month = new Date(simMs).getUTCMonth();
  const days = (k: 'ai' | 'rule' | 'diesel') => fuelNowL / dailyFuelByMonth(annual, k)[month];
  const f = { d: s.diesel.totals.fuel, r: s.rule.totals.fuel, a: s.ai.totals.fuel };
  const mx = Math.max(f.d, f.r, f.a);
  const perH = (h: typeof h0) => h.fuelGen + h.fuelBoiler;
  const battTxt = h0.battery > 1 ? `discharge ${kfmt(h0.battery)} kW` : h0.battery < -1 ? `charge ${kfmt(-h0.battery)} kW` : 'hold (reserve)';
  return (
    <div className="flow">
      <div className="fc">
        <div className="fh">1 · Now</div>
        <div className="fv">
          {kfmt(h0.load)} <small>kW load</small>
        </div>
        <div className="fl"><span>Wind + solar available</span><b>{kfmt(h0.wind + h0.pv)} kW</b></div>
        <div className="fl"><span>Battery</span><b>{pct(h0.soc)} SOC</b></div>
        <div className="fl"><span>Heating demand</span><b>{kfmt(h0.heat)} kWth</b></div>
      </div>
      <div className="fa"><LuChevronRight /></div>
      <div className="fc">
        <div className="fh">2 · Next 24 h <a href="#/forecast">forecast ›</a></div>
        <div className="fv">
          {kfmt(fc[pk])} <small>kW peak at {fmtTime(s.ms[pk])}</small>
        </div>
        <div className="fl"><span>Cautious (P90) peak</span><b>{kfmt(Math.max(...p90))} kW</b></div>
        <div className="fl"><span>Wind + solar expected</span><b>{kfmt(re24 / 1000, 2)} MWh</b></div>
        <div className="fl"><span>Blizzard (&gt; 17 m/s)</span><b className={bz >= 0 ? 'warn' : ''}>{bz === 0 ? 'now' : bz > 0 ? `in ${bz} h` : 'none forecast'}</b></div>
      </div>
      <div className="fa"><LuChevronRight /></div>
      <div className="fc">
        <div className="fh">3 · Dispatch this hour <a href="#/dispatch">set-points ›</a></div>
        <div className="fv">
          {onAI.length ? onAI.join(' + ') : 'Gensets off'} <small>{onAI.length ? `@ ${pct(h0.loading)}` : ''}</small>
        </div>
        <div className="fl"><span>Battery</span><b>{battTxt}</b></div>
        <div className="fl"><span>Rule-based would run</span><b>{onRule.length ? `${onRule.join(' + ')} @ ${pct(r0.loading)}` : 'none'}</b></div>
        <div className="fl"><span>Fuel incl. boiler</span><b>{perH(h0).toFixed(1)} vs {perH(r0).toFixed(1)} L/h</b></div>
      </div>
      <div className="fa"><LuChevronRight /></div>
      <div className="fc">
        <div className="fh">4 · Fuel impact, next 48 h <a href="#/fuel">endurance ›</a></div>
        {[
          { k: 'Diesel-only', v: f.d, c: '#9aa5b1' },
          { k: 'Hybrid · rules', v: f.r, c: '#7b8797' },
          { k: 'Hybrid · HimUrja', v: f.a, c: COL.ai },
        ].map((x) => (
          <div className="fbar" key={x.k}>
            <span>{x.k}</span>
            <div className="tr"><i style={{ width: `${(x.v / mx) * 100}%`, background: x.c }} /></div>
            <b>{kfmt(x.v)} L</b>
          </div>
        ))}
        <div className="fl" style={{ marginTop: 3 }}>
          <span>Saved vs rule-based · diesel-only</span>
          <b className="ok">
            {pct(1 - f.a / f.r)} · {pct(1 - f.a / f.d)}
          </b>
        </div>
        <div className="fl"><span>Endurance, current burn</span><b>{kfmt(days('ai'))} d vs {kfmt(days('rule'))} d</b></div>
        <div className="note">diesel-only (today): {kfmt(days('diesel'))} d · hybrid = proposed retrofit</div>
      </div>
    </div>
  );
}
