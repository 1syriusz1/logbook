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

/** Heart rate read from Health Connect for the time of a workout. */
export interface HeartData {
  /** when it was read (epoch ms) */
  at: number;
  /** samples found inside the workout; 0 = nothing was recorded */
  n: number;
  /** where the samples came from, e.g. "Google Health" */
  src?: string;
  avg?: number;
  max?: number;
  min?: number;
  /** total calories burned during the workout */
  kcal?: number;
  /** share of the workout covered by samples, 0–1 */
  cover?: number;
  /** downsampled series, "offsetSeconds:bpm,offsetSeconds:bpm,…" */
  pts?: string;
}

export interface Workout {
  id: string;
  startedAt: number;
  /** null while the workout is in progress */
  endedAt: number | null;
  name?: string;
  note?: string;
  entries: Entry[];
  hr?: HeartData;
}

export interface BodyWeightLog {
  id: string;
  /** local calendar day, YYYY-MM-DD */
  date: string;
  kg: number;
}

/** Sleep that belongs to a morning (the night before, plus naps before 15:00). */
export interface SleepNight {
  /** first bedtime and last wake-up, epoch ms */
  start: number;
  end: number;
  /** minutes in bed (sum of sessions) */
  bed: number;
  /** minutes asleep */
  asleep: number;
  /** minutes per stage, when the band reports stages */
  deep?: number;
  rem?: number;
  light?: number;
  awake?: number;
}

/**
 * Recovery data from Health Connect for one morning ("YYYY-MM-DD").
 * Night-time values (sleep, HRV, breathing) belong to the morning they end on.
 */
export interface DayHealth {
  sleep?: SleepNight;
  /** heart rate variability, RMSSD in ms */
  hrv?: number;
  /** resting heart rate, bpm */
  rhr?: number;
  /** breathing rate during sleep, breaths per minute */
  resp?: number;
  /** steps on that calendar day */
  steps?: number;
}

/** A workout recorded by another app (e.g. a bike ride in Google Health), for training load. */
export interface Activity {
  /** Health Connect record id */
  id: string;
  /** Health Connect exercise type, e.g. "biking" */
  type: string;
  start: number;
  end: number;
  kcal?: number;
  /** metres */
  distance?: number;
  src?: string;
  hr?: HeartData;
}

/** What the brightness of a heatmap square stands for. */
export type HeatMetric = 'sets' | 'load' | 'kcal';

export interface HealthSettings {
  /** reading heart rate from Health Connect is switched on */
  on: boolean;
  /** first time access was granted; without history access reads reach 30 days before it */
  since: number | null;
  /** access to data older than that was granted too */
  history: boolean;
  lastSync: number | null;
  /** per kind of recovery data, the earliest time already read (so later syncs only refresh recent days) */
  filled?: Partial<Record<WellnessKind, number>>;
  /** per kind, when it was last read (the next sync carries on from there) */
  upTo?: Partial<Record<WellnessKind, number>>;
}

export type WellnessKind = 'sleep' | 'hrv' | 'rhr' | 'resp' | 'steps' | 'workouts';

export interface Settings {
  weightStep: number;
  lastBackupAt: number | null;
  /** max heart rate in bpm, for zones and load */
  hrMax: number;
  heatMetric: HeatMetric;
  health: HealthSettings;
}

export interface DB {
  v: 1;
  exercises: Exercise[];
  workouts: Workout[];
  bodyweight: BodyWeightLog[];
  activeId: string | null;
  settings: Settings;
  /** recovery data per morning, from Health Connect */
  wellness: Record<string, DayHealth>;
  /** workouts from other apps, from Health Connect */
  activities: Activity[];
}
