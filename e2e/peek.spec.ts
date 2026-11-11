// E2E: Beim Wischen liegt die Nachbarseite schon daneben (Vorschau), folgt dem Finger und wird danach die echte Seite.
import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['Pixel 7'] });

test('Wischen: Nachbarseite wird mitgezogen, Wechsel ohne Sprung', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Peek');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);
  await page.locator('.nav-bottom').getByRole('button', { name: 'Training' }).click();
  await expect(page).toHaveURL(/#\/train/);
  await expect(page.locator('.peek-layer')).toHaveCount(0);

  const cdp = await page.context().newCDPSession(page);
  const y = 300;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330 - i * 20, y }] });
  // mitten in der Geste: Vorschau der nächsten Seite (Studien) liegt rechts daneben und wird mitgezogen
  const layer = page.locator('.peek-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer.locator('main.peek-main')).toBeVisible();
  const w = page.viewportSize()!.width;
  await expect.poll(async () => layer.evaluate((el) => parseFloat(getComputedStyle(el).translate.split(' ')[0]))).toBeCloseTo(w - 120, -1);
  // Vorschau macht nichts: nur ein echtes Brett bzw. keine doppelten Seiten-Elemente im Training
  await expect(page.locator('main:not(.peek-main) .trainer-setup')).toHaveCount(1);

  for (let i = 7; i <= 14; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330 - i * 20, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/#\/studies/);
  await expect(layer).toHaveCount(0); // Vorschau ist abgebaut, die echte Seite steht
  await expect(page.locator('main')).toHaveAttribute('data-enter', 'swipe');
  await expect(page.locator('main')).toContainText('Studie');
});

test('Wischen: zu kurz → Vorschau verschwindet, Seite bleibt', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Peek2');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);
  await page.locator('.nav-bottom').getByRole('button', { name: 'Training' }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 300 }] });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - i * 10, y: 300 }] });
  await expect(page.locator('.peek-layer')).toHaveCount(1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.peek-layer')).toHaveCount(0, { timeout: 3000 });
  await expect(page).toHaveURL(/#\/train/);
});
