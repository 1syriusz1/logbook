/* Dates, numbers and durations. English copy with European conventions
   (day-month order, 24h clock, Monday-first weeks, metric units). */

export const DAY = 86_400_000;
const NBSP = '\u00A0'; // no-break space, used as thousands separator

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 of the week containing ts. */
export function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return d.getTime();
}

export function startOfMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function addMonths(ts: number, n: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

/** 0 = Monday … 6 = Sunday */
export function weekday(ts: number): number {
  return (new Date(ts).getDay() + 6) % 7;
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseDayKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function daysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', opts);
const F_WD = fmt({ weekday: 'short' });
const F_WD_LONG = fmt({ weekday: 'long' });
const F_LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const F_LONG_NOYEAR = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const F_MON_LONG_YEAR = fmt({ month: 'long', year: 'numeric' });
const F_TIME = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });

export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

const sameYear = (ts: number) => new Date(ts).getFullYear() === new Date().getFullYear();

export const fmtWeekday = (ts: number) => F_WD.format(ts);
export const fmtWeekdayLong = (ts: number) => F_WD_LONG.format(ts);
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtMonth = (ts: number) => MONTHS_SHORT[new Date(ts).getMonth()];
export const fmtMonthYear = (ts: number) => F_MON_LONG_YEAR.format(ts);
export const fmtTime = (ts: number) => F_TIME.format(ts);

const dayMon = (ts: number) => `${new Date(ts).getDate()} ${fmtMonth(ts)}`;

/** "Mon, 12 Oct" or "12 Oct 2025" for other years */
export function fmtDate(ts: number): string {
  if (!sameYear(ts)) return `${dayMon(ts)} ${new Date(ts).getFullYear()}`;
  return `${F_WD.format(ts)}, ${dayMon(ts)}`;
}

/** "12 Oct" or "12 Oct 2025" */
export function fmtDayMonth(ts: number): string {
  return sameYear(ts) ? dayMon(ts) : `${dayMon(ts)} ${new Date(ts).getFullYear()}`;
}

export function fmtDateLong(ts: number): string {
  return sameYear(ts) ? F_LONG_NOYEAR.format(ts) : F_LONG.format(ts);
}

/** "Today", "Yesterday", "Thursday", or "12 Oct". `inline` lowercases today/yesterday for use mid-sentence. */
export function fmtRelDay(ts: number, now = Date.now(), inline = false): string {
  const diff = daysBetween(ts, now);
  if (diff === 0) return inline ? 'today' : 'Today';
  if (diff === 1) return inline ? 'yesterday' : 'Yesterday';
  if (diff > 1 && diff < 7) return F_WD_LONG.format(ts);
  return fmtDayMonth(ts);
}

export function fmtAgo(ts: number, now = Date.now()): string {
  const diff = daysBetween(ts, now);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 14) return `${diff} days ago`;
  if (diff < 60) return `${Math.round(diff / 7)} weeks ago`;
  return `${Math.round(diff / 30)} months ago`;
}

/** 12450 → "12 450"; decimals are trimmed: 82.50 → "82.5" */
export function fmtNum(n: number, maxDecimals = 0): string {
  if (!Number.isFinite(n)) return '–';
  const neg = n < 0;
  const p = Math.pow(10, maxDecimals);
  const rounded = Math.round(Math.abs(n) * p) / p;
  let [int, dec] = rounded.toFixed(maxDecimals).split('.');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  if (dec) dec = dec.replace(/0+$/, '');
  return (neg ? '−' : '') + int + (dec ? '.' + dec : '');
}

export const fmtKg = (n: number) => fmtNum(n, 2);

/** Body weight always shows one decimal: 82.0 */
export const fmtBw = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Compact large numbers for chart axes: 12 450 → "12.5k" */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return fmtNum(n / 1_000_000, 1) + 'M';
  if (a >= 10_000) return fmtNum(n / 1000, 0) + 'k';
  if (a >= 1000) return fmtNum(n / 1000, 1) + 'k';
  return fmtNum(n, 1);
}

/** 4 320 000 ms → "1h 12m" */
export function fmtDur(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Duration split for display with styled units, e.g. [["1","h"],["12","m"]] */
export function durParts(ms: number): [string, string][] {
  const min = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return [[String(m), 'm']];
  return m ? [[String(h), 'h'], [String(m), 'm']] : [[String(h), 'h']];
}

/** Running clock: "42:13" or "1:02:13" */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

/** Parse user input like "82,5" or "82.5" */
export function parseNum(s: string): number | null {
  const t = s.replace(',', '.').replace(/[^\d.]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
