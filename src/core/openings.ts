// Eröffnungsnamen und -familien. Englische Lichess/ECO-Namen werden für die Familie übersetzt.

const FAMILY_DE: Record<string, string> = {
  'Ruy Lopez': 'Spanisch',
  'Sicilian Defense': 'Sizilianisch',
  'French Defense': 'Französisch',
  'Caro-Kann Defense': 'Caro-Kann',
  'Scandinavian Defense': 'Skandinavisch',
  'Pirc Defense': 'Pirc',
  'Modern Defense': 'Modern',
  'Alekhine Defense': 'Aljechin',
  "Petrov's Defense": 'Russisch (Petrow)',
  'Russian Game': 'Russisch (Petrow)',
  'Philidor Defense': 'Philidor',
  'Italian Game': 'Italienisch',
  'Scotch Game': 'Schottisch',
  "King's Gambit": 'Königsgambit',
  "King's Gambit Accepted": 'Königsgambit',
  "King's Gambit Declined": 'Königsgambit',
  'Vienna Game': 'Wiener Partie',
  'Four Knights Game': 'Vierspringerspiel',
  'Three Knights Opening': 'Dreispringerspiel',
  "Queen's Gambit Declined": 'Abgelehntes Damengambit',
  "Queen's Gambit Accepted": 'Angenommenes Damengambit',
  "Queen's Gambit": 'Damengambit',
  'Slav Defense': 'Slawisch',
  'Semi-Slav Defense': 'Semi-Slawisch',
  'Nimzo-Indian Defense': 'Nimzo-Indisch',
  "Queen's Indian Defense": 'Damenindisch',
  "King's Indian Defense": 'Königsindisch',
  "King's Indian Attack": 'Königsindischer Angriff',
  'Grünfeld Defense': 'Grünfeld',
  'English Opening': 'Englisch',
  'Réti Opening': 'Réti',
  'London System': 'London-System',
  'Catalan Opening': 'Katalanisch',
  'Dutch Defense': 'Holländisch',
  'Benoni Defense': 'Benoni',
  'Modern Benoni': 'Benoni',
  'Benko Gambit': 'Benkö-Gambit',
  'Bird Opening': 'Bird',
  'Nimzowitsch Defense': 'Nimzowitsch-Verteidigung',
  'Owen Defense': 'Owen',
  "Queen's Pawn Game": 'Damenbauernspiel',
  "King's Pawn Game": 'Offene Spiele',
  'Zukertort Opening': 'Zukertort',
  'Trompowsky Attack': 'Trompowsky',
  'Blackmar-Diemer Gambit': 'Blackmar-Diemer',
  'Bogo-Indian Defense': 'Bogoljubow-Indisch',
  'Nimzo-Larsen Attack': 'Larsen',
  'Polish Opening': 'Polnisch',
  'Bishop\'s Opening': 'Läuferspiel',
  'Center Game': 'Mittelgambit',
  'Danish Gambit': 'Nordisches Gambit',
  'Ponziani Opening': 'Ponziani',
  'Elephant Gambit': 'Elefantengambit',
  'Latvian Gambit': 'Lettisches Gambit',
  'Englund Gambit': 'Englund-Gambit',
  'Budapest Defense': 'Budapester Gambit',
  'Old Indian Defense': 'Altindisch',
  'Indian Defense': 'Indisch',
  'Tarrasch Defense': 'Tarrasch',
  'Hungarian Opening': 'Ungarisch',
  'Van Geet Opening': 'Dunst',
  'Ware Defense': 'Ware',
  "St. George Defense": 'St.-Georg',
  'Rat Defense': 'Rat',
  'Colle System': 'Colle',
  'Richter-Veresov Attack': 'Veresov',
  'Torre Attack': 'Torre',
  'Mieses Opening': 'Mieses',
  'Robatsch (Modern) Defense': 'Modern',
  "King's Knight Opening": 'Königsspringerspiel',
  'Sicilian Defense: Alapin Variation': 'Sizilianisch',
  'Semi-Slav Defense Accepted': 'Semi-Slawisch',
  "Queen's Gambit Refused": 'Abgelehntes Damengambit',
  'Kings Pawn Opening': 'Offene Spiele',
  'Indian Game': 'Indisch',
  'Pterodactyl Defense': 'Pterodactylus',
  'Nimzo-Larsen Attack: Modern Variation': 'Larsen',
  'Horwitz Defense': 'Horwitz',
  'Mikenas Defense': 'Mikenas',
  'Petrov Defense': 'Russisch (Petrow)',
};

/** Familienteil eines Lichess-Eröffnungsnamens ("Ruy Lopez: Morphy Defense" → "Ruy Lopez"). */
export function familyPart(name: string): string {
  return name.split(':')[0].trim();
}

/** Deutsche Familie, falls bekannt, sonst der englische Familienteil. */
export function familyDe(name: string): string {
  const fam = familyPart(name);
  return FAMILY_DE[fam] ?? fam;
}

// Häufige Begriffe in Variantennamen (Lichess, englisch). Reihenfolge: längere Wendungen zuerst.
const TERMS_DE: [RegExp, string][] = [
  [/\bMain Line\b/g, 'Hauptvariante'],
  [/\bModern Variation\b/g, 'Moderne Variante'],
  [/\bClassical Variation\b/g, 'Klassische Variante'],
  [/\bExchange Variation\b/g, 'Abtauschvariante'],
  [/\bAdvance Variation\b/g, 'Vorstoßvariante'],
  [/\bClosed Variation\b/g, 'Geschlossene Variante'],
  [/\bOpen Variation\b/g, 'Offene Variante'],
  [/\bNormal Variation\b/g, 'Normalvariante'],
  [/\bAccepted\b/g, 'angenommen'],
  [/\bDeclined\b/g, 'abgelehnt'],
  [/\bVariation\b/g, 'Variante'],
  [/\bDefense\b/g, 'Verteidigung'],
  [/\bAttack\b/g, 'Angriff'],
  [/\bSystem\b/g, 'System'],
  [/\bLine\b/g, 'Linie'],
  [/\bOpening\b/g, 'Eröffnung'],
  [/\bCounterattack\b/g, 'Gegenangriff'],
  [/\bCountergambit\b/g, 'Gegengambit'],
  [/\bDeferred\b/g, 'verzögert'],
  [/\bReversed\b/g, 'mit vertauschten Farben'],
  [/\bExchange\b/g, 'Abtausch'],
  [/\bAdvance\b/g, 'Vorstoß'],
];

/** Variantenteil eindeutschen ("Morphy Defense, Modern Steinitz Defense" → "Morphy-Verteidigung, …"). */
export function termsDe(s: string): string {
  let out = s;
  for (const [re, de] of TERMS_DE) out = out.replace(re, de);
  // „Morphy Verteidigung“ → „Morphy-Verteidigung“ (Eigenname + Begriff)
  return out.replace(/\b([A-ZÄÖÜ][\wäöüß'’.-]+) (Verteidigung|Variante|Angriff|Gambit|System|Linie|Gegenangriff)\b/g, '$1-$2');
}

/** Ganzen Namen mit übersetzter Familie und eingedeutschten Begriffen: "Spanisch: Morphy-Verteidigung". */
export function nameDe(name: string): string {
  const fam = familyPart(name);
  const rest = name.slice(fam.length);
  return (FAMILY_DE[fam] ?? fam) + termsDe(rest);
}
