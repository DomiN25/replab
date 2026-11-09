import { useEffect, useRef, type ReactNode } from 'react';
import { useBackClose } from './backClose';

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'danger' | 'ghost';
  onClick: () => void;
}

export function Modal({ title, children, actions, onClose }: { title: string; children?: ReactNode; actions: ModalAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useBackClose(true, () => close.current());
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') trapFocus(e, ref.current);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children && <div className="modal-body">{children}</div>}
        <div className="modal-actions">
          {actions.map((a) => (
            <button key={a.label} className={`btn ${a.kind ?? ''}`} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Tab bleibt im Dialog (Fokus-Fang). */
export function trapFocus(e: KeyboardEvent, box: HTMLElement | null) {
  if (!box) return;
  const items = [...box.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
