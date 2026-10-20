export type Muscle = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'legs' | 'core';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'ezbar'
  | 'smith'
  | 'kettlebell'
  | 'other';

/** weighted: kg is the load. bodyweight: kg is added load (0 = just bodyweight). */
export type ExerciseKind = 'weighted' | 'bodyweight';

export interface Exercise {
  id: string;
  name: string;
  muscle: Muscle;
  equipment: Equipment;
  kind: ExerciseKind;
  /** bodyweight move usually done with extra load (weighted pull-up, weighted dip) */
  loaded?: boolean;
  custom?: boolean;
  archived?: boolean;
}

export interface SetLog {
  id: string;
  kg: number;
  reps: number;
  /** epoch ms when the set was logged */
  at: number;
}

export interface Entry {
  id: string;
  exerciseId: string;
  sets: SetLog[];
}

export interface Workout {
  id: string;
  startedAt: number;
  /** null while the workout is in progress */
  endedAt: number | null;
  name?: string;
  note?: string;
  entries: Entry[];
}

export interface BodyWeightLog {
  id: string;
  /** local calendar day, YYYY-MM-DD */
  date: string;
  kg: number;
}

export interface Settings {
  weightStep: number;
  lastBackupAt: number | null;
}

export interface DB {
  v: 1;
  exercises: Exercise[];
  workouts: Workout[];
  bodyweight: BodyWeightLog[];
  activeId: string | null;
  settings: Settings;
}
