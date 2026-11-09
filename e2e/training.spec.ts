// E2E (2): Training am Handy – falscher Zug → Relearning genau einmal, keine Linie zweimal am Stück.
import { test, expect } from '@playwright/test';
import { move } from './helpers';

const PGN = `[Event "Train"]
[Orientation "white"]

1. e4 e5 (1... c5 2. Nf3 d6 3. d4) (1... e6 2. d4 d5 3. Nc3) 2. Nf3 Nc6 3. Bb5 *`;

test('falscher Zug → Relearning genau einmal', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Train Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('button', { name: 'PGN direkt ins Repertoire' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea').fill(PGN);
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await expect(dlg).toContainText('+7 Einträge');
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  await page.locator('.nav-bottom').getByRole('button', { name: 'Training' }).click();
  await page.getByRole('button', { name: /neu lernen/ }).click();

  const trainer = page.locator('.trainer');
  const asks: string[] = [];
  let wrongCard: string | undefined;
  let afterWrong: string | undefined;

  for (let guard = 0; guard < 40; guard++) {
    if (await page.getByText('Sitzung beendet').isVisible()) break;
    await expect(trainer).toHaveAttribute('data-phase', /ask|wrong/, { timeout: 15000 }).catch(async () => {
      // Zeige-Schritte: Phase bleibt „ask“-ähnlich nicht gesetzt → auf Nicht-Kontext warten
      await expect(trainer).not.toHaveAttribute('data-phase', 'context');
    });
    if (await page.getByText('Sitzung beendet').isVisible()) break;
    const kind = await trainer.getAttribute('data-step-kind');
    const card = (await trainer.getAttribute('data-card'))!;
    const answer = (await trainer.getAttribute('data-answer'))!;
    const attempt = await trainer.getAttribute('data-attempt');
    if (kind === 'show') {
      await move(page, answer);
      await expect(trainer).not.toHaveAttribute('data-card', card, { timeout: 5000 }).catch(() => undefined);
      continue;
    }
    asks.push(card);
    if (wrongCard && !afterWrong && attempt === '1') afterWrong = card;
    if (!wrongCard) {
      // erste Abfrage absichtlich falsch (a2-a3 ist in allen Stellungen legal und nie die Antwort)
      wrongCard = card;
      await move(page, 'a2a3');
      await expect(trainer).toHaveAttribute('data-phase', 'wrong');
      await expect(page.getByText(/Richtig ist/)).toBeVisible();
      await move(page, answer);
      await expect(trainer).toHaveAttribute('data-phase', 'fixed');
      await page.getByRole('button', { name: 'Weiter' }).click();
    } else {
      await move(page, answer);
      await expect(trainer).toHaveAttribute('data-phase', /right/);
      await page.waitForTimeout(900); // automatisch weiter (keine Notiz)
    }
  }

  await expect(page.getByText('Sitzung beendet')).toBeVisible();
  expect(asks.length).toBe(8); // 7 Karten + 1 Relearning
  expect(asks.filter((c) => c === wrongCard).length).toBe(2);
  expect(asks[1]).not.toBe(wrongCard); // nicht sofort wiederholt
  expect(afterWrong).toBeDefined();
  // keine Karte direkt zweimal hintereinander
  for (let i = 1; i < asks.length; i++) expect(asks[i]).not.toBe(asks[i - 1]);
});
