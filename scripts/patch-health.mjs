// Runs after `npm install` / `npm ci`.
// @capgo/capacitor-health can sum active calories over a time range but not
// total calories, and Google Health (Fitbit) only writes total calories to
// Health Connect. This adds total calories to the plugin's aggregation, the
// same way it already handles active calories (three small additions).
// Idempotent; fails loudly if the plugin source no longer matches.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../node_modules/@capgo/capacitor-health/android/src/main/java/app/capgo/plugin/health/HealthManager.kt', import.meta.url);
if (!existsSync(file)) {
  console.log('patch-health: plugin not installed, nothing to do');
  process.exit(0);
}

const MARK = '// logbook: total calories aggregation';
let src = readFileSync(file, 'utf8');
if (src.includes(MARK)) {
  console.log('patch-health: already applied');
  process.exit(0);
}

const edits = [
  [
    '            HealthDataType.CALORIES,\n            HealthDataType.HYDRATION,',
    '            HealthDataType.CALORIES,\n            HealthDataType.TOTAL_CALORIES,\n            HealthDataType.HYDRATION,',
  ],
  [
    '        HealthDataType.CALORIES -> setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)\n',
    '        HealthDataType.CALORIES -> setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)\n' +
      `        HealthDataType.TOTAL_CALORIES -> setOf(TotalCaloriesBurnedRecord.ENERGY_TOTAL) ${MARK}\n`,
  ],
  [
    '            HealthDataType.CALORIES -> result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories\n',
    '            HealthDataType.CALORIES -> result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories\n' +
      '            HealthDataType.TOTAL_CALORIES -> result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories\n',
  ],
];

for (const [from, to] of edits) {
  const count = src.split(from).length - 1;
  if (count !== 1) {
    console.error(`patch-health: expected one match, found ${count}:\n${from}`);
    process.exit(1);
  }
  src = src.replace(from, to);
}
if (!src.includes('import androidx.health.connect.client.records.TotalCaloriesBurnedRecord')) {
  console.error('patch-health: TotalCaloriesBurnedRecord import missing');
  process.exit(1);
}
writeFileSync(file, src);
console.log('patch-health: total calories aggregation added');
