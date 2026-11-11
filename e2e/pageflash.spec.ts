// Seitenwechsel: die neue Seite animiert genau einmal herein (kein zweites Einblenden nach dem Hereingleiten = Flackern).
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 400, height: 800 }, hasTouch: true });

test('Seitenwechsel animiert nur einmal', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Flackern');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);
  await page.locator('.nav-bottom').getByRole('button', { name: 'Training' }).click();
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    (window as unknown as { __anims: string[] }).__anims = [];
    document.addEventListener('animationstart', (e) => {
      if ((e.target as HTMLElement).parentElement?.tagName === 'MAIN') (window as unknown as { __anims: string[] }).__anims.push((e as AnimationEvent).animationName);
    }, true);
  });
  await page.locator('.nav-bottom').getByRole('button', { name: 'Start' }).click();
  await page.waitForTimeout(900);
  const anims = await page.evaluate(() => (window as unknown as { __anims: string[] }).__anims);
  expect(anims).toEqual(['pagePrev']);
});
