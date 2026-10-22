import { useEffect, useMemo, useState } from 'react';
import type { DB, Exercise, HeatMetric, Workout } from './types';
import { useDB } from './store';
import {
  allSessions,
  computePRs,
  dayStats,
  summarize,
  toExMap,
  type DayStat,
  type ExMap,
  type PRKind,
  type Session,
  type WorkoutSummary,
} from './stats';
import { heartView, heatLevels, type HeartView, type HeatInfo } from './heart';
import { computeReadiness, type Readiness, type ReadinessInput } from './readiness';

export { heatCaption, type HeatInfo } from './heart';

export interface Derived {
  db: DB;
  ex: ExMap;
  /** finished workouts, oldest first */
  finished: Workout[];
  summaries: WorkoutSummary[];
  byId: Map<string, WorkoutSummary>;
  prs: Map<string, PRKind[]>;
  days: Map<string, DayStat>;
  /** exerciseId → finished sessions, oldest first */
  sessions: Map<string, Session[]>;
  /** workoutId → heart rate, for finished workouts that have samples */
  heart: Map<string, HeartView>;
  /** dayKey → heat level 0–4 */
  levels: Map<string, number>;
  heat: HeatInfo;
  active: Workout | null;
}

let lastExercises: Exercise[] | null = null;
let lastEx: ExMap = new Map();
let lastWorkouts: Workout[] | null = null;
let lastWorkoutsEx: ExMap | null = null;
let lastPart: Omit<Derived, 'db' | 'ex' | 'active' | 'heart' | 'levels' | 'heat'> | null = null;
let lastHeartKey: [Workout[], number] | null = null;
let lastHeart = new Map<string, HeartView>();
let lastHeatKey: [unknown, unknown, HeatMetric] | null = null;
let lastHeat: { levels: Map<string, number>; info: HeatInfo } = { levels: new Map(), info: { metric: 'sets', hrDays: 0, fallbackDays: 0 } };

export function derive(db: DB): Derived {
  if (db.exercises !== lastExercises) {
    lastExercises = db.exercises;
    lastEx = toExMap(db.exercises);
  }
  const ex = lastEx;
  if (db.workouts !== lastWorkouts || ex !== lastWorkoutsEx || !lastPart) {
    lastWorkouts = db.workouts;
    lastWorkoutsEx = ex;
    const finished = db.workouts.filter((w) => w.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt);
    const summaries = finished.map((w) => summarize(w, ex));
    const days = dayStats(summaries);
    lastPart = {
      finished,
      summaries,
      byId: new Map(summaries.map((s) => [s.id, s])),
      prs: computePRs(db.workouts, ex),
      days,
      sessions: allSessions(finished),
    };
  }
  const { hrMax, heatMetric } = db.settings;
  if (!lastHeartKey || lastHeartKey[0] !== db.workouts || lastHeartKey[1] !== hrMax) {
    lastHeartKey = [db.workouts, hrMax];
    lastHeart = new Map();
    for (const w of lastPart.finished) {
      const v = heartView(w.hr, hrMax);
      if (v) lastHeart.set(w.id, v);
    }
  }
  if (!lastHeatKey || lastHeatKey[0] !== lastPart.days || lastHeatKey[1] !== lastHeart || lastHeatKey[2] !== heatMetric) {
    lastHeatKey = [lastPart.days, lastHeart, heatMetric];
    lastHeat = heatLevels(lastPart.days, lastHeart, heatMetric);
  }
  const active = db.activeId ? db.workouts.find((w) => w.id === db.activeId && w.endedAt === null) ?? null : null;
  return { db, ex, active, ...lastPart, heart: lastHeart, levels: lastHeat.levels, heat: lastHeat.info };
}

export function useData(): Derived {
  const db = useDB();
  return useMemo(() => derive(db), [db]);
}

/** Re-renders every `interval` ms while enabled, aligned to the second. */
export function useNow(interval = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let id: number | undefined;
    const first = window.setTimeout(() => {
      setNow(Date.now());
      id = window.setInterval(() => setNow(Date.now()), interval);
    }, interval - (Date.now() % interval));
    return () => {
      clearTimeout(first);
      if (id) clearInterval(id);
    };
  }, [interval, enabled]);
  return enabled ? now : Date.now();
}

/**
 * This morning's readiness. Recomputed when the log or recovery data change,
 * and every ten minutes (muscle fatigue keeps fading during the day).
 */
let lastReady: { key: unknown[]; value: { input: ReadinessInput; today: Readiness | null } } | null = null;

export function useReadiness(): { input: ReadinessInput; today: Readiness | null } {
  const data = useData();
  const now = useNow(10 * 60_000);
  const tick = Math.floor(now / (10 * 60_000));
  const { db, finished, ex } = data;
  return useMemo(() => {
    // shared by the home card and the readiness page, so it is worked out once
    const key = [finished, db.wellness, db.activities, ex, db.settings.hrMax, tick];
    if (lastReady && lastReady.key.every((k, i) => k === key[i])) return lastReady.value;
    const input: ReadinessInput = { workouts: finished, wellness: db.wellness, activities: db.activities, ex, hrMax: db.settings.hrMax, now: Date.now() };
    lastReady = { key, value: { input, today: computeReadiness(input) } };
    return lastReady.value;
  }, [finished, db.wellness, db.activities, ex, db.settings.hrMax, tick]);
}
