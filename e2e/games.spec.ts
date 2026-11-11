// E2E: Meine Lichess-Partien laden → Repertoire zeigt, was Gegner gegen mich gespielt haben; Lücken mit Partienzahl.
import { test, expect } from '@playwright/test';
import { mockExplorer, move } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';

const game = (moves: string, winner?: 'white' | 'black') =>
  JSON.stringify({
    moves,
    winner,
    variant: 'standard',
    createdAt: 1,
    players: { white: { user: { id: 'dom' } }, black: { user: { id: 'gegner' } } },
  });

test('Meine Partien: Gegner-Statistik im Repertoire und bei den Lücken', async ({ page }) => {
  await mockExplorer(page, {
    [START]: [['e2e4', 'e4', 5000]],
    [AFTER_E4]: [
      ['e7e5', 'e5', 600],
      ['c7c5', 'c5', 400],
    ],
  });
  await page.route('https://lichess.org/api/games/user/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: [game('e4 e5 Nf3', 'white'), game('e4 e5 Nf3', 'black'), game('e4 e5 Bc4', 'white'), game('e4 c5 Nf3')].join('\n'),
    }),
  );
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Partien Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const token = page.getByPlaceholder('lip_…');
  await token.fill('lip_e2e_test');
  await token.blur();

  const card = page.getByTestId('my-games');
  await card.locator('summary').click();
  await card.getByLabel('Lichess-Name').fill('Dom');
  await card.getByTestId('load-lichess').click();
  await expect(page.locator('.toast')).toContainText('4 Partien von Lichess geladen');
  await expect(card).toContainText('4 Partien von Dom');

  await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
  await page.getByRole('button', { name: /Stockfish an/ }).click();
  await move(page, 'e2e4'); // festlegen → Gegner am Zug
  const block = page.getByTestId('games-block');
  await expect(block).toContainText('Gegen dich gespielt');
  await expect(block).toContainText('4 Partien');
  const rows = block.locator('tbody tr');
  await expect(rows.nth(0)).toContainText('e5');
  await expect(rows.nth(0)).toContainText('3×');
  await expect(rows.nth(0)).toContainText('+2'); // e5-Partien: Sieg, Niederlage, Sieg → +2 =0 −1
  await expect(rows.nth(0)).toContainText('−1');
  await expect(rows.nth(1)).toContainText('c5');
  await expect(rows.nth(0)).toContainText('Lücke');

  await page.locator('.nav-top').getByRole('button', { name: /^Lücken/ }).click();
  await expect(page.locator('.gaprow').first()).toContainText('in deinen Partien');
  await page.getByLabel('nur aus meinen Partien').check();
  await expect(page.locator('.gaprow')).toHaveCount(2);
});
