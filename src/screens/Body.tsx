import { useMemo, useState } from 'react';
import { nav, toast, type Layer } from '../lib/nav';
import { useData } from '../lib/derived';
import { deleteBodyWeight, getDB, logBodyWeight, replaceDB } from '../lib/store';
import { RANGES, rangeStart, sortedBodyweight, type RangeKey } from '../lib/stats';
import { dayKey, fmtBw, fmtDate, fmtDayMonth, fmtNum, parseDayKey } from '../lib/format';
import { haptic } from '../lib/platform';
import { Button, Delta, Empty, IconButton, Num, Segmented, Stepper } from '../components/ui';
import { Page, Sheet } from '../components/layers';
import { LineChart } from '../components/charts';

export function BodyWeightPage({ layer }: { layer: Layer }) {
  const data = useData();
  const logs = useMemo(() => sortedBodyweight(data.db.bodyweight), [data.db.bodyweight]);
  const [range, setRange] = useState<RangeKey>('3m');
  const [scrub, setScrub] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const first = logs[0] ? parseDayKey(logs[0].date) : null;
  const from = rangeStart(range, first);
  const shown = logs.filter((b) => parseDayKey(b.date) >= from);
  const focus = scrub !== null ? shown[scrub] : logs[logs.length - 1];
  const base = shown[0];

  return (
    <Page layer={layer} title="Body weight" actions={<IconButton icon="plus" label="Log weight" onClick={() => nav.push({ name: 'bwLog' })} />}>
      <div className="page-hero">
        <div className="eyebrow">Body weight</div>
        {focus ? (
          <>
            <h1 className="huge">
              <Num value={fmtBw(focus.kg)} unit="kg" />
            </h1>
            <div className="sub">
              {scrub !== null ? (
                <b>{fmtDate(parseDayKey(focus.date))}</b>
              ) : base && shown.length > 1 ? (
                <>
                  <Delta value={focus.kg - base.kg} unit=" kg" neutral /> since {fmtDayMonth(parseDayKey(base.date))}
                </>
              ) : (
                <>Logged {fmtDate(parseDayKey(focus.date))}</>
              )}
            </div>
          </>
        ) : (
          <h1 className="title-xl">No entries yet</h1>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="card">
          <Empty
            title="Weigh in once or twice a week"
            action={
              <Button variant="primary" icon="plus" onClick={() => nav.push({ name: 'bwLog' })}>
                Log weight
              </Button>
            }
          >
            Mornings work best. The trend line shows up after the second entry.
          </Empty>
        </div>
      ) : (
        <>
          <div className="card chart-card">
            {shown.length ? (
              <LineChart
                points={shown.map((b) => ({ x: parseDayKey(b.date), y: b.kg }))}
                height={190}
                onScrub={setScrub}
                formatY={(v) => fmtNum(v, 1)}
                smooth={0.3}
              />
            ) : (
              <div className="chart-empty">No entries in this range</div>
            )}
            <Segmented label="Range" size="sm" value={range} onChange={(r) => { setRange(r); setScrub(null); }} options={RANGES} />
          </div>

          <div className="section-head">
            <h2>Entries</h2>
          </div>
          <div className="group">
            {[...logs].reverse().slice(0, all ? undefined : 40).map((b, i, arr) => {
              const prev = arr[i + 1];
              return (
                <button key={b.id} className="group-row" onClick={() => nav.push({ name: 'bwLog', date: b.date })}>
                  <div className="row-main">
                    <div className="row-title">{fmtDate(parseDayKey(b.date))}</div>
                  </div>
                  {prev && <Delta value={b.kg - prev.kg} unit=" kg" neutral />}
                  <span className="bw-v">
                    <Num value={fmtBw(b.kg)} unit="kg" />
                  </span>
                </button>
              );
            })}
          </div>
          {!all && logs.length > 40 && (
            <button className="create-row" onClick={() => setAll(true)}>
              Show all {logs.length} entries
            </button>
          )}
        </>
      )}
    </Page>
  );
}

export function BodyWeightSheet({ layer, date }: { layer: Layer; date?: string }) {
  const data = useData();
  const logs = sortedBodyweight(data.db.bodyweight);
  const existing = date ? logs.find((b) => b.date === date) : undefined;
  const [day, setDay] = useState(date ?? dayKey(Date.now()));
  const [kg, setKg] = useState(existing?.kg ?? logs[logs.length - 1]?.kg ?? 80);

  const save = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    logBodyWeight(day, kg);
    haptic.light();
    nav.back();
  };
  const remove = () => {
    if (!existing) return;
    const snapshot = getDB();
    deleteBodyWeight(existing.id);
    nav.back();
    toast.show('Entry deleted', { label: 'Undo', run: () => replaceDB(snapshot) });
  };

  return (
    <Sheet
      layer={layer}
      title={existing ? 'Edit entry' : 'Log body weight'}
      actions={
        <>
          <Button variant="primary" size="lg" block onClick={save}>
            Save
          </Button>
          {existing && (
            <Button variant="ghost" block icon="trash" onClick={remove}>
              Delete entry
            </Button>
          )}
        </>
      }
    >
      <div className="form">
        <Stepper id="bw-kg" value={kg} onChange={setKg} step={0.1} min={20} max={400} unit="kg" />
        <div className="field">
          <label className="field-label" htmlFor="bw-day">
            Date
          </label>
          <input id="bw-day" type="date" className="text-input" value={day} max={dayKey(Date.now())} onChange={(e) => setDay(e.target.value)} />
        </div>
      </div>
    </Sheet>
  );
}
