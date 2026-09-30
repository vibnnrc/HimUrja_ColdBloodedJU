// Solar geometry (NOAA / Spencer series). Accurate to ~0.5 deg, which is plenty for
// polar-day / polar-night detection and PV yield at 70 deg S.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface SunPos {
  elevation: number; // deg above horizon
  azimuth: number; // deg clockwise from true north
  declination: number; // deg
}

export function sunPosition(latDeg: number, lonDeg: number, dayOfYear: number, hourUTC: number): SunPos {
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourUTC - 12) / 24);
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const trueSolarMin = hourUTC * 60 + eqTime + 4 * lonDeg;
  const ha = (trueSolarMin / 4 - 180) * D2R;
  const lat = latDeg * D2R;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const elevation = 90 - zen * R2D;
  // azimuth from south, positive westward, then converted to "from north, clockwise"
  const azS = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
  let azimuth = azS * R2D + 180;
  if (azimuth >= 360) azimuth -= 360;
  return { elevation, azimuth, declination: decl * R2D };
}

/** Clear-sky irradiance (Meinel DNI + simple diffuse), W/m2. */
export function clearSky(elevationDeg: number) {
  if (elevationDeg <= 0) return { dni: 0, dhi: 0, ghi: 0 };
  const e = elevationDeg;
  const am = 1 / (Math.sin(e * D2R) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
  // Antarctic air is very clean and dry, so a slightly higher transmittance than mid-latitudes.
  const dni = 1361 * Math.pow(0.74, Math.pow(am, 0.678));
  const dhi = 0.09 * dni;
  const ghi = dni * Math.sin(e * D2R) + dhi;
  return { dni, dhi, ghi };
}

/**
 * Plane-of-array irradiance for a tilted, bifacial array facing true north
 * (the equator-facing direction in the southern hemisphere). Snow albedo is high (~0.8),
 * which is why steep/vertical bifacial PV works well in Antarctica.
 */
export function planeOfArray(
  elevationDeg: number,
  azimuthDeg: number,
  cloud: number,
  tiltDeg: number,
  panelAzDeg = 0,
  albedo = 0.8,
  bifaciality = 0.5,
) {
  const cs = clearSky(elevationDeg);
  if (cs.ghi <= 0) return { ghi: 0, poa: 0 };
  const beamFactor = Math.pow(1 - cloud, 1.6);
  const dni = cs.dni * beamFactor;
  const dhi = cs.dhi + 0.28 * cloud * cs.dni * Math.sin(elevationDeg * D2R);
  const ghi = dni * Math.sin(elevationDeg * D2R) + dhi;
  const b = tiltDeg * D2R;
  const e = elevationDeg * D2R;
  const cosInc = Math.sin(e) * Math.cos(b) + Math.cos(e) * Math.sin(b) * Math.cos((azimuthDeg - panelAzDeg) * D2R);
  const front = dni * Math.max(0, cosInc) + dhi * (1 + Math.cos(b)) / 2 + ghi * albedo * (1 - Math.cos(b)) / 2;
  const cosIncRear = -cosInc;
  const rear = dni * Math.max(0, cosIncRear) + dhi * (1 - Math.cos(b)) / 2 + ghi * albedo * (1 + Math.cos(b)) / 2;
  return { ghi, poa: front + bifaciality * rear };
}
