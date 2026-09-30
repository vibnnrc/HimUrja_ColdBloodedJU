# HimUrja - AI-Driven Smart Energy Management for Polar Research Stations

**SIH 2026 · PS 26061 (Ministry of Earth Sciences / NCPOR) · Clean & Green Technology · Team Cold Blooded JU, Jadavpur University**

HimUrja (*Him* = snow, *Urja* = energy) is an offline-first energy-management system for India's Antarctic stations **Maitri** and **Bharati**. It runs today's gensets and the wind, solar PV and battery that we propose to add (none is described in the station documents). It forecasts station demand with machine learning, forecasts wind/solar with physics, and computes the fuel-optimal hourly schedule of gensets, battery, electric boiler and flexible loads - explaining every decision in plain language.

### YOUTUBE DEMO VIDEO LINK : https://youtu.be/pVfLimNKBWc?si=-6_dAU5cdrUUmZnL
### LIVE WEBSITE LINK : https://himurja.vercel.app

## What the prototype does

| Module | What it shows |
|---|---|
| Control Room | Console identity line (station, mode, data source = simulation, last update), system status strip, one-line decision flow (now → 24 h forecast → this hour's dispatch → 48 h fuel impact: diesel-only, hybrid on rules, hybrid + HimUrja), IEC-style single-line diagram with live power flow, Antarctica map with both stations, telemetry data-quality panel, operations log, 72 h history + 48 h plan |
| Load Forecast | 24 h outlook with the physical drivers of demand change, gradient-boosted-tree load forecast with split-conformal P10-P90 bands, measured data with rejected samples and gap filling, renewable & heating forecast, accuracy vs baselines, validation on the simulated dataset (MAE, RMSE, bias, error distribution, how the data was generated), live back-test |
| Economic Dispatch | This hour's set-points: rule-based vs optimised, 48 h comparison of diesel-only / rule-based / optimised, exact dynamic-programming unit commitment, decision log with "Why?" (reasons + action), operating-constraints table (min load, start cost, min up/down time, start-up time, fuel curve, SOC and power limits, renewable variability, spinning reserve, N-1, critical vs flexible load) showing where the plan sits against each |
| Fuel Endurance | Fuel reserve in litres, endurance (days/hours), resupply planning with ship-delay what-if, annual fuel, cost and CO2 for diesel-only today, today + HimUrja, rule-based hybrid and HimUrja hybrid |
| Load Management | Load tiers, flexible-load scheduling into renewable surplus, emergency load-shed ladder |
| Asset Health | EWMA control charts on genset fuel consumption, turbine icing detection, PV snow detection, service planning |
| Scenario Simulation | Define temperature, wind, solar, blizzard, crew, generator failures and ship delay; compare baseline vs scenario (incl. diesel per day, critical load served, fuel on vessel arrival), get a one-line "HimUrja recommends" and see how the optimiser responds |
| Capacity Planning | Annual energy balance for any wind/PV/battery size + sizing search over 80 configurations ranked by 15-year cost |
| Data & Assumptions | Official station data used in the twin (value, source, what the twin produces), every data source (prototype vs deployment), the load model, asset sizes (today's plant vs proposed retrofit), how the headline numbers are produced, limitations, IEEE reference list |
| System Architecture | Five-layer design (field, ingestion, forecasting, optimisation, HMI), digital twin, roadmap |

Telemetry in the digital twin is deliberately imperfect: every channel can be delayed, drop out or send implausible values. The load
channel is validated (range and rate-of-change checks) and gap-filled before it reaches the forecaster (`src/sim/telemetry.ts`).

## Key results (simulated, per station per year)

| | Maitri | Bharati |
|---|---|---|
| Diesel-only today (kL) | 334.9 | 240.1 |
| Today's gensets + HimUrja (kL) | 333.6 (-0.4%) | 238.9 (-0.5%) |
| Proposed hybrid, rule-based (kL) | 268.5 | 186.6 |
| Proposed hybrid + HimUrja (kL) | 196.4 | 116.2 |
| HimUrja hybrid vs diesel-only | -41% | -52% |
| HimUrja hybrid vs rule-based hybrid | -27% | -38% |
| Renewable share (rules -> HimUrja) | 37% -> 54% | 43% -> 71% |
| Genset run-hours (diesel-only -> HimUrja hybrid) | 11,337 -> 3,384 | 12,109 -> 2,352 |
| CO2 (t, diesel-only -> HimUrja hybrid) | 897 -> 526 | 605 -> 293 |

- On today's gensets alone, better scheduling saves under 1%; the fuel savings need the proposed wind + PV + battery.
- Rule-based hybrid = gensets committed on load with the same 30% margin as today; wind, PV and the battery only reduce genset loading (fuel-saver rules, no forecast).
- 0 kWh unserved in 80 blizzard + genset-trip stress tests (both stations, start times spread over the year); median 23% less fuel than rule-based control.
- Load forecast on a held-out *simulated* year: MAPE 3.57% / 3.62% (Maitri / Bharati) vs 6.75% / 6.10% seasonal-naive; MAE 2.48 / 2.04 kW; RMSE 3.10 / 2.61 kW; 81.6% of actuals inside the 80% band. This measures the pipeline on twin data, not accuracy on real station meters.
- Twin checks against published data: Maitri power-generation fuel 249 kL/yr vs 240 kL published (Datta et al., 2002); 22 blizzards/yr vs about 21 (Lal & Ram, 2009); mean temperature -9.7 C vs about -9.5 C (Chug & Soni, 2026); Bharati peak heat 156 kWth vs about 155 kWth (NCAOR tender NCAOR/LH(20)/2017).

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Retrain the forecasting model (optional):

```bash
npx tsx scripts/export-dataset.ts   # generates ml/data/load_dataset.csv from the digital twin
python3 ml/train.py                 # trains GBT, calibrates conformal intervals, exports src/ai/model.json
```

## Code map

```
src/sim/        digital twin: weather generator, solar geometry, demand model, asset physics, telemetry faults
src/ai/         feature engineering (shared by training & inference), GBT inference, conformal bands
src/opt/        DP optimiser + baselines, smart load scheduler, annual projection
src/engine.ts   model-predictive control loop, explanations (reasons + action), fuel endurance
src/ops.ts      operations log (events from dispatch history, weather and telemetry)
src/pages/      the 10 screens;  src/ui/  SVG charts, single-line diagram, Antarctica map, UI kit
ml/train.py     scikit-learn training pipeline and model export
```

## Important note on data

Real station telemetry is not public, so the prototype runs on a physics-based digital twin. Its parameters come from official station documents and published studies where these exist (listed with sources on the Data & Assumptions page and in `src/refs.ts`); everything else is a marked, editable assumption. In deployment the same engine reads live SCADA, energy-meter and met-mast data (Phase 1: shadow mode for one season).
