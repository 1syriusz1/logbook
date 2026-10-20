import type { Exercise, SetLog } from './types';
import type { PRKind } from './stats';
import { fmtKg } from './format';

/** "80 × 8", "BW × 12", "BW+10 × 8" */
export function setText(s: Pick<SetLog, 'kg' | 'reps'>, ex?: Pick<Exercise, 'kind'>): string {
  if (ex?.kind === 'bodyweight') return s.kg > 0 ? `BW+${fmtKg(s.kg)} × ${s.reps}` : `BW × ${s.reps}`;
  return `${fmtKg(s.kg)} × ${s.reps}`;
}

export function prLabel(kinds: PRKind[], s?: Pick<SetLog, 'kg'>, ex?: Pick<Exercise, 'kind'>): string {
  const bw = ex?.kind === 'bodyweight';
  if (kinds.includes('weight')) return bw ? 'Heaviest added weight' : 'Heaviest weight';
  if (kinds.includes('e1rm')) return 'Best estimated 1RM';
  if (bw && s && s.kg > 0) return `Most reps at +${fmtKg(s.kg)} kg`;
  return 'Most reps';
}
