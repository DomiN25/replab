// „Inert“: Eine Seite wird nur als Vorschau neben der aktuellen gezeigt (Nachbarseite beim Wischen).
// Vorschau-Seiten dürfen nichts anstoßen: keine Engine, keine Datenbank-Abfragen, keine Automatik, die Zustand verändert.
import { createContext, useContext } from 'react';

export const InertContext = createContext(false);
export const useInert = () => useContext(InertContext);
