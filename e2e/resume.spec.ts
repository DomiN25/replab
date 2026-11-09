// E2E: Trainingssitzung überlebt Reiterwechsel, „Stellung öffnen“ und Neuladen (Fortsetzen/Pause).
import { test, expect } from '@playwright/test';
import { move } from './helpers';

const PGN = `[Event "Train"]
[Orientation "white"]

1. e4 e5 (1... c5 2. Nf3 d6 3. d4) (1... e6 2. d4 d5 3. Nc3) 2. Nf3 Nc6 3. Bb5 *`;

test('Sitzung fortsetzen nach Reiterwechsel und Neuladen', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Train Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('button', { name: 'PGN direkt ins Repertoire' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea').fill(PGN);
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  const nav = (name: string) => page.locator('.nav-top').getByRole('button', { name }).click();
  await nav('Training');
  await page.getByRole('button', { name: /neu lernen/ }).click();
  const trainer = page.locator('.trainer');
  const count = page.locator('.train-top .count');
  await expect(count).toHaveText(/^1\//);

  // erste Karte (Zeige-Schritt): Zug nachspielen → weiter
  await expect(trainer).not.toHaveAttribute('data-phase', 'context');
  await move(page, (await trainer.getAttribute('data-answer'))!);
  await expect(count).not.toHaveText(/^1\//, { timeout: 5000 }); // Zeige-Schritt geht nach kurzer Pause allein weiter
  const progressed = await count.innerText();

  // Reiterwechsel → zurück: dieselbe Stelle
  await nav('Studien');
  await nav('Training');
  await expect(count).toHaveText(progressed);

  // Neuladen → Fortsetzen angeboten
  await page.reload();
  await expect(page.getByText('Angefangene Sitzung')).toBeVisible();
  await page.getByRole('button', { name: 'Fortsetzen' }).click();
  await expect(count).toHaveText(progressed);

  // Pause → wieder auf der Trainingsseite mit Fortsetzen
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Angefangene Sitzung')).toBeVisible();
  await page.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByText('Angefangene Sitzung')).toHaveCount(0);
});
