// E2E: Im Training steht nach der Antwort, aus welcher Studie der Zug stammt; Markieren als wichtig geht auch dort.
import { test, expect } from '@playwright/test';
import { mockExplorer, move } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';

test('Training: Studien-Herkunft und Markieren', async ({ page }) => {
  await mockExplorer(page, { [START]: [['e2e4', 'e4', 5000]] });
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);

  // Studie per PGN-Text
  await page.locator('.nav-top').getByRole('button', { name: 'Studien' }).click();
  await page.getByRole('button', { name: 'Studie hinzufügen' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea').fill('[Event "Test"]\n[White "Ich"]\n[Black "?"]\n\n1. e4 {Mein Lieblingszug} e5 2. Nf3 *');
  await dlg.getByPlaceholder('z. B. Anti-Sizilianer').fill('Offene Spiele');
  await dlg.getByRole('button', { name: 'Als Studie speichern' }).click();
  await expect(dlg).toHaveCount(0);

  // 1.e4 im Repertoire festlegen
  await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
  await move(page, 'e2e4');
  await expect(page.locator('.toast')).toContainText('festgelegt');

  // Training: neu lernen → nach der Antwort steht die Studie
  await page.locator('.nav-top').getByRole('button', { name: 'Training' }).click();
  await page.getByRole('button', { name: /neu lernen/ }).click();
  const trainer = page.locator('.trainer');
  await expect(trainer).not.toHaveAttribute('data-phase', 'context', { timeout: 15000 });
  await move(page, 'e2e4');
  await expect(page.getByTestId('study-origin')).toContainText('Aus deiner Studie „Offene Spiele“');
  await expect(page.getByTestId('study-origin')).toContainText('Mein Lieblingszug');

  // als wichtig markieren → Plakette in der Abfrage
  const imp = page.getByTestId('train-marks').getByRole('button', { name: 'Wichtig' });
  await imp.click();
  await expect(imp).toHaveAttribute('aria-pressed', 'true');
});
