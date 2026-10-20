import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { nav, toast, type Layer } from '../lib/nav';
import { useData } from '../lib/derived';
import { createPastWorkout, deleteWorkout, getDB, replaceDB, updateWorkout } from '../lib/store';
import { heatLevel, totals } from '../lib/stats';
import { MUSCLE_LABEL } from '../lib/exercises';
import {
  addDays,
  addMonths,
  dayKey,
  fmtDateLong,
  fmtDur,
  fmtKg,
  fmtMonthYear,
  fmtNum,
  fmtTime,
  fmtWeekday,
  parseDayKey,
  plural,
  startOfDay,
  startOfMonth,
  weekday,
} from '../lib/format';
import { prLabel } from '../lib/labels';
import { e1rm } from '../lib/stats';
import { beginWorkout } from './Workout';
import { Button, Empty, IconButton, Num, PRBadge, Stepper } from '../components/ui';
import { Icon } from '../components/icons';
import { Page, Sheet } from '../components/layers';
import { DurNum, MuscleSplit, SetValue, StatRow } from '../components/bits';

/* ------------------------------------------------------------ history tab */

export function History() {
  const data = useData();
  const [month, setMonth] = useState(() => startOfMonth(Date.now()));
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const firstMonth = data.summaries.length ? startOfMonth(data.summaries[0].startedAt) : startOfMonth(Date.now());
  const thisMonth = startOfMonth(Date.now());
  const canPrev = month > firstMonth;
  const canNext = month < thisMonth;
  const monthEnd = addMonths(month, 1);
  const inMonth = useMemo(
    () => data.summaries.filter((s) => s.startedAt >= month && s.startedAt < monthEnd).reverse(),
    [data.summaries, month, monthEnd],
  );
  const t = totals(inMonth);
  const today = startOfDay(Date.now());

  const days: (number | null)[] = [];
  for (let i = 0; i < weekday(month); i++) days.push(null);
  for (let d = month; d < monthEnd; d = addDays(d, 1)) days.push(startOfDay(d));

  const openDay = (ts: number) => {
    const stat = data.days.get(dayKey(ts));
    if (stat?.workouts.length === 1) nav.push({ name: 'workoutDetail', id: stat.workouts[0].id });
    else if (stat?.workouts.length) document.getElementById('h-' + stat.workouts[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (ts <= today) nav.push({ name: 'workoutTime', date: dayKey(ts) });
  };

  const onDown = (e: RPointerEvent) => (swipe.current = { x: e.clientX, y: e.clientY });
  const onUp = (e: RPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) {
      if (dx < 0 && canNext) setMonth(addMonths(month, 1));
      if (dx > 0 && canPrev) setMonth(addMonths(month, -1));
    }
  };

  return (
    <div className="screen-in">
      <header className="head">
        <div>
          <div className="eyebrow">{data.summaries.length ? `${plural(data.summaries.length, 'workout')} logged` : 'Nothing logged yet'}</div>
          <h1 className="title-xl">History</h1>
        </div>
        <div className="head-actions">
          <IconButton icon="plus" label="Log a past workout" onClick={() => nav.push({ name: 'workoutTime' })} />
        </div>
      </header>

      <div className="card cal" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (swipe.current = null)}>
        <div className="cal-head">
          <IconButton icon="chevronLeft" label="Previous month" tone="plain" size={36} disabled={!canPrev} onClick={() => setMonth(addMonths(month, -1))} />
          <div className="cal-title">{fmtMonthYear(month)}</div>
          <IconButton icon="chevronRight" label="Next month" tone="plain" size={36} disabled={!canNext} onClick={() => setMonth(addMonths(month, 1))} />
        </div>
        <div className="cal-grid">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="cal-wd">
              {d}
            </span>
          ))}
          {days.map((ts, i) => {
            if (ts === null) return <span key={'b' + i} />;
            const stat = data.days.get(dayKey(ts));
            const level = heatLevel(stat?.sets ?? 0, data.thresholds);
            const future = ts > today;
            return (
              <button
                key={ts}
                className={`cal-day l${level}${ts === today ? ' today' : ''}${future ? ' future' : ''}`}
                disabled={future}
                onClick={() => openDay(ts)}
                aria-label={`${fmtDateLong(ts)}${stat ? `, ${plural(stat.sets, 'set')}` : ''}`}
              >
                {new Date(ts).getDate()}
              </button>
            );
          })}
        </div>
        <div className="cal-foot">
          {t.workouts ? (
            <>
              <span>
                <b>{t.workouts}</b> {t.workouts === 1 ? 'workout' : 'workouts'}
              </span>
              <span>
                <b>{fmtDur(t.durationMs)}</b> total
              </span>
              <span>
                <b>{fmtNum(t.sets)}</b> sets
              </span>
            </>
          ) : (
            <span>No workouts this month. Tap a past day to log one.</span>
          )}
        </div>
      </div>

      {inMonth.length > 0 && (
        <div className="list hist-list">
          {inMonth.map((s) => (
            <button key={s.id} id={'h-' + s.id} className="row" onClick={() => nav.push({ name: 'workoutDetail', id: s.id })}>
              <span className="date-block">
                <span className="d">{new Date(s.startedAt).getDate()}</span>
                <span className="w">{fmtWeekday(s.startedAt)}</span>
              </span>
              <span className="row-main">
                <span className="row-title">{s.title}</span>
                <span className="row-sub">
                  {fmtTime(s.startedAt)} · {fmtDur(s.durationMs)} · {plural(s.sets, 'set')} · {fmtNum(s.volume)} kg
                </span>
              </span>
              <Icon name="chevronRight" size={18} className="dim" />
            </button>
          ))}
        </div>
      )}
      {!data.summaries.length && (
        <Empty title="Your workouts will show up here">
          Every finished workout is saved with its date, duration, sets and the muscles you trained.
        </Empty>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ detail page */

export function startRepeat(id: string) {
  const db = getDB();
  if (db.activeId) {
    toast.show('Finish the workout in progress first');
    nav.push({ name: 'workout', id: db.activeId });
    return;
  }
  const nid = beginWorkout(id);
  nav.push({ name: 'workout', id: nid });
}

export function WorkoutDetail({ layer, id }: { layer: Layer; id: string }) {
  const data = useData();
  const s = data.byId.get(id);
  const w = data.finished.find((x) => x.id === id);
  if (!s || !w) {
    return (
      <Page layer={layer}>
        <Empty title="This workout was deleted" />
      </Page>
    );
  }
  return (
    <Page layer={layer} title={s.title} actions={<IconButton icon="more" label="Workout options" onClick={() => nav.push({ name: 'workoutMenu', id })} />}>
      <div className="page-hero">
        <div className="eyebrow">{fmtDateLong(s.startedAt)}</div>
        <h1 className="title-xl">{s.title}</h1>
        <div className="sub">
          {fmtTime(s.startedAt)}–{fmtTime(s.endedAt ?? s.startedAt)}
        </div>
      </div>

      <StatRow
        items={[
          { label: 'Duration', value: <DurNum ms={s.durationMs} /> },
          { label: 'Sets', value: <Num value={s.sets} /> },
          { label: 'Volume', value: <Num value={fmtNum(s.volume)} unit="kg" /> },
        ]}
      />

      {s.muscles.length > 0 && (
        <div className="card detail-card">
          <div className="card-label">Muscles · sets</div>
          <MuscleSplit muscles={s.muscles} />
        </div>
      )}

      <div className="list">
        {w.entries.map((e) => {
          const ex = data.ex.get(e.exerciseId);
          if (!ex) return null;
          const best = Math.max(0, ...e.sets.map((x) => e1rm(x.kg, x.reps)));
          const vol = e.sets.reduce((a, x) => a + x.kg * x.reps, 0);
          return (
            <div key={e.id} className="card ex-block">
              <button className="ex-block-head" onClick={() => nav.push({ name: 'exercise', id: ex.id })}>
                <span className="row-main">
                  <span className="row-title">{ex.name}</span>
                  <span className="row-sub">
                    {MUSCLE_LABEL[ex.muscle]} · {plural(e.sets.length, 'set')}
                    {ex.kind === 'weighted' && best > 0 ? ` · e1RM ${fmtKg(Math.round(best * 2) / 2)} kg` : ''}
                    {vol > 0 ? ` · ${fmtNum(vol)} kg` : ''}
                  </span>
                </span>
                <Icon name="chevronRight" size={18} className="dim" />
              </button>
              <div className="sets static">
                {e.sets.map((x, i) => {
                  const kinds = data.prs.get(x.id);
                  return (
                    <div key={x.id} className="set-row">
                      <span className="set-n">{i + 1}</span>
                      <SetValue s={x} ex={ex} />
                      {kinds && <PRBadge title={prLabel(kinds, x, ex)} />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="detail-actions">
        <Button variant="secondary" icon="repeat" onClick={() => startRepeat(id)}>
          Repeat
        </Button>
        <Button variant="secondary" icon="edit" onClick={() => nav.push({ name: 'workout', id })}>
          Edit
        </Button>
      </div>
    </Page>
  );
}

export function WorkoutMenu({ layer, id }: { layer: Layer; id: string }) {
  const data = useData();
  const s = data.byId.get(id);
  if (!s) return <Sheet layer={layer} />;
  const remove = () => {
    const snapshot = getDB();
    deleteWorkout(id);
    nav.back(2);
    toast.show('Workout deleted', { label: 'Undo', run: () => replaceDB(snapshot) });
  };
  return (
    <Sheet layer={layer} title={s.title}>
      <div className="group">
        <button className="group-row" onClick={() => nav.replace({ name: 'rename', id })}>
          <Icon name="edit" size={20} />
          <span className="row-main">Rename</span>
        </button>
        <button className="group-row" onClick={() => nav.replace({ name: 'workout', id })}>
          <Icon name="exercises" size={20} />
          <span className="row-main">Edit exercises and sets</span>
        </button>
        <button className="group-row" onClick={() => nav.replace({ name: 'workoutTime', id })}>
          <Icon name="clock" size={20} />
          <span className="row-main">Change date and time</span>
        </button>
        <button
          className="group-row"
          onClick={() => {
            nav.back();
            startRepeat(id);
          }}
        >
          <Icon name="repeat" size={20} />
          <span className="row-main">Repeat this workout</span>
        </button>
        <button className="group-row" onClick={remove}>
          <Icon name="trash" size={20} />
          <span className="row-main">Delete workout</span>
        </button>
      </div>
    </Sheet>
  );
}

export function RenameSheet({ layer, id }: { layer: Layer; id: string }) {
  const data = useData();
  const w = data.db.workouts.find((x) => x.id === id);
  const s = data.byId.get(id);
  const [name, setName] = useState(w?.name ?? '');
  if (!w || !s) return <Sheet layer={layer} />;
  const save = (value: string) => {
    updateWorkout(id, { name: value.trim() || undefined });
    nav.back();
  };
  return (
    <Sheet
      layer={layer}
      title="Rename workout"
      actions={
        <>
          <Button variant="primary" size="lg" block onClick={() => save(name)}>
            Save
          </Button>
          {w.name && (
            <Button variant="ghost" block onClick={() => save('')}>
              Use automatic name · {s.autoTitle}
            </Button>
          )}
        </>
      }
    >
      <div className="field">
        <input
          className="text-input"
          value={name}
          maxLength={40}
          placeholder={s.autoTitle}
          aria-label="Workout name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save(name)}
        />
      </div>
      <p className="sheet-note">Leave it empty to name the workout after the muscles you trained most.</p>
    </Sheet>
  );
}

/* ------------------------------------------------------------ date & time */

const two = (n: number) => String(n).padStart(2, '0');

export function WorkoutTimeSheet({ layer, id, date }: { layer: Layer; id?: string; date?: string }) {
  const data = useData();
  const w = id ? data.db.workouts.find((x) => x.id === id) : undefined;
  // Default: 18:00 on the chosen day, or an hour ago when that would be in the future.
  const evening = parseDayKey(date ?? dayKey(Date.now())) + 18 * 3600_000;
  const hourAgo = Math.floor((Date.now() - 3600_000) / 900_000) * 900_000;
  const initialStart = w ? w.startedAt : evening > Date.now() ? hourAgo : evening;
  const [day, setDay] = useState(dayKey(initialStart));
  const [time, setTime] = useState(`${two(new Date(initialStart).getHours())}:${two(new Date(initialStart).getMinutes())}`);
  const [minutes, setMinutes] = useState(w && w.endedAt ? Math.max(1, Math.round((w.endedAt - w.startedAt) / 60_000)) : 60);

  const startTs = () => {
    const [h, m] = time.split(':').map(Number);
    return parseDayKey(day) + ((h || 0) * 60 + (m || 0)) * 60_000;
  };
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && startTs() <= Date.now();

  const save = () => {
    if (!valid) return;
    const start = startTs();
    if (w) {
      // shift logged sets along with the workout
      updateWorkout(w.id, { startedAt: start, endedAt: start + minutes * 60_000 });
      if (start !== w.startedAt) {
        const delta = start - w.startedAt;
        const db = getDB();
        replaceDB({
          ...db,
          workouts: db.workouts.map((x) =>
            x.id === w.id ? { ...x, entries: x.entries.map((e) => ({ ...e, sets: e.sets.map((st) => ({ ...st, at: st.at + delta })) })) } : x,
          ),
        });
      }
      nav.back();
    } else {
      const nid = createPastWorkout(start, minutes * 60_000);
      nav.replace({ name: 'workout', id: nid });
    }
  };

  return (
    <Sheet
      layer={layer}
      title={w ? 'Date and time' : 'Log a past workout'}
      actions={
        <Button variant="primary" size="lg" block disabled={!valid} onClick={save}>
          {w ? 'Save' : 'Next: add exercises'}
        </Button>
      }
    >
      <div className="form">
        <div className="form-2">
          <div className="field">
            <label className="field-label" htmlFor="wt-day">
              Date
            </label>
            <input id="wt-day" type="date" className="text-input" value={day} max={dayKey(Date.now())} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="wt-time">
              Start
            </label>
            <input id="wt-time" type="time" className="text-input" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <div className="field-label">Duration</div>
          <Stepper id="wt-min" value={minutes} onChange={setMinutes} step={5} min={5} max={360} unit="minutes" integer />
        </div>
        {!valid && <p className="sheet-note">The start time can’t be in the future.</p>}
      </div>
    </Sheet>
  );
}
