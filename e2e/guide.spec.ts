// E2E: Lückentour (Ast für Ast) – festlegen → automatisch weiter im Ast, Ende hier, überspringen, ignorieren.
import { test, expect } from '@playwright/test';
import { mockExplorer, move } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b';

test('Lückentour: Lücken der Reihe nach schließen', async ({ page }) => {
  await mockExplorer(page, {
    [START]: [['e2e4', 'e4', 5000]],
    [AFTER_E4]: [
      ['e7e5', 'e5', 600],
      ['c7c5', 'c5', 400],
    ],
    [AFTER_NF3]: [
      ['b8c6', 'Nc6', 700],
      ['g8f6', 'Nf6', 300],
    ],
  });
  await page.goto('/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Guide Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const token = page.getByPlaceholder('lip_…');
  await token.fill('lip_e2e_test');
  await token.blur();
  await page.locator('.nav-top').getByRole('button', { name: 'Bauen' }).click();
  await page.getByRole('button', { name: /Stockfish an/ }).click();

  // 1.e4 festlegen
  await move(page, 'e2e4');
  await page.getByRole('dialog').getByRole('button', { name: 'Festlegen' }).click();
  await expect(page.getByTestId('gap-count')).toHaveText('2');

  // Pfeile: durchgehend (nicht gestrichelt), ohne Zahlen, Dicke nach Häufigkeit (60 % dicker als 40 %)
  const opp = page.locator("svg.cg-shapes line[stroke='#f08c00']");
  await expect(opp).toHaveCount(2);
  const widths = (await opp.evaluateAll((ls) => ls.map((l) => Number(l.getAttribute('stroke-width'))))).sort((a, b) => a - b);
  expect(widths[1]).toBeGreaterThan(widths[0]);
  expect(await opp.evaluateAll((ls) => ls.map((l) => getComputedStyle(l).strokeDasharray))).toEqual(['none', 'none']);
  await expect(page.locator('svg.cg-custom-svgs text')).toHaveCount(0);

  // Lückentour starten (Standard „Ast für Ast“) → schwerster Ast zuerst (Offene Spiele 60 % vor Sizilianisch 40 %): 1.e4 e5
  await page.getByRole('button', { name: 'Lückentour' }).click();
  const guide = page.getByTestId('guide');
  await expect(guide.locator('.guide-line')).toContainText('1.e4 e5');
  await expect(page.getByTestId('guide-open')).toHaveText('2');

  // Zug am Brett → festlegen → bleibt im Ast (Offene Spiele): 2…Sc6 kommt vor 1…c5
  await move(page, 'g1f3');
  await page.getByRole('dialog').getByRole('button', { name: 'Festlegen' }).click();
  await expect(guide.locator('.guide-line')).toContainText('1.e4 e5 2.Sf3 Sc6');

  // Ende hier → weiter zu 2…Sf6 (gleicher Ast); andere Gegnerzüge werden angezeigt
  await guide.getByRole('button', { name: 'Ende hier' }).click();
  await expect(guide.locator('.guide-line')).toContainText('1.e4 e5 2.Sf3 Sf6');
  await expect(guide.locator('.guide-sibs')).toContainText('Sc6');

  // Überspringen → Ast leer → nächster Ast: 1…c5
  await guide.getByRole('button', { name: 'Überspringen' }).click();
  await expect(guide.locator('.guide-line')).toContainText('1.e4 c5');

  // 1…c5 als irrelevant markieren → keine Lücke mehr übrig (2…Sf6 ist übersprungen)
  await guide.getByRole('button', { name: /c5 ignorieren/ }).click();
  await expect(guide).toContainText('Keine offene Lücke');

  // Ast-Auswahl bietet nur Äste mit offenen Lücken an
  await expect(guide.getByRole('combobox', { name: 'Ast' })).toContainText('alle Äste');
});
