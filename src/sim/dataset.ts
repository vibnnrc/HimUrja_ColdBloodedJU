// Builds the hourly "digital twin" year for a station and produces forecast weather
// (NWP-like forecasts whose error grows with lead time).

import { StationConfig } from './stations';
import { generateWeather, WeatherYear } from './weather';
import { generateDemand, DemandYear } from './demand';
import { hubWind, turbinePU, pvPU } from './assets';
import { sunPosition, planeOfArray } from './solar';
import { mulberry32, gaussian, hashSeed, clamp } from './rng';

export interface YearData {
  st: StationConfig;
  seed: number;
  wx: WeatherYear;
  dem: DemandYear;
  windPU: Float32Array; // per kW of installed wind
  pvPU: Float32Array; // per kWp of installed PV
}

export function windSeries(st: StationConfig, wind: ArrayLike<number>, temp: ArrayLike<number>, icing: ArrayLike<number>) {
  const out = new Float32Array(wind.length);
  let storm = false;
  for (let i = 0; i < wind.length; i++) {
    const v = hubWind(wind[i], st.wind.hubHeight);
    if (v > 25) storm = true;
    else if (storm && v < 20) storm = false;
    out[i] = turbinePU(v, temp[i], icing[i], storm);
  }
  return out;
}

export function buildYear(st: StationConfig, seed: number): YearData {
  const wx = generateWeather(st, seed);
  const dem = generateDemand(st, wx, seed);
  const windPU = windSeries(st, wx.wind, wx.temp, wx.icing);
  const pv = new Float32Array(8760);
  for (let h = 0; h < 8760; h++) pv[h] = pvPU(wx.poa[h], wx.temp[h], wx.snowPV[h]);
  return { st, seed, wx, dem, windPU, pvPU: pv };
}

/** Seed of the "live" year shown in the app (never used for model training). */
export const appSeed = (st: StationConfig) => st.seed * 7 + 2026;

const cache = new Map<string, YearData>();
export function getYear(st: StationConfig): YearData {
  const key = st.id;
  let y = cache.get(key);
  if (!y) {
    y = buildYear(st, appSeed(st));
    cache.set(key, y);
  }
  return y;
}

export interface WeatherForecast {
  origin: number;
  hours: number[]; // absolute hour indices
  temp: number[];
  wind: number[];
  cloud: number[];
  bliz: number[];
  windPU: number[];
  pvPU: number[];
}

const wrap = (h: number) => ((h % 8760) + 8760) % 8760;

/** NWP-style forecast from `origin` for H hours. Errors are AR(1) along lead time and grow with lead. */
export function weatherForecast(y: YearData, origin: number, H: number): WeatherForecast {
  const g = gaussian(mulberry32(hashSeed(y.seed, origin, 77)));
  const st = y.st;
  const f: WeatherForecast = { origin, hours: [], temp: [], wind: [], cloud: [], bliz: [], windPU: [], pvPU: [] };
  let eT = 0,
    eW = 0,
    eC = 0;
  const rho = 0.9;
  const icing0 = y.wx.icing[wrap(origin)];
  for (let k = 1; k <= H; k++) {
    const h = wrap(origin + k - 1);
    eT = rho * eT + Math.sqrt(1 - rho * rho) * g();
    eW = rho * eW + Math.sqrt(1 - rho * rho) * g();
    eC = rho * eC + Math.sqrt(1 - rho * rho) * g();
    const vA = y.wx.wind[h];
    const temp = y.wx.temp[h] + eT * (0.6 + 0.045 * k);
    const wind = Math.max(0.2, vA + eW * (0.5 + 0.06 * k) * (1 + vA / 15));
    const cloud = clamp(y.wx.cloud[h] + eC * (0.08 + 0.006 * k), 0, 1);
    f.hours.push(h);
    f.temp.push(temp);
    f.wind.push(wind);
    f.cloud.push(cloud);
    f.bliz.push(wind > 17 ? 1 : 0);
  }
  // renewable forecast from forecast weather through the same physical models
  const icingFc = f.hours.map((_, i) => icing0 * Math.exp(-i / 10));
  f.windPU = Array.from(windSeries(st, f.wind, f.temp, icingFc));
  f.pvPU = f.hours.map((h, i) => {
    const doy = Math.floor(h / 24) + 1;
    const sun = sunPosition(st.lat, st.lon, doy, (h % 24) + 0.5);
    const irr = planeOfArray(sun.elevation, sun.azimuth, f.cloud[i], st.pv.tilt);
    return pvPU(irr.poa, f.temp[i], y.wx.snowPV[h] * Math.exp(-i / 6));
  });
  return f;
}
