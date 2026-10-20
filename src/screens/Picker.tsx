import { useMemo, useState } from 'react';
import type { Equipment, Exercise, ExerciseKind, Muscle } from '../lib/types';
import { nav, type Layer } from '../lib/nav';
import { useData } from '../lib/derived';
import { addEntry, createExercise, getDB, isExerciseUsed, removeExercise, updateExercise } from '../lib/store';
import { EQUIPMENT_LABEL, equipmentLabel, MUSCLE_LABEL, MUSCLES } from '../lib/exercises';
import { fmtRelDay } from '../lib/format';
import { haptic } from '../lib/platform';
import { Button, Chips, IconButton, Segmented } from '../components/ui';
import { Icon } from '../components/icons';
import { Sheet } from '../components/layers';

type Filter = 'all' | Muscle;

const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, ...MUSCLES.map((m) => ({ value: m.id as Filter, label: m.label }))];

export function matches(e: Exercise, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${e.name} ${MUSCLE_LABEL[e.muscle]} ${equipmentLabel(e)} ${e.loaded ? 'weighted' : ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function useUsage() {
  const data = useData();
  return useMemo(() => {
    const m = new Map<string, { last: number; sessions: number }>();
    for (const w of data.finished) {
      const seen = new Set<string>();
      for (const e of w.entries) {
        if (!e.sets.length || seen.has(e.exerciseId)) continue;
        seen.add(e.exerciseId);
        const u = m.get(e.exerciseId) ?? { last: 0, sessions: 0 };
        u.last = Math.max(u.last, w.startedAt);
        u.sessions++;
        m.set(e.exerciseId, u);
      }
    }
    return m;
  }, [data.finished]);
}

export function PickerSheet({ layer, workoutId }: { layer: Layer; workoutId: string }) {
  const data = useData();
  const usage = useUsage();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const w = data.db.workouts.find((x) => x.id === workoutId);
  const inWorkout = new Set(w?.entries.map((e) => e.exerciseId) ?? []);

  const visible = data.db.exercises.filter((e) => !e.archived && (filter === 'all' || e.muscle === filter) && matches(e, q));
  const recent = q
    ? []
    : visible
        .filter((e) => usage.has(e.id) && !inWorkout.has(e.id))
        .sort((a, b) => usage.get(b.id)!.last - usage.get(a.id)!.last)
        .slice(0, 8);
  const recentIds = new Set(recent.map((e) => e.id));
  const groups = MUSCLES.map((m) => ({
    muscle: m,
    items: visible.filter((e) => e.muscle === m.id && !recentIds.has(e.id)).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.items.length);

  const pick = (id: string) => {
    if (!inWorkout.has(id)) {
      addEntry(workoutId, id);
      haptic.light();
    }
    nav.back();
  };

  const row = (e: Exercise) => {
    const u = usage.get(e.id);
    const added = inWorkout.has(e.id);
    return (
      <button key={e.id} className="group-row" onClick={() => pick(e.id)}>
        <div className="row-main">
          <div className="row-title">{e.name}</div>
          <div className="row-sub">
            {MUSCLE_LABEL[e.muscle]} · {equipmentLabel(e)}
            {u ? ` · ${fmtRelDay(u.last)}` : ''}
          </div>
        </div>
        {added ? (
          <span className="added">
            <Icon name="check" size={16} strokeWidth={2.2} /> Added
          </span>
        ) : (
          <span className="plus-dot">
            <Icon name="plus" size={16} />
          </span>
        )}
      </button>
    );
  };

  return (
    <Sheet
      layer={layer}
      tall
      title="Add exercise"
      headRight={<IconButton icon="close" label="Close" onClick={() => nav.back()} />}
      top={
        <div className="picker-top">
          <label className="search">
            <Icon name="search" size={19} />
            <input
              placeholder="Search exercises"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search exercises"
              enterKeyHint="search"
            />
            {q && (
              <button aria-label="Clear search" onClick={() => setQ('')}>
                <Icon name="close" size={17} />
              </button>
            )}
          </label>
          <Chips options={FILTERS} value={filter} onChange={setFilter} label="Muscle group" />
        </div>
      }
    >
      {recent.length > 0 && (
        <>
          <div className="list-label">Recent</div>
          <div className="group">{recent.map(row)}</div>
        </>
      )}
      {groups.map((g) => (
        <div key={g.muscle.id}>
          <div className="list-label">{g.muscle.label}</div>
          <div className="group">{g.items.map(row)}</div>
        </div>
      ))}
      {!visible.length && (
        <div className="empty">
          <div className="empty-title">No match for “{q}”</div>
          <div className="empty-text">Create it as your own exercise. It will show up here next time.</div>
        </div>
      )}
      <button
        className="create-row"
        onClick={() => nav.push({ name: 'exerciseForm', addTo: workoutId, initialName: q.trim() })}
      >
        <Icon name="plus" size={18} />
        {q.trim() ? `Create “${q.trim()}”` : 'Create your own exercise'}
      </button>
    </Sheet>
  );
}

const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'ezbar', 'smith', 'kettlebell', 'other'];

export function ExerciseForm({
  layer,
  id,
  addTo,
  initialName,
}: {
  layer: Layer;
  id?: string;
  addTo?: string;
  initialName?: string;
}) {
  const data = useData();
  const existing = id ? data.ex.get(id) : undefined;
  const titled = (initialName ?? '').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const [name, setName] = useState(existing?.name ?? titled);
  const [muscle, setMuscle] = useState<Muscle>(existing?.muscle ?? 'chest');
  const [equipment, setEquipment] = useState<Equipment>(existing?.equipment ?? 'barbell');
  type Load = ExerciseKind | 'loaded';
  const [load, setLoad] = useState<Load>(existing ? (existing.loaded ? 'loaded' : existing.kind) : 'weighted');
  const valid = name.trim().length > 0;

  const save = () => {
    if (!valid) return;
    const payload = {
      name: name.trim(),
      muscle,
      equipment,
      kind: (load === 'weighted' ? 'weighted' : 'bodyweight') as ExerciseKind,
      loaded: load === 'loaded' ? true : undefined,
    };
    if (existing) {
      updateExercise(existing.id, payload);
      nav.back();
      return;
    }
    const nid = createExercise(payload);
    haptic.light();
    if (addTo) {
      addEntry(addTo, nid);
      nav.back(2);
    } else nav.back();
  };

  const used = existing ? isExerciseUsed(getDB(), existing.id) : false;
  const remove = () => {
    if (!existing) return;
    nav.confirm({
      title: used ? `Hide ${existing.name}?` : `Delete ${existing.name}?`,
      message: used
        ? 'It disappears from your lists and the exercise picker. Workouts that include it keep their sets.'
        : 'It has no logged sets, so nothing else changes.',
      confirmLabel: used ? 'Hide exercise' : 'Delete exercise',
      destructive: true,
      closeCount: 3,
      onConfirm: () => removeExercise(existing.id),
    });
  };

  return (
    <Sheet
      layer={layer}
      title={existing ? 'Edit exercise' : 'New exercise'}
      actions={
        <>
          <Button variant="primary" size="lg" block disabled={!valid} onClick={save}>
            {existing ? 'Save' : addTo ? 'Create and add' : 'Create exercise'}
          </Button>
          {existing && (
            <Button variant="ghost" block icon="trash" onClick={remove}>
              {used ? 'Hide exercise' : 'Delete exercise'}
            </Button>
          )}
        </>
      }
    >
      <div className="form">
        <div className="field">
          <label className="field-label" htmlFor="ex-name">
            Name
          </label>
          <input
            id="ex-name"
            className="text-input"
            value={name}
            maxLength={60}
            placeholder="e.g. Landmine Press"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <div className="field">
          <div className="field-label">Muscle group</div>
          <div className="chip-wrap">
            {MUSCLES.map((m) => (
              <button key={m.id} className={`chip${muscle === m.id ? ' on' : ''}`} onClick={() => setMuscle(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="field-label">Equipment</div>
          <div className="chip-wrap">
            {EQUIPMENT.map((eq) => (
              <button
                key={eq}
                className={`chip${equipment === eq ? ' on' : ''}`}
                onClick={() => {
                  setEquipment(eq);
                  if (eq === 'bodyweight' && load === 'weighted') setLoad('bodyweight');
                }}
              >
                {EQUIPMENT_LABEL[eq]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="field-label">What you log</div>
          <Segmented
            label="Load type"
            value={load}
            onChange={(v) => {
              setLoad(v);
              if (v !== 'weighted' && equipment !== 'other') setEquipment('bodyweight');
            }}
            options={[
              { value: 'weighted', label: 'Weight' },
              { value: 'bodyweight', label: 'Bodyweight' },
              { value: 'loaded', label: 'BW + kg' },
            ]}
          />
          <div className="sub">
            {load === 'weighted'
              ? 'Log the weight on the bar or machine and the reps.'
              : load === 'bodyweight'
                ? 'Log reps. Extra weight is optional.'
                : 'Bodyweight move with a belt or vest: log the added kg and reps.'}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
