/* Thin layer over native (Capacitor / Android) features with web fallbacks. */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';

export const isNative = Capacitor.isNativePlatform();

const DATA_FILE = 'logbook.json';

/* Serialised, latest-wins writer for the app-storage copy of the log. */
let writing = false;
let queued: string | null = null;

async function drain() {
  if (writing) return;
  writing = true;
  try {
    while (queued !== null) {
      const json = queued;
      queued = null;
      await Filesystem.writeFile({ path: DATA_FILE, data: json, directory: Directory.Data, encoding: Encoding.UTF8 });
    }
  } finally {
    writing = false;
  }
}

export const nativeFile = {
  async read(): Promise<string | null> {
    if (!isNative) return null;
    try {
      const r = await Filesystem.readFile({ path: DATA_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof r.data === 'string' ? r.data : null;
    } catch {
      return null;
    }
  },
  async write(json: string): Promise<void> {
    if (!isNative) return;
    queued = json;
    await drain();
  },
};

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not available */
  }
}

export const haptic = {
  tick() {
    if (isNative) Haptics.selectionChanged().catch(() => {});
  },
  light() {
    if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    else vibrate(6);
  },
  medium() {
    if (isNative) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    else vibrate(10);
  },
  success() {
    if (isNative) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    else vibrate([8, 50, 12]);
  },
};

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/** Hands a file to the system share sheet (save to Drive, send to yourself…). */
export async function shareFile(filename: string, contents: string): Promise<ShareResult> {
  if (isNative) {
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: contents,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({ title: 'Logbook backup', files: [uri] });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const blob = new Blob([contents], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Logbook backup' });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}

/** Android hardware/gesture back. Returns an unsubscribe function. */
export function onBackButton(handler: () => void): () => void {
  if (!isNative) return () => {};
  const p = App.addListener('backButton', handler);
  return () => {
    p.then((h) => h.remove()).catch(() => {});
  };
}

export function minimizeApp() {
  if (isNative) App.minimizeApp().catch(() => {});
}

export function onAppPause(fn: () => void): () => void {
  if (!isNative) return () => {};
  const p = App.addListener('pause', fn);
  return () => {
    p.then((h) => h.remove()).catch(() => {});
  };
}

export function onAppResume(fn: () => void): () => void {
  if (!isNative) return () => {};
  const p = App.addListener('resume', fn);
  return () => {
    p.then((h) => h.remove()).catch(() => {});
  };
}

/** Ask the browser not to evict our storage (web/PWA only). */
export function requestPersistentStorage() {
  if (isNative) return;
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* ignore */
  }
}

export function registerServiceWorker() {
  if (isNative || import.meta.env.MODE === 'demo' || import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
