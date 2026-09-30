// Generates the training / calibration / test dataset for the load-forecasting model
// from the station digital twin.   Run:  npx tsx scripts/export-dataset.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { STATION_LIST } from '../src/sim/stations';
import { buildYear, weatherForecast, appSeed } from '../src/sim/dataset';
import { FEATURES, featureRow, recentMean } from '../src/ai/features';
import { mulberry32 } from '../src/sim/rng';

mkdirSync('ml/data', { recursive: true });
const lines: string[] = [['role', 'year', ...FEATURES, 'target'].join(',')];
const rand = mulberry32(42);

for (const st of STATION_LIST) {
  const years: [string, number][] = [
    ['train', st.seed * 7 + 2023],
    ['train', st.seed * 7 + 2024],
    ['train', st.seed * 7 + 2025],
    ['calib', st.seed * 7 + 2022],
    ['test', appSeed(st)],
  ];
  for (const [role, seed] of years) {
    const y = buildYear(st, seed);
    for (let o = 168; o < 8760 - 49; o += 5) {
      const fc = weatherForecast(y, o, 48);
      const r24 = recentMean(y, o);
      for (let j = 0; j < 8; j++) {
        const k = 1 + Math.floor(rand() * 48);
        const t = o + k - 1;
        const row = featureRow(y, t, k, fc.temp[k - 1], fc.wind[k - 1], fc.bliz[k - 1], r24);
        lines.push([role, seed, ...row.map((v) => +v.toFixed(4)), y.dem.crit[t].toFixed(3)].join(','));
      }
    }
    console.log(st.id, role, seed, 'done');
  }
}
writeFileSync('ml/data/load_dataset.csv', lines.join('\n'));
console.log('rows', lines.length - 1);
