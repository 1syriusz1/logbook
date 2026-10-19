import type { BodyWeightLog, Exercise, Muscle, SetLog, Workout } from './types';
import { MUSCLE_LABEL } from './exercises';
import { addDays, DAY, dayKey, parseDayKey, startOfDay, startOfWeek, weekday } from './format';

export type ExMap = Map<string, Exercise>;

export const toExMap = (exercises: Exercise[]): ExMap => new Map(exercises.map((e) => [e.id, e]));

/** Estimated one-rep max (Epley). */
export function e1rm(kg: number, reps: number): number {
  if (reps <= 0 || kg <= 0) return 0;
  if (reps === 1) return kg;
  return kg * (1 + Math.min(reps, 15) / 30);
}

/** External load moved. For bodyweight moves only the added load counts. */
export const setVolume = (s: SetLog) => s.kg * s.reps;

export const workoutDuration = (w: Workout, now = Date.now()) =>
  Math.max(0, (w.endedAt ?? now) - w.startedAt);

export interface WorkoutSummary {
  id: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  sets: number;
  reps: number;
  volume: number;
  exercises: number;
  /** muscles sorted by sets, descending */
  muscles: [Muscle, number][];
  title: string;
  autoTitle: string;
  lastSetAt: number | null;
}

export function autoTitle(muscles: [Muscle, number][]): string {
  const total = muscles.reduce((a, [, n]) => a + n, 0);
  if (!total) return 'Workout';
  const main = muscles.filter(([, n]) => n / total >= 0.16);
  if (muscles.filter(([, n]) => n / total >= 0.14).length >= 4) {
    const legs = muscles.find(([m]) => m === 'legs');
    return legs && legs[1] / total >= 0.1 ? 'Full body' : 'Upper body';
  }
  const picked = (main.length ? main : muscles.slice(0, 1)).slice(0, 3);
  return picked.map(([m]) => MUSCLE_LABEL[m]).join(' + ');
}

export function summarize(w: Workout, ex: ExMap, now = Date.now()): WorkoutSummary {
  const m = new Map<Muscle, number>();
  let sets = 0;
  let reps = 0;
  let volume = 0;
  let lastSetAt: number | null = null;
  for (const e of w.entries) {
    const exercise = ex.get(e.exerciseId);
    const muscle = exercise?.muscle ?? 'core';
    // Planned exercises without sets still hint the title of a fresh workout.
    m.set(muscle, (m.get(muscle) ?? 0) + (e.sets.length || 0));
    for (const s of e.sets) {
      sets++;
      reps += s.reps;
      volume += setVolume(s);
      if (lastSetAt === null || s.at > lastSetAt) lastSetAt = s.at;
    }
  }
  let muscles = [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!muscles.length && w.entries.length) {
    // Nothing logged yet: title from the planned exercises.
    const planned = new Map<Muscle, number>();
    for (const e of w.entries) {
      const mu = ex.get(e.exerciseId)?.muscle ?? 'core';
      planned.set(mu, (planned.get(mu) ?? 0) + 1);
    }
    muscles = [...planned.entries()].sort((a, b) => b[1] - a[1]);
    const t = autoTitle(muscles);
    return {
      id: w.id, startedAt: w.startedAt, endedAt: w.endedAt, durationMs: workoutDuration(w, now),
      sets: 0, reps: 0, volume: 0, exercises: w.entries.length, muscles: [],
      title: w.name?.trim() || t, autoTitle: t, lastSetAt: null,
    };
  }
  let t = autoTitle(muscles);
  if (w.endedAt === null && w.entries.some((e) => !e.sets.length)) {
    // While training, exercises still to do count toward the name too,
    // so a repeated "Upper body" keeps its name from the first set on.
    const planned = new Map(m);
    for (const e of w.entries) {
      if (e.sets.length) continue;
      const mu = ex.get(e.exerciseId)?.muscle ?? 'core';
      planned.set(mu, (planned.get(mu) ?? 0) + 3);
    }
    t = autoTitle([...planned.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]));
  }
  return {
    id: w.id,
    startedAt: w.startedAt,
    endedAt: w.endedAt,
    durationMs: workoutDuration(w, now),
    sets,
    reps,
    volume,
    exercises: w.entries.filter((e) => e.sets.length).length,
    muscles,
    title: w.name?.trim() || t,
    autoTitle: t,
    lastSetAt,
  };
}

/* ------------------------------------------------------------------ PRs */

export type PRKind = 'weight' | 'e1rm' | 'reps';

interface Best {
  sessions: number;
  kg: number;
  e1rm: number;
  reps: number;
}

/**
 * Walks every workout chronologically and marks sets that beat the previous
 * best for that exercise. The first session of an exercise sets the baseline
 * and never counts as a record.
 */
export function computePRs(workouts: Workout[], ex: ExMap): Map<string, PRKind[]> {
  const out = new Map<string, PRKind[]>();
  const best = new Map<string, Best>();
  const sorted = [...workouts].sort((a, b) => a.startedAt - b.startedAt);
  for (const w of sorted) {
    const seen = new Set<string>();
    for (const entry of w.entries) {
      const exercise = ex.get(entry.exerciseId);
      if (!exercise) continue;
      let b = best.get(entry.exerciseId);
      if (!b) {
        b = { sessions: 0, kg: 0, e1rm: 0, reps: 0 };
        best.set(entry.exerciseId, b);
      }
      for (const s of entry.sets) {
        const kinds: PRKind[] = [];
        const est = e1rm(s.kg, s.reps);
        if (b.sessions > 0) {
          if (exercise.kind === 'weighted') {
            if (s.kg > b.kg + 1e-9) kinds.push('weight');
            if (est > b.e1rm + 0.05) kinds.push('e1rm');
          } else {
            if (s.reps > b.reps) kinds.push('reps');
            if (s.kg > 0 && s.kg > b.kg + 1e-9) kinds.push('weight');
          }
        }
        if (kinds.length) out.set(s.id, kinds);
        b.kg = Math.max(b.kg, s.kg);
        b.e1rm = Math.max(b.e1rm, est);
        b.reps = Math.max(b.reps, s.reps);
      }
      if (entry.sets.length) seen.add(entry.exerciseId);
    }
    for (const id of seen) best.get(id)!.sessions++;
  }
  return out;
}

export interface PREvent {
  setId: string;
  workoutId: string;
  exerciseId: string;
  at: number;
  kg: number;
  reps: number;
  kinds: PRKind[];
}

export function prEvents(workouts: Workout[], prs: Map<string, PRKind[]>): PREvent[] {
  const out: PREvent[] = [];
  for (const w of workouts) {
    for (const e of w.entries) {
      for (const s of e.sets) {
        const kinds = prs.get(s.id);
        if (kinds) out.push({ setId: s.id, workoutId: w.id, exerciseId: e.exerciseId, at: s.at, kg: s.kg, reps: s.reps, kinds });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Keep only the best set per exercise per workout, so a list of records reads cleanly. */
export function collapsePRs(events: PREvent[]): PREvent[] {
  const byKey = new Map<string, PREvent>();
  for (const ev of events) {
    const key = ev.workoutId + ':' + ev.exerciseId;
    const cur = byKey.get(key);
    if (!cur || e1rm(ev.kg, ev.reps) > e1rm(cur.kg, cur.reps) || (ev.kg === cur.kg && ev.reps > cur.reps)) {
      byKey.set(key, ev);
    }
  }
  return [...byKey.values()].sort((a, b) => b.at - a.at);
}

/* -------------------------------------------------------- per exercise */

export interface Session {
  workoutId: string;
  date: number;
  sets: SetLog[];
  topKg: number;
  topReps: number;
  bestE1rm: number;
  volume: number;
  totalReps: number;
  maxReps: number;
}

export function exerciseSessions(workouts: Workout[], exerciseId: string, opts?: { excludeId?: string }): Session[] {
  const out: Session[] = [];
  for (const w of workouts) {
    if (opts?.excludeId && w.id === opts.excludeId) continue;
    const sets: SetLog[] = [];
    for (const e of w.entries) if (e.exerciseId === exerciseId) sets.push(...e.sets);
    if (sets.length) out.push(toSession(w, sets));
  }
  return out.sort((a, b) => a.date - b.date);
}

/** Sessions for every exercise in one pass: exerciseId → sessions, oldest first. */
export function allSessions(workouts: Workout[]): Map<string, Session[]> {
  const ids = new Set<string>();
  for (const w of workouts) for (const e of w.entries) if (e.sets.length) ids.add(e.exerciseId);
  const byEx = new Map<string, Session[]>();
  // Group sets per workout+exercise first, then summarise.
  const sorted = [...workouts].sort((a, b) => a.startedAt - b.startedAt);
  for (const id of ids) byEx.set(id, []);
  for (const w of sorted) {
    const local = new Map<string, SetLog[]>();
    for (const e of w.entries) {
      if (!e.sets.length) continue;
      const arr = local.get(e.exerciseId) ?? [];
      arr.push(...e.sets);
      local.set(e.exerciseId, arr);
    }
    for (const [id, sets] of local) byEx.get(id)!.push(toSession(w, sets));
  }
  return byEx;
}

function toSession(w: Workout, sets: SetLog[]): Session {
  let topKg = -1;
  let topReps = 0;
  let bestE1rm = 0;
  let volume = 0;
  let totalReps = 0;
  let maxReps = 0;
  for (const s of sets) {
    if (s.kg > topKg || (s.kg === topKg && s.reps > topReps)) {
      topKg = s.kg;
      topReps = s.reps;
    }
    bestE1rm = Math.max(bestE1rm, e1rm(s.kg, s.reps));
    volume += setVolume(s);
    totalReps += s.reps;
    maxReps = Math.max(maxReps, s.reps);
  }
  return { workoutId: w.id, date: w.startedAt, sets, topKg: Math.max(0, topKg), topReps, bestE1rm, volume, totalReps, maxReps };
}

export type RangeKey = '1m' | '3m' | '6m' | '1y' | 'all';

export const RANGES: { value: RangeKey; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

/** Start of a range ending now. "all" starts at the first data point. */
export function rangeStart(range: RangeKey, firstTs: number | null, now = Date.now()): number {
  const d = new Date(startOfDay(now));
  switch (range) {
    case '1m':
      d.setMonth(d.getMonth() - 1);
      break;
    case '3m':
      d.setMonth(d.getMonth() - 3);
      break;
    case '6m':
      d.setMonth(d.getMonth() - 6);
      break;
    case '1y':
      d.setFullYear(d.getFullYear() - 1);
      break;
    case 'all':
      return firstTs !== null ? Math.min(startOfDay(firstTs), d.getTime() - 28 * DAY) : d.getTime() - 28 * DAY;
  }
  return d.getTime();
}

export interface RecordValue {
  value: number;
  kg: number;
  reps: number;
  date: number;
}

export interface ExerciseRecords {
  heaviest: RecordValue | null;
  bestE1rm: RecordValue | null;
  mostReps: RecordValue | null;
  bestSetVolume: RecordValue | null;
  bestSession: { value: number; date: number } | null;
  repMaxes: { reps: number; kg: number; date: number }[];
}

export const REP_MAX_TARGETS = [1, 3, 5, 8, 10, 12];

export function exerciseRecords(sessions: Session[]): ExerciseRecords {
  let heaviest: RecordValue | null = null;
  let bestE: RecordValue | null = null;
  let mostReps: RecordValue | null = null;
  let bestSetVolume: RecordValue | null = null;
  let bestSession: { value: number; date: number } | null = null;
  const rm = new Map<number, { kg: number; date: number }>();
  for (const s of sessions) {
    if (!bestSession || s.volume > bestSession.value) bestSession = { value: s.volume, date: s.date };
    for (const set of s.sets) {
      if (!heaviest || set.kg > heaviest.kg || (set.kg === heaviest.kg && set.reps > heaviest.reps))
        heaviest = { value: set.kg, kg: set.kg, reps: set.reps, date: s.date };
      const est = e1rm(set.kg, set.reps);
      if (!bestE || est > bestE.value) bestE = { value: est, kg: set.kg, reps: set.reps, date: s.date };
      if (!mostReps || set.reps > mostReps.reps || (set.reps === mostReps.reps && set.kg > mostReps.kg))
        mostReps = { value: set.reps, kg: set.kg, reps: set.reps, date: s.date };
      const v = setVolume(set);
      if (!bestSetVolume || v > bestSetVolume.value) bestSetVolume = { value: v, kg: set.kg, reps: set.reps, date: s.date };
      for (const target of REP_MAX_TARGETS) {
        if (set.reps >= target) {
          const cur = rm.get(target);
          if (!cur || set.kg > cur.kg) rm.set(target, { kg: set.kg, date: s.date });
        }
      }
    }
  }
  return {
    heaviest,
    bestE1rm: bestE,
    mostReps,
    bestSetVolume,
    bestSession,
    repMaxes: REP_MAX_TARGETS.filter((t) => rm.has(t)).map((t) => ({ reps: t, ...rm.get(t)! })),
  };
}

/* ---------------------------------------------------------- calendar */

export interface DayStat {
  key: string;
  date: number;
  sets: number;
  durationMs: number;
  volume: number;
  workouts: WorkoutSummary[];
}

export function dayStats(summaries: WorkoutSummary[]): Map<string, DayStat> {
  const map = new Map<string, DayStat>();
  for (const s of summaries) {
    const key = dayKey(s.startedAt);
    let d = map.get(key);
    if (!d) {
      d = { key, date: parseDayKey(key), sets: 0, durationMs: 0, volume: 0, workouts: [] };
      map.set(key, d);
    }
    d.sets += s.sets;
    d.durationMs += s.durationMs;
    d.volume += s.volume;
    d.workouts.push(s);
  }
  return map;
}

/**
 * Thresholds for heat levels 1–4, GitHub style: relative to your own
 * history once there is enough of it, fixed before that.
 */
export function heatThresholds(days: Map<string, DayStat>): [number, number, number] {
  const values = [...days.values()].map((d) => d.sets).filter((n) => n > 0).sort((a, b) => a - b);
  if (values.length < 8) return [8, 14, 20];
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))];
  const t1 = Math.max(4, q(0.25));
  const t2 = Math.max(t1 + 1, q(0.5));
  const t3 = Math.max(t2 + 1, q(0.8));
  return [t1, t2, t3];
}

export function heatLevel(sets: number, t: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (sets <= 0) return 0;
  if (sets <= t[0]) return 1;
  if (sets <= t[1]) return 2;
  if (sets <= t[2]) return 3;
  return 4;
}

/* ------------------------------------------------------------ ranges */

export interface WeekStat {
  start: number;
  workouts: number;
  sets: number;
  volume: number;
  durationMs: number;
}

export function weeklySeries(summaries: WorkoutSummary[], from: number, to: number): WeekStat[] {
  const weeks: WeekStat[] = [];
  const index = new Map<number, WeekStat>();
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) {
    const ws: WeekStat = { start: w, workouts: 0, sets: 0, volume: 0, durationMs: 0 };
    weeks.push(ws);
    index.set(w, ws);
  }
  for (const s of summaries) {
    const ws = index.get(startOfWeek(s.startedAt));
    if (!ws) continue;
    ws.workouts++;
    ws.sets += s.sets;
    ws.volume += s.volume;
    ws.durationMs += s.durationMs;
  }
  return weeks;
}

export function inRange(summaries: WorkoutSummary[], from: number, to: number): WorkoutSummary[] {
  return summaries.filter((s) => s.startedAt >= from && s.startedAt < to);
}

export interface Totals {
  workouts: number;
  sets: number;
  volume: number;
  durationMs: number;
}

export function totals(summaries: WorkoutSummary[]): Totals {
  return summaries.reduce<Totals>(
    (t, s) => ({ workouts: t.workouts + 1, sets: t.sets + s.sets, volume: t.volume + s.volume, durationMs: t.durationMs + s.durationMs }),
    { workouts: 0, sets: 0, volume: 0, durationMs: 0 },
  );
}

export function muscleSplit(summaries: WorkoutSummary[]): [Muscle, number][] {
  const m = new Map<Muscle, number>();
  for (const s of summaries) for (const [mu, n] of s.muscles) m.set(mu, (m.get(mu) ?? 0) + n);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function weekdayCounts(summaries: WorkoutSummary[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const s of summaries) c[weekday(s.startedAt)]++;
  return c;
}

/** Weeks in a row with at least one workout. The current week keeps the streak alive until it ends. */
export function weekStreak(summaries: WorkoutSummary[], now = Date.now()): number {
  const weeks = new Set(summaries.map((s) => startOfWeek(s.startedAt)));
  let w = startOfWeek(now);
  if (!weeks.has(w)) w = addDays(w, -7);
  let n = 0;
  while (weeks.has(w)) {
    n++;
    w = addDays(w, -7);
  }
  return n;
}

/** The weekday a given split usually lands on, e.g. "Chest + Triceps" → Friday. */
export function usualWeekday(summaries: WorkoutSummary[], title: string, now = Date.now()): number | null {
  const recent = summaries.filter((s) => s.autoTitle === title && s.startedAt > now - 84 * DAY);
  if (recent.length < 2) return null;
  const c = weekdayCounts(recent);
  const max = Math.max(...c);
  return max / recent.length >= 0.5 && max >= 2 ? c.indexOf(max) : null;
}

/* ------------------------------------------------------- body weight */

export function sortedBodyweight(logs: BodyWeightLog[]): BodyWeightLog[] {
  return [...logs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export const isFinished = (w: Workout) => w.endedAt !== null;

export const dayStart = startOfDay;
