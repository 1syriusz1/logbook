/* Health Connect: reads heart rate and calories that Google Health (Fitbit)
   saves on the phone, for the time window of each finished workout.
   Everything stays on the device; Logbook only reads. */
import { useSyncExternalStore } from 'react';
import { Health, type AggregatedSample, type HealthPlugin } from '@capgo/capacitor-health';
import type { Workout } from './types';
import { isNative, onAppResume } from './platform';
import { applyHeart, getDB, setHealth, type HeartResult } from './store';
import { coverage, isHeartDue, pickSource, processHeart, prorateKcal, type RawSample } from './heart';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** workouts read per sync, newest first; the rest follow on the next one */
const BATCH = 40;
const READ = ['heartRate', 'totalCalories'] as const;

type Backend = Pick<
  HealthPlugin,
  'isAvailable' | 'requestAuthorization' | 'checkAuthorization' | 'readSamples' | 'queryAggregated' | 'openHealthConnectSettings'
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
}

let ui: HealthUI = { state: 'checking', syncing: false, done: 0, total: 0, error: null, busy: new Set() };
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
    set({ state: st.readAuthorized.includes('heartRate') ? 'on' : 'denied' });
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
    set({ state: 'on' });
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

async function run(ids?: string[]) {
  const b = backend();
  const db = getDB();
  const hs = db.settings.health;
  if (!b || !hs.on || ui.state === 'denied') return;
  const now = Date.now();
  // Without history access Health Connect serves data from 30 days before the first grant.
  const oldest = hs.history ? 0 : (hs.since ?? now) - 30 * DAY + HOUR;
  const wanted = ids ? new Set(ids) : null;
  const list = db.workouts
    .filter((w): w is Workout & { endedAt: number } => w.endedAt !== null && w.endedAt - w.startedAt >= MIN && w.startedAt >= oldest)
    .filter((w) => (wanted ? wanted.has(w.id) : isHeartDue(w, now)))
    .sort((a, b2) => b2.startedAt - a.startedAt)
    .slice(0, BATCH);
  if (!list.length) {
    setHealth({ lastSync: now });
    return;
  }
  set({ syncing: true, done: 0, total: list.length, error: null, busy: new Set(list.map((w) => w.id)) });
  let pending: HeartResult[] = [];
  let failed = 0;
  let stopped = false;
  try {
    for (const w of list) {
      try {
        const hr = await readWorkoutHeart(b, w.startedAt, w.endedAt, oldest);
        pending.push({ id: w.id, startedAt: w.startedAt, endedAt: w.endedAt, hr });
      } catch (e) {
        const m = message(e);
        if (/quota|rate.?limit/i.test(m)) {
          set({ error: 'Health Connect asked Logbook to slow down. It will continue later.' });
          stopped = true;
          break;
        }
        // A permission error can also mean "too old to read"; only stop if access is really gone.
        if (/permission|security/i.test(m) && (await refreshHealth()) === 'denied') {
          set({ error: 'Logbook no longer has access to heart rate in Health Connect.' });
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
    setHealth({ lastSync: Date.now() });
    set({ syncing: false, busy: new Set(), ...(failed && !ui.error ? { error: `${failed} workout${failed > 1 ? 's' : ''} couldn’t be read.` } : {}) });
  }
  // A long history goes in batches, with a pause so Health Connect isn't flooded.
  if (!ids && !stopped && list.length === BATCH) setTimeout(() => void syncHeart(), 20_000);
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
