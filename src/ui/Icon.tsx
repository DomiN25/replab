// Kleiner eigener Icon-Satz (24er-Raster, Strich 2) statt Unicode-Zeichen,
// die jedes Gerät anders zeichnet (Android teils als bunte Emoji).
const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  // Verzweigung = Repertoire-Baum
  tree: 'M6 3v18M6 16c0-5.5 12-3 12-8M18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  // gestrichelter Kreis = Lücke
  gap: 'M12 3a9 9 0 0 1 3.4.67M19.3 6.6A9 9 0 0 1 21 12M20.3 15.4a9 9 0 0 1-2.4 3.4M15.4 20.3A9 9 0 0 1 12 21M8.6 20.3a9 9 0 0 1-3.4-2.4M3.7 15.4A9 9 0 0 1 3 12M3.7 8.6a9 9 0 0 1 2.4-3.4M8.6 3.7 M12 12h.01',
  train: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
  more: 'M4 7h10M18 7h2M4 17h4M12 17h8 M16 5v4 M10 15v4',
  first: 'M6 5v14M18 6l-7 6 7 6',
  prev: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  flip: 'M7 4v15M7 4 3.5 7.5M7 4l3.5 3.5M17 20V5m0 15-3.5-3.5M17 20l3.5-3.5',
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  auto: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  bolt: 'M13 3 5 13.5h6L10 21l8-11h-6z',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`ico ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
