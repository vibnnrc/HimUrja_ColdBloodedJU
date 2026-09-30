import React from 'react';
import { LuTriangleAlert } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Badge, kfmt, pct } from '../ui/kit';
import { MODEL } from '../ai/forecast';
import { DIESEL, STATIONS, StationConfig } from '../sim/stations';
import { getYear } from '../sim/dataset';
import { COSTS, CONV_MARGIN, MIN_UPDOWN_H } from '../opt/dispatch';
import { AnnualResult } from '../opt/annual';
import { REFERENCE_MS, fmtDate } from '../engine';
import { REFS, refRuns } from '../refs';

/** In-text citation, IEEE style: [1], [2]. */
const C = ({ n }: { n: number[] }) => <span className="cite">{n.map((k) => `[${k}]`).join(', ')}</span>;

/** Statistics of the simulated year that can be checked against published values. */
function twinStats(st: StationConfig, annual: AnnualResult) {
  const y = getYear(st);
  const N = 8760;
  let t = 0,
    ev = 0,
    bh = 0,
    heatMax = 0;
  for (let h = 0; h < N; h++) {
    t += y.wx.temp[h];
    bh += y.wx.bliz[h];
    if (y.wx.bliz[h] && (h === 0 || !y.wx.bliz[h - 1])) ev++;
    heatMax = Math.max(heatMax, y.dem.heat[h]);
  }
  return { meanT: t / N, blizzards: ev, blizMeanH: ev ? bh / ev : 0, heatMax, gen: annual.diesel.fuelGen / 1000, boiler: annual.diesel.fuelBoiler / 1000, total: annual.diesel.fuel / 1000 };
}

/** Where every number on the console comes from, what is assumed, and what the prototype does not yet prove. */
export function DataPage() {
  const { st, annual, fleet } = useApp();
  const c = st.climate;
  const L = st.load;
  const B = st.battery;
  const annualOf = (id: string) => fleet.find((f) => f.st.id === id)?.annual ?? annual;
  const M = twinStats(STATIONS.maitri, annualOf('maitri'));
  const Bh = twinStats(STATIONS.bharati, annualOf('bharati'));
  const Ms = STATIONS.maitri;
  const Bs = STATIONS.bharati;
  const deg = (v: number, ns: string) => `${Math.abs(v).toFixed(3)}° ${ns}`;

  // [station, quantity, official value, refs, twin value]
  const official: [string, string, string, number[], string][] = [
    ['Maitri', 'Position, altitude', '70.767° S, 11.731° E · about 117 m', [1], `${deg(Ms.lat, 'S')}, ${deg(Ms.lon, 'E')} · ${Ms.elevation} m`],
    ['Maitri', 'Accommodation', '65 persons in summer, 25 in winter', [1], `crew ${Ms.crew.winter} in winter → ${Ms.crew.summerPeak} at the summer peak`],
    ['Maitri', 'Mean annual air temperature', 'about −9.5 °C (1991–2020)', [13], `${M.meanT.toFixed(1)} °C in the simulated year`],
    ['Maitri', 'Blizzards', 'about 21 a year, mean duration about 25 h, 3–4 a month in April–August', [12], `${M.blizzards} a year, mean ${M.blizMeanH.toFixed(0)} h with wind above 17 m/s`],
    [
      'Maitri',
      'Annual liquid fuel',
      '360 kL a year, of which 240 kL for power generation; the rest for central heating and vehicles',
      [17],
      `${kfmt(M.gen)} kL for power + ${kfmt(M.boiler)} kL boiler heating = ${kfmt(M.total)} kL (vehicles not modelled)`,
    ],
    ['Maitri', 'Generator ratings, fuel tanks', 'not published', [], `assumed: 3 × ${Ms.gens[0].rated} kW diesel sets; tanks ${Ms.fuel.tankKL} kL`],
    ['Bharati', 'Power plant', 'three diesel-operated 100 kVA combined heat and power (CHP) units, fuelled by Jet A-1', [2], `3 × ${Bs.gens[0].rated} kW (100 kVA at 0.8 power factor), CHP heat recovery`],
    ['Bharati', 'Fuel farm', '13 tanks of 24 m³, about 296 kL of Jet A-1, filled once a year from the ship', [2], `tank ${Bs.fuel.tankKL} kL · simulated burn ${kfmt(Bh.total)} kL/yr (diesel-only)`],
    ['Bharati', 'Peak thermal demand', 'about 155 kWth', [2], `${Bh.heatMax.toFixed(0)} kWth peak in the simulated year`],
    ['Bharati', 'Accommodation', '47 persons year-round + 13 in summer shelters = 60', [2], `crew ${Bs.crew.winter} in winter (assumed) → ${Bs.crew.summerPeak} at the summer peak`],
    ['Bharati', 'Water supply', 'reverse-osmosis plant treating sea water from Quilty Bay', [2], `${Bs.load.waterPlantKW} kW RO plant, scheduled as a flexible load`],
    ['Both', 'Wind, PV, battery', 'none described in the station documents', [1, 2], 'modelled as the PROPOSED retrofit only (sizes editable in Capacity Planning)'],
    ['Both', 'CO₂ per litre', 'IPCC default factors: 74.1 t CO₂/TJ (diesel), 71.5 t CO₂/TJ (jet kerosene)', [16], `${Ms.fuel.co2PerL} kg/L diesel (Maitri) · ${Bs.fuel.co2PerL} kg/L Jet A-1 (Bharati)`],
  ];

  const sources: [string, string, string, string][] = [
    ['Air temperature', 'Stochastic generator: seasonal "coreless winter" curve + AR(1) synoptic swings (48 h memory)', `summer ${c.tSummer} °C · winter ${c.tWinter} °C mean`, 'Station AWS / met-mast thermometer'],
    [
      'Wind speed',
      'Katabatic seasonal mean + AR(1) variability (18 h memory); blizzards as Poisson events lasting 10-54 h (mean about 25 h), peak 21-34 m/s',
      `${c.windSummer} / ${c.windWinter} m/s summer / winter (assumed) · ${c.blizzardsPerMonthSummer} / ${c.blizzardsPerMonthWinter} blizzards per month`,
      'Met-mast anemometer + numerical weather forecast feed',
    ],
    ['Solar irradiance', `Solar-position algorithm [10] at ${Math.abs(st.lat).toFixed(2)}° S, clear-sky model × cloud cover, polar night included`, `mean cloud fraction ${c.cloudMean} · snow albedo 0.8`, 'Pyranometer, PV inverter logs'],
    ['Weather forecast', 'The twin’s own weather plus a forecast error that grows with lead time', '1-48 h ahead', 'NWP forecast received over the satellite link'],
    ['Electrical load', 'Crew-driven demand model (components below) + AR(1) noise of ±3.5 %', `mean ≈ ${kfmt(MODEL.metrics.stations[st.id].mean_load)} kW (test year)`, 'Feeder energy meters via SCADA'],
    ['Heat demand', 'Building heat-loss (UA) model + wind infiltration + occupant gains', `UA ${st.building.UA} kW/K · indoor ${st.building.tIn} °C (assumed)`, 'BMS / heat meters'],
    ['Crew on station', 'Seasonal roster: winter team, relief ramp-up, summer peak', `${st.crew.winter} winter · ${st.crew.summerPeak} summer`, 'Expedition roster'],
    ['Fuel in tanks', `Level set on ${fmtDate(REFERENCE_MS)} and depleted by the simulated burn; next vessel ${st.fuel.nextResupply}`, `tank ${st.fuel.tankKL} kL · reserve floor ${st.fuel.reserveKL} kL`, 'Tank gauges and fuel logs'],
    ['Sensor quality', 'Each channel can lag, drop out or send an out-of-range value; the load channel is validated and gap-filled', 'see Control Room → Data quality', 'SCADA quality flags'],
  ];

  const loadParts: [string, string, string][] = [
    ['Base services', `${L.base} kW, always on (assumed)`, 'powerhouse auxiliaries, IT and communications, ventilation, pumps, workshop standby'],
    ['Research equipment', `${L.science} kW (+30 % in the summer campaign)`, 'laboratories, observatories, instrument shelters'],
    ['Accommodation & galley', `${L.perCrew} kW per person × hourly activity profile`, 'meals, hot water, lighting; +0.12 kW per person in polar darkness; Sundays 8 % lower'],
    ['Heating auxiliaries', `7 % of heat demand + ${L.traceHeatPerK} kW per °C below 0 °C`, 'circulation pumps and fans, trace heating of water and fuel lines'],
    ...(L.ageos ? ([['Satellite ground station', '+7 kW at 10:00 and 22:00 local, +3.5 kW the hour after', 'AGEOS earth-observation passes (sun-synchronous orbits)']] as [string, string, string][]) : []),
    ['Water system (flexible)', `${L.waterPlantKW} kW for 4-10 h/day`, L.waterPlantName],
    ['Laundry & workshop (flexible)', '7 kW, 4 h Monday-Saturday', 'movable within 07:00-21:00'],
    ['Blizzard extras', '+4 kW while a blizzard lasts', 'snow-drift clearing fans, vestibule heating'],
  ];

  const assets: [string, React.ReactNode, React.ReactNode][] = [
    ['Gensets (today)', st.gens.map((g) => `${g.name} ${g.rated} kW`).join(' · '), <>{st.plant.gensetNote}{st.id === 'bharati' ? <> <C n={[2]} /></> : null}; minimum load {pct(st.gens[0].minFrac)}</>],
    ['Genset fuel curve', `F = ${DIESEL.F0}·P_rated + ${DIESEL.F1}·P  L/h`, <>linear fuel curve, the model form used in HOMER <C n={[11]} />; coefficients assumed - calibrate from station fuel logs</>],
    ['Genset heat recovery', `${st.heatRecovery} kWth per kWe`, st.id === 'bharati' ? <>CHP units <C n={[2]} />; recovery ratio assumed</> : <>assumed partial recovery - Maitri burns separate fuel for central heating <C n={[17]} /></>],
    ['Oil-fired boiler', `${pct(st.boilerEff)} efficient · ${DIESEL.LHV} kWh/L`, 'covers heat not met by recovery or the electric boiler'],
    ['Wind turbines (proposed)', `${st.wind.units} × ${st.wind.unitKW} kW, hub ${st.wind.hubHeight} m`, 'cold-climate class; cut-in 3, rated 11.5, cut-out 25 m/s, restart < 20 m/s; icing losses'],
    ['Solar PV (proposed)', `${st.pv.kWp} kWp, ${st.pv.tilt}° tilt, bifacial`, 'snow albedo 0.8, cold-cell efficiency gain, snow-cover losses after storms'],
    ['Battery, LFP (proposed)', `${B.kWh} kWh / ${B.kW} kW, SOC ${pct(B.socMin)}-${pct(B.socMax)}`, `${pct(B.etaC)} one-way efficiency, heated container`],
    ['Electric boiler (proposed)', `${st.p2hKW} kW`, 'power-to-heat: absorbs renewable surplus into the heating loop'],
    ['Optimiser costs', `start ${COSTS.START_L} L-eq · run-hour ${COSTS.RUNHOUR_L} L-eq · low-load ${COSTS.LOWLOAD_L} L-eq/h`, `min up/down ${MIN_UPDOWN_H} h · reserve ≥ ${pct(CONV_MARGIN - 1)} of load · N-1 with battery`],
    ['Economics', `₹250 per litre landed fuel (assumed) · CO₂ ${st.fuel.co2PerL} kg/L ${st.fuel.type}`, <>emission factor from <C n={[16]} />; costs editable in Capacity Planning</>],
  ];

  const todaySave = 1 - annual.today.fuel / annual.diesel.fuel;
  const hybSave = 1 - annual.ai.fuel / annual.diesel.fuel;
  const vsRule = 1 - annual.ai.fuel / annual.rule.fuel;

  return (
    <div className="stack">
      <div className="alert warn">
        <LuTriangleAlert className="warn" />
        <div>
          <b>Everything on this console is simulated.</b> HimUrja has no live NCPOR telemetry. Weather, demand and equipment behaviour come from a physics-based digital twin. Its parameters come from
          official station documents and published studies where these exist (table below) and from stated engineering assumptions elsewhere. The results show that the method works on realistic data;
          they are <b>not</b> measured savings at Maitri or Bharati.
        </div>
      </div>

      <Panel title="Official station data used in the twin" hint="published value · source · what the simulated year produces" right={<Badge kind="ok">CHECKED</Badge>}>
        <div className="tbl-wrap">
          <table className="tbl srcs">
            <thead>
              <tr>
                <th>Station</th>
                <th>Quantity</th>
                <th>Official / published value</th>
                <th>Source</th>
                <th>Digital twin</th>
              </tr>
            </thead>
            <tbody>
              {official.map((r) => (
                <tr key={r[0] + r[1]}>
                  <td>{r[0]}</td>
                  <td><b>{r[1]}</b></td>
                  <td>{r[2]}</td>
                  <td>{r[3].length ? <C n={r[3]} /> : <span className="muted">-</span>}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{r[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note mt">
          Values not in any public document (Maitri generator ratings and tank size, building heat loss, wind speeds, base loads, Bharati winter crew) are marked “assumed” and are editable. Base loads
          were tuned so that the diesel-only year matches the published fuel figures above.
        </div>
      </Panel>

      <Panel title="Data sources" hint={`what feeds each model · ${st.name} parameters`} right={<Badge kind="warn">SIMULATION</Badge>}>
        <div className="tbl-wrap">
          <table className="tbl srcs">
            <thead>
              <tr>
                <th>Quantity</th>
                <th>In this prototype</th>
                <th>Parameters</th>
                <th>In deployment</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((r) => (
                <tr key={r[0]}>
                  <td><b>{r[0]}</b></td>
                  <td className="muted">{r[1]}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{r[2]}</td>
                  <td>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Load model" hint="electrical demand is the sum of these parts, hour by hour">
        <div className="tbl-wrap">
          <table className="tbl srcs">
            <thead>
              <tr>
                <th>Component</th>
                <th>Size</th>
                <th>What it represents</th>
              </tr>
            </thead>
            <tbody>
              {loadParts.map((r) => (
                <tr key={r[0]}>
                  <td><b>{r[0]}</b></td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{r[1]}</td>
                  <td className="muted">{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note mt">Heating is a separate thermal demand (kWth), met by genset heat recovery, the electric boiler and the oil-fired boiler, in that order of cost.</div>
      </Panel>

      <Panel title="Energy assets & engineering values" hint={`${st.name} · today's plant + the proposed retrofit`}>
        <div className="tbl-wrap">
          <table className="tbl srcs">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Value</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((r) => (
                <tr key={r[0]}>
                  <td><b>{r[0]}</b></td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{r[1]}</td>
                  <td className="muted">{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid g-half">
        <Panel title="How the headline numbers are produced">
          <ul className="plain">
            <li>
              <b>Annual fuel:</b> 12 representative weeks (one per month, from the 10th), each scaled to its month. All four strategies run on identical weather and demand.
            </li>
            <li>
              <b>Diesel-only:</b> today&apos;s plant (gensets only) with a fixed {pct(CONV_MARGIN - 1)} spinning margin.
            </li>
            <li>
              <b>Today + HimUrja:</b> the same gensets, scheduled by the optimiser - what the software can do before any new hardware is installed.
            </li>
            <li>
              <b>Rule-based hybrid:</b> the proposed wind, PV and battery run as fuel-savers under fixed rules, with no forecast: gensets stay committed on load with the same {pct(CONV_MARGIN - 1)} margin
              as today, and wind, PV and the battery only reduce their loading (a common first retrofit). Comparing HimUrja against it isolates what forecasting and optimal commitment add.
            </li>
            <li>
              <b>HimUrja hybrid:</b> the proposed retrofit run by the forecast <C n={[3, 4]} /> and the unit-commitment optimiser <C n={[5, 6]} />.
            </li>
            <li>
              <b>Forecast accuracy:</b> {MODEL.metrics.test_rows.toLocaleString()} forecasts on a simulated year the model never saw (Load Forecast → Model validation).
            </li>
          </ul>
        </Panel>
        <Panel title="Limitations - what is not yet proven">
          <ul className="plain">
            <li>No station telemetry is public. The demand model is calibrated only to published annual totals (fuel, fuel farm, peak heat); hourly shapes are assumptions until checked on meter logs.</li>
            <li>Maitri generator ratings and tank size, building heat loss, wind climate and Bharati&apos;s winter crew are assumptions.</li>
            <li>The weather generator matches published statistics <C n={[12, 13]} />, not a specific historical year.</li>
            <li>Hourly resolution: frequency, voltage and motor-start transients are handled by genset governors and the battery inverter, not modelled here.</li>
            <li>
              On today&apos;s plant the optimiser alone saves only {pct(todaySave, 1)} of fuel at {st.name}. The headline saving ({pct(hybSave)} against diesel-only, {pct(vsRule)} against rule-based
              control of the same hardware) needs the proposed wind, PV and battery to be installed.
            </li>
          </ul>
          <div className="eyebrow" style={{ marginTop: 10 }}>How Phase 1 closes the gap</div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            One season in shadow mode at Maitri: read-only data from meters and genset controllers, retrain the forecast on real load, calibrate the heat-loss and fuel curves, and compare HimUrja&apos;s
            recommendations with the fuel actually logged.
          </p>
        </Panel>
      </div>

      <Panel title="References" hint="IEEE style · numbered as in our presentation and portal submission">
        <ol className="refs">
          {REFS.map((r, i) => (
            <li key={i}>
              <span className="rn">[{i + 1}]</span>
              <span>
                {refRuns(r).map(([t, it], k) => (it ? <i key={k}>{t}</i> : <React.Fragment key={k}>{t}</React.Fragment>))}
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
