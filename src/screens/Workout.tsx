import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, Exercise, Workout } from '../lib/types';
import { nav, toast, type Layer } from '../lib/nav';
import { useData, useNow } from '../lib/derived';
import {
  deleteSet,
  deleteWorkout,
  finishWorkout,
  getDB,
  logSet,
  moveEntry,
  pruneWorkout,
  removeEntry,
  replaceDB,
  startWorkout,
  updateSet,
} from '../lib/store';
import { collapsePRs, exerciseSessions, prEvents, summarize, type PRKind, type Session } from '../lib/stats';
import { defaultLoad, MUSCLE_LABEL } from '../lib/exercises';
import { fmtClock, fmtDate, fmtDur, fmtNum, fmtRelDay, fmtTime, plural } from '../lib/format';
import { prLabel, setText } from '../lib/labels';
import { haptic } from '../lib/platform';
import { Button, IconButton, Num, PRBadge, Stepper } from '../components/ui';
import { Icon } from '../components/icons';
import { Sheet } from '../components/layers';
import { DurNum, MuscleSplit, SetValue, StatRow } from '../components/bits';

/* ------------------------------------------------------------ helpers */

function lastSession(finished: Workout[], exerciseId: string, w: Workout): Session | null {
  const sessions = exerciseSessions(finished, exerciseId, { excludeId: w.id }).filter((s) => s.date < w.startedAt);
  return sessions[sessions.length - 1] ?? null;
}

function initialActive(w?: Workout): string | null {
  if (!w || !w.entries.length) return null;
  let best: Entry | null = null;
  let bestAt = -1;
  for (const e of w.entries) {
    for (const s of e.sets) {
      if (s.at > bestAt) {
        bestAt = s.at;
        best = e;
      }
    }
  }
  return (best ?? w.entries.find((e) => !e.sets.length) ?? w.entries[0]).id;
}

export function completeWorkout(id: string, at: number) {
  finishWorkout(id, at);
  haptic.success();
  nav.replace({ name: 'summary', id });
}

export function beginWorkout(templateId?: string) {
  const id = startWorkout(templateId);
  haptic.medium();
  return id;
}

/* ------------------------------------------------------------ screen */

export function WorkoutScreen({ layer, id }: { layer: Layer; id: string }) {
  const data = useData();
  const found = data.db.workouts.find((x) => x.id === id);
  const keep = useRef<Workout | undefined>(found);
  if (found) keep.current = found;
  const w = found ?? keep.current;
  const live = !!w && w.endedAt === null;
  const now = useNow(1000, live && !layer.closing);
  const [active, setActive] = useState<string | null>(() => initialActive(w));
  const count = useRef(w?.entries.length ?? 0);

  // Leaving the editor of a past workout tidies it: exercises without sets go,
  // and a workout left with no sets at all is removed (with undo).
  useEffect(
    () => () => {
      const db = getDB();
      const cur = db.workouts.find((x) => x.id === id);
      if (!cur || cur.endedAt === null) return;
      const sets = cur.entries.reduce((a, e) => a + e.sets.length, 0);
      if (!sets) {
        const snapshot = db;
        deleteWorkout(id);
        toast.show('Empty workout removed', { label: 'Undo', run: () => replaceDB(snapshot) });
      } else if (cur.entries.some((e) => !e.sets.length)) {
        pruneWorkout(id);
      }
    },
    [id],
  );

  // A newly added exercise becomes the active one and scrolls into view.
  useEffect(() => {
    if (!w) return;
    if (w.entries.length > count.current) {
      const last = w.entries[w.entries.length - 1];
      setActive(last.id);
      setTimeout(() => document.getElementById('entry-' + last.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
    count.current = w.entries.length;
  }, [w?.entries.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!w) return <div className={`layer full${layer.closing ? ' leaving' : ''}`} />;
  const sum = summarize(w, data.ex, now);
  const step = data.db.settings.weightStep;

  const finish = () => {
    if (!live) return nav.back();
    if (!sum.sets) {
      nav.confirm({
        title: 'Discard this workout?',
        message: 'No sets were logged, so there is nothing to save.',
        confirmLabel: 'Discard workout',
        destructive: true,
        closeCount: 2,
        onConfirm: () => deleteWorkout(w.id),
      });
      return;
    }
    const idle = sum.lastSetAt ? Date.now() - sum.lastSetAt : 0;
    if (idle > 25 * 60_000) nav.push({ name: 'finish', id: w.id });
    else completeWorkout(w.id, Date.now());
  };

  const discard = () =>
    nav.confirm({
      title: live ? 'Discard this workout?' : 'Delete this workout?',
      message: sum.sets ? `${plural(sum.sets, 'logged set')} will be deleted.` : undefined,
      confirmLabel: live ? 'Discard workout' : 'Delete workout',
      destructive: true,
      closeCount: 2 + (live ? 0 : nav.get().layers.filter((l) => !l.closing && l.route.name === 'workoutDetail').length),
      onConfirm: () => deleteWorkout(w.id),
    });

  return (
    <div className={`layer full${layer.closing ? ' leaving' : ''}`}>
      <div className="wk-bar">
        <IconButton icon="chevronDown" label="Minimise" onClick={() => nav.back()} />
        <div className="wk-bar-mid">
          <div className="wk-bar-title">{sum.title}</div>
          <div className="wk-bar-sub">{live ? `Started ${fmtTime(w.startedAt)}` : 'Editing'}</div>
        </div>
        <Button variant="primary" size="sm" onClick={finish}>
          {live ? 'Finish' : 'Done'}
        </Button>
      </div>

      <div className="wk-scroll">
        <div className="wk-hero">
          {live ? (
            <div className="wk-clock" aria-label="Elapsed time">
              {fmtClock(now - w.startedAt)}
            </div>
          ) : (
            <button className="wk-when" onClick={() => nav.push({ name: 'workoutTime', id: w.id })}>
              <span className="mid">{fmtDate(w.startedAt)}</span>
              <span className="sub">
                {fmtTime(w.startedAt)} · {fmtDur(sum.durationMs)} <span className="link">Change</span>
              </span>
            </button>
          )}
          <div className="wk-stats">
            <span>
              <b>{sum.sets}</b> {sum.sets === 1 ? 'set' : 'sets'}
            </span>
            <span>
              <b>{sum.exercises}</b> {sum.exercises === 1 ? 'exercise' : 'exercises'}
            </span>
            <span>
              <b>{fmtNum(sum.volume)}</b> kg
            </span>
          </div>
        </div>

        {w.entries.length === 0 && (
          <div className="wk-empty">
            <div className="empty-title">Pick your first exercise</div>
            <div className="empty-text">Log each set as you go: weight and reps. Time and totals are counted for you.</div>
          </div>
        )}

        <div className="entries">
          {w.entries.map((e) => {
            const ex = data.ex.get(e.exerciseId);
            if (!ex) return null;
            return (
              <EntryCard
                key={e.id}
                w={w}
                entry={e}
                ex={ex}
                step={step}
                prs={data.prs}
                active={active === e.id}
                onActivate={() => setActive(e.id)}
              />
            );
          })}
        </div>

        <button className="add-tile" onClick={() => nav.push({ name: 'picker', workoutId: w.id })}>
          <Icon name="plus" size={20} />
          Add exercise
        </button>

        <div className="wk-foot">
          <button className="text-btn" onClick={discard}>
            {live ? 'Discard workout' : 'Delete workout'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ entry */

function EntryCard({
  w,
  entry,
  ex,
  step,
  prs,
  active,
  onActivate,
}: {
  w: Workout;
  entry: Entry;
  ex: Exercise;
  step: number;
  prs: Map<string, PRKind[]>;
  active: boolean;
  onActivate: () => void;
}) {
  const data = useData();
  const last = useMemo(() => lastSession(data.finished, entry.exerciseId, w), [data.finished, entry.exerciseId, w.id, w.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const seed = entry.sets[entry.sets.length - 1] ?? last?.sets[0] ?? defaultLoad(ex);
  const [kg, setKg] = useState(seed.kg);
  const [reps, setReps] = useState(seed.reps);
  const [fresh, setFresh] = useState<string | null>(null);
  const bw = ex.kind === 'bodyweight';

  const log = () => {
    const sid = logSet(w.id, entry.id, kg, reps);
    setFresh(sid);
    haptic.light();
  };

  const lastLine = last
    ? `${fmtRelDay(last.date)}: ${last.sets.map((s) => setText(s, ex)).join(', ')}`
    : 'First time';

  return (
    <section id={`entry-${entry.id}`} className={`entry${active ? ' active' : ''}`}>
      <div className="entry-head">
        <button className="entry-title" onClick={onActivate}>
          <span className="entry-name">{ex.name}</span>
          <span className="entry-meta">
            {MUSCLE_LABEL[ex.muscle]} · {last ? 'Last ' : ''}
            {lastLine}
          </span>
        </button>
        <IconButton
          icon="more"
          label={`${ex.name} options`}
          tone="plain"
          size={38}
          onClick={() => nav.push({ name: 'entryMenu', workoutId: w.id, entryId: entry.id })}
        />
      </div>

      {entry.sets.length > 0 && (
        <div className="sets">
          {entry.sets.map((s, i) => (
            <button
              key={s.id}
              className={`set-row${fresh === s.id ? ' fresh' : ''}`}
              onClick={() => nav.push({ name: 'set', workoutId: w.id, entryId: entry.id, setId: s.id })}
            >
              <span className="set-n">{i + 1}</span>
              <SetValue s={s} ex={ex} />
              {prs.get(s.id) && <PRBadge title={prLabel(prs.get(s.id)!)} />}
            </button>
          ))}
        </div>
      )}

      {active ? (
        <div className="composer">
          <div className="composer-row">
            <Stepper id={`kg-${entry.id}`} value={kg} onChange={setKg} step={step} max={999} unit={bw ? 'added kg' : 'kg'} />
            <Stepper id={`reps-${entry.id}`} value={reps} onChange={setReps} step={1} min={1} max={200} unit="reps" integer />
          </div>
          <Button variant="primary" size="lg" block onClick={log}>
            Log set {entry.sets.length + 1}
          </Button>
        </div>
      ) : (
        <button className="entry-more" onClick={onActivate}>
          <Icon name="plus" size={16} />
          {entry.sets.length ? 'Add set' : 'Log first set'}
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ sheets */

export function EntryMenu({ layer, workoutId, entryId }: { layer: Layer; workoutId: string; entryId: string }) {
  const data = useData();
  const w = data.db.workouts.find((x) => x.id === workoutId);
  const entry = w?.entries.find((e) => e.id === entryId);
  const ex = entry ? data.ex.get(entry.exerciseId) : undefined;
  if (!w || !entry || !ex) return <Sheet layer={layer} />;
  const i = w.entries.indexOf(entry);

  const remove = () => {
    const snapshot = getDB();
    removeEntry(workoutId, entryId);
    nav.back();
    toast.show(`${ex.name} removed`, { label: 'Undo', run: () => replaceDB(snapshot) });
  };

  return (
    <Sheet layer={layer} title={ex.name}>
      <div className="group">
        <button className="group-row" onClick={() => nav.replace({ name: 'exercise', id: ex.id })}>
          <Icon name="stats" size={20} />
          <span className="row-main">Progress and history</span>
          <Icon name="chevronRight" size={18} className="dim" />
        </button>
        {i > 0 && (
          <button
            className="group-row"
            onClick={() => {
              moveEntry(workoutId, entryId, -1);
              nav.back();
            }}
          >
            <Icon name="arrowUp" size={20} />
            <span className="row-main">Move up</span>
          </button>
        )}
        {i < w.entries.length - 1 && (
          <button
            className="group-row"
            onClick={() => {
              moveEntry(workoutId, entryId, 1);
              nav.back();
            }}
          >
            <Icon name="arrowDown" size={20} />
            <span className="row-main">Move down</span>
          </button>
        )}
        <button className="group-row" onClick={remove}>
          <Icon name="trash" size={20} />
          <span className="row-main">Remove from workout</span>
        </button>
      </div>
    </Sheet>
  );
}

export function SetSheet({ layer, workoutId, entryId, setId }: { layer: Layer; workoutId: string; entryId: string; setId: string }) {
  const data = useData();
  const w = data.db.workouts.find((x) => x.id === workoutId);
  const entry = w?.entries.find((e) => e.id === entryId);
  const set = entry?.sets.find((s) => s.id === setId);
  const ex = entry ? data.ex.get(entry.exerciseId) : undefined;
  const [kg, setKg] = useState(set?.kg ?? 0);
  const [reps, setReps] = useState(set?.reps ?? 1);
  if (!w || !entry || !set || !ex) return <Sheet layer={layer} />;
  const index = entry.sets.indexOf(set) + 1;

  const save = () => {
    updateSet(workoutId, entryId, setId, { kg, reps });
    haptic.light();
    nav.back();
  };
  const remove = () => {
    const snapshot = getDB();
    deleteSet(workoutId, entryId, setId);
    nav.back();
    toast.show(`Set ${index} deleted`, { label: 'Undo', run: () => replaceDB(snapshot) });
  };

  return (
    <Sheet
      layer={layer}
      title={`Set ${index}`}
      actions={
        <>
          <Button variant="primary" size="lg" block onClick={save}>
            Save
          </Button>
          <Button variant="ghost" block icon="trash" onClick={remove}>
            Delete set
          </Button>
        </>
      }
    >
      <p className="sheet-text">{ex.name}</p>
      <div className="composer-row">
        <Stepper id="edit-kg" value={kg} onChange={setKg} step={data.db.settings.weightStep} max={999} unit={ex.kind === 'bodyweight' ? 'added kg' : 'kg'} />
        <Stepper id="edit-reps" value={reps} onChange={setReps} step={1} min={1} max={200} unit="reps" integer />
      </div>
    </Sheet>
  );
}

export function FinishSheet({ layer, id }: { layer: Layer; id: string }) {
  const data = useData();
  const w = data.db.workouts.find((x) => x.id === id);
  if (!w) return <Sheet layer={layer} />;
  const s = summarize(w, data.ex);
  const lastAt = s.lastSetAt ?? Date.now();
  const now = Date.now();
  const end = (at: number) => {
    nav.back();
    completeWorkout(id, at);
  };
  return (
    <Sheet
      layer={layer}
      title="Finish workout"
      actions={
        <>
          <Button variant="primary" size="lg" block onClick={() => end(lastAt + 2 * 60_000)}>
            End at last set · {fmtTime(lastAt + 2 * 60_000)}
          </Button>
          <Button variant="secondary" size="lg" block onClick={() => end(now)}>
            End now · {fmtTime(now)}
          </Button>
        </>
      }
    >
      <p className="sheet-text">
        Your last set was {fmtDur(now - lastAt)} ago. If you forgot to tap Finish, end the workout at the last set so its
        duration stays accurate.
      </p>
    </Sheet>
  );
}

export function SummarySheet({ layer, id }: { layer: Layer; id: string }) {
  const data = useData();
  const s = data.byId.get(id);
  const w = data.finished.find((x) => x.id === id);
  if (!s || !w) return <Sheet layer={layer} />;
  const records = collapsePRs(prEvents([w], data.prs));
  return (
    <Sheet
      layer={layer}
      actions={
        <Button variant="primary" size="lg" block onClick={() => nav.back()}>
          Done
        </Button>
      }
    >
      <div className="sum-hero">
        <span className="sum-check">
          <Icon name="check" size={22} strokeWidth={2.2} />
        </span>
        <div className="eyebrow">Workout complete</div>
        <h2 className="title-l">{s.title}</h2>
        <div className="sub">
          {fmtDate(s.startedAt)} · {fmtTime(s.startedAt)}–{fmtTime(s.endedAt ?? s.startedAt)}
        </div>
      </div>
      <StatRow
        items={[
          { label: 'Duration', value: <DurNum ms={s.durationMs} /> },
          { label: 'Sets', value: <Num value={s.sets} /> },
          { label: 'Volume', value: <Num value={fmtNum(s.volume)} unit="kg" /> },
        ]}
      />
      {records.length > 0 && (
        <div className="sum-block">
          <div className="sum-label">{records.length === 1 ? 'New record' : `${records.length} new records`}</div>
          <div className="group">
            {records.map((r) => {
              const ex = data.ex.get(r.exerciseId);
              return (
                <div className="group-row" key={r.setId}>
                  <PRBadge />
                  <div className="row-main">
                    <div className="row-title">{ex?.name}</div>
                    <div className="row-sub">{prLabel(r.kinds)}</div>
                  </div>
                  <SetValue s={r} ex={ex} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {s.muscles.length > 0 && (
        <div className="sum-block">
          <div className="sum-label">Muscles · sets</div>
          <MuscleSplit muscles={s.muscles} />
        </div>
      )}
    </Sheet>
  );
}

export function StartSheet({ layer }: { layer: Layer }) {
  const data = useData();
  const templates = useMemo(() => {
    // One entry per routine: skip workouts whose exercises mostly overlap a newer one.
    const picked: { id: string; title: string; when: number; names: string; ids: Set<string> }[] = [];
    for (let i = data.summaries.length - 1; i >= 0 && picked.length < 6; i--) {
      const s = data.summaries[i];
      if (!s.sets) continue;
      const ids = new Set(data.finished[i].entries.map((e) => e.exerciseId));
      const similar = picked.some((p) => {
        let shared = 0;
        ids.forEach((id) => p.ids.has(id) && shared++);
        return shared / Math.max(1, new Set([...ids, ...p.ids]).size) >= 0.5;
      });
      if (similar) continue;
      const names = data.finished[i].entries.map((e) => data.ex.get(e.exerciseId)?.name ?? '').filter(Boolean);
      picked.push({ id: s.id, title: s.title, when: s.startedAt, names: names.join(', '), ids });
    }
    return picked;
  }, [data]);

  const begin = (templateId?: string) => {
    const id = beginWorkout(templateId);
    nav.replace({ name: 'workout', id });
  };

  return (
    <Sheet layer={layer} title="Start workout">
      <Button variant="primary" size="lg" block icon="plus" onClick={() => begin()}>
        Empty workout
      </Button>
      {templates.length > 0 && (
        <>
          <div className="sheet-sub">Repeat a previous workout</div>
          <div className="group">
            {templates.map((t) => (
              <button key={t.id} className="group-row" onClick={() => begin(t.id)}>
                <span className="repeat-ico">
                  <Icon name="repeat" size={18} />
                </span>
                <div className="row-main">
                  <div className="row-title">{t.title}</div>
                  <div className="row-sub">{t.names}</div>
                </div>
                <span className="row-end">{fmtRelDay(t.when)}</span>
              </button>
            ))}
          </div>
          <p className="sheet-note">Repeating copies the exercises and suggests last time's weights.</p>
        </>
      )}
    </Sheet>
  );
}
