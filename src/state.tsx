import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { STATIONS, StationId, StationConfig, STATION_LIST } from './sim/stations';
import { computeSnapshot, DEFAULT_SCENARIO, Scenario, Snapshot, HOUR_MS, getAnnual, fuelLevelAt, isDefaultScenario, baselineOf } from './engine';
import { getTelemetry, Telemetry } from './sim/telemetry';
import { AnnualResult } from './opt/annual';

interface Ctx {
  st: StationConfig;
  stationId: StationId;
  setStationId: (id: StationId) => void;
  simMs: number;
  speed: number;
  setSpeed: (s: number) => void;
  resetClock: () => void;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  snap: Snapshot;
  annual: AnnualResult;
  fuelNowL: number;
  /** same hour under forecast conditions (no scenario) - the baseline for the scenario simulator */
  baseSnap: Snapshot;
  scenarioActive: boolean;
  tel: Telemetry;
  /** both stations, for the station overview */
  fleet: { st: StationConfig; snap: Snapshot; fuelL: number; annual: AnnualResult }[];
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [stationId, setStationIdRaw] = useState<StationId>(() => (localStorageGet('himurja.station') as StationId) || 'maitri');
  const [simMs, setSimMs] = useState(() => Date.now());
  const [speed, setSpeed] = useState(1);
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);

  useEffect(() => {
    const id = setInterval(() => setSimMs((t) => t + 1000 * speed), 1000);
    return () => clearInterval(id);
  }, [speed]);

  const setStationId = (id: StationId) => {
    setStationIdRaw(id);
    localStorageSet('himurja.station', id);
  };
  const st = STATIONS[stationId];
  const hourKey = Math.floor(simMs / HOUR_MS);
  const snap = useMemo(() => computeSnapshot(st, hourKey * HOUR_MS, scenario), [st, hourKey, scenario]);
  const annual = useMemo(() => getAnnual(st), [st]);
  const fuelNowL = useMemo(() => fuelLevelAt(st, annual, hourKey * HOUR_MS), [st, annual, hourKey]);
  const scenarioActive = !isDefaultScenario(scenario);
  const baseSnap = useMemo(() => (scenarioActive ? computeSnapshot(st, hourKey * HOUR_MS, baselineOf(scenario)) : snap), [st, hourKey, scenarioActive, snap, scenario]);
  const tel = useMemo(() => getTelemetry(st), [st]);
  const fleet = useMemo(
    () =>
      STATION_LIST.map((o) => {
        const a = getAnnual(o);
        return { st: o, snap: o.id === st.id ? baseSnap : computeSnapshot(o, hourKey * HOUR_MS, DEFAULT_SCENARIO), fuelL: fuelLevelAt(o, a, hourKey * HOUR_MS), annual: a };
      }),
    [st, hourKey, baseSnap],
  );

  const value: Ctx = {
    st,
    stationId,
    setStationId,
    simMs,
    speed,
    setSpeed,
    resetClock: () => {
      setSimMs(Date.now());
      setSpeed(1);
    },
    scenario,
    setScenario,
    snap,
    annual,
    fuelNowL,
    baseSnap,
    scenarioActive,
    tel,
    fleet,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

function localStorageGet(k: string) {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: fine */
  }
}

export function useRoute(): [string, (r: string) => void] {
  const get = () => (window.location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => setR(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [r, (x: string) => (window.location.hash = '/' + x)];
}
