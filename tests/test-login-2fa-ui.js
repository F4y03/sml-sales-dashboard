import { chromium } from '@playwright/test';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { installAuth, hashPassword } from './auth.js';
import { totpAt } from './src/services/totpService.js';
// Super Admin login through the real page: password -> QR/enrol -> recovery codes -> dashboard, then OTP + trusted device on the next login.
const app = express();
app.use(express.json());
const auth = installAuth(app, { AUTH_USERNAME: 'ui-admin', AUTH_PASSWORD_HASH: await hashPassword('ui-test-password'), AUTH_COOKIE_SECURE: 'false' });
app.get('/executive.html', (req, res) => res.send('<title>dash</title>dashboard'));
app.use(express.static('public'));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const base = `http://127.0.0.1:${server.address().port}`;
  const password = async () => { await page.goto(base + '/login.html'); await page.locator('#username').fill('ui-admin'); await page.locator('#password').fill('ui-test-password'); await page.locator('#submit').click(); };
  await password();
  await page.locator('#twofa-qr').waitFor();
  assert.match(await page.locator('#twofa-qr').getAttribute('src'), /^data:image\/svg\+xml;base64,/);
  const secret = (await page.locator('#twofa-secret').textContent()).trim();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(await page.locator('#login-form').isHidden(), true);
  await page.locator('#otp').fill('000000');
  await page.locator('#twofa-submit').click();
  await page.getByText('รหัสยืนยันไม่ถูกต้อง', { exact: true }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/login-2fa-setup.png', fullPage: true });
  await page.locator('#otp').fill(totpAt(secret));
  await page.locator('#twofa-trust').check();
  await page.locator('#twofa-submit').click();
  await page.locator('#recovery-codes').waitFor();
  assert.equal((await page.locator('#recovery-codes').textContent()).trim().split('\n').length, 10);
  await page.screenshot({ path: 'test-results/login-2fa-recovery.png', fullPage: true });
  await page.locator('#recovery-done').click();
  await page.waitForURL('**/executive.html');
  const cookies = await context.cookies();
  const trusted = cookies.find(c => c.name === 'prplus_trusted');
  assert.ok(trusted?.httpOnly && trusted.sameSite === 'Strict', 'trusted-device cookie is httpOnly + SameSite=Strict');
  // Trusted browser: password only.
  await context.request.post(base + '/api/auth/logout', { headers: { 'X-PRPlus-Request': '1' } });
  await password();
  await page.waitForURL('**/executive.html');
  // Untrusted browser: OTP required, no QR this time.
  await context.clearCookies();
  await password();
  await page.locator('#otp').waitFor();
  assert.equal(await page.locator('#twofa-setup').isHidden(), true);
  await page.locator('#twofa-back').click();
  assert.equal(await page.locator('#login-form').isVisible(), true);
  console.log('Super Admin OTP enrolment, recovery codes, trusted device and OTP login UI passed.');
} finally { await browser?.close(); auth.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
