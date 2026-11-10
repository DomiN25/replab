// E2E: „Auch heute fällig“ – Fälliges in einem anderen Repertoire ist auf der Startseite sichtbar und startbar.
import { test, expect } from '@playwright/test';
import { move } from './helpers';

const PGN = `[Event "Heute"]
[Orientation "white"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 *`;

test('fällige Karten eines anderen Repertoires erscheinen auf Start und am Reiter', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Heute Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('button', { name: 'PGN direkt ins Repertoire' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea').fill(PGN);
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  // drei neue Karten lernen (alles richtig)
  await page.locator('.nav-top').getByRole('button', { name: 'Training' }).click();
  await page.getByRole('button', { name: /neu lernen/ }).click();
  const trainer = page.locator('.trainer');
  for (let guard = 0; guard < 20; guard++) {
    if (await page.getByText('Sitzung beendet').isVisible()) break;
    await expect(trainer).not.toHaveAttribute('data-phase', 'context', { timeout: 15000 }).catch(() => undefined);
    if (await page.getByText('Sitzung beendet').isVisible()) break;
    const card = (await trainer.getAttribute('data-card'))!;
    const index = await page.locator('.train-top .count').innerText();
    await move(page, (await trainer.getAttribute('data-answer'))!);
    // weiter, sobald der nächste Schritt da ist (oder die Sitzung endet)
    await expect
      .poll(async () => (await page.getByText('Sitzung beendet').isVisible()) || (await page.locator('.train-top .count').innerText().catch(() => '')) !== index, { timeout: 8000 })
      .toBe(true);
    void card;
  }
  await expect(page.getByText('Sitzung beendet')).toBeVisible();
  await page.getByRole('button', { name: 'Fertig' }).click();

  // zweites (leeres) Repertoire anlegen und aktiv lassen; die Karten des ersten fällig machen (Fälligkeit in der Test-Datenbank zurückdatieren)
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Heute Zweit');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.evaluate(
    () =>
      new Promise<void>((res, rej) => {
        const rq = indexedDB.open('replab');
        rq.onerror = () => rej(rq.error);
        rq.onsuccess = () => {
          const tx = rq.result.transaction('cards', 'readwrite');
          const store = tx.objectStore('cards');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const c of all.result) store.put({ ...c, srs: { ...c.srs, due: Date.now() - 86400_000 } });
          };
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
      }),
  );
  await page.goto('/#/home');
  await page.reload();

  const rows = page.getByTestId('today-rows');
  const other = (await page.locator('.rep-select').innerText()).includes('Zweit') ? 'Heute Weiß' : 'Heute Zweit';
  if (other === 'Heute Zweit') {
    // aktiv ist noch das erste Repertoire → auf das leere wechseln, damit das fällige „woanders“ liegt
    await page.locator('.rep-select').click();
    await page.getByRole('dialog').getByRole('button', { name: /Heute Zweit/ }).click();
  }
  await expect(rows).toContainText('Heute Weiß');
  await expect(rows.locator('.today-row b')).toHaveText('3');
  await expect(page.locator('.nav-bottom button', { hasText: 'Training' }).locator('.nav-badge')).toHaveText('3');

  // Tipp auf die Zeile: Repertoire wechseln und Wiederholung starten
  await rows.getByRole('button', { name: /Heute Weiß/ }).click();
  await expect(page.locator('.trainer')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.rep-select')).toContainText('Heute Weiß');
  await expect(page.locator('.train-top .count')).toHaveText('1/3');
});
