// Operations log: the event stream an operator would see on the station HMI, generated
// from the executed dispatch history, the weather and the telemetry health of the twin.

import { Snapshot, HOUR_MS, wrapH, fmtTime } from './engine';
import { Telemetry, STATUS_TEXT } from './sim/telemetry';

export interface OpEvent {
  ms: number;
  level: 'info' | 'warn' | 'alarm';
  src: string;
  msg: string;
}

export function operationsLog(s: Snapshot, tel: Telemetry, extra: { fuelDays: number; fuelL: number; simMs: number }): OpEvent[] {
  const { st, history: hi, y } = s;
  const ev: OpEvent[] = [];
  const K = hi.ms.length;
  const at = (ms: number, sec: number) => ms + sec * 1000;
  const f0 = (x: number) => Math.round(x).toLocaleString('en-IN');

  // ---- current hour: the MPC cycle ----
  const fc = s.load.p50.slice(0, 24).map((v, i) => v + s.dr.defer[i]);
  let pk = 0;
  for (let i = 1; i < 24; i++) if (fc[i] > fc[pk]) pk = i;
  ev.push({ ms: at(s.nowMs, 4), level: 'info', src: 'FCST', msg: `Load forecast recalculated - 24 h peak ${f0(fc[pk])} kW at ${fmtTime(s.ms[pk])} (P90 ${f0(s.load.p90[pk] + s.dr.defer[pk])} kW)` });
  ev.push({ ms: at(s.nowMs, 9), level: 'info', src: 'DISP', msg: `Dispatch re-planned (48 h): ${f0(s.ai.totals.fuel)} L diesel, ${Math.round(s.ai.totals.renewableShare * 100)} % renewable` });
  ev.push({ ms: at(s.nowMs, 11), level: extra.fuelDays < 30 ? 'warn' : 'info', src: 'FUEL', msg: `Fuel endurance updated → ${extra.fuelDays.toFixed(1)} days (${f0(extra.fuelL)} L in tanks)` });

  // ---- last 24 h of executed operation ----
  const thresholds = [30, 50, 75, 90];
  for (let i = Math.max(1, K - 24); i < K; i++) {
    const ms = hi.ms[i];
    const on = hi.on[i];
    const was = hi.on[i - 1];
    st.gens.forEach((g, u) => {
      const b = 1 << u;
      if (on & b && !(was & b)) ev.push({ ms: at(ms, 2), level: 'info', src: g.name, msg: `${g.name} started and synchronised - optimiser command` });
      if (!(on & b) && was & b) ev.push({ ms: at(ms, 2), level: 'info', src: g.name, msg: `${g.name} stopped - load carried by renewables + battery` });
    });
    const a = hi.soc[i - 1] * 100;
    const c = hi.soc[i] * 100;
    for (const th of thresholds) {
      if (a < th && c >= th) ev.push({ ms: at(ms, 30), level: 'info', src: 'BESS', msg: `Battery SOC crossed ${th} % (charging)` });
      if (a >= th && c < th) ev.push({ ms: at(ms, 30), level: th <= 30 ? 'warn' : 'info', src: 'BESS', msg: `Battery SOC fell below ${th} %` });
    }
    if (hi.p2h[i] > 8 && hi.p2h[i - 1] <= 8) ev.push({ ms: at(ms, 5), level: 'info', src: 'HEAT', msg: `Electric boiler on - ${f0(hi.p2h[i])} kW of surplus to heat` });
    if (hi.p2h[i] <= 3 && hi.p2h[i - 1] > 3) ev.push({ ms: at(ms, 5), level: 'info', src: 'HEAT', msg: 'Electric boiler off - no renewable surplus' });
    if (hi.curtail[i] > 5 && hi.curtail[i - 1] <= 5) ev.push({ ms: at(ms, 6), level: 'info', src: 'DISP', msg: `Renewables curtailed ${f0(hi.curtail[i])} kW (battery full, boiler at limit)` });
    const h = wrapH(s.now - (K - i));
    const hp = wrapH(h - 1);
    if (y.wx.bliz[h] && !y.wx.bliz[hp]) ev.push({ ms: at(ms, 0), level: 'alarm', src: 'MET', msg: `Blizzard conditions - wind ${y.wx.wind[h].toFixed(1)} m/s, temperature ${y.wx.temp[h].toFixed(1)} °C` });
    if (!y.wx.bliz[h] && y.wx.bliz[hp]) ev.push({ ms: at(ms, 0), level: 'info', src: 'MET', msg: 'Blizzard over - wind below 17 m/s' });
    const hub = (v: number) => v * Math.pow(st.wind.hubHeight / 10, 0.12);
    if (hub(y.wx.wind[h]) > 25 && hub(y.wx.wind[hp]) <= 25) ev.push({ ms: at(ms, 1), level: 'warn', src: 'WTG', msg: 'Wind turbines storm-stopped (hub wind > 25 m/s)' });
    if (y.wx.icing[h] > 0.2 && y.wx.icing[hp] <= 0.2) ev.push({ ms: at(ms, 1), level: 'warn', src: 'WTG', msg: `Blade icing detected - output ${Math.round(y.wx.icing[h] * 100)} % below power curve` });
  }

  // ---- telemetry health (last 24 h) ----
  for (const ch of tel.channels) {
    for (let k = 23; k >= 0; k--) {
      const h = wrapH(s.now - k);
      const cur = ch.status[h];
      const prev = ch.status[wrapH(h - 1)];
      if (cur === prev) continue;
      const ms = s.nowMs - k * HOUR_MS + ch.minute[h] * 60000 + ((h * 37) % 60) * 1000;
      if (cur === 1) ev.push({ ms, level: 'warn', src: 'COMM', msg: `${ch.name}: data ${STATUS_TEXT[1].toLowerCase()} ${ch.latency[h] >= 60 ? `${Math.round(ch.latency[h] / 60)} min` : `${ch.latency[h]} s`}` });
      else if (cur === 2) ev.push({ ms, level: 'warn', src: 'COMM', msg: `${ch.name}: no data - ${ch.handling.split(';')[0]}` });
      else if (cur === 3) ev.push({ ms, level: 'warn', src: 'VALID', msg: `${ch.name}: implausible value rejected${ch.id === 'meter' ? ' - forecast input gap-filled' : ''}` });
      else ev.push({ ms, level: 'info', src: 'COMM', msg: `${ch.name}: communication restored` });
    }
  }
  return ev.filter((e) => e.ms <= extra.simMs).sort((a, b) => b.ms - a.ms).slice(0, 80);
}
