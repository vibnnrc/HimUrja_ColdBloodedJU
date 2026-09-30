// In-browser / edge inference of the gradient-boosted load model + conformal intervals.
import model from './model.json';
import { YearData, WeatherForecast } from '../sim/dataset';
import { forecastFeatures, LoadSeries } from './features';

interface ModelJSON {
  version: string;
  features: string[];
  depth: number;
  lr: number;
  init: number;
  trees: [number[], number[], number[]][];
  conformal: { lo: number; hi: number; q10: number; q90: number; q02: number; q98: number }[];
  metrics: {
    data: string;
    test_rows: number;
    coverage_80: number;
    stations: Record<
      string,
      {
        mape_model: number;
        mae_model: number;
        rmse_model: number;
        bias_model: number;
        p95_abs_err: number;
        mean_load: number;
        mae_seasonal_naive: number;
        rmse_seasonal_naive: number;
        mape_seasonal_naive: number;
        mape_persistence48: number;
        mape_recent_mean: number;
      }
    >;
    error_hist: { edges: number[]; counts: number[] };
    by_lead: { lead: string; mape: number }[];
    importance: { feature: string; value: number }[];
  };
}

export const MODEL = model as unknown as ModelJSON;
const NINT = (1 << MODEL.depth) - 1;

export function predict(x: number[]): number {
  let s = MODEL.init;
  const D = MODEL.depth;
  for (const [f, th, lv] of MODEL.trees) {
    let pos = 0;
    for (let d = 0; d < D; d++) pos = x[f[pos]] <= th[pos] ? 2 * pos + 1 : 2 * pos + 2;
    s += MODEL.lr * lv[pos - NINT];
  }
  return s;
}

export interface LoadForecast {
  p10: number[];
  p50: number[];
  p90: number[];
  p02: number[];
  p98: number[];
}

function bucket(lead: number) {
  return MODEL.conformal.find((b) => lead >= b.lo && lead <= b.hi) ?? MODEL.conformal[MODEL.conformal.length - 1];
}

/** Probabilistic forecast of the critical (non-deferrable) electrical load. */
export function forecastLoad(y: YearData, fc: WeatherForecast, src?: LoadSeries): LoadForecast {
  const X = forecastFeatures(y, fc, src);
  const out: LoadForecast = { p10: [], p50: [], p90: [], p02: [], p98: [] };
  X.forEach((x, i) => {
    const lead = Math.min(48, i + 1);
    x[13] = lead; // model trained on leads 1..48
    if (i >= 48) x[10] = out.p50[i - 48]; // recursive multi-step: lag-48 is itself a forecast (no look-ahead)
    const p = predict(x);
    const b = bucket(lead);
    const widen = i >= 48 ? Math.sqrt((i + 1) / 48) : 1; // beyond 48 h (weekly outlook) widen intervals
    out.p50.push(p);
    out.p10.push(p + b.q10 * widen);
    out.p90.push(p + b.q90 * widen);
    out.p02.push(p + b.q02 * widen);
    out.p98.push(p + b.q98 * widen);
  });
  return out;
}
