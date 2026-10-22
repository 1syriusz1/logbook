// Run with: npm test
import assert from 'node:assert/strict';
import { e1rm, computePRs, summarize, toExMap, exerciseSessions, exerciseRecords, heatThresholds, heatLevel, dayStats, weekStreak, autoTitle, weeklySeries, rangeStart } from '../src/lib/stats';
import { LIBRARY, defaultLoad, equipmentLabel } from '../src/lib/exercises';
import { prLabel } from '../src/lib/labels';
import { fmtNum, fmtClock, fmtDur, parseNum, startOfWeek, dayKey, fmtKg } from '../src/lib/format';
import type { Workout } from '../src/lib/types';
import {
  clean,
  coverage,
  decodeSeries,
  entryHeart,
  exerciseBlocks,
  heartView,
  heatLevels,
  isHeartDue,
  loadOf,
  pickSource,
  processHeart,
  prorateKcal,
  SETTLE_MS,
  zoneOf,
  zoneSeconds,
  type RawSample,
} from '../src/lib/heart';
import { buildNights, morningOf, perMorning, overlapsWorkout } from '../src/lib/wellness';
import { baseline, computeReadiness, curve, muscleFreshness, performanceIndex, readinessHistory, spearman, suggestWorkout, type ReadinessInput } from '../src/lib/readiness';
import type { DayHealth, HeartData } from '../src/lib/types';
import { addDays as addD, startOfDay as sod } from '../src/lib/format';

const ex = toExMap(LIBRARY);
const D = 86400000;
const base = new Date(2026, 9, 5, 18, 0).getTime(); // Mon 5 Oct 2026 18:00
let n = 0;
const w = (dayOffset: number, entries: [string, [number, number][]][], dur = 60): Workout => {
  const start = base + dayOffset * D;
  return {
    id: 'w' + ++n,
    startedAt: start,
    endedAt: start + dur * 60000,
    entries: entries.map(([id, sets], i) => ({ id: `e${n}-${i}`, exerciseId: id, sets: sets.map(([kg, reps], j) => ({ id: `s${n}-${i}-${j}`, kg, reps, at: start + (i * 10 + j) * 60000 })) })),
  };
};

// e1RM
assert.equal(e1rm(100, 1), 100);
assert.equal(Math.round(e1rm(100, 5) * 10) / 10, 116.7);
assert.equal(e1rm(0, 5), 0);

// PRs: first session never counts; heavier weight and better e1RM later do
const ws = [
  w(0, [['bench-press', [[80, 8], [80, 8], [82.5, 6]]]]),
  w(3, [['bench-press', [[80, 8], [85, 5], [80, 9]]]]),
  w(7, [['bench-press', [[85, 5]]], ['pull-up', [[0, 8]]]]),
  w(10, [['pull-up', [[0, 10], [0, 7]]]]),
];
const prs = computePRs(ws, ex);
assert.equal([...prs.keys()].filter((k) => k.startsWith('s1-')).length, 0, 'first session has no PRs');
assert.deepEqual(prs.get('s2-0-1'), ['weight'], '85x5 is heavier than 82.5 but its e1RM (99.2) is below 101.3');
assert.deepEqual(prs.get('s2-0-2'), ['e1rm'], '80x9 = 104 e1rm');
assert.equal(prs.get('s3-0-0'), undefined, 'repeat of 85x5 is not a PR');
assert.equal(prs.get('s3-1-0'), undefined, 'first pull-up session');
assert.deepEqual(prs.get('s4-0-0'), ['reps'], 'more bodyweight reps');

// weighted pull-ups: added-weight records and rep records at the same or heavier load
const wp = [
  w(14, [['weighted-pull-up', [[20, 6], [10, 10]]]]),
  w(17, [['weighted-pull-up', [[10, 11], [25, 5], [20, 7], [10, 8]]]]),
];
const wprs = computePRs(wp, ex);
assert.equal([...wprs.keys()].filter((k) => k.startsWith(`s${n - 1}-`)).length, 0, 'first weighted session sets the baseline');
assert.deepEqual(wprs.get(`s${n}-0-0`), ['reps'], '+10 kg x 11 beats +10 kg x 10');
assert.deepEqual(wprs.get(`s${n}-0-1`), ['weight', 'reps'], '+25 kg is the heaviest added load');
assert.deepEqual(wprs.get(`s${n}-0-2`), ['reps'], '+20 kg x 7 beats +20 kg x 6');
assert.equal(wprs.get(`s${n}-0-3`), undefined, '+10 kg x 8 is not a record');
assert.equal(prLabel(['reps'], { kg: 20 }, { kind: 'bodyweight' }), 'Most reps at +20 kg');
assert.equal(prLabel(['weight', 'reps'], { kg: 25 }, { kind: 'bodyweight' }), 'Heaviest added weight');
assert.equal(prLabel(['reps'], { kg: 0 }, { kind: 'bodyweight' }), 'Most reps');
assert.equal(prLabel(['weight'], { kg: 100 }, { kind: 'weighted' }), 'Heaviest weight');
const wpu = LIBRARY.find((e) => e.id === 'weighted-pull-up')!;
const wdip = LIBRARY.find((e) => e.id === 'weighted-dip')!;
assert.ok(wpu.loaded && wpu.kind === 'bodyweight' && wpu.muscle === 'back');
assert.ok(wdip.loaded && wdip.kind === 'bodyweight' && wdip.muscle === 'chest');
assert.ok(LIBRARY.some((e) => e.id === 'weighted-chin-up' && e.loaded));
assert.deepEqual(defaultLoad(wpu), { kg: 10, reps: 6 });
assert.equal(equipmentLabel(wdip), 'Bodyweight + kg');
assert.equal(new Set(LIBRARY.map((e) => e.id)).size, LIBRARY.length, 'library ids are unique');

// sessions & records
const sess = exerciseSessions(ws, 'bench-press');
assert.equal(sess.length, 3);
assert.equal(sess[1].topKg, 85);
assert.equal(sess[1].topReps, 5);
const rec = exerciseRecords(sess);
assert.equal(rec.heaviest!.kg, 85);
assert.equal(rec.mostReps!.reps, 9);
assert.deepEqual(rec.repMaxes.map((r) => [r.reps, r.kg]), [[1, 85], [3, 85], [5, 85], [8, 80]]);

// summaries & titles
const s1 = summarize(ws[0], ex);
assert.equal(s1.sets, 3);
assert.equal(s1.volume, 80 * 8 * 2 + 82.5 * 6);
assert.equal(s1.title, 'Chest');
assert.equal(s1.durationMs, 3600000);
assert.equal(autoTitle([['chest', 7], ['shoulders', 6], ['triceps', 3]]), 'Chest + Shoulders + Triceps');
assert.equal(autoTitle([['back', 12], ['biceps', 3], ['shoulders', 3]]), 'Back + Biceps + Shoulders');
assert.equal(autoTitle([['chest', 6], ['back', 3], ['shoulders', 3], ['biceps', 3], ['triceps', 3]]), 'Upper body');
assert.equal(autoTitle([['legs', 6], ['chest', 3], ['back', 3], ['shoulders', 3]]), 'Full body');
assert.equal(autoTitle([]), 'Workout');

// live workout: planned exercises shape the name
const live: Workout = { id: 'live', startedAt: base, endedAt: null, entries: [
  { id: 'a', exerciseId: 'bench-press', sets: [{ id: 'x', kg: 60, reps: 8, at: base }] },
  { id: 'b', exerciseId: 'barbell-row', sets: [] },
  { id: 'c', exerciseId: 'overhead-press', sets: [] },
  { id: 'd', exerciseId: 'barbell-curl', sets: [] },
  { id: 'e', exerciseId: 'triceps-pushdown', sets: [] },
] };
assert.equal(summarize(live, ex, base + 600000).title, 'Upper body');
assert.equal(summarize(live, ex, base + 600000).durationMs, 600000);

// heatmap thresholds and levels
const days = dayStats(ws.map((x) => summarize(x, ex)));
const t = heatThresholds(days);
assert.deepEqual(t, [8, 14, 20], 'fixed thresholds before 8 training days');
assert.equal(heatLevel(0, t), 0);
assert.equal(heatLevel(3, t), 1);
assert.equal(heatLevel(14, t), 2);
assert.equal(heatLevel(25, t), 4);

// streak counts whole weeks, current week keeps it alive
const sums = ws.map((x) => summarize(x, ex));
assert.equal(weekStreak(sums, base + 11 * D), 2);
assert.equal(weekStreak(sums, base + 20 * D), 2, 'week without workout yet keeps last week streak');
assert.equal(weekStreak(sums, base + 30 * D), 0);

// weekly series
const weeks = weeklySeries(sums, base, base + 13 * D);
assert.equal(weeks.length, 2);
assert.equal(weeks[0].workouts, 2);
assert.equal(weeks[1].workouts, 2);

// formatting
assert.equal(fmtNum(35260), '35 260');
assert.equal(fmtNum(1234567.891, 2), '1 234 567.89');
assert.equal(fmtKg(82.5), '82.5');
assert.equal(fmtKg(80), '80');
assert.equal(fmtKg(81.25), '81.25');
assert.equal(fmtClock(62000), '1:02');
assert.equal(fmtClock(3723000), '1:02:03');
assert.equal(fmtDur(72 * 60000), '1h 12m');
assert.equal(fmtDur(45 * 60000), '45m');
assert.equal(parseNum('82,5'), 82.5);
assert.equal(parseNum(' 100 '), 100);
assert.equal(parseNum(''), null);
assert.equal(dayKey(startOfWeek(new Date(2026, 9, 18, 12).getTime())), '2026-10-12', 'weeks start on Monday');
assert.ok(rangeStart('3m', null, new Date(2026, 9, 19).getTime()) === new Date(2026, 6, 19).getTime());

// ------------------------------------------------------------ heart rate
{
  const S = base;
  const E = base + 60 * 60000;
  const steady = (bpm: number, from = S, to = E, step = 15000, src = 'fit'): RawSample[] => {
    const out: RawSample[] = [];
    for (let t = from; t <= to; t += step) out.push({ t, bpm, src });
    return out;
  };

  // source picking, cleaning
  const mixed = [...steady(120), ...steady(70, S, E, 300000, 'phone')];
  assert.equal(pickSource(mixed).every((x) => x.src === 'fit'), true, 'dominant source wins');
  assert.deepEqual(
    clean([{ t: 5, bpm: 100 }, { t: 1, bpm: 20 }, { t: 3, bpm: 110 }, { t: 3, bpm: 111 }, { t: 99, bpm: 100 }], 0, 50).map((x) => x.t),
    [3, 5],
    'sorted, deduplicated, plausible, inside the window',
  );

  // nothing found
  const none = processHeart(S, E, [], {}, 123);
  assert.deepEqual(none, { at: 123, n: 0 });

  // steady 120 bpm, a sample every 15 s, plus samples outside the window and another source
  const h = processHeart(S, E, [...steady(100, S - 600000, S - 15000), ...steady(120), ...steady(70, S, E, 300000, 'phone')], { kcal: 412.4 }, 1);
  assert.equal(h.n, 241);
  assert.equal(h.avg, 120);
  assert.equal(h.max, 120);
  assert.equal(h.min, 120, 'no samples from before the workout or from the phone');
  assert.equal(h.cover, 1);
  assert.equal(h.kcal, 412);
  const pts = decodeSeries(h.pts);
  assert.ok(pts.length > 100 && pts.length <= 480, 'downsampled series');
  assert.equal(pts[0][0], 0);
  assert.ok(pts.every(([t, b]) => t >= 0 && t <= 3600 && b === 120));

  // long workout stays under ~480 points
  const long = processHeart(S, S + 4 * 3600000, steady(110, S, S + 4 * 3600000, 1000), {}, 1);
  assert.ok(decodeSeries(long.pts).length <= 490, 'four hours at 1 Hz → at most ~480 points');

  // half the workout recorded
  assert.ok(Math.abs(coverage(steady(120, S, S + 30 * 60000), S, E) - 0.5) < 0.02);
  // a sample every minute still covers the whole workout
  assert.ok(coverage(steady(120, S, E, 60000), S, E) > 0.99);

  // zones (max 200): Z1 from 100, Z2 from 120 … Z5 from 180
  assert.deepEqual([99, 100, 119, 120, 139, 140, 160, 179, 180, 210].map((b) => zoneOf(b, 200)), [0, 1, 1, 2, 2, 3, 4, 4, 5, 5]);
  const z = zoneSeconds(decodeSeries(processHeart(S, E, steady(130), {}, 1).pts), 200);
  assert.ok(z[2] > 3500 && z[2] <= 3620 && z[0] + z[1] + z[3] + z[4] + z[5] === 0, '60 min in Z2 (the last sample counts one step)');
  assert.equal(loadOf([0, 600, 1200, 0, 0, 0]), 10 + 40, 'load = minutes × zone');

  // heart view follows max heart rate
  const v190 = heartView(h, 190)!;
  assert.equal(heartView(h, 190), v190, 'cached');
  const v150 = heartView(h, 150)!;
  assert.equal(zoneOf(120, 190), 2);
  assert.ok(v190.load > 100 && v190.load < 130, `120 bpm for an hour at max 190 → Z2 ≈ 120 load (${v190.load})`);
  assert.ok(v150.load > v190.load, 'lower max → higher zones → more load');
  assert.equal(heartView(none, 190), null);
  assert.equal(heartView(undefined, 190), null);

  // exercise blocks: A A B B A (back to A later)
  const wk: Workout = {
    id: 'hb', startedAt: S, endedAt: E,
    entries: [
      { id: 'a', exerciseId: 'squat', sets: [{ id: 'a1', kg: 100, reps: 5, at: S + 10 * 60000 }, { id: 'a2', kg: 100, reps: 5, at: S + 14 * 60000 }, { id: 'a3', kg: 100, reps: 5, at: S + 40 * 60000 }] },
      { id: 'b', exerciseId: 'leg-press', sets: [{ id: 'b1', kg: 200, reps: 10, at: S + 20 * 60000 }, { id: 'b2', kg: 200, reps: 10, at: S + 25 * 60000 }] },
    ],
  };
  const blocks = exerciseBlocks(wk);
  assert.deepEqual(blocks.map((b) => [b.entry, (b.start - S) / 60000, (b.end - S) / 60000, b.sets.length]), [
    [0, 0, 14, 2],
    [1, 14, 25, 2],
    [0, 25, 40, 1],
  ]);
  const ramp: [number, number][] = [];
  for (let t = 0; t <= 3600; t += 60) ramp.push([t, t < 14 * 60 ? 100 : t <= 25 * 60 ? 140 : 120]);
  const per = entryHeart(blocks, ramp, S);
  assert.equal(per.get(1)!.peak, 140);
  assert.equal(per.get(1)!.avg, 140);
  assert.ok(per.get(0)!.avg > 100 && per.get(0)!.avg < 120, 'squat spans both of its blocks');

  // calories from interval records: overlap counted, sources not added up
  assert.equal(
    prorateKcal(
      [
        { start: S - 30 * 60000, end: S + 30 * 60000, kcal: 600, src: 'fit' }, // half inside → 300
        { start: S + 30 * 60000, end: S + 90 * 60000, kcal: 600, src: 'fit' }, // half inside → 300
        { start: S, end: E, kcal: 100, src: 'phone' },
      ],
      S,
      E,
    ),
    600,
  );
  assert.equal(prorateKcal([], S, E), null);

  // when to read again
  const wf = (hr?: Workout['hr'], endedAgo = 60 * 60000): Workout => ({ id: 'x', startedAt: E - endedAgo - 3600000, endedAt: E - endedAgo, entries: [], ...(hr ? { hr } : {}) });
  assert.equal(isHeartDue(wf(), E), true, 'never read');
  assert.equal(isHeartDue({ ...wf(), endedAt: null }, E), false, 'still training');
  assert.equal(isHeartDue(wf({ at: E - 5 * 60000, n: 0 }), E), false, 'just looked');
  assert.equal(isHeartDue(wf({ at: E - 20 * 60000, n: 0 }), E), true, 'nothing yet, look again');
  assert.equal(isHeartDue(wf({ at: E - 20 * 60000, n: 300, cover: 0.97, kcal: 300 }), E), false, 'complete');
  assert.equal(isHeartDue(wf({ at: E - 20 * 60000, n: 300, cover: 0.97 }), E), true, 'calories still missing');
  const oldW = wf({ at: E - 10 * 60000, n: 0 }, 2 * SETTLE_MS);
  assert.equal(isHeartDue(oldW, E), false, 'read after the data settled: final');
  assert.equal(isHeartDue(wf({ at: E - 3 * SETTLE_MS, n: 0 }, 2 * SETTLE_MS), E), true, 'one more look once settled');

  // heatmap: heart-rate load where every workout of the day has it, sets otherwise
  const hw = [
    w(0, [['bench-press', [[80, 8], [80, 8]]]]),
    w(1, [['bench-press', [[80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8]]]]),
  ];
  const hdays = dayStats(hw.map((x) => summarize(x, ex)));
  const heart = new Map([[hw[0].id, { ...heartView(h, 150)! }]]);
  const byLoad = heatLevels(hdays, heart, 'load');
  const bySets = heatLevels(hdays, heart, 'sets');
  const k0 = dayKey(hw[0].startedAt);
  const k1 = dayKey(hw[1].startedAt);
  assert.equal(bySets.levels.get(k0), 1, '2 sets → faint');
  assert.equal(byLoad.levels.get(k0), 4, 'but a long hard hour on the heart-rate scale');
  assert.equal(byLoad.levels.get(k1), bySets.levels.get(k1), 'no heart rate → sets');
  assert.deepEqual(byLoad.info, { metric: 'load', hrDays: 1, fallbackDays: 1 });
  assert.equal(heatLevels(hdays, heart, 'kcal').levels.get(k0), 3, '412 kcal on the fixed calorie scale');
}

// ------------------------------------------------------------ wellness
{
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  assert.equal(morningOf(at(21, 7)), '2026-10-21');
  assert.equal(morningOf(at(20, 23, 30)), '2026-10-21', 'bedtime counts for the next morning');
  assert.equal(morningOf(at(21, 14, 59)), '2026-10-21', 'a nap before 15:00 counts for that day');
  assert.equal(morningOf(at(21, 15)), '2026-10-22');

  const stages = [
    { start: at(20, 23), end: at(20, 23, 40), stage: 'light' },
    { start: at(20, 23, 40), end: at(21, 1, 10), stage: 'deep' },
    { start: at(21, 1, 10), end: at(21, 3, 0), stage: 'rem' },
    { start: at(21, 3, 0), end: at(21, 3, 40), stage: 'awake' },
    { start: at(21, 3, 40), end: at(21, 7, 0), stage: 'light' },
  ];
  const nights = buildNights([
    { start: at(20, 23), end: at(21, 7), src: 'fit', stages },
    { start: at(20, 23, 30), end: at(21, 6), src: 'fit' }, // the same night written again, shorter
    { start: at(21, 13), end: at(21, 13, 30), src: 'fit' }, // nap
    { start: at(20, 22), end: at(21, 8), src: 'phone' }, // another app, ignored
  ]);
  const n = nights['2026-10-21'];
  assert.equal(n.bed, 480 + 30, 'night plus nap in bed');
  assert.equal(n.deep, 90);
  assert.equal(n.rem, 110);
  assert.equal(n.awake, 40);
  assert.equal(n.asleep, 440 + 30, 'stages asleep plus the nap');
  assert.equal(Object.keys(nights).length, 1);

  const hrv = perMorning([
    { t: at(21, 3), value: 50, src: 'fit' },
    { t: at(21, 5), value: 72, src: 'fit' },
    { t: at(21, 4), value: 999, src: 'fit' },
  ], 'hrv');
  assert.equal(hrv['2026-10-21'], 60, 'HRV averaged on a log scale (geometric mean of 50 and 72)');
  assert.deepEqual(perMorning([{ t: at(21, 8), value: 54 }, { t: at(21, 9), value: 58 }, { t: at(21, 10), value: 57 }], 'rhr'), { '2026-10-21': 57 });

  const gym: Workout = { id: 'g', startedAt: at(21, 18), endedAt: at(21, 19), entries: [] };
  assert.equal(overlapsWorkout({ start: at(21, 18, 5), end: at(21, 18, 55) }, [gym]), true, 'same session recorded twice');
  assert.equal(overlapsWorkout({ start: at(21, 19, 30), end: at(21, 20, 30) }, [gym]), false);
}

// ------------------------------------------------------------ readiness
{
  assert.equal(curve(0, [[-1, 10], [1, 30]]), 20);
  assert.equal(curve(-5, [[-1, 10], [1, 30]]), 10);
  assert.equal(curve(5, [[-1, 10], [1, 30]]), 30);
  const b = baseline([50, 52, 51, 49, 200], 0.5)!;
  assert.equal(b.med, 51, 'median ignores the outlier');
  assert.ok(b.sd < 3, 'robust spread');
  assert.equal(baseline([1, 2], 1), null, 'too little data');
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9);

  // 50 days of a steady trainee: push/pull/legs on Mon/Wed/Fri at 18:00, ~100 load each
  const now = new Date(2026, 9, 22, 8, 0).getTime(); // Thursday morning
  const day0 = sod(now);
  const hrData = (load: number): HeartData => {
    // a flat series at a fixed bpm gives a known load: 60 min at 130 bpm (Z2 at max 190) ≈ 120
    const pts: string[] = [];
    for (let t = 0; t <= 3600; t += 15) pts.push(`${t}:${load}`);
    return { at: now, n: 241, avg: load, max: load, min: load, cover: 1, kcal: 400, pts: pts.join(',') };
  };
  const split = [
    ['bench-press', 'overhead-press', 'triceps-pushdown'],
    ['deadlift', 'barbell-row', 'barbell-curl'],
    ['squat', 'leg-press', 'lying-leg-curl'],
  ];
  const mkW = (t: number, exs: string[], kgBump = 0): Workout => {
    const start = t + 18 * 3600000;
    let at = start + 10 * 60000;
    return {
      id: 'r' + t,
      startedAt: start,
      endedAt: start + 60 * 60000,
      entries: exs.map((e, i) => ({ id: `${t}-${i}`, exerciseId: e, sets: [0, 1, 2].map((k) => ({ id: `${t}-${i}-${k}`, kg: 80 + kgBump, reps: 8, at: (at += 4 * 60000) })) })),
      hr: hrData(130),
    };
  };
  const workouts: Workout[] = [];
  for (let i = 50; i >= 1; i--) {
    const t = addD(day0, -i);
    const wd = (new Date(t).getDay() + 6) % 7; // 0 = Monday
    if (wd === 0 || wd === 2 || wd === 4) workouts.push(mkW(t, split[wd / 2]));
  }
  const wellness: Record<string, DayHealth> = {};
  for (let i = 50; i >= 1; i--) {
    const t = addD(day0, -i);
    const j = i % 5;
    wellness[dayKey(t)] = {
      sleep: { start: t - 60 * 60000, end: t + 7 * 3600000, bed: 480, asleep: 445 + j * 6, deep: 80, rem: 100, light: 265 + j * 6, awake: 35 },
      hrv: 58 + (j - 2) * 1.5,
      rhr: 55 + ((j % 2) - 0.5),
      resp: 14.5 + (j - 2) * 0.1,
      steps: 7000 + j * 500,
    };
  }
  const input = (today: DayHealth | null, extra: Partial<ReadinessInput> = {}): ReadinessInput => ({
    workouts,
    wellness: today ? { ...wellness, [dayKey(now)]: today } : { ...wellness },
    activities: [],
    ex,
    hrMax: 190,
    now,
    ...extra,
  });
  const usual: DayHealth = { sleep: { start: day0 - 3600000, end: day0 + 7 * 3600000, bed: 480, asleep: 450, deep: 80, rem: 100, light: 270, awake: 30 }, hrv: 58, rhr: 55, resp: 14.5 };
  const r = computeReadiness(input(usual))!;
  console.log('   usual morning:', r.score, r.level, r.components.map((c) => `${c.key} ${c.score}`).join(', '));
  assert.ok(r.score >= 60 && r.score < 85, `an ordinary morning is a normal day (${r.score})`);
  assert.equal(r.components.length, 4);
  assert.ok(Math.abs(r.components.reduce((a, c) => a + c.weight, 0) - 1) < 1e-9, 'weights add up to 1');

  const great = computeReadiness(input({ ...usual, hrv: 70, rhr: 52, sleep: { ...usual.sleep!, asleep: 500, bed: 520 } }))!;
  console.log('   great morning:', great.score, great.level);
  assert.equal(great.level, 'heavy', 'high HRV, low resting HR and a long sleep → go heavy');

  const bad = computeReadiness(input({ ...usual, hrv: 44, rhr: 61, sleep: { ...usual.sleep!, asleep: 280, bed: 320 } }))!;
  console.log('   bad morning:', bad.score, bad.level, bad.flags);
  assert.ok(bad.level === 'rest' || bad.level === 'light', 'short sleep, low HRV, high RHR → ease off');
  assert.ok(bad.score <= 35, 'resting HR up + HRV down caps the score');
  assert.ok(bad.flags.length >= 1);

  const sick = computeReadiness(input({ ...usual, resp: 16.8, rhr: 61 }))!;
  console.log('   breathing up:', sick.score, sick.flags[0]);
  assert.ok(sick.score <= 30 && sick.level === 'rest', 'breathing rate + resting HR up → rest');

  const short = computeReadiness(input({ ...usual, sleep: { ...usual.sleep!, asleep: 330 } }))!;
  assert.ok(short.score < r.score, 'shorter sleep, lower score');
  assert.ok(short.notes.some((x) => x.includes('volume')), 'advice: keep heavy sets, cut volume');

  // nothing from the band: training load alone still gives a number
  const noBand = computeReadiness({ ...input(null), wellness: {} })!;
  assert.ok(noBand && noBand.components.length === 1 && noBand.components[0].key === 'load');
  assert.equal(computeReadiness({ workouts: [], wellness: {}, activities: [], ex, hrMax: 190, now }), null, 'nothing to go on');

  // a big ride yesterday lowers today's score through training load
  const ride = { id: 'ride', type: 'biking', start: addD(day0, -1) + 10 * 3600000, end: addD(day0, -1) + 14 * 3600000 };
  const afterRide = computeReadiness(input(usual, { activities: [ride] }))!;
  console.log('   after a 4 h ride:', afterRide.score, afterRide.load.parts.map((x) => `${x.label} ${x.load}`).join(', '));
  assert.ok(afterRide.score < r.score, 'a 4-hour ride counts');
  assert.ok(afterRide.load.parts.some((x) => x.label === 'Bike ride'));

  // history: one score per morning with data
  const hist = readinessHistory(input(usual), 14);
  assert.equal(hist.length, 14);
  assert.ok(hist.every((h) => h.score >= 1 && h.score <= 100));

  // muscles: legs yesterday evening are tired, push from Monday is fresh-ish
  const wed = workouts[workouts.length - 1];
  const musc = muscleFreshness(workouts, ex, now);
  const m = Object.fromEntries(musc.map((x) => [x.muscle, x]));
  console.log('   muscles:', musc.map((x) => `${x.muscle} ${x.freshness}`).join(', '), '· last workout', new Date(wed.startedAt).toDateString());
  assert.ok(m.core.freshness === 100 && m.core.lastDays === null, 'never trained → fresh');
  const lastLegs = workouts.filter((w) => w.entries.some((e) => e.exerciseId === 'squat')).pop()!;
  const legsHours = (now - lastLegs.startedAt) / 3600000;
  if (legsHours < 24) assert.ok(m.legs.freshness < 60, 'legs trained last night are not ready');
  assert.ok(musc.every((x) => x.freshness >= 0 && x.freshness <= 100));

  const sug = suggestWorkout(workouts, ex, musc, now)!;
  assert.ok(sug && sug.daysAgo >= 1, 'suggests a routine not done today');
  const sugMuscles = new Set(sug.muscles);
  const freshest = [...musc].filter((x) => x.lastDays !== null).sort((a, b2) => b2.freshness - a.freshness)[0];
  assert.ok(sugMuscles.has(freshest.muscle) || sug.freshness >= 80, 'the suggested routine trains fresh muscles');

  // performance index: lifts above their recent level score above 1
  const better = mkW(addD(day0, 0), split[0], 10);
  const perf = performanceIndex(better, workouts, ex)!;
  assert.ok(perf > 1.05, `+10 kg on every lift is a good day (${perf.toFixed(3)})`);
}

// ------------------------------------------------------------ readiness learns from lifts
{
  const now = new Date(2026, 9, 22, 8, 0).getTime();
  const day0 = sod(now);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wellness: Record<string, DayHealth> = {};
  for (let i = 120; i >= 0; i--) {
    const t = addD(day0, -i);
    const asleep = 360 + Math.round(rnd() * 150); // 6–8.5 h, random
    wellness[dayKey(t)] = { sleep: { start: t - 3600000, end: t + asleep * 60000, bed: asleep + 20, asleep }, hrv: 50 + rnd() * 16, rhr: 54 + rnd() * 3 };
  }
  // every other day a workout whose lifts track that morning's sleep
  const workouts: Workout[] = [];
  for (let i = 110; i >= 1; i -= 2) {
    const t = addD(day0, -i);
    const sleepZ = (wellness[dayKey(t)].sleep!.asleep - 435) / 45;
    const kg = 100 * (1 + 0.0004 * (110 - i)) * (1 + 0.03 * sleepZ);
    const start = t + 18 * 3600000;
    workouts.push({
      id: 'p' + i,
      startedAt: start,
      endedAt: start + 3600000,
      entries: ['squat', 'bench-press'].map((e, k) => ({ id: `p${i}${k}`, exerciseId: e, sets: [0, 1, 2].map((j) => ({ id: `p${i}${k}${j}`, kg: Math.round(kg * (k ? 0.75 : 1) * 2) / 2, reps: 5, at: start + (k * 3 + j + 1) * 300000 })) })),
    });
  }
  const rd = computeReadiness({ workouts, wellness, activities: [], ex, hrMax: 190, now })!;
  assert.ok(rd.tuning, 'enough workouts to tune');
  console.log('   tuning:', JSON.stringify(rd.tuning!.rho, (_, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
  assert.ok((rd.tuning!.rho.sleep ?? 0) > 0.3, 'lifts follow sleep');
  assert.ok((rd.tuning!.multipliers.sleep ?? 1) > (rd.tuning!.multipliers.hrv ?? 1), 'sleep gains weight over HRV');
  const sleepW = rd.components.find((c) => c.key === 'sleep')!.weight;
  assert.ok(sleepW > 0.28, `sleep weight raised (${sleepW.toFixed(2)})`);
}

console.log('logic tests passed');
