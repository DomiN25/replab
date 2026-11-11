// E2E: Geführter Studien-Modus – Linie spielt von allein, Pause und jede Bedienung unterbrechen.
import { test, expect } from '@playwright/test';

const STUDY = `[Event "tbg: Kapitel 1"]
[StudyName "tbg"]

1. e4 c5 2. Nf3 (2. c3 e5) 2... Nc6 3. Bb5 e5 *
`;

test('Abspielen: läuft von allein, Pause hält an, Bedienung unterbricht', async ({ page }) => {
  await page.route('https://lichess.org/api/study/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', headers: { 'Access-Control-Allow-Origin': '*' }, body: STUDY }),
  );
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Schwarz');
  await page.getByLabel('Farbe', { exact: true }).selectOption('black');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);
  await page.locator('.nav-top').getByRole('button', { name: 'Studien' }).click();
  await page.getByRole('button', { name: 'Studie hinzufügen' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Lichess-Studienlink').fill('https://lichess.org/study/BQvp2G0t');
  await dlg.getByRole('button', { name: 'Laden' }).click();
  await dlg.getByRole('button', { name: 'Als Studie speichern' }).click();
  const count = page.locator('.learn-count');
  await expect(count).toHaveText('0/6');

  await page.getByLabel('Abspiel-Tempo').selectOption('fast');
  await page.getByTestId('learn-auto').click();
  await expect(page.getByTestId('learn-auto')).toHaveAttribute('aria-pressed', 'true');
  await expect(count).toHaveText(/^[2-5]\/6$/, { timeout: 8000 }); // läuft ohne weiteren Klick
  // Pause: Stand bleibt stehen
  await page.getByTestId('learn-auto').click();
  await expect(page.getByTestId('learn-auto')).toHaveAttribute('aria-pressed', 'false');
  const frozen = await count.textContent();
  await page.waitForTimeout(2500);
  await expect(count).toHaveText(frozen!);

  // Weiterspielen bis zum Ende: hält dort von allein an, „Verstanden“ erscheint
  await page.getByTestId('learn-auto').click();
  await expect(page.locator('.learn-card')).toContainText('Ende der Linie', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Verstanden', exact: true })).toBeVisible();
  await expect(page.getByTestId('learn-auto')).toHaveAttribute('aria-pressed', 'false');

  // Bedienung unterbricht: nochmal abspielen (am Ende → von vorn), dann „Zug zurück“
  await page.getByTestId('learn-auto').click();
  await expect(page.getByTestId('learn-auto')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Zug zurück' }).click();
  await expect(page.getByTestId('learn-auto')).toHaveAttribute('aria-pressed', 'false');
});
