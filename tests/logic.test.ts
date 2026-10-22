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

console.log('logic tests passed');
