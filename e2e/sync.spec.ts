// E2E: Sync zwischen zwei Geräten (zwei getrennte Browser-Profile) über ein Fake-Google-Drive.
// Google-Login (GIS) und Drive-REST werden nachgebaut – der echte Google-Weg braucht eine Client-ID.
import { test, expect, type BrowserContext, type Route } from '@playwright/test';

interface FakeFile {
  id: string;
  body: string;
  modifiedTime: string;
}

function fakeGoogle() {
  const state: { file?: FakeFile; uploads: number } = { uploads: 0 };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS' };

  async function handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers()['authorization'] !== 'Bearer fake-token') return route.fulfill({ status: 401, headers: cors, body: '{}' });
    const json = (data: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (url.pathname === '/drive/v3/files' && req.method() === 'GET') {
      expect(url.searchParams.get('spaces')).toBe('appDataFolder');
      return json({ files: state.file ? [{ id: state.file.id, modifiedTime: state.file.modifiedTime }] : [] });
    }
    if (url.pathname === '/drive/v3/files' && req.method() === 'POST') {
      const meta = JSON.parse(req.postData() ?? '{}');
      expect(meta.parents).toEqual(['appDataFolder']);
      state.file = { id: 'f1', body: '{}', modifiedTime: new Date().toISOString() };
      return json({ id: 'f1' });
    }
    if (url.pathname === '/upload/drive/v3/files/f1' && req.method() === 'PATCH') {
      state.file = { id: 'f1', body: req.postData() ?? '', modifiedTime: new Date().toISOString() };
      state.uploads++;
      return json({ id: 'f1' });
    }
    if (url.pathname === '/drive/v3/files/f1' && url.searchParams.get('alt') === 'media') {
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: state.file!.body });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  }

  async function attach(ctx: BrowserContext) {
    await ctx.addInitScript(() => {
      localStorage.setItem('replab.googleClientId', 'e2e-client.apps.googleusercontent.com');
      (window as unknown as { google: unknown }).google = {
        accounts: {
          oauth2: {
            initTokenClient: (cfg: { callback: (r: { access_token: string; expires_in: number }) => void }) => ({
              requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'fake-token', expires_in: 3600 }), 20),
            }),
            revoke: () => undefined,
          },
        },
      };
    });
    await ctx.route('https://www.googleapis.com/**', handle);
  }

  const snapshot = () => (state.file ? JSON.parse(state.file.body) : undefined);
  return { state, attach, snapshot };
}

test('Sync: PC → Drive → Handy, Änderung am Handy → PC', async ({ browser }) => {
  const g = fakeGoogle();
  const pcCtx = await browser.newContext();
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await g.attach(pcCtx);
  await g.attach(phoneCtx);
  const pc = await pcCtx.newPage();
  const phone = await phoneCtx.newPage();

  // PC: Repertoire mit zwei Zügen anlegen
  await pc.goto('/#/settings');
  await pc.getByPlaceholder('Name, z. B. Zweitwaffe 1.d4').fill('Sync Weiß');
  await pc.getByRole('button', { name: 'Anlegen' }).click();
  await pc.getByRole('button', { name: 'PGN direkt ins Repertoire' }).click();
  const dlg = pc.getByRole('dialog');
  await dlg.locator('textarea').fill('1. e4 e5 2. Nf3 *');
  await dlg.getByRole('button', { name: 'Vorschau' }).click();
  await dlg.getByRole('button', { name: 'Importieren' }).click();
  await expect(dlg).toHaveCount(0);

  // PC verbinden → Upload
  await pc.getByRole('button', { name: 'Mit Google verbinden' }).click();
  await expect(pc.locator('.sync-status')).toContainText('Synchronisiert');
  await expect.poll(() => g.snapshot()?.moves?.length).toBe(2);
  expect(JSON.stringify(g.snapshot())).not.toContain('token":"lip');

  // Handy (neu, leer): direkt auf der Startseite verbinden → holt alles
  await phone.goto('/');
  await expect(phone.getByText('Schon Daten auf einem anderen Gerät?')).toBeVisible();
  await phone.getByRole('button', { name: 'Mit Google Drive verbinden' }).click();
  await expect(phone.locator('.rep-select')).toContainText('Sync Weiß');
  await expect(phone.locator('.dash')).toBeVisible();
  await phone.goto('/#/settings');
  await expect(phone.locator('.sync-status')).toContainText('Synchronisiert');
  await expect(phone.locator('.rep-name').first()).toHaveValue('Sync Weiß');

  // Handy: Repertoire umbenennen → automatischer Upload nach kurzer Verzögerung
  const before = g.state.uploads;
  const name = phone.locator('.rep-name').first();
  await name.fill('Sync Weiß (Handy)');
  await name.blur();
  await expect.poll(() => g.state.uploads, { timeout: 15000 }).toBeGreaterThan(before);
  await expect.poll(() => g.snapshot()?.repertoires?.[0]?.name).toBe('Sync Weiß (Handy)');

  // PC: Wolke antippen → Änderung kommt an
  await pc.getByTestId('sync-btn').click();
  await expect(pc.locator('.rep-select')).toContainText('Sync Weiß (Handy)');

  // PC: Repertoire löschen → Handy übernimmt die Löschung (kein Wiederauferstehen)
  pc.once('dialog', (d) => void d.accept());
  await pc.locator('.rep-list li').first().getByRole('button', { name: 'löschen' }).click();
  await pc.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect.poll(() => g.snapshot()?.repertoires?.length, { timeout: 15000 }).toBe(0);
  await phone.getByTestId('sync-btn').click();
  await expect(phone.locator('.rep-list li')).toHaveCount(0);

  await pcCtx.close();
  await phoneCtx.close();
});
