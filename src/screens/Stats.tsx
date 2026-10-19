import { useMemo, useState } from 'react';
import { nav } from '../lib/nav';
import { useData } from '../lib/derived';
import { inRange, muscleSplit, RANGES, rangeStart, sortedBodyweight, totals, weekdayCounts, weeklySeries, type RangeKey } from '../lib/stats';
import { MUSCLE_LABEL } from '../lib/exercises';
import {
  DAY,
  fmtCompact,
  fmtDate,
  fmtDayMonth,
  fmtDur,
  fmtBw,
  fmtNum,
  parseDayKey,
  plural,
  WEEKDAYS_PLURAL,
  WEEKDAYS_SHORT,
} from '../lib/format';
import { Delta, Empty, Num, Segmented } from '../components/ui';
import { BarChart, Heatmap, HeatLegend, LineChart } from '../components/charts';
import { DurNum } from '../components/bits';
import { Icon } from '../components/icons';

type WeekMetric = 'sets' | 'workouts' | 'time' | 'volume';

const RANGE_LABEL: Record<RangeKey, string> = {
  '1m': 'Last month',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '1y': 'Last 12 months',
  all: 'All time',
};

/** minutes after midnight → "18:30", rounded to the quarter hour */
function clock(min: number) {
  const q = Math.round(min / 15) * 15;
  return `${String(Math.floor(q / 60) % 24).padStart(2, '0')}:${String(q % 60).padStart(2, '0')}`;
}

function pct(cur: number, prev: number) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

export function Stats() {
  const data = useData();
  const [range, setRange] = useState<RangeKey>('3m');
  const [wm, setWm] = useState<WeekMetric>('sets');
  const [wScrub, setWScrub] = useState<number | null>(null);
  const [dScrub, setDScrub] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const { summaries } = data;
  const now = Date.now();

  const v = useMemo(() => {
    const from = rangeStart(range, summaries[0]?.startedAt ?? null, now);
    const span = now - from;
    const cur = inRange(summaries, from, now + 1);
    const prev = range === 'all' ? [] : inRange(summaries, from - span, from);
    // whole weeks: the first bar includes days just before the range starts
    const weeks = weeklySeries(summaries, from, now);
    const split = muscleSplit(cur);
    const wd = weekdayCounts(cur);
    const starts = cur.map((s) => {
      const d = new Date(s.startedAt);
      return d.getHours() * 60 + d.getMinutes();
    });
    starts.sort((a, b) => a - b);
    const medianStart = starts.length ? starts[Math.floor(starts.length / 2)] : null;
    return { from, cur, prev, T: totals(cur), P: totals(prev), weeks, split, wd, medianStart, weeksCount: Math.ceil(span / (7 * DAY)) };
  }, [summaries, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const bw = useMemo(() => sortedBodyweight(data.db.bodyweight).filter((b) => parseDayKey(b.date) >= v.from), [data.db.bodyweight, v.from]);

  if (!summaries.length) {
    return (
      <div className="screen-in">
        <header className="head">
          <div>
            <div className="eyebrow">Your training at a glance</div>
            <h1 className="title-xl">Stats</h1>
          </div>
        </header>
        <div className="card">
          <Empty title="Nothing to chart yet">Finish your first workout and this page fills with your weekly volume, session length, muscle split and training days.</Empty>
        </div>
      </div>
    );
  }

  const { T, P, weeks, split } = v;
  const avgDur = T.workouts ? T.durationMs / T.workouts : 0;
  const weekVal = (w: (typeof weeks)[number]) =>
    wm === 'sets' ? w.sets : wm === 'workouts' ? w.workouts : wm === 'time' ? w.durationMs / 60_000 : w.volume;
  const bars = weeks.map((w) => ({ key: w.start, value: weekVal(w), label: fmtDayMonth(w.start) }));
  const avgWeek = bars.length ? bars.reduce((a, b) => a + b.value, 0) / bars.length : 0;
  const focusWeek = wScrub !== null ? weeks[wScrub] : null;
  const fmtWeek = (val: number) =>
    wm === 'time' ? fmtDur(val * 60_000) : wm === 'volume' ? fmtNum(val) + ' kg' : wm === 'workouts' ? fmtNum(val, 1) : fmtNum(val);

  const durPts = v.cur.map((s) => ({ x: s.startedAt, y: s.durationMs / 60_000 }));
  const focusDur = dScrub !== null ? v.cur[dScrub] : null;
  const longest = v.cur.reduce((m, s) => Math.max(m, s.durationMs), 0);

  const maxSplit = split[0]?.[1] ?? 1;
  const totalSplit = split.reduce((a, [, n]) => a + n, 0) || 1;
  const topDay = v.wd.indexOf(Math.max(...v.wd));
  const heatWeeks = Math.min(v.weeksCount + 1, 160);
  const pickedDay = picked ? data.days.get(picked) : undefined;

  return (
    <div className="screen-in">
      <header className="head">
        <div>
          <div className="eyebrow">{RANGE_LABEL[range]}</div>
          <h1 className="title-xl">Stats</h1>
        </div>
      </header>

      <Segmented label="Time range" value={range} onChange={(r) => { setRange(r); setWScrub(null); setDScrub(null); }} options={RANGES} />

      <div className="bento totals">
        <TotalCard label="Workouts" value={<Num value={T.workouts} />} delta={pct(T.workouts, P.workouts)} sub={`${fmtNum(T.workouts / Math.max(1, v.weeksCount), 1)} per week`} />
        <TotalCard label="Time" value={<DurNum ms={T.durationMs} />} delta={pct(T.durationMs, P.durationMs)} sub={`${fmtDur(avgDur)} per session`} />
        <TotalCard label="Sets" value={<Num value={fmtNum(T.sets)} />} delta={pct(T.sets, P.sets)} sub={`${fmtNum(T.sets / Math.max(1, T.workouts), 1)} per workout`} />
        <TotalCard label="Volume" value={<Num value={fmtCompact(T.volume)} unit="kg" />} delta={pct(T.volume, P.volume)} sub={`${fmtNum(T.volume / Math.max(1, T.workouts))} kg per workout`} />
      </div>

      <div className="card stat-card">
        <div className="card-label">
          Consistency <HeatLegend />
        </div>
        <div className="heat-wrap">
          <Heatmap days={data.days} thresholds={data.thresholds} weeks={heatWeeks} cell={14} gap={3} scrollable selected={picked} onSelect={setPicked} />
        </div>
        <div className="card-foot">
          {pickedDay ? (
            <button className="heat-pick" onClick={() => nav.push({ name: 'workoutDetail', id: pickedDay.workouts[0].id })}>
              <b>{fmtDate(pickedDay.date)}</b> · {pickedDay.workouts.map((w) => w.title).join(', ')} · {plural(pickedDay.sets, 'set')} · {fmtDur(pickedDay.durationMs)}
              <Icon name="chevronRight" size={14} />
            </button>
          ) : picked ? (
            <span>
              <b>{fmtDate(parseDayKey(picked))}</b> · rest day
            </span>
          ) : (
            <span>
              Trained on <b>{data.days.size && v.cur.length ? new Set(v.cur.map((s) => new Date(s.startedAt).toDateString())).size : 0}</b> days · tap a square for details
            </span>
          )}
        </div>
      </div>

      <div className="card stat-card">
        <div className="card-label">Per week</div>
        <Segmented
          label="Weekly metric"
          size="sm"
          value={wm}
          onChange={(m) => { setWm(m); setWScrub(null); }}
          options={[
            { value: 'sets', label: 'Sets' },
            { value: 'workouts', label: 'Workouts' },
            { value: 'time', label: 'Time' },
            { value: 'volume', label: 'Volume' },
          ]}
        />
        <div className="chart-head">
          <div className="big">{fmtWeek(focusWeek ? weekVal(focusWeek) : avgWeek)}</div>
          <div className="chart-sub">{focusWeek ? <>Week of <b>{fmtDayMonth(focusWeek.start)}</b> · {plural(focusWeek.workouts, 'workout')}</> : 'Weekly average · dashed line'}</div>
        </div>
        <BarChart
          bars={bars}
          height={150}
          average={avgWeek}
          current={bars.length - 1}
          onScrub={setWScrub}
          formatY={(val) => (wm === 'time' ? `${Math.round(val / 60)}h` : wm === 'volume' ? fmtCompact(val) : fmtNum(val))}
        />
      </div>

      <div className="card stat-card">
        <div className="card-label">Session length</div>
        <div className="chart-head">
          <div className="big">{focusDur ? <DurNum ms={focusDur.durationMs} /> : <DurNum ms={avgDur} />}</div>
          <div className="chart-sub">
            {focusDur ? (
              <>
                <b>{fmtDate(focusDur.startedAt)}</b> · {focusDur.title} · {plural(focusDur.sets, 'set')}
              </>
            ) : (
              <>Average · longest {fmtDur(longest)}</>
            )}
          </div>
        </div>
        <LineChart points={durPts} height={160} baseline={avgDur / 60_000} onScrub={setDScrub} formatY={(m) => fmtDur(m * 60_000)} />
      </div>

      <div className="card stat-card">
        <div className="card-label">
          Muscles <span className="muted">{plural(totalSplit, 'set')}</span>
        </div>
        <div className="hbars">
          {split.map(([m, n], i) => (
            <div key={m} className="hbar">
              <div className="hbar-top">
                <span>{MUSCLE_LABEL[m]}</span>
                <span className="hbar-v">
                  {fmtNum(n)} <span className="muted">· {Math.round((n / totalSplit) * 100)}%</span>
                </span>
              </div>
              <div className="hbar-track">
                <div className={`hbar-fill${i === 0 ? ' top' : ''}`} style={{ width: `${(n / maxSplit) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card stat-card">
        <div className="card-label">Training days</div>
        <div className="chart-head">
          <div className="mid">{WEEKDAYS_PLURAL[topDay]}</div>
          <div className="chart-sub">
            Most common day
            {v.medianStart !== null && (
              <>
                {' '}
                · you usually start around <b>{clock(v.medianStart)}</b>
              </>
            )}
          </div>
        </div>
        <BarChart
          bars={v.wd.map((n, i) => ({ key: i, value: n, label: WEEKDAYS_SHORT[i] }))}
          height={120}
          current={topDay}
          showY={false}
          maxBar={26}
        />
      </div>

      {bw.length > 0 && (
        <button className="card stat-card" onClick={() => nav.push({ name: 'bodyweight' })}>
          <div className="card-label">
            Body weight <Icon name="chevronRight" size={16} className="dim" />
          </div>
          <div className="chart-head">
            <div className="big">
              <Num value={fmtBw(bw[bw.length - 1].kg)} unit="kg" />
            </div>
            <div className="chart-sub">
              {bw.length > 1 ? (
                <>
                  <Delta value={bw[bw.length - 1].kg - bw[0].kg} unit=" kg" neutral /> since {fmtDayMonth(parseDayKey(bw[0].date))}
                </>
              ) : (
                'One entry so far'
              )}
            </div>
          </div>
          <LineChart points={bw.map((b) => ({ x: parseDayKey(b.date), y: b.kg }))} height={130} formatY={(x) => fmtNum(x, 1)} smooth={0.3} />
        </button>
      )}
    </div>
  );
}

function TotalCard({ label, value, delta, sub }: { label: string; value: React.ReactNode; delta: number | null; sub: string }) {
  return (
    <div className="card total">
      <div className="card-label">
        {label}
        {delta !== null && <Delta value={delta} unit="%" decimals={0} />}
      </div>
      <div className="big card-value">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
