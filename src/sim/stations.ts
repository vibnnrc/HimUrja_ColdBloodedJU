// Station configurations.
// OFFICIAL / PUBLISHED values (see Data & Assumptions page for the full source list):
//   Maitri  - position, altitude, capacity 65 summer / 25 winter: NCPOR planning advisory AL/03 (2019);
//             annual liquid fuel 360 kL of which 240 kL for power generation: Datta et al., J. Power Sources, 2002;
//             ~21 blizzards a year, mean duration ~25 h: Lal & Ram, MAUSAM, 2009; mean annual temperature ~ -9.5 C: Chug & Soni, JESS, 2026.
//   Bharati - three 100 kVA diesel CHP units on Jet A-1,
//             capacity 47 year-round + 13 in summer shelters (60 total), fuel farm ~296 kL, peak thermal demand ~155 kWth,
//             sea-water RO plant: NCAOR tender NCAOR/LH(20)/2017.
// ASSUMED values (not published) are marked "assumed" and are editable. Neither station has wind, PV or a
// battery today: those assets are the PROPOSED hybrid retrofit that HimUrja is evaluated with.

export type StationId = 'maitri' | 'bharati';

export interface GenSet {
  id: string;
  name: string;
  rated: number; // kW electrical
  minFrac: number; // minimum continuous loading (wet-stacking limit)
  runHours: number; // hours since commissioning (for maintenance module)
  hoursSinceService: number;
}

export interface StationConfig {
  id: StationId;
  name: string;
  fullName: string;
  region: string;
  lat: number;
  lon: number;
  elevation: number;
  established: string;
  seed: number;
  climate: {
    tSummer: number;
    tWinter: number;
    windSummer: number; // mean 10 m wind, m/s
    windWinter: number;
    blizzardsPerMonthSummer: number;
    blizzardsPerMonthWinter: number;
    cloudMean: number;
  };
  building: { UA: number; tIn: number; fixedHeat: number };
  crew: { winter: number; summerPeak: number; rampUpStart: number; peakStart: number; peakEnd: number; winterStart: number };
  load: {
    base: number;
    science: number;
    perCrew: number;
    traceHeatPerK: number;
    ageos: boolean; // Bharati hosts the Antarctic Ground Station for Earth Observation Satellites
    waterPlantKW: number;
    waterPlantName: string;
  };
  gens: GenSet[];
  wind: { units: number; unitKW: number; hubHeight: number };
  pv: { kWp: number; tilt: number };
  battery: { kWh: number; kW: number; socMin: number; socMax: number; etaC: number; etaD: number };
  p2hKW: number; // electric boiler that turns surplus renewables into useful heat
  boilerEff: number;
  heatRecovery: number; // kWth recovered per kWe from genset jacket-water + exhaust
  fuel: { tankKL: number; levelKL: number; reserveKL: number; nextResupply: string; shipName: string; type: string; co2PerL: number };
  plant: { gensetNote: string; renewablesInstalled: boolean };
}

export const STATIONS: Record<StationId, StationConfig> = {
  maitri: {
    id: 'maitri',
    name: 'Maitri',
    fullName: 'Maitri Research Station',
    region: 'Schirmacher Oasis, Dronning Maud Land',
    lat: -70.76683, // NCPOR advisory AL/03
    lon: 11.73078,
    elevation: 117, // NCPOR advisory AL/03
    established: '1988-89',
    seed: 1989,
    climate: {
      tSummer: 0.5,
      tWinter: -16.5, // gives a mean annual temperature of about -9.5 C (Chug & Soni 2026)
      windSummer: 6.0, // assumed
      windWinter: 9.0, // assumed
      blizzardsPerMonthSummer: 0.5, // tuned to ~21 blizzards a year, 3-4 a month Apr-Aug (Lal & Ram 2009)
      blizzardsPerMonthWinter: 3.4,
      cloudMean: 0.5, // assumed
    },
    building: { UA: 3.0, tIn: 20, fixedHeat: 6 }, // assumed; heating fuel checked against Datta et al. 2002
    crew: { winter: 25, summerPeak: 65, rampUpStart: 305, peakStart: 335, peakEnd: 45, winterStart: 72 }, // capacity: NCPOR advisory
    load: {
      base: 24, // assumed - tuned so diesel-only generation uses ~240 kL/yr (Datta et al. 2002)
      science: 8,
      perCrew: 0.7,
      traceHeatPerK: 0.35,
      ageos: false,
      waterPlantKW: 8,
      waterPlantName: 'Lake water pump house & line heating',
    },
    gens: [
      // generator ratings are not published - assumed three 125 kVA (100 kW) diesel sets
      { id: 'DG1', name: 'DG-1', rated: 100, minFrac: 0.3, runHours: 38420, hoursSinceService: 212 },
      { id: 'DG2', name: 'DG-2', rated: 100, minFrac: 0.3, runHours: 36980, hoursSinceService: 431 },
      { id: 'DG3', name: 'DG-3', rated: 100, minFrac: 0.3, runHours: 21155, hoursSinceService: 96 },
    ],
    // PROPOSED hybrid retrofit (not described in the station documents)
    wind: { units: 2, unitKW: 60, hubHeight: 30 },
    pv: { kWp: 60, tilt: 70 },
    battery: { kWh: 400, kW: 150, socMin: 0.2, socMax: 0.95, etaC: 0.96, etaD: 0.96 },
    p2hKW: 100,
    boilerEff: 0.85,
    heatRecovery: 0.4, // assumed partial recovery - Maitri burns separate fuel for central heating (Datta et al. 2002)
    fuel: { tankKL: 450, levelKL: 175, reserveKL: 60, nextResupply: '2027-01-08', shipName: 'expedition vessel (46th ISEA)', type: 'Diesel (assumed)', co2PerL: 2.68 },
    plant: { gensetNote: 'three diesel gensets; ratings not published, 3 × 100 kW assumed', renewablesInstalled: false },
  },
  bharati: {
    id: 'bharati',
    name: 'Bharati',
    fullName: 'Bharati Research Station',
    region: 'Larsemann Hills, Prydz Bay',
    lat: -69.40683, // 69 deg 24.41' S (NCPOR station page)
    lon: 76.19533, // 76 deg 11.72' E
    elevation: 35,
    established: '2012',
    seed: 2012,
    climate: {
      tSummer: 0.8, // assumed
      tWinter: -16.5,
      windSummer: 5.5,
      windWinter: 8.0,
      blizzardsPerMonthSummer: 0.4,
      blizzardsPerMonthWinter: 2.8,
      cloudMean: 0.55,
    },
    building: { UA: 2.35, tIn: 20, fixedHeat: 5 }, // tuned to the published peak thermal demand of ~155 kWth
    crew: { winter: 25, summerPeak: 60, rampUpStart: 320, peakStart: 350, peakEnd: 55, winterStart: 82 }, // 47 + 13 = 60 capacity (NCAOR tender); winter team assumed 25
    load: {
      base: 20, // assumed - sized so the annual fuel use fits the ~296 kL fuel farm (NCAOR) with a reserve
      science: 8,
      perCrew: 0.5,
      traceHeatPerK: 0.25,
      ageos: true,
      waterPlantKW: 10,
      waterPlantName: 'Sea-water RO desalination plant (Quilty Bay intake)',
    },
    gens: [
      // three 100 kVA diesel CHP units (NCAOR tender) = 80 kW each at 0.8 power factor
      { id: 'DG1', name: 'CHP-1', rated: 80, minFrac: 0.3, runHours: 29810, hoursSinceService: 388 },
      { id: 'DG2', name: 'CHP-2', rated: 80, minFrac: 0.3, runHours: 30275, hoursSinceService: 146 },
      { id: 'DG3', name: 'CHP-3', rated: 80, minFrac: 0.3, runHours: 12040, hoursSinceService: 477 },
    ],
    // PROPOSED hybrid retrofit (not described in the station documents)
    wind: { units: 2, unitKW: 60, hubHeight: 30 },
    pv: { kWp: 80, tilt: 70 },
    battery: { kWh: 400, kW: 150, socMin: 0.2, socMax: 0.95, etaC: 0.96, etaD: 0.96 },
    p2hKW: 100,
    boilerEff: 0.85,
    heatRecovery: 1.1, // CHP units: assumed 1.1 kWth recovered per kWe (typical small diesel CHP)
    fuel: { tankKL: 296, levelKL: 150, reserveKL: 40, nextResupply: '2027-01-28', shipName: 'expedition vessel (46th ISEA)', type: 'Jet A-1', co2PerL: 2.52 },
    plant: { gensetNote: 'three 100 kVA diesel CHP units on Jet A-1, as in the NCAOR tender', renewablesInstalled: false },
  },
};

export const STATION_LIST = [STATIONS.maitri, STATIONS.bharati];

// Physical constants / engineering coefficients used across the twin.
export const DIESEL = {
  F0: 0.08145, // L/h per kW rated  (no-load fuel; linear fuel curve as in HOMER, typical value)
  F1: 0.246, // L/h per kW output (incremental fuel)
  LHV: 9.95, // kWh per litre
  CO2: 2.68, // kg CO2 per litre diesel (IPCC 2006 default factors); Jet A-1 2.52 kg/L - see StationConfig.fuel.co2PerL
};

export const HOURS_PER_YEAR = 8760;
