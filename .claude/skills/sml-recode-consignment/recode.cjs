// Move consignment item codes in SML from one prefix to another, e.g. ฝบอ054 -> ฝกต209.
//   survey (read-only):  node --env-file=.env .claude/skills/sml-recode-consignment/recode.cjs ฝบอ054 ฝกต209
//   apply (after OK):    node --env-file=.env .claude/skills/sml-recode-consignment/recode.cjs ฝบอ054 ฝกต209 --apply ITEMS TX
// ITEMS/TX are the counts the user approved from the survey; the transaction rolls back if they differ.
// Codes whose new code already exists are merged: trans rows move, the old master rows are deleted
// (backed up first) and the old balance_qty is added to the target. master_logs is never touched.
const pg = require('pg'), fs = require('fs'), path = require('path');
const [FROM, TO, mode, ITEMS, TX] = process.argv.slice(2);
const PREFIX = /^ฝ\D{2}\d{3}$/;
if (!PREFIX.test(FROM || '') || !PREFIX.test(TO || '') || FROM === TO) { console.log('usage: recode.cjs ฝxx000 ฝyy000 [--apply ITEMS TX]'); process.exit(1); }
if (!process.env.SML_WRITE_URL) { console.log('SML_WRITE_URL missing in .env'); process.exit(1); }
const DIR = path.resolve('data/sml-changes');
const MASTER = [['ic_inventory', 'code'], ['ic_inventory_detail', 'ic_code'], ['ic_unit_use', 'ic_code'], ['ic_wh_shelf', 'ic_code']];
const ALL = [...MASTER, ['ic_trans_detail', 'item_code']];
const nc = code => TO + code.slice(6);

async function survey(c) {
  // Any other text column holding these codes means this script would miss it -> stop.
  const cols = (await c.query(`select c.table_name t, c.column_name col from information_schema.columns c
    join information_schema.tables t on t.table_name=c.table_name and t.table_schema=c.table_schema and t.table_type='BASE TABLE'
    where c.table_schema='public' and c.data_type in ('character varying','text','character') and c.column_name ~* '(code|item|ic_)'`)).rows;
  const hits = [];
  for (const { t, col } of cols) {
    const n = (await c.query(`select count(*)::int n from "${t}" where "${col}" like $1`, [FROM + '%']).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
    if (n) hits.push({ t, col, n });
  }
  const items = (await c.query(`select a.code, a.name_1, a.unit_standard u, a.balance_qty::float q, b.code target, b.unit_standard tu, b.balance_qty::float tq,
    (select count(*) from ic_trans_detail x where x.item_code=a.code)::int tx
    from ic_inventory a left join ic_inventory b on b.code=$2||substr(a.code,7) where a.code like $1 order by a.code`, [FROM + '%', TO])).rows;
  const existing = (await c.query('select count(*)::int n from ic_inventory where code like $1', [TO + '%'])).rows[0].n;
  return { hits, items, existing };
}

(async () => {
  const c = new pg.Client({ connectionString: process.env.SML_WRITE_URL }); await c.connect();
  const s = await survey(c);
  const known = new Set([...ALL.map(([t, col]) => t + '.' + col), 'master_logs.code']);
  const unknown = s.hits.filter(h => !known.has(h.t + '.' + h.col));
  const tx = s.items.reduce((a, x) => a + x.tx, 0), merges = s.items.filter(x => x.target);
  if (mode !== '--apply') {
    console.log(`${FROM} -> ${TO} | items ${s.items.length} | trans rows ${tx} | with stock ${s.items.filter(x => x.q).length} qty ${s.items.reduce((a, x) => a + x.q, 0)} | ${TO} already has ${s.existing}`);
    for (const h of s.hits) console.log(`  ${h.t}.${h.col}: ${h.n}${h.t === 'master_logs' ? ' (not edited)' : known.has(h.t + '.' + h.col) ? '' : '  <-- UNKNOWN, stop'}`);
    for (const x of merges) console.log(`  MERGE ${x.code} (${x.u}, q ${x.q}) -> ${x.target} (${x.tu}, q ${x.tq})${x.u !== x.tu ? '  <-- UNIT DIFFERS, stop' : ''}`);
    console.log(`apply with: --apply ${s.items.length} ${tx}`);
    return c.end();
  }
  if (unknown.length) { console.log('STOP: codes also in', unknown.map(h => h.t + '.' + h.col).join(', ')); return c.end(); }
  if (merges.some(x => x.u !== x.tu)) { console.log('STOP: merge with different unit'); return c.end(); }
  const at = new Date().toISOString(), request = `ย้าย ${FROM} ไปเป็น ${TO}`, log = [];
  const L = (table, key, column, old, nw, note = '') => log.push({ at, by: 'claude_writer (ผู้ใช้สั่ง)', request: request + note, table, key, column, old, new: nw });
  try {
    await c.query('BEGIN');
    const backup = {};
    for (const [t, col] of ALL) backup[t] = (await c.query(`select * from "${t}" where "${col}" like $1 for update`, [FROM + '%'])).rows;
    backup.merge_targets = (await c.query('select * from ic_inventory where code = any($1) for update', [merges.map(x => x.target)])).rows;
    fs.mkdirSync(DIR, { recursive: true });
    const bfile = path.join(DIR, `backup-${at.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(bfile, JSON.stringify({ at, request, tables: backup }));
    let items = 0, moved = 0;
    for (const it of (await c.query('select code, balance_qty from ic_inventory where code like $1', [FROM + '%'])).rows) {
      const to = nc(it.code), target = (await c.query('select balance_qty from ic_inventory where code=$1', [to])).rows[0];
      const t = await c.query('update ic_trans_detail set item_code=$2 where item_code=$1 returning roworder', [it.code, to]);
      moved += t.rowCount; for (const x of t.rows) L('ic_trans_detail', { roworder: x.roworder }, 'item_code', it.code, to);
      for (const [tb, col] of MASTER) {
        const r = target ? await c.query(`delete from "${tb}" where "${col}"=$1 returning roworder`, [it.code])
          : await c.query(`update "${tb}" set "${col}"=$2 where "${col}"=$1 returning roworder`, [it.code, to]);
        for (const x of r.rows) L(tb, { roworder: x.roworder }, col, it.code, target ? null : to, target ? ' (รวม: ลบทะเบียนรหัสเดิม)' : '');
      }
      if (target && Number(it.balance_qty)) {
        const nb = (await c.query('update ic_inventory set balance_qty=balance_qty+$2 where code=$1 returning balance_qty', [to, it.balance_qty])).rows[0].balance_qty;
        L('ic_inventory', { code: to }, 'balance_qty', String(target.balance_qty), String(nb), ' (รวมยอดคงเหลือ)');
      }
      items++;
    }
    if (items !== +ITEMS || moved !== +TX) throw new Error(`count mismatch: items ${items}/${ITEMS}, trans ${moved}/${TX}`);
    for (const [t, col] of ALL) { const n = (await c.query(`select count(*)::int n from "${t}" where "${col}" like $1`, [FROM + '%'])).rows[0].n; if (n) throw new Error(`${t} still has ${n}`); }
    const dup = (await c.query('select code from ic_inventory where code like $1 group by code having count(*)>1', [TO + '%'])).rows;
    if (dup.length) throw new Error('duplicate codes ' + dup.map(d => d.code));
    await c.query('COMMIT');
    fs.appendFileSync(path.join(DIR, 'sml-changes.jsonl'), log.map(l => JSON.stringify(l)).join('\n') + '\n');
    const after = (await c.query('select count(*)::int items, count(*) filter (where balance_qty<>0)::int with_stock, coalesce(sum(balance_qty),0)::float qty from ic_inventory where code like $1', [TO + '%'])).rows[0];
    console.log(`COMMIT ok | items ${items} (merged ${merges.length}) | trans ${moved} | logged ${log.length} | backup ${bfile}`);
    console.log(`${TO} now: ${after.items} items, ${after.with_stock} with stock, qty ${after.qty}`);
  } catch (e) { await c.query('ROLLBACK'); console.log('ROLLBACK (nothing changed):', e.message); }
  await c.end();
})();
