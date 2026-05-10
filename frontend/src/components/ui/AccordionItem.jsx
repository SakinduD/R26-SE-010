import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * AccordionItem — single expandable item.
 *
 * Props:
 *   title       — main label (rendered next to chevron)
 *   subtitle    — optional caption below title
 *   badge       — optional node (e.g. <Badge variant="warning">)
 *   defaultOpen — boolean
 *   open        — controlled open state (optional)
 *   onToggle    — (next) => void (optional)
 *   children    — body content
 */
export default function AccordionItem({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  open,
  onToggle,
  className,
  children,
  ...rest
}) {
  const isControlled = typeof open === 'boolean';
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = isControlled ? open : internalOpen;

  const bodyRef = useRef(null);
  const [maxH, setMaxH] = useState(isOpen ? 'none' : '0px');

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (isOpen) {
      // Set to scrollHeight then to 'none' after transition for natural sizing
      const h = el.scrollHeight;
      setMaxH(`${h}px`);
      const t = setTimeout(() => setMaxH('none'), 260);
      return () => clearTimeout(t);
    } else {
      // First fix to current height, then to 0 on next frame
      const h = el.scrollHeight;
      setMaxH(`${h}px`);
      requestAnimationFrame(() => setMaxH('0px'));
    }
  }, [isOpen]);

  const toggle = () => {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  };

  return (
    <div className={cn('acc-item', className)} data-open={isOpen} {...rest}>
      <button
        type="button"
        className="acc-head"
        onClick={toggle}
        aria-expanded={isOpen}
        style={{ width: '100%', background: 'transparent', border: 0, color: 'inherit' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span className="acc-chev">
            <ChevronRight size={14} strokeWidth={1.6} />
          </span>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <div className="fg" style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
            {subtitle && (
              <div className="t-cap" style={{ marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
        </div>
        {badge && <span style={{ flexShrink: 0 }}>{badge}</span>}
      </button>
      <div
        ref={bodyRef}
        className="acc-body"
        style={{ maxHeight: maxH }}
        aria-hidden={!isOpen}
      >
        <div style={{ padding: '0 0 14px 24px' }}>{children}</div>
      </div>
    </div>
  );
}

export { AccordionItem };
