// Shared helpers for the product-image workflow (see .claude/skills/product-images/SKILL.md).
// Read-only on SML; writes only to the app DB / product-sheet data files when a script says --apply.
import pg from 'pg';
import { readdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const DRIVE_FOLDER = 'G:/My Drive/wed/product/Lim 2026/'; // public Drive folder the CSV links point to
export const SHEET = 'http://127.0.0.1:3002'; // product-sheet tool (CSV)
export const OVERRIDES = 'product-sheet/data/image-overrides.json';
export const EXTRA = 'product-sheet/data/extra-products.json';
export const HIDDEN = 'product-sheet/data/hidden-codes.json';

export const smlPool = () => new pg.Pool({ max: 2, connectionTimeoutMillis: 8000, statement_timeout: 120000, options: '-c default_transaction_read_only=on' });
export const appDb = (readOnly = true) => new DatabaseSync('data/access.sqlite', { readOnly });

// Drive for Desktop keeps file IDs in a local SQLite DB (one folder per signed-in account).
export function driveDb() {
  const root = process.env.LOCALAPPDATA + '/Google/DriveFS/';
  const account = readdirSync(root).find(d => /^\d+$/.test(d) && existsSync(root + d + '/metadata_sqlite_db'));
  if (!account) throw new Error('Google Drive for Desktop metadata not found');
  return new DatabaseSync(root + account + '/metadata_sqlite_db', { readOnly: true });
}

export const sheetImages = async () => (await (await fetch(SHEET + '/api/product-images')).json()).images || {};

// The CSV the website imports, parsed (descriptions span lines, so a real parser is needed).
export async function csvRows() {
  const t = (await (await fetch(SHEET + '/download.csv')).text()).replace(/^\uFEFF/, '');
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; } else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); } // last row has no trailing newline
  const h = rows[0];
  return rows.slice(1).filter(x => x.length > 3).map(x => Object.fromEntries(h.map((k, i) => [k.trim(), (x[i] ?? '').trim()])));
}

export const driveIdOf = link => String(link).match(/\/(?:file\/)?d\/([\w-]{20,})/)?.[1];
export const safeName = s => String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
