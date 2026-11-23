// E2E: Beim Start holt RepLab neue Chess.com-Partien automatisch (nur die seit der letzten geladenen) und zeigt sie auf der
// Startseite; die Statistik zeigt Eröffnungen je Farbe.
import { test, expect } from '@playwright/test';
import { mockExplorer } from './helpers';

const pgn = (moves: string) => `[Event "Live Chess"]\n[White "Dom"]\n[Black "Gegner"]\n\n${moves} 1-0`;
const cc = (id: number, moves: string, result = 'win') => ({
  url: `https://www.chess.com/game/live/${id}`,
  pgn: pgn(moves),
  rules: 'chess',
  time_class: 'blitz',
  end_time: 1700000000 + id,
  white: { username: 'Dom', result, rating: 1500 },
  black: { username: `Gegner${id}`, result: result === 'win' ? 'resigned' : 'win', rating: 1600 },
});

test('Neue Chess.com-Partien beim Start automatisch laden', async ({ page }) => {
  await mockExplorer(page, {});
  let games = [cc(1, '1. e4 e5 2. Nf3 Nc6 3. Bb5'), cc(2, '1. e4 c5 2. Nf3 d6', 'checkmated')];
  await page.route('https://api.chess.com/**', (route) => {
    const url = route.request().url();
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (url.endsWith('/archives')) return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ archives: ['https://api.chess.com/pub/player/dom/games/2026/11'] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ games }) });
  });
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Auto');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const card = page.getByTestId('my-games');
  await card.locator('summary').click();
  await card.getByLabel('Chess.com-Name').fill('Dom');
  await card.getByTestId('load-chesscom').click();
  await expect(page.locator('.toast')).toContainText('2 Partien von Chess.com geladen');

  // Neue Partie bei Chess.com, App neu öffnen → wird automatisch nachgeladen und steht auf der Startseite
  games = [...games, cc(3, '1. e4 e6 2. d4 d5')];
  await page.goto('/#/home');
  await page.reload();
  await expect(page.locator('.toast')).toContainText('1 neue Partie geladen');
  const recent = page.getByTestId('home-games');
  await expect(recent.locator('.game-card')).toHaveCount(3);
  await expect(recent.locator('.game-card').first()).toContainText('Gegner3');

  // Statistik: Eröffnungen mit Weiß (Familien aus der Eröffnungstabelle), häufigste Fehler
  await page.locator('.nav-top').getByRole('button', { name: 'Partien' }).click();
  await page.locator('.games-tabs').getByRole('tab', { name: 'Auswertung' }).click();
  const os = page.getByTestId('opening-stats');
  await expect(os).toContainText('Spanisch');
  await expect(os).toContainText('Sizilianisch');
  await expect(os.locator('tbody tr')).toHaveCount(3);
  await expect(page.getByTestId('error-spots')).toBeVisible();
});
