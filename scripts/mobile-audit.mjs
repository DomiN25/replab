// Handy-Simulation (Pixel 7, Edge): klickt alle Ansichten hell + dunkel durch und speichert Screenshots.
// Aufruf (Dev-Server muss laufen): node scripts/mobile-audit.mjs [baseUrl]
// Ausgabe: test-results/mobile-audit/<schema>-NN-name.png
// Grenzen: Emulation (Viewport, Touch, UA, DPR) – kein echtes Gerät (GPU, Adressleiste, Tastatur).
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = 'test-results/mobile-audit';
mkdirSync(OUT, { recursive: true });

const PGN = `[Event "Audit"]
[Orientation "white"]

1. e4 {Offene Stellungen, Initiative.} e5 (1... c5 2. Nf3 d6 3. d4) (1... e6 2. d4 d5 3. Nc3) 2. Nf3 Nc6 3. Bb5 *`;

const STUDY = `[Event "Kapitel 1"]
[ChapterName "Rossolimo"]

{ Einleitung: Schwarz gegen die Anti-Sizilianer. }
1. e4 c5 2. Nf3 (2. c3 { Alapin. } 2... e5) (2. Nc3 Nc6 3. Bb5 (3. f4 e6) 3... Nd4) 2... Nc6 3. Bb5 e5 { Meine Wahl gegen Rossolimo. } (3... g6 4. O-O Bg7) 4. O-O d6 *

[Event "Kapitel 2"]
[ChapterName "Morra"]

1. e4 c5 2. d4 cxd4 3. c3 e5 *
`;

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const TABLE = {
  [START]: [['e2e4', 'e4', 50000], ['d2d4', 'd4', 30000], ['g1f3', 'Nf3', 8000], ['c2c4', 'c4', 7000]],
  [AFTER_E4]: [['e7e5', 'e5', 6000], ['c7c5', 'c5', 4000], ['e7e6', 'e6', 2000], ['c7c6', 'c6', 1500], ['d7d5', 'd5', 900]],
};

async function mockExplorer(page) {
  await page.route('https://explorer.lichess.org/**', async (route) => {
    const fen = new URL(route.request().url()).searchParams.get('fen') ?? '';
    const moves = TABLE[fen.split(' ').slice(0, 2).join(' ')] ?? [];
    const total = moves.reduce((s, m) => s + m[2], 0);
    const split = (n) => ({ white: Math.floor(n * 0.42), draws: Math.floor(n * 0.3), black: n - Math.floor(n * 0.42) - Math.floor(n * 0.3) });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ...split(total), moves: moves.map(([uci, san, n]) => ({ uci, san, ...split(n) })), opening: null }),
    });
  });
}

async function tapSquare(page, sq) {
  const board = page.locator('cg-board').first();
  await board.scrollIntoViewIfNeeded();
  const box = await board.boundingBox();
  const white = ((await page.locator('.cg-wrap').first().getAttribute('class')) ?? '').includes('orientation-white');
  const f = sq.charCodeAt(0) - 97, r = Number(sq[1]) - 1;
  const col = white ? f : 7 - f, row = white ? 7 - r : r;
  await page.touchscreen.tap(box.x + (col + 0.5) * box.width / 8, box.y + (row + 0.5) * box.height / 8);
}
async function move(page, uci) {
  await tapSquare(page, uci.slice(0, 2));
  await page.waitForTimeout(80);
  await tapSquare(page, uci.slice(2, 4));
}

/** Waagerechte Touch-Wischgeste über CDP (Playwright selbst kann nur tippen). */
async function swipe(page, y, x0, x1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function run(scheme) {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  /** Wischgeste ausführen und prüfen, ob die erwartete Seite kommt. */
  const expectSwipe = async (label, y, x0, x1, hash) => {
    await swipe(page, y, x0, x1);
    await page.waitForTimeout(550);
    const h = await page.evaluate(() => location.hash);
    console.log(`${scheme}: Wischen ${label} → ${h}${h === hash ? ' ok' : ' FEHLT'}`);
    if (h !== hash) errors.push(`Wischen ${label}: erwartet ${hash}, ist ${h}`);
  };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await mockExplorer(page);
  let n = 0;
  const shot = async (name, full = false) => {
    await page.waitForTimeout(700); // Animationen auslaufen lassen
    const file = `${OUT}/${scheme}-${String(++n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: file, fullPage: full });
  };
  const nav = (label) => page.locator('.nav-bottom').getByRole('button', { name: label }).click();

  await page.goto(BASE + '/');
  await page.waitForSelector('.welcome, .dash');
  await shot('welcome', true);

  await page.goto(BASE + '/#/settings');
  await page.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Audit Weiß');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  const token = page.getByPlaceholder('lip_…');
  await token.fill('lip_audit');
  await token.blur();
  await page.getByRole('button', { name: 'PGN direkt ins Repertoire' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea').fill(PGN);
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await shot('import-dialog');
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await shot('settings', true);

  await nav('Start');
  await shot('home', true);

  await nav('Bauen');
  await page.waitForSelector('.ctable');
  await shot('build-start');
  await shot('build-start-full', true);
  await move(page, 'e2e4');
  await page.waitForTimeout(500);
  await shot('build-e4');
  // Bottom-Sheet: am Kopf hochziehen (Touch-ähnlich in kleinen Schritten), Zug antippen klappt es wieder ein
  const sheet = page.locator('.bsheet');
  if (await sheet.count()) {
    await page.waitForTimeout(800); // Einblenden des Sheets abwarten, sonst misst man eine verschobene Position
    const head = await page.locator('.bs-head').boundingBox();
    const x = head.x + 40, y = head.y + 12;
    const cdp = await ctx.newCDPSession(page); // echte Touch-Geste (Playwright kann nur tippen)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 38 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    const expanded = (await sheet.getAttribute('class')).includes('full');
    await shot('build-sheet-full');
    await page.locator('.bs-grip').tap();
    await page.waitForTimeout(500);
    const collapsed = (await sheet.getAttribute('class')).includes('peek');
    await page.locator('.bs-tabs').getByRole('tab', { name: 'Übersicht' }).tap();
    await shot('build-sheet-map');
    await page.locator('.bs-tabs').getByRole('tab', { name: 'Züge' }).tap();
    console.log(`${scheme}: Sheet hochziehen ${expanded ? 'ok' : 'FEHLT'}, Griff-Tipp einklappen ${collapsed ? 'ok' : 'FEHLT'}`);
  }
  // Lückentour (Ast für Ast) starten
  await page.locator('.mode-switch').getByRole('button', { name: 'Lückentour' }).tap();
  await page.waitForSelector('[data-testid="guide"]');
  await shot('build-tour');
  await page.locator('.mode-switch').getByRole('button', { name: 'Frei' }).tap();
  // Abweichung vom Repertoire: ab Start 1.d4 statt 1.e4
  await page.getByRole('button', { name: 'Zum Anfang' }).tap();
  await page.waitForTimeout(300);
  await move(page, 'd2d4');
  await page.waitForSelector('[data-testid="outside"]');
  await shot('build-outside');
  // Wischen auf freien Brettfeldern (Reihe 5, g5 → b5): Bauen → Lücken
  const cg = await page.locator('.cg-wrap').boundingBox();
  await expectSwipe('Bauen, Brett', cg.y + (cg.height * 3.5) / 8, cg.x + (cg.width * 6.5) / 8, cg.x + cg.width / 8, '#/gaps');

  await nav('Lücken');
  await shot('gaps', true);

  await nav('Training');
  await shot('train-setup');
  await page.getByRole('button', { name: /neu lernen/ }).click();
  const trainer = page.locator('.trainer');
  await trainer.waitFor();
  let shotShow = false, shotWrong = false, shotRight = false;
  for (let guard = 0; guard < 40; guard++) {
    if (await page.getByText('Sitzung beendet').isVisible()) break;
    await page.waitForFunction(() => {
      const t = document.querySelector('.trainer');
      return !t || t.getAttribute('data-phase') !== 'context';
    }, null, { timeout: 15000 });
    if ((await page.getByText('Sitzung beendet').isVisible()) || !(await trainer.count())) break;
    const kind = await trainer.getAttribute('data-step-kind');
    const card = await trainer.getAttribute('data-card');
    const answer = await trainer.getAttribute('data-answer');
    if (kind === 'show') {
      if (!shotShow) { await shot('train-show'); shotShow = true; }
      await move(page, answer);
      await page.waitForFunction((c) => document.querySelector('.trainer')?.getAttribute('data-card') !== c, card, { timeout: 5000 }).catch(() => {});
      continue;
    }
    if (!shotWrong) {
      await move(page, 'a2a3');
      await page.waitForTimeout(150);
      await shot('train-wrong');
      shotWrong = true;
      await move(page, answer);
      await shot('train-fixed');
      await page.getByRole('button', { name: 'Weiter' }).click();
      continue;
    }
    await move(page, answer);
    if (!shotRight) { await page.waitForTimeout(100); await page.screenshot({ path: `${OUT}/${scheme}-${String(++n).padStart(2, '0')}-train-right.png` }); shotRight = true; }
    await page.waitForTimeout(1200);
    const next = page.getByRole('button', { name: 'Weiter' });
    if (await next.isVisible()) await next.click();
  }
  await shot('train-done');

  // Studien-Reiter: Studie aus eingefügtem PGN, Editor, Sheet, Kapitel
  await nav('Studien');
  await shot('studies-empty');
  await page.getByRole('button', { name: 'Studie hinzufügen' }).tap();
  const sd = page.getByRole('dialog');
  await sd.locator('textarea').fill(STUDY);
  await sd.getByPlaceholder('z. B. Anti-Sizilianer').fill('Anti-Sizilianer');
  await sd.getByRole('button', { name: 'Als Studie speichern' }).tap();
  await page.waitForSelector('.var-chips'); // Sheet ist in Studien eingeklappt – Brett, Varianten, Text frei
  const tapIn = async (loc) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
    await page.waitForTimeout(150);
    await loc.tap({ timeout: 8000 });
  };
  // Lichess-artig durchklicken: Variantenleiste unter dem Brett
  await page.locator('.var-chip', { hasText: '1.e4' }).tap();
  await page.locator('.var-chip', { hasText: 'c5' }).tap();
  await page.waitForTimeout(400);
  await shot('study-editor');
  await page.locator('.bs-grip').tap();
  await page.waitForTimeout(500);
  await shot('study-editor-full');
  await tapIn(page.locator('.smove', { hasText: '2.c3' }).getByRole('button', { name: /entfernen/ }));
  await page.waitForTimeout(300);
  await shot('study-cut');
  await page.locator('.bs-grip').tap();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Offen/ }).tap();
  await page.waitForTimeout(400);
  const progress = await page.locator('.study-progress').innerText();
  console.log(`${scheme}: Studie Fortschritt ${progress}`);
  await shot('study-next-open');
  // Wischen im Studienmodus: auf dem Text unter dem Brett und am eingeklappten Sheet → Training, zurück
  const txt = await page.locator('.study-comment, .study-nocomment').first().boundingBox();
  await expectSwipe('Studie, Text', txt.y + txt.height / 2, 60, 360, '#/train');
  await nav('Studien');
  await page.waitForSelector('.var-chips');
  await page.waitForTimeout(400);
  const bh = await page.locator('.bs-head').boundingBox();
  await expectSwipe('Studie, Sheet-Kopf', bh.y + 8, 60, 360, '#/train');
  await nav('Studien');
  await page.waitForSelector('.var-chips');
  await page.getByRole('tab', { name: /Kapitel/ }).tap();
  await shot('study-chapters');
  await nav('Studien');
  await nav('Studien');
  await shot('studies-list');

  // Repertoire-Auswahl (Pille oben rechts)
  await page.locator('.rep-select').click();
  await page.getByRole('dialog').waitFor();
  await shot('rep-picker');
  await page.keyboard.press('Escape');
  // Wischen zwischen Seiten: Studien → (nach rechts wischen) Training
  await swipe(page, 300, 50, 360);
  await page.waitForTimeout(500);
  const afterSwipe = await page.evaluate(() => location.hash);
  console.log(`${scheme}: Wischen Studien → ${afterSwipe}`);
  if (afterSwipe !== '#/train') errors.push(`Wischen: erwartet #/train, ist ${afterSwipe}`);
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.waitForTimeout(300);
  await shot('settings-top');
  await page.locator('.rep-list li').first().getByRole('button', { name: /Aktionen/ }).click();
  await page.getByRole('menuitem', { name: /Löschen/ }).or(page.locator('.rowmenu-pop button.danger')).first().click().catch(() => {});
  if (await page.getByRole('dialog').isVisible()) await shot('modal');

  console.log(`${scheme}: ${n} Screenshots, Fehler: ${errors.length ? errors.join(' | ') : 'keine'}`);
  await browser.close();
}

for (const scheme of ['light', 'dark']) await run(scheme);
