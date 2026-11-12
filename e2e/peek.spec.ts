// E2E: Die Nachbarseiten sind vorgeladen. Beim Wischen wird die Nachbarseite nur eingeblendet, folgt dem Finger und wird danach die
// aktive Seite – dieselben DOM-Elemente, nichts wird neu aufgebaut.
import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['Pixel 7'] });

async function trainWithRep(page: import('@playwright/test').Page, name: string) {
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill(name);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);
  await page.locator('.nav-bottom').getByRole('button', { name: 'Training' }).click();
  await expect(page).toHaveURL(/#\/train/);
}

test('Wischen: vorgeladene Nachbarseite wird mitgezogen, Wechsel ohne Neuaufbau', async ({ page }) => {
  await trainWithRep(page, 'Peek');
  // Nachbarn (Lücken, Studien) werden nach kurzer Ruhe vorgeladen, bleiben aber unsichtbar und inert
  const studies = page.locator('.pages > [data-view="studies"]');
  await expect(studies).toHaveCount(1, { timeout: 8000 });
  await expect(studies).toHaveCSS('visibility', 'hidden');
  await expect(studies).toHaveAttribute('inert', '');
  await expect(page.locator('.pages > [data-view="gaps"]')).toHaveCount(1, { timeout: 8000 });
  await page.waitForTimeout(500);
  await studies.evaluate((el) => ((el as HTMLElement & { __same?: number }).__same = 42)); // Markierung: gleiches Element nach dem Wechsel?

  const cdp = await page.context().newCDPSession(page);
  const y = 300;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330 - i * 20, y }] });
  // mitten in der Geste: die nächste Seite liegt rechts daneben und wird mitgezogen
  await expect(studies).toHaveCSS('visibility', 'visible');
  const w = page.viewportSize()!.width;
  const root = studies.locator(':scope > *').first();
  await expect.poll(async () => root.evaluate((el) => parseFloat(getComputedStyle(el).translate.split(' ')[0]))).toBeCloseTo(w - 120, -1);
  // genau eine aktive Seite, die Vorschau macht nichts (keine zweite Trainingsseite)
  await expect(page.locator('.pages > .active')).toHaveCount(1);

  for (let i = 7; i <= 14; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330 - i * 20, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/#\/studies/);
  await expect(studies).toHaveClass(/active/);
  await expect(studies).toHaveCSS('visibility', 'visible');
  expect(await studies.evaluate((el) => (el as HTMLElement & { __same?: number }).__same)).toBe(42); // nicht neu gemountet
  await expect(studies).toContainText('Studie');
  // Verschiebungen sind zurückgesetzt, die verlassene Seite ist wieder unsichtbar
  await expect(root).toHaveCSS('translate', 'none');
  await expect(page.locator('.pages > [data-view="train"]')).toHaveCSS('visibility', 'hidden');
});

test('Wischen: zu kurz → Nachbarseite verschwindet, Seite bleibt', async ({ page }) => {
  await trainWithRep(page, 'Peek2');
  const studies = page.locator('.pages > [data-view="studies"]');
  await expect(studies).toHaveCount(1, { timeout: 8000 });
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 300 }] });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - i * 10, y: 300 }] });
  await expect(studies).toHaveCSS('visibility', 'visible');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(studies).toHaveCSS('visibility', 'hidden', { timeout: 3000 });
  await expect(page).toHaveURL(/#\/train/);
});

test('Wischen sofort nach dem Start: Nachbarseite wird bei Bedarf nachgeladen', async ({ page }) => {
  await trainWithRep(page, 'Peek3');
  // ohne auf das Vorladen zu warten
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y: 300 }] });
  for (let i = 1; i <= 14; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330 - i * 20, y: 300 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/#\/studies/);
  await expect(page.locator('.pages > .active')).toHaveCount(1);
  await expect(page.locator('.pages > .active')).toHaveAttribute('data-view', 'studies');
});
