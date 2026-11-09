// E2E: Erstes Gerät ohne gehostete Seeds – mehrere PGN-Dateien auf der Startseite laden.
import { test, expect } from '@playwright/test';

const WHITE = '[Event "Weiß"]\n[Orientation "white"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *\n';
const BLACK = '[Event "Schwarz"]\n[Orientation "black"]\n\n1. e4 c5 2. Nf3 Nc6 *\n';
// Widerspricht WHITE nach 1.e4 e5 (2.Lc4 statt 2.Sf3) → Konfliktdialog
const STUDY = '[Event "Studie"]\n[Orientation "white"]\n\n1. e4 e5 2. Bc4 Nf6 3. d3 *\n';

test('PGN-Dateien laden: Farbe aus Datei, Konflikt per Dialog', async ({ page }) => {
  // So tun, als wären die Seeds nicht gehostet (wie auf der Live-Seite)
  await page.route('**/seed/*.pgn', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page.getByText('Erstes Gerät?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Startrepertoire laden' })).toHaveCount(0);

  await page.locator('.wstep input[type=file]').setInputFiles([
    { name: 'studie_spanisch.pgn', mimeType: 'text/plain', buffer: Buffer.from(STUDY) },
    { name: 'repertoire_weiss.pgn', mimeType: 'text/plain', buffer: Buffer.from(WHITE) },
    { name: 'repertoire_schwarz.pgn', mimeType: 'text/plain', buffer: Buffer.from(BLACK) },
  ]);

  // Studie hat einen Konflikt → Dialog
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('studie_spanisch.pgn');
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await expect(dlg).toContainText('Konflikte');
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  // Zwei Hauptrepertoires mit passender Farbe
  await page.locator('.rep-select').click();
  const opts = await page.getByRole('dialog').locator('.picker-row').allInnerTexts();
  expect(opts.some((o) => o.includes('Hauptrepertoire Weiß'))).toBe(true);
  expect(opts.some((o) => o.includes('Hauptrepertoire Schwarz'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dash')).toBeVisible();
});
