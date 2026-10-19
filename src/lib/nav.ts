/* Navigation: four root tabs plus a stack of layers (pages and sheets).
   Each layer owns a browser-history entry, so the Android back gesture and
   the browser back button close the top layer. Layers close immediately in
   the UI; history is reconciled asynchronously, one traversal at a time. */
import { useSyncExternalStore } from 'react';
import { minimizeApp, onBackButton } from './platform';

export type Tab = 'home' | 'history' | 'stats' | 'exercises';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** how many layers to close on confirm, counting the dialog itself (default 1) */
  closeCount?: number;
  onConfirm: () => void;
}

export type Route =
  | { name: 'workout'; id: string }
  | { name: 'start' }
  | { name: 'picker'; workoutId: string }
  | { name: 'entryMenu'; workoutId: string; entryId: string }
  | { name: 'set'; workoutId: string; entryId: string; setId: string }
  | { name: 'finish'; id: string }
  | { name: 'summary'; id: string }
  | { name: 'workoutDetail'; id: string }
  | { name: 'workoutMenu'; id: string }
  | { name: 'workoutTime'; id?: string; date?: string }
  | { name: 'rename'; id: string }
  | { name: 'exercise'; id: string }
  | { name: 'exerciseForm'; id?: string; addTo?: string; initialName?: string }
  | { name: 'bodyweight' }
  | { name: 'bwLog'; date?: string }
  | { name: 'settings' }
  | { name: 'confirm'; options: ConfirmOptions };

export type RouteName = Route['name'];

export interface Layer {
  key: number;
  route: Route;
  closing: boolean;
  /** whether a history entry has been pushed for this layer */
  inHistory: boolean;
}

interface NavState {
  tab: Tab;
  layers: Layer[];
}

const LEAVE_MS = 270;

let state: NavState = { tab: 'home', layers: [] };
const listeners = new Set<() => void>();
let seq = 1;
let historyOk = true;
let travelling = false;
let queuedBack = 0;

function emit(next: NavState) {
  state = next;
  listeners.forEach((l) => l());
}

const openLayers = () => state.layers.filter((l) => !l.closing);

function markClosing(key: number) {
  emit({ ...state, layers: state.layers.map((l) => (l.key === key ? { ...l, closing: true } : l)) });
  setTimeout(() => emit({ ...state, layers: state.layers.filter((l) => l.key !== key) }), LEAVE_MS);
}

function closeTopLayers(k: number): number {
  let historyEntries = 0;
  for (let i = 0; i < k; i++) {
    const open = openLayers();
    const top = open[open.length - 1];
    if (!top) break;
    if (top.inHistory) historyEntries++;
    markClosing(top.key);
  }
  return historyEntries;
}

function flushHistory() {
  if (!historyOk || travelling) return;
  if (queuedBack > 0) {
    const k = queuedBack;
    queuedBack = 0;
    travelling = true;
    history.go(-k);
    return;
  }
  const open = openLayers();
  open.forEach((l, i) => {
    if (!l.inHistory) {
      try {
        history.pushState({ depth: i + 1 }, '');
        l.inHistory = true;
      } catch {
        historyOk = false;
      }
    }
  });
}

export const nav = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  setTab(tab: Tab) {
    if (tab !== state.tab) emit({ ...state, tab });
  },
  push(route: Route) {
    const layer: Layer = { key: seq++, route, closing: false, inHistory: false };
    emit({ ...state, layers: [...state.layers, layer] });
    flushHistory();
  },
  /** Swap the top layer for another, keeping its history entry. */
  replace(route: Route) {
    const open = openLayers();
    const top = open[open.length - 1];
    if (!top) return nav.push(route);
    const layer: Layer = { key: seq++, route, closing: false, inHistory: top.inHistory };
    emit({ ...state, layers: state.layers.map((l) => (l.key === top.key ? layer : l)) });
  },
  back(count = 1) {
    const entries = closeTopLayers(count);
    queuedBack += entries;
    flushHistory();
  },
  closeAll() {
    nav.back(openLayers().length);
  },
  confirm(options: ConfirmOptions) {
    nav.push({ name: 'confirm', options });
  },
  depth: () => openLayers().length,
};

export function initNav() {
  try {
    history.replaceState({ depth: 0 }, '');
  } catch {
    historyOk = false;
  }
  window.addEventListener('popstate', (e) => {
    const depth = typeof e.state?.depth === 'number' ? e.state.depth : 0;
    if (travelling) {
      travelling = false;
    } else {
      // Browser back/forward: close layers above the new depth.
      const open = openLayers().filter((l) => l.inHistory);
      if (open.length > depth) closeTopLayers(open.length - depth);
    }
    flushHistory();
  });
  onBackButton(() => {
    if (openLayers().length) nav.back();
    else if (state.tab !== 'home') nav.setTab('home');
    else minimizeApp();
  });
}

export function useNav(): NavState {
  return useSyncExternalStore(nav.subscribe, nav.get, nav.get);
}

/* ------------------------------------------------------------ toasts */

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();

export const toast = {
  show(text: string, action?: Toast['action'], ms = 3400) {
    const t: Toast = { id: seq++, text, action };
    toasts = [...toasts.slice(-1), t];
    toastListeners.forEach((l) => l());
    setTimeout(() => toast.dismiss(t.id), ms);
  },
  dismiss(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((l) => l());
  },
};

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => {
        toastListeners.delete(fn);
      };
    },
    () => toasts,
    () => toasts,
  );
}
