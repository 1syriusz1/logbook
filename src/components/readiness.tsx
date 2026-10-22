/* Readiness on the home screen: a number and a vertical "charging" bar. */
import { useEffect, useMemo, useState } from 'react';
import { nav } from '../lib/nav';
import { useData, useReadiness } from '../lib/derived';
import { LEVELS, suggestWorkout, type Readiness } from '../lib/readiness';
import { RECOVERY_TYPES, useHealth } from '../lib/health';

/** Ten segments filling from the bottom, dim to bright, like a charge indicator. */
export function ReadinessBar({ score, height = 132, width = 30, segments = 10 }: { score: number; height?: number; width?: number; segments?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    // fill up after the first paint so the bar charges in
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(score)));
    return () => cancelAnimationFrame(id);
  }, [score]);
  const per = 100 / segments;
  return (
    <div className="rbar" style={{ height, width }} role="meter" aria-label="Readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
      {Array.from({ length: segments }, (_, i) => {
        const fill = Math.max(0, Math.min(1, (shown - i * per) / per));
        return (
          <span key={i} className="rbar-seg">
            <i style={{ height: `${fill * 100}%`, opacity: 0.42 + 0.58 * ((i + 1) / segments), transitionDelay: `${i * 40}ms` }} />
          </span>
        );
      })}
    </div>
  );
}

/** Short line of what the score is made of: sleep, HRV, resting heart rate. */
export function vitalsLine(r: Readiness): string {
  const get = (k: string) => r.components.find((c) => c.key === k)?.value;
  const parts = [get('sleep') && `Slept ${get('sleep')}`, get('hrv') && `HRV ${get('hrv')}`, get('rhr') && `RHR ${get('rhr')!.replace(' bpm', '')}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'From your training load';
}

export function ReadinessCard() {
  const data = useData();
  const health = useHealth();
  const { input, today } = useReadiness();
  const suggestion = useMemo(
    () => (today && !today.trainedToday ? suggestWorkout(input.workouts, input.ex, today.muscles, input.now) : null),
    [today, input],
  );
  const open = () => nav.push({ name: 'readiness' });

  if (!today) {
    return (
      <button className="card span2 ready-card" onClick={open}>
        <div className="ready-main">
          <div className="card-label">Readiness</div>
          <div className="ready-empty">
            How ready you are to train, every morning. It fills in as you log workouts
            {health.state === 'unsupported' ? '' : ' and connect your band in Settings'}.
          </div>
        </div>
        <ReadinessBar score={0} height={112} width={26} />
      </button>
    );
  }

  const missingRecovery = health.state === 'on' && health.granted.size > 0 && RECOVERY_TYPES.some((t) => !health.granted.has(t));
  const fresh = today.muscles.filter((m) => m.lastDays !== null && m.freshness >= 80).map((m) => m.label);
  const sugTitle = suggestion ? data.byId.get(suggestion.id)?.title : null;
  const level = LEVELS[today.level];

  return (
    <button className={`card span2 ready-card lvl-${today.level}`} onClick={open} aria-label={`Readiness ${today.score}, ${level.title}`}>
      <div className="ready-main">
        <div className="card-label">
          Readiness
          <span className="muted">{today.lastNight ? 'this morning' : health.state === 'on' ? 'last night not synced yet' : 'from your training'}</span>
        </div>
        <div className="ready-score">
          <span className="ready-num">{today.score}</span>
          <span className="ready-level">{level.title}</span>
        </div>
        <div className="ready-sub">{vitalsLine(today)}</div>
        <div className="ready-chips">
          {today.flags.length > 0 && <span className="ready-chip warn">{today.flags.length === 1 ? 'Warning' : `${today.flags.length} warnings`}</span>}
          {today.trainedToday ? (
            <span className="ready-chip">Trained today</span>
          ) : sugTitle && today.level !== 'rest' ? (
            <span className="ready-chip">
              Fits today: <b>{sugTitle}</b>
            </span>
          ) : fresh.length ? (
            <span className="ready-chip">Fresh: {fresh.slice(0, 3).join(', ')}</span>
          ) : null}
          {missingRecovery && <span className="ready-chip">Allow sleep & HRV for a full score</span>}
          {!missingRecovery && today.components.length === 1 && health.state === 'off' && <span className="ready-chip">Connect your band for sleep & HRV</span>}
        </div>
      </div>
      <ReadinessBar score={today.score} />
    </button>
  );
}
