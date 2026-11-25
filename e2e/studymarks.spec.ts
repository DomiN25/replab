// E2E: Studie im Lesen-Modus vorsortieren – Ast als wichtig markieren (kommt im Lernen zuerst) und Ast abschneiden.
import { test, expect } from '@playwright/test';
import { mockExplorer } from './helpers';

test('Lesen-Modus: Ast wichtig markieren und abschneiden', async ({ page }) => {
  await mockExplorer(page, {});
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.locator('.rep-list li')).toHaveCount(1);

  await page.locator('.nav-top').getByRole('button', { name: 'Studien' }).click();
  await page.getByRole('button', { name: 'Studie hinzufügen' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea').fill('[Event "Test"]\n[White "Ich"]\n[Black "?"]\n\n1. e4 e5 (1... c5 2. Nf3 d6) (1... e6 2. d4) 2. Nf3 Nc6 *');
  await dlg.getByPlaceholder('z. B. Anti-Sizilianer').fill('Vorsortieren');
  await dlg.getByRole('button', { name: 'Als Studie speichern' }).click();
  await expect(dlg).toHaveCount(0);

  // Lesen-Modus: 1.e4 → 1…c5, Ast als wichtig markieren
  await page.getByRole('button', { name: 'Lesen', exact: true }).click();
  await page.locator('.var-chip', { hasText: 'e4' }).click();
  await page.locator('.var-chip', { hasText: 'c5' }).click();
  const acts = page.getByTestId('branch-acts');
  await expect(acts).toContainText('1…c5');
  await page.getByTestId('branch-imp').click();
  await expect(page.getByTestId('branch-imp')).toHaveAttribute('aria-pressed', 'true');

  // Ast 1…e6 abschneiden
  await page.getByRole('button', { name: 'Zug zurück' }).click();
  await page.locator('.var-chip', { hasText: 'e6' }).click();
  await page.getByTestId('branch-cut').click();
  await expect(page.locator('.toast')).toContainText('Ast abgeschnitten');
  await expect(page.locator('.var-chip', { hasText: 'e6' })).toHaveCount(0);

  // Lernmodus: Hauptlinie führt zum wichtigen Ast (Plakette), 1…c5 kommt direkt danach
  await page.getByRole('button', { name: 'Lernen', exact: true }).click();
  await expect(page.locator('.learn-meta')).toContainText('Wichtig');
});
