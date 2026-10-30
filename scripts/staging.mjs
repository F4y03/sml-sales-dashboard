// Staging server for the refactor worktree: same SML (read-only) as live, but isolated.
// Run from the worktree root: node scripts/staging.mjs   ->  https://localhost:3100
// - Reads the live .env in place (never copied/printed); STAGING_ENV_FILE overrides the path.
// - Drops marketplace/Google Sheets keys so no sync, backfill or token refresh runs against live shops.
// - Uses ./data/access.sqlite (a copy, see scripts/staging-copy-data.mjs) and its own backup folder.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const envFile = process.env.STAGING_ENV_FILE || fileURLToPath(new URL('../dashboard/.env', root));
process.loadEnvFile(envFile);
// Relative cert paths in .env are relative to the live folder.
for (const k of ['TLS_CERT_FILE', 'TLS_KEY_FILE']) if (process.env[k]) process.env[k] = resolve(dirname(envFile), process.env[k]);
for (const k of ['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY', 'LAZADA_APP_KEY', 'LAZADA_APP_SECRET',
  'TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET', 'TIKTOK_SERVICE_ID', 'GOOGLE_SHEETS_KEY_FILE', 'GOOGLE_SHEETS_ID']) delete process.env[k];
process.env.PORT = process.env.STAGING_PORT || '3100';
process.env.BACKUP_DIR = fileURLToPath(new URL('./data/staging-backups', root));

await import('../server.js');
