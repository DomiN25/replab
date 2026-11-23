// E2E: Am PC nutzt das Repertoire die Breite – das Brett wächst mit dem Fenster (Regression: Seiten-Spur bekam max-width 1100 px).
import { test, expect } from '@playwright/test';

for (const [w, h, min] of [
  [1920, 1000, 640],
  [1440, 860, 560],
] as const) {
  test(`Brett im Repertoire bei ${w}×${h} mindestens ${min} px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/#/settings');
    await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Groß');
    await page.getByRole('button', { name: 'Anlegen' }).click();
    await page.locator('.nav-top').getByRole('button', { name: 'Repertoire' }).click();
    const board = page.locator('cg-board').first();
    await expect(board).toBeVisible();
    await expect.poll(async () => (await board.boundingBox())!.width).toBeGreaterThan(min);
  });
}
