// The HimUrja "brain": ties the digital twin, the AI forecaster and the optimiser together
// into a receding-horizon (model-predictive) control loop, and explains every decision.

import { StationConfig, DIESEL } from './sim/stations';
import { getYear, weatherForecast, windSeries, WeatherForecast, YearData } from './sim/dataset';
import { heatDemand, crewOnDay, ACTIVITY, localHour } from './sim/demand';
import { forecastLoad, LoadForecast } from './ai/forecast';
import { optimizeAI, conventional, reserveProfile, DispatchResult, HourResult, reSplit } from './opt/dispatch';
import { scheduleDeferrable, ShiftResult } from './opt/demandResponse';
import { annualProjection, AnnualResult, MONTH_START, MONTH_DAYS } from './opt/annual';
import { getTelemetry } from './sim/telemetry';

export const HOUR_MS = 3_600_000;

export function hourIndexOf(ms: number) {
  const d = new Date(ms);
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.min(8759, Math.floor((ms - y0) / HOUR_MS));
}
export const wrapH = (h: number) => ((h % 8760) + 8760) % 8760;

const IST = 'Asia/Kolkata';
export const fmtTime = (ms: number) =>
  new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST }).format(ms);
export const fmtDay = (ms: number) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', timeZone: IST }).format(ms);
export const fmtDayTime = (ms: number) => `${fmtDay(ms)} ${fmtTime(ms)}`;
export const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST }).format(ms);

export interface Scenario {
  blizzardIn: number | null; // hours from now
  blizzardHours: number;
  outageMask: number; // gensets forced out
  outageFrom: number;
  outageTo: number;
  crewDelta: number;
  risk: 'p50' | 'p90';
  drEnabled: boolean;
  tempOffset: number; // deg C added to the temperature forecast
  windFactor: number; // multiplier on the wind-speed forecast
  solarFactor: number; // multiplier on PV output (overcast, snow on panels)
  shipDelay: number; // days the resupply vessel is late (fuel endurance)
}

export const DEFAULT_SCENARIO: Scenario = {
  blizzardIn: null,
  blizzardHours: 20,
  outageMask: 0,
  outageFrom: 0,
  outageTo: 48,
  crewDelta: 0,
  risk: 'p50',
  drEnabled: true,
  tempOffset: 0,
  windFactor: 1,
  solarFactor: 1,
  shipDelay: 0,
};

export const isDefaultScenario = (sc: Scenario) =>
  (Object.keys(DEFAULT_SCENARIO) as (keyof Scenario)[]).every(
    (k) => k === 'blizzardHours' || k === 'outageFrom' || k === 'outageTo' || k === 'risk' || k === 'drEnabled' || sc[k] === DEFAULT_SCENARIO[k],
  );

/** The operating settings of `sc` without any simulated event (baseline for scenario comparison). */
export const baselineOf = (sc: Scenario): Scenario => ({ ...DEFAULT_SCENARIO, risk: sc.risk, drEnabled: sc.drEnabled });

export interface Explanation {
  t: number; // hour offset in plan
  ms: number;
  kind: 'start' | 'stop' | 'battery' | 'p2h' | 'dr' | 'storm' | 'info';
  title: string;
  detail: string;
  reasons: string[]; // the facts the optimiser acted on
  action: string; // the set-point change, in operator language
}

export interface History {
  ms: number[];
  load: number[];
  wind: number[];
  pv: number[];
  gen: number[];
  soc: number[];
  on: number[];
  fuel: number[];
  batt: number[];
  p2h: number[];
  curtail: number[];
}

export interface Snapshot {
  st: StationConfig;
  y: YearData;
  nowMs: number; // top of the current hour
  now: number; // hour index in the twin year
  H: number;
  ms: number[]; // timestamps of plan hours
  hours: number[];
  fc: WeatherForecast;
  load: LoadForecast; // critical load forecast
  planCrit: number[];
  heat: number[];
  wind: number[];
  pv: number[];
  deferBase: number[];
  dr: ShiftResult;
  reserve: number[];
  ai: DispatchResult;
  rule: DispatchResult;
  diesel: DispatchResult;
  explanations: Explanation[];
  history: History;
  soc0: number;
  prevOn: number;
  prevOn2: number;
  crewNow: number;
  wxNow: { temp: number; wind: number; cloud: number; bliz: number; elev: number; ghi: number; icing: number };
}

function applyBlizzard(st: StationConfig, fc: WeatherForecast, from: number, len: number) {
  for (let i = from; i < Math.min(fc.hours.length, from + len); i++) {
    const p = (i - from) / len;
    const shape = p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
    fc.wind[i] = Math.max(fc.wind[i], 14 + 16 * shape);
    fc.temp[i] += 4;
    fc.cloud[i] = 1;
    fc.bliz[i] = fc.wind[i] > 17 ? 1 : 0;
  }
  const icing = fc.hours.map(() => 0);
  fc.windPU = Array.from(windSeries(st, fc.wind, fc.temp, icing));
  for (let i = from; i < fc.hours.length; i++) {
    const after = i - (from + len);
    fc.pvPU[i] *= i < from + len ? 0.05 : after < 6 ? 0.4 : 1; // snow on panels after the storm
  }
}

export function computeSnapshot(st: StationConfig, nowRealMs: number, sc: Scenario, H = 48): Snapshot {
  const y = getYear(st);
  const nowMs = Math.floor(nowRealMs / HOUR_MS) * HOUR_MS;
  const now = hourIndexOf(nowMs);
  const windCap = st.wind.units * st.wind.unitKW;

  // ---- 1. history: replay the last 96 h of AI operation on actual data (warm start) ----
  const HB = 96;
  const hIdx = Array.from({ length: HB }, (_, i) => wrapH(now - HB + i));
  const hCrit = hIdx.map((h) => y.dem.crit[h]);
  const hWind = hIdx.map((h) => y.windPU[h] * windCap);
  const hPv = hIdx.map((h) => y.pvPU[h] * st.pv.kWp);
  const hDr = scheduleDeferrable(st, now - HB, hIdx.map((h) => y.dem.defer[h]), (h) => y.dem.crew[wrapH(h)], hCrit.map((c, i) => hWind[i] + hPv[i] - c));
  const hLoad = hCrit.map((c, i) => c + hDr.defer[i]);
  const past = optimizeAI({
    st,
    load: hLoad,
    heat: hIdx.map((h) => y.dem.heat[h]),
    wind: hWind,
    pv: hPv,
    reserve: reserveProfile(hLoad, hLoad.map((l) => l * 1.08), hWind, hPv, hIdx.map((h) => y.wx.bliz[h])),
    soc0: 0.6,
    socLevels: 21,
  });
  const last = past.hours[HB - 1];
  const soc0 = last.soc;
  const prevOn = last.on;
  const prevOn2 = past.hours[HB - 2].on;
  const K = 72;
  const history: History = { ms: [], load: [], wind: [], pv: [], gen: [], soc: [], on: [], fuel: [], batt: [], p2h: [], curtail: [] };
  for (let i = HB - K; i < HB; i++) {
    const r = past.hours[i];
    history.ms.push(nowMs - (HB - i) * HOUR_MS);
    history.load.push(r.load);
    const sp = reSplit(r);
    history.wind.push(sp.w);
    history.pv.push(sp.pv);
    history.gen.push(r.pg);
    history.soc.push(r.soc);
    history.on.push(r.on);
    history.fuel.push(r.fuelGen + r.fuelBoiler);
    history.batt.push(r.battery);
    history.p2h.push(r.p2h);
    history.curtail.push(r.curtail);
  }

  // ---- 2. forecasts ----
  const fc = weatherForecast(y, now, H);
  if (sc.tempOffset || sc.windFactor !== 1) {
    fc.temp = fc.temp.map((t) => t + sc.tempOffset);
    fc.wind = fc.wind.map((w) => Math.max(0.2, w * sc.windFactor));
    fc.bliz = fc.wind.map((w) => (w > 17 ? 1 : 0));
    const icing0 = y.wx.icing[wrapH(now)];
    fc.windPU = Array.from(windSeries(st, fc.wind, fc.temp, fc.hours.map((_, i) => icing0 * Math.exp(-i / 10))));
  }
  if (sc.blizzardIn !== null) applyBlizzard(st, fc, sc.blizzardIn, sc.blizzardHours);
  if (sc.solarFactor !== 1) fc.pvPU = fc.pvPU.map((p) => p * sc.solarFactor);
  // the forecaster reads validated, gap-filled meter data - never the twin's ground truth
  const load = forecastLoad(y, fc, getTelemetry(st).clean);
  const hours = fc.hours;
  const ms = hours.map((_, i) => nowMs + i * HOUR_MS);
  const crewAt = (h: number) => y.dem.crew[wrapH(h)] + sc.crewDelta;
  const crewAdj = hours.map((h) => sc.crewDelta * st.load.perCrew * ACTIVITY[localHour(st, h)]);
  const addCrew = (a: number[]) => a.map((v, i) => v + crewAdj[i] + (fc.bliz[i] ? 4 : 0));
  load.p50 = addCrew(load.p50);
  load.p10 = addCrew(load.p10);
  load.p90 = addCrew(load.p90);
  load.p02 = addCrew(load.p02);
  load.p98 = addCrew(load.p98);
  const heat = hours.map((h, i) => heatDemand(st, fc.temp[i], fc.wind[i], crewAt(h)));
  const wind = fc.windPU.map((p) => p * windCap);
  const pv = fc.pvPU.map((p) => p * st.pv.kWp);
  const planCrit = sc.risk === 'p90' ? load.p90 : load.p50;

  // ---- 3. smart load scheduling + optimal dispatch ----
  const deferBase = hours.map((h) => y.dem.defer[h]);
  const dr = sc.drEnabled
    ? scheduleDeferrable(st, now, deferBase, crewAt, planCrit.map((c, i) => wind[i] + pv[i] - c))
    : { defer: deferBase.slice(), moves: [] };
  const aiLoad = planCrit.map((c, i) => c + dr.defer[i]);
  const reserve = reserveProfile(aiLoad, load.p90.map((p, i) => p + dr.defer[i]), wind, pv, fc.bliz);
  const outage = hours.map((_, i) => (i >= sc.outageFrom && i < sc.outageTo ? sc.outageMask : 0));
  const ai = optimizeAI({ st, load: aiLoad, heat, wind, pv, reserve, soc0, prevOn, prevOn2, outage, socLevels: 31 });
  const baseLoad = load.p50.map((c, i) => c + deferBase[i]);
  const rule = conventional({ st, load: baseLoad, heat, wind, pv, soc0, prevOn, outage }, true);
  const diesel = conventional({ st, load: baseLoad, heat, wind, pv, soc0, prevOn, outage }, false);

  const snap: Snapshot = {
    st,
    y,
    nowMs,
    now,
    H,
    ms,
    hours,
    fc,
    load,
    planCrit,
    heat,
    wind,
    pv,
    deferBase,
    dr,
    reserve,
    ai,
    rule,
    diesel,
    explanations: [],
    history,
    soc0,
    prevOn,
    prevOn2,
    crewNow: crewAt(now),
    wxNow: {
      temp: y.wx.temp[now],
      wind: y.wx.wind[now],
      cloud: y.wx.cloud[now],
      bliz: y.wx.bliz[now],
      elev: y.wx.elev[now],
      ghi: y.wx.ghi[now],
      icing: y.wx.icing[now],
    },
  };
  snap.explanations = explain(snap);
  return snap;
}

// ------------------------------------------------------------------------------------------
// Explainability: turn the optimiser's schedule into plain-language operator messages
// ------------------------------------------------------------------------------------------
export function explain(s: Snapshot): Explanation[] {
  const { st, ai, fc, ms } = s;
  const ex: Explanation[] = [];
  const name = (u: number) => st.gens[u].name;
  const f1 = (x: number) => x.toFixed(1);
  const f0 = (x: number) => Math.round(x).toString();
  const floorPct = Math.round(st.battery.socMin * 100);
  const reqRes = (t: number) => Math.max(0.3 * ai.hours[t].load, s.reserve[t]);
  const battAvail = (h: HourResult) => Math.max(0, Math.min(st.battery.kW - Math.max(0, h.battery), (h.soc - st.battery.socMin) * st.battery.kWh));
  const ratedOn = (on: number) => st.gens.reduce((a, g, u) => a + (on & (1 << u) ? g.rated : 0), 0);
  const p90 = (t: number) => s.load.p90[t] + s.dr.defer[t];
  let prev = s.prevOn;
  // storm warning
  const stormAt = fc.wind.findIndex((w) => w * Math.pow(3, 0.12) > 25);
  if (stormAt >= 0) {
    const peak = Math.max(...fc.wind.slice(stormAt, stormAt + 24));
    ex.push({
      t: stormAt,
      ms: ms[stormAt],
      kind: 'storm',
      title: `Blizzard forecast - wind up to ${f0(peak)} m/s`,
      detail: `Turbines will storm-stop above 25 m/s at hub height and PV will be snow-covered. Plan pre-charges the battery and schedules genset cover from ${fmtDayTime(ms[stormAt])}.`,
      reasons: [
        `Forecast wind ${f0(peak)} m/s at 10 m (≈ ${f0(peak * Math.pow(3, 0.12))} m/s at hub) from ${fmtDayTime(ms[stormAt])}`,
        'Turbines storm-stop above 25 m/s; PV stays snow-covered for hours afterwards',
        'Reserve margin on wind output raised from 25 % to 80 % for blizzard hours',
        `Battery at ${f0(ai.hours[Math.max(0, stormAt - 1)].soc * 100)} % going into the storm`,
      ],
      action: `Pre-charge battery and commit genset cover from ${fmtTime(ms[stormAt])}`,
    });
  }
  let p2hOn = false;
  let charging = false;
  ai.hours.forEach((h, t) => {
    const re = h.wind + h.pv;
    const started = h.on & ~prev;
    const stopped = prev & ~h.on;
    for (let u = 0; u < st.gens.length; u++) {
      if (started & (1 << u)) {
        let why: string;
        if (fc.bliz[t]) why = 'storm cut-out of the turbines is expected';
        else if (h.soc <= st.battery.socMin + 0.08) why = `battery would fall below its ${floorPct}% safety floor`;
        else if (re < 0.35 * h.load) why = `renewables drop to ${f0(re)} kW (wind ${f1(fc.wind[t])} m/s)`;
        else why = 'spinning reserve for the forecast uncertainty band is required';
        const without = battAvail(h) + ratedOn(h.on & ~(1 << u)) - (h.pg - h.unitPg[u]);
        ex.push({
          t,
          ms: ms[t],
          kind: 'start',
          title: `Start ${name(u)}`,
          detail: `Load ${f0(h.load)} kW vs renewables ${f0(re)} kW, battery ${f0(h.soc * 100)}% - ${why}.`,
          reasons: [
            `Forecast load ${f0(h.load)} kW (P90 ${f0(p90(t))} kW)`,
            `Wind ${f1(fc.wind[t])} m/s + solar → ${f0(re)} kW available`,
            `Battery ${f0(h.soc * 100)} % (floor ${floorPct} %)`,
            `Reserve required ${f0(reqRes(t))} kW; without ${name(u)} only ${f0(Math.max(0, without))} kW available`,
            `Trigger: ${why}`,
          ],
          action: `Start ${name(u)} (${st.gens[u].rated} kW) at ${fmtTime(ms[t])} → ${f0(h.loading * 100)} % loading`,
        });
      }
      if (stopped & (1 << u)) {
        const saved = DIESEL.F0 * st.gens[u].rated;
        const kept = h.pg + Math.max(0, h.battery);
        const keptLoading = kept / Math.max(1, ratedOn(h.on) + st.gens[u].rated);
        const keptFuel = DIESEL.F0 * st.gens[u].rated + DIESEL.F1 * Math.max(0, h.battery);
        ex.push({
          t,
          ms: ms[t],
          kind: 'stop',
          title: `Stop ${name(u)}`,
          detail: `Wind ${f1(fc.wind[t])} m/s + solar supply ${f0(re)} kW; battery (${f0(h.soc * 100)}%) provides the spinning reserve. Avoids ~${f1(saved)} L/h of no-load fuel and low-load wet stacking.`,
          reasons: [
            `Wind ${f1(fc.wind[t])} m/s + solar supply ${f0(re)} kW vs load ${f0(h.load)} kW`,
            `Battery ${f0(h.soc * 100)} % can deliver ${f0(battAvail(h))} kW ≥ reserve required ${f0(reqRes(t))} kW`,
            `Kept on, ${name(u)} would carry ≈ ${f0(Math.max(0, h.battery))} kW (${f0(keptLoading * 100)} % loading${keptLoading < 0.4 ? ', wet-stacking zone' : ''}) burning ≈ ${f1(keptFuel)} L/h`,
            `No-load fuel avoided ≈ ${f1(saved)} L/h`,
          ],
          action: `Stop ${name(u)} at ${fmtTime(ms[t])}; battery holds the reserve`,
        });
      }
    }
    prev = h.on;
    // battery pre-charging ahead of a deficit
    if (h.battery < -20 && !charging) {
      charging = true;
      const ahead = ai.hours.slice(t + 1, t + 16);
      const deficitAt = ahead.findIndex((a) => a.battery > 20);
      if (deficitAt >= 0 && h.on) {
        const d = ahead[deficitAt];
        const gs = st.gens.filter((_, u) => h.on & (1 << u)).map((g) => g.name).join(' + ');
        const loadingNoCharge = Math.max(0, h.pg + h.battery) / Math.max(1, ratedOn(h.on));
        ex.push({
          t,
          ms: ms[t],
          kind: 'battery',
          title: 'Pre-charging battery from genset sweet-spot',
          detail: `Running ${gs} at ${f0(h.loading * 100)}% load (most efficient band) and storing ${f0(-h.battery)} kW for the deficit expected at ${fmtTime(ms[t + 1 + deficitAt])}.`,
          reasons: [
            `${gs} would run at only ${f0(loadingNoCharge * 100)} % without charging; ${f0(h.loading * 100)} % with it`,
            `Deficit expected at ${fmtTime(ms[t + 1 + deficitAt])}: renewables ${f0(d.wind + d.pv)} kW vs load ${f0(d.load)} kW`,
            'Energy stored now avoids a second start or low-load running later',
          ],
          action: `Charge battery at ${f0(-h.battery)} kW (SOC ${f0(h.soc * 100)} %)`,
        });
      } else if (!h.on) {
        const top = Math.max(...ai.hours.slice(t, t + 12).map((a) => a.soc));
        ex.push({
          t,
          ms: ms[t],
          kind: 'battery',
          title: 'Storing surplus renewable energy',
          detail: `${f0(-h.battery)} kW of wind/solar surplus stored; battery will reach ${f0(top * 100)}%.`,
          reasons: [
            `Renewables ${f0(re)} kW exceed load ${f0(h.load)} kW by ${f0(re - h.load)} kW`,
            `Battery ${f0(h.soc * 100)} % → ${f0(top * 100)} % within 12 h`,
            'All gensets can stay off',
          ],
          action: `Charge battery at ${f0(-h.battery)} kW`,
        });
      }
    } else if (h.battery >= -5) charging = false;
    if (h.p2h > 8 && !p2hOn) {
      p2hOn = true;
      ex.push({
        t,
        ms: ms[t],
        kind: 'p2h',
        title: 'Surplus to heat (power-to-heat)',
        detail: `${f0(h.p2h)} kW of surplus electricity routed to the electric boiler instead of being curtailed - saves ~${f1(h.p2h / (st.boilerEff * DIESEL.LHV))} L/h of boiler oil.`,
        reasons: [
          `Surplus ${f0(h.p2h + h.curtail)} kW after battery charging (${f0(Math.max(0, -h.battery))} kW, SOC ${f0(h.soc * 100)} %)`,
          `Heat demand ${f0(h.heat)} kWth; electric boiler rated ${st.p2hKW} kW`,
          `Boiler oil saved ≈ ${f1(h.p2h / (st.boilerEff * DIESEL.LHV))} L/h`,
        ],
        action: `Route ${f0(h.p2h)} kW to the electric boiler`,
      });
    } else if (h.p2h < 3) p2hOn = false;
  });
  // demand response
  const seen = new Set<string>();
  for (const m of s.dr.moves) {
    if (!m.to.length || seen.has(m.job)) continue;
    const toOff = m.to.map((h) => h - s.now);
    const changed = m.to.some((h) => !m.from.includes(h));
    if (!changed) continue;
    seen.add(m.job);
    const t = Math.max(0, Math.min(s.H - 1, toOff[0]));
    const hm = (h: number) => fmtTime(s.nowMs + (h - s.now) * HOUR_MS);
    const surplus = m.to.map((h) => {
      const k = h - s.now;
      return k >= 0 && k < s.H ? s.wind[k] + s.pv[k] - s.planCrit[k] : 0;
    });
    ex.push({
      t,
      ms: ms[t],
      kind: 'dr',
      title: `Re-scheduled: ${m.job}`,
      detail: `Moved to ${m.to.length} renewable-surplus hours (${m.to.slice(0, 4).map(hm).join(', ')}${m.to.length > 4 ? ', ...' : ''}) instead of the fixed day-time slot.`,
      reasons: [
        `Fixed slot: ${m.from.slice(0, 4).map(hm).join(', ')}${m.from.length > 4 ? ' …' : ''}`,
        `Forecast renewable surplus in the new slot: up to ${f0(Math.max(0, ...surplus))} kW`,
        'Job is flexible (no crew-safety impact) and fits the same day',
      ],
      action: `Run ${m.job} at ${m.to.slice(0, 4).map(hm).join(', ')}${m.to.length > 4 ? ' …' : ''}`,
    });
  }
  ex.sort((a, b) => a.t - b.t);
  return ex;
}

// ------------------------------------------------------------------------------------------
// Fuel autonomy
// ------------------------------------------------------------------------------------------
const annualCache = new Map<string, AnnualResult>();
export function getAnnual(st: StationConfig, key = 'base'): AnnualResult {
  const k = st.id + ':' + key;
  let a = annualCache.get(k);
  if (!a) {
    a = annualProjection(st, getYear(st));
    annualCache.set(k, a);
  }
  return a;
}

/** Litres per day for a strategy, by calendar month. */
export function dailyFuelByMonth(a: AnnualResult, strat: 'ai' | 'rule' | 'diesel') {
  return a.months.map((m) => (m[strat].fuel * m.scale) / MONTH_DAYS[m.month]);
}

function monthOf(ms: number) {
  return new Date(ms).getUTCMonth();
}

export const REFERENCE_MS = Date.UTC(2026, 8, 29, 12); // reference date of the fuel-level entry

/** Resupply date on or after `ms` (the annual ship call repeats every year on the same day). */
export function nextResupply(st: StationConfig, ms: number) {
  const [yy, mm, dd] = st.fuel.nextResupply.split('-').map(Number);
  let t = Date.UTC(yy, mm - 1, dd);
  while (t < ms) t = Date.UTC(new Date(t).getUTCFullYear() + 1, mm - 1, dd);
  while (t - 365 * 86400000 > ms && t - 365 * 86400000 > REFERENCE_MS) t = Date.UTC(new Date(t).getUTCFullYear() - 1, mm - 1, dd);
  return t;
}

/** Fuel in the tanks at `ms`, assuming HimUrja operation since the reference date and refill at each ship call. */
export function fuelLevelAt(st: StationConfig, a: AnnualResult, ms: number) {
  const daily = dailyFuelByMonth(a, 'ai');
  let level = st.fuel.levelKL * 1000;
  let t = REFERENCE_MS;
  if (ms <= t) return level;
  let resup = nextResupply(st, t);
  while (t < ms) {
    const step = Math.min(86400000, ms - t);
    level -= (daily[monthOf(t)] * step) / 86400000;
    t += step;
    if (t >= resup) {
      level = st.fuel.tankKL * 1000 * 0.92;
      resup = nextResupply(st, t + 86400000);
    }
  }
  return level;
}

/** Day-by-day projection of tank level for each strategy from `fromMs` for `days`. */
export function fuelProjection(st: StationConfig, a: AnnualResult, fromMs: number, startLevelL: number, days: number) {
  const strat = ['diesel', 'rule', 'ai'] as const;
  const daily = Object.fromEntries(strat.map((s) => [s, dailyFuelByMonth(a, s)])) as Record<(typeof strat)[number], number[]>;
  const out = { ms: [] as number[], diesel: [] as number[], rule: [] as number[], ai: [] as number[] };
  const lv = { diesel: startLevelL, rule: startLevelL, ai: startLevelL };
  for (let d = 0; d <= days; d++) {
    const t = fromMs + d * 86400000;
    out.ms.push(t);
    for (const s of strat) {
      out[s].push(lv[s]);
      lv[s] -= daily[s][monthOf(t)];
    }
  }
  return out;
}

export { MONTH_START, crewOnDay };
