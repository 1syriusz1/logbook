import { useMemo, useState } from 'react';
import type { Muscle } from '../lib/types';
import { nav, type Layer } from '../lib/nav';
import { useData } from '../lib/derived';
import { exerciseRecords, RANGES, rangeStart, type RangeKey, type Session } from '../lib/stats';
import { equipmentLabel, MUSCLE_LABEL, MUSCLES } from '../lib/exercises';
import { fmtCompact, fmtDate, fmtDayMonth, fmtKg, fmtNum, fmtRelDay, plural } from '../lib/format';
import { prLabel, setText } from '../lib/labels';
import { Chips, Delta, Empty, IconButton, Num, PRBadge, Segmented } from '../components/ui';
import { Icon } from '../components/icons';
import { Page } from '../components/layers';
import { LineChart, Sparkline } from '../components/charts';
import { matches, useUsage } from './Picker';

type Filter = 'all' | Muscle;
const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, ...MUSCLES.map((m) => ({ value: m.id as Filter, label: m.label }))];

/* ------------------------------------------------------------ tab */

export function Exercises() {
  const data = useData();
  const usage = useUsage();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const visible = data.db.exercises.filter((e) => !e.archived && (filter === 'all' || e.muscle === filter) && matches(e, q));
  const tracked = visible.filter((e) => usage.has(e.id)).sort((a, b) => usage.get(b.id)!.last - usage.get(a.id)!.last);
  const library = visible.filter((e) => !usage.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  const trackedCount = data.db.exercises.filter((e) => usage.has(e.id)).length;

  return (
    <div className="screen-in">
      <header className="head">
        <div>
          <div className="eyebrow">{trackedCount ? `${trackedCount} tracked` : `${data.db.exercises.length} in the library`}</div>
          <h1 className="title-xl">Exercises</h1>
        </div>
        <div className="head-actions">
          <IconButton icon="plus" label="New exercise" onClick={() => nav.push({ name: 'exerciseForm' })} />
        </div>
      </header>

      <div className="ex-tools">
        <label className="search">
          <Icon name="search" size={19} />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" enterKeyHint="search" />
          {q && (
            <button aria-label="Clear search" onClick={() => setQ('')}>
              <Icon name="close" size={17} />
            </button>
          )}
        </label>
        <Chips options={FILTERS} value={filter} onChange={setFilter} label="Muscle group" />
      </div>

      {tracked.length > 0 && (
        <>
          <div className="list-label">Your exercises</div>
          <div className="list">
            {tracked.map((e) => {
              const sessions = data.sessions.get(e.id) ?? [];
              const last = sessions[sessions.length - 1];
              const series = sessions
                .slice(-10)
                .map((s) => (e.kind === 'bodyweight' ? (e.loaded ? s.topKg : s.maxReps) : s.bestE1rm));
              return (
                <button key={e.id} className="row" onClick={() => nav.push({ name: 'exercise', id: e.id })}>
                  <span className="row-main">
                    <span className="row-title">{e.name}</span>
                    <span className="row-sub">
                      {MUSCLE_LABEL[e.muscle]} · {plural(sessions.length, 'session')} · {last ? fmtRelDay(last.date) : ''}
                    </span>
                  </span>
                  <span className="ex-end">
                    <Sparkline values={series} width={52} height={22} />
                    {last && <span className="ex-top">{setText({ kg: last.topKg, reps: last.topReps }, e)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {library.length > 0 && (
        <>
          <div className="list-label">{tracked.length ? 'Library' : 'All exercises'}</div>
          <div className="group">
            {library.map((e) => (
              <button key={e.id} className="group-row" onClick={() => nav.push({ name: 'exercise', id: e.id })}>
                <div className="row-main">
                  <div className="row-title">{e.name}</div>
                  <div className="row-sub">
                    {MUSCLE_LABEL[e.muscle]} · {equipmentLabel(e)}
                    {e.custom ? ' · yours' : ''}
                  </div>
                </div>
                <Icon name="chevronRight" size={18} className="dim" />
              </button>
            ))}
          </div>
        </>
      )}

      {!visible.length && (
        <Empty
          title={`No match for “${q}”`}
          action={
            <button className="create-row" onClick={() => nav.push({ name: 'exerciseForm', initialName: q.trim() })}>
              <Icon name="plus" size={18} /> Create “{q.trim()}”
            </button>
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ detail */

type Metric = 'e1rm' | 'top' | 'volume' | 'reps' | 'total' | 'added';

const METRIC_INFO: Record<Metric, { label: string; unit: string; note: string }> = {
  e1rm: { label: 'Est. 1RM', unit: 'kg', note: 'Best estimated one-rep max per session (Epley).' },
  top: { label: 'Top weight', unit: 'kg', note: 'Heaviest set per session.' },
  volume: { label: 'Volume', unit: 'kg', note: 'Weight × reps, summed per session.' },
  reps: { label: 'Best set', unit: 'reps', note: 'Most reps in one set per session.' },
  total: { label: 'Total reps', unit: 'reps', note: 'All reps per session.' },
  added: { label: 'Added weight', unit: 'kg', note: 'Heaviest added load per session.' },
};

function metricValue(s: Session, m: Metric): number {
  switch (m) {
    case 'e1rm':
      return Math.round(s.bestE1rm * 2) / 2;
    case 'top':
      return s.topKg;
    case 'volume':
      return s.volume;
    case 'reps':
      return s.maxReps;
    case 'total':
      return s.totalReps;
    case 'added':
      return Math.max(...s.sets.map((x) => x.kg));
  }
}

export function ExercisePage({ layer, id }: { layer: Layer; id: string }) {
  const data = useData();
  const ex = data.ex.get(id);
  const sessions = useMemo(() => data.sessions.get(id) ?? [], [data.sessions, id]);
  const records = useMemo(() => exerciseRecords(sessions), [sessions]);
  const bw = ex?.kind === 'bodyweight';
  const everAdded = sessions.some((s) => s.sets.some((x) => x.kg > 0));
  const metrics: Metric[] = bw
    ? ex?.loaded
      ? ['added', 'reps', 'total']
      : everAdded
        ? ['reps', 'total', 'added']
        : ['reps', 'total']
    : ['e1rm', 'top', 'volume'];
  const [metric, setMetric] = useState<Metric>(metrics[0]);
  const [range, setRange] = useState<RangeKey>('6m');
  const [scrub, setScrub] = useState<number | null>(null);

  if (!ex) {
    return (
      <Page layer={layer}>
        <Empty title="This exercise was removed" />
      </Page>
    );
  }

  const from = rangeStart(range, sessions[0]?.date ?? null);
  const shown = sessions.filter((s) => s.date >= from);
  const pts = shown.map((s) => ({ x: s.date, y: metricValue(s, metric) }));
  const info = METRIC_INFO[metric];
  const focus = scrub !== null ? shown[scrub] : shown[shown.length - 1];
  const firstInRange = shown[0];
  const fmtVal = (v: number) => (metric === 'volume' ? fmtNum(v) : fmtKg(v));
  const recent = [...sessions].reverse().slice(0, 30);
  // keep only rep targets that tell something new (a lighter weight for more reps)
  const repMaxes = records.repMaxes.filter((r, i, all) => i === all.length - 1 || r.kg > all[i + 1].kg);

  return (
    <Page
      layer={layer}
      title={ex.name}
      actions={<IconButton icon="edit" label="Edit exercise" onClick={() => nav.push({ name: 'exerciseForm', id: ex.id })} />}
    >
      <div className="page-hero">
        <div className="eyebrow">
          {MUSCLE_LABEL[ex.muscle]} · {equipmentLabel(ex)}
        </div>
        <h1 className="title-xl">{ex.name}</h1>
        {sessions.length > 0 && (
          <div className="sub">
            {plural(sessions.length, 'session')} since {fmtDayMonth(sessions[0].date)}
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="card">
          <Empty title="No sets logged yet">Add {ex.name} to a workout. Its progress chart and records will appear here.</Empty>
        </div>
      ) : (
        <>
          <div className="card chart-card">
            <Segmented
              label="Metric"
              size="sm"
              value={metric}
              onChange={(m) => {
                setMetric(m);
                setScrub(null);
              }}
              options={metrics.map((m) => ({ value: m, label: METRIC_INFO[m].label }))}
            />
            <div className="chart-head">
              <div className="huge">{focus ? <Num value={fmtVal(metricValue(focus, metric))} unit={info.unit} /> : '–'}</div>
              <div className="chart-sub">
                {scrub !== null && focus ? (
                  <>
                    <b>{fmtDate(focus.date)}</b> · {focus.sets.map((x) => setText(x, ex)).join(', ')}
                  </>
                ) : firstInRange && focus && shown.length > 1 ? (
                  <>
                    <Delta value={metricValue(focus, metric) - metricValue(firstInRange, metric)} unit={` ${info.unit}`} decimals={metric === 'volume' ? 0 : 1} />{' '}
                    since {fmtDayMonth(firstInRange.date)}
                  </>
                ) : (
                  info.note
                )}
              </div>
            </div>
            {pts.length ? (
              <LineChart
                key={`${range}-${metric}`}
                points={pts}
                height={180}
                formatY={(v) => (metric === 'volume' ? fmtCompact(v) : fmtNum(v, 1))}
                onScrub={setScrub}
                zero={metric === 'volume' || metric === 'total'}
                tooltip={(i) => ({ value: `${fmtVal(metricValue(shown[i], metric))} ${info.unit}`, label: fmtDate(shown[i].date) })}
              />
            ) : (
              <div className="chart-empty">No sessions in this range</div>
            )}
            <Segmented
              label="Range"
              size="sm"
              value={range}
              onChange={(r) => {
                setRange(r);
                setScrub(null);
              }}
              options={RANGES}
            />
          </div>

          <div className="bento rec-grid">
            {bw ? (
              <>
                {everAdded && records.heaviest && records.heaviest.kg > 0 && (
                  <RecordCard
                    label="Heaviest added"
                    value={<Num value={fmtKg(records.heaviest.kg)} unit="kg" />}
                    sub={`× ${records.heaviest.reps} · ${fmtDayMonth(records.heaviest.date)}`}
                  />
                )}
                <RecordCard
                  label="Most reps"
                  value={records.mostReps ? <Num value={records.mostReps.reps} unit="reps" /> : '–'}
                  sub={records.mostReps ? `${setText(records.mostReps, ex)} · ${fmtDayMonth(records.mostReps.date)}` : ''}
                />
                <RecordCard
                  label="Best session"
                  value={<Num value={Math.max(...sessions.map((s) => s.totalReps))} unit="reps" />}
                  sub="total in one workout"
                />
                <RecordCard label="Sessions" value={<Num value={sessions.length} />} sub={`last ${fmtRelDay(sessions[sessions.length - 1].date, Date.now(), true)}`} />
                {!(everAdded && records.heaviest && records.heaviest.kg > 0) && (
                  <RecordCard
                    label="All reps"
                    value={<Num value={fmtNum(sessions.reduce((a, s) => a + s.totalReps, 0))} unit="reps" />}
                    sub="since the first session"
                  />
                )}
              </>
            ) : (
              <>
                <RecordCard
                  label="Heaviest"
                  value={records.heaviest ? <Num value={fmtKg(records.heaviest.kg)} unit="kg" /> : '–'}
                  sub={records.heaviest ? `× ${records.heaviest.reps} · ${fmtDayMonth(records.heaviest.date)}` : ''}
                />
                <RecordCard
                  label="Best est. 1RM"
                  value={records.bestE1rm ? <Num value={fmtKg(Math.round(records.bestE1rm.value * 2) / 2)} unit="kg" /> : '–'}
                  sub={records.bestE1rm ? `${setText(records.bestE1rm)} · ${fmtDayMonth(records.bestE1rm.date)}` : ''}
                />
                <RecordCard
                  label="Best set"
                  value={records.bestSetVolume ? <Num value={fmtNum(records.bestSetVolume.value)} unit="kg" /> : '–'}
                  sub={records.bestSetVolume ? `${setText(records.bestSetVolume)} · ${fmtDayMonth(records.bestSetVolume.date)}` : ''}
                />
                <RecordCard
                  label="Best session"
                  value={records.bestSession ? <Num value={fmtNum(records.bestSession.value)} unit="kg" /> : '–'}
                  sub={records.bestSession ? fmtDayMonth(records.bestSession.date) : ''}
                />
              </>
            )}
          </div>

          {!bw && repMaxes.length > 1 && (
            <div className="card">
              <div className="card-label">Best weight by reps</div>
              <div className="rm-grid">
                {repMaxes.map((r) => (
                  <div key={r.reps} className="rm">
                    <div className="rm-n">{r.reps}+ reps</div>
                    <div className="rm-v">{fmtKg(r.kg)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="section-head">
            <h2>History</h2>
          </div>
          <div className="group">
            {recent.map((s) => (
              <button key={s.workoutId} className="group-row hist-sess" onClick={() => nav.push({ name: 'workoutDetail', id: s.workoutId })}>
                <div className="hs-date">
                  <div className="row-title">{fmtDayMonth(s.date)}</div>
                  <div className="row-sub">{bw ? `${s.totalReps} reps` : `${fmtNum(s.volume)} kg`}</div>
                </div>
                <div className="hs-sets">
                  {s.sets.map((x) => {
                    const kinds = data.prs.get(x.id);
                    return (
                      <span key={x.id} className={`hs-set${kinds ? ' is-pr' : ''}`} title={kinds ? prLabel(kinds, x, ex) : undefined}>
                        {setText(x, ex)}
                        {kinds && <PRBadge />}
                      </span>
                    );
                  })}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

function RecordCard({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="card rec">
      <div className="card-label">{label}</div>
      <div className="mid rec-v">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
