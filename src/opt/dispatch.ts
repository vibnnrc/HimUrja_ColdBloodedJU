// HimUrja dispatch engine.
//
//  * optimizeAI   - exact dynamic-programming unit commitment + battery + power-to-heat
//                   co-optimisation over a rolling horizon (state = battery SOC x genset set in the last two hours).
//                   Objective = diesel (gensets + oil boiler) + maintenance-equivalent litres,
//                   subject to power balance, genset minimum load, minimum up/down time, battery SOC and power
//                   limits, spinning reserve sized by the forecast band, and N-1 security (largest running unit trips).
//  * conventional - today's practice: gensets committed with a fixed 30 % spinning margin over the load.
//  * ruleHybrid   - renewables + battery with simple rule-based control (no forecasting, no optimisation).
//
// All strategies share the same physical/fuel models so comparisons are apples-to-apples,
// including the thermal side (less genset running = less recovered waste heat = more boiler oil).

import { StationConfig, DIESEL } from '../sim/stations';

export const COSTS = {
  START_L: 6, // litre-equivalent per genset start (warm-up fuel + start wear)
  RUNHOUR_L: 0.5, // maintenance cost per running hour, litre-equivalent
  LOWLOAD_L: 1.0, // penalty per hour per unit loaded below 40% (wet stacking / carbon build-up)
  BATT_WEAR_L_PER_KWH: 0.012, // battery degradation, litre-equivalent per kWh throughput
  SOC_TERMINAL_L_PER_KWH: 0.3, // value of energy left in the battery at the end of the horizon
  UNSERVED_L_PER_KWH: 1000,
};

export interface DispatchInput {
  st: StationConfig;
  load: number[]; // kW electrical to be served
  heat: number[]; // kW thermal
  wind: number[]; // kW available from wind
  pv: number[]; // kW available from PV
  reserve?: number[]; // kW spinning-reserve requirement (AI strategy)
  soc0: number; // initial state of charge 0..1
  prevOn?: number; // bitmask of gensets running in the hour before the horizon
  prevOn2?: number; // ... and two hours before (for minimum up/down time)
  outage?: number[]; // per-hour bitmask of gensets unavailable
  socLevels?: number;
  blizzard?: number[];
}

export interface HourResult {
  on: number;
  pg: number; // total genset output kW
  unitPg: number[];
  battery: number; // + discharge, - charge (kW, AC side)
  soc: number; // end-of-hour SOC 0..1
  reUsed: number;
  curtail: number;
  p2h: number;
  recHeat: number;
  boilerHeat: number;
  fuelGen: number;
  fuelBoiler: number;
  unserved: number;
  loading: number; // genset loading fraction
  load: number;
  wind: number;
  pv: number;
  heat: number;
}

export interface Totals {
  fuel: number;
  fuelGen: number;
  fuelBoiler: number;
  genHours: number;
  starts: number;
  lowLoadHours: number;
  curtailKWh: number;
  reKWh: number;
  loadKWh: number;
  p2hKWh: number;
  unservedKWh: number;
  co2t: number;
  renewableShare: number;
  batteryThroughput: number;
}

export interface DispatchResult {
  strategy: 'ai' | 'conventional' | 'rule' | 'diesel';
  hours: HourResult[];
  totals: Totals;
}

const popcount = (x: number) => {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
};

function comboTables(st: StationConfig) {
  const n = st.gens.length;
  const M = 1 << n;
  const cap = new Float64Array(M),
    min = new Float64Array(M),
    f0 = new Float64Array(M),
    largest = new Float64Array(M),
    nOn = new Int32Array(M);
  for (let c = 0; c < M; c++) {
    for (let u = 0; u < n; u++)
      if (c & (1 << u)) {
        const g = st.gens[u];
        cap[c] += g.rated;
        min[c] += g.minFrac * g.rated;
        f0[c] += DIESEL.F0 * g.rated;
        largest[c] = Math.max(largest[c], g.rated);
        nOn[c]++;
      }
  }
  return { n, M, cap, min, f0, largest, nOn };
}

export function summarize(hours: HourResult[], st: StationConfig): Totals {
  const t: Totals = {
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
  };
  let prev = -1;
  for (const h of hours) {
    t.fuelGen += h.fuelGen;
    t.fuelBoiler += h.fuelBoiler;
    t.genHours += popcount(h.on);
    if (prev >= 0) t.starts += popcount(h.on & ~prev);
    prev = h.on;
    if (h.on && h.loading < 0.4) t.lowLoadHours += popcount(h.on);
    t.curtailKWh += h.curtail;
    t.reKWh += h.reUsed;
    t.loadKWh += h.load;
    t.p2hKWh += h.p2h;
    t.unservedKWh += h.unserved;
    t.batteryThroughput += Math.abs(h.battery);
  }
  t.fuel = t.fuelGen + t.fuelBoiler;
  t.co2t = (t.fuel * st.fuel.co2PerL) / 1000;
  t.renewableShare = t.loadKWh > 0 ? Math.min(1, t.reKWh / t.loadKWh) : 0;
  return t;
}

/** Evaluate one hour given genset combo and battery power; shared by all strategies. */
function settleHour(
  st: StationConfig,
  tb: ReturnType<typeof comboTables>,
  c: number,
  pg: number,
  battery: number,
  soc: number,
  L: number,
  H: number,
  W: number,
  S: number,
  unserved: number,
): HourResult {
  const RE = W + S;
  // power balance: pg + reUsed + battery = L - unserved + p2h(from surplus) ; surplus split into p2h & curtail
  const surplus = Math.max(0, pg + RE + battery - (L - unserved));
  const reUsed = RE - Math.min(RE, surplus);
  const rec = st.heatRecovery * pg;
  const heatRem = Math.max(0, H - rec);
  const p2h = Math.min(surplus, st.p2hKW, heatRem);
  const curtail = surplus - p2h;
  const boilerHeat = heatRem - p2h;
  const fuelGen = c ? tb.f0[c] + DIESEL.F1 * pg : 0;
  const fuelBoiler = boilerHeat / (st.boilerEff * DIESEL.LHV);
  const unitPg = st.gens.map((g, u) => (c & (1 << u) ? (pg * g.rated) / tb.cap[c] : 0));
  return {
    on: c,
    pg,
    unitPg,
    battery,
    soc,
    reUsed: Math.max(0, reUsed),
    curtail,
    p2h,
    recHeat: Math.min(rec, H),
    boilerHeat,
    fuelGen,
    fuelBoiler,
    unserved,
    loading: c ? pg / tb.cap[c] : 0,
    load: L,
    wind: W,
    pv: S,
    heat: H,
  };
}

// ---------------------------------------------------------------------------------------------
// AI: dynamic programming over (SOC level, genset combo 2 h ago, genset combo last hour)
// ---------------------------------------------------------------------------------------------
// Carrying the last two commitment decisions in the state lets the DP enforce each unit's
// minimum up-time and minimum down-time of MIN_UPDOWN_H = 2 h exactly: a unit started last hour
// must keep running, a unit stopped last hour must stay off. These are relaxed only if nothing
// else can hold the load (e.g. a genset trip), at a heavy penalty, so the plan never dead-ends.
export const MIN_UPDOWN_H = 2;
const UPDOWN_VIOLATION_L = 150;

export function optimizeAI(inp: DispatchInput): DispatchResult {
  const { st } = inp;
  const T = inp.load.length;
  const tb = comboTables(st);
  const B = st.battery;
  const hasBatt = B.kWh > 1 && B.kW > 1;
  const nS = hasBatt ? inp.socLevels ?? 31 : 1;
  const Emin = hasBatt ? B.socMin * B.kWh : 0;
  const Emax = hasBatt ? B.socMax * B.kWh : 0;
  const dE = nS > 1 ? (Emax - Emin) / (nS - 1) : 0;
  const Elev = (i: number) => Emin + i * dE;
  const maxUp = hasBatt ? Math.floor((B.kW * B.etaC) / dE + 1e-9) : 0;
  const maxDn = hasBatt ? Math.floor(B.kW / B.etaD / dE + 1e-9) : 0;
  const soc0 = Math.min(B.socMax, Math.max(B.socMin, inp.soc0));
  const i0 = hasBatt ? Math.round((soc0 * B.kWh - Emin) / dE) : 0;
  const battN1 = (Ei: number, Ej: number) => (hasBatt ? Math.min(B.kW, (Math.min(Ei, Ej) - Emin) * B.etaD * 4) : 0);
  const M = tb.M;
  const MM = M * M;
  const INF = 1e18;

  // state index: (i * M + p) * M + q   with p = combo two hours ago, q = combo last hour
  let cost = new Float64Array(nS * MM).fill(INF);
  const prevOn = inp.prevOn ?? 0;
  const prevOn2 = inp.prevOn2 ?? prevOn;
  cost[(i0 * M + prevOn2) * M + prevOn] = 0;
  // back-pointers (per hour, per end state): SOC level and combo two hours before
  const bpI = new Int16Array(T * nS * MM);
  const bpP = new Uint8Array(T * nS * MM);
  const startCost = new Float64Array(MM);
  for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) startCost[a * M + b] = popcount(b & ~a) * COSTS.START_L;

  const POP = new Uint8Array(M);
  for (let x = 0; x < M; x++) POP[x] = popcount(x);
  const best = new Float64Array(nS * MM); // min over p, per (i, q, c)
  const bestP = new Uint8Array(nS * MM);
  const stage = new Float64Array(nS); // stage cost of (c, i, j) for the current i, indexed by j
  const okJ = new Int16Array(nS); // the feasible j for the current (c, i)

  for (let t = 0; t < T; t++) {
    const L = inp.load[t],
      H = inp.heat[t],
      W = inp.wind[t],
      S = inp.pv[t];
    const RE = W + S;
    const Rq = Math.max((CONV_MARGIN - 1) * L, inp.reserve ? inp.reserve[t] : 0);
    const out = inp.outage ? inp.outage[t] : 0;
    let allAvail = 0;
    for (let u = 0; u < tb.n; u++) if (!(out & (1 << u))) allAvail |= 1 << u;
    // collapse the "two hours ago" dimension; start cost and min up/down time act here
    best.fill(INF);
    for (let i = 0; i < nS; i++)
      for (let q = 0; q < M; q++)
        for (let p = 0; p < M; p++) {
          const v = cost[(i * M + p) * M + q];
          if (v >= INF) continue;
          const mustRun = q & ~p & ~out & (M - 1); // started last hour -> min up-time
          const mustRest = p & ~q; // stopped last hour -> min down-time
          for (let c = 0; c < M; c++) {
            const tot = v + startCost[q * M + c] + (POP[mustRun & ~c & (M - 1)] + POP[mustRest & c]) * UPDOWN_VIOLATION_L;
            const kb = (i * M + q) * M + c;
            if (tot < best[kb]) {
              best[kb] = tot;
              bestP[kb] = p;
            }
          }
        }
    const next = new Float64Array(nS * MM).fill(INF);
    const bo = t * nS * MM;
    for (let c = 0; c < M; c++) {
      if (c & out) continue;
      const capC = tb.cap[c],
        minC = tb.min[c];
      const isMax = c === allAvail;
      for (let i = 0; i < nS; i++) {
        let anyBase = false;
        for (let q = 0; q < M; q++) if (best[(i * M + q) * M + c] < INF) anyBase = true;
        if (!anyBase) continue;
        const Ei = Elev(i);
        const jLo = Math.max(0, i - maxDn),
          jHi = Math.min(nS - 1, i + maxUp);
        let nJ = 0;
        for (let j = jLo; j <= jHi; j++) {
          const Ej = Elev(j);
          const d = Ej - Ei;
          const Pch = d > 0 ? d / B.etaC : 0;
          const Pdis = d < 0 ? -d * B.etaD : 0;
          const net = L + Pch - Pdis;
          let pg = 0,
            unserved = 0,
            surplus: number;
          if (c === 0) {
            if (net > RE + 1e-6) {
              if (!isMax) continue;
              unserved = net - RE;
            }
            surplus = Math.max(0, RE - net);
          } else {
            const need = net - RE;
            if (need > capC) {
              if (!isMax) continue;
              unserved = need - capC;
              pg = capC;
            } else pg = need > minC ? need : minC;
            surplus = pg + RE - net + unserved;
            if (surplus > RE + st.p2hKW + 1e-6) continue;
          }
          // reserve & N-1 security
          const battRes = hasBatt ? Math.min(B.kW - Pdis + Pch, (Math.min(Ei, Ej) - Emin) * B.etaD * 4) : 0;
          if (c !== 0) {
            if (capC - pg + battRes < Rq && !isMax) continue;
            // N-1 (with a battery): if the largest running unit trips, the other units + battery (15 min) + renewables carry the load
            if (hasBatt && !isMax && capC - tb.largest[c] + battN1(Ei, Ej) + RE < L) continue;
          } else {
            if (battRes < Rq + 0.5 * Math.min(Math.max(net, 0), RE) && !isMax) continue;
          }
          const rec = st.heatRecovery * pg;
          const heatRem = H > rec ? H - rec : 0;
          const p2h = Math.min(surplus, st.p2hKW, heatRem);
          const boilerQ = heatRem - p2h;
          let cst =
            (c ? tb.f0[c] + DIESEL.F1 * pg : 0) +
            boilerQ / (st.boilerEff * DIESEL.LHV) +
            tb.nOn[c] * COSTS.RUNHOUR_L +
            (Pch + Pdis) * COSTS.BATT_WEAR_L_PER_KWH +
            unserved * COSTS.UNSERVED_L_PER_KWH;
          if (c && pg / capC < 0.4) cst += tb.nOn[c] * COSTS.LOWLOAD_L;
          stage[j] = cst;
          okJ[nJ++] = j;
        }
        if (!nJ) continue;
        for (let q = 0; q < M; q++) {
          const kb = (i * M + q) * M + c;
          const base = best[kb];
          if (base >= INF) continue;
          for (let n = 0; n < nJ; n++) {
            const j = okJ[n];
            const tot = base + stage[j];
            const k = (j * M + q) * M + c;
            if (tot < next[k]) {
              next[k] = tot;
              bpI[bo + k] = i;
              bpP[bo + k] = bestP[kb];
            }
          }
        }
      }
    }
    cost = next;
  }
  // terminal value of stored energy
  let bestK = -1,
    bestV = INF;
  for (let k = 0; k < nS * MM; k++) {
    const v = cost[k];
    if (v >= INF) continue;
    const j = Math.floor(k / MM);
    const vt = v + (Elev(i0) - Elev(j)) * COSTS.SOC_TERMINAL_L_PER_KWH;
    if (vt < bestV) {
      bestV = vt;
      bestK = k;
    }
  }
  // backtrack: state at end of hour t is (j, q = combo of hour t-1, c = combo of hour t)
  const path: { i: number; j: number; c: number }[] = new Array(T);
  let j = Math.floor(bestK / MM),
    q = Math.floor(bestK / M) % M,
    c = bestK % M;
  for (let t = T - 1; t >= 0; t--) {
    const k = t * nS * MM + (j * M + q) * M + c;
    const i = bpI[k];
    const p = bpP[k];
    path[t] = { i, j, c };
    j = i;
    c = q;
    q = p;
  }
  // re-settle each hour for reporting
  const hours: HourResult[] = [];
  for (let t = 0; t < T; t++) {
    const { i, j: jj, c: cc } = path[t];
    const Ei = Elev(i),
      Ej = Elev(jj);
    const d = Ej - Ei;
    const Pch = d > 0 ? d / B.etaC : 0;
    const Pdis = d < 0 ? -d * B.etaD : 0;
    const L = inp.load[t],
      RE = inp.wind[t] + inp.pv[t];
    const net = L + Pch - Pdis;
    let pg = 0,
      unserved = 0;
    if (cc === 0) unserved = Math.max(0, net - RE);
    else {
      const need = net - RE;
      if (need > tb.cap[cc]) {
        unserved = need - tb.cap[cc];
        pg = tb.cap[cc];
      } else pg = Math.max(need, tb.min[cc]);
    }
    hours.push(
      settleHour(st, tb, cc, pg, Pdis - Pch, hasBatt ? Ej / B.kWh : 0, L, inp.heat[t], inp.wind[t], inp.pv[t], unserved),
    );
  }
  return { strategy: 'ai', hours, totals: summarize(hours, st) };
}

// ---------------------------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------------------------

/** Conventional commitment: cheapest combo with >= 30% spinning margin over the (gross) load, with hysteresis. */
export const CONV_MARGIN = 1.3;
function marginCombo(tb: ReturnType<typeof comboTables>, load: number, prev: number, out: number) {
  const need = load * CONV_MARGIN;
  const ok = (c: number) => c !== 0 && !(c & out) && tb.cap[c] >= need;
  // hysteresis: keep the running set unless it is too small or a smaller set would be loaded < 75%
  if (ok(prev)) {
    let smaller = false;
    for (let c = 1; c < tb.M; c++) if (ok(c) && tb.cap[c] < tb.cap[prev] && load < 0.75 * tb.cap[c]) smaller = true;
    if (!smaller) return prev;
  }
  let best = -1,
    bc = Infinity;
  for (let c = 1; c < tb.M; c++) if (ok(c) && tb.cap[c] < bc) ((bc = tb.cap[c]), (best = c));
  if (best < 0) {
    best = 0;
    for (let u = 0; u < tb.n; u++) if (!(out & (1 << u))) best |= 1 << u;
  }
  return best;
}

export function conventional(inp: DispatchInput, withRenewables: boolean): DispatchResult {
  const { st } = inp;
  const tb = comboTables(st);
  const B = st.battery;
  const hasBatt = withRenewables && B.kWh > 1;
  let E = hasBatt ? Math.min(B.socMax, Math.max(B.socMin, inp.soc0)) * B.kWh : 0;
  let prev = inp.prevOn ?? 0;
  const hours: HourResult[] = [];
  for (let t = 0; t < inp.load.length; t++) {
    const L = inp.load[t];
    const W = withRenewables ? inp.wind[t] : 0;
    const S = withRenewables ? inp.pv[t] : 0;
    const out = inp.outage ? inp.outage[t] : 0;
    const c = marginCombo(tb, L, prev, out);
    prev = c;
    const capC = tb.cap[c],
      minC = withRenewables ? tb.min[c] : 0;
    // renewables displace genset output down to the genset minimum; battery in simple fuel-saver mode
    let pg = Math.max(minC, L - W - S);
    let battery = 0;
    if (hasBatt) {
      const surplus = pg + W + S - L;
      if (surplus > 0 && E < B.socMax * B.kWh) {
        const ch = Math.min(surplus, B.kW, (B.socMax * B.kWh - E) / B.etaC);
        battery = -ch;
        E += ch * B.etaC;
      } else if (pg > minC && E > 0.5 * B.kWh) {
        const dis = Math.min(pg - minC, B.kW, (E - 0.5 * B.kWh) * B.etaD);
        battery = dis;
        pg -= dis;
        E -= dis / B.etaD;
      }
    }
    let unserved = 0;
    if (pg > capC) {
      unserved = pg - capC;
      pg = capC;
    }
    hours.push(settleHour(st, tb, c, pg, battery, hasBatt ? E / B.kWh : 0, L, inp.heat[t], W, S, unserved));
  }
  return { strategy: withRenewables ? 'rule' : 'diesel', hours, totals: summarize(hours, st) };
}

/** Required spinning reserve for the AI strategy: load-forecast uncertainty + renewable volatility (+ storm cut-out risk). */
export function reserveProfile(loadP50: number[], loadP90: number[], wind: number[], pv: number[], bliz: number[]) {
  return loadP50.map((l, t) => 0.1 * l + Math.max(0, loadP90[t] - l) + (bliz[t] ? 0.8 : 0.25) * wind[t] + 0.1 * pv[t]);
}

/** Wind and PV actually produced in an hour (available minus curtailed), split pro rata.
 *  Includes renewable energy that went to the battery or the electric boiler. */
export function reSplit(h: { wind: number; pv: number; curtail: number }) {
  const re = h.wind + h.pv;
  const k = re > 0 ? Math.max(0, re - h.curtail) / re : 0;
  return { w: h.wind * k, pv: h.pv * k };
}

/** How the optimised plan sits against each operating constraint (for the operator's constraint table). */
export interface ConstraintReport {
  minLoading: number; // lowest loading of any running set in the plan (0..1), 1 if none run
  lowLoadUnitHours: number;
  starts: number;
  shortestRun: number | null; // h, runs that start and end inside the horizon
  shortestRest: number | null; // h, stops that end inside the horizon
  socMin: number;
  socMax: number;
  battMaxKW: number;
  reserveMargin: number; // kW, min over hours of (available spinning reserve - required)
  n1Margin: number | null; // kW, min over hours with gensets running of (capacity after losing largest unit + battery + RE - load)
  unservedKWh: number;
  hours: number;
}

export function constraintReport(st: StationConfig, r: DispatchResult, reserve: number[], soc0: number, prevOn = 0): ConstraintReport {
  const B = st.battery;
  const hasBatt = B.kWh > 1 && B.kW > 1;
  const Emin = B.socMin * B.kWh;
  let minLoading = 1,
    lowLoad = 0,
    starts = 0,
    socMin = 1,
    socMax = 0,
    battMax = 0,
    resM = Infinity,
    n1M = Infinity,
    unserved = 0;
  let prev = prevOn;
  let Eprev = soc0 * B.kWh;
  r.hours.forEach((h, t) => {
    let cap = 0,
      largest = 0;
    st.gens.forEach((g, u) => {
      if (h.on & (1 << u)) {
        cap += g.rated;
        largest = Math.max(largest, g.rated);
      }
    });
    if (h.on) minLoading = Math.min(minLoading, h.loading);
    if (h.on && h.loading < 0.4) lowLoad += popcount(h.on);
    starts += popcount(h.on & ~prev);
    prev = h.on;
    socMin = Math.min(socMin, h.soc);
    socMax = Math.max(socMax, h.soc);
    battMax = Math.max(battMax, Math.abs(h.battery));
    const Ej = h.soc * B.kWh;
    const eLim = (Math.min(Eprev, Ej) - Emin) * B.etaD * 4;
    const pch = Math.max(0, -h.battery),
      pdis = Math.max(0, h.battery);
    const battRes = hasBatt ? Math.max(0, Math.min(B.kW - pdis + pch, eLim)) : 0;
    const req = Math.max((CONV_MARGIN - 1) * h.load, reserve[t] ?? 0);
    resM = Math.min(resM, cap - h.pg + battRes - req);
    if (h.on) n1M = Math.min(n1M, cap - largest + (hasBatt ? Math.max(0, Math.min(B.kW, eLim)) : 0) + h.wind + h.pv - h.load);
    unserved += h.unserved;
    Eprev = Ej;
  });
  // run / rest lengths per unit, only for intervals that start and end inside the horizon
  let shortestRun: number | null = null,
    shortestRest: number | null = null;
  st.gens.forEach((_, u) => {
    let state = (prevOn >> u) & 1,
      len = 0,
      open = false; // true once a transition happened inside the horizon
    r.hours.forEach((h) => {
      const on = (h.on >> u) & 1;
      if (on === state) len++;
      else {
        if (open) {
          if (state) shortestRun = shortestRun === null ? len : Math.min(shortestRun, len);
          else shortestRest = shortestRest === null ? len : Math.min(shortestRest, len);
        }
        open = true;
        state = on;
        len = 1;
      }
    });
  });
  return {
    minLoading,
    lowLoadUnitHours: lowLoad,
    starts,
    shortestRun,
    shortestRest,
    socMin,
    socMax,
    battMaxKW: battMax,
    reserveMargin: resM,
    n1Margin: n1M === Infinity ? null : n1M,
    unservedKWh: unserved,
    hours: r.hours.length,
  };
}
