import { useSyncExternalStore } from 'react';
import type { Activity, BodyWeightLog, DayHealth, DB, Entry, Exercise, HealthSettings, HeartData, Settings, SleepNight, Workout } from './types';
import { LIBRARY } from './exercises';
import { nativeFile } from './platform';

const KEY = 'logbook.v1';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const defaultHealth = (): HealthSettings => ({ on: false, since: null, history: false, lastSync: null });

export function emptyDB(): DB {
  return {
    v: 1,
    exercises: LIBRARY.map((e) => ({ ...e })),
    workouts: [],
    bodyweight: [],
    activeId: null,
    settings: { weightStep: 2.5, lastBackupAt: null, hrMax: 190, heatMetric: 'load', health: defaultHealth() },
    wellness: {},
    activities: [],
  };
}

/* ------------------------------------------------------------ validation */

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function cleanHeart(v: unknown): HeartData | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const h = v as Record<string, unknown>;
  if (typeof h.at !== 'number' || typeof h.n !== 'number' || !Number.isFinite(h.at) || !Number.isFinite(h.n)) return undefined;
  const out: HeartData = { at: h.at, n: Math.max(0, Math.round(h.n)) };
  for (const k of ['avg', 'max', 'min', 'kcal', 'cover'] as const) {
    const x = h[k];
    if (typeof x === 'number' && Number.isFinite(x) && x >= 0) out[k] = x;
  }
  if (typeof h.src === 'string' && h.src) out.src = h.src.slice(0, 60);
  if (typeof h.pts === 'string' && /^[\d:,.-]*$/.test(h.pts)) out.pts = h.pts.slice(0, 40_000);
  return out;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const inRange = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);

function cleanSleep(v: unknown): SleepNight | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = v as Record<string, unknown>;
  const start = inRange(s.start, 0, 1e13);
  const end = inRange(s.end, 0, 1e13);
  const bed = inRange(s.bed, 0, 24 * 60);
  const asleep = inRange(s.asleep, 0, 24 * 60);
  if (start === undefined || end === undefined || bed === undefined || asleep === undefined || end < start) return undefined;
  const out: SleepNight = { start, end, bed, asleep };
  for (const k of ['deep', 'rem', 'light', 'awake'] as const) {
    const x = inRange(s[k], 0, 24 * 60);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

function cleanWellness(v: unknown): Record<string, DayHealth> {
  const out: Record<string, DayHealth> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!DAY_KEY.test(k) || !raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const day: DayHealth = {};
    const sleep = cleanSleep(d.sleep);
    if (sleep) day.sleep = sleep;
    const hrv = inRange(d.hrv, 1, 400);
    if (hrv !== undefined) day.hrv = hrv;
    const rhr = inRange(d.rhr, 25, 150);
    if (rhr !== undefined) day.rhr = rhr;
    const resp = inRange(d.resp, 4, 60);
    if (resp !== undefined) day.resp = resp;
    const steps = inRange(d.steps, 0, 200_000);
    if (steps !== undefined) day.steps = steps;
    if (Object.keys(day).length) out[k] = day;
  }
  return out;
}

function cleanActivities(v: unknown): Activity[] {
  if (!Array.isArray(v)) return [];
  const out: Activity[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const start = inRange(a.start, 0, 1e13);
    const end = inRange(a.end, 0, 1e13);
    if (typeof a.id !== 'string' || start === undefined || end === undefined || end <= start) continue;
    const act: Activity = { id: a.id.slice(0, 80), type: str(a.type, 'other').slice(0, 40), start, end };
    const kcal = inRange(a.kcal, 0, 20_000);
    if (kcal !== undefined) act.kcal = kcal;
    const distance = inRange(a.distance, 0, 1_000_000);
    if (distance !== undefined) act.distance = distance;
    if (typeof a.src === 'string' && a.src) act.src = a.src.slice(0, 60);
    const hr = cleanHeart(a.hr);
    if (hr) act.hr = hr;
    out.push(act);
  }
  return out.sort((x, y) => x.start - y.start);
}

function cleanHealth(v: unknown): HealthSettings {
  const h = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: HealthSettings = { on: h.on === true, since: numOrNull(h.since), history: h.history === true, lastSync: numOrNull(h.lastSync) };
  if (h.filled && typeof h.filled === 'object') {
    const f: HealthSettings['filled'] = {};
    for (const k of ['sleep', 'hrv', 'rhr', 'resp', 'steps', 'workouts'] as const) {
      const x = (h.filled as Record<string, unknown>)[k];
      if (typeof x === 'number' && Number.isFinite(x)) f[k] = x;
    }
    out.filled = f;
  }
  return out;
}

/** Accepts anything that looks like a Logbook backup and returns a clean DB. */
export function sanitize(raw: unknown): DB {
  if (!raw || typeof raw !== 'object') throw new Error('This file is not a Logbook backup.');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.workouts) || !Array.isArray(r.exercises)) throw new Error('This file is not a Logbook backup.');
  const base = emptyDB();
  const exercises: Exercise[] = (r.exercises as Record<string, unknown>[])
    .filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string')
    .map((e) => ({
      id: str(e.id),
      name: str(e.name).slice(0, 80),
      muscle: (['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core'].includes(str(e.muscle)) ? e.muscle : 'core') as Exercise['muscle'],
      equipment: (str(e.equipment) || 'other') as Exercise['equipment'],
      kind: e.kind === 'bodyweight' ? 'bodyweight' : 'weighted',
      ...(e.loaded && e.kind === 'bodyweight' ? { loaded: true } : {}),
      ...(e.custom ? { custom: true } : {}),
      ...(e.archived ? { archived: true } : {}),
    }));
  const known = new Set(exercises.map((e) => e.id));
  for (const lib of base.exercises) if (!known.has(lib.id)) exercises.push(lib);
  const workouts: Workout[] = (r.workouts as Record<string, unknown>[])
    .filter((w) => w && typeof w.id === 'string' && Array.isArray(w.entries))
    .map((w) => ({
      id: str(w.id),
      startedAt: num(w.startedAt, Date.now()),
      endedAt: w.endedAt === null ? null : num(w.endedAt, num(w.startedAt) + 3600_000),
      ...(typeof w.name === 'string' && w.name ? { name: w.name.slice(0, 60) } : {}),
      ...(typeof w.note === 'string' && w.note ? { note: w.note.slice(0, 2000) } : {}),
      entries: (w.entries as Record<string, unknown>[])
        .filter((e) => e && typeof e.exerciseId === 'string' && Array.isArray(e.sets))
        .map((e) => ({
          id: str(e.id) || uid(),
          exerciseId: str(e.exerciseId),
          sets: (e.sets as Record<string, unknown>[])
            .filter((s) => s && typeof s.reps === 'number')
            .map((s) => ({ id: str(s.id) || uid(), kg: Math.max(0, num(s.kg)), reps: Math.max(0, Math.round(num(s.reps))), at: num(s.at, num(w.startedAt)) })),
        })),
      ...(cleanHeart(w.hr) ? { hr: cleanHeart(w.hr) } : {}),
    }));
  const bodyweight: BodyWeightLog[] = Array.isArray(r.bodyweight)
    ? (r.bodyweight as Record<string, unknown>[])
        .filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(str(b.date)) && num(b.kg) > 0)
        .map((b) => ({ id: str(b.id) || uid(), date: str(b.date), kg: num(b.kg) }))
    : [];
  const s = (r.settings ?? {}) as Record<string, unknown>;
  const activeId = typeof r.activeId === 'string' && workouts.some((w) => w.id === r.activeId && w.endedAt === null) ? r.activeId : null;
  // Any other unfinished workouts are closed at their last set.
  for (const w of workouts) {
    if (w.endedAt === null && w.id !== activeId) {
      const last = Math.max(w.startedAt, ...w.entries.flatMap((e) => e.sets.map((x) => x.at)));
      w.endedAt = last + 5 * 60_000;
    }
  }
  return {
    v: 1,
    exercises,
    workouts: workouts.sort((a, b) => a.startedAt - b.startedAt),
    bodyweight,
    activeId,
    settings: {
      weightStep: [1, 1.25, 2, 2.5, 5].includes(num(s.weightStep)) ? num(s.weightStep) : 2.5,
      lastBackupAt: typeof s.lastBackupAt === 'number' ? s.lastBackupAt : null,
      hrMax: Math.round(Math.min(230, Math.max(120, num(s.hrMax, 190)))),
      heatMetric: s.heatMetric === 'sets' || s.heatMetric === 'kcal' ? s.heatMetric : 'load',
      health: cleanHealth(s.health),
    },
    wellness: cleanWellness(r.wellness),
    activities: cleanActivities(r.activities),
  };
}

/* ------------------------------------------------------------ persistence */

interface Envelope {
  savedAt: number;
  db: DB;
}

function readLocal(): Envelope | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    return { savedAt: num(env.savedAt), db: sanitize(env.db) };
  } catch {
    return null;
  }
}

let db: DB = emptyDB();
let ready = false;
let saveError = false;
const listeners = new Set<() => void>();
let pending = false;

function persistNow() {
  pending = false;
  const env: Envelope = { savedAt: Date.now(), db };
  const json = JSON.stringify(env);
  try {
    localStorage.setItem(KEY, json);
    saveError = false;
  } catch {
    saveError = true;
  }
  // On Android the log is also written to a file in app storage; WebView
  // storage is flushed lazily and could miss the last set if the app is killed.
  nativeFile.write(json).catch(() => {});
}

function schedulePersist() {
  if (pending) return;
  pending = true;
  queueMicrotask(persistNow);
}

export function flush() {
  if (pending) persistNow();
}

/** Loads the newest copy (WebView storage vs. app file) before first render. */
export async function initStore(seed?: () => DB) {
  const local = readLocal();
  let file: Envelope | null = null;
  try {
    const raw = await nativeFile.read();
    if (raw) {
      const env = JSON.parse(raw) as Envelope;
      file = { savedAt: num(env.savedAt), db: sanitize(env.db) };
    }
  } catch {
    file = null;
  }
  const best = local && file ? (file.savedAt > local.savedAt ? file : local) : (local ?? file);
  if (best) db = best.db;
  else if (seed) {
    db = seed();
    schedulePersist();
  }
  ready = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  }
}

export const isReady = () => ready;
export const hasSaveError = () => saveError;

export function getDB(): DB {
  return db;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function update(fn: (d: DB) => DB) {
  const next = fn(db);
  if (next === db) return;
  db = next;
  schedulePersist();
  listeners.forEach((l) => l());
}

export function useDB(): DB {
  return useSyncExternalStore(subscribe, getDB, getDB);
}

/* ------------------------------------------------------------ helpers */

function mapWorkout(d: DB, id: string, fn: (w: Workout) => Workout): DB {
  let changed = false;
  const workouts = d.workouts.map((w) => {
    if (w.id !== id) return w;
    changed = true;
    return fn(w);
  });
  return changed ? { ...d, workouts } : d;
}

function mapEntry(w: Workout, entryId: string, fn: (e: Entry) => Entry): Workout {
  return { ...w, entries: w.entries.map((e) => (e.id === entryId ? fn(e) : e)) };
}

/* ------------------------------------------------------------ workouts */

export function startWorkout(templateId?: string): string {
  const id = uid();
  update((d) => {
    const template = templateId ? d.workouts.find((w) => w.id === templateId) : undefined;
    const entries: Entry[] = [];
    if (template) {
      const seen = new Set<string>();
      for (const e of template.entries) {
        if (seen.has(e.exerciseId)) continue;
        seen.add(e.exerciseId);
        entries.push({ id: uid(), exerciseId: e.exerciseId, sets: [] });
      }
    }
    const w: Workout = { id, startedAt: Date.now(), endedAt: null, entries };
    return { ...d, workouts: [...d.workouts, w], activeId: id };
  });
  return id;
}

export function addEntry(workoutId: string, exerciseId: string): string {
  const id = uid();
  update((d) => mapWorkout(d, workoutId, (w) => ({ ...w, entries: [...w.entries, { id, exerciseId, sets: [] }] })));
  return id;
}

export function removeEntry(workoutId: string, entryId: string) {
  update((d) => mapWorkout(d, workoutId, (w) => ({ ...w, entries: w.entries.filter((e) => e.id !== entryId) })));
}

export function moveEntry(workoutId: string, entryId: string, dir: -1 | 1) {
  update((d) =>
    mapWorkout(d, workoutId, (w) => {
      const i = w.entries.findIndex((e) => e.id === entryId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= w.entries.length) return w;
      const entries = [...w.entries];
      [entries[i], entries[j]] = [entries[j], entries[i]];
      return { ...w, entries };
    }),
  );
}

export function logSet(workoutId: string, entryId: string, kg: number, reps: number): string {
  const id = uid();
  update((d) => {
    const w = d.workouts.find((x) => x.id === workoutId);
    // For past workouts keep timestamps inside the workout window.
    const at = w && w.endedAt !== null ? Math.min(w.endedAt, Math.max(w.startedAt, Date.now())) : Date.now();
    return mapWorkout(d, workoutId, (wk) => mapEntry(wk, entryId, (e) => ({ ...e, sets: [...e.sets, { id, kg, reps, at }] })));
  });
  return id;
}

export function updateSet(workoutId: string, entryId: string, setId: string, patch: { kg: number; reps: number }) {
  update((d) =>
    mapWorkout(d, workoutId, (w) =>
      mapEntry(w, entryId, (e) => ({ ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) })),
    ),
  );
}

export function deleteSet(workoutId: string, entryId: string, setId: string) {
  update((d) =>
    mapWorkout(d, workoutId, (w) => mapEntry(w, entryId, (e) => ({ ...e, sets: e.sets.filter((s) => s.id !== setId) }))),
  );
}

export function finishWorkout(workoutId: string, endedAt = Date.now()) {
  update((d) => {
    const next = mapWorkout(d, workoutId, (w) => ({
      ...w,
      endedAt: Math.max(endedAt, w.startedAt + 60_000),
      entries: w.entries.filter((e) => e.sets.length > 0),
    }));
    return { ...next, activeId: d.activeId === workoutId ? null : d.activeId };
  });
}

/** Drops exercises that ended up without sets. */
export function pruneWorkout(workoutId: string) {
  update((d) => mapWorkout(d, workoutId, (w) => ({ ...w, entries: w.entries.filter((e) => e.sets.length > 0) })));
}

export function deleteWorkout(workoutId: string) {
  update((d) => ({
    ...d,
    workouts: d.workouts.filter((w) => w.id !== workoutId),
    activeId: d.activeId === workoutId ? null : d.activeId,
  }));
}

export function updateWorkout(workoutId: string, patch: Partial<Pick<Workout, 'name' | 'note' | 'startedAt' | 'endedAt'>>) {
  update((d) => {
    const next = mapWorkout(d, workoutId, (w) => {
      const merged = { ...w, ...patch };
      if (merged.name !== undefined && !merged.name.trim()) delete merged.name;
      // New time window: heart rate has to be read again for it.
      if (merged.startedAt !== w.startedAt || merged.endedAt !== w.endedAt) delete merged.hr;
      return merged;
    });
    return { ...next, workouts: [...next.workouts].sort((a, b) => a.startedAt - b.startedAt) };
  });
}

/** Log a workout after the fact. */
export function createPastWorkout(startedAt: number, durationMs: number): string {
  const id = uid();
  update((d) => ({
    ...d,
    workouts: [...d.workouts, { id, startedAt, endedAt: startedAt + durationMs, entries: [] }].sort((a, b) => a.startedAt - b.startedAt),
  }));
  return id;
}

/* ------------------------------------------------------------ exercises */

export function createExercise(ex: Omit<Exercise, 'id' | 'custom'>): string {
  const id = 'c-' + uid();
  const clean: Exercise = { ...ex, id, custom: true };
  if (!clean.loaded) delete clean.loaded;
  update((d) => ({ ...d, exercises: [...d.exercises, clean] }));
  return id;
}

export function updateExercise(id: string, patch: Partial<Omit<Exercise, 'id'>>) {
  update((d) => ({
    ...d,
    exercises: d.exercises.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e, ...patch };
      if (!next.loaded) delete next.loaded;
      return next;
    }),
  }));
}

export function isExerciseUsed(d: DB, id: string) {
  return d.workouts.some((w) => w.entries.some((e) => e.exerciseId === id));
}

/** Removes an unused exercise; one with history is hidden instead so nothing is lost. */
export function removeExercise(id: string) {
  update((d) =>
    isExerciseUsed(d, id)
      ? { ...d, exercises: d.exercises.map((e) => (e.id === id ? { ...e, archived: true } : e)) }
      : { ...d, exercises: d.exercises.filter((e) => e.id !== id) },
  );
}

/* ------------------------------------------------------------ body weight */

export function logBodyWeight(date: string, kg: number) {
  update((d) => {
    const others = d.bodyweight.filter((b) => b.date !== date);
    return { ...d, bodyweight: [...others, { id: uid(), date, kg }] };
  });
}

export function deleteBodyWeight(id: string) {
  update((d) => ({ ...d, bodyweight: d.bodyweight.filter((b) => b.id !== id) }));
}

/* ------------------------------------------------------------ settings & data */

export function setSettings(patch: Partial<Settings>) {
  update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
}

export function setHealth(patch: Partial<HealthSettings>) {
  update((d) => ({ ...d, settings: { ...d.settings, health: { ...d.settings.health, ...patch } } }));
}

export interface HeartResult {
  id: string;
  /** the window the data was read for; skipped if the workout moved meanwhile */
  startedAt: number;
  endedAt: number;
  hr: HeartData;
}

/** Merges recovery data per morning and workouts from other apps; keeps the last ~4 months. */
export function applyWellness(days: Record<string, DayHealth>, activities?: Activity[], keepFrom?: number) {
  update((d) => {
    const wellness = { ...d.wellness };
    for (const [k, v] of Object.entries(days)) wellness[k] = { ...wellness[k], ...v };
    if (keepFrom !== undefined) {
      const cutoff = new Date(keepFrom);
      const key = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
      for (const k of Object.keys(wellness)) if (k < key) delete wellness[k];
    }
    let list = d.activities;
    if (activities) {
      const byId = new Map(d.activities.map((a) => [a.id, a]));
      for (const a of activities) {
        const old = byId.get(a.id);
        // keep heart rate already read unless the session changed
        byId.set(a.id, old && old.start === a.start && old.end === a.end && old.hr && !a.hr ? { ...a, hr: old.hr } : a);
      }
      list = [...byId.values()].filter((a) => keepFrom === undefined || a.end >= keepFrom).sort((x, y) => x.start - y.start);
    }
    return { ...d, wellness, activities: list };
  });
}

/** Attaches heart rate read for other apps' workouts. */
export function applyActivityHeart(results: { id: string; start: number; end: number; hr: HeartData }[]) {
  if (!results.length) return;
  const byId = new Map(results.map((r) => [r.id, r]));
  update((d) => ({
    ...d,
    activities: d.activities.map((a) => {
      const r = byId.get(a.id);
      return r && r.start === a.start && r.end === a.end ? { ...a, hr: r.hr } : a;
    }),
  }));
}

/** Stores heart rate read for workouts (one update for the whole batch). */
export function applyHeart(results: HeartResult[]) {
  if (!results.length) return;
  const byId = new Map(results.map((r) => [r.id, r]));
  update((d) => {
    let changed = false;
    const workouts = d.workouts.map((w) => {
      const r = byId.get(w.id);
      if (!r || r.startedAt !== w.startedAt || r.endedAt !== w.endedAt) return w;
      changed = true;
      return { ...w, hr: r.hr };
    });
    return changed ? { ...d, workouts } : d;
  });
}

export function replaceDB(next: DB) {
  update(() => next);
}

export function exportJSON(): string {
  return JSON.stringify({ app: 'logbook', exportedAt: new Date().toISOString(), ...db }, null, 1);
}

export function resetAll() {
  update(() => emptyDB());
}
