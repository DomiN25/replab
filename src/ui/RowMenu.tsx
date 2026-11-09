// ⋯-Menü für Listenzeilen: Knopf mit Punkte-Symbol, Klappmenü mit Aktionen.
// Tippen daneben oder Esc schließt; ein Klick auf einen Eintrag schließt ebenfalls.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span className="rowmenu" ref={ref}>
      <button className="dots" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="dots" />
      </button>
      {open && (
        <span className="rowmenu-pop" role="menu" onClick={() => setOpen(false)}>
          {children}
        </span>
      )}
    </span>
  );
}
