import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { nav, type Layer } from '../lib/nav';
import { IconButton } from './ui';

export function Page({
  layer,
  title,
  actions,
  children,
}: {
  layer: Layer;
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <div
      className={`layer page${layer.closing ? ' leaving' : ''}`}
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 56)}
    >
      <div className={`page-bar${scrolled ? ' scrolled' : ''}`}>
        <IconButton icon="chevronLeft" label="Back" onClick={() => nav.back()} />
        <div className="page-bar-title">{title}</div>
        <div className="head-actions" style={{ minWidth: 40, justifyContent: 'flex-end' }}>
          {actions}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Sheet({
  layer,
  title,
  tall,
  headRight,
  top,
  actions,
  children,
  onClose = () => nav.back(),
}: {
  layer: Layer;
  title?: string;
  tall?: boolean;
  headRight?: ReactNode;
  /** fixed content between the title and the scrolling body */
  top?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number; t: number } | null>(null);

  const handlers = {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      if ((e.target as Element).closest('button, input')) return;
      drag.current = { y: e.clientY, dy: 0, t: Date.now() };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      const el = ref.current;
      if (!d || !el) return;
      d.dy = Math.max(0, e.clientY - d.y);
      el.style.transition = 'none';
      el.style.transform = `translateY(${d.dy}px)`;
    },
    onPointerUp: () => {
      const d = drag.current;
      const el = ref.current;
      drag.current = null;
      if (!d || !el) return;
      const fast = d.dy > 40 && Date.now() - d.t < 220;
      if (d.dy > 120 || fast) {
        onClose();
      } else {
        el.style.transition = 'transform .3s var(--ease-out)';
        el.style.transform = '';
      }
    },
  };

  return (
    <div className={`layer sheet-layer${layer.closing ? ' leaving' : ''}`}>
      <div className="backdrop" onClick={onClose} />
      <div className={`sheet${tall ? ' tall' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grab" {...handlers} onPointerCancel={handlers.onPointerUp} />
        {(title || headRight) && (
          <div className="sheet-head" {...handlers} onPointerCancel={handlers.onPointerUp}>
            <h2 className="sheet-title">{title}</h2>
            {headRight}
          </div>
        )}
        {top && <div className="sheet-top">{top}</div>}
        {children !== undefined && <div className="sheet-body">{children}</div>}
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>
  );
}
