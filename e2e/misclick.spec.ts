// E2E: „Verklickt“ nimmt die falsche Bewertung zurück – keine Wiederholung in der Sitzung, Abschluss bietet „Weiter“ an.
import { test, expect } from '@playwright/test';
import { move } from './helpers';

const PGN = `[Event "Train"]
[Orientation "white"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 *`;

test('Verklicker zurücknehmen', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('W');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('button', { name: 'PGN direkt ins Repertoire' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea').fill(PGN);
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);
  await page.locator('.nav-top').getByRole('button', { name: 'Training' }).click();
  await page.getByRole('button', { name: /neu lernen/ }).click();

  const trainer = page.locator('.trainer');
  const total = () => page.locator('.train-top .count').innerText().then((t) => t.split('/')[1]);
  const steps = await total();
  for (let guard = 0; guard < 20; guard++) {
    await expect(trainer).not.toHaveAttribute('data-phase', 'context');
    if ((await trainer.getAttribute('data-step-kind')) === 'show') {
      const before = await page.locator('.train-top .count').innerText();
      await move(page, (await trainer.getAttribute('data-answer'))!);
      await expect(page.locator('.train-top .count')).not.toHaveText(before, { timeout: 5000 });
      continue;
    }
    // erste Abfrage: absichtlich falsch, dann „Verklickt“
    await move(page, 'a2a3');
    await expect(trainer).toHaveAttribute('data-phase', 'wrong');
    await page.getByRole('button', { name: /Verklickt/ }).click();
    await expect(trainer).toHaveAttribute('data-phase', 'fixed');
    await page.getByRole('button', { name: 'Weiter' }).click();
    break;
  }
  expect(await total()).toBe(steps); // keine zusätzliche Wiederholung eingeplant
});
