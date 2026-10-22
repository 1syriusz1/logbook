/* Heart rate attached to workouts: pure processing, no platform code.
   Samples come from Health Connect (written there by Google Health / Fitbit);
   each workout keeps a compact, downsampled series plus a few totals. */
import type { HeartData, HeatMetric, Workout } from './types';
import { heatLevel, heatThresholds, type DayStat } from './stats';

const MIN = 60_000;
const HOUR = 3_600_000;

/** A sample stands for the time until the next one, but never longer than this. */
export const GAP_S = 75;
/** Google Health can take a while to hand data to Health Connect; after this it's final. */
export const SETTLE_MS = 36 * HOUR;
/** Zone floors as a share of max heart rate: Z1 50 %, Z2 60 % … Z5 90 %. */
export const ZONE_FLOORS = [0.5, 0.6, 0.7, 0.8, 0.9];
export const DEFAULT_HR_MAX = 190;

export interface RawSample {
  t: number;
  bpm: number;
  src?: string;
  label?: string;
}

export interface HeartExtra {
  kcal?: number | null;
  agg?: { average?: number; max?: number; min?: number } | null;
}

/* ------------------------------------------------------------ reading */

/** Keeps the samples of the source with the most data, so two devices never mix. */
export function pickSource(samples: RawSample[]): RawSample[] {
  if (!samples.length) return samples;
  const count = new Map<string, number>();
  for (const s of samples) count.set(s.src ?? '', (count.get(s.src ?? '') ?? 0) + 1);
  let best = '';
  let n = -1;
  for (const [k, v] of count) if (v > n) [best, n] = [k, v];
  return samples.filter((s) => (s.src ?? '') === best);
}

/** Sorted, deduplicated, plausible samples inside [start, end]. */
export function clean(samples: RawSample[], start: number, end: number): RawSample[] {
  const ok = samples
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.bpm) && s.bpm >= 30 && s.bpm <= 230 && s.t >= start && s.t <= end)
    .sort((a, b) => a.t - b.t);
  const out: RawSample[] = [];
  for (const s of ok) if (!out.length || s.t !== out[out.length - 1].t) out.push(s);
  return out;
}

/** Seconds each sample stands for (time to the next one, capped). */
function weights(ts: number[], gap = GAP_S): number[] {
  if (!ts.length) return [];
  const diffs: number[] = [];
  for (let i = 1; i < ts.length; i++) diffs.push(ts[i] - ts[i - 1]);
  const sorted = [...diffs].sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 10;
  return ts.map((_, i) => Math.min(i < diffs.length ? diffs[i] : typical, gap));
}

/** Share of [start, end] covered by samples. */
export function coverage(samples: { t: number }[], start: number, end: number): number {
  if (!samples.length || end <= start) return 0;
  const w = weights(samples.map((s) => s.t / 1000));
  return Math.min(1, w.reduce((a, b) => a + b, 0) / ((end - start) / 1000));
}

/** Downsampled "offsetSec:bpm,…" string, at most ~480 points. */
export function encodeSeries(samples: RawSample[], start: number, end: number): string {
  const durS = Math.max(1, (end - start) / 1000);
  const bucket = Math.max(10, Math.ceil(durS / 480 / 5) * 5);
  const out: string[] = [];
  let i = 0;
  while (i < samples.length) {
    const b = Math.floor((samples[i].t - start) / 1000 / bucket);
    let sumT = 0;
    let sumB = 0;
    let n = 0;
    while (i < samples.length && Math.floor((samples[i].t - start) / 1000 / bucket) === b) {
      sumT += (samples[i].t - start) / 1000;
      sumB += samples[i].bpm;
      n++;
      i++;
    }
    out.push(`${Math.round(sumT / n)}:${Math.round(sumB / n)}`);
  }
  return out.join(',');
}

export function decodeSeries(pts: string | undefined): [number, number][] {
  if (!pts) return [];
  const out: [number, number][] = [];
  for (const p of pts.split(',')) {
    const k = p.indexOf(':');
    if (k < 0) continue;
    const t = Number(p.slice(0, k));
    const b = Number(p.slice(k + 1));
    if (Number.isFinite(t) && Number.isFinite(b)) out.push([t, b]);
  }
  return out;
}

/** Turns the samples found for a workout into what the log keeps. */
export function processHeart(start: number, end: number, samples: RawSample[], extra: HeartExtra = {}, now = Date.now()): HeartData {
  const s = clean(pickSource(samples.filter((x) => x.t >= start && x.t <= end)), start, end);
  if (!s.length) return { at: now, n: 0 };
  const w = weights(s.map((x) => x.t / 1000));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const avg = s.reduce((a, x, i) => a + x.bpm * w[i], 0) / total;
  let max = -Infinity;
  let min = Infinity;
  for (const x of s) {
    if (x.bpm > max) max = x.bpm;
    if (x.bpm < min) min = x.bpm;
  }
  const out: HeartData = {
    at: now,
    n: s.length,
    avg: Math.round(avg),
    max: Math.round(max),
    min: Math.round(min),
    cover: Math.round(coverage(s, start, end) * 100) / 100,
    pts: encodeSeries(s, start, end),
  };
  const src = s[0].label || s[0].src;
  if (src) out.src = sourceLabel(src);
  if (extra.kcal != null && Number.isFinite(extra.kcal) && extra.kcal > 0) out.kcal = Math.round(extra.kcal);
  return out;
}

export interface EnergyRecord {
  start: number;
  end: number;
  kcal: number;
  src?: string;
}

/**
 * Calories inside [start, end] from interval records, counting the part of each
 * record that overlaps. Sources are never added together: the biggest one wins.
 */
export function prorateKcal(records: EnergyRecord[], start: number, end: number): number | null {
  const bySrc = new Map<string, number>();
  for (const r of records) {
    if (!Number.isFinite(r.kcal) || r.kcal <= 0) continue;
    let part = 0;
    if (r.end > r.start) {
      const a = Math.max(start, r.start);
      const z = Math.min(end, r.end);
      if (z > a) part = (r.kcal * (z - a)) / (r.end - r.start);
    } else if (r.start >= start && r.start <= end) part = r.kcal;
    if (part > 0) bySrc.set(r.src ?? '', (bySrc.get(r.src ?? '') ?? 0) + part);
  }
  let best = 0;
  for (const v of bySrc.values()) best = Math.max(best, v);
  return best > 0 ? best : null;
}

const KNOWN_SOURCES: Record<string, string> = {
  'com.fitbit.FitbitMobile': 'Google Health',
  'com.google.android.apps.fitness': 'Google Health',
  'com.google.android.apps.healthdata': 'Health Connect',
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
};

export function sourceLabel(src: string): string {
  if (KNOWN_SOURCES[src]) return KNOWN_SOURCES[src];
  // A device label such as "Google Fitbit Air" reads fine as is; a package name doesn't.
  if (/\s/.test(src) || !src.includes('.')) return src.slice(0, 40);
  const last = src.split('.').pop() ?? src;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** Whether a finished workout should (again) be looked up in Health Connect. */
export function isHeartDue(w: Workout, now = Date.now()): boolean {
  if (w.endedAt === null) return false;
  const h = w.hr;
  if (!h) return true;
  const settled = w.endedAt + SETTLE_MS;
  if (h.at >= settled) return false;
  if (h.n > 0 && (h.cover ?? 0) >= 0.9 && h.kcal != null) return false;
  if (now >= settled) return true;
  return now - h.at >= 15 * MIN;
}

/* ------------------------------------------------------------ analysis */

export function zoneOf(bpm: number, hrMax: number): number {
  const p = bpm / hrMax;
  let z = 0;
  for (let i = 0; i < ZONE_FLOORS.length; i++) if (p >= ZONE_FLOORS[i]) z = i + 1;
  return z;
}

export interface HeartView {
  n: number;
  avg: number;
  max: number;
  min: number;
  kcal: number | null;
  cover: number;
  src: string | null;
  /** [offset seconds, bpm] */
  pts: [number, number][];
  /** seconds below Z1 (index 0) and in Z1…Z5 */
  zones: number[];
  /** minutes in each zone × zone number */
  load: number;
}

export function zoneSeconds(pts: [number, number][], hrMax: number): number[] {
  const zones = [0, 0, 0, 0, 0, 0];
  const w = weights(pts.map((p) => p[0]));
  pts.forEach(([, b], i) => (zones[zoneOf(b, hrMax)] += w[i]));
  return zones;
}

export const loadOf = (zones: number[]) => Math.round(zones.reduce((a, s, z) => a + (s / 60) * z, 0));

const viewCache = new WeakMap<HeartData, { hrMax: number; view: HeartView | null }>();

export function heartView(h: HeartData | undefined, hrMax: number): HeartView | null {
  if (!h) return null;
  const hit = viewCache.get(h);
  if (hit && hit.hrMax === hrMax) return hit.view;
  let view: HeartView | null = null;
  if (h.n > 0) {
    const pts = decodeSeries(h.pts);
    const zones = zoneSeconds(pts, hrMax);
    view = {
      n: h.n,
      avg: h.avg ?? 0,
      max: h.max ?? 0,
      min: h.min ?? 0,
      kcal: h.kcal ?? null,
      cover: h.cover ?? 0,
      src: h.src ?? null,
      pts,
      zones,
      load: loadOf(zones),
    };
  }
  viewCache.set(h, { hrMax, view });
  return view;
}

/* ------------------------------------------------------------ exercises on the timeline */

export interface Block {
  /** index into workout.entries */
  entry: number;
  /** ms */
  start: number;
  end: number;
  sets: number[];
}

/**
 * Splits the workout into consecutive blocks, one per run of sets of the same
 * exercise. A block runs from the end of the previous one (or the workout
 * start) to its last set, so warm-up and rest before an exercise belong to it.
 */
export function exerciseBlocks(w: Workout): Block[] {
  const end = w.endedAt ?? Date.now();
  const sets = w.entries
    .flatMap((e, entry) => e.sets.map((s) => ({ at: Math.min(end, Math.max(w.startedAt, s.at)), entry })))
    .sort((a, b) => a.at - b.at);
  const blocks: Block[] = [];
  for (const s of sets) {
    const last = blocks[blocks.length - 1];
    if (last && last.entry === s.entry) {
      last.end = s.at;
      last.sets.push(s.at);
    } else {
      blocks.push({ entry: s.entry, start: last ? last.end : w.startedAt, end: s.at, sets: [s.at] });
    }
  }
  return blocks;
}

export interface EntryHeart {
  entry: number;
  avg: number;
  peak: number;
}

/** Average and peak heart rate while doing each exercise (all its blocks). */
export function entryHeart(blocks: Block[], pts: [number, number][], start: number): Map<number, EntryHeart> {
  const acc = new Map<number, { sum: number; n: number; peak: number }>();
  for (const b of blocks) {
    const a = (b.start - start) / 1000;
    const z = (b.end - start) / 1000;
    for (const [t, bpm] of pts) {
      if (t < a || t > z) continue;
      const cur = acc.get(b.entry) ?? { sum: 0, n: 0, peak: 0 };
      cur.sum += bpm;
      cur.n++;
      cur.peak = Math.max(cur.peak, bpm);
      acc.set(b.entry, cur);
    }
  }
  const out = new Map<number, EntryHeart>();
  for (const [entry, v] of acc) if (v.n) out.set(entry, { entry, avg: Math.round(v.sum / v.n), peak: v.peak });
  return out;
}

/* ------------------------------------------------------------ heatmap */

export type Thresholds = [number, number, number];

/** Level thresholds relative to your own history once there is enough of it. */
export function quantileThresholds(values: number[], fixed: Thresholds, floor: number, minStep: number): Thresholds {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length < 8) return fixed;
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  const t1 = Math.max(floor, q(0.25));
  const t2 = Math.max(t1 + minStep, q(0.5));
  const t3 = Math.max(t2 + minStep, q(0.8));
  return [t1, t2, t3];
}

export function levelOf(value: number, t: Thresholds): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  if (value <= t[0]) return 1;
  if (value <= t[1]) return 2;
  if (value <= t[2]) return 3;
  return 4;
}

export const fmtElapsed = (sec: number) => {
  const m = Math.max(0, Math.round(sec / 60));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

export interface HeatInfo {
  metric: HeatMetric;
  /** days shaded from heart rate / calories */
  hrDays: number;
  /** training days that fell back to sets for lack of heart data */
  fallbackDays: number;
}

/** One line saying what the brightness of a heatmap square means. */
export function heatCaption(h: HeatInfo): string {
  if (h.metric === 'sets' || !h.hrDays) return 'Shade shows sets per day';
  const what = h.metric === 'load' ? 'heart-rate load' : 'calories burned';
  return h.fallbackDays ? `Shade shows ${what} (sets on days without it)` : `Shade shows ${what} per day`;
}

const FIXED: Record<Exclude<HeatMetric, 'sets'>, [number, number, number]> = { load: [50, 100, 150], kcal: [250, 400, 550] };

/** Heat level per day: heart-rate load or calories where every workout that day has them, sets otherwise. */
export function heatLevels(days: Map<string, DayStat>, heart: Map<string, HeartView>, metric: HeatMetric) {
  const setsT = heatThresholds(days);
  const levels = new Map<string, number>();
  const info: HeatInfo = { metric, hrDays: 0, fallbackDays: 0 };
  const values = new Map<string, number>();
  if (metric !== 'sets') {
    for (const [k, d] of days) {
      let total = 0;
      let ok = d.workouts.length > 0;
      for (const s of d.workouts) {
        const h = heart.get(s.id);
        const v = h ? (metric === 'load' ? h.load : h.kcal) : null;
        if (v == null) {
          ok = false;
          break;
        }
        total += v;
      }
      if (ok && total > 0) values.set(k, total);
    }
  }
  const t = metric === 'sets' ? setsT : quantileThresholds([...values.values()], FIXED[metric], metric === 'load' ? 15 : 80, metric === 'load' ? 5 : 20);
  for (const [k, d] of days) {
    const v = values.get(k);
    if (v != null) {
      levels.set(k, levelOf(v, t));
      info.hrDays++;
    } else {
      levels.set(k, heatLevel(d.sets, setsT));
      if (metric !== 'sets' && d.sets > 0) info.fallbackDays++;
    }
  }
  return { levels, info };
}
