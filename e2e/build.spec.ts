// E2E (1): Repertoire bauen – Zug festlegen → Lücke verschwindet, neue Lücken erscheinen.
import { test, expect } from '@playwright/test';
import { mockExplorer, move } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b';

test('Zug festlegen → Lücke verschwindet', async ({ page }) => {
  await mockExplorer(page, {
    [START]: [
      ['e2e4', 'e4', 5000],
      ['d2d4', 'd4', 4000],
    ],
    [AFTER_E4]: [
      ['e7e5', 'e5', 600],
      ['c7c5', 'c5', 400],
    ],
    [AFTER_NF3]: [
      ['b8c6', 'Nc6', 700],
      ['g8f6', 'Nf6', 300],
    ],
  });
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Test Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  // Test-Token (kein echter Token; Anfragen gehen an den Mock)
  const token = page.getByPlaceholder('lip_…');
  await token.fill('lip_e2e_test');
  await token.blur();

  await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
  // Engine aus, damit die Engine-Regel das Ergebnis nicht verändert
  await page.getByRole('button', { name: /Stockfish an/ }).click();

  // Neuer eigener Zug am Brett: direkt festgelegt (kein Dialog), Kurzmeldung mit „Rückgängig“
  await move(page, 'e2e4');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('1.e4 festgelegt');
  await expect(page.getByTestId('gap-count')).toHaveText('2');

  // 1…e5 ansehen, 2.Sf3 festlegen – und einmal rückgängig machen
  await page.locator('.mvbtn.opp', { hasText: 'e5' }).click();
  await move(page, 'g1f3');
  await expect(page.getByTestId('gap-count')).toHaveText('3');
  await page.locator('.toast').getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByTestId('gap-count')).toHaveText('2');
  await expect(page.locator('.crumbs .cur')).toHaveText('e5'); // Brett steht wieder vor der Entscheidung
  await move(page, 'g1f3');

  // Lücke „1.e4 e5“ weg; neue Lücken nach 2.Sf3 (Sc6, Sf6) + weiterhin 1…c5
  await expect(page.getByTestId('gap-count')).toHaveText('3');
  await page.locator('.nav-top').getByRole('button', { name: 'Lücken' }).click();
  const lines = await page.locator('.gapfam .line').allInnerTexts();
  expect(lines.sort()).toEqual(['1.e4 c5', '1.e4 e5 2.Sf3 Sc6', '1.e4 e5 2.Sf3 Sf6']);

  // Suche: Zugfolge deutsch → Stellung; Treffer springt hin
  await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
  await page.getByRole('button', { name: /Im Repertoire suchen/ }).click();
  await page.getByLabel('Suchbegriff').fill('Sf3 Sc6');
  await page.locator('.search-hits button').first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.crumbs .cur')).toHaveText('Sc6');
  // Erkunden: ein Zug am Brett in einer eigenen Stellung ohne Eintrag wird nur angesehen, nicht festgelegt
  await page.getByTestId('explore').click();
  await move(page, 'f1b5');
  await expect(page.locator('.crumbs .cur')).toHaveText('3.Lb5');
  await expect(page.locator('.toast').getByRole('button', { name: 'Rückgängig' })).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('gap-count')).toHaveText('3'); // unverändert – nichts festgelegt
  await page.getByTestId('explore').click(); // wieder aus
  // Zug tippen (deutsch) + Enter
  await page.getByRole('button', { name: 'Zum Anfang' }).click();
  await page.getByLabel('Zug eingeben').fill('Sf3');
  await page.getByLabel('Zug eingeben').press('Enter');
  await expect(page.locator('.crumbs .cur')).toHaveText('1.Sf3');
  await expect(page.getByTestId('outside')).toContainText('Dein Repertoire spielt 1.e4');

  // Nach Neuladen ist alles noch da (M1)
  await page.reload();
  await expect(page.getByTestId('gap-count')).toHaveText('3');
});
