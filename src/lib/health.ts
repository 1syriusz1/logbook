/* Health Connect: reads what Google Health (Fitbit) saves on the phone.
   - heart rate and calories for the time window of each finished workout
   - recovery data for readiness: sleep, HRV, resting heart rate, breathing
     rate, steps, and workouts recorded in other apps (rides, runs)
   Everything stays on the device; Logbook only reads. */
import { useSyncExternalStore } from 'react';
import { Health, type AggregatedSample, type HealthPlugin } from '@capgo/capacitor-health';
import type { Activity, Workout, WellnessKind } from './types';
import { isNative, onAppResume } from './platform';
import { applyActivityHeart, applyHeart, applyWellness, getDB, setHealth, type HeartResult } from './store';
import { coverage, isHeartDue, pickSource, processHeart, prorateKcal, type RawSample } from './heart';
import { buildNights, combineDays, overlapsWorkout, perMorning } from './wellness';
import { addDays, dayKey, startOfDay } from './format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** workouts read per sync, newest first; the rest follow on the next one */
const BATCH = 40;
/** Everything Logbook asks for; Health Connect lets you allow each one separately. */
const READ = ['heartRate', 'totalCalories', 'sleep', 'heartRateVariability', 'restingHeartRate', 'respiratoryRate', 'steps', 'workouts'] as const;
/** What readiness needs on top of heart rate. */
export const RECOVERY_TYPES = ['sleep', 'heartRateVariability', 'restingHeartRate'] as const;

type Backend = Pick<
  HealthPlugin,
  'isAvailable' | 'requestAuthorization' | 'checkAuthorization' | 'readSamples' | 'queryAggregated' | 'queryWorkouts' | 'openHealthConnectSettings'
>;

/** The native plugin on Android; tests can swap in a fake. Nothing on the web. */
function backend(): Backend | null {
  const fake = (globalThis as { __LOGBOOK_HEALTH__?: Backend }).__LOGBOOK_HEALTH__;
  if (fake) return fake;
  return isNative ? Health : null;
}

/* ------------------------------------------------------------ UI state */

export type HealthState =
  | 'checking'
  /** web / PWA: Health Connect only exists on Android */
  | 'unsupported'
  /** Health Connect missing on this phone */
  | 'unavailable'
  /** Health Connect needs an update */
  | 'update'
  /** not connected in Logbook */
  | 'off'
  /** connected before, but access was taken away in Health Connect */
  | 'denied'
  | 'on';

export interface HealthUI {
  state: HealthState;
  syncing: boolean;
  done: number;
  total: number;
  error: string | null;
  /** workouts being read right now */
  busy: ReadonlySet<string>;
  /** data types allowed in Health Connect (empty until known) */
  granted: ReadonlySet<string>;
}

let ui: HealthUI = { state: 'checking', syncing: false, done: 0, total: 0, error: null, busy: new Set(), granted: new Set() };
const listeners = new Set<() => void>();

function set(patch: Partial<HealthUI>) {
  ui = { ...ui, ...patch };
  listeners.forEach((l) => l());
}

export const healthUI = () => ui;

export function useHealth(): HealthUI {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    healthUI,
    healthUI,
  );
}

const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : String((e as { message?: string })?.message ?? e));

/* ------------------------------------------------------------ connection */

export async function refreshHealth(): Promise<HealthState> {
  const b = backend();
  if (!b) {
    set({ state: 'unsupported' });
    return ui.state;
  }
  try {
    const a = await b.isAvailable();
    if (!a.available) {
      set({ state: /update/i.test(a.reason ?? '') ? 'update' : 'unavailable' });
      return ui.state;
    }
  } catch {
    set({ state: 'unavailable' });
    return ui.state;
  }
  const hs = getDB().settings.health;
  if (!hs.on) {
    set({ state: 'off' });
    return ui.state;
  }
  try {
    const st = await b.checkAuthorization({ read: [...READ], requestHistoryAccess: true });
    if (st.historyAccessAuthorized !== undefined && st.historyAccessAuthorized !== hs.history) {
      setHealth({ history: st.historyAccessAuthorized });
    }
    set({ state: st.readAuthorized.includes('heartRate') ? 'on' : 'denied', granted: new Set(st.readAuthorized) });
  } catch {
    set({ state: 'on' });
  }
  return ui.state;
}

/** Shows the Health Connect permission screen. Resolves true when heart rate may be read. */
export async function connectHealth(): Promise<boolean> {
  const b = backend();
  if (!b) return false;
  set({ error: null });
  try {
    const st = await b.requestAuthorization({ read: [...READ], requestHistoryAccess: true });
    if (!st.readAuthorized.includes('heartRate')) {
      set({ state: getDB().settings.health.on ? 'denied' : 'off', error: 'Heart rate access wasn’t allowed.' });
      return false;
    }
    const hs = getDB().settings.health;
    setHealth({ on: true, since: hs.since ?? Date.now(), history: st.historyAccessAuthorized === true });
    set({ state: 'on', granted: new Set(st.readAuthorized) });
    void syncHeart();
    return true;
  } catch (e) {
    set({ error: message(e) || 'Health Connect didn’t respond.' });
    return false;
  }
}

/** Stops reading. Data already attached to workouts stays. */
export function disconnectHealth() {
  setHealth({ on: false });
  set({ state: 'off', error: null });
}

export async function openHealthConnect() {
  try {
    await backend()?.openHealthConnectSettings();
  } catch {
    set({ error: 'Couldn’t open Health Connect.' });
  }
}

/* ------------------------------------------------------------ reading */

const iso = (t: number) => new Date(t).toISOString();

async function readHr(b: Backend, from: number, to: number): Promise<RawSample[]> {
  const r = await b.readSamples({ dataType: 'heartRate', startDate: iso(from), endDate: iso(to), limit: 0, ascending: true });
  return r.samples.map((s) => ({ t: Date.parse(s.startDate), bpm: s.value, src: s.sourceId ?? s.sourceName, label: s.sourceName }));
}

function mergeAgg(samples: AggregatedSample[]) {
  let max = -Infinity;
  let min = Infinity;
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    const v = s.values ?? {};
    if (typeof v.max === 'number') max = Math.max(max, v.max);
    if (typeof v.min === 'number') min = Math.min(min, v.min);
    if (typeof v.average === 'number') {
      sum += v.average;
      n++;
    }
  }
  if (!Number.isFinite(max) && !n) return null;
  return { max: Number.isFinite(max) ? max : undefined, min: Number.isFinite(min) ? min : undefined, average: n ? sum / n : undefined };
}

async function readKcal(b: Backend, start: number, end: number, floor: number): Promise<number | null> {
  try {
    const r = await b.queryAggregated({ dataType: 'totalCalories', startDate: iso(start), endDate: iso(end), bucket: 'day', aggregation: 'sum' });
    const v = r.samples.reduce((a, s) => a + (s.values?.sum ?? s.value ?? 0), 0);
    return v > 0 ? v : null;
  } catch {
    /* plugin without total-calorie sums: add up the records instead */
  }
  try {
    const r = await b.readSamples({ dataType: 'totalCalories', startDate: iso(Math.max(floor, start - 15 * MIN)), endDate: iso(end), limit: 0, ascending: true });
    return prorateKcal(
      r.samples.map((s) => ({ start: Date.parse(s.startDate), end: Date.parse(s.endDate), kcal: s.value, src: s.sourceId ?? s.sourceName })),
      start,
      end,
    );
  } catch {
    return null;
  }
}

/**
 * Reads one workout's window. Never reads before `floor` (without history access
 * Health Connect refuses older data). Throws on Health Connect errors (permission, quota).
 */
export async function readWorkoutHeart(b: Backend, start: number, end: number, floor = 0) {
  // Cheap check first: is there any heart rate at all in the window?
  let agg: ReturnType<typeof mergeAgg> = null;
  let probed = false;
  try {
    const r = await b.queryAggregated({ dataType: 'heartRate', startDate: iso(start), endDate: iso(end), bucket: 'day', aggregation: ['average', 'max', 'min'] });
    agg = mergeAgg(r.samples);
    probed = true;
  } catch (e) {
    if (/permission|security|quota|rate.?limit/i.test(message(e))) throw e;
  }
  if (probed && !agg) return processHeart(start, end, []);

  // Health Connect matches heart-rate records by their start, and a record
  // usually holds a minute of samples: look back a little, then clip.
  const inside = (list: RawSample[]) => pickSource(list.filter((s) => s.t >= start && s.t <= end)).sort((a, b2) => a.t - b2.t);
  let samples = await readHr(b, Math.max(floor, start - 15 * MIN), end);
  let found = inside(samples);
  if ((!found.length || found[0].t > start + 5 * MIN || coverage(found, start, end) < 0.5) && start - 15 * MIN > floor) {
    // Thin or late data: the rest may sit in longer records that began earlier.
    const wide = await readHr(b, Math.max(floor, start - 6 * HOUR), end);
    const more = inside(wide);
    if (more.length > found.length) {
      samples = wide;
      found = more;
    }
  }
  const kcal = found.length ? await readKcal(b, start, end, floor) : null;
  return processHeart(start, end, samples, { kcal, agg });
}

let running: Promise<void> | null = null;
let queued: { ids: Set<string> } | null = null;
let lastAuto = 0;

/**
 * Reads heart rate for workouts that need it (or the given ones), newest first.
 * Only one sync runs at a time; calls made meanwhile are merged into the next.
 */
export function syncHeart(ids?: string[]): Promise<void> {
  if (running) {
    if (ids) {
      queued ??= { ids: new Set() };
      ids.forEach((i) => queued!.ids.add(i));
    }
    return running;
  }
  running = run(ids).finally(() => {
    running = null;
    const q = queued;
    queued = null;
    if (q && q.ids.size) void syncHeart([...q.ids]);
  });
  return running;
}

/** What to do after a Health Connect error: stop the sync, or skip this item. */
async function triage(e: unknown): Promise<'stop' | 'skip'> {
  const m = message(e);
  if (/quota|rate.?limit/i.test(m)) {
    set({ error: 'Health Connect asked Logbook to slow down. It will continue later.' });
    return 'stop';
  }
  // A permission error can also mean "too old to read" or "that type isn't allowed";
  // only stop when heart-rate access itself is gone.
  if (/permission|security/i.test(m) && (await refreshHealth()) === 'denied') {
    set({ error: 'Logbook no longer has access to heart rate in Health Connect.' });
    return 'stop';
  }
  return 'skip';
}

/**
 * Recovery data per morning. The first time each kind is read for the last
 * 60 days (or as far as Health Connect allows); after that only the last few
 * days, which is where late-arriving data lands.
 */
async function syncWellness(b: Backend, floor: number, now: number): Promise<boolean> {
  const hs = getDB().settings.health;
  const filled = { ...(hs.filled ?? {}) };
  const today = startOfDay(now);
  const fullFrom = Math.max(floor, addDays(today, -60));
  const recentFrom = Math.max(floor, addDays(today, -3));
  const fromFor = (kind: WellnessKind) => (filled[kind] !== undefined && filled[kind]! <= fullFrom + DAY ? recentFrom : fullFrom);
  const allowed = (type: string) => ui.granted.size === 0 || ui.granted.has(type);
  const keepAfter = (map: Record<string, unknown>, from: number) => {
    const first = dayKey(from);
    for (const k of Object.keys(map)) if (k < first) delete map[k];
    return map;
  };
  const parts: Parameters<typeof combineDays>[0] = {};
  let activities: Activity[] | undefined;
  const values = async (dataType: 'heartRateVariability' | 'restingHeartRate' | 'respiratoryRate', from: number) => {
    const r = await b.readSamples({ dataType, startDate: iso(from - 12 * HOUR), endDate: iso(now), limit: 0, ascending: true });
    return r.samples.map((x) => ({ t: Date.parse(x.startDate), value: x.value, src: x.sourceId ?? x.sourceName }));
  };
  const jobs: [WellnessKind, string, (from: number) => Promise<void>][] = [
    [
      'sleep',
      'sleep',
      async (from) => {
        // Sessions are matched by their start, so reach back into the evening before.
        const r = await b.readSamples({ dataType: 'sleep', startDate: iso(from - 18 * HOUR), endDate: iso(now), limit: 0, ascending: true });
        parts.sleep = keepAfter(
          buildNights(
            r.samples.map((x) => ({
              start: Date.parse(x.startDate),
              end: Date.parse(x.endDate),
              src: x.sourceId ?? x.sourceName,
              stages: x.stages?.map((st) => ({ start: Date.parse(st.startDate), end: Date.parse(st.endDate), stage: st.stage })),
            })),
          ),
          from,
        ) as typeof parts.sleep;
      },
    ],
    ['hrv', 'heartRateVariability', async (from) => void (parts.hrv = keepAfter(perMorning(await values('heartRateVariability', from), 'hrv'), from) as typeof parts.hrv)],
    ['rhr', 'restingHeartRate', async (from) => void (parts.rhr = keepAfter(perMorning(await values('restingHeartRate', from), 'rhr'), from) as typeof parts.rhr)],
    ['resp', 'respiratoryRate', async (from) => void (parts.resp = keepAfter(perMorning(await values('respiratoryRate', from), 'resp'), from) as typeof parts.resp)],
    [
      'steps',
      'steps',
      async (from) => {
        const r = await b.queryAggregated({ dataType: 'steps', startDate: iso(startOfDay(from)), endDate: iso(now), bucket: 'day', aggregation: 'sum' });
        const steps: Record<string, number> = {};
        // Buckets start at local midnight; the offset keeps a DST shift on the right day.
        for (const x of r.samples) steps[dayKey(Date.parse(x.startDate) + 2 * HOUR)] = Math.round(x.values?.sum ?? x.value);
        parts.steps = keepAfter(steps, from) as typeof parts.steps;
      },
    ],
    [
      'workouts',
      'workouts',
      async (from) => {
        const r = await b.queryWorkouts({ startDate: iso(from - 6 * HOUR), endDate: iso(now), limit: 0, ascending: true });
        activities = r.workouts
          .map((x) => ({
            id: x.platformId ?? `${x.sourceId ?? ''}:${x.startDate}`,
            type: x.workoutType,
            start: Date.parse(x.startDate),
            end: Date.parse(x.endDate),
            ...(x.totalEnergyBurned ? { kcal: Math.round(x.totalEnergyBurned) } : {}),
            ...(x.totalDistance ? { distance: Math.round(x.totalDistance) } : {}),
            ...(x.sourceName ? { src: x.sourceName } : {}),
          }))
          .filter((a) => a.end - a.start >= 5 * MIN);
      },
    ],
  ];
  for (const [kind, type, job] of jobs) {
    if (!allowed(type)) continue;
    const from = fromFor(kind);
    try {
      await job(from);
      filled[kind] = Math.min(filled[kind] ?? Infinity, from);
    } catch (e) {
      if ((await triage(e)) === 'stop') {
        applyWellness(combineDays(parts), activities, addDays(today, -120));
        return false;
      }
    }
  }
  applyWellness(combineDays(parts), activities, addDays(today, -120));
  setHealth({ filled });
  return true;
}

/** Heart rate for rides, runs and other workouts recorded outside Logbook, for their training load. */
async function syncActivityHeart(b: Backend, floor: number, now: number): Promise<boolean> {
  const db = getDB();
  const due = db.activities
    .filter((a) => a.start >= floor && !overlapsWorkout(a, db.workouts))
    .filter((a) => isHeartDue({ id: a.id, startedAt: a.start, endedAt: a.end, entries: [], ...(a.hr ? { hr: a.hr } : {}) }, now))
    .sort((x, y) => y.start - x.start)
    .slice(0, 20);
  const results: { id: string; start: number; end: number; hr: Activity['hr'] & {} }[] = [];
  let ok = true;
  for (const a of due) {
    try {
      results.push({ id: a.id, start: a.start, end: a.end, hr: await readWorkoutHeart(b, a.start, a.end, floor) });
    } catch (e) {
      if ((await triage(e)) === 'stop') {
        ok = false;
        break;
      }
    }
  }
  applyActivityHeart(results);
  return ok;
}

async function run(ids?: string[]) {
  const b = backend();
  const hs = getDB().settings.health;
  if (!b || !hs.on || ui.state === 'denied') return;
  const now = Date.now();
  // Without history access Health Connect serves data from 30 days before the first grant.
  const oldest = hs.history ? 0 : (hs.since ?? now) - 30 * DAY + HOUR;
  set({ syncing: true, done: 0, total: 0, error: null });
  let failed = 0;
  let stopped = false;
  let full = false;
  try {
    if (!ids) {
      stopped = !(await syncWellness(b, oldest, now));
      if (!stopped) stopped = !(await syncActivityHeart(b, oldest, now));
    }
    if (!stopped) {
      const db = getDB();
      const wanted = ids ? new Set(ids) : null;
      const list = db.workouts
        .filter((w): w is Workout & { endedAt: number } => w.endedAt !== null && w.endedAt - w.startedAt >= MIN && w.startedAt >= oldest)
        .filter((w) => (wanted ? wanted.has(w.id) : isHeartDue(w, now)))
        .sort((a, b2) => b2.startedAt - a.startedAt)
        .slice(0, BATCH);
      full = list.length === BATCH;
      set({ total: list.length, busy: new Set(list.map((w) => w.id)) });
      let pending: HeartResult[] = [];
      try {
        for (const w of list) {
          try {
            const hr = await readWorkoutHeart(b, w.startedAt, w.endedAt, oldest);
            pending.push({ id: w.id, startedAt: w.startedAt, endedAt: w.endedAt, hr });
          } catch (e) {
            if ((await triage(e)) === 'stop') {
              stopped = true;
              break;
            }
            failed++;
          }
          const busy = new Set(ui.busy);
          busy.delete(w.id);
          set({ done: ui.done + 1, busy });
          // Fill the screen in as results arrive.
          if (pending.length >= 5) {
            applyHeart(pending);
            pending = [];
          }
        }
      } finally {
        applyHeart(pending);
      }
    }
  } finally {
    setHealth({ lastSync: Date.now() });
    set({ syncing: false, busy: new Set(), ...(failed && !ui.error ? { error: `${failed} workout${failed > 1 ? 's' : ''} couldn’t be read.` } : {}) });
  }
  // A long history goes in batches, with a pause so Health Connect isn't flooded.
  if (!ids && !stopped && full) setTimeout(() => void syncHeart(), 20_000);
}

/** Startup: work out the state, read what's new, and again whenever the app comes back. */
export async function initHealth() {
  const state = await refreshHealth();
  if (state === 'on') {
    lastAuto = Date.now();
    void syncHeart();
  }
  onAppResume(async () => {
    const s = await refreshHealth();
    if (s === 'on' && Date.now() - lastAuto > 2 * MIN) {
      lastAuto = Date.now();
      void syncHeart();
    }
  });
}
