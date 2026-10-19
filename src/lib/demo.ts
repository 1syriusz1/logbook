/* Sample training history: ~5 months of a push / pull / legs split with
   steady progression, used for the live preview and "Load sample data". */
import type { DB, Entry, Workout } from './types';
import { emptyDB, uid } from './store';
import { addDays, dayKey, DAY, startOfDay, startOfWeek } from './format';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Plan {
  id: string;
  from: number;
  to: number;
  sets: number;
  reps: [number, number];
  step: number;
}

const PUSH: Plan[] = [
  { id: 'bench-press', from: 70, to: 87.5, sets: 4, reps: [6, 8], step: 2.5 },
  { id: 'incline-db-press', from: 24, to: 32, sets: 3, reps: [8, 10], step: 2 },
  { id: 'overhead-press', from: 42.5, to: 52.5, sets: 3, reps: [6, 8], step: 2.5 },
  { id: 'lateral-raise', from: 10, to: 14, sets: 3, reps: [12, 15], step: 2 },
  { id: 'triceps-pushdown', from: 25, to: 37.5, sets: 3, reps: [10, 12], step: 2.5 },
];
const PULL: Plan[] = [
  { id: 'deadlift', from: 120, to: 150, sets: 3, reps: [5, 5], step: 5 },
  { id: 'pull-up', from: 0, to: 12.5, sets: 3, reps: [6, 9], step: 2.5 },
  { id: 'barbell-row', from: 60, to: 75, sets: 3, reps: [8, 8], step: 2.5 },
  { id: 'lat-pulldown', from: 55, to: 70, sets: 3, reps: [10, 12], step: 2.5 },
  { id: 'face-pull', from: 20, to: 27.5, sets: 3, reps: [15, 15], step: 2.5 },
  { id: 'barbell-curl', from: 30, to: 40, sets: 3, reps: [8, 10], step: 2.5 },
];
const LEGS: Plan[] = [
  { id: 'squat', from: 90, to: 117.5, sets: 4, reps: [5, 6], step: 2.5 },
  { id: 'romanian-deadlift', from: 80, to: 102.5, sets: 3, reps: [8, 8], step: 2.5 },
  { id: 'leg-press', from: 160, to: 220, sets: 3, reps: [10, 12], step: 10 },
  { id: 'lying-leg-curl', from: 40, to: 52.5, sets: 3, reps: [10, 12], step: 2.5 },
  { id: 'standing-calf-raise', from: 60, to: 80, sets: 4, reps: [12, 15], step: 5 },
  { id: 'hanging-leg-raise', from: 0, to: 0, sets: 3, reps: [12, 15], step: 0 },
];
const UPPER: Plan[] = [
  { id: 'incline-bench-press', from: 60, to: 72.5, sets: 3, reps: [8, 8], step: 2.5 },
  { id: 'chest-supported-row', from: 50, to: 62.5, sets: 3, reps: [10, 10], step: 2.5 },
  { id: 'seated-db-press', from: 22, to: 28, sets: 3, reps: [8, 10], step: 2 },
  { id: 'cable-fly', from: 15, to: 20, sets: 3, reps: [12, 15], step: 2.5 },
  { id: 'hammer-curl', from: 14, to: 20, sets: 3, reps: [10, 12], step: 2 },
  { id: 'rope-pushdown', from: 25, to: 32.5, sets: 3, reps: [12, 12], step: 2.5 },
];

export function demoDB(now = Date.now()): DB {
  const r = rng(20261019);
  const db = emptyDB();
  const weeks = 22;
  const firstMonday = startOfWeek(addDays(now, -weeks * 7));
  const yesterday = startOfDay(now) - 1;
  const workouts: Workout[] = [];

  const session = (day: number, plan: Plan[], progress: number, deload: boolean) => {
    const start = day + (17.25 + r() * 2.5) * 3600_000;
    let t = start + (6 + r() * 6) * 60_000; // warm-up
    const entries: Entry[] = [];
    for (const p of plan) {
      if (r() < 0.06) continue; // skipped an exercise
      const raw = p.from + (p.to - p.from) * progress;
      let kg = p.step ? Math.round(raw / p.step) * p.step : 0;
      if (deload) kg = p.step ? Math.round((kg * 0.88) / p.step) * p.step : 0;
      const entry: Entry = { id: uid(), exerciseId: p.id, sets: [] };
      const sets = p.sets + (r() < 0.15 ? 1 : 0);
      const target = p.reps[0] + Math.round(r() * (p.reps[1] - p.reps[0]));
      for (let i = 0; i < sets; i++) {
        const fatigue = i >= 2 ? Math.round(r() * 1.6) : 0;
        const reps = Math.max(1, target - fatigue + (deload ? 1 : 0) + (r() < 0.12 ? 1 : 0));
        t += (1.6 + r() * 1.4) * 60_000;
        entry.sets.push({ id: uid(), kg, reps, at: t });
      }
      t += (1 + r() * 1.5) * 60_000; // moving between stations
      entries.push(entry);
    }
    const end = t + (2 + r() * 5) * 60_000;
    workouts.push({ id: uid(), startedAt: start, endedAt: end, entries });
  };

  for (let w = 0; w <= weeks; w++) {
    const monday = addDays(firstMonday, w * 7);
    const progress = Math.min(1, w / weeks);
    const deload = w > 0 && w % 7 === 0;
    const holiday = w === 9;
    if (holiday) continue;
    const plan: [number, Plan[]][] = [
      [0, PUSH],
      [r() < 0.5 ? 1 : 2, PULL],
      [r() < 0.6 ? 3 : 4, LEGS],
    ];
    if (r() < 0.45) plan.push([5, UPPER]);
    for (const [offset, p] of plan) {
      const day = addDays(monday, offset);
      if (day > yesterday) continue;
      if (r() < 0.1) continue; // missed session
      session(day, p, progress, deload);
    }
  }

  // Body weight: a slow, noisy cut from ~84.6 to ~82 kg.
  const bodyweight = [];
  for (let d = addDays(startOfDay(now), -weeks * 7); d < startOfDay(now); d += DAY) {
    if (r() > 0.36) continue;
    const p = 1 - (startOfDay(now) - d) / (weeks * 7 * DAY);
    const kg = Math.round((84.6 - 2.5 * p + (r() - 0.5) * 0.8) * 10) / 10;
    bodyweight.push({ id: uid(), date: dayKey(d), kg });
  }

  db.workouts = workouts.sort((a, b) => a.startedAt - b.startedAt);
  db.bodyweight = bodyweight;
  db.settings.lastBackupAt = now - 3 * DAY;
  return db;
}
