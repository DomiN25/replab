// E2E: Geführter Aufbau – zur flachsten Lücke, festlegen → automatisch weiter, ignorieren, Ende hier.
import { test, expect } from '@playwright/test';
import { mockExplorer, move } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b';

test('Geführt: Lücken der Reihe nach schließen', async ({ page }) => {
  await mockExplorer(page, {
    [START]: [['e2e4', 'e4', 5000]],
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
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Guide Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const token = page.getByPlaceholder('lip_…');
  await token.fill('lip_e2e_test');
  await token.blur();
  await page.locator('.nav-top').getByRole('button', { name: 'Bauen' }).click();
  await page.getByRole('button', { name: /Stockfish an/ }).click();

  // 1.e4 festlegen
  await move(page, 'e2e4');
  await page.getByRole('dialog').getByRole('button', { name: 'Festlegen' }).click();
  await expect(page.getByTestId('gap-count')).toHaveText('2');

  // Pfeile nach Häufigkeit mit Prozentangabe (Brett steht nach 1.e4, Gegner am Zug)
  await expect(page.locator('svg.cg-custom-svgs text', { hasText: '60' })).toHaveCount(1);
  await expect(page.locator('svg.cg-custom-svgs text', { hasText: '40' })).toHaveCount(1);

  // Geführt starten → flachste Lücke, bei gleicher Tiefe die häufigere: 1.e4 e5
  await page.getByRole('button', { name: 'Geführt: Lücken schließen' }).click();
  const guide = page.getByTestId('guide');
  await expect(guide.locator('.guide-line')).toContainText('1.e4 e5');
  await expect(page.getByTestId('guide-open')).toHaveText('2');

  // Zug am Brett → festlegen → automatisch zur nächsten flachsten Lücke (1.e4 c5)
  await move(page, 'g1f3');
  await page.getByRole('dialog').getByRole('button', { name: 'Festlegen' }).click();
  await expect(guide.locator('.guide-line')).toContainText('1.e4 c5');

  // 1…c5 als irrelevant markieren → weiter zu 2…Sc6
  await guide.getByRole('button', { name: /c5 ignorieren/ }).click();
  await expect(guide.locator('.guide-line')).toContainText('1.e4 e5 2.Sf3 Sc6');

  // Ende hier → weiter zu 2…Sf6; andere Gegnerzüge werden angezeigt
  await guide.getByRole('button', { name: 'Ende hier' }).click();
  await expect(guide.locator('.guide-line')).toContainText('1.e4 e5 2.Sf3 Sf6');
  await expect(guide.locator('.guide-sibs')).toContainText('Sc6');

  // Überspringen → keine Lücke mehr übrig
  await guide.getByRole('button', { name: 'Überspringen' }).click();
  await expect(guide).toContainText('Keine offene Lücke');
});
