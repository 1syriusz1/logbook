import { useEffect, useMemo, useState } from 'react';
import type { DB, Exercise, Workout } from './types';
import { useDB } from './store';
import {
  allSessions,
  computePRs,
  dayStats,
  heatThresholds,
  summarize,
  toExMap,
  type DayStat,
  type ExMap,
  type PRKind,
  type Session,
  type WorkoutSummary,
} from './stats';

export interface Derived {
  db: DB;
  ex: ExMap;
  /** finished workouts, oldest first */
  finished: Workout[];
  summaries: WorkoutSummary[];
  byId: Map<string, WorkoutSummary>;
  prs: Map<string, PRKind[]>;
  days: Map<string, DayStat>;
  thresholds: [number, number, number];
  /** exerciseId → finished sessions, oldest first */
  sessions: Map<string, Session[]>;
  active: Workout | null;
}

let lastExercises: Exercise[] | null = null;
let lastEx: ExMap = new Map();
let lastWorkouts: Workout[] | null = null;
let lastWorkoutsEx: ExMap | null = null;
let lastPart: Omit<Derived, 'db' | 'ex' | 'active'> | null = null;

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
      thresholds: heatThresholds(days),
      sessions: allSessions(finished),
    };
  }
  const active = db.activeId ? db.workouts.find((w) => w.id === db.activeId && w.endedAt === null) ?? null : null;
  return { db, ex, active, ...lastPart };
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
