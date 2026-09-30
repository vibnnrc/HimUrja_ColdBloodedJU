// Station demand model: electrical (critical + deferrable) and thermal demand,
// driven by crew occupancy, human activity cycles, weather and science operations.

import { StationConfig } from './stations';
import { WeatherYear, winterWeight } from './weather';
import { mulberry32, gaussian, clamp } from './rng';

// Relative activity by local hour (galley peaks, work day, recreation, night).
export const ACTIVITY = [
  0.55, 0.52, 0.5, 0.5, 0.52, 0.6, 0.8, 1.15, 1.25, 1.05, 1.0, 1.05, 1.3, 1.2, 1.0, 1.0, 1.0, 1.1, 1.35, 1.4, 1.25, 1.0,
  0.8, 0.65,
];

export const YEAR_START_DOW = 4; // 1 Jan 2026 is a Thursday (0 = Sunday)

export function crewOnDay(st: StationConfig, doy: number): number {
  const c = st.crew;
  const lin = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);
  if (doy >= c.peakStart || doy <= c.peakEnd) return c.summerPeak;
  if (doy > c.peakEnd && doy < c.winterStart)
    return Math.round(lin(c.summerPeak, c.winter, (doy - c.peakEnd) / (c.winterStart - c.peakEnd)));
  if (doy >= c.rampUpStart && doy < c.peakStart)
    return Math.round(lin(c.winter, c.summerPeak, (doy - c.rampUpStart) / (c.peakStart - c.rampUpStart)));
  return c.winter;
}

export function localHour(st: StationConfig, hourIndex: number) {
  return Math.floor(((hourIndex % 24) + st.lon / 15 + 24) % 24);
}

export function dayOfWeek(hourIndex: number) {
  return (YEAR_START_DOW + Math.floor(hourIndex / 24)) % 7;
}

/** Thermal demand of the station (kW_th) for a given outdoor state. Physics-based (UA model + wind infiltration). */
export function heatDemand(st: StationConfig, temp: number, wind: number, crew: number) {
  const tEff = temp - 0.3 * wind; // wind-driven infiltration / convective loss
  return st.building.UA * Math.max(0, st.building.tIn - tEff) + 0.4 * crew + st.building.fixedHeat;
}

/** Baseline (conventional) schedule of deferrable loads, kW, for a given hour. */
export function deferrableBaseline(st: StationConfig, hourIndex: number, crew: number) {
  const lh = localHour(st, hourIndex);
  const dow = dayOfWeek(hourIndex);
  const summerFrac = clamp((crew - st.crew.winter) / (st.crew.summerPeak - st.crew.winter), 0, 1);
  const waterHours = Math.round(4 + 6 * summerFrac);
  let p = 0;
  if (lh >= 8 && lh < 8 + waterHours) p += st.load.waterPlantKW;
  if (dow !== 0 && ((lh >= 10 && lh < 12) || (lh >= 14 && lh < 16))) p += 7; // laundry + workshop
  return p;
}

export interface DemandYear {
  crew: Uint8Array;
  crit: Float32Array; // non-deferrable electrical load, kW
  defer: Float32Array; // deferrable electrical load at baseline schedule, kW
  heat: Float32Array; // thermal demand, kW_th
}

export function generateDemand(st: StationConfig, wx: WeatherYear, seed: number): DemandYear {
  const N = 8760;
  const g = gaussian(mulberry32(seed ^ 0x5bd1e995));
  const out: DemandYear = {
    crew: new Uint8Array(N),
    crit: new Float32Array(N),
    defer: new Float32Array(N),
    heat: new Float32Array(N),
  };
  const phi = Math.exp(-1 / 3);
  let z = 0;
  for (let h = 0; h < N; h++) {
    const doy = Math.floor(h / 24) + 1;
    const w = winterWeight(doy);
    const crew = crewOnDay(st, doy);
    const lh = localHour(st, h);
    const dow = dayOfWeek(h);
    const heat = heatDemand(st, wx.temp[h], wx.wind[h], crew);
    const darkness = clamp((3 - wx.elev[h]) / 6, 0, 1);
    const L = st.load;
    let crit =
      L.base +
      L.science * (1 + 0.3 * (1 - w)) +
      crew * L.perCrew * ACTIVITY[lh] * (dow === 0 ? 0.92 : 1) +
      crew * 0.12 * darkness +
      0.07 * heat +
      L.traceHeatPerK * Math.max(0, -wx.temp[h]);
    if (L.ageos) {
      // Earth-observation satellite passes (sun-synchronous orbits -> similar local times daily)
      if (lh === 10 || lh === 22) crit += 7;
      else if (lh === 11 || lh === 23) crit += 3.5;
    }
    if (wx.bliz[h]) crit += 4; // snow-drift clearing fans, extra heating of vestibules
    z = phi * z + Math.sqrt(1 - phi * phi) * g();
    crit *= 1 + 0.035 * z;
    out.crew[h] = crew;
    out.crit[h] = crit;
    out.defer[h] = deferrableBaseline(st, h, crew);
    out.heat[h] = heat;
  }
  return out;
}
