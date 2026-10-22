/* Training readiness: how recovered you are this morning and what kind of
   session fits. Pure functions (unit-tested), fed by Health Connect data and
   by the log itself.

   Signals, each compared with your own normal (robust median ± spread):
   - HRV (RMSSD, log scale): last night and the 7-day trend, as in HRV-guided
     training (Kiviniemi 2007; Plews & Buchheit; Altini).
   - Resting heart rate: a rise of ~5 bpm or more is a classic strain marker.
   - Sleep: duration against need (8 h, more after a hard day), sleep debt over
     the past week, efficiency, deep + REM share, regularity.
   - Training load: every workout in heart-rate zone minutes (Logbook sessions,
     plus rides and runs from other apps), fitness–fatigue balance from 7- and
     42-day exponential averages (Banister), and yesterday's spike.
   - Breathing rate: only as an alarm; a clear rise often comes with illness.
   - Muscles: per muscle group, how much of the last sessions' fatigue is left,
     from the sets you logged. Wearables can't see this.
   It also learns from you: once there are enough workouts, signals that
   tracked how your lifts went get a bit more weight. */
import type { Activity, DayHealth, Muscle, Workout } from './types';
import { addDays, dayKey, parseDayKey, startOfDay } from './format';
import { heartView } from './heart';
import { e1rm, type ExMap } from './stats';
import { MUSCLES } from './exercises';
import { activityLabel, overlapsWorkout } from './wellness';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type Level = 'heavy' | 'normal' | 'light' | 'rest';
export type ComponentKey = 'hrv' | 'rhr' | 'sleep' | 'load';

export const LEVELS: Record<Level, { title: string; short: string; advice: string }> = {
  heavy: {
    title: 'Go heavy',
    short: 'Ready for a hard session',
    advice: 'A good day for heavy top sets or a PR attempt. Warm up well, then take the main lift to RPE 9.',
  },
  normal: {
    title: 'Normal session',
    short: 'Train as planned',
    advice: 'Your usual weights and sets, around RPE 7–8. Leave a rep or two in the tank.',
  },
  light: {
    title: 'Keep it light',
    short: 'Ease off today',
    advice: 'Cut sets by about a third and stop 3 reps short of failure, or use the day for technique.',
  },
  rest: {
    title: 'Recover',
    short: 'Rest or move easy',
    advice: 'Rest, walk or do easy cardio below 60% of your max heart rate. You will lift better after it.',
  },
};

export const levelOfScore = (s: number): Level => (s >= 80 ? 'heavy' : s >= 60 ? 'normal' : s >= 40 ? 'light' : 'rest');

/* ------------------------------------------------------------ small maths */

/** Straight lines between anchor points, flat outside them. */
export function curve(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface Baseline {
  med: number;
  sd: number;
  n: number;
}

/** Robust normal: median and MAD-based spread, so one odd night doesn't move it. */
export function baseline(values: number[], minSd: number, minN = 4): Baseline | null {
  if (values.length < minN) return null;
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  return { med, sd: Math.max(minSd, 1.4826 * mad), n: values.length };
}

/** Spearman rank correlation. */
export function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

const fmtMin = (min: number) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
const pctText = (ratio: number) => `${Math.abs(Math.round((ratio - 1) * 100))}%`;

/* ------------------------------------------------------------ input */

export interface ReadinessInput {
  /** finished workouts */
  workouts: Workout[];
  wellness: Record<string, DayHealth>;
  activities: Activity[];
  ex: ExMap;
  hrMax: number;
  now: number;
}

export interface LoadPart {
  label: string;
  load: number;
  kind: 'gym' | 'activity' | 'steps';
  /** estimated from sets or duration, not measured */
  estimated: boolean;
}

/** Load per minute (zone-minute units) when an activity has no heart rate. */
const TYPE_RATE: Record<string, number> = {
  running: 2.6, runningTreadmill: 2.6, biking: 2.0, cycling: 2.0, bikingStationary: 2.2, walking: 0.8, hiking: 1.4,
  swimming: 2.4, swimmingPool: 2.4, swimmingOpenWater: 2.4, rowing: 2.4, rowingMachine: 2.4, elliptical: 2.0,
  highIntensityIntervalTraining: 3.2, yoga: 0.6, soccer: 2.6, tennis: 2.4, basketball: 2.6,
  strengthTraining: 1.4, traditionalStrengthTraining: 1.4, functionalStrengthTraining: 1.6, weightlifting: 1.4,
};

interface Prepared {
  input: ReadinessInput;
  today: string;
  loads: Map<string, number>;
  parts: Map<string, LoadPart[]>;
  /** fatigue/fitness after each day, by day key */
  ewma: Map<string, { atl: number; ctl: number }>;
  firstDay: string | null;
  setFactor: number;
}

/** Load per logged set, learned from your workouts that have heart rate. */
export function setFactor(workouts: Workout[], hrMax: number): number {
  const r: number[] = [];
  for (const w of workouts) {
    const v = heartView(w.hr, hrMax);
    const sets = w.entries.reduce((a, e) => a + e.sets.length, 0);
    if (v && v.cover >= 0.6 && sets >= 4) r.push(v.load / sets);
  }
  return r.length >= 5 ? Math.min(12, Math.max(2, median(r))) : 5.5;
}

function prepare(input: ReadinessInput): Prepared {
  const today = dayKey(input.now);
  const loads = new Map<string, number>();
  const parts = new Map<string, LoadPart[]>();
  const add = (key: string, p: LoadPart) => {
    if (p.load <= 0) return;
    loads.set(key, (loads.get(key) ?? 0) + p.load);
    const arr = parts.get(key) ?? [];
    arr.push(p);
    parts.set(key, arr);
  };
  const factor = setFactor(input.workouts, input.hrMax);
  for (const w of input.workouts) {
    if (w.endedAt === null) continue;
    const v = heartView(w.hr, input.hrMax);
    const sets = w.entries.reduce((a, e) => a + e.sets.length, 0);
    const measured = v && v.cover >= 0.5;
    const load = measured ? v.load / Math.max(0.5, v.cover) : sets * factor;
    add(dayKey(w.startedAt), { label: 'Logbook workout', load: Math.round(load), kind: 'gym', estimated: !measured });
  }
  for (const a of input.activities) {
    if (overlapsWorkout(a, input.workouts)) continue;
    const v = heartView(a.hr, input.hrMax);
    const minutes = (a.end - a.start) / 60_000;
    const measured = v && v.cover >= 0.5;
    const load = measured ? v.load / Math.max(0.5, v.cover) : minutes * (TYPE_RATE[a.type] ?? 1.6);
    add(dayKey(a.start), { label: activityLabel(a.type), load: Math.round(load), kind: 'activity', estimated: !measured });
  }
  for (const [key, d] of Object.entries(input.wellness)) {
    if (d.steps && d.steps > 8000) add(key, { label: `${Math.round(d.steps / 100) / 10}k steps`, load: Math.round((d.steps - 8000) * 0.004), kind: 'steps', estimated: true });
  }

  // Fitness (42-day) and fatigue (7-day) exponential averages, day by day.
  const keys = [...loads.keys()].sort();
  const firstDay = keys[0] ?? null;
  const ewma = new Map<string, { atl: number; ctl: number }>();
  if (firstDay) {
    const start = Math.max(parseDayKey(firstDay), startOfDay(input.now) - 200 * DAY);
    // Start from the average of the first four weeks, not from zero.
    let sum = 0;
    let n = 0;
    for (let t = start, i = 0; i < 28 && t <= startOfDay(input.now); t = addDays(t, 1), i++) {
      sum += loads.get(dayKey(t)) ?? 0;
      n++;
    }
    let atl = n ? sum / n : 0;
    let ctl = atl;
    const ka = 1 - Math.exp(-1 / 7);
    const kc = 1 - Math.exp(-1 / 42);
    for (let t = start; t <= startOfDay(input.now); t = addDays(t, 1)) {
      const key = dayKey(t);
      const l = loads.get(key) ?? 0;
      atl += (l - atl) * ka;
      ctl += (l - ctl) * kc;
      ewma.set(key, { atl, ctl });
    }
  }
  return { input, today, loads, parts, ewma, firstDay, setFactor: factor };
}

/* ------------------------------------------------------------ components */

interface Comp {
  key: ComponentKey;
  score: number;
  /** confidence 0–1 (short history or stale data) */
  conf: number;
  value: string;
  detail: string;
  calibrating?: string;
  /** z-like signal for flags */
  z?: number;
  extra?: Record<string, number>;
}

const prevDays = (key: string, n: number, from = 1) => {
  const t = parseDayKey(key);
  const out: string[] = [];
  for (let i = from; i <= n; i++) out.push(dayKey(addDays(t, -i)));
  return out;
};

function hrvComp(p: Prepared, key: string): Comp | null {
  const days = p.input.wellness;
  const today = days[key]?.hrv;
  if (!today) return null;
  const hist = prevDays(key, 60)
    .map((k) => days[k]?.hrv)
    .filter((v): v is number => !!v)
    .map(Math.log);
  const base = baseline(hist, 0.06);
  if (!base) return { key: 'hrv', score: 70, conf: 0.2, value: `${Math.round(today)} ms`, detail: 'Learning your normal', calibrating: `${hist.length} of 14 nights` };
  const x = Math.log(today);
  const zAcute = (x - base.med) / base.sd;
  const week = [x, ...prevDays(key, 6).map((k) => days[k]?.hrv).filter((v): v is number => !!v).map(Math.log)];
  const zTrend = week.length >= 3 ? (week.reduce((a, b) => a + b, 0) / week.length - base.med) / base.sd : zAcute;
  const z = 0.6 * zAcute + 0.4 * zTrend;
  const ratio = today / Math.exp(base.med);
  const detail =
    Math.abs(zAcute) < 0.5
      ? `In your normal range (${Math.round(Math.exp(base.med))} ms)`
      : `${pctText(ratio)} ${ratio > 1 ? 'above' : 'below'} your normal (${Math.round(Math.exp(base.med))} ms)`;
  return {
    key: 'hrv',
    score: curve(z, [[-2.5, 5], [-1.5, 22], [-0.75, 48], [0, 75], [0.75, 90], [1.5, 97]]),
    conf: Math.min(1, base.n / 14),
    value: `${Math.round(today)} ms`,
    detail,
    calibrating: base.n < 14 ? `${base.n} of 14 nights` : undefined,
    z: zAcute,
    extra: { zTrend },
  };
}

function rhrComp(p: Prepared, key: string): Comp | null {
  const days = p.input.wellness;
  let today = days[key]?.rhr;
  let stale = false;
  if (!today) {
    today = days[prevDays(key, 1)[0]]?.rhr;
    stale = true;
  }
  if (!today) return null;
  const hist = prevDays(key, 60, stale ? 2 : 1)
    .map((k) => days[k]?.rhr)
    .filter((v): v is number => !!v);
  const base = baseline(hist, 1.5);
  if (!base) return { key: 'rhr', score: 70, conf: 0.2, value: `${Math.round(today)} bpm`, detail: 'Learning your normal', calibrating: `${hist.length} of 14 days` };
  const delta = today - base.med;
  const z = -delta / base.sd;
  const d = Math.round(delta);
  return {
    key: 'rhr',
    score: curve(z, [[-2.5, 8], [-1.5, 28], [-0.75, 52], [0, 75], [1, 88], [2, 92]]),
    conf: Math.min(1, base.n / 14) * (stale ? 0.6 : 1),
    value: `${Math.round(today)} bpm`,
    detail: Math.abs(d) <= 1 ? `At your normal (${Math.round(base.med)} bpm)` : `${Math.abs(d)} bpm ${d > 0 ? 'above' : 'below'} your normal`,
    calibrating: base.n < 14 ? `${base.n} of 14 days` : undefined,
    z: -z,
    extra: { delta },
  };
}

/** Minutes of sleep needed: 8 h, up to 30 min more after a hard day. */
function sleepNeed(p: Prepared, key: string): number {
  const y = prevDays(key, 1)[0];
  const e = p.ewma.get(y);
  const l = p.loads.get(y) ?? 0;
  const ratio = e ? l / Math.max(e.ctl, 10) : 0;
  return 480 + Math.round(Math.min(30, Math.max(0, (ratio - 1) * 15)));
}

function sleepComp(p: Prepared, key: string): Comp | null {
  const days = p.input.wellness;
  const night = days[key]?.sleep;
  if (!night) return null;
  const need = sleepNeed(p, key);
  const dur = curve(night.asleep / need, [[0.5, 8], [0.6, 22], [0.7, 42], [0.8, 64], [0.9, 84], [1.0, 97], [1.1, 100]]);
  // Sleep debt over the week before, recent nights count more.
  const w = [1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.25];
  let debt = 0;
  let nights = 0;
  prevDays(key, 7).forEach((k, i) => {
    const s = days[k]?.sleep;
    if (!s) return;
    nights++;
    debt += (w[i] * Math.max(0, 480 - s.asleep)) / 60;
  });
  const parts: [number, number][] = [[dur, 0.55]];
  if (nights >= 3) parts.push([curve(debt, [[0, 100], [2, 86], [4, 68], [7, 42], [10, 22]]), 0.2]);
  // Quality: time asleep in bed and the restorative (deep + REM) share against your usual.
  const q: number[] = [];
  if (night.awake !== undefined && night.bed > 0) q.push(curve(night.asleep / night.bed, [[0.65, 30], [0.75, 55], [0.85, 85], [0.92, 100]]));
  if (night.deep !== undefined && night.rem !== undefined && night.asleep > 0) {
    const share = (night.deep + night.rem) / night.asleep;
    const usual = prevDays(key, 30)
      .map((k) => days[k]?.sleep)
      .filter((s): s is NonNullable<typeof s> => !!s && s.deep !== undefined && s.rem !== undefined && s.asleep > 0)
      .map((s) => (s.deep! + s.rem!) / s.asleep);
    const ref = usual.length >= 5 ? median(usual) : 0.4;
    q.push(curve(share / ref, [[0.6, 40], [0.8, 70], [1.0, 92], [1.15, 100]]));
  }
  if (q.length) parts.push([q.reduce((a, b) => a + b, 0) / q.length, 0.15]);
  // Regularity: spread of sleep midpoints over the week.
  const mids = [key, ...prevDays(key, 6)]
    .map((k) => days[k]?.sleep)
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => {
      const mid = new Date((s.start + s.end) / 2 + 12 * HOUR);
      return mid.getHours() * 60 + mid.getMinutes();
    });
  if (mids.length >= 4) {
    const m = mids.reduce((a, b) => a + b, 0) / mids.length;
    const sd = Math.sqrt(mids.reduce((a, b) => a + (b - m) ** 2, 0) / mids.length);
    parts.push([curve(sd, [[20, 100], [45, 90], [75, 72], [120, 50]]), 0.1]);
  }
  const wsum = parts.reduce((a, [, x]) => a + x, 0);
  const score = parts.reduce((a, [s, x]) => a + s * x, 0) / wsum;
  const short = need - night.asleep;
  return {
    key: 'sleep',
    score,
    conf: 1,
    value: fmtMin(night.asleep),
    detail:
      short > 20
        ? `${fmtMin(short)} short of the ${fmtMin(need)} you need${debt >= 2 ? ` · ${fmtMin(debt * 60)} debt this week` : ''}`
        : debt >= 2
          ? `Enough last night · ${fmtMin(debt * 60)} debt this week`
          : 'Enough sleep, and a rested week',
    extra: { asleep: night.asleep, need, debt },
  };
}

function loadComp(p: Prepared, key: string): Comp | null {
  if (!p.firstDay) return null;
  const y = prevDays(key, 1)[0];
  const e = p.ewma.get(y);
  if (!e) return null;
  const ctl = Math.max(e.ctl, 10);
  const form = (e.ctl - e.atl) / ctl;
  const yLoad = p.loads.get(y) ?? 0;
  // Yesterday against your usual training day (not the daily average, which rest days pull down).
  const trainingDays = prevDays(key, 43, 2)
    .map((k) => p.loads.get(k) ?? 0)
    .filter((l) => l > 15);
  const usualDay = trainingDays.length >= 5 ? median(trainingDays) : ctl * 2.5;
  const spike = yLoad / Math.max(usualDay, 20);
  const history = (parseDayKey(key) - parseDayKey(p.firstDay)) / DAY;
  const score = Math.max(5, curve(form, [[-0.8, 15], [-0.5, 38], [-0.25, 60], [0, 78], [0.25, 90], [0.5, 95]]) - Math.min(20, Math.max(0, (spike - 1.3) * 25)));
  const acwr = e.atl / ctl;
  const detail =
    acwr > 1.3
      ? `Last week ${pctText(acwr)} harder than your usual`
      : acwr < 0.8
        ? `Last week ${pctText(acwr)} lighter than your usual`
        : yLoad > 0
          ? `Yesterday load ${Math.round(yLoad)}, a usual week`
          : 'Rest day yesterday, a usual week';
  return {
    key: 'load',
    score,
    conf: history >= 21 ? 1 : Math.max(0.4, history / 21),
    value: form >= 0.1 ? 'Fresh' : form <= -0.25 ? 'Tired' : 'Balanced',
    detail,
    calibrating: history < 21 ? `${Math.max(0, Math.round(history))} of 21 days` : undefined,
    extra: { form, acwr, atl: e.atl, ctl: e.ctl, yesterday: yLoad },
  };
}

/* ------------------------------------------------------------ muscles */

export interface MuscleState {
  muscle: Muscle;
  label: string;
  /** 0–100 */
  freshness: number;
  /** days since last trained, null if not in the last 8 weeks */
  lastDays: number | null;
}

/** Half-life of the fatigue left after training a muscle group, hours. */
const HALF_LIFE: Record<Muscle, number> = { legs: 30, back: 26, chest: 26, shoulders: 24, biceps: 22, triceps: 22, core: 18 };

export function muscleFreshness(workouts: Workout[], ex: ExMap, now: number): MuscleState[] {
  const since = now - 56 * DAY;
  const sessionSets = new Map<Muscle, number[]>();
  const last = new Map<Muscle, number>();
  const residual = new Map<Muscle, number>();
  for (const w of workouts) {
    if (w.startedAt < since || w.startedAt > now) continue;
    const per = new Map<Muscle, number>();
    for (const e of w.entries) {
      const m = ex.get(e.exerciseId)?.muscle;
      if (!m || !e.sets.length) continue;
      per.set(m, (per.get(m) ?? 0) + e.sets.length);
      for (const s of e.sets) {
        const h = Math.max(0, (now - s.at) / HOUR);
        residual.set(m, (residual.get(m) ?? 0) + Math.pow(2, -h / HALF_LIFE[m]));
      }
      last.set(m, Math.max(last.get(m) ?? 0, w.startedAt));
    }
    for (const [m, n] of per) sessionSets.set(m, [...(sessionSets.get(m) ?? []), n]);
  }
  return MUSCLES.map(({ id, label }) => {
    const dose = Math.max(3, sessionSets.get(id)?.length ? median(sessionSets.get(id)!) : 6);
    const fatigue = (residual.get(id) ?? 0) / dose;
    const l = last.get(id);
    return {
      muscle: id,
      label,
      freshness: Math.round(Math.max(0, Math.min(100, 100 * (1 - 0.85 * fatigue)))),
      lastDays: l ? Math.floor((startOfDay(now) - startOfDay(l)) / DAY) : null,
    };
  });
}

/* ------------------------------------------------------------ personal tuning */

/** How a workout went against your recent best: top e1RM per lift vs the median of its last sessions. */
export function performanceIndex(w: Workout, workouts: Workout[], ex: ExMap): number | null {
  let sum = 0;
  let weight = 0;
  let lifts = 0;
  for (const e of w.entries) {
    const exercise = ex.get(e.exerciseId);
    if (!exercise || exercise.kind !== 'weighted' || !e.sets.length) continue;
    const top = Math.max(...e.sets.map((s) => e1rm(s.kg, s.reps)));
    if (top <= 0) continue;
    const prev: number[] = [];
    for (const o of workouts) {
      if (o.startedAt >= w.startedAt || o.startedAt < w.startedAt - 60 * DAY) continue;
      for (const oe of o.entries) {
        if (oe.exerciseId !== e.exerciseId || !oe.sets.length) continue;
        prev.push(Math.max(...oe.sets.map((s) => e1rm(s.kg, s.reps))));
      }
    }
    if (!prev.length) continue;
    const ref = median(prev.slice(-3));
    if (ref <= 0) continue;
    sum += (top / ref) * e.sets.length;
    weight += e.sets.length;
    lifts++;
  }
  return lifts >= 2 ? sum / weight : null;
}

export interface Tuning {
  n: number;
  /** correlation of each signal with how your lifts went */
  rho: Partial<Record<ComponentKey, number>>;
  multipliers: Partial<Record<ComponentKey, number>>;
}

const BASE_WEIGHTS: Record<ComponentKey, number> = { hrv: 0.32, sleep: 0.28, load: 0.22, rhr: 0.18 };
const MIN_PAIRS = 20;

function tune(p: Prepared): Tuning {
  const rows: { s: Partial<Record<ComponentKey, number>>; perf: number }[] = [];
  const from = p.input.now - 240 * DAY;
  for (const w of p.input.workouts) {
    if (w.startedAt < from) continue;
    const perf = performanceIndex(w, p.input.workouts, p.input.ex);
    if (perf === null) continue;
    const key = dayKey(w.startedAt);
    const s: Partial<Record<ComponentKey, number>> = {};
    for (const c of [hrvComp(p, key), rhrComp(p, key), sleepComp(p, key), loadComp(p, key)]) if (c && c.conf >= 0.5) s[c.key] = c.score;
    rows.push({ s, perf });
  }
  const rho: Partial<Record<ComponentKey, number>> = {};
  const multipliers: Partial<Record<ComponentKey, number>> = {};
  let n = 0;
  for (const k of Object.keys(BASE_WEIGHTS) as ComponentKey[]) {
    const pairs = rows.filter((r) => r.s[k] !== undefined);
    if (pairs.length < MIN_PAIRS) continue;
    n = Math.max(n, pairs.length);
    const r = spearman(pairs.map((x) => x.s[k]!), pairs.map((x) => x.perf));
    rho[k] = r;
    // Bounded: a signal can gain up to 40% weight or lose up to 20%.
    multipliers[k] = 1 + 0.8 * Math.max(-0.25, Math.min(0.5, r));
  }
  return { n, rho, multipliers };
}

/* ------------------------------------------------------------ the score */

export interface Component {
  key: ComponentKey;
  label: string;
  score: number;
  /** share of the final score, 0–1 */
  weight: number;
  value: string;
  detail: string;
  calibrating?: string;
}

export interface Readiness {
  day: string;
  score: number;
  level: Level;
  components: Component[];
  missing: ComponentKey[];
  /** warnings that capped the score */
  flags: string[];
  /** extra advice */
  notes: string[];
  muscles: MuscleState[];
  load: { form: number; acwr: number; yesterday: number; parts: LoadPart[] };
  /** a workout already logged that day */
  trainedToday: boolean;
  /** last night's sleep or HRV is in */
  lastNight: boolean;
  tuning: Tuning | null;
}

const LABELS: Record<ComponentKey, string> = { hrv: 'HRV', rhr: 'Resting heart rate', sleep: 'Sleep', load: 'Training load' };

function scoreDay(p: Prepared, key: string, tuning: Tuning | null) {
  const comps = [hrvComp(p, key), rhrComp(p, key), sleepComp(p, key), loadComp(p, key)].filter((c): c is Comp => !!c);
  if (!comps.length) return null;
  const raw = comps.map((c) => ({ c, w: BASE_WEIGHTS[c.key] * c.conf * (tuning?.multipliers[c.key] ?? 1) }));
  const wsum = raw.reduce((a, r) => a + r.w, 0) || 1;
  let score = raw.reduce((a, r) => a + r.c.score * r.w, 0) / wsum;

  const flags: string[] = [];
  const days = p.input.wellness;
  const hrv = comps.find((c) => c.key === 'hrv');
  const rhr = comps.find((c) => c.key === 'rhr');
  const sleep = comps.find((c) => c.key === 'sleep');
  const rhrUp = (rhr?.extra?.delta ?? 0) >= 5;
  const hrvDown = (hrv?.z ?? 0) <= -1.5;
  // Breathing rate: a clear rise against your normal is an early sign of illness.
  const resp = days[key]?.resp;
  let respUp = false;
  if (resp) {
    const base = baseline(prevDays(key, 60).map((k) => days[k]?.resp).filter((v): v is number => !!v), 0.5, 7);
    if (base && resp - base.med >= 1 && (resp - base.med) / base.sd >= 2) respUp = true;
  }
  if (respUp && (rhrUp || hrvDown)) {
    score = Math.min(score, 30);
    flags.push('Breathing rate and heart signals both point to strain, maybe an infection starting. Take it easy.');
  } else if (respUp) {
    score = Math.min(score, 55);
    flags.push('Breathing rate is up on your normal, which often comes before a cold.');
  } else if (rhrUp && hrvDown) {
    score = Math.min(score, 35);
    flags.push('Resting heart rate up and HRV down together: your body is under real strain.');
  }
  if (sleep && (sleep.extra?.asleep ?? 999) < 300) {
    score = Math.min(score, 50);
    flags.push('Under 5 hours of sleep.');
  }
  // Training load alone can't confirm a top day: that takes sleep or heart signals.
  if (!comps.some((c) => c.key !== 'load')) score = Math.min(score, 79);
  const components: Component[] = raw
    .map(({ c, w }) => ({ key: c.key, label: LABELS[c.key], score: Math.round(c.score), weight: w / wsum, value: c.value, detail: c.detail, calibrating: c.calibrating }))
    .sort((a, b) => b.weight - a.weight);
  return { score: Math.max(1, Math.min(100, Math.round(score))), components, flags, comps };
}

const cache = new WeakMap<ReadinessInput, { p: Prepared; tuned: Tuning | null }>();

/** Load series and personal tuning, computed once per input. */
function analysis(input: ReadinessInput) {
  let hit = cache.get(input);
  if (!hit) {
    const p = prepare(input);
    const tuning = tune(p);
    hit = { p, tuned: Object.keys(tuning.multipliers).length ? tuning : null };
    cache.set(input, hit);
  }
  return hit;
}

/** This morning's readiness (or another day's). Null when there is nothing to go on yet. */
export function computeReadiness(input: ReadinessInput, key = dayKey(input.now)): Readiness | null {
  const { p, tuned } = analysis(input);
  const day = scoreDay(p, key, tuned);
  if (!day) return null;
  const level = levelOfScore(day.score);
  const notes: string[] = [];
  const sleep = day.comps.find((c) => c.key === 'sleep');
  const hrv = day.comps.find((c) => c.key === 'hrv');
  const load = day.comps.find((c) => c.key === 'load');
  if (sleep && (sleep.extra?.asleep ?? 999) < 0.85 * (sleep.extra?.need ?? 480) && (hrv?.score ?? 70) >= 50 && level !== 'rest') {
    notes.push('Short sleep costs more in volume than in max strength: keep the heavy sets, drop a few back-off sets.');
  }
  if ((load?.extra?.acwr ?? 1) > 1.4) notes.push('Your last 7 days were much harder than usual. An easier day now helps you absorb them.');
  if (hrv && (hrv.z ?? 0) >= 2.5) notes.push('HRV is unusually high. Usually a great sign, but if you feel run down, trust that.');
  const muscles = muscleFreshness(input.workouts, input.ex, key === dayKey(input.now) ? input.now : parseDayKey(key) + 12 * HOUR);
  const e = p.ewma.get(prevDays(key, 1)[0]);
  const trainedToday = input.workouts.some((w) => dayKey(w.startedAt) === key && w.endedAt !== null);
  const night = input.wellness[key];
  return {
    day: key,
    score: day.score,
    level,
    components: day.components,
    missing: (['hrv', 'sleep', 'rhr', 'load'] as ComponentKey[]).filter((k) => !day.components.some((c) => c.key === k)),
    flags: day.flags,
    notes,
    muscles,
    load: {
      form: e ? (e.ctl - e.atl) / Math.max(e.ctl, 10) : 0,
      acwr: e ? e.atl / Math.max(e.ctl, 10) : 1,
      yesterday: p.loads.get(prevDays(key, 1)[0]) ?? 0,
      parts: p.parts.get(prevDays(key, 1)[0]) ?? [],
    },
    trainedToday,
    lastNight: !!(night?.sleep || night?.hrv),
    tuning: tuned,
  };
}

/** Scores for the last `n` mornings, oldest first (days without data are skipped). */
export function readinessHistory(input: ReadinessInput, n = 30): { day: string; score: number }[] {
  const { p, tuned } = analysis(input);
  const out: { day: string; score: number }[] = [];
  const t0 = startOfDay(input.now);
  for (let i = n - 1; i >= 0; i--) {
    const key = dayKey(addDays(t0, -i));
    // Only days with something measured that morning, not just training load.
    const d = input.wellness[key];
    if (!d?.sleep && !d?.hrv && !d?.rhr) continue;
    const s = scoreDay(p, key, tuned);
    if (s) out.push({ day: key, score: s.score });
  }
  return out;
}

/** The routine (one of your recent workouts) whose muscles are freshest today. */
export function suggestWorkout(
  workouts: Workout[],
  ex: ExMap,
  muscles: MuscleState[],
  now: number,
): { id: string; muscles: Muscle[]; freshness: number; daysAgo: number } | null {
  const fresh = new Map(muscles.map((m) => [m.muscle, m.freshness]));
  const seen: Set<string>[] = [];
  let best: { id: string; muscles: Muscle[]; freshness: number; daysAgo: number } | null = null;
  const recent = [...workouts].filter((w) => w.endedAt !== null && w.startedAt > now - 42 * DAY).sort((a, b) => b.startedAt - a.startedAt);
  for (const w of recent) {
    const ids = new Set(w.entries.filter((e) => e.sets.length).map((e) => e.exerciseId));
    if (ids.size < 2) continue;
    // one candidate per routine
    if (seen.some((s) => [...ids].filter((i) => s.has(i)).length / Math.max(ids.size, s.size) >= 0.5)) continue;
    seen.push(ids);
    const per = new Map<Muscle, number>();
    for (const e of w.entries) {
      const m = ex.get(e.exerciseId)?.muscle;
      if (m && e.sets.length) per.set(m, (per.get(m) ?? 0) + e.sets.length);
    }
    const total = [...per.values()].reduce((a, b) => a + b, 0);
    if (!total) continue;
    const score = [...per].reduce((a, [m, n]) => a + (fresh.get(m) ?? 100) * n, 0) / total;
    const daysAgo = Math.floor((startOfDay(now) - startOfDay(w.startedAt)) / DAY);
    if (daysAgo < 1) continue;
    const main = [...per].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    if (!best || score > best.freshness + 2 || (Math.abs(score - best.freshness) <= 2 && daysAgo > best.daysAgo)) {
      best = { id: w.id, muscles: main, freshness: Math.round(score), daysAgo };
    }
  }
  return best;
}
