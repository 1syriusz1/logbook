/* Hand-drawn SVG charts. Monochrome: value is carried by lightness. */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { addDays, dayKey, DAY, fmtDayMonth, fmtMonth, startOfDay, startOfWeek, WEEKDAYS_SHORT } from '../lib/format';
import { heatLevel, type DayStat } from '../lib/stats';

/* ------------------------------------------------------------ utils */

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Picks a round tick step that gives 3–5 gridlines over [min, max]. */
function niceDomain(min: number, max: number, zero: boolean): { lo: number; hi: number; step: number } {
  if (zero) min = Math.min(0, min);
  if (min === max) {
    const pad = Math.abs(max) * 0.1 || 1;
    min -= zero ? 0 : pad;
    max += pad;
  }
  if (!zero) {
    const pad = (max - min) * 0.1;
    min -= pad;
    max += pad * 0.5;
  }
  const range = max - min;
  const mag = Math.pow(10, Math.floor(Math.log10(range / 4)));
  let best = { lo: 0, hi: 0, step: 1, score: Infinity };
  // 2.5 steps below 1 (0.25, 0.025) would need an extra decimal in the labels
  for (const m of mag < 1 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]) {
    const step = m * mag;
    const lo = zero ? 0 : Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const intervals = Math.round((hi - lo) / step);
    const score = Math.abs(intervals - 3.5) + (intervals > 5 ? 10 : 0) + (m === 2.5 ? 0.3 : 0);
    if (score < best.score) best = { lo, hi, step, score };
  }
  return { lo: best.lo, hi: best.hi, step: best.step };
}

/** Monotone cubic interpolation (Fritsch–Carlson): smooth, never overshoots. */
function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push(dx[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t.push(0);
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t.push((w1 + w2) / (w1 / m[i - 1] + w2 / m[i]));
    }
  }
  t.push(m[n - 2]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + t[i] * h},${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h},${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function timeTicks(x0: number, x1: number): { x: number; label: string }[] {
  const span = x1 - x0;
  const out: { x: number; label: string }[] = [];
  if (span > 75 * DAY) {
    const d = new Date(x0);
    let t = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const months: number[] = [];
    while (t <= x1) {
      months.push(t);
      const dt = new Date(t);
      t = new Date(dt.getFullYear(), dt.getMonth() + 1, 1).getTime();
    }
    const every = Math.ceil(months.length / 5);
    months.forEach((m, i) => {
      if (i % every === 0) out.push({ x: m, label: fmtMonth(m) });
    });
  } else {
    const step = span > 35 * DAY ? 14 : span > 14 * DAY ? 7 : Math.max(1, Math.ceil(span / DAY / 4));
    let t = startOfWeek(x0);
    if (step < 7) t = startOfDay(x0);
    while (t <= x1) {
      if (t >= x0) out.push({ x: t, label: fmtDayMonth(t) });
      t = addDays(t, step);
    }
  }
  return out;
}

/**
 * Picking a point. Mouse: hovering shows the nearest point. Touch: tap or drag
 * sideways to select; the selection stays until you tap the same point again.
 * A touch that turns into page scrolling leaves the previous selection as it was.
 */
function useScrub(count: number, indexAt: (clientX: number) => number, onScrub?: (i: number | null) => void) {
  const [active, setActive] = useState<number | null>(null);
  const current = useRef<number | null>(null);
  const touch = useRef<{ before: number | null; x: number; moved: boolean } | null>(null);
  const set = (i: number | null) => {
    if (i === current.current) return;
    current.current = i;
    setActive(i);
    onScrub?.(i);
  };
  if (!count) return { active: null, handlers: {} };
  return {
    active,
    handlers: {
      onPointerDown: (e: RPointerEvent) => {
        if (e.pointerType === 'mouse') return;
        touch.current = { before: current.current, x: e.clientX, moved: false };
        set(indexAt(e.clientX));
      },
      onPointerMove: (e: RPointerEvent) => {
        if (e.pointerType === 'mouse') return set(indexAt(e.clientX));
        const t = touch.current;
        if (!t) return;
        if (Math.abs(e.clientX - t.x) > 6) t.moved = true;
        set(indexAt(e.clientX));
      },
      onPointerUp: (e: RPointerEvent) => {
        const t = touch.current;
        touch.current = null;
        if (!t || e.pointerType === 'mouse') return;
        if (!t.moved && t.before !== null && t.before === indexAt(e.clientX)) set(null);
      },
      onPointerCancel: () => {
        const t = touch.current;
        touch.current = null;
        if (t) set(t.before);
      },
      onPointerLeave: (e: RPointerEvent) => {
        if (e.pointerType === 'mouse') set(null);
      },
    },
  };
}

export interface Tip {
  value: string;
  label?: string;
}

/** Floating value label next to the selected point, kept inside the chart. */
function ChartTip({ tip, x, y, width }: { tip: Tip; x: number; y: number; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(x, w / 2 + 2), width - w / 2 - 2);
    const top = y - h - 14 >= 0 ? y - h - 14 : y + 14;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  });
  return (
    <div className="ch-tip" ref={ref} style={{ visibility: 'hidden' }} role="status">
      <b>{tip.value}</b>
      {tip.label && <span>{tip.label}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ line chart */

export interface LinePoint {
  x: number;
  y: number;
}

interface LineChartProps {
  points: LinePoint[];
  height?: number;
  formatY?: (v: number) => string;
  zero?: boolean;
  baseline?: number | null;
  onScrub?: (i: number | null) => void;
  /** true: dots while there are few points; 'all': a dot on every point (measurements) */
  dots?: boolean | 'all';
  /** text for the floating label of the selected point */
  tooltip?: (i: number) => Tip;
}

export function LineChart({
  points,
  height = 168,
  formatY = (v) => String(Math.round(v)),
  zero,
  baseline,
  onScrub,
  dots = true,
  tooltip,
}: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gid = useId().replace(/:/g, '');
  const padR = 40;
  const padT = 10;
  const padB = 24;
  const plotW = Math.max(0, width - padR);
  const plotH = height - padT - padB;

  const geo = useMemo(() => {
    if (!points.length || !width) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    if (x0 === x1) {
      x0 -= 3 * DAY;
      x1 += 3 * DAY;
    }
    const yMin = Math.min(...ys, baseline ?? Infinity);
    const yMax = Math.max(...ys, baseline ?? -Infinity);
    const { lo, hi, step } = niceDomain(yMin, yMax, !!zero);
    const inset = 8;
    const sx = (x: number) => inset + ((x - x0) / (x1 - x0)) * (plotW - inset * 2);
    const sy = (y: number) => padT + (1 - (y - lo) / (hi - lo || 1)) * plotH;
    const pts = points.map((p) => [sx(p.x), sy(p.y)] as [number, number]);
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { pts, sx, sy, ticks, x0, x1, lo };
  }, [points, width, plotW, plotH, zero, baseline]);

  const indexAt = (clientX: number) => {
    if (!geo || !ref.current) return 0;
    const left = ref.current.getBoundingClientRect().left;
    const x = clientX - left;
    let best = 0;
    let dist = Infinity;
    geo.pts.forEach(([px], i) => {
      const d = Math.abs(px - x);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };
  const { active, handlers } = useScrub(points.length, indexAt, onScrub);

  const line = geo ? monotonePath(geo.pts) : '';
  const bottom = padT + plotH;
  const area = geo && geo.pts.length > 1 ? `${line}L${geo.pts[geo.pts.length - 1][0]},${bottom}L${geo.pts[0][0]},${bottom}Z` : '';
  const xt = geo ? timeTicks(geo.x0, geo.x1) : [];
  const last = geo ? geo.pts[geo.pts.length - 1] : null;
  const showDots = dots === 'all' ? points.length <= 90 : dots && points.length <= 24;
  const dotR = points.length > 40 ? 1.9 : 2.4;
  const sel = active !== null && geo ? geo.pts[active] : null;

  return (
    <div className="chart" ref={ref} style={{ height }} {...handlers}>
      {geo && (
        <svg width={width} height={height} className="chart-svg">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="ch-stop" stopOpacity="0.2" />
              <stop offset="1" className="ch-stop" stopOpacity="0" />
            </linearGradient>
          </defs>
          {geo.ticks.map((v) => (
            <g key={v}>
              <line x1={0} x2={plotW} y1={geo.sy(v)} y2={geo.sy(v)} className="ch-grid" />
              <text x={width - 2} y={geo.sy(v) + 3.5} textAnchor="end" className="ch-label">
                {formatY(v)}
              </text>
            </g>
          ))}
          {xt.map((t) => {
            const x = geo.sx(t.x);
            if (x < 8 || x > plotW - 8) return null;
            return (
              <text key={t.x} x={x} y={height - 6} textAnchor="middle" className="ch-label">
                {t.label}
              </text>
            );
          })}
          {baseline != null && (
            <line x1={0} x2={plotW} y1={geo.sy(baseline)} y2={geo.sy(baseline)} className="ch-avg" />
          )}
          {area && <path d={area} fill={`url(#${gid})`} />}
          <path d={line} className="ch-line" fill="none" />
          {showDots &&
            geo.pts.map(([x, y], i) => (i === geo.pts.length - 1 ? null : <circle key={i} cx={x} cy={y} r={dotR} className="ch-dot" />))}
          {last && !sel && (
            <g>
              <circle cx={last[0]} cy={last[1]} r={7} className="ch-halo" />
              <circle cx={last[0]} cy={last[1]} r={3.6} className="ch-end" />
            </g>
          )}
          {sel && (
            <g>
              <line x1={sel[0]} x2={sel[0]} y1={padT - 4} y2={bottom} className="ch-scrub" />
              <circle cx={sel[0]} cy={sel[1]} r={8} className="ch-halo" />
              <circle cx={sel[0]} cy={sel[1]} r={4} className="ch-end" />
            </g>
          )}
        </svg>
      )}
      {sel && tooltip && active !== null && <ChartTip tip={tooltip(active)} x={sel[0]} y={sel[1]} width={width} />}
    </div>
  );
}

/* ------------------------------------------------------------ bar chart */

export interface Bar {
  key: string | number;
  value: number;
  label?: string;
}

interface BarChartProps {
  bars: Bar[];
  height?: number;
  formatY?: (v: number) => string;
  onScrub?: (i: number | null) => void;
  average?: number | null;
  /** index drawn brighter, e.g. the current week */
  current?: number | null;
  maxBar?: number;
  showY?: boolean;
  tooltip?: (i: number) => Tip;
}

export function BarChart({
  bars,
  height = 150,
  formatY = (v) => String(Math.round(v)),
  onScrub,
  average,
  current = null,
  maxBar = 18,
  showY = true,
  tooltip,
}: BarChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const padR = showY ? 40 : 0;
  const padT = 10;
  const padB = 22;
  const plotW = Math.max(0, width - padR);
  const plotH = height - padT - padB;
  const n = bars.length;
  const slot = n ? plotW / n : 0;
  const bw = Math.max(3, Math.min(maxBar, slot * 0.62));
  const maxV = Math.max(...bars.map((b) => b.value), average ?? 0, 0);
  const { hi, step } = niceDomain(0, maxV || 1, true);
  const sy = (v: number) => padT + (1 - v / (hi || 1)) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= hi + step / 1000; v += step) ticks.push(v);

  const indexAt = (clientX: number) => {
    if (!ref.current || !slot) return 0;
    const x = clientX - ref.current.getBoundingClientRect().left;
    return Math.min(n - 1, Math.max(0, Math.floor(x / slot)));
  };
  const { active, handlers } = useScrub(n, indexAt, onScrub);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));
  const bottom = padT + plotH;

  return (
    <div className="chart" ref={ref} style={{ height }} {...handlers}>
      {width > 0 && (
        <svg width={width} height={height} className="chart-svg">
          {showY &&
            ticks.map((v) => (
              <g key={v}>
                <line x1={0} x2={plotW} y1={sy(v)} y2={sy(v)} className="ch-grid" />
                <text x={width - 2} y={sy(v) + 3.5} textAnchor="end" className="ch-label">
                  {formatY(v)}
                </text>
              </g>
            ))}
          {bars.map((b, i) => {
            const x = i * slot + (slot - bw) / 2;
            const h = b.value > 0 ? Math.max(3, bottom - sy(b.value)) : 2;
            const cls = active === i ? 'bar bar-active' : current === i ? 'bar bar-current' : b.value > 0 ? 'bar' : 'bar bar-zero';
            return (
              <g key={b.key}>
                <rect x={x} y={bottom - h} width={bw} height={h} rx={Math.min(4, bw / 2)} className={cls} />
                {b.label && (i % labelEvery === 0 || i === n - 1) && (n - 1 - i >= labelEvery || i === n - 1) && (
                  <text x={x + bw / 2} y={height - 6} textAnchor="middle" className={`ch-label${active === i ? ' ch-label-on' : ''}`}>
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
          {average != null && average > 0 && <line x1={0} x2={plotW} y1={sy(average)} y2={sy(average)} className="ch-avg" />}
        </svg>
      )}
      {width > 0 && tooltip && active !== null && bars[active] && (
        <ChartTip
          tip={tooltip(active)}
          x={active * slot + slot / 2}
          y={bottom - (bars[active].value > 0 ? Math.max(3, bottom - sy(bars[active].value)) : 2)}
          width={width}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ heatmap */

interface HeatmapProps {
  days: Map<string, DayStat>;
  thresholds: [number, number, number];
  /** at least this many week columns; the map always fills the available width */
  weeks?: number;
  cell?: number;
  gap?: number;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
  scrollable?: boolean;
}

export function Heatmap({ days, thresholds, weeks, cell = 14, gap = 3, selected, onSelect, scrollable }: HeatmapProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement>(null);
  const labelW = 26;
  const topH = 16;
  const today = startOfDay(Date.now());
  const fitWeeks = Math.max(4, Math.floor((width - labelW + gap) / (cell + gap)));
  const cols = Math.max(fitWeeks, weeks ?? 0);
  const firstMonday = addDays(startOfWeek(today), -(cols - 1) * 7);
  const svgW = labelW + cols * (cell + gap) - gap;
  const svgH = topH + 7 * (cell + gap) - gap;

  useEffect(() => {
    if (scrollable && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [scrollable, cols, width]);

  const cells: { key: string; x: number; y: number; level: number; future: boolean; today: boolean }[] = [];
  const months: { x: number; label: string }[] = [];
  let lastMonth = -1;
  let lastLabelCol = -10;
  for (let c = 0; c < cols; c++) {
    const monday = addDays(firstMonday, c * 7);
    for (let r = 0; r < 7; r++) {
      const d = addDays(monday, r);
      const key = dayKey(d);
      const stat = days.get(key);
      cells.push({
        key,
        x: labelW + c * (cell + gap),
        y: topH + r * (cell + gap),
        level: heatLevel(stat?.sets ?? 0, thresholds),
        future: d > today,
        today: d === today,
      });
      const dt = new Date(d);
      if (dt.getDate() <= 7 && r === 0 && dt.getMonth() !== lastMonth) {
        lastMonth = dt.getMonth();
        if (c - lastLabelCol >= 3) {
          months.push({ x: labelW + c * (cell + gap), label: fmtMonth(d) });
          lastLabelCol = c;
        }
      }
    }
  }

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const key = (e.target as Element).getAttribute('data-key');
    if (!onSelect) return;
    onSelect(key && key !== selected ? key : null);
  };

  const svg =
    width > 0 ? (
      <svg width={svgW} height={svgH} className="heat-svg" onClick={handleClick}>
        {months.map((m) => (
          <text key={m.x} x={m.x} y={10} className="ch-label">
            {m.label}
          </text>
        ))}
        {[0, 2, 4].map((r) => (
          <text key={r} x={0} y={topH + r * (cell + gap) + cell * 0.72} className="ch-label">
            {WEEKDAYS_SHORT[r]}
          </text>
        ))}
        {cells.map((c) =>
          c.future ? null : (
            <rect
              key={c.key}
              data-key={c.key}
              x={c.x}
              y={c.y}
              width={cell}
              height={cell}
              rx={Math.max(2, cell * 0.24)}
              className={`hc h${c.level}${c.today ? ' today' : ''}${selected === c.key ? ' sel' : ''}`}
            />
          ),
        )}
      </svg>
    ) : null;

  return (
    <div ref={ref} className="heat">
      {scrollable ? (
        <div className="heat-scroll" ref={scroller}>
          {svg}
        </div>
      ) : (
        svg
      )}
    </div>
  );
}

export function HeatLegend() {
  return (
    <span className="heat-legend" aria-label="Fewer sets to more sets">
      <span>Less</span>
      {[0, 1, 2, 3, 4].map((l) => (
        <i key={l} className={`h${l}`} />
      ))}
      <span>More</span>
    </span>
  );
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({ values, width = 64, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 3;
  const pts = values.map(
    (v, i) =>
      [pad + (i / (values.length - 1)) * (width - pad * 2), pad + (1 - (v - min) / (max - min || 1)) * (height - pad * 2)] as [number, number],
  );
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <path d={monotonePath(pts)} className="spark-line" fill="none" />
      <circle cx={last[0]} cy={last[1]} r={2.4} className="spark-end" />
    </svg>
  );
}

/* ------------------------------------------------------------ split bar */

const SPLIT_TONES = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];

export function SplitBar({ parts }: { parts: { key: string; value: number }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="split">
      {parts.map((p, i) => (
        <span key={p.key} className={`split-seg ${SPLIT_TONES[i % SPLIT_TONES.length]}`} style={{ flexGrow: p.value / total }} />
      ))}
    </div>
  );
}

export const splitTone = (i: number) => SPLIT_TONES[i % SPLIT_TONES.length];
