// E2E: Studien-Vorschläge im Repertoire – die Studie sagt, was sie in der Stellung spielt; „Festlegen“ übernimmt den Zug.
import { test, expect } from '@playwright/test';

const STUDY = `[Event "tbg: Kapitel 1"]
[StudyName "tbg"]

1. e4 c5 2. Nf3 (2. c3 e5) (2. Nc3 Nc6 3. Bb5 (3. f4 e6) (3. g3 g6) 3... Nd4) (2. d4 cxd4 3. c3 e5) 2... Nc6 3. Bb5 (3. Nc3 e5) (3. c3 e5) 3... e5 *
`;

test('Vorschlag aus der Studie in der Stellung, direkt festlegen', async ({ page }) => {
  await page.route('https://lichess.org/api/study/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', headers: { 'Access-Control-Allow-Origin': '*' }, body: STUDY }),
  );
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Schwarz');
  await page.getByLabel('Farbe', { exact: true }).selectOption('black');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);
  await page.locator('.nav-top').getByRole('button', { name: 'Studien' }).click();
  await page.getByRole('button', { name: 'Studie hinzufügen' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Lichess-Studienlink').fill('https://lichess.org/study/BQvp2G0t');
  await dlg.getByRole('button', { name: 'Laden' }).click();
  await dlg.getByRole('button', { name: 'Als Studie speichern' }).click();
  await expect(page.locator('.learn-card')).toBeVisible();

  await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
  await expect(page.locator('.cg-wrap').first()).toHaveClass(/orientation-black/);
  await expect(page.getByTestId('study-sug')).toHaveCount(0); // Startstellung: Weiß am Zug, die Studie sagt dort nur e4
  await page.getByLabel('Zug eingeben').fill('e4');
  await page.getByLabel('Zug eingeben').press('Enter');
  await expect(page.locator('.crumbs')).toContainText('1.e4');
  const sug = page.getByTestId('study-sug');
  await expect(sug).toContainText('tbg');
  await expect(sug).toContainText('c5');
  await sug.getByRole('button', { name: 'Festlegen' }).click();
  await expect(page.locator('.toast')).toContainText('festgelegt');
  await expect(page.locator('.answer .mv')).toContainText('c5');
});
