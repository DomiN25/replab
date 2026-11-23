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

  // Oben „Zu prüfen“ (Bewertung nach der Abweichung läuft im Hintergrund), darunter Liste und Auswertung als Reiter
  await expect(page.getByTestId('to-review')).toBeVisible();
  const dev = page.locator('.game-row.st-my-deviation');
  await expect(dev).toHaveCount(1);
  await expect(dev).toContainText('2.Lc4 statt 2.Sf3');
  await expect(dev).toContainText('Chess.com');
  await expect(dev.locator('.verdict')).toBeVisible({ timeout: 30000 }); // Stockfish hat die Stellung nach 2.Lc4 bewertet
  await expect(page.locator('.game-row.st-opp-new')).toContainText('1…d5');

  // Filter (Status-Leiste)
  const statusBar = page.locator('.games-filter');
  await statusBar.getByRole('button', { name: 'Unvorbereitet' }).click();
  await expect(page.locator('.game-row')).toHaveCount(1);
  await statusBar.getByRole('button', { name: 'Alle' }).click();

  // Suche nach Gegner
  await page.getByLabel('Gegner suchen').fill('niemand');
  await expect(page.locator('.game-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await expect(page.locator('.game-row')).toHaveCount(3);

  // Auswahl: Auswertung nur über die ausgewählte Partie
  await dev.getByLabel('Partie auswählen').check();
  await expect(page.getByTestId('sel-bar')).toContainText('1 ausgewählt');
  const tabs = page.locator('.games-tabs');
  await tabs.getByRole('tab', { name: 'Auswertung' }).click();
  const sum = page.getByTestId('games-sum');
  await expect(sum).toContainText('Auswahl');
  await expect(sum).toContainText('1 eigene Abweichung');
  await page.getByRole('button', { name: 'Auswahl aufheben' }).click();

  // Auswertung + Brennpunkte über alle Partien
  await expect(sum).toContainText('Alle Partien');
  await expect(sum).toContainText('1 eigene Abweichung');
  await expect(sum).toContainText('1 Gegner unvorbereitet');
  await expect(page.getByTestId('hotspots')).toContainText('2.Lc4');
  await expect(page.getByTestId('hotspots')).toContainText('statt 2.Sf3');

  // Abweichungen trainieren: Sitzung mit genau dieser Stellung
  await page.getByTestId('drill').click();
  await expect(page).toHaveURL(/#\/train/);
  await expect(page.locator('.trainer')).toBeVisible();
  await expect(page.locator('.trainer')).toContainText('1/1');
  await page.getByRole('button', { name: 'Pause' }).click();

  // Lücken: unvorbereiteter Gegnerzug aus den Partien
  await page.locator('.nav-top').getByRole('button', { name: 'Lücken' }).click();
  await expect(page.getByTestId('from-games')).toContainText('1.e4 d5');

  // Startseite: letzte Partien mit Mini-Brett, Antippen öffnet die Partie am Brett
  await page.locator('.nav-top').getByRole('button', { name: 'Start' }).click();
  const recent = page.getByTestId('home-games');
  await expect(recent.locator('.game-card')).toHaveCount(3);
  await expect(recent.locator('.mini-board cg-board').first()).toBeVisible();
  await recent.locator('.game-card.st-my-deviation .gc-main').click();
  await expect(page).toHaveURL(/#\/games/);

  // Partie am Brett: öffnet an der Abweichung, Zugleiste eingefärbt, Bewertung danach
  const detail = page.getByTestId('game-detail');
  await expect(detail).toBeVisible();
  await expect(page.getByTestId('gd-event')).toContainText('Du hast 2.Lc4 gespielt');
  await expect(page.getByTestId('gd-event')).toContainText('2.Sf3');
  await expect(page.getByTestId('gd-assess')).toContainText('Stockfish nach 2.Lc4');
  await expect(detail.locator('.mv.dev')).toHaveText('Lc4');
  await expect(page.getByTestId('gd-state')).toContainText('Hier bist du abgewichen');
  await expect(detail.locator('.mv.rep')).toHaveCount(2);
  await expect(detail.getByRole('button', { name: 'Zum Ereignis' })).toBeDisabled();
  await detail.getByRole('button', { name: 'Zug vor' }).click();
  await expect(detail.locator('.mv.cur')).toHaveText('Lc4');
  await expect(page.getByTestId('gd-state')).toContainText('Außerhalb des Repertoires');

  // Öffnen springt ins Repertoire an die Abweichung (Zugfolge der Partie, Hinweis „Außerhalb des Repertoires“)
  await page.getByTestId('gd-event').getByRole('button', { name: 'Im Repertoire öffnen' }).click();
  await expect(page).toHaveURL(/#\/build/);
  await expect(page.locator('.crumbs')).toContainText('Lc4');
  await expect(page.getByTestId('outside')).toContainText('Außerhalb des Repertoires');
  // Bilanz-Streifen unter dem Brett: diese Stellung kam in einer meiner Partien vor (Remis nach 2.Lc4 Sf6? hier: 1 Partie)
  await expect(page.getByTestId('res-strip')).toContainText('1× in deinen Partien');
});
