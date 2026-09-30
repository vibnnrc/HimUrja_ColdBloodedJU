// Station telemetry as it would really arrive: every channel can be late, drop out or
// send a bad value. The load channel then goes through the same validation and
// gap-filling that the forecaster uses in deployment, so the forecast is always fed
// clean, causal data even when meters misbehave.

import { StationConfig } from './stations';
import { getYear, appSeed } from './dataset';
import { mulberry32, gaussian, hashSeed } from './rng';

export type ChannelStatus = 0 | 1 | 2 | 3; // 0 ok, 1 delayed, 2 no data, 3 value rejected
export const STATUS_TEXT = ['ONLINE', 'DELAYED', 'NO DATA', 'REJECTED'] as const;

export interface Channel {
  id: string;
  name: string;
  signals: string;
  handling: string;
  status: Uint8Array; // per hour of the twin year
  latency: Uint16Array; // seconds, when delayed
  minute: Uint8Array; // minute of the hour the event started (for the log)
}

export interface Telemetry {
  channels: Channel[];
  /** feeder-meter reading of the critical load, NaN when missing (what SCADA receives) */
  measured: Float32Array;
  /** validated + gap-filled series actually fed to the load forecaster */
  clean: Float32Array;
  /** 1 where the clean value was gap-filled or a spike was replaced */
  filled: Uint8Array;
}

const wrap = (h: number) => ((h % 8760) + 8760) % 8760;

interface Spec {
  id: string;
  name: string;
  signals: string;
  handling: string;
  pLost: number;
  pDelay: number;
  pBad: number;
  weather: boolean; // comms degrade in blizzards (icing, snow on antennas)
}

function specs(st: StationConfig): Spec[] {
  return [
    { id: 'meter', name: 'Feeder energy meters', signals: 'station load kW, V, Hz', handling: 'range + spike check; gaps filled (level-adjusted same hour yesterday) before forecasting', pLost: 0.004, pDelay: 0.012, pBad: 0.004, weather: false },
    { id: 'met', name: 'Met mast', signals: 'wind 10 m, air temp, irradiance', handling: 'last valid value held; forecast runs on the weather model', pLost: 0.003, pDelay: 0.02, pBad: 0.002, weather: true },
    ...st.gens.map((g) => ({ id: g.id, name: `${g.name} controller`, signals: 'kW, fuel flow, coolant temp', handling: 'last value held; alarm if no data > 2 h', pLost: 0.0015, pDelay: 0.006, pBad: 0, weather: false })),
    { id: 'wtg', name: 'Wind turbine SCADA', signals: 'kW, rotor rpm, nacelle wind', handling: 'output estimated from met-mast wind + power curve', pLost: 0.003, pDelay: 0.012, pBad: 0, weather: true },
    { id: 'pv', name: 'PV inverters', signals: 'AC kW, DC V/A', handling: 'output estimated from irradiance model', pLost: 0.002, pDelay: 0.008, pBad: 0, weather: true },
    { id: 'bms', name: 'Battery BMS', signals: 'SOC, cell temps, kW', handling: 'SOC tracked by energy balance until BMS returns', pLost: 0.0012, pDelay: 0.005, pBad: 0, weather: false },
    { id: 'fuel', name: 'Fuel tank gauges', signals: 'tank level, temperature', handling: 'level estimated from metered genset fuel flow', pLost: 0.002, pDelay: 0.004, pBad: 0.003, weather: false },
  ];
}

const cache = new Map<string, Telemetry>();

export function getTelemetry(st: StationConfig): Telemetry {
  let t = cache.get(st.id);
  if (!t) {
    t = build(st);
    cache.set(st.id, t);
  }
  return t;
}

function build(st: StationConfig): Telemetry {
  const y = getYear(st);
  const seed = appSeed(st);
  const channels: Channel[] = specs(st).map((sp, k) => {
    const r = mulberry32(hashSeed(seed, 4099, k));
    const status = new Uint8Array(8760);
    const latency = new Uint16Array(8760);
    const minute = new Uint8Array(8760);
    let h = 0;
    while (h < 8760) {
      const m = sp.weather && y.wx.bliz[h] ? 4 : 1;
      const u = r();
      if (u < sp.pLost * m) {
        const len = 1 + Math.floor(r() * 3);
        const mi = Math.floor(r() * 60);
        for (let i = 0; i < len && h + i < 8760; i++) {
          status[h + i] = 2;
          minute[h + i] = i === 0 ? mi : 0;
        }
        h += len;
      } else if (u < (sp.pLost + sp.pDelay) * m) {
        const len = 1 + Math.floor(r() * 2);
        const lat = 30 + Math.floor(r() * 9) * 30; // 30 s .. 4.5 min
        const mi = Math.floor(r() * 60);
        for (let i = 0; i < len && h + i < 8760; i++) {
          status[h + i] = 1;
          latency[h + i] = lat;
          minute[h + i] = i === 0 ? mi : 0;
        }
        h += len;
      } else if (u < (sp.pLost + sp.pDelay + sp.pBad) * m) {
        status[h] = 3;
        minute[h] = Math.floor(r() * 60);
        h += 1;
      } else h += 1;
    }
    return { id: sp.id, name: sp.name, signals: sp.signals, handling: sp.handling, status, latency, minute };
  });

  // ---- load channel: measurement -> validation -> gap filling ----
  const meter = channels[0];
  const g = gaussian(mulberry32(hashSeed(seed, 4111)));
  const measured = new Float32Array(8760);
  for (let h = 0; h < 8760; h++) {
    const truth = y.dem.crit[h];
    const noisy = truth * (1 + 0.004 * g()); // class-0.5 meter
    measured[h] = meter.status[h] === 2 ? NaN : meter.status[h] === 3 ? (h % 2 ? truth * 1.9 : 0) : noisy;
  }
  const clean = new Float32Array(8760);
  const filled = new Uint8Array(8760);
  let lastH = 0;
  for (let h = 0; h < 8760; h++) {
    const v = measured[h];
    const prev = h ? clean[h - 1] : y.dem.crit[0];
    const valid = Number.isFinite(v) && v > 0.2 * prev && v < 1.6 * prev + 5; // range + rate-of-change check
    if (valid) {
      clean[h] = v;
      lastH = h;
    } else {
      // causal, level-adjusted seasonal fill: same hour yesterday shifted by the last observed offset
      const yest = h >= 24 ? clean[h - 24] : y.dem.crit[h];
      const off = lastH >= 24 ? clean[lastH] - clean[lastH - 24] : 0;
      clean[h] = Math.max(1, yest + off);
      filled[h] = 1;
    }
  }
  return { channels, measured, clean, filled };
}

export interface ChannelNow {
  id: string;
  name: string;
  signals: string;
  handling: string;
  status: ChannelStatus;
  latency: number;
  valid24: number; // share of the last 24 h with usable data
  events24: number;
}

/** Channel health at hour `now` (hour index in the twin year). */
export function channelsAt(t: Telemetry, now: number): ChannelNow[] {
  return t.channels.map((c) => {
    let ok = 0;
    let ev = 0;
    for (let i = 0; i < 24; i++) {
      const h = wrap(now - i);
      if (c.status[h] === 0 || c.status[h] === 1) ok++;
      if (c.status[h] !== 0 && (i === 23 || c.status[wrap(h - 1)] !== c.status[h])) ev++;
    }
    return { id: c.id, name: c.name, signals: c.signals, handling: c.handling, status: c.status[now] as ChannelStatus, latency: c.latency[now], valid24: ok / 24, events24: ev };
  });
}

/** How many forecast-input samples were repaired in the last `hours`. */
export function filledCount(t: Telemetry, now: number, hours: number) {
  let n = 0;
  for (let i = 1; i <= hours; i++) n += t.filled[wrap(now - i)];
  return n;
}
