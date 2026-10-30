// Refactor safety net: call the main read APIs for a fixed past period and save the JSON, so a
// refactor can prove the numbers did not move.  SML is read-only; the access store is the staging copy.
//   node --env-file=../dashboard/.env scripts/api-snapshot.mjs test-results/snapshot-before.json
//   node --env-file=../dashboard/.env scripts/api-snapshot.mjs test-results/snapshot-after.json --compare test-results/snapshot-before.json
import express from 'express';
import pg from 'pg';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
// Works before and after feature files move into src/routes/.
async function load(name) {
  for (const rel of [`src/routes/${name}`, name]) {
    const file = fileURLToPath(new URL(rel, root));
    if (existsSync(file)) return import(pathToFileURL(file).href);
  }
  throw new Error(`module not found: ${name}`);
}
const { createAccessStore } = await import(new URL('src/models/accessStore.js', root).href);

const smlPool = new pg.Pool({ connectionTimeoutMillis: 5000, statement_timeout: 60000, max: 3, options: '-c default_transaction_read_only=on' });
const store = createAccessStore(fileURLToPath(new URL('data/access.sqlite', root)), {});
const audit = { log() {}, record() {} };
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.auth = { id: 0, username: 'snapshot', role: 'super_admin', scope: 'all', territories: [], permissions: [] }; next(); });
(await load('reports.js')).installReports(app, smlPool);
(await load('products.js')).installProducts(app, smlPool);
(await load('analytics.js')).installAnalytics(app, smlPool);
(await load('executive.js')).installExecutive(app, smlPool);
(await load('customer-insights.js')).installCustomerInsights(app, smlPool, store);
(await load('customer-stock.js')).installCustomerStock(app, smlPool);
(await load('product-performance.js')).installProductPerformance(app, smlPool);
(await load('sales-trend.js')).installSalesTrend(app, smlPool);
(await load('consignment.js')).installConsignment(app, smlPool);
(await load('marketplace.js')).installMarketplace(app, store, audit);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const p = 'start=2026-09-01&end=2026-09-30';
const paths = [
  `/api/executive?${p}`, `/api/executive/customers?${p}&code=`,
  `/api/analytics?${p}&mode=group`, `/api/sales-trend?year=2026`, `/api/sales-trend/daily?${p}`,
  `/api/customer-insights?${p}`, `/api/customer-insights/sellers?${p}`, `/api/customer-insights/non-buyers?${p}`,
  `/api/customer-insights/catalog?${p}`,
  '/api/products?activity=all&stock=all', '/api/products/export?format=json&scope=filtered&activity=all&stock=in',
  '/api/customer-stock/stock', '/api/consignment', '/api/reports',
  `/api/marketplace/summary?${p}`, `/api/marketplace/order-fees?${p}&page=0`,
];
// Volatile fields only; every number stays in the comparison.
const volatile = new Set(['updatedAt', 'generatedAt', 'checkedAt', 'cachedAt', 'exportedAt', 'source']);
const clean = value => Array.isArray(value) ? value.map(clean)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => !volatile.has(k)).map(([k, v]) => [k, clean(v)]))
  : value;

const out = {};
for (const path of paths) {
  const res = await fetch(base + path);
  const text = await res.text();
  let body; try { body = clean(JSON.parse(text)); } catch { body = text.slice(0, 200); }
  out[path] = { status: res.status, body };
  console.log(String(res.status).padEnd(4), path);
}
server.close(); await smlPool.end();

const [target, flag, against] = process.argv.slice(2);
if (target) writeFileSync(target, JSON.stringify(out, null, 1));
if (flag === '--compare') {
  const before = JSON.parse(readFileSync(against, 'utf8'));
  const diff = Object.keys({ ...before, ...out }).filter(k => JSON.stringify(before[k]) !== JSON.stringify(out[k]));
  console.log(diff.length ? `DIFFERENT: ${diff.join(', ')}` : `SAME: all ${paths.length} responses identical`);
  process.exitCode = diff.length ? 1 : 0;
}
