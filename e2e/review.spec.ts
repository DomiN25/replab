// E2E: Chess.com-Partien laden → Partienliste zeigt eigene Abweichungen, Unvorbereitetes und Lücken; Öffnen springt ins Repertoire.
import { test, expect } from '@playwright/test';
import { mockExplorer, move } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w';

const pgn = (moves: string) => `[Event "Live Chess"]\n[White "Dom"]\n[Black "Gegner"]\n\n${moves} 1-0`;
const cc = (id: string, moves: string, result = 'win') => ({
  url: `https://www.chess.com/game/live/${id}`,
  pgn: pgn(moves),
  rules: 'chess',
  end_time: 1700000000 + Number(id),
  white: { username: 'Dom', result },
  black: { username: 'Gegner', result: 'resigned' },
});

test('Partien prüfen: Abweichung, Unvorbereitetes, Lücke', async ({ page }) => {
  await mockExplorer(page, {
    [START]: [['e2e4', 'e4', 5000]],
    [AFTER_E4]: [['e7e5', 'e5', 600]],
    [AFTER_E5]: [['g1f3', 'Nf3', 900]],
    [AFTER_NF3]: [['b8c6', 'Nc6', 700]],
  });
  await page.route('https://api.chess.com/**', (route) => {
    const url = route.request().url();
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (url.endsWith('/archives')) return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ archives: ['https://api.chess.com/pub/player/dom/games/2026/11'] }) });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ games: [cc('1', '1. e4 e5 2. Nf3 Nc6 3. Bb5'), cc('2', '1. e4 e5 2. Bc4 Nf6'), cc('3', '1. e4 d5 2. exd5', 'checkmated')] }),
    });
  });
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Review Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const token = page.getByPlaceholder('lip_…');
  await token.fill('lip_e2e_test');
  await token.blur();

  // Repertoire: 1.e4 und 2.Sf3 nach 1…e5 festlegen (Gegnerzug am Brett ansehen)
  await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
  await page.getByRole('button', { name: /Stockfish an/ }).click();
  await move(page, 'e2e4');
  await move(page, 'e7e5');
  await move(page, 'g1f3');
  await expect(page.locator('.toast')).toContainText('festgelegt');
  await move(page, 'b8c6'); // Gegnerzug 2…Sc6 ansehen: damit ist die Stellung im Baum bekannt

  await page.goto('/#/settings');
  const card = page.getByTestId('my-games');
  await card.locator('summary').click();
  await card.getByLabel('Chess.com-Name').fill('Dom');
  await card.getByTestId('load-chesscom').click();
  await expect(page.locator('.toast')).toContainText('3 Partien von Chess.com geladen');
  await card.getByTestId('open-games').click();

  const sum = page.getByTestId('games-sum');
  await expect(sum).toContainText('1 eigene Abweichung');
  await expect(sum).toContainText('1 Gegner unvorbereitet');
  const dev = page.locator('.game-row.st-my-deviation');
  await expect(dev).toHaveCount(1);
  await expect(dev).toContainText('2.Lc4 statt 2.Sf3');
  await expect(dev).toContainText('Chess.com');
  await expect(dev.getByRole('button', { name: 'Mit Stockfish prüfen' })).toBeVisible();
  await expect(page.locator('.game-row.st-opp-new')).toContainText('1…d5');

  // Filter
  await page.getByRole('button', { name: 'Unvorbereitet' }).click();
  await expect(page.locator('.game-row')).toHaveCount(1);

  // Öffnen springt ins Repertoire an die Abweichung (Zugfolge der Partie, Hinweis „Außerhalb des Repertoires“)
  await page.getByRole('button', { name: 'Meine Abweichungen' }).click();
  await dev.getByRole('button', { name: 'Im Repertoire öffnen' }).click();
  await expect(page).toHaveURL(/#\/build/);
  await expect(page.locator('.crumbs')).toContainText('Lc4');
  await expect(page.getByTestId('outside')).toContainText('Außerhalb des Repertoires');
});
