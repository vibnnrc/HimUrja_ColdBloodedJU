import React from 'react';
import {
  LuLayoutDashboard,
  LuActivity,
  LuFlaskConical,
  LuCpu,
  LuFuel,
  LuSlidersHorizontal,
  LuPlug,
  LuWrench,
  LuLayers,
  LuRefreshCw,
  LuDatabase,
} from 'react-icons/lu';
import { useApp, useRoute } from './state';
import { STATION_LIST } from './sim/stations';
import { Overview } from './pages/Overview';
import { ForecastPage } from './pages/Forecast';
import { DispatchPage } from './pages/Dispatch';
import { FuelPage } from './pages/Fuel';
import { PlannerPage } from './pages/Planner';
import { LoadsPage } from './pages/Loads';
import { HealthPage } from './pages/Health';
import { AboutPage } from './pages/About';
import { ScenarioPage } from './pages/Scenario';
import { DataPage } from './pages/Data';
import { stationStatus } from './pages/Overview';
import { Seg } from './ui/kit';
import { DEFAULT_SCENARIO } from './engine';

const PAGES = [
  { id: 'overview', group: 'Operations', label: 'Control Room', icon: <LuLayoutDashboard />, sub: 'System status, power flow, telemetry and events', C: Overview },
  { id: 'forecast', group: 'Operations', label: 'Load Forecast', icon: <LuActivity />, sub: 'Load, renewable and heating forecast with uncertainty band', C: ForecastPage },
  { id: 'dispatch', group: 'Operations', label: 'Economic Dispatch', icon: <LuCpu />, sub: '48 h unit commitment, battery and power-to-heat - with reasons', C: DispatchPage },
  { id: 'fuel', group: 'Operations', label: 'Fuel Endurance', icon: <LuFuel />, sub: 'Fuel reserve, endurance and resupply planning', C: FuelPage },
  { id: 'loads', group: 'Operations', label: 'Load Management', icon: <LuPlug />, sub: 'Load tiers, flexible-load scheduling and load shedding', C: LoadsPage },
  { id: 'health', group: 'Operations', label: 'Asset Health', icon: <LuWrench />, sub: 'Anomaly detection and maintenance planning', C: HealthPage },
  { id: 'scenario', group: 'Engineering', label: 'Scenario Simulation', icon: <LuFlaskConical />, sub: 'Run the station through a defined event and compare with the baseline', C: ScenarioPage },
  { id: 'planner', group: 'Engineering', label: 'Capacity Planning', icon: <LuSlidersHorizontal />, sub: 'Annual energy balance and wind / PV / battery sizing', C: PlannerPage },
  { id: 'data', group: 'Engineering', label: 'Data & Assumptions', icon: <LuDatabase />, sub: 'Where every number comes from, what is assumed, and what is not yet proven', C: DataPage },
  { id: 'about', group: 'Engineering', label: 'System Architecture', icon: <LuLayers />, sub: 'Data flow, models and deployment', C: AboutPage },
];

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <path d="M20 3 L35 11.5 L35 28.5 L20 37 L5 28.5 L5 11.5 Z" fill="none" stroke="#7fb3e6" strokeWidth="1.6" />
      <g stroke="#e9edf1" strokeWidth="1.7" strokeLinecap="round">
        <line x1="20" y1="9" x2="20" y2="31" />
        <line x1="10.5" y1="14.5" x2="29.5" y2="25.5" />
        <line x1="10.5" y1="25.5" x2="29.5" y2="14.5" />
      </g>
      <path d="M21.6 13 L16.2 21 H19.9 L18.4 27 L24 19 H20.4 Z" fill="#e0a458" />
    </svg>
  );
}

function StationSwitch() {
  const { stationId, setStationId } = useApp();
  return (
    <div className="st-switch">
      {STATION_LIST.map((s) => (
        <button key={s.id} className={stationId === s.id ? 'on' : ''} onClick={() => setStationId(s.id)}>
          {s.name}
        </button>
      ))}
    </div>
  );
}

function Clock() {
  const { simMs, speed, setSpeed, resetClock } = useApp();
  const t = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(simMs);
  return (
    <div className="row">
      <div className="clock">
        <span className="live-dot" />
        <span className="mono" style={{ color: 'var(--text)' }}>
          {t} IST
        </span>
        <span className="dim">{speed === 1 ? 'sim clock · real-time pace' : `sim clock · ${speed === 3600 ? '1 h/s' : `${speed}×`}`}</span>
      </div>
      <Seg
        value={speed}
        onChange={setSpeed}
        options={[
          { v: 1, label: '1x' },
          { v: 60, label: '60x' },
          { v: 600, label: '600x' },
          { v: 3600, label: '1h/s' },
        ]}
      />
      <button className="btn ghost" onClick={resetClock} title="Back to real time">
        <LuRefreshCw />
      </button>
    </div>
  );
}

/** Console identity line: which station, what mode, where the data comes from, when it last updated. */
function OpsIdentity() {
  const { st, snap, fuelNowL, simMs, scenarioActive, scenario } = useApp();
  const status = stationStatus(snap, fuelNowL);
  const mode = scenarioActive ? 'SCENARIO' : status.text;
  const lvl = scenarioActive ? 'warn' : status.level;
  const scan = simMs - (simMs % 5000);
  const t = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(scan);
  return (
    <div className="opsid">
      <span>
        <i>STATION</i> {st.name.toUpperCase()} · ANTARCTICA
      </span>
      <span>
        <i>MODE</i> <b className={`lvl ${lvl}`}>{mode}</b>
      </span>
      <span>
        <i>CONTROL</i> {scenario.risk === 'p90' ? 'AUTO · CAUTIOUS P90' : 'AUTO · MPC 1 h'}
      </span>
      <span>
        <i>PLANT</i> {st.plant.renewablesInstalled ? 'HYBRID' : 'GENSETS + PROPOSED WIND/PV/BESS'}
      </span>
      <span className="sim" title="No live station telemetry is used. All values come from a physics-based digital twin of the station.">
        <i>DATA</i> SIMULATION · DIGITAL TWIN
      </span>
      <span>
        <i>LAST UPDATE</i> {t} IST
      </span>
    </div>
  );
}

export function App() {
  const [route] = useRoute();
  const { st, scenarioActive, setScenario } = useApp();
  const page = PAGES.find((p) => p.id === route) ?? PAGES[0];
  const Page = page.C;
  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">HimUrja</div>
            <div className="brand-sub">Polar station energy operations</div>
          </div>
        </div>
        <StationSwitch />
        <nav className="nav">
          {PAGES.map((p, i) => (
            <React.Fragment key={p.id}>
              {(i === 0 || PAGES[i - 1].group !== p.group) && <div className="nav-h">{p.group}</div>}
              <a href={`#/${p.id}`} className={p.id === page.id ? 'on' : ''}>
                {p.icon}
                {p.label}
              </a>
            </React.Fragment>
          ))}
        </nav>
        <div className="side-foot">
          <div>
            <b>{st.fullName}</b>
          </div>
          <div>{st.region}</div>
          <div className="mono" style={{ marginTop: 4 }}>
            {Math.abs(st.lat).toFixed(3)}°S {st.lon.toFixed(3)}°E
          </div>
          <div style={{ marginTop: 10 }}>
            SIH 2026 · PS 26061 · MoES / NCPOR
            <br />
            Team <b>Cold Blooded JU</b>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="mobile-nav">
          <div className="mn-top">
            <BrandMark size={30} />
            <div className="brand-name" style={{ fontSize: 17 }}>
              HimUrja
            </div>
            <StationSwitch />
          </div>
          <div className="mn-tabs">
            {PAGES.map((p) => (
              <a key={p.id} href={`#/${p.id}`} className={p.id === page.id ? 'on' : ''}>
                {p.icon}
                {p.label}
              </a>
            ))}
          </div>
        </div>
        <header className="topbar">
          <div>
            <h1>{page.label}</h1>
            <div className="sub">{page.sub}</div>
          </div>
          <div className="spacer" />
          <Clock />
          <OpsIdentity />
        </header>
        <main className="content">
          {scenarioActive && page.id !== 'scenario' && (
            <div className="scn-banner">
              <b>SCENARIO ACTIVE</b> - forecasts and plans on every page include the simulated event.
              <span style={{ flex: 1 }} />
              <a className="btn" href="#/scenario">Open</a>
              <button className="btn" onClick={() => setScenario(DEFAULT_SCENARIO)}>Clear</button>
            </div>
          )}
          <Page />
          <div className="foot-note">
            HimUrja prototype · telemetry comes from a physics-based digital twin of {st.name} (weather, solar geometry at {Math.abs(st.lat).toFixed(1)}°S,
            crew-driven demand, genset / turbine / PV / battery models, sensor faults). In deployment the same engine reads live SCADA, energy-meter and
            met-mast data. Station data follow official documents where published (see Data &amp; Assumptions); wind, PV and battery are the proposed retrofit. All sizes are editable.
          </div>
        </main>
      </div>
    </div>
  );
}
