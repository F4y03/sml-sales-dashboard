import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installReports } from './reports.js';

test('report requests work behind HTTPS termination and reject cross-site requests', async () => {
  const app = express();
  installReports(app, { query() { throw new Error('Unexpected database access'); } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/reports/invalid/run`;
    const request = headers => fetch(url, { method: 'POST', headers });
    const headers = { Origin: 'https://dashboard.example', 'X-PRPlus-Request': '1', 'Sec-Fetch-Site': 'same-origin' };
    // Passing the guard reaches key validation, without touching the database.
    assert.equal((await request(headers)).status, 400);
    assert.equal((await request({ ...headers, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request({ Origin: headers.Origin })).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
