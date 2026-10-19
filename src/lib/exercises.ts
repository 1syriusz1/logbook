import type { Equipment, Exercise, ExerciseKind, Muscle } from './types';

export const MUSCLES: { id: Muscle; label: string }[] = [
  { id: 'chest', label: 'Chest' },
  { id: 'back', label: 'Back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'biceps', label: 'Biceps' },
  { id: 'triceps', label: 'Triceps' },
  { id: 'legs', label: 'Legs' },
  { id: 'core', label: 'Core' },
];

export const MUSCLE_LABEL: Record<Muscle, string> = Object.fromEntries(
  MUSCLES.map((m) => [m.id, m.label]),
) as Record<Muscle, string>;

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  ezbar: 'EZ bar',
  smith: 'Smith machine',
  kettlebell: 'Kettlebell',
  other: 'Other',
};

type Def = [id: string, name: string, muscle: Muscle, equipment: Equipment, kind?: ExerciseKind];

const DEFS: Def[] = [
  // Chest
  ['bench-press', 'Bench Press', 'chest', 'barbell'],
  ['incline-bench-press', 'Incline Bench Press', 'chest', 'barbell'],
  ['decline-bench-press', 'Decline Bench Press', 'chest', 'barbell'],
  ['db-bench-press', 'Dumbbell Bench Press', 'chest', 'dumbbell'],
  ['incline-db-press', 'Incline Dumbbell Press', 'chest', 'dumbbell'],
  ['db-fly', 'Dumbbell Fly', 'chest', 'dumbbell'],
  ['cable-fly', 'Cable Fly', 'chest', 'cable'],
  ['pec-deck', 'Pec Deck', 'chest', 'machine'],
  ['chest-press', 'Chest Press', 'chest', 'machine'],
  ['smith-bench-press', 'Smith Machine Bench Press', 'chest', 'smith'],
  ['push-up', 'Push-up', 'chest', 'bodyweight', 'bodyweight'],
  ['chest-dip', 'Chest Dip', 'chest', 'bodyweight', 'bodyweight'],
  // Back
  ['deadlift', 'Deadlift', 'back', 'barbell'],
  ['pull-up', 'Pull-up', 'back', 'bodyweight', 'bodyweight'],
  ['chin-up', 'Chin-up', 'back', 'bodyweight', 'bodyweight'],
  ['lat-pulldown', 'Lat Pulldown', 'back', 'cable'],
  ['close-grip-pulldown', 'Close-Grip Pulldown', 'back', 'cable'],
  ['barbell-row', 'Barbell Row', 'back', 'barbell'],
  ['db-row', 'Dumbbell Row', 'back', 'dumbbell'],
  ['seated-cable-row', 'Seated Cable Row', 'back', 'cable'],
  ['t-bar-row', 'T-Bar Row', 'back', 'barbell'],
  ['chest-supported-row', 'Chest-Supported Row', 'back', 'machine'],
  ['straight-arm-pulldown', 'Straight-Arm Pulldown', 'back', 'cable'],
  ['shrug', 'Shrug', 'back', 'dumbbell'],
  ['back-extension', 'Back Extension', 'back', 'bodyweight', 'bodyweight'],
  ['rack-pull', 'Rack Pull', 'back', 'barbell'],
  // Shoulders
  ['overhead-press', 'Overhead Press', 'shoulders', 'barbell'],
  ['seated-db-press', 'Seated Dumbbell Press', 'shoulders', 'dumbbell'],
  ['arnold-press', 'Arnold Press', 'shoulders', 'dumbbell'],
  ['shoulder-press-machine', 'Shoulder Press Machine', 'shoulders', 'machine'],
  ['lateral-raise', 'Lateral Raise', 'shoulders', 'dumbbell'],
  ['cable-lateral-raise', 'Cable Lateral Raise', 'shoulders', 'cable'],
  ['front-raise', 'Front Raise', 'shoulders', 'dumbbell'],
  ['rear-delt-fly', 'Rear Delt Fly', 'shoulders', 'dumbbell'],
  ['reverse-pec-deck', 'Reverse Pec Deck', 'shoulders', 'machine'],
  ['face-pull', 'Face Pull', 'shoulders', 'cable'],
  ['upright-row', 'Upright Row', 'shoulders', 'barbell'],
  // Biceps
  ['barbell-curl', 'Barbell Curl', 'biceps', 'barbell'],
  ['ez-bar-curl', 'EZ-Bar Curl', 'biceps', 'ezbar'],
  ['db-curl', 'Dumbbell Curl', 'biceps', 'dumbbell'],
  ['hammer-curl', 'Hammer Curl', 'biceps', 'dumbbell'],
  ['incline-db-curl', 'Incline Dumbbell Curl', 'biceps', 'dumbbell'],
  ['preacher-curl', 'Preacher Curl', 'biceps', 'ezbar'],
  ['cable-curl', 'Cable Curl', 'biceps', 'cable'],
  ['concentration-curl', 'Concentration Curl', 'biceps', 'dumbbell'],
  // Triceps
  ['triceps-pushdown', 'Triceps Pushdown', 'triceps', 'cable'],
  ['rope-pushdown', 'Rope Pushdown', 'triceps', 'cable'],
  ['overhead-triceps-ext', 'Overhead Triceps Extension', 'triceps', 'cable'],
  ['skull-crusher', 'Skull Crusher', 'triceps', 'ezbar'],
  ['close-grip-bench', 'Close-Grip Bench Press', 'triceps', 'barbell'],
  ['triceps-dip', 'Triceps Dip', 'triceps', 'bodyweight', 'bodyweight'],
  ['db-kickback', 'Dumbbell Kickback', 'triceps', 'dumbbell'],
  // Legs
  ['squat', 'Squat', 'legs', 'barbell'],
  ['front-squat', 'Front Squat', 'legs', 'barbell'],
  ['hack-squat', 'Hack Squat', 'legs', 'machine'],
  ['leg-press', 'Leg Press', 'legs', 'machine'],
  ['romanian-deadlift', 'Romanian Deadlift', 'legs', 'barbell'],
  ['bulgarian-split-squat', 'Bulgarian Split Squat', 'legs', 'dumbbell'],
  ['walking-lunge', 'Walking Lunge', 'legs', 'dumbbell'],
  ['goblet-squat', 'Goblet Squat', 'legs', 'dumbbell'],
  ['hip-thrust', 'Hip Thrust', 'legs', 'barbell'],
  ['leg-extension', 'Leg Extension', 'legs', 'machine'],
  ['lying-leg-curl', 'Lying Leg Curl', 'legs', 'machine'],
  ['seated-leg-curl', 'Seated Leg Curl', 'legs', 'machine'],
  ['hip-abduction', 'Hip Abduction', 'legs', 'machine'],
  ['hip-adduction', 'Hip Adduction', 'legs', 'machine'],
  ['standing-calf-raise', 'Standing Calf Raise', 'legs', 'machine'],
  ['seated-calf-raise', 'Seated Calf Raise', 'legs', 'machine'],
  // Core
  ['hanging-leg-raise', 'Hanging Leg Raise', 'core', 'bodyweight', 'bodyweight'],
  ['cable-crunch', 'Cable Crunch', 'core', 'cable'],
  ['crunch', 'Crunch', 'core', 'bodyweight', 'bodyweight'],
  ['ab-wheel', 'Ab Wheel Rollout', 'core', 'bodyweight', 'bodyweight'],
  ['decline-sit-up', 'Decline Sit-up', 'core', 'bodyweight', 'bodyweight'],
  ['russian-twist', 'Russian Twist', 'core', 'other'],
];

export const LIBRARY: Exercise[] = DEFS.map(([id, name, muscle, equipment, kind]) => ({
  id,
  name,
  muscle,
  equipment,
  kind: kind ?? 'weighted',
}));

/** Sensible first-time defaults for the set composer. */
export function defaultLoad(ex: Exercise): { kg: number; reps: number } {
  if (ex.kind === 'bodyweight') return { kg: 0, reps: 10 };
  switch (ex.equipment) {
    case 'barbell':
    case 'smith':
      return { kg: 20, reps: 8 };
    case 'ezbar':
      return { kg: 10, reps: 10 };
    case 'dumbbell':
      return { kg: 10, reps: 10 };
    case 'kettlebell':
      return { kg: 12, reps: 10 };
    default:
      return { kg: 20, reps: 10 };
  }
}
