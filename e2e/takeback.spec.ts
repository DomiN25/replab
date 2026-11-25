// E2E: Repertoirezug zurücknehmen – zwei Bestätigungen, Anzahl der mitgelöschten Züge, Schutz gegen Doppelklick.
import { test, expect } from '@playwright/test';
import { mockExplorer, move } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b';

test('Zug zurücknehmen mit doppelter Bestätigung', async ({ page }) => {
  await mockExplorer(page, {
    [START]: [['e2e4', 'e4', 5000]],
    [AFTER_E4]: [
      ['e7e5', 'e5', 600],
      ['c7c5', 'c5', 400],
    ],
    [AFTER_NF3]: [['b8c6', 'Nc6', 700]],
  });
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Test Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const token = page.getByPlaceholder('lip_…');
  await token.fill('lip_e2e_test');
  await token.blur();
  await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
  await page.getByRole('button', { name: /Stockfish an/ }).click();

  const takeback = page.getByTestId('takeback');
  await expect(takeback).toBeDisabled(); // noch kein eigener Zug

  await move(page, 'e2e4');
  await page.locator('.mvbtn.opp', { hasText: 'e5' }).click();
  await move(page, 'g1f3');
  await expect(page.getByTestId('gap-count')).toHaveText('2');

  // Hinter 2.Sf3: zurücknehmen betrifft nur diesen Zug – Abbrechen ändert nichts
  await takeback.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('2.Sf3 wird aus dem Repertoire entfernt');
  await expect(page.getByTestId('takeback-more')).toContainText('Weitere Züge sind nicht betroffen');
  await dlg.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId('gap-count')).toHaveText('2');

  // Am Anfang: 1.e4 zurücknehmen nimmt 2.Sf3 mit
  await page.getByRole('button', { name: 'Zum Anfang' }).click();
  await takeback.click();
  await expect(dlg).toContainText('1.e4 wird aus dem Repertoire entfernt');
  await expect(page.getByTestId('takeback-more')).toContainText('1 weiterer eigener Zug');
  await dlg.getByRole('button', { name: 'Weiter' }).click();
  await expect(dlg).toContainText('Wirklich löschen?');
  // sofortiger Klick (wie ein Doppelklick) wird ignoriert
  await dlg.getByRole('button', { name: 'Ja, 2 Züge löschen' }).click();
  await expect(dlg).toContainText('Wirklich löschen?');
  await page.waitForTimeout(700);
  await dlg.getByRole('button', { name: 'Ja, 2 Züge löschen' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('1.e4 und 1 weiterer Zug gelöscht');
  await expect(takeback).toBeDisabled();

  // Wirklich weg – auch nach Neuladen
  await page.reload();
  await expect(page.getByTestId('takeback')).toBeDisabled();
  await page.locator('.nav-top').getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toContainText('Einträge in „Test Weiß“');
});
