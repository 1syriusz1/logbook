import { useMemo, useState } from 'react';
import type { Layer } from '../lib/nav';
import { useData, useReadiness } from '../lib/derived';
import { LEVELS, levelOfScore, readinessHistory, suggestWorkout, type ComponentKey, type Tuning } from '../lib/readiness';
import { connectHealth, RECOVERY_TYPES, syncHeart, useHealth } from '../lib/health';
import { fmtDate, fmtDateLong, parseDayKey, plural } from '../lib/format';
import { startRepeat } from './History';
import { Button, Empty } from '../components/ui';
import { Page } from '../components/layers';
import { LineChart } from '../components/charts';
import { ReadinessBar } from '../components/readiness';

const COMPONENT_HELP: Record<ComponentKey, string> = {
  hrv: 'Last night and the 7-day trend against your normal range',
  rhr: 'Against your usual; +5 bpm or more means strain',
  sleep: 'Hours against your need, sleep debt, deep + REM, regularity',
  load: 'Your last week against your usual training, gym and other sports',
};

const MISSING_TEXT: Record<ComponentKey, string> = {
  hrv: 'HRV',
  rhr: 'Resting heart rate',
  sleep: 'Sleep',
  load: 'Training load',
};

const tone = (score: number) => (score >= 75 ? 'hi' : score >= 50 ? 'mid' : 'lo');

export function ReadinessPage({ layer }: { layer: Layer }) {
  const data = useData();
  const health = useHealth();
  const { input, today } = useReadiness();
  const history = useMemo(() => readinessHistory(input, 30), [input]);
  const suggestion = useMemo(
    () => (today && !today.trainedToday && today.level !== 'rest' ? suggestWorkout(input.workouts, input.ex, today.muscles, input.now) : null),
    [today, input],
  );
  const [hScrub, setHScrub] = useState<number | null>(null);

  if (!today) {
    return (
      <Page layer={layer} title="Readiness">
        <div className="page-hero">
          <h1 className="title-xl">Readiness</h1>
        </div>
        <Empty title="Nothing to go on yet">
          Log a few workouts, or connect your band in Settings so Logbook can read your sleep, HRV and resting heart rate.
        </Empty>
      </Page>
    );
  }

  const level = LEVELS[today.level];
  const missingRecovery = health.state === 'on' && health.granted.size > 0 && RECOVERY_TYPES.some((t) => !health.granted.has(t));
  const sugSummary = suggestion ? data.byId.get(suggestion.id) : null;
  const focus = hScrub !== null ? history[hScrub] : null;
  const muscles = [...today.muscles].sort((a, b) => (a.lastDays === null ? 1 : 0) - (b.lastDays === null ? 1 : 0) || a.freshness - b.freshness);

  return (
    <Page layer={layer} title="Readiness">
      <div className="page-hero ready-hero">
        <div className="ready-hero-text">
          <div className="eyebrow">{fmtDateLong(parseDayKey(today.day))}</div>
          <div className="ready-big">{today.score}</div>
          <h1 className="title-l">{level.title}</h1>
        </div>
        <ReadinessBar score={today.score} height={168} width={40} />
      </div>
      <p className="ready-advice">{today.trainedToday ? 'You already trained today. This was the morning’s call: ' + level.advice.charAt(0).toLowerCase() + level.advice.slice(1) : level.advice}</p>

      {today.flags.map((f) => (
        <div key={f} className="ready-flag">
          {f}
        </div>
      ))}
      {today.notes.map((n) => (
        <p key={n} className="ready-note">
          {n}
        </p>
      ))}
      {!today.lastNight && health.state === 'on' && (
        <div className="ready-note-row">
          <span>Last night’s sleep isn’t in yet. Open Google Health to sync your band, then refresh.</span>
          <Button size="sm" icon="refresh" disabled={health.syncing} onClick={() => syncHeart()}>
            {health.syncing ? 'Syncing…' : 'Refresh'}
          </Button>
        </div>
      )}

      {suggestion && sugSummary && (
        <div className="card ready-suggest">
          <div className="row-main">
            <div className="card-label">Fits today</div>
            <div className="ready-suggest-title">{sugSummary.title}</div>
            <div className="sub">
              Muscles {suggestion.freshness}% fresh · last done {suggestion.daysAgo === 1 ? 'yesterday' : `${suggestion.daysAgo} days ago`}
            </div>
          </div>
          <Button variant="primary" icon="repeat" onClick={() => startRepeat(suggestion.id)}>
            Start
          </Button>
        </div>
      )}

      <div className="list-label">What it’s based on</div>
      <div className="card ready-comps">
        {today.components.map((c) => (
          <div key={c.key} className="rc">
            <div className="rc-top">
              <span className="rc-name">{c.label}</span>
              <span className="rc-v">{c.value}</span>
            </div>
            <div className="rc-bar">
              <i className={tone(c.score)} style={{ width: `${c.score}%` }} />
            </div>
            <div className="rc-sub">
              <span>{c.calibrating ? `Learning your normal · ${c.calibrating}` : c.detail}</span>
              <span className="rc-w">{Math.round(c.weight * 100)}%</span>
            </div>
          </div>
        ))}
        {today.missing.length > 0 && (
          <div className="rc-missing">
            Not available: {today.missing.map((k) => MISSING_TEXT[k]).join(', ')}.
            {missingRecovery ? (
              <Button size="sm" variant="secondary" onClick={() => connectHealth()}>
                Allow in Health Connect
              </Button>
            ) : health.state === 'off' || health.state === 'unsupported' ? (
              <span> Connect your band in Settings.</span>
            ) : null}
          </div>
        )}
      </div>
      <div className="ready-legend">The bars show each signal’s score; the percentage is its share of today’s number.</div>

      {today.load.parts.length > 0 && (
        <div className="ready-yesterday">
          Yesterday’s load: {today.load.parts.map((p) => `${p.label} ${p.estimated ? '≈' : ''}${p.load}`).join(' · ')}
        </div>
      )}

      <div className="list-label">Muscles</div>
      <div className="card ready-muscles">
        {muscles.map((m) => (
          <div key={m.muscle} className="mf-row">
            <span className="mf-name">{m.label}</span>
            <span className="mf-bar">
              <i className={tone(m.freshness)} style={{ width: `${m.freshness}%` }} />
            </span>
            <span className="mf-v">{m.lastDays === null ? '–' : `${m.freshness}%`}</span>
            <span className="mf-when">{m.lastDays === null ? 'not lately' : m.lastDays === 0 ? 'today' : m.lastDays === 1 ? 'yesterday' : `${m.lastDays}d ago`}</span>
          </div>
        ))}
        <p className="mf-note">How much of the fatigue from your logged sets has worn off. About 80% is ready for hard work.</p>
      </div>

      {history.length >= 3 && (
        <>
          <div className="list-label">Last 30 days</div>
          <div className="card stat-card">
            <div className="chart-head">
              <div className="big">{focus ? focus.score : Math.round(history.reduce((a, h) => a + h.score, 0) / history.length)}</div>
              <div className="chart-sub">{focus ? <b>{fmtDate(parseDayKey(focus.day))}</b> : 'Average · dashed line'}</div>
            </div>
            <LineChart
              points={history.map((h) => ({ x: parseDayKey(h.day), y: h.score }))}
              height={150}
              zero
              dots="all"
              baseline={history.reduce((a, h) => a + h.score, 0) / history.length}
              onScrub={setHScrub}
              tooltip={(i) => ({ value: `${history[i].score} · ${LEVELS[levelOfScore(history[i].score)].title}`, label: fmtDate(parseDayKey(history[i].day)) })}
            />
          </div>
        </>
      )}

      <div className="list-label">How it works</div>
      <div className="card ready-how">
        <p>
          Each morning Logbook compares last night with <b>your own normal</b>: the median and usual spread of the last 60 days, so
          one odd night doesn’t move it.
        </p>
        {COMPONENTS_TEXT.map(([label, t]) => (
          <p key={label}>
            <b>{label}.</b> {t}
          </p>
        ))}
        <p>
          <b>Muscles.</b> Wearables can’t see what you lifted; Logbook can. Fatigue from each set fades with a half-life of about a day
          (longer for legs), measured against your usual dose for that muscle.
        </p>
        <p>
          <b>Learns from you.</b>{' '}
          {today.tuning ? tuningText(today.tuning) : 'After about 20 workouts with band data, signals that track how your lifts go get more weight (up to +40%).'}
        </p>
        <p className="muted">80+ go heavy · 60–79 normal session · 40–59 keep it light · under 40 recover. Not medical advice.</p>
      </div>
    </Page>
  );
}

function tuningText(t: Tuning): string {
  const best = (Object.entries(t.rho) as [ComponentKey, number][]).sort((a, b) => b[1] - a[1])[0];
  const lead = best && best[1] >= 0.1 ? ` So far your lifts follow ${MISSING_TEXT[best[0]].toLowerCase()} most closely.` : ' No signal stands out yet.';
  return `Tuned on ${plural(t.n, 'workout')}: signals that tracked how your lifts went count a bit more.${lead}`;
}

const COMPONENTS_TEXT: [string, string][] = [
  ['HRV', `${COMPONENT_HELP.hrv}. The most sensitive sign of how recovered your nervous system is (HRV-guided training, Kiviniemi, Plews).`],
  ['Resting heart rate', `${COMPONENT_HELP.rhr}, or the start of an illness.`],
  ['Sleep', `${COMPONENT_HELP.sleep}. You need 8 h, up to 30 min more after a hard day. Short sleep hurts volume more than max strength.`],
  ['Training load', 'Every session in heart-rate zone minutes (estimated from sets or duration when there is no heart rate). A week much harder than usual lowers the score; a lighter one raises it.'],
  ['Breathing rate', 'Only an alarm: a clear rise against your normal often comes before a cold, and caps the score.'],
];
