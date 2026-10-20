import { useMemo, useState } from 'react';
import { nav } from '../lib/nav';
import { useData, useNow } from '../lib/derived';
import { collapsePRs, prEvents, sortedBodyweight, summarize, totals, weekStreak } from '../lib/stats';
import {
  addDays,
  DAY,
  fmtAgo,
  fmtClock,
  fmtDate,
  fmtDateLong,
  fmtDayMonth,
  fmtDur,
  fmtBw,
  fmtNum,
  fmtRelDay,
  parseDayKey,
  plural,
  startOfDay,
  startOfWeek,
  weekday,
} from '../lib/format';
import { prLabel } from '../lib/labels';
import { beginWorkout } from './Workout';
import { Delta, IconButton, Num } from '../components/ui';
import { Icon } from '../components/icons';
import { Heatmap, HeatLegend, Sparkline } from '../components/charts';
import { DurNum, SetValue } from '../components/bits';

const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function Home() {
  const data = useData();
  const now = useNow(1000, !!data.active);
  const [picked, setPicked] = useState<string | null>(null);
  const { summaries, active } = data;
  const has = summaries.length > 0;

  const week = useMemo(() => {
    const from = startOfWeek(Date.now());
    const items = summaries.filter((s) => s.startedAt >= from);
    const days = new Set(items.map((s) => weekday(s.startedAt)));
    return { items, days, t: totals(items) };
  }, [summaries]);

  const streak = useMemo(() => weekStreak(summaries), [summaries]);
  const last = summaries[summaries.length - 1];

  const avg30 = useMemo(() => {
    const recent = summaries.filter((s) => s.startedAt > Date.now() - 30 * DAY);
    return recent.length ? totals(recent).durationMs / recent.length : 0;
  }, [summaries]);

  const volume = useMemo(() => {
    const today = startOfDay(Date.now());
    const from = addDays(today, -6);
    const prevFrom = addDays(from, -7);
    let cur = 0;
    let prev = 0;
    for (const s of summaries) {
      if (s.startedAt >= from) cur += s.volume;
      else if (s.startedAt >= prevFrom) prev += s.volume;
    }
    return { cur, prev };
  }, [summaries]);

  const bw = useMemo(() => sortedBodyweight(data.db.bodyweight), [data.db.bodyweight]);
  const bwLast = bw[bw.length - 1];
  const bwPrev = bw[bw.length - 2];

  const records = useMemo(() => collapsePRs(prEvents(data.finished, data.prs)).slice(0, 4), [data.finished, data.prs]);

  const pickedDay = picked ? data.days.get(picked) : undefined;
  const activeSum = active ? summarize(active, data.ex, now) : null;

  const start = () => {
    if (!has) {
      const id = beginWorkout();
      nav.push({ name: 'workout', id });
    } else nav.push({ name: 'start' });
  };

  return (
    <div className="screen-in">
      <header className="head">
        <div>
          <div className="eyebrow">{fmtDateLong(Date.now())}</div>
          <h1 className="title-xl">Logbook</h1>
        </div>
        <div className="head-actions">
          <IconButton icon="settings" label="Settings" onClick={() => nav.push({ name: 'settings' })} />
        </div>
      </header>

      <div className="bento">
        {active && activeSum ? (
          <button className="card start-card span2" onClick={() => nav.push({ name: 'workout', id: active.id })}>
            <div className="start-row">
              <div className="start-copy">
                <div className="live-label">
                  <span className="live-dot" /> In progress
                </div>
                <div className="live-clock">{fmtClock(now - active.startedAt)}</div>
                <div className="start-sub">
                  {activeSum.title} · {plural(activeSum.sets, 'set')}
                </div>
              </div>
              <span className="start-go">
                <Icon name="chevronRight" size={22} strokeWidth={2} />
              </span>
            </div>
          </button>
        ) : (
          <button className="card start-card span2" onClick={start}>
            <div className="start-row">
              <div className="start-copy">
                <div className="start-title">Start workout</div>
                <div className="start-sub">
                  {last ? `Last: ${last.title}, ${fmtRelDay(last.startedAt, Date.now(), true)}` : 'Log your first session'}
                </div>
              </div>
              <span className="start-go">
                <Icon name="plus" size={22} strokeWidth={2} />
              </span>
            </div>
          </button>
        )}

        <button className="card" onClick={() => nav.setTab('history')}>
          <div className="card-label">This week</div>
          <div className="big card-value">
            <Num value={week.t.workouts} unit={week.t.workouts === 1 ? 'workout' : 'workouts'} />
          </div>
          <div className="week-dots" aria-label="Days trained this week">
            {WD.map((d, i) => {
              const isToday = i === weekday(Date.now());
              return (
                <span key={i} className={`wd${week.days.has(i) ? ' on' : ''}${isToday ? ' today' : ''}`}>
                  <i />
                  {d}
                </span>
              );
            })}
          </div>
        </button>

        <button className="card" onClick={() => nav.push({ name: 'bodyweight' })}>
          <div className="card-label">
            Body weight
            {bw.length > 1 && <Sparkline values={bw.slice(-12).map((b) => b.kg)} width={48} height={18} />}
          </div>
          {bwLast ? (
            <>
              <div className="big card-value">
                <Num value={fmtBw(bwLast.kg)} unit="kg" />
              </div>
              <div className="card-foot">
                {bwPrev ? <Delta value={bwLast.kg - bwPrev.kg} unit=" kg" neutral /> : <span />}
                <span>{fmtAgo(parseDayKey(bwLast.date))}</span>
              </div>
            </>
          ) : (
            <>
              <div className="mid card-value">Log weight</div>
              <div className="card-foot">
                <span>Keep it next to your lifts</span>
              </div>
            </>
          )}
        </button>

        <div className="card span2">
          <div className="card-label">
            Consistency
            <span className="muted">{streak > 1 ? `${streak}-week streak` : has ? plural(summaries.length, 'workout') : ''}</span>
          </div>
          <div className="heat-wrap">
            <Heatmap days={data.days} thresholds={data.thresholds} selected={picked} onSelect={setPicked} />
          </div>
          <div className="card-foot">
            {pickedDay ? (
              <button
                className="heat-pick"
                onClick={() => pickedDay.workouts[0] && nav.push({ name: 'workoutDetail', id: pickedDay.workouts[0].id })}
              >
                <b>{fmtDate(pickedDay.date)}</b> · {pickedDay.workouts.map((w) => w.title).join(', ')} · {plural(pickedDay.sets, 'set')} ·{' '}
                {fmtDur(pickedDay.durationMs)}
                <Icon name="chevronRight" size={14} />
              </button>
            ) : picked ? (
              <span>
                <b>{fmtDate(parseDayKey(picked))}</b> · rest day
              </span>
            ) : (
              <>
                <span>{has ? 'Shade shows sets per day' : 'Each workout fills a square'}</span>
                <HeatLegend />
              </>
            )}
          </div>
        </div>

        {has && last && (
          <>
            <button className="card" onClick={() => nav.push({ name: 'workoutDetail', id: last.id })}>
              <div className="card-label">
                Last workout
                <Icon name="chevronRight" size={16} className="dim" />
              </div>
              <div className="lw-title">{last.title}</div>
              <div className="sub">
                {fmtRelDay(last.startedAt)} · {fmtDur(last.durationMs)}
              </div>
            </button>

            <button className="card" onClick={() => nav.setTab('stats')}>
              <div className="card-label">Time this week</div>
              <div className="big card-value">{week.t.durationMs ? <DurNum ms={week.t.durationMs} /> : <Num value="0" unit="m" />}</div>
              <div className="card-foot">
                <span>{avg30 ? `${fmtDur(avg30)} per session` : 'No sessions yet'}</span>
              </div>
            </button>

            <button className="card span2 vol-card" onClick={() => nav.setTab('stats')}>
              <div className="vol-left">
                <div className="card-label">Volume lifted</div>
                <div className="sub">Last 7 days</div>
              </div>
              <div className="vol-right">
                <div className="big">
                  <Num value={fmtNum(volume.cur)} unit="kg" />
                </div>
                {volume.prev > 0 && (
                  <div className="vol-delta">
                    <Delta value={((volume.cur - volume.prev) / volume.prev) * 100} unit="%" decimals={0} /> vs week before
                  </div>
                )}
              </div>
            </button>
          </>
        )}
      </div>

      {records.length > 0 && (
        <>
          <div className="section-head">
            <h2>Recent records</h2>
          </div>
          <div className="group">
            {records.map((r) => {
              const ex = data.ex.get(r.exerciseId);
              return (
                <button key={r.setId} className="group-row" onClick={() => nav.push({ name: 'exercise', id: r.exerciseId })}>
                  <div className="row-main">
                    <div className="row-title">{ex?.name}</div>
                    <div className="row-sub">
                      {prLabel(r.kinds, r, ex)} · {fmtDayMonth(r.at)}
                    </div>
                  </div>
                  <SetValue s={r} ex={ex} />
                </button>
              );
            })}
          </div>
        </>
      )}

      {!has && (
        <p className="home-note">
          Logbook keeps everything on this phone. Start a workout, add exercises and log each set; charts and the heatmap
          fill in as you train.
        </p>
      )}
      {import.meta.env.MODE === 'demo' && (
        <p className="home-note">This preview is filled with five months of sample training. On your phone the log starts empty.</p>
      )}
    </div>
  );
}
