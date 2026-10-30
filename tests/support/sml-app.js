import express from 'express';
import pg from 'pg';
import { installFixtureIdentity } from './fixture-identity.js';

// Serve feature routes + public/ against SML in read-only mode (PG* from .env: node --env-file=.env).
// TEST_URL points the test at an already running server instead.
export async function startSmlApp(...installers) {
  if (process.env.TEST_URL) return { base: process.env.TEST_URL, close: async () => {} };
  const pool = new pg.Pool({ connectionTimeoutMillis: 5000, statement_timeout: 30000, options: '-c default_transaction_read_only=on' });
  const app = express();
  app.use(express.json());
  installFixtureIdentity(app); // pages wait for /api/auth/me before loading data
  for (const install of installers) install(app, pool);
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.close(); await pool.end(); },
  };
}
