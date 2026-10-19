// Run with: npm test
import assert from 'node:assert/strict';
import { e1rm, computePRs, summarize, toExMap, exerciseSessions, exerciseRecords, heatThresholds, heatLevel, dayStats, weekStreak, autoTitle, weeklySeries, rangeStart } from '../src/lib/stats';
import { LIBRARY } from '../src/lib/exercises';
import { fmtNum, fmtClock, fmtDur, parseNum, startOfWeek, dayKey, fmtKg } from '../src/lib/format';
import type { Workout } from '../src/lib/types';

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

console.log('logic tests passed');
