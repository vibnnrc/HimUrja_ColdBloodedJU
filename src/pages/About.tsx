import React from 'react';
import { LuShieldCheck, LuWifiOff, LuBrain, LuCpu, LuMessageSquareText, LuSatelliteDish } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel } from '../ui/kit';
import { COL } from './common';
import { DIESEL } from '../sim/stations';
import { COSTS } from '../opt/dispatch';
import { MODEL } from '../ai/forecast';

const INK = '#14243a';
const MUT = '#5d6b7d';
const LINE = '#8795a6';

function Box({ x, y, w, h, t, s, c = INK, fill = '#ffffff', dash, fs = 11.5 }: { x: number; y: number; w: number; h: number; t: string; s?: string; c?: string; fill?: string; dash?: boolean; fs?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2} fill={fill} stroke={c} strokeWidth={1.2} strokeDasharray={dash ? '5 4' : undefined} />
      <text x={x + w / 2} y={y + (s ? h / 2 - 3 : h / 2 + 4)} textAnchor="middle" style={{ fontSize: fs, fontWeight: 700, fill: INK }}>
        {t}
      </text>
      {s && (
        <text x={x + w / 2} y={y + h / 2 + 11} textAnchor="middle" style={{ fontSize: 9.8, fill: MUT }}>
          {s}
        </text>
      )}
    </g>
  );
}

const Arrow = ({ x1, y1, x2, y2, c = LINE, dash, label, lx, ly }: { x1: number; y1: number; x2: number; y2: number; c?: string; dash?: boolean; label?: string; lx?: number; ly?: number }) => (
  <g>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={1.4} markerEnd="url(#ah)" strokeDasharray={dash ? '5 4' : undefined} />
    {label && (
      <text x={lx ?? x1 + 6} y={ly ?? (y1 + y2) / 2 + 3} style={{ fontSize: 9.5, fill: MUT, fontFamily: 'var(--mono)' }}>
        {label}
      </text>
    )}
  </g>
);

function Layer({ y, h, n, name, rate }: { y: number; h: number; n: number; name: string; rate: string }) {
  return (
    <g>
      <rect x={14} y={y} width={752} height={h} fill={n % 2 ? '#f5f7f9' : '#ffffff'} stroke="#d3dae2" />
      <text x={24} y={y + 17} style={{ fontSize: 10, fontWeight: 700, fill: INK, letterSpacing: 1 }}>
        L{n} · {name}
      </text>
      <text x={24} y={y + 31} style={{ fontSize: 9.5, fill: MUT, fontFamily: 'var(--mono)' }}>
        {rate}
      </text>
    </g>
  );
}

function ArchDiagram() {
  const fieldX = (k: number) => 160 + k * 100;
  return (
    <svg viewBox="0 0 1060 580" className="scada" role="img" aria-label="HimUrja layered system architecture">
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={LINE} />
        </marker>
      </defs>
      <Layer y={10} h={86} n={1} name="FIELD" rate="1 s - 1 min" />
      <Layer y={118} h={76} n={2} name="DATA INGESTION" rate="1 min → 1 h" />
      <Layer y={216} h={76} n={3} name="FORECASTING" rate="hourly, 48 h / 7 d" />
      <Layer y={314} h={90} n={4} name="OPTIMISATION" rate="MPC, every hour" />
      <Layer y={426} h={66} n={5} name="OPERATOR HMI" rate="live" />
      {[
        ['Genset ctrl', 'Modbus-TCP'],
        ['Energy meters', 'IEC 61850'],
        ['BMS / PCS', 'CAN / Modbus'],
        ['WTG + PV inv.', 'SunSpec'],
        ['Met mast', '4-20 mA'],
        ['Tank / bldg', 'BACnet'],
      ].map(([t, sub], k) => (
        <Box key={t} x={fieldX(k)} y={30} w={94} h={50} t={t} s={sub} fs={10.5} />
      ))}
      <Box x={160} y={134} w={186} h={46} t="Protocol adapters" s="Modbus / OPC-UA → MQTT" />
      <Box x={356} y={134} w={200} h={46} t="Validation & gap filling" s="range · rate-of-change · stale" />
      <Box x={566} y={134} w={186} h={46} t="Time-series historian" s="1-min raw · hourly features" />
      <Box x={160} y={232} w={270} h={46} t="Load forecast (ML)" s={`GBT ${MODEL.trees.length} trees · 16 features · P10-P90 (conformal)`} />
      <Box x={440} y={232} w={312} h={46} t="Renewable & heat forecast (physics)" s="NWP weather → wind curve, bifacial PV, UA heat model" />
      <Box x={160} y={330} w={392} h={58} t="Economic dispatch (dynamic programming)" s="gensets × battery SOC · power-to-heat · flexible loads · min fuel" />
      <Box x={562} y={330} w={190} h={58} t="Safety supervisor" s="reserve · N-1 · min up/down · fallback" c="#c0392b" />
      <Box x={160} y={440} w={190} h={40} t="Control room / SLD" s="status · alarms · ops log" />
      <Box x={360} y={440} w={196} h={40} t="Decision log" s="reason + action per change" />
      <Box x={566} y={440} w={186} h={40} t="Scenario & planning" s="what-if · sizing" />
      {/* vertical data flow */}
      {fieldX(0) >= 0 && [0, 1, 2, 3, 4, 5].map((k) => <line key={k} x1={fieldX(k) + 46} y1={80} x2={fieldX(k) + 46} y2={104} stroke={LINE} strokeWidth={1.2} />)}
      <line x1={206} y1={104} x2={706} y2={104} stroke={LINE} strokeWidth={1.2} />
      <Arrow x1={253} y1={104} x2={253} y2={132} label="polled data" lx={260} ly={122} />
      <Arrow x1={346} y1={157} x2={354} y2={157} />
      <Arrow x1={556} y1={157} x2={564} y2={157} />
      <Arrow x1={659} y1={180} x2={659} y2={230} label="clean load, weather" lx={530} ly={210} />
      <Arrow x1={295} y1={180} x2={295} y2={230} label="features" lx={302} ly={210} />
      <Arrow x1={295} y1={278} x2={295} y2={328} label="load P10/P50/P90" lx={302} ly={308} />
      <Arrow x1={596} y1={278} x2={450} y2={328} label="wind, PV, heat" lx={530} ly={302} />
      <Arrow x1={552} y1={359} x2={560} y2={359} />
      <Arrow x1={255} y1={388} x2={255} y2={438} label="plan + reasons" lx={262} ly={418} />
      <Arrow x1={458} y1={388} x2={458} y2={438} />
      {/* right column: digital twin + actuation loop */}
      <Box x={790} y={118} w={240} h={174} t="" c="#1d5d9b" dash fill="#f7fafd" />
      <text x={910} y={140} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 700, fill: INK }}>DIGITAL TWIN / SIMULATOR</text>
      {['weather generator (blizzards, icing)', 'crew-driven demand model', 'genset / WTG / PV / BESS physics', 'sensor faults & delays', 'training data + scenario tests'].map((t, k) => (
        <text key={t} x={802} y={164 + k * 22} style={{ fontSize: 10, fill: MUT }}>
          · {t}
        </text>
      ))}
      <Arrow x1={790} y1={205} x2={754} y2={157} c="#1d5d9b" dash label="replaces L1 in the prototype" lx={604} ly={113} />
      <Box x={790} y={330} w={240} h={58} t="Set-point output" s="PMS start/stop · PCS kW · boiler · contactors" c="#2e7d32" />
      <Arrow x1={752} y1={359} x2={788} y2={359} c="#2e7d32" />
      <line x1={1046} y1={359} x2={1046} y2={55} stroke="#2e7d32" strokeWidth={1.4} />
      <line x1={1030} y1={359} x2={1046} y2={359} stroke="#2e7d32" strokeWidth={1.4} />
      <Arrow x1={1046} y1={55} x2={754} y2={55} c="#2e7d32" label="actuation · operator-confirmed in phase 1" lx={790} ly={49} />
      {/* HQ */}
      <Box x={160} y={522} w={592} h={40} t="NCPOR HQ, Goa - fleet view of all stations, model retraining, expedition logistics" c={LINE} fill="#f5f7f9" />
      <Arrow x1={456} y1={492} x2={456} y2={520} c="#1d5d9b" dash label="store-and-forward over satellite (~5 KB/day)" lx={464} ly={511} />
    </svg>
  );
}

export function AboutPage() {
  const { st } = useApp();
  return (
    <div className="stack">
      <Panel title="System architecture" hint="five layers on the station edge PC · no internet needed · HQ link is optional">
        <ArchDiagram />
      </Panel>

      <div className="grid g3">
        <Panel title={<span className="row" style={{ gap: 7 }}><LuBrain style={{ color: COL.ai }} /> Physics + machine learning</span>}>
          <p className="muted" style={{ margin: 0 }}>
            Human-driven demand is learned by a gradient-boosted tree model ({MODEL.trees.length} trees, 16 features) with split-conformal uncertainty bands. Weather-driven quantities - PV at{' '}
            {Math.abs(st.lat).toFixed(0)}°S, wind with storm cut-out and icing, heating via a UA-model - come from physics. Physics where it is known, ML where it is not: robust with little data.
          </p>
        </Panel>
        <Panel title={<span className="row" style={{ gap: 7 }}><LuCpu style={{ color: COL.ok }} /> Provably optimal, auditable</span>}>
          <p className="muted" style={{ margin: 0 }}>
            Exact dynamic programming over battery state × running genset set replaces heuristics. Thermal side included: fewer genset hours mean less recovered heat, which the optimiser pays for in boiler oil
            - so the savings reported are real, not double-counted.
          </p>
        </Panel>
        <Panel title={<span className="row" style={{ gap: 7 }}><LuShieldCheck style={{ color: COL.bad }} /> Safety first</span>}>
          <p className="muted" style={{ margin: 0 }}>
            Spinning reserve ≥ max(30% of load, P90 forecast error + renewable volatility). Storm cut-out handled explicitly. Independent safety supervisor falls back to conventional genset control on any
            sensor or model fault. Operators can always override.
          </p>
        </Panel>
        <Panel title={<span className="row" style={{ gap: 7 }}><LuWifiOff style={{ color: COL.ice }} /> Offline-first</span>}>
          <p className="muted" style={{ margin: 0 }}>
            Everything - model inference, optimisation, HMI - runs on the station's own server/PC with zero cloud dependency. The whole app is ~{' '}
            {Math.round(60 + JSON.stringify(MODEL.trees).length / 1024)} KB of code + model; sync to HQ is store-and-forward over the existing satellite link.
          </p>
        </Panel>
        <Panel title={<span className="row" style={{ gap: 7 }}><LuMessageSquareText style={{ color: COL.solar }} /> Explainable</span>}>
          <p className="muted" style={{ margin: 0 }}>
            Every start, stop, charge and load shift comes with its reasons and the resulting action ("Stop DG-3: wind + solar cover the load, battery holds the reserve"). Wintering teams trust what they understand.
          </p>
        </Panel>
        <Panel title={<span className="row" style={{ gap: 7 }}><LuSatelliteDish style={{ color: COL.battery }} /> Scales to the fleet</span>}>
          <p className="muted" style={{ margin: 0 }}>
            One model serves both stations (station is a feature), ready for the planned Maitri-II station and Himadri in the Arctic. HQ sees fuel autonomy of every station at a glance before
            expedition planning.
          </p>
        </Panel>
      </div>

      <div className="alert ice">
        <div>
          Every data source, model parameter, equipment size and limitation is listed on <a href="#/data">Data &amp; Assumptions</a>. All figures in this prototype are simulated.
        </div>
      </div>

      <Panel title="Deployment roadmap">
        <div className="grid g3">
          {[
            ['Phase 1 · 1 season', 'Shadow mode', 'Connect read-only to meters & genset panels at Bharati/Maitri, calibrate the twin, run HimUrja as an advisor. Validate forecasts & savings against logs.'],
            ['Phase 2 · next season', 'Closed loop on flexible assets', 'Automatic control of battery, electric boiler and Tier-3 loads; genset start/stop stays operator-confirmed with one click.'],
            ['Phase 3 · Maitri-II', 'Native EMS', 'HimUrja as the energy brain of Maitri-II from commissioning; fleet dashboard at NCPOR HQ; sizing assistant used in design.'],
          ].map(([a, b, c]) => (
            <div key={a} className="cmp">
              <div className="eyebrow">{a}</div>
              <h4 style={{ marginTop: 6 }}>{b}</h4>
              <div className="muted" style={{ fontSize: 13 }}>{c}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Built by">
        <div className="muted">
          Team <b style={{ color: 'var(--text)' }}>Cold Blooded JU</b> · Jadavpur University, Kolkata · Smart India Hackathon 2026 · Problem Statement 26061 (Ministry of Earth Sciences / NCPOR) · Clean &amp; Green
          Technology. Stack: TypeScript, React, custom SVG visualisation, Python / scikit-learn training pipeline, exact DP optimiser - no paid APIs, no cloud dependency.
        </div>
      </Panel>
    </div>
  );
}
