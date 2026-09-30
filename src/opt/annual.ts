// Annual energy & fuel projection using 12 representative weeks (one per month),
// the same methodology used by microgrid planning tools. Every strategy is run on
// identical weather and demand so the comparison is fair.

import { StationConfig } from '../sim/stations';
import { YearData } from '../sim/dataset';
import { optimizeAI, conventional, reserveProfile, Totals, DispatchInput } from './dispatch';
import { scheduleDeferrable } from './demandResponse';

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_START = MONTH_DAYS.reduce<number[]>((a, d, i) => (a.push(i ? a[i - 1] + MONTH_DAYS[i - 1] : 0), a), []);
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthResult {
  month: number;
  diesel: Totals;
  rule: Totals;
  ai: Totals;
  today: Totals; // HimUrja on today's plant (gensets only, no wind / PV / battery)
  scale: number;
  loadKWh: number;
  windKWh: number;
  pvKWh: number;
}

export interface AnnualResult {
  months: MonthResult[];
  diesel: Totals;
  rule: Totals;
  ai: Totals;
  today: Totals;
}

/** The station as it is today: gensets only (no wind, PV, battery or electric boiler). */
export const todayPlant = (st: StationConfig): StationConfig => ({
  ...st,
  wind: { ...st.wind, units: 0 },
  pv: { ...st.pv, kWp: 0 },
  battery: { ...st.battery, kWh: 0, kW: 0 },
  p2hKW: 0,
});

const zeroT = (): Totals => ({
  fuel: 0,
  fuelGen: 0,
  fuelBoiler: 0,
  genHours: 0,
  starts: 0,
  lowLoadHours: 0,
  curtailKWh: 0,
  reKWh: 0,
  loadKWh: 0,
  p2hKWh: 0,
  unservedKWh: 0,
  co2t: 0,
  renewableShare: 0,
  batteryThroughput: 0,
});

function addScaled(a: Totals, b: Totals, s: number) {
  for (const k of Object.keys(a) as (keyof Totals)[]) if (k !== 'renewableShare') a[k] += b[k] * s;
}

export interface ProjectionOpts {
  winterDelta?: number;
  months?: number[]; // subset of representative months (weights are redistributed)
  socLevels?: number;
  aiOnly?: boolean;
}

export function annualProjection(st: StationConfig, y: YearData, crewOverride?: { winterDelta: number }, opts: ProjectionOpts = {}): AnnualResult {
  const months: MonthResult[] = [];
  const tot = { diesel: zeroT(), rule: zeroT(), ai: zeroT(), today: zeroT() };
  const windKW = st.wind.units * st.wind.unitKW;
  const monthsToRun = opts.months ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  for (const m of monthsToRun) {
    const start = (MONTH_START[m] + 9) * 24; // representative week starts on the 10th
    const H = 168;
    const idx = Array.from({ length: H }, (_, i) => start + i);
    const extraCrew = (h: number) => (crewOverride && y.dem.crew[h] <= st.crew.winter + 2 ? crewOverride.winterDelta : 0);
    const crit = idx.map((h) => y.dem.crit[h] + extraCrew(h) * st.load.perCrew);
    const deferBase = idx.map((h) => y.dem.defer[h]);
    const heat = idx.map((h) => y.dem.heat[h] + 0.4 * extraCrew(h));
    const wind = idx.map((h) => y.windPU[h] * windKW);
    const pv = idx.map((h) => y.pvPU[h] * st.pv.kWp);
    const bliz = idx.map((h) => y.wx.bliz[h]);
    const baseLoad = crit.map((c, i) => c + deferBase[i]);
    const common: DispatchInput = { st, load: baseLoad, heat, wind, pv, soc0: 0.6 };
    const diesel = opts.aiOnly ? null : conventional({ ...common }, false);
    const rule = opts.aiOnly ? null : conventional({ ...common }, true);
    // AI: smart load scheduling first, then optimal dispatch
    const surplus = crit.map((c, i) => wind[i] + pv[i] - c);
    const dr = scheduleDeferrable(st, start, deferBase, (h) => y.dem.crew[h] + extraCrew(h), surplus);
    const aiLoad = crit.map((c, i) => c + dr.defer[i]);
    const reserve = reserveProfile(aiLoad, aiLoad.map((l) => l * 1.08), wind, pv, bliz);
    const ai = optimizeAI({ ...common, load: aiLoad, reserve, socLevels: opts.socLevels ?? 21 });
    // HimUrja on today's plant: same controller, gensets only
    let today: ReturnType<typeof optimizeAI> | null = null;
    if (!opts.aiOnly) {
      // no flexible-load shifting here: without surplus renewables, moving jobs into night valleys
      // can push the load over a one-genset threshold, so today's schedule is kept
      const zero = idx.map(() => 0);
      const tLoad = baseLoad;
      const tRes = reserveProfile(tLoad, tLoad.map((l) => l * 1.08), zero, zero, bliz);
      today = optimizeAI({ st: todayPlant(st), load: tLoad, heat, wind: zero, pv: zero, soc0: 0, reserve: tRes, socLevels: 1 });
    }
    // weight: days represented by this week (if only a subset of months is simulated, spread the year over them)
    const scale = opts.months ? 365 / 7 / monthsToRun.length : MONTH_DAYS[m] / 7;
    const loadKWh = baseLoad.reduce((a, b) => a + b, 0) * scale;
    months.push({
      month: m,
      diesel: diesel ? diesel.totals : zeroT(),
      rule: rule ? rule.totals : zeroT(),
      ai: ai.totals,
      today: today ? today.totals : zeroT(),
      scale,
      loadKWh,
      windKWh: wind.reduce((a, b) => a + b, 0) * scale,
      pvKWh: pv.reduce((a, b) => a + b, 0) * scale,
    });
    if (diesel) addScaled(tot.diesel, diesel.totals, scale);
    if (rule) addScaled(tot.rule, rule.totals, scale);
    addScaled(tot.ai, ai.totals, scale);
    if (today) addScaled(tot.today, today.totals, scale);
  }
  for (const t of Object.values(tot)) t.renewableShare = t.loadKWh ? Math.min(1, t.reKWh / t.loadKWh) : 0;
  return { months, ...tot };
}
