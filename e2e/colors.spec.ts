// E2E: Startseite zeigt die letzten Partien beider Farben, jedes Brett aus meiner Sicht (meine Farbe unten);
// eine Schwarz-Partie öffnet sich mit dem Schwarz-Repertoire.
import { test, expect } from '@playwright/test';
import { mockExplorer } from './helpers';

const games = [
  { c: 'b', r: -1, m: 'e4 c5 Nf3 d6 d4 cxd4', t: Date.now() - 1000, src: 'chesscom', id: 'b1', opp: 'WeissGegner' },
  { c: 'w', r: 1, m: 'e4 e5 Bc4 Nf6', t: Date.now() - 86400_000, src: 'chesscom', id: 'w1', opp: 'SchwarzGegner' },
];

test('Letzte Partien beider Farben, Brett aus meiner Sicht', async ({ page }) => {
  await mockExplorer(page, {});
  await page.addInitScript((g) => localStorage.setItem('replab.games', JSON.stringify({ sources: { chesscom: { user: 'Dom', fetchedAt: Date.now() } }, games: g })), games);
  await page.goto('/');
  await page.getByRole('button', { name: 'Startrepertoire laden' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  const recent = page.getByTestId('home-games');
  await expect(recent.locator('.game-card')).toHaveCount(2);
  const black = recent.locator('.game-card').filter({ hasText: 'WeissGegner' });
  const white = recent.locator('.game-card').filter({ hasText: 'SchwarzGegner' });
  await expect(black.locator('.kdot.black')).toHaveCount(1);
  await expect(black.locator('.cg-wrap')).toHaveClass(/orientation-black/);
  await expect(white.locator('.cg-wrap')).toHaveClass(/orientation-white/);

  // Schwarz-Partie öffnen → Partien-Seite mit Schwarz-Repertoire, Brett mit Schwarz unten
  await black.locator('.gc-main').click();
  await expect(page).toHaveURL(/#\/games/);
  const detail = page.getByTestId('game-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('mit Schwarz');
  await expect(detail.locator('.cg-wrap').first()).toHaveClass(/orientation-black/);
  await expect(page.locator('.rep-select')).toContainText('Schwarz');
});
