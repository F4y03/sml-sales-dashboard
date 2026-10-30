// Google Sheets export: signed service-account JWT, tabs created when missing, full rewrite, blanks (not 0) without fee data.
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { createAccessStore } from '../src/models/accessStore.js';
import { saveMarketplaceUpload } from '../marketplace.js';
import { buildExportTabs, createSheetsClient } from '../src/services/googleSheets.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { email: 'dashboard-sheets@example.iam.gserviceaccount.com', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

function fakeGoogle({ tabs = ['Sheet1'] } = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, auth: init.headers?.authorization, body: init.body });
    if (u.hostname === 'oauth2.googleapis.com') {
      const [h, p, s] = new URLSearchParams(String(init.body)).get('assertion').split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
      const claims = JSON.parse(Buffer.from(p, 'base64url'));
      if (!ok || claims.iss !== account.email || !claims.scope.includes('spreadsheets')) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'ya29.test', expires_in: 3600 });
    }
    if (init.headers?.authorization !== 'Bearer ya29.test') return json({ error: { message: 'unauthorized' } }, 401);
    if (u.pathname.endsWith('/sheet-id') && init.method === 'GET') return json({ sheets: tabs.map((title, sheetId) => ({ properties: { sheetId, title } })) });
    if (u.pathname.endsWith('/missing')) return json({ error: { message: 'Requested entity was not found.' } }, 404);
    return json({});
  };
  return { calls, fetchImpl };
}

test('signs a service-account JWT, adds missing tabs, clears then writes every tab', async () => {
  const g = fakeGoogle({ tabs: ['Sheet1', 'ออเดอร์'] });
  const client = createSheetsClient({ account, fetchImpl: g.fetchImpl });
  await client.writeTabs('sheet-id', [{ title: 'ออเดอร์', rows: [['a']] }, { title: 'สินค้า', rows: [['b']] }], ['Sheet1']);
  const paths = g.calls.map(c => c.method + ' ' + c.path.replace('/v4/spreadsheets/', ''));
  assert.deepEqual(paths, ['POST /token', 'GET sheet-id', 'POST sheet-id:batchUpdate', 'POST sheet-id/values:batchClear', 'POST sheet-id/values:batchUpdate']);
  const requests = JSON.parse(g.calls[2].body).requests;
  assert.deepEqual(requests.filter(r => r.addSheet).map(r => r.addSheet.properties.title), ['สินค้า']); // only the missing tab
  assert.deepEqual(requests.filter(r => r.deleteSheet).map(r => r.deleteSheet.sheetId), [0]); // listed old tab removed
  assert.equal(JSON.parse(g.calls[4].body).valueInputOption, 'RAW'); // cell text is never run as a formula
  await assert.rejects(client.writeTabs('missing', []), /แชร์ชีตให้อีเมล Service Account/);
});

test('export rows follow the dashboard definitions; no fee data stays blank', t => {
  const store = createAccessStore(':memory:', {});
  t.after(() => store.close());
  saveMarketplaceUpload(store, { platform: 'tiktok', fileName: 'x', sha256: 'h', user: null, parsed: { kinds: ['api'], shopCode: null,
    orders: [
      { orderId: 'A1', orderDate: '2026-10-01', status: 'completed', statusRaw: 'COMPLETED', sales: 300, refund: 0, province: 'ชลบุรี', source: 'api', items: [{ lineKey: '1', sku: 'S1', name: 'สินค้า', quantity: 1, sales: 300, status: 'completed' }] },
      { orderId: 'A2', orderDate: '2026-10-01', status: 'cancelled', statusRaw: 'CANCELLED', sales: 50, refund: 0, province: null, source: 'api', items: null }],
    settlements: [{ txnId: 't1', orderId: 'A1', fees: 30, netPayout: 270 }] } });
  const tabs = buildExportTabs(store, new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(tabs.map(t => t.title), ['Shopee · ออเดอร์', 'Shopee · สินค้า', 'Shopee · สรุปรายวัน', 'Lazada · ออเดอร์', 'Lazada · สินค้า', 'Lazada · สรุปรายวัน',
    'TikTok Shop · ออเดอร์', 'TikTok Shop · สินค้า', 'TikTok Shop · สรุปรายวัน', 'ข้อมูล']);
  const tab = title => tabs.find(t => t.title === title);
  assert.equal(tab('Shopee · ออเดอร์').rows.length, 1); // each platform only its own orders (header only here)
  const orders = tab('TikTok Shop · ออเดอร์');
  assert.deepEqual(orders.rows[1].slice(1, 11), ['A1', '2026-10-01', 'สำเร็จ', 'COMPLETED', 300, 0, 'ชลบุรี', 30, 270, 'API']);
  assert.deepEqual(orders.rows[2].slice(7, 10), ['', '', '']); // no province, no fee data -> blank, not 0
  assert.equal(tab('TikTok Shop · สินค้า').rows.length, 2);
  assert.deepEqual(tab('TikTok Shop · สรุปรายวัน').rows.slice(1), [['2026-10-01', 1, 300]]); // cancelled not counted
  assert.equal(tab('ข้อมูล').rows[0][1], '2026-10-20T00:00:00.000Z');
});

test('scheduled export runs again only after GOOGLE_SHEETS_EVERY_HOURS since the last success', async t => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { installGoogleSheets } = await import('../google-sheets.js');
  const dir = mkdtempSync(join(tmpdir(), 'gs-')), keyFile = join(dir, 'key.json');
  writeFileSync(keyFile, JSON.stringify({ type: 'service_account', client_email: account.email, private_key: account.privateKey }));
  const store = createAccessStore(':memory:', {});
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const g = fakeGoogle();
  let clock = Date.parse('2026-10-20T00:00:00Z');
  const app = { get() {}, post() {} };
  const job = installGoogleSheets(app, store, { record() {} }, { GOOGLE_SHEETS_KEY_FILE: keyFile, GOOGLE_SHEETS_ID: 'sheet-id', GOOGLE_SHEETS_EVERY_HOURS: '5' },
    { fetchImpl: g.fetchImpl, now: () => clock });
  const exports = () => g.calls.filter(c => c.path.endsWith('values:batchUpdate')).length;
  const run = async () => { job.tick(); await new Promise(r => setTimeout(r, 20)); };
  await run(); assert.equal(exports(), 1); // never exported -> now
  clock += 4.9 * 3600000; await run(); assert.equal(exports(), 1); // too soon
  clock += 0.2 * 3600000; await run(); assert.equal(exports(), 2); // 5 h passed
});
