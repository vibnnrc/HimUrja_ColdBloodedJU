// Physical models of generation assets: cold-climate wind turbine, bifacial PV,
// diesel gensets (Willans-line fuel curve), electric boiler and oil-fired boiler.

import { DIESEL, GenSet } from './stations';

const P_ATM = 98500; // Pa, typical coastal Antarctic surface pressure
const RHO0 = 1.225;

/** Wind speed at hub height from 10 m measurement (power-law shear, exponent 0.12 over snow). */
export const hubWind = (v10: number, hub = 30) => v10 * Math.pow(hub / 10, 0.12);

/** Air density ratio vs standard - cold polar air carries ~10-15% more power. */
export const densityRatio = (tempC: number) => P_ATM / (287.05 * (tempC + 273.15)) / RHO0;

/**
 * Normalised power (0..1 of rated) of a 100 kW-class cold-climate turbine.
 * cut-in 3 m/s, rated 11.5 m/s, storm cut-out 25 m/s with restart below 20 m/s (hysteresis).
 */
export function turbinePU(vHub: number, tempC: number, icing: number, stormedOut: boolean) {
  const VCI = 3,
    VR = 11.5;
  if (stormedOut || vHub < VCI) return 0;
  let p = vHub >= VR ? 1 : ((vHub ** 3 - VCI ** 3) / (VR ** 3 - VCI ** 3)) * densityRatio(tempC);
  p = Math.min(1, p);
  return p * (1 - icing) * 0.97;
}

/** Normalised PV AC output per kWp from plane-of-array irradiance. Cold cells are more efficient. */
export function pvPU(poa: number, tempC: number, snowLoss: number) {
  if (poa <= 0) return 0;
  const tCell = tempC + 0.025 * poa;
  const p = (poa / 1000) * (1 - 0.0037 * (tCell - 25)) * 0.86 * (1 - snowLoss);
  return Math.max(0, Math.min(1.1, p));
}

/** Fuel burn of a running genset (L/h) - Willans line: F = F0*rated + F1*P. */
export const gensetFuel = (g: GenSet, p: number) => DIESEL.F0 * g.rated + DIESEL.F1 * p;

/** Litres of diesel burnt in an oil-fired boiler for q kWh of heat. */
export const boilerFuel = (q: number, eff: number) => q / (eff * DIESEL.LHV);

/** Specific fuel consumption (L/kWh) at a loading fraction - shows why low-load running wastes fuel. */
export const sfcAtLoad = (g: GenSet, frac: number) => gensetFuel(g, g.rated * frac) / (g.rated * frac);
