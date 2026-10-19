import type { Exercise, SetLog } from './types';
import type { PRKind } from './stats';
import { fmtKg } from './format';

/** "80 × 8", "BW × 12", "BW+10 × 8" */
export function setText(s: Pick<SetLog, 'kg' | 'reps'>, ex?: Pick<Exercise, 'kind'>): string {
  if (ex?.kind === 'bodyweight') return s.kg > 0 ? `BW+${fmtKg(s.kg)} × ${s.reps}` : `BW × ${s.reps}`;
  return `${fmtKg(s.kg)} × ${s.reps}`;
}

export function prLabel(kinds: PRKind[]): string {
  if (kinds.includes('weight')) return 'Heaviest weight';
  if (kinds.includes('e1rm')) return 'Best estimated 1RM';
  return 'Most reps';
}
