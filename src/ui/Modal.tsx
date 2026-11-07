import { useEffect, useRef, type ReactNode } from 'react';

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'danger' | 'ghost';
  onClick: () => void;
}

export function Modal({ title, children, actions, onClose }: { title: string; children?: ReactNode; actions: ModalAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
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
