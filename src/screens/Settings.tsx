import { useRef } from 'react';
import { nav, toast, type ConfirmOptions, type Layer } from '../lib/nav';
import { useData } from '../lib/derived';
import { exportJSON, replaceDB, resetAll, sanitize, setSettings } from '../lib/store';
import { demoDB } from '../lib/demo';
import { dayKey, fmtAgo, plural } from '../lib/format';
import { isNative, shareFile } from '../lib/platform';
import { connectHealth, disconnectHealth, openHealthConnect, syncHeart, useHealth, type HealthState } from '../lib/health';
import { Button, Segmented, Stepper } from '../components/ui';
import { Icon } from '../components/icons';
import { Page, Sheet } from '../components/layers';

const HC_STORE = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

function HealthSection() {
  const data = useData();
  const s = data.db.settings;
  const h = useHealth();
  const withHr = data.heart.size;
  let highest = 0;
  for (const v of data.heart.values()) highest = Math.max(highest, v.max);

  const status: Record<HealthState, string> = {
    checking: 'Checking…',
    unsupported: 'Works in the Android app',
    unavailable: 'Health Connect isn’t on this phone',
    update: 'Health Connect needs an update',
    off: 'Not connected',
    denied: 'Access was turned off in Health Connect',
    on: h.syncing
      ? `Reading workouts… ${h.done}/${h.total}`
      : `Connected · ${plural(withHr, 'workout')} with heart rate${s.health.lastSync ? ` · synced ${fmtAgo(s.health.lastSync)}` : ''}`,
  };

  return (
    <>
      <div className="list-label">Heart rate</div>
      <div className="card hc-card">
        <div className="hc-top">
          <span className="hc-icon">
            <Icon name="heart" size={20} />
          </span>
          <div className="row-main">
            <div className="row-title">Health Connect</div>
            <div className="row-sub">{status[h.state]}</div>
          </div>
          {h.state === 'off' && (
            <Button variant="primary" size="sm" onClick={() => connectHealth()}>
              Connect
            </Button>
          )}
          {h.state === 'denied' && (
            <Button variant="primary" size="sm" onClick={() => connectHealth()}>
              Reconnect
            </Button>
          )}
          {(h.state === 'unavailable' || h.state === 'update') && (
            <a className="btn btn-secondary btn-sm" href={HC_STORE} target="_blank" rel="noreferrer">
              {h.state === 'update' ? 'Update' : 'Get it'}
            </a>
          )}
        </div>
        <p className="sub hc-text">
          Logbook reads the heart rate and calories that Google Health saves from your Fitbit, for the time of each workout.
          Nothing leaves your phone.
        </p>
        {(h.state === 'on' || h.state === 'denied') && (
          <div className="hc-actions">
            {h.state === 'on' && (
              <Button size="sm" icon="refresh" disabled={h.syncing} onClick={() => syncHeart()}>
                {h.syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => openHealthConnect()}>
              Permissions
            </Button>
            {h.state === 'on' && (
              <Button size="sm" variant="ghost" onClick={() => disconnectHealth()}>
                Turn off
              </Button>
            )}
          </div>
        )}
        {h.error && <p className="hc-error">{h.error}</p>}
      </div>

      <div className="card">
        <div className="card-label">Max heart rate</div>
        <div className="set-seg">
          <Stepper id="hr-max" value={s.hrMax} onChange={(v) => setSettings({ hrMax: v })} step={1} min={120} max={230} unit="bpm" integer />
        </div>
        <div className="sub">
          Sets your zones: Z1 starts at 50% of it, Z5 at 90%. A rough guide is 208 − 0.7 × your age.
          {highest ? ` Highest in a workout so far: ${highest} bpm.` : ''}
        </div>
      </div>

      <div className="card">
        <div className="card-label">Heatmap shade</div>
        <div className="set-seg">
          <Segmented
            label="Heatmap shade"
            value={s.heatMetric}
            onChange={(v) => setSettings({ heatMetric: v })}
            options={[
              { value: 'load', label: 'HR load' },
              { value: 'kcal', label: 'Calories' },
              { value: 'sets', label: 'Sets' },
            ]}
          />
        </div>
        <div className="sub">
          {s.heatMetric === 'sets'
            ? 'Brighter squares are days with more sets.'
            : `Brighter squares are days with more ${s.heatMetric === 'load' ? 'heart-rate load' : 'calories burned'}. Days without heart-rate data are shaded by sets.`}
        </div>
      </div>
    </>
  );
}


export function SettingsPage({ layer }: { layer: Layer }) {
  const data = useData();
  const s = data.db.settings;
  const file = useRef<HTMLInputElement>(null);
  const count = data.finished.length;
  const preview = import.meta.env.MODE === 'demo';

  const doExport = async () => {
    try {
      const r = await shareFile(`logbook-backup-${dayKey(Date.now())}.json`, exportJSON());
      if (r === 'cancelled') return;
      setSettings({ lastBackupAt: Date.now() });
      toast.show(r === 'downloaded' ? 'Backup downloaded' : 'Backup ready to save');
    } catch {
      toast.show('Could not create the backup file');
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const next = sanitize(JSON.parse(await f.text()));
      const n = next.workouts.filter((w) => w.endedAt !== null).length;
      nav.confirm({
        title: 'Replace your log?',
        message: `The backup has ${plural(n, 'workout')}. It replaces the ${plural(count, 'workout')} on this phone.`,
        confirmLabel: 'Replace with backup',
        destructive: true,
        onConfirm: () => {
          replaceDB(next);
          toast.show(`Restored ${plural(n, 'workout')}`);
        },
      });
    } catch (e) {
      toast.show((e as Error)?.message?.includes('Logbook') ? (e as Error).message : 'That file could not be read as a backup');
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <Page layer={layer} title="Settings">
      <div className="page-hero">
        <h1 className="title-xl">Settings</h1>
      </div>

      <div className="list-label">Logging</div>
      <div className="card">
        <div className="card-label">Weight step for + and −</div>
        <div className="set-seg">
          <Segmented
            label="Weight step"
            value={s.weightStep}
            onChange={(v) => setSettings({ weightStep: v })}
            options={[1, 1.25, 2, 2.5, 5].map((v) => ({ value: v, label: `${v} kg` }))}
          />
        </div>
        <div className="sub">You can always type an exact weight.</div>
      </div>

      <HealthSection />

      <div className="list-label">Your data</div>
      <div className="group">
        <button className="group-row" onClick={doExport} disabled={preview}>
          <Icon name="export" size={20} />
          <div className="row-main">
            <div className="row-title">Export backup</div>
            <div className="row-sub">
              {preview ? 'Works in the installed app' : s.lastBackupAt ? `Last backup ${fmtAgo(s.lastBackupAt)}` : 'No backup yet'}
            </div>
          </div>
        </button>
        <button className="group-row" onClick={() => file.current?.click()} disabled={preview}>
          <Icon name="import" size={20} />
          <div className="row-main">
            <div className="row-title">Restore from backup</div>
            <div className="row-sub">{preview ? 'Works in the installed app' : 'Pick a Logbook .json file'}</div>
          </div>
        </button>
        {count === 0 && (
          <button
            className="group-row"
            onClick={() => {
              replaceDB(demoDB());
              nav.back();
              toast.show('Sample data loaded');
            }}
          >
            <Icon name="stats" size={20} />
            <div className="row-main">
              <div className="row-title">Load sample data</div>
              <div className="row-sub">Example training to explore the charts</div>
            </div>
          </button>
        )}
        <button
          className="group-row"
          onClick={() =>
            nav.confirm({
              title: 'Erase everything?',
              message: count ? `${plural(count, 'workout')}, your body weight log and custom exercises will be deleted from this phone.` : 'This resets the app.',
              confirmLabel: 'Erase all data',
              destructive: true,
              onConfirm: () => {
                resetAll();
                toast.show('All data erased');
              },
            })
          }
        >
          <Icon name="trash" size={20} />
          <div className="row-main">
            <div className="row-title danger-text">Erase all data</div>
          </div>
        </button>
      </div>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      <p className="about">
        Logbook {__APP_VERSION__}
        <br />
        Your log is stored only on this {isNative ? 'phone' : 'device'}. Export a backup now and then, and keep it somewhere safe,
        such as your Google Drive.
      </p>
    </Page>
  );
}

export function ConfirmSheet({ layer, options }: { layer: Layer; options: ConfirmOptions }) {
  return (
    <Sheet
      layer={layer}
      title={options.title}
      actions={
        <>
          <Button
            variant={options.destructive ? 'danger' : 'primary'}
            size="lg"
            block
            onClick={() => {
              nav.back(options.closeCount ?? 1);
              options.onConfirm();
            }}
          >
            {options.confirmLabel}
          </Button>
          <Button variant="ghost" block onClick={() => nav.back()}>
            Cancel
          </Button>
        </>
      }
    >
      {options.message && <p className="sheet-text">{options.message}</p>}
    </Sheet>
  );
}
