import type { Page, Route } from '@playwright/test';

/** Klick/Tipp auf ein Feld des (ersten sichtbaren) chessground-Bretts. */
export async function clickSquare(page: Page, sq: string) {
  const board = page.locator('cg-board').first();
  const box = (await board.boundingBox())!;
  const wrap = page.locator('.cg-wrap').first();
  const white = ((await wrap.getAttribute('class')) ?? '').includes('orientation-white');
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  const col = white ? file : 7 - file;
  const row = white ? 7 - rank : rank;
  const x = box.x + (col + 0.5) * (box.width / 8);
  const y = box.y + (row + 0.5) * (box.height / 8);
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

export async function move(page: Page, uci: string) {
  await clickSquare(page, uci.slice(0, 2));
  await page.waitForTimeout(80);
  await clickSquare(page, uci.slice(2, 4));
}

/** Explorer-Antworten nach Stellung (Brett + Seite am Zug). Unbekannt → keine Partien. */
export async function mockExplorer(page: Page, table: Record<string, [string, string, number][]>) {
  await page.route('https://explorer.lichess.org/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const fen = url.searchParams.get('fen') ?? '';
    const key = fen.split(' ').slice(0, 2).join(' ');
    const moves = table[key] ?? [];
    const total = moves.reduce((s, m) => s + m[2], 0);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        white: Math.floor(total / 2),
        draws: Math.floor(total / 4),
        black: total - Math.floor(total / 2) - Math.floor(total / 4),
        moves: moves.map(([uci, san, n]) => ({ uci, san, white: Math.floor(n / 2), draws: Math.floor(n / 4), black: n - Math.floor(n / 2) - Math.floor(n / 4) })),
        opening: null,
      }),
    });
  });
}
