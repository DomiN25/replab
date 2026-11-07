// E2E (3): Seed laden + Studie importieren → Galaxie zeigt Äste.
import { test, expect } from '@playwright/test';

test('Seed-Import → Galaxie zeigt Äste', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Startrepertoire laden' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('studie_spanisch.pgn');
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await expect(dlg).toContainText('Konflikte');
  await expect(dlg).toContainText('1.e4 e5 2.Sf3 Sc6 3.Lb5 a6 4.La4 Sf6');
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  await page.locator('.nav-top').getByRole('button', { name: 'Bauen' }).click();
  const paths = page.locator('.galaxy-svg path');
  await expect.poll(async () => paths.count()).toBeGreaterThan(20);
  await expect(page.locator('.legend')).toContainText('Sizilianisch');
  await expect(page.locator('.legend')).toContainText('Offene Spiele');

  // Klick auf ein Segment zoomt und setzt das Brett
  await page.locator('.galaxy-svg path', { has: page.locator('title', { hasText: /^1…c5/ }) }).click();
  await expect(page.locator('.crumbs')).toContainText('c5');
  await expect(page.locator('.galaxy-center')).toContainText('1…c5');

  // Listenansicht als Alternative
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect(page.locator('.tree-row').first()).toBeVisible();
});
