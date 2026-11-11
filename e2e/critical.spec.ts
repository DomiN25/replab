// E2E: Kritische Stellung markieren → „Ab hier weiterbauen“ (Lückentour nur darunter) und Liste unter Lücken.
import { test, expect } from '@playwright/test';
import { mockExplorer, move } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w';

test('Kritische Stellung markieren und ab hier weiterbauen', async ({ page }) => {
  await mockExplorer(page, {
    [START]: [['e2e4', 'e4', 5000]],
    [AFTER_E4]: [
      ['e7e5', 'e5', 600],
      ['c7c5', 'c5', 400],
    ],
    [AFTER_E5]: [['g1f3', 'Nf3', 900]],
  });
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Krit Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const token = page.getByPlaceholder('lip_…');
  await token.fill('lip_e2e_test');
  await token.blur();
  await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
  await page.getByRole('button', { name: /Stockfish an/ }).click();

  await move(page, 'e2e4'); // festlegen
  await expect(page.getByTestId('gap-count')).toHaveText('2');
  await move(page, 'e7e5'); // Gegnerzug ansehen
  await expect(page.locator('.crumbs')).toContainText('e5');

  await page.getByTestId('crit-toggle').click();
  await expect(page.getByTestId('crit-toggle')).toHaveAttribute('aria-pressed', 'true');

  // ab hier weiterbauen: Lückentour nur unterhalb von 1.e4 e5 (1…c5 gehört nicht dazu)
  await page.getByTestId('focus-here').click();
  const guide = page.getByTestId('guide');
  await expect(guide.locator('.guide-line')).toContainText('1.e4 e5');
  await expect(page.getByTestId('guide-focus')).toContainText('1.e4 e5');
  await expect(page.getByTestId('guide-open')).toHaveText('1');
  await page.getByTestId('guide-focus').getByRole('button', { name: 'alle Äste' }).click();
  await expect(page.getByTestId('guide-open')).toHaveText('2');

  // Liste unter Lücken
  await page.getByRole('button', { name: 'Beenden' }).click();
  await page.locator('.nav-top').getByRole('button', { name: /^Lücken/ }).click();
  const list = page.getByTestId('critical-list');
  await expect(list).toContainText('1.e4 e5');
  await expect(list).toContainText('1 offene Lücken darunter');
});
