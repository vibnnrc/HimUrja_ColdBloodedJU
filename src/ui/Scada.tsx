// Single-line diagram (SLD) of the station microgrid, drawn with IEC 60617-style symbols:
// generators "G 3~", converters (DC/AC), circuit breakers (filled = closed), busbar and
// load feeders. Only energised feeders carry animated power-flow markers.
import React from 'react';
import { StationConfig } from '../sim/stations';
import { HourResult, reSplit } from '../opt/dispatch';

interface Props {
  st: StationConfig;
  h: HourResult;
  crit: number;
  defer: number;
  temp: number;
  windMs: number;
  heatDemand: number;
  jitter: number; // 0..1, animates readouts
}

const C = {
  bus: '#14243a',
  dead: '#aab4c0',
  txt: '#14243a',
  mut: '#5d6b7d',
  diesel: '#b5561d',
  wind: '#1b7f79',
  solar: '#b07d0e',
  batt: '#5b54a8',
  load: '#14243a',
  heat: '#a4457a',
  flex: '#1d5d9b',
  bg: '#ffffff',
};

const BUS_Y = 222;
const TOP_Y = 150; // bottom of source symbols

function Breaker({ x, y, closed }: { x: number; y: number; closed: boolean }) {
  return (
    <g>
      <rect x={x - 6} y={y - 6} width={12} height={12} fill={closed ? C.bus : C.bg} stroke={C.bus} strokeWidth={1.4} />
    </g>
  );
}

function Wire({ x, y1, y2, p, color, reverse }: { x: number; y1: number; y2: number; p: number; color: string; reverse?: boolean }) {
  const live = p > 0.5;
  const dur = Math.max(0.4, Math.min(4, 45 / Math.max(1, p)));
  return (
    <g>
      <line x1={x} x2={x} y1={y1} y2={y2} stroke={live ? color : C.dead} strokeWidth={live ? 2.4 : 1.6} />
      {live && <line x1={x} x2={x} y1={y1} y2={y2} stroke="#ffffff" strokeWidth={2.4} className={`flow ${reverse ? 'rev' : ''}`} style={{ animationDuration: `${dur}s` }} opacity={0.9} />}
    </g>
  );
}

function Readout({ x, y, v, unit = 'kW', color, sign }: { x: number; y: number; v: number; unit?: string; color: string; sign?: string }) {
  const live = Math.abs(v) > 0.5;
  return (
    <g>
      <rect x={x} y={y - 12} width={70} height={17} fill="#f5f7f9" stroke="#d3dae2" />
      <text x={x + 64} y={y + 1} textAnchor="end" style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, fill: live ? color : C.mut }}>
        {sign ?? ''}
        {Math.abs(v).toFixed(0)}
        <tspan style={{ fontSize: 9.5, fill: C.mut, fontWeight: 400 }}> {unit}</tspan>
      </text>
    </g>
  );
}

function Tag({ x, y, t, s }: { x: number; y: number; t: string; s?: string }) {
  return (
    <g>
      <text x={x} y={y} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: C.txt, letterSpacing: 0.6 }}>
        {t}
      </text>
      {s && (
        <text x={x} y={y + 13} textAnchor="middle" style={{ fontSize: 10.5, fill: C.mut }}>
          {s}
        </text>
      )}
    </g>
  );
}

/** Converter symbol: square with a diagonal, "=" and "~" (DC/AC). */
function Converter({ x, y, live }: { x: number; y: number; live: boolean }) {
  const c = live ? C.bus : C.dead;
  return (
    <g>
      <rect x={x - 11} y={y - 11} width={22} height={22} fill={C.bg} stroke={c} strokeWidth={1.3} />
      <line x1={x - 11} y1={y + 11} x2={x + 11} y2={y - 11} stroke={c} strokeWidth={1} />
      <text x={x - 6} y={y - 1} textAnchor="middle" style={{ fontSize: 9, fill: c }}>=</text>
      <text x={x + 6} y={y + 9} textAnchor="middle" style={{ fontSize: 9, fill: c }}>~</text>
    </g>
  );
}

function Genset({ x, on, name, rated, p, loading, kind }: { x: number; on: boolean; name: string; rated: number; p: number; loading: number; kind: string }) {
  const col = on ? C.diesel : C.dead;
  const cy = 98;
  return (
    <g>
      <Tag x={x} y={40} t={name} s={`${rated} kW ${kind}`} />
      <circle cx={x} cy={cy} r={21} fill={C.bg} stroke={col} strokeWidth={2} />
      <text x={x} y={cy + 2} textAnchor="middle" style={{ fontSize: 14, fontWeight: 700, fill: col }}>G</text>
      <text x={x} y={cy + 14} textAnchor="middle" style={{ fontSize: 9, fill: col }}>3~</text>
      <Wire x={x} y1={cy + 21} y2={BUS_Y} p={p} color={C.diesel} />
      <Breaker x={x} y={178} closed={on} />
      <Readout x={x + 9} y={200} v={p} color={C.diesel} />
      <text x={x + 26} y={cy - 12} style={{ fontSize: 9.5, fontWeight: 600, fill: on ? (loading < 0.4 ? '#b7791f' : C.mut) : C.mut }}>
        {on ? `RUN ${(loading * 100).toFixed(0)}%` : 'STOP'}
      </text>
    </g>
  );
}

function Turbine({ x, windMs, p, units, unitKW }: { x: number; windMs: number; p: number; units: number; unitKW: number }) {
  const live = p > 0.5;
  const col = live ? C.wind : C.dead;
  const spin = live ? Math.max(0.6, 6 - windMs * 0.35) : 0;
  const cy = 78;
  const rotor = (cx: number) => (
    <g className={spin ? 'rotor' : ''} style={{ animationDuration: `${spin}s` }}>
      {[0, 120, 240].map((a) => (
        <line key={a} x1={cx} y1={cy} x2={cx} y2={cy - 15} stroke={col} strokeWidth={2} transform={`rotate(${a} ${cx} ${cy})`} />
      ))}
    </g>
  );
  return (
    <g>
      <Tag x={x} y={40} t="WTG" s={`${units} × ${unitKW} kW wind`} />
      {[-13, 13].slice(0, Math.max(1, Math.min(2, units))).map((dx) => (
        <g key={dx}>
          <line x1={x + dx} x2={x + dx} y1={cy} y2={cy + 26} stroke={col} strokeWidth={1.6} />
          {rotor(x + dx)}
          <line x1={x + dx} x2={x} y1={cy + 26} y2={cy + 32} stroke={col} strokeWidth={1.2} />
        </g>
      ))}
      <Converter x={x} y={124} live={live} />
      <Wire x={x} y1={135} y2={BUS_Y} p={p} color={C.wind} />
      <Breaker x={x} y={178} closed={live} />
      <Readout x={x + 9} y={200} v={p} color={C.wind} />
    </g>
  );
}

function PV({ x, p, kWp }: { x: number; p: number; kWp: number }) {
  const live = p > 0.5;
  const col = live ? C.solar : C.dead;
  return (
    <g>
      <Tag x={x} y={40} t="PV" s={`${kWp} kWp bifacial`} />
      <g transform={`translate(${x - 20},${70})`}>
        <rect width={40} height={26} fill={C.bg} stroke={col} strokeWidth={1.6} />
        {[10, 20, 30].map((v) => (
          <line key={v} x1={v} x2={v} y1={0} y2={26} stroke={col} strokeWidth={0.7} />
        ))}
        <line x1={0} x2={40} y1={13} y2={13} stroke={col} strokeWidth={0.7} />
      </g>
      <line x1={x} x2={x} y1={96} y2={113} stroke={col} strokeWidth={1.6} />
      <Converter x={x} y={124} live={live} />
      <Wire x={x} y1={135} y2={BUS_Y} p={p} color={C.solar} />
      <Breaker x={x} y={178} closed={live} />
      <Readout x={x + 9} y={200} v={p} color={C.solar} />
    </g>
  );
}

function Battery({ x, soc, p, kWh, kW }: { x: number; soc: number; p: number; kWh: number; kW: number }) {
  const live = Math.abs(p) > 0.5;
  const col = C.batt;
  return (
    <g>
      <Tag x={x} y={40} t="BESS" s={`${kWh} kWh / ${kW} kW LFP`} />
      {/* IEC battery symbol: long/short plates */}
      {[0, 1, 2].map((k) => (
        <g key={k}>
          <line x1={x - 14} x2={x + 14} y1={68 + k * 10} y2={68 + k * 10} stroke={col} strokeWidth={1.8} />
          <line x1={x - 7} x2={x + 7} y1={72 + k * 10} y2={72 + k * 10} stroke={col} strokeWidth={3} />
        </g>
      ))}
      <text x={x + 20} y={84} style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600, fill: C.txt }}>
        {(soc * 100).toFixed(0)}%
      </text>
      <text x={x + 20} y={96} style={{ fontSize: 9, fill: C.mut }}>SOC</text>
      <line x1={x} x2={x} y1={96} y2={113} stroke={col} strokeWidth={1.6} />
      <Converter x={x} y={124} live={live} />
      <Wire x={x} y1={135} y2={BUS_Y} p={Math.abs(p)} color={C.batt} reverse={p < 0} />
      <Breaker x={x} y={178} closed />
      <Readout x={x + 9} y={200} v={p} color={C.batt} sign={p > 0.5 ? '+' : p < -0.5 ? '−' : ''} />
      <text x={x - 12} y={158} textAnchor="end" style={{ fontSize: 9.5, fontWeight: 600, fill: C.mut }}>
        {p > 0.5 ? 'DISCHARGE' : p < -0.5 ? 'CHARGE' : 'STANDBY'}
      </text>
    </g>
  );
}

function Feeder({ x, p, name, sub, color = C.load, tier }: { x: number; p: number; name: string; sub: string; color?: string; tier: string }) {
  const live = p > 0.5;
  return (
    <g>
      <Wire x={x} y1={BUS_Y} y2={318} p={p} color={color} />
      <Breaker x={x} y={252} closed={live} />
      <path d={`M${x - 8},${318} L${x + 8},${318} L${x},${331} Z`} fill={live ? color : C.dead} />
      <Readout x={x + 9} y={290} v={p} color={color} />
      <text x={x} y={350} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 700, fill: C.txt }}>
        {name}
      </text>
      <text x={x} y={363} textAnchor="middle" style={{ fontSize: 10, fill: C.mut }}>
        {sub}
      </text>
      <text x={x} y={376} textAnchor="middle" style={{ fontSize: 9, fill: C.mut, letterSpacing: 0.6 }}>
        {tier}
      </text>
    </g>
  );
}

export function Scada({ st, h, crit, defer, temp, windMs, heatDemand, jitter }: Props) {
  const xs = [62, 172, 282, 412, 542, 672];
  const science = st.load.science + (st.load.ageos ? 3 : 0);
  const lifeSupport = Math.min(crit - science, st.load.base * 0.55 + st.load.traceHeatPerK * Math.max(0, -temp) + 0.07 * heatDemand);
  const habitat = Math.max(0, crit - science - lifeSupport);
  const f = 50 + (jitter - 0.5) * 0.06;
  const v = 415 + (jitter - 0.5) * 3;
  const { w: windP, pv: pvP } = reSplit(h);
  return (
    <svg viewBox="0 0 1000 384" className="scada" role="img" aria-label="Station microgrid single-line diagram">
      {st.gens.map((g, u) => (
        <Genset key={g.id} x={xs[u]} on={!!(h.on & (1 << u))} name={g.name} rated={g.rated} p={h.unitPg[u]} loading={h.loading} kind={g.name.startsWith('CHP') ? 'CHP' : 'diesel'} />
      ))}
      {!st.plant.renewablesInstalled && (
        <g>
          <rect x={352} y={12} width={378} height={196} rx={4} fill="none" stroke="#b7791f" strokeWidth={1.2} strokeDasharray="5 4" />
          <text x={360} y={9} style={{ fontSize: 9.5, fontWeight: 700, fill: '#8a5a0f', letterSpacing: 0.5 }}>
            PROPOSED RETROFIT · not in station documents
          </text>
        </g>
      )}
      <Turbine x={xs[3]} windMs={windMs} p={windP} units={st.wind.units} unitKW={st.wind.unitKW} />
      <PV x={xs[4]} p={pvP} kWp={st.pv.kWp} />
      <Battery x={xs[5]} soc={h.soc} p={h.battery} kWh={st.battery.kWh} kW={st.battery.kW} />
      {/* busbar */}
      <line x1={30} x2={970} y1={BUS_Y} y2={BUS_Y} stroke={C.bus} strokeWidth={5} />
      <text x={968} y={BUS_Y - 10} textAnchor="end" style={{ fontSize: 10.5, fill: C.mut }}>
        MAIN LV BUS · 415 V 3φ 50 Hz
      </text>
      <text x={968} y={BUS_Y - 24} textAnchor="end" style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, fill: C.txt }}>
        {f.toFixed(2)} Hz · {v.toFixed(0)} V
      </text>
      {/* load feeders */}
      <Feeder x={95} p={lifeSupport} name="Life support" sub="HVAC, water, medical" tier="TIER 1 · CRITICAL" />
      <Feeder x={255} p={habitat} name="Habitat & galley" sub="crew areas, kitchen" tier="TIER 2 · ESSENTIAL" />
      <Feeder x={415} p={science} name={st.load.ageos ? 'Science & AGEOS' : 'Science & comms'} sub={st.load.ageos ? 'labs, satellite ground stn' : 'labs, observatory, VSAT'} tier="TIER 1 · CRITICAL" />
      <Feeder x={575} p={defer} name="Flexible loads" sub={st.load.ageos ? 'RO plant, laundry' : 'water pumping, laundry'} tier="TIER 3 · DEFERRABLE" color={C.flex} />
      <Feeder x={735} p={h.p2h} name="Electric boiler" sub="surplus → heat" tier={st.plant.renewablesInstalled ? 'POWER-TO-HEAT' : 'PROPOSED · P2H'} color={C.heat} />
      <Feeder x={895} p={h.curtail} name="Dump load" sub="curtailed surplus" tier="SPILL" color="#7b8797" />
      {/* legend */}
      <g transform="translate(850,16)" style={{ fontSize: 9.5, fill: C.mut }}>
        <rect x={0} y={-8} width={9} height={9} fill={C.bus} />
        <text x={14} y={0}>breaker closed</text>
        <rect x={100} y={-8} width={9} height={9} fill="#fff" stroke={C.bus} />
        <text x={114} y={0}>open</text>
      </g>
    </svg>
  );
}
