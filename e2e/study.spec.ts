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

  await page.getByRole('button', { name: 'PGN importieren' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Lichess-Studienlink').fill('https://lichess.org/study/BQvp2G0t');
  await dlg.getByRole('button', { name: 'Laden' }).click();
  await expect(dlg).toContainText('Studie ist für Schwarz – erkannt aus den Varianten');
  await expect(dlg.locator('select').last()).toHaveValue(/.+/);
  await expect(dlg.locator('select').last().locator('option:checked')).toContainText('Schwarz');

  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await expect(dlg.locator('.preview')).toContainText('+');
  await expect(dlg).not.toContainText('Achtung');
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  // Ansicht springt zum gemeinsamen Anfang der Kapitel: 1.e4 c5 2.Sf3 Sc6 3.Lb5 e5
  await expect(page).toHaveURL(/#\/build/);
  await expect(page.locator('.crumbs')).toContainText('Lb5');
  await expect(page.locator('.crumbs')).toContainText('e5');
});
