// Feature engineering for the load-forecasting model. The SAME function is used to
// build the training set (scripts/export-dataset.ts -> ml/train.py) and at inference
// time in the browser, so training and serving can never drift apart.

import { YearData, WeatherForecast } from '../sim/dataset';
import { localHour, dayOfWeek } from '../sim/demand';
import { clamp } from '../sim/rng';

export const FEATURES = [
  'station',
  'hour_sin',
  'hour_cos',
  'doy_sin',
  'doy_cos',
  'sunday',
  'crew',
  'temp_fc',
  'wind_fc',
  'darkness',
  'lag48',
  'lag168',
  'recent24',
  'lead',
  'blizzard_fc',
  'local_hour',
] as const;

const wrap = (h: number) => ((h % 8760) + 8760) % 8760;

export type LoadSeries = ArrayLike<number>;

/** Mean of the 24 h before `origin`. `src` = measured-and-cleaned load in operation (default: the twin's ground truth, used for training). */
export function recentMean(y: YearData, origin: number, src: LoadSeries = y.dem.crit) {
  let s = 0;
  for (let i = 1; i <= 24; i++) s += src[wrap(origin - i)];
  return s / 24;
}

/** Feature vector for target hour `t` forecast from `origin` (lead = t - origin + 1). */
export function featureRow(
  y: YearData,
  t: number,
  lead: number,
  tempFc: number,
  windFc: number,
  blizFc: number,
  recent24: number,
  src: LoadSeries = y.dem.crit,
): number[] {
  const h = wrap(t);
  const lh = localHour(y.st, h);
  const doy = Math.floor(h / 24) + 1;
  return [
    y.st.id === 'bharati' ? 1 : 0,
    Math.sin((2 * Math.PI * lh) / 24),
    Math.cos((2 * Math.PI * lh) / 24),
    Math.sin((2 * Math.PI * doy) / 365),
    Math.cos((2 * Math.PI * doy) / 365),
    dayOfWeek(h) === 0 ? 1 : 0,
    y.dem.crew[h],
    tempFc,
    windFc,
    clamp((3 - y.wx.elev[h]) / 6, 0, 1),
    src[wrap(h - 48)],
    src[wrap(h - 168)],
    recent24,
    lead,
    blizFc,
    lh,
  ];
}

export function forecastFeatures(y: YearData, fc: WeatherForecast, src: LoadSeries = y.dem.crit) {
  const r24 = recentMean(y, fc.origin, src);
  return fc.hours.map((h, i) => featureRow(y, h, i + 1, fc.temp[i], fc.wind[i], fc.bliz[i], r24, src));
}
