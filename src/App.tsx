import { useEffect, useLayoutEffect, useRef } from 'react';
import { nav, toast, useNav, useToasts, type Layer, type Tab } from './lib/nav';
import { useData, useNow } from './lib/derived';
import { summarize } from './lib/stats';
import { fmtClock, plural } from './lib/format';
import { haptic } from './lib/platform';
import { Icon, type IconName } from './components/icons';
import { Home } from './screens/Home';
import { History, RenameSheet, WorkoutDetail, WorkoutMenu, WorkoutTimeSheet } from './screens/History';
import { Stats } from './screens/Stats';
import { ExercisePage, Exercises } from './screens/Exercises';
import { EntryMenu, FinishSheet, SetSheet, StartSheet, SummarySheet, WorkoutScreen } from './screens/Workout';
import { ExerciseForm, PickerSheet } from './screens/Picker';
import { BodyWeightPage, BodyWeightSheet } from './screens/Body';
import { ConfirmSheet, SettingsPage } from './screens/Settings';
import { hasSaveError } from './lib/store';

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'history', icon: 'history', label: 'History' },
  { id: 'stats', icon: 'stats', label: 'Stats' },
  { id: 'exercises', icon: 'exercises', label: 'Exercises' },
];

const scrollMemory = new Map<Tab, number>();

function TabScreen({ tab }: { tab: Tab }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = scrollMemory.get(tab) ?? 0;
  }, [tab]);
  return (
    <main className="screen" ref={ref} onScroll={(e) => scrollMemory.set(tab, e.currentTarget.scrollTop)}>
      {tab === 'home' && <Home />}
      {tab === 'history' && <History />}
      {tab === 'stats' && <Stats />}
      {tab === 'exercises' && <Exercises />}
    </main>
  );
}

function LayerView({ layer }: { layer: Layer }) {
  const r = layer.route;
  switch (r.name) {
    case 'workout':
      return <WorkoutScreen layer={layer} id={r.id} />;
    case 'start':
      return <StartSheet layer={layer} />;
    case 'picker':
      return <PickerSheet layer={layer} workoutId={r.workoutId} />;
    case 'entryMenu':
      return <EntryMenu layer={layer} workoutId={r.workoutId} entryId={r.entryId} />;
    case 'set':
      return <SetSheet layer={layer} workoutId={r.workoutId} entryId={r.entryId} setId={r.setId} />;
    case 'finish':
      return <FinishSheet layer={layer} id={r.id} />;
    case 'summary':
      return <SummarySheet layer={layer} id={r.id} />;
    case 'workoutDetail':
      return <WorkoutDetail layer={layer} id={r.id} />;
    case 'workoutMenu':
      return <WorkoutMenu layer={layer} id={r.id} />;
    case 'workoutTime':
      return <WorkoutTimeSheet layer={layer} id={r.id} date={r.date} />;
    case 'rename':
      return <RenameSheet layer={layer} id={r.id} />;
    case 'exercise':
      return <ExercisePage layer={layer} id={r.id} />;
    case 'exerciseForm':
      return <ExerciseForm layer={layer} id={r.id} addTo={r.addTo} initialName={r.initialName} />;
    case 'bodyweight':
      return <BodyWeightPage layer={layer} />;
    case 'bwLog':
      return <BodyWeightSheet layer={layer} date={r.date} />;
    case 'settings':
      return <SettingsPage layer={layer} />;
    case 'confirm':
      return <ConfirmSheet layer={layer} options={r.options} />;
  }
}

function MiniBar({ id, hidden }: { id: string; hidden: boolean }) {
  const data = useData();
  const now = useNow(1000, !hidden);
  const w = data.db.workouts.find((x) => x.id === id);
  if (!w || hidden) return null;
  const s = summarize(w, data.ex, now);
  return (
    <button className="mini" onClick={() => nav.push({ name: 'workout', id })}>
      <span className="live-dot" />
      <span className="mini-main">
        <span className="mini-title">{s.title}</span>
        <span className="mini-sub">{plural(s.sets, 'set')}</span>
      </span>
      <span className="mini-clock">{fmtClock(now - w.startedAt)}</span>
      <Icon name="chevronRight" size={18} />
    </button>
  );
}

function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                toast.dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const { tab, layers } = useNav();
  const data = useData();
  const activeId = data.active?.id ?? null;
  const workoutOpen = layers.some((l) => !l.closing && l.route.name === 'workout');
  const showMini = !!activeId && tab !== 'home' && !workoutOpen;

  useEffect(() => {
    if (hasSaveError()) toast.show('Storage is full: export a backup to keep your log safe', undefined, 8000);
  }, [data.db]);

  return (
    <div className={`app${showMini ? ' has-mini' : ''}`}>
      <TabScreen key={tab} tab={tab} />
      {activeId && <MiniBar id={activeId} hidden={!showMini} />}
      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' on' : ''}`}
            aria-label={t.label}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => {
              if (tab !== t.id) haptic.tick();
              if (tab === t.id) {
                document.querySelector('.screen')?.scrollTo({ top: 0, behavior: 'smooth' });
              }
              nav.setTab(t.id);
            }}
          >
            <Icon name={t.icon} size={24} strokeWidth={tab === t.id ? 1.9 : 1.7} />
          </button>
        ))}
      </nav>
      {layers.map((l) => (
        <LayerView key={l.key} layer={l} />
      ))}
      <Toasts />
    </div>
  );
}
