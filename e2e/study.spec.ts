// E2E: Lichess-Studie per Link (ohne Orientation-Header, Schwarz-Sicht) → Farbe erkannt, Import, Sprung zur Studie.
import { test, expect } from '@playwright/test';

const STUDY = `[Event "tbg: Kapitel 1"]
[StudyName "tbg"]

1. e4 c5 2. Nf3 (2. c3 e5) (2. Nc3 Nc6 3. Bb5 (3. f4 e6) (3. g3 g6) 3... Nd4) (2. d4 cxd4 3. c3 e5) 2... Nc6 3. Bb5 (3. Nc3 e5) (3. c3 e5) 3... e5 *

[Event "tbg: Kapitel 2"]
[StudyName "tbg"]

1. e4 c5 2. Nf3 Nc6 3. Bb5 e5 4. O-O (4. Bxc6 dxc6) 4... Bd6 *
`;

test('Studie per Link: Schwarz erkannt, importiert, Sprung zur Studie', async ({ page }) => {
  await page.route('https://lichess.org/api/study/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', headers: { 'Access-Control-Allow-Origin': '*' }, body: STUDY }),
  );
  await page.goto('/#/settings');
  // zwei Repertoires: Weiß (zuerst, wäre ohne Erkennung das Ziel) und Schwarz
  const name = page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4');
  await name.fill('Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1); // sonst leert das Anlegen das nächste Namensfeld
  await name.fill('Schwarz');
  await page.getByLabel('Farbe', { exact: true }).selectOption('black');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(2);

  await page.getByRole('button', { name: 'PGN direkt ins Repertoire' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Lichess-Studienlink').fill('https://lichess.org/study/BQvp2G0t');
  await dlg.getByRole('button', { name: 'Laden' }).click();
  await expect(dlg).toContainText('Studie ist für Schwarz – erkannt aus den Varianten');
  await expect(dlg.locator('select').last()).toHaveValue(/.+/);
  await expect(dlg.locator('select').last().locator('option:checked')).toContainText('Schwarz');

  // Bei Studien-Links ist „Als Studie speichern“ die Hauptaktion; hier der direkte Weg
  await expect(dlg.getByRole('button', { name: 'Als Studie speichern' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Direkt ins Repertoire' }).click();
  await expect(dlg.locator('.preview')).toContainText('+');
  await expect(dlg).not.toContainText('Achtung');
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  // Ansicht springt zum gemeinsamen Anfang der Kapitel: 1.e4 c5 2.Sf3 Sc6 3.Lb5 e5
  await expect(page).toHaveURL(/#\/build/);
  await expect(page.locator('.crumbs')).toContainText('Lb5');
  await expect(page.locator('.crumbs')).toContainText('e5');
});

test('Studien-Reiter: hinzufügen, Ast entfernen, Kapitel abwählen, übernehmen', async ({ page }) => {
  await page.route('https://lichess.org/api/study/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', headers: { 'Access-Control-Allow-Origin': '*' }, body: STUDY }),
  );
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Schwarz');
  await page.getByLabel('Farbe', { exact: true }).selectOption('black');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);

  await page.locator('.nav-top').getByRole('button', { name: 'Studien' }).click();
  // Zurück-Taste schließt den Dialog, die Ansicht bleibt
  await page.getByRole('button', { name: 'Studie hinzufügen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/studies/);
  await page.getByRole('button', { name: 'Studie hinzufügen' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Lichess-Studienlink').fill('https://lichess.org/study/BQvp2G0t');
  await dlg.getByRole('button', { name: 'Laden' }).click();
  await expect(dlg.getByPlaceholder('z. B. Anti-Sizilianer')).toHaveValue('tbg');
  await expect(dlg).toContainText('erkannt: Schwarz');
  await dlg.getByRole('button', { name: 'Als Studie speichern' }).click();

  // Editor: Start → 1.e4 → 1…c5 (eigener Zug, wird übernommen)
  const moves = page.locator('.study-moves');
  await expect(moves).toContainText('1.e4');
  await moves.locator('.smove-go', { hasText: '1.e4' }).click();
  await expect(moves.locator('.smove', { hasText: 'c5' })).toContainText('wird übernommen');
  await moves.locator('.smove-go', { hasText: 'c5' }).click();

  // Gegnerzüge nach 1…c5: Alapin (2.c3) entfernen
  await expect(moves).toContainText('2.c3');
  const before = await page.locator('.study-stats').innerText();
  await moves.locator('.smove', { hasText: '2.c3' }).getByRole('button', { name: /entfernen/ }).click();
  await expect(moves.locator('.smove', { hasText: '2.c3' })).toContainText('entfernt');
  await expect(page.locator('.study-stats')).not.toHaveText(before);

  // weiter in die Hauptlinie: 2.Sf3 Sc6 → 3.Lb5 ist da
  await moves.locator('.smove-go', { hasText: '2.Sf3' }).click();
  await moves.locator('.smove-go', { hasText: 'Sc6' }).click();
  await expect(moves).toContainText('3.Lb5');

  // Position und Fortschritt bleiben gespeichert: Liste und zurück → wieder bei 2…Sc6
  await expect(page.locator('.study-progress')).toContainText('/');
  const progress = await page.locator('.study-progress').innerText();
  await page.locator('.nav-top').getByRole('button', { name: 'Studien' }).click();
  await expect(page.locator('.study-list')).toBeVisible();
  await page.locator('.study-open', { hasText: 'tbg' }).click();
  await expect(page.locator('.crumbs')).toContainText('Sc6');
  await expect(page.locator('.study-progress')).toHaveText(progress);
  // Variantenleiste unter dem Brett und „Offen“ (nächste nicht angesehene Variante)
  await page.locator('.var-chip', { hasText: '3.Lb5' }).click();
  await expect(page.locator('.crumbs')).toContainText('Lb5');
  await page.getByRole('button', { name: /^Offen/ }).click();
  await expect(page.locator('.study-progress')).not.toHaveText(progress);

  // Kapitel abwählen und wieder an
  await page.getByRole('tab', { name: /Kapitel/ }).click();
  const k2 = page.locator('.study-chapters li', { hasText: 'Kapitel 2' }).getByRole('checkbox');
  await k2.uncheck();
  await expect(page.getByRole('tab', { name: /Kapitel/ })).toContainText('1/2');
  await k2.check();
  await page.getByRole('tab', { name: 'Züge' }).click();

  // Übernehmen → springt zu „Bauen“ am Studienanfang
  await page.getByRole('button', { name: 'Zum Repertoire hinzufügen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page).toHaveURL(/#\/build/);
  await expect(page.locator('.crumbs')).toContainText('c5');

  // Studie bleibt in der Liste, mit Vermerk
  await page.locator('.nav-top').getByRole('button', { name: 'Studien' }).click();
  await expect(page.locator('.study-head')).toBeVisible(); // zuletzt bearbeitete Studie bleibt offen
  await page.locator('.nav-top').getByRole('button', { name: 'Studien' }).click(); // nochmal → Liste
  await expect(page.locator('.study-list')).toContainText('übernommen');
});

