// Smart load scheduler: moves deferrable loads (water plant / RO desalination, laundry, workshop)
// into the hours with the largest forecast renewable surplus, respecting each job's time window
// and daily energy requirement. Critical loads (life support, comms, medical, AGEOS) are never touched.

import { StationConfig } from '../sim/stations';
import { localHour, dayOfWeek } from '../sim/demand';
import { clamp } from '../sim/rng';

export interface Job {
  name: string;
  kw: number;
  hoursNeeded: number;
  windowStart: number; // local hour
  windowEnd: number; // local hour (exclusive)
  tier: 3;
}

export function jobsForDay(st: StationConfig, crew: number, dow: number): Job[] {
  const summerFrac = clamp((crew - st.crew.winter) / (st.crew.summerPeak - st.crew.winter), 0, 1);
  const jobs: Job[] = [
    {
      name: st.load.waterPlantName,
      kw: st.load.waterPlantKW,
      hoursNeeded: Math.round(4 + 6 * summerFrac),
      windowStart: 0,
      windowEnd: 24,
      tier: 3,
    },
  ];
  if (dow !== 0) jobs.push({ name: 'Laundry & workshop', kw: 7, hoursNeeded: 4, windowStart: 7, windowEnd: 21, tier: 3 });
  return jobs;
}

export interface ShiftResult {
  defer: number[];
  moves: { job: string; from: number[]; to: number[] }[];
}

/**
 * Re-schedule deferrable load for hours [start, start+H). `surplus[i]` is the forecast
 * renewable surplus (kW) for hour start+i. Days only partially inside the horizon keep
 * their baseline schedule (so we never break a job we can't see the end of).
 */
export function scheduleDeferrable(
  st: StationConfig,
  start: number,
  baselineDefer: number[],
  crewAt: (h: number) => number,
  surplus: number[],
): ShiftResult {
  const H = baselineDefer.length;
  const defer = baselineDefer.slice();
  const moves: ShiftResult['moves'] = [];
  // group horizon hours by local day
  const days = new Map<number, number[]>();
  for (let i = 0; i < H; i++) {
    const dayKey = Math.floor((start + i + st.lon / 15) / 24); // local-day index
    if (!days.has(dayKey)) days.set(dayKey, []);
    days.get(dayKey)!.push(i);
  }
  for (const idx of days.values()) {
    if (idx.length < 24) continue; // partial day: keep baseline
    const h0 = start + idx[0];
    const jobs = jobsForDay(st, crewAt(h0), dayOfWeek(h0));
    const newD = new Array(idx.length).fill(0);
    const avail = idx.map((i) => surplus[i]);
    for (const job of jobs) {
      const cand = idx
        .map((i, k) => ({ i, k, lh: localHour(st, start + i) }))
        .filter((o) => o.lh >= job.windowStart && o.lh < job.windowEnd)
        .sort((a, b) => avail[b.k] - avail[a.k]);
      const chosen = cand.slice(0, job.hoursNeeded);
      for (const o of chosen) {
        newD[o.k] += job.kw;
        avail[o.k] -= job.kw;
      }
      const baseHours = idx.filter((i) => {
        const lh = localHour(st, start + i);
        if (job.windowEnd === 24) return lh >= 8 && lh < 8 + job.hoursNeeded;
        return (lh >= 10 && lh < 12) || (lh >= 14 && lh < 16);
      });
      moves.push({ job: job.name, from: baseHours.map((i) => start + i), to: chosen.map((o) => start + o.i).sort((a, b) => a - b) });
    }
    idx.forEach((i, k) => (defer[i] = newD[k]));
  }
  return { defer, moves };
}
