/* Turning Health Connect records into one recovery entry per morning.
   Pure functions, no platform code (unit-tested). */
import type { Activity, DayHealth, SleepNight, Workout } from './types';
import { dayKey } from './format';

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The morning a night-time record belongs to. Anything between 15:00 and 15:00
 * the next day counts for that next morning: sleep that ends at 07:00, an HRV
 * value stamped 23:50 or a nap at 13:00 all feed the same day's readiness.
 */
export const morningOf = (t: number) => dayKey(t + 9 * HOUR);

export interface SleepStageIn {
  start: number;
  end: number;
  stage: string;
}

export interface SleepSessionIn {
  start: number;
  end: number;
  src?: string;
  stages?: SleepStageIn[];
}

export interface ValueIn {
  t: number;
  value: number;
  src?: string;
}

/** Keeps records of the source that wrote the most, so two apps never mix. */
export function dominant<T extends { src?: string }>(items: T[]): T[] {
  const n = new Map<string, number>();
  for (const i of items) n.set(i.src ?? '', (n.get(i.src ?? '') ?? 0) + 1);
  let best = '';
  let max = -1;
  for (const [k, v] of n) if (v > max) [best, max] = [k, v];
  return items.filter((i) => (i.src ?? '') === best);
}

/** Minutes per stage; a session without stages counts as asleep throughout. */
export function sessionMinutes(s: SleepSessionIn) {
  const bed = (s.end - s.start) / MIN;
  const m = { bed, asleep: 0, deep: 0, rem: 0, light: 0, awake: 0, staged: false };
  if (!s.stages?.length) {
    m.asleep = bed;
    return m;
  }
  m.staged = true;
  for (const st of s.stages) {
    const d = Math.max(0, (Math.min(st.end, s.end) - Math.max(st.start, s.start)) / MIN);
    if (st.stage === 'deep') m.deep += d;
    else if (st.stage === 'rem') m.rem += d;
    else if (st.stage === 'light') m.light += d;
    else if (st.stage === 'awake') m.awake += d;
    else if (st.stage === 'asleep') m.light += d; // "sleeping" without a stage
  }
  m.asleep = m.deep + m.rem + m.light;
  return m;
}

/** Sleep per morning: sessions that end between 15:00 and 15:00 add up. */
export function buildNights(sessions: SleepSessionIn[]): Record<string, SleepNight> {
  const out: Record<string, SleepNight> = {};
  const ok = dominant(sessions.filter((s) => s.end - s.start >= 15 * MIN && s.end - s.start <= 18 * HOUR)).sort((a, b) => a.start - b.start);
  for (const s of ok) {
    const key = morningOf(s.end);
    const m = sessionMinutes(s);
    const cur = out[key];
    if (!cur) {
      out[key] = {
        start: s.start,
        end: s.end,
        bed: m.bed,
        asleep: m.asleep,
        ...(m.staged ? { deep: m.deep, rem: m.rem, light: m.light, awake: m.awake } : {}),
      };
      continue;
    }
    // Overlapping sessions (the same night written twice) count once: keep the fuller one.
    if (s.start < cur.end) {
      if (m.asleep > cur.asleep) {
        out[key] = {
          start: s.start,
          end: s.end,
          bed: m.bed,
          asleep: m.asleep,
          ...(m.staged ? { deep: m.deep, rem: m.rem, light: m.light, awake: m.awake } : {}),
        };
      }
      continue;
    }
    cur.start = Math.min(cur.start, s.start);
    cur.end = Math.max(cur.end, s.end);
    cur.bed += m.bed;
    cur.asleep += m.asleep;
    if (m.staged && cur.deep !== undefined) {
      cur.deep! += m.deep;
      cur.rem! += m.rem;
      cur.light! += m.light;
      cur.awake! += m.awake;
    }
  }
  for (const n of Object.values(out)) {
    n.bed = Math.round(n.bed);
    n.asleep = Math.round(n.asleep);
    for (const k of ['deep', 'rem', 'light', 'awake'] as const) if (n[k] !== undefined) n[k] = Math.round(n[k]!);
  }
  return out;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * One value per morning from point records (HRV, resting HR, breathing rate).
 * HRV is averaged on a log scale, the others by median.
 */
export function perMorning(items: ValueIn[], kind: 'hrv' | 'rhr' | 'resp'): Record<string, number> {
  const limits = { hrv: [5, 300], rhr: [30, 120], resp: [5, 40] }[kind];
  const groups = new Map<string, number[]>();
  for (const i of dominant(items.filter((x) => Number.isFinite(x.value) && x.value >= limits[0] && x.value <= limits[1]))) {
    const k = morningOf(i.t);
    const g = groups.get(k) ?? [];
    g.push(i.value);
    groups.set(k, g);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of groups) {
    const x = kind === 'hrv' ? Math.exp(v.reduce((a, b) => a + Math.log(b), 0) / v.length) : median(v);
    out[k] = Math.round(x * 10) / 10;
  }
  return out;
}

/** Puts per-kind maps together into DayHealth entries. */
export function combineDays(parts: {
  sleep?: Record<string, SleepNight>;
  hrv?: Record<string, number>;
  rhr?: Record<string, number>;
  resp?: Record<string, number>;
  steps?: Record<string, number>;
}): Record<string, DayHealth> {
  const out: Record<string, DayHealth> = {};
  const put = <K extends keyof DayHealth>(k: K, map: Record<string, DayHealth[K]> | undefined) => {
    if (!map) return;
    for (const [day, v] of Object.entries(map)) (out[day] ??= {})[k] = v;
  };
  put('sleep', parts.sleep);
  put('hrv', parts.hrv);
  put('rhr', parts.rhr);
  put('resp', parts.resp);
  put('steps', parts.steps);
  return out;
}

/** True when most of an activity happened during a workout logged in Logbook (same session, recorded twice). */
export function overlapsWorkout(a: Pick<Activity, 'start' | 'end'>, workouts: Workout[]): boolean {
  const len = a.end - a.start;
  if (len <= 0) return false;
  for (const w of workouts) {
    if (w.endedAt === null) continue;
    const o = Math.min(a.end, w.endedAt) - Math.max(a.start, w.startedAt);
    if (o > len * 0.5) return true;
  }
  return false;
}

/** Health Connect exercise types, readable. */
export function activityLabel(type: string): string {
  const map: Record<string, string> = {
    biking: 'Bike ride',
    cycling: 'Bike ride',
    bikingStationary: 'Indoor bike',
    running: 'Run',
    runningTreadmill: 'Treadmill run',
    walking: 'Walk',
    hiking: 'Hike',
    swimming: 'Swim',
    swimmingPool: 'Swim',
    swimmingOpenWater: 'Open-water swim',
    rowing: 'Rowing',
    rowingMachine: 'Rowing machine',
    elliptical: 'Elliptical',
    highIntensityIntervalTraining: 'HIIT',
    yoga: 'Yoga',
    soccer: 'Football',
    tennis: 'Tennis',
    strengthTraining: 'Strength training',
    traditionalStrengthTraining: 'Strength training',
    functionalStrengthTraining: 'Strength training',
    weightlifting: 'Weightlifting',
  };
  if (map[type]) return map[type];
  const words = type.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Workout';
}
