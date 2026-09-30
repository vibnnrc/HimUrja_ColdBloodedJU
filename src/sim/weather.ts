// Stochastic polar weather generator: seasonal "coreless winter" temperature,
// katabatic wind with synoptic variability, blizzard events, cloud, sun geometry,
// turbine icing and snow on PV. Produces one hourly year (8760 h).

import { StationConfig } from './stations';
import { mulberry32, gaussian, clamp } from './rng';
import { sunPosition, planeOfArray } from './solar';

export interface WeatherYear {
  temp: Float32Array; // deg C
  wind: Float32Array; // 10 m wind, m/s
  cloud: Float32Array; // 0..1
  bliz: Uint8Array; // blizzard flag
  elev: Float32Array; // sun elevation, deg
  ghi: Float32Array; // W/m2
  poa: Float32Array; // plane-of-array irradiance on the PV array, W/m2
  icing: Float32Array; // 0..1 turbine icing loss
  snowPV: Float32Array; // 0..1 fraction of PV output lost to snow cover
}

/** Season weight: 0 in mid-summer, 1 on the long flat "coreless" winter plateau. */
export function winterWeight(doy: number) {
  const raw = (1 - Math.cos((2 * Math.PI * (doy - 5)) / 365)) / 2;
  const w = clamp(raw * 1.4, 0, 1);
  return w * w * (3 - 2 * w);
}

export function generateWeather(st: StationConfig, seed: number): WeatherYear {
  const N = 8760;
  const rand = mulberry32(seed);
  const g = gaussian(rand);
  const out: WeatherYear = {
    temp: new Float32Array(N),
    wind: new Float32Array(N),
    cloud: new Float32Array(N),
    bliz: new Uint8Array(N),
    elev: new Float32Array(N),
    ghi: new Float32Array(N),
    poa: new Float32Array(N),
    icing: new Float32Array(N),
    snowPV: new Float32Array(N),
  };
  const phiT = Math.exp(-1 / 48);
  const phiW = Math.exp(-1 / 18);
  const phiC = Math.exp(-1 / 24);
  let zT = 0,
    zW = 0,
    zC = 0;
  // blizzard state
  let blizLeft = 0,
    blizDur = 0,
    blizPeak = 0;
  let icing = 0,
    snow = 0;
  const c = st.climate;
  const lat = (st.lat * Math.PI) / 180;

  for (let h = 0; h < N; h++) {
    const doy = Math.floor(h / 24) + 1;
    const hourUTC = (h % 24) + 0.5;
    const w = winterWeight(doy);
    const sun = sunPosition(st.lat, st.lon, doy, hourUTC);
    const decl = (sun.declination * Math.PI) / 180;
    const sinE = Math.sin((sun.elevation * Math.PI) / 180);
    const meanSinE = Math.sin(lat) * Math.sin(decl);

    // --- blizzard events (Poisson arrivals, more frequent in winter) ---
    if (blizLeft <= 0) {
      const perMonth = c.blizzardsPerMonthSummer + (c.blizzardsPerMonthWinter - c.blizzardsPerMonthSummer) * w;
      if (rand() < perMonth / 720) {
        blizDur = Math.round(10 + 44 * Math.pow(rand(), 1.8)); // storm systems of 10-54 h, mean ~25 h (Lal & Ram 2009)
        blizLeft = blizDur;
        blizPeak = 21 + 13 * rand();
      }
    }
    let blizWind = 0;
    if (blizLeft > 0) {
      const p = 1 - blizLeft / blizDur; // progress 0..1
      const shape = p < 0.2 ? p / 0.2 : p > 0.8 ? (1 - p) / 0.2 : 1;
      blizWind = blizPeak * (0.55 + 0.45 * shape);
      blizLeft--;
    }

    // --- temperature ---
    zT = phiT * zT + Math.sqrt(1 - phiT * phiT) * g();
    const tSeason = c.tSummer - (c.tSummer - c.tWinter) * w;
    const diurnal = 3.2 * (sinE - meanSinE) * (1 - 0.4 * w);
    let temp = tSeason + diurnal + (2.5 + 3.5 * w) * zT;
    if (blizWind > 0) temp += 4.0; // warm advection during storms

    // --- wind ---
    zW = phiW * zW + Math.sqrt(1 - phiW * phiW) * g();
    const mu = c.windSummer + (c.windWinter - c.windSummer) * w;
    const localHour = (hourUTC + st.lon / 15 + 24) % 24;
    const katabatic = 1.1 * (1 - 0.6 * w) * Math.cos((2 * Math.PI * (localHour - 5)) / 24);
    let wind = Math.max(0.2, mu + 0.5 * mu * zW + katabatic);
    let bliz = 0;
    if (blizWind > 0) {
      wind = Math.max(wind, blizWind + 1.5 * g());
      if (wind > 17) bliz = 1;
    }

    // --- cloud ---
    zC = phiC * zC + Math.sqrt(1 - phiC * phiC) * g();
    let cloud = clamp(c.cloudMean + 0.38 * zC, 0, 1);
    if (blizWind > 0) cloud = 1;

    // --- solar ---
    const irr = planeOfArray(sun.elevation, sun.azimuth, cloud, st.pv.tilt);

    // --- turbine icing (rime/glaze forms in cloud/fog at moderately low temperature) ---
    if (!bliz && temp > -15 && temp < -1 && cloud > 0.8 && wind < 14) icing = Math.min(0.55, icing + 0.06);
    else icing = Math.max(0, icing - (sun.elevation > 5 ? 0.12 : 0.06));

    // --- snow on PV (steep panels shed snow fast, faster in sunshine) ---
    if (bliz) snow = 0.9;
    else snow = snow * (sun.elevation > 3 ? 0.72 : 0.88);

    out.temp[h] = temp;
    out.wind[h] = wind;
    out.cloud[h] = cloud;
    out.bliz[h] = bliz;
    out.elev[h] = sun.elevation;
    out.ghi[h] = irr.ghi;
    out.poa[h] = irr.poa;
    out.icing[h] = icing;
    out.snowPV[h] = snow;
  }
  return out;
}
