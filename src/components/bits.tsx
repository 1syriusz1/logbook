import type { ReactNode } from 'react';
import type { Exercise, Muscle, SetLog } from '../lib/types';
import { MUSCLE_LABEL } from '../lib/exercises';
import { durParts, fmtKg, fmtNum } from '../lib/format';
import { SplitBar, splitTone } from './charts';

/** 1h 12m with quiet units */
export function DurNum({ ms }: { ms: number }) {
  return (
    <span className="num">
      {durParts(ms).map(([v, u], i) => (
        <span key={u}>
          {i > 0 && ' '}
          {v}
          <span className="unit">{u}</span>
        </span>
      ))}
    </span>
  );
}

export function StatRow({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="stat-row">
      {items.map((i) => (
        <div className="stat" key={i.label}>
          <div className="stat-v">{i.value}</div>
          <div className="stat-l">{i.label}</div>
        </div>
      ))}
    </div>
  );
}

export function SetValue({ s, ex }: { s: Pick<SetLog, 'kg' | 'reps'>; ex?: Pick<Exercise, 'kind'> }) {
  if (ex?.kind === 'bodyweight') {
    return (
      <span className="set-val">
        <b>BW</b>
        {s.kg > 0 && (
          <>
            <span className="x">+</span>
            <b>{fmtKg(s.kg)}</b>
            <span className="u">kg</span>
          </>
        )}
        <span className="x">×</span>
        <b>{s.reps}</b>
      </span>
    );
  }
  return (
    <span className="set-val">
      <b>{fmtKg(s.kg)}</b>
      <span className="u">kg</span>
      <span className="x">×</span>
      <b>{s.reps}</b>
    </span>
  );
}

export function MuscleSplit({ muscles, total }: { muscles: [Muscle, number][]; total?: number }) {
  const sum = total ?? muscles.reduce((a, [, n]) => a + n, 0);
  if (!muscles.length) return null;
  return (
    <div className="msplit">
      <SplitBar parts={muscles.map(([m, n]) => ({ key: m, value: n }))} />
      <div className="msplit-legend">
        {muscles.map(([m, n], i) => (
          <span key={m} className="msplit-item">
            <i className={splitTone(i)} />
            {MUSCLE_LABEL[m]}
            <span className="msplit-n">
              {fmtNum(n)}
              {sum ? ` · ${Math.round((n / sum) * 100)}%` : ''}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
