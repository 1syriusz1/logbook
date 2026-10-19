import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { fmtKg, fmtNum, parseNum } from '../lib/format';
import { haptic } from '../lib/platform';

/* ------------------------------------------------------------ buttons */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  block?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon, block, className = '', children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 17 : 19} />}
      {children && <span>{children}</span>}
    </button>
  );
}

interface IconBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  tone?: 'default' | 'plain' | 'inverse';
  size?: number;
}

export function IconButton({ icon, label, tone = 'default', size = 40, className = '', style, ...rest }: IconBtnProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn icon-btn-${tone} ${className}`}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </button>
  );
}

/* ------------------------------------------------------------ segmented */

interface SegOption<T> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  label,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      className={`seg seg-${size}`}
      role="tablist"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <span
        className="seg-thumb"
        style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => {
            if (o.value !== value) {
              haptic.tick();
              onChange(o.value);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ chips */

export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`chip${o.value === value ? ' on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ stepper */

function useRepeat(fn: () => void) {
  const timer = useRef<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const stop = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => stop, []);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      fnRef.current();
      stop();
      timer.current = window.setTimeout(() => {
        timer.current = window.setInterval(() => fnRef.current(), 75);
      }, 420);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (e: React.MouseEvent) => {
      // keyboard activation (pointer taps are handled above)
      if (e.detail === 0) fnRef.current();
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

interface StepperProps {
  id: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  max?: number;
  unit: string;
  decimals?: number;
  integer?: boolean;
}

export function Stepper({ id, value, onChange, step, min = 0, max = 9999, unit, integer }: StepperProps) {
  const plain = (v: number) => (integer ? String(v) : fmtKg(v).replace(/\s/g, ''));
  const [text, setText] = useState(plain(value));
  const [focused, setFocused] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!focused) setText(plain(value));
  }, [value, focused, integer]);

  const clamp = (v: number) => {
    const r = integer ? Math.round(v) : Math.round(v * 100) / 100;
    return Math.min(max, Math.max(min, r));
  };
  const bump = (dir: 1 | -1) => {
    const cur = valueRef.current;
    // snap to the step grid when the value is off-grid (e.g. 81 with a 2.5 step)
    const snapped = dir > 0 ? Math.floor(cur / step + 1e-9) * step + step : Math.ceil(cur / step - 1e-9) * step - step;
    const next = clamp(snapped);
    if (next !== cur) {
      haptic.tick();
      onChange(next);
    }
  };
  const dec = useRepeat(() => bump(-1));
  const inc = useRepeat(() => bump(1));

  const commit = () => {
    const n = parseNum(text);
    setFocused(false);
    if (n === null) {
      setText(plain(value));
      return;
    }
    onChange(clamp(n));
  };

  return (
    <div className="stepper">
      <button type="button" className="stepper-btn" aria-label={`Decrease ${unit}`} {...dec}>
        <Icon name="minus" size={20} />
      </button>
      <label className="stepper-field" htmlFor={id}>
        <input
          id={id}
          className="stepper-input"
          inputMode={integer ? 'numeric' : 'decimal'}
          enterKeyHint="done"
          autoComplete="off"
          value={text}
          onFocus={(e) => {
            setFocused(true);
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="stepper-unit">{unit}</span>
      </label>
      <button type="button" className="stepper-btn" aria-label={`Increase ${unit}`} {...inc}>
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ small bits */

/** A number with a quieter unit: 82.5 kg */
export function Num({ value, unit, className = '' }: { value: ReactNode; unit?: string; className?: string }) {
  // Thousands groups get real breathing room at display sizes.
  const body =
    typeof value === 'string' && value.includes('\u00A0')
      ? value.split('\u00A0').map((g, i) => (
          <span key={i} className={i ? 'grp' : undefined}>
            {g}
          </span>
        ))
      : value;
  return (
    <span className={`num ${className}`}>
      {body}
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function PRBadge({ title }: { title?: string }) {
  return (
    <span className="pr" title={title ?? 'Personal record'}>
      PR
    </span>
  );
}

export function Delta({
  value,
  unit = '',
  invert = false,
  neutral = false,
  decimals = 1,
}: {
  value: number;
  unit?: string;
  invert?: boolean;
  /** direction carries no judgement (e.g. body weight) */
  neutral?: boolean;
  decimals?: number;
}) {
  if (!Number.isFinite(value) || Math.abs(value) < Math.pow(10, -decimals) / 2) return <span className="delta flat">±0{unit}</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  return (
    <span className={`delta ${neutral ? 'neutral' : good ? 'good' : 'bad'}`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} strokeWidth={2.2} />
      {fmtNum(Math.abs(value), decimals)}
      {unit}
    </span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
      {action}
    </div>
  );
}

export function SectionHead({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{children}</h2>
      {action}
    </div>
  );
}
