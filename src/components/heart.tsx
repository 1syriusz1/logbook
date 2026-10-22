/* Heart rate and calories for one workout, from Health Connect. */
import { useMemo, useState } from 'react';
import type { Workout } from '../lib/types';
import type { ExMap } from '../lib/stats';
import { entryHeart, exerciseBlocks, fmtElapsed, SETTLE_MS, type HeartView } from '../lib/heart';
import { syncHeart, useHealth } from '../lib/health';
import { useData } from '../lib/derived';
import { fmtNum } from '../lib/format';
import { nav } from '../lib/nav';
import { Button } from './ui';
import { HeartChart, ZoneBar, zoneTone, type HeartBand } from './charts';

const ZONE_NAMES = ['<Z1', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

const mins = (sec: number) => (sec >= 60 ? `${Math.round(sec / 60)}m` : `${Math.round(sec)}s`);

export function HeartCard({ w, view, ex, hrMax }: { w: Workout; view: HeartView; ex: ExMap; hrMax: number }) {
  const [focus, setFocus] = useState<number | null>(null);
  const health = useHealth();
  const busy = health.busy.has(w.id);
  // Data may still be on its way: offer a re-read while it is incomplete.
  const canRecheck = health.state === 'on' && (view.cover < 0.9 || view.kcal == null) && w.endedAt !== null && Date.now() < w.endedAt + SETTLE_MS;
  const t = useMemo(() => {
    const blocks = exerciseBlocks(w);
    // Number exercises in the order they were first done.
    const numberOf = new Map<number, number>();
    for (const b of blocks) if (!numberOf.has(b.entry)) numberOf.set(b.entry, numberOf.size + 1);
    const sec = (ms: number) => (ms - w.startedAt) / 1000;
    const bands: HeartBand[] = blocks.map((b) => ({ start: sec(b.start), end: sec(b.end), entry: b.entry, n: numberOf.get(b.entry)! }));
    const sets = blocks.flatMap((b) => b.sets.map(sec));
    const per = entryHeart(blocks, view.pts, w.startedAt);
    const order = [...numberOf.keys()];
    return { bands, sets, per, order, numberOf };
  }, [w, view]);

  const duration = ((w.endedAt ?? w.startedAt) - w.startedAt) / 1000;
  const nameOf = (entry: number) => ex.get(w.entries[entry]?.exerciseId ?? '')?.name ?? 'Exercise';
  const labelAt = (sec: number) => {
    const b = t.bands.find((x) => sec > x.start && sec <= x.end) ?? (t.bands[0] && sec <= t.bands[0].start ? t.bands[0] : null);
    return b ? nameOf(b.entry) : t.bands.length ? 'After the last set' : '';
  };
  const zonesShown = view.zones.map((s, z) => ({ s, z })).filter((x) => x.s >= 30);

  return (
    <div className="card detail-card heart-card">
      <div className="card-label">
        Heart rate
        {view.src && <span className="muted">{view.src}</span>}
      </div>

      <div className="hr-stats">
        <HrStat value={fmtNum(view.avg)} unit="bpm" label="Average" />
        <HrStat value={fmtNum(view.max)} unit="bpm" label="Peak" />
        <HrStat value={view.kcal != null ? fmtNum(view.kcal) : '–'} unit={view.kcal != null ? 'kcal' : ''} label="Calories" />
        <HrStat value={fmtNum(view.load)} label="Load" />
      </div>

      <HeartChart
        pts={view.pts}
        duration={duration}
        bands={t.bands}
        sets={t.sets}
        focus={focus}
        tooltip={(i) => {
          const [sec, bpm] = view.pts[i];
          const where = labelAt(sec);
          return { value: `${bpm} bpm`, label: `${fmtElapsed(sec)}${where ? ` · ${where}` : ''}` };
        }}
      />

      {t.order.length > 0 && (
        <div className="hr-ex" role="list">
          {t.order.map((entry) => {
            const s = t.per.get(entry);
            const on = focus === entry;
            return (
              <button key={entry} role="listitem" className={`hr-ex-row${on ? ' on' : ''}`} onClick={() => setFocus(on ? null : entry)} aria-pressed={on}>
                <span className="hr-n">{t.numberOf.get(entry)}</span>
                <span className="hr-ex-name">{nameOf(entry)}</span>
                {s ? (
                  <span className="hr-ex-v">
                    {s.avg}
                    <span className="u"> avg</span> · {s.peak}
                    <span className="u"> peak</span>
                  </span>
                ) : (
                  <span className="hr-ex-v u">no data</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="hr-zones">
        <div className="hr-zones-head">
          <span>Time in zones</span>
          <button className="hr-max" onClick={() => nav.push({ name: 'settings' })}>
            max {hrMax} bpm
          </button>
        </div>
        <ZoneBar zones={view.zones} />
        <div className="zone-legend">
          {zonesShown.map(({ s, z }) => (
            <span key={z} className="zone-item">
              <i className={zoneTone(z)} />
              {ZONE_NAMES[z]} <b>{mins(s)}</b>
            </span>
          ))}
        </div>
      </div>

      <p className="hr-note">
        Load counts minutes in each zone times the zone number (Z1 = 1 … Z5 = 5).
        {view.cover < 0.6 ? ` The band recorded about ${Math.round(view.cover * 100)}% of this workout.` : ''}
        {canRecheck && (
          <>
            {' '}
            <button className="hr-recheck" disabled={busy} onClick={() => syncHeart([w.id])}>
              {busy ? 'Checking…' : 'Check again'}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function HrStat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="hr-stat">
      <div className="hr-stat-v">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="hr-stat-l">{label}</div>
    </div>
  );
}

/** Shown while a workout has no heart rate yet but Health Connect is connected. */
export function HeartPending({ w }: { w: Workout }) {
  const h = useHealth();
  const data = useData();
  if (h.state !== 'on' || w.endedAt === null) return null;
  const hs = data.db.settings.health;
  const busy = h.busy.has(w.id);
  const tooOld = !hs.history && hs.since !== null && w.startedAt < hs.since - 30 * 86_400_000;
  const settled = Date.now() > w.endedAt + SETTLE_MS;
  const text = busy
    ? 'Reading heart rate from Health Connect…'
    : tooOld
      ? 'Health Connect only shares data from 30 days before you connected, so this workout stays without heart rate.'
      : !w.hr
        ? 'Heart rate hasn’t been read for this workout yet.'
        : settled
          ? 'No heart rate was recorded during this workout.'
          : 'No heart rate yet. Google Health can take a while to pass it on: open Google Health to sync your band, then check again.';
  return (
    <div className="card detail-card hr-empty">
      <div className="card-label">Heart rate</div>
      <p className="hr-empty-text">{text}</p>
      {!tooOld && (
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => syncHeart([w.id])}>
          {busy ? 'Checking…' : 'Check again'}
        </Button>
      )}
    </div>
  );
}
