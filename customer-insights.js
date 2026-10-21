import { readFile } from 'node:fs/promises';
import { analyticsQuery } from './analytics.js';

const customersSql = await readFile(new URL('./sql/customer-insights.sql', import.meta.url), 'utf8');
const productsSql = await readFile(new URL('./sql/customer-products.sql', import.meta.url), 'utf8');
const nonBuyersSql = await readFile(new URL('./sql/non-buyers.sql', import.meta.url), 'utf8');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPeriod = (start, end) => validDate(start) && validDate(end) && start <= end
  && (Date.parse(end) - Date.parse(start)) / 86400000 <= 365;

function customerQueryError(error) {
  const codes = [error.code, ...(error.errors ?? []).map(item => item.code)];
  if (codes.some(code => ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', '08001', '08006', '57P01', '57P03'].includes(code))
    || /connection terminated|connection timeout|timeout exceeded when trying to connect/i.test(error.message ?? '')) {
    return 'เชื่อมต่อฐานข้อมูล SML ไม่สำเร็จหรือการเชื่อมต่อถูกตัด กรุณาตรวจสอบเครือข่าย/VPN และบริการ PostgreSQL แล้วกดอัปเดตข้อมูลอีกครั้ง';
  }
  if (codes.some(code => ['28P01', '28000', '42501', '3D000'].includes(code))) {
    return 'การตั้งค่าหรือสิทธิ์เข้าถึงฐานข้อมูล SML ไม่ถูกต้อง กรุณาให้ผู้ดูแลตรวจสอบค่าเชื่อมต่อใน .env และสิทธิ์ฐานข้อมูล แล้วรีสตาร์ตเซิร์ฟเวอร์';
  }
  if (codes.includes('57014')) {
    return 'ดึงข้อมูลลูกค้าเกินเวลาที่กำหนด กรุณาลดช่วงวันที่แล้วกดอัปเดตข้อมูลอีกครั้ง';
  }
  return 'ดึงข้อมูลลูกค้าจาก SML ไม่สำเร็จ กรุณาลองใหม่';
}

// Same definition as the overview chart "ยอดขายแยกตามพนักงานขาย" (sale_code on sales lines, flag 44, no returns).
const sellersSql = analyticsQuery('salesperson');
// Territory users only see their own teams. Team codes accept the raw SML sale_code (กท-ต) or the normalized one (กต),
// matching scopeQuery in src/services/territoryService.js.
const ownSellersSql = `SELECT * FROM (${sellersSql}) s
  WHERE regexp_replace(regexp_replace(btrim(s.code), '^ฝ', ''), '^กท-', 'ก') = ANY($3::text[]) OR btrim(s.code) = ANY($3::text[])
  ORDER BY s."value" DESC, s.code`;
export const SELLER_VIEW_ROLES = ['super_admin', 'executive'];
export function sellerView(auth) {
  if (auth?.scope === 'territory') return 'own';
  return SELLER_VIEW_ROLES.includes(auth?.role) ? 'all' : null;
}

export function installCustomerInsights(app, pool, accessStore) {
  app.get('/api/customer-insights/sellers', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const view = sellerView(req.auth);
    if (!view) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูยอดขายตามพนักงานขาย' });
    const { start, end } = req.query;
    if (!validPeriod(start, end)) return res.status(400).json({ error: 'กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน' });
    try {
      const teams = req.territory?.mapping?.teams ?? [];
      const { rows } = view === 'own'
        ? await pool.query(ownSellersSql, [start, end, teams])
        : await pool.query(sellersSql, [start, end]);
      res.json({ view, rows: rows.map(r => ({ code: r.code, name: r.name, value: Number(r.value) })), start, end, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Sellers query failed:', error.code);
      res.status(503).json({ error: customerQueryError(error) });
    }
  });
  app.get('/api/customer-insights/non-buyers', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { start, end } = req.query;
    if (!validPeriod(start, end)) return res.status(400).json({ error: 'กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน' });
    try {
      const { rows } = await pool.query(nonBuyersSql, [start, end]);
      res.json({ ...rows[0].insights, start, end, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Non-buyers query failed:', error.code);
      res.status(503).json({ error: customerQueryError(error) });
    }
  });
  for (const detail of [false, true]) {
    app.get(`/api/customer-insights${detail ? '/products' : ''}`, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { start, end, code } = req.query;
      if (!validPeriod(start, end)) {
        return res.status(400).json({ error: 'กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน' });
      }
      // An empty code represents documents without an assigned customer.
      if (detail && (typeof code !== 'string' || code.length > 200)) {
        return res.status(400).json({ error: 'กรุณาระบุรหัสลูกค้าให้ถูกต้อง' });
      }
      try {
        const { rows } = await pool.query(detail ? productsSql : customersSql, detail ? [start, end, code] : [start, end]);
        const data = rows[0].insights;
        if (!detail && accessStore) {
          const territories = accessStore.all('SELECT name,mapping_json FROM sales_territories WHERE is_active=1').map(t=>({...t,mapping:JSON.parse(t.mapping_json)}));
          for (const customer of data.customers) {
            const names = new Set();
            for (const team of customer.teams || ['']) {
              const matches = territories.filter(t=>t.mapping.teams.includes(team)||t.mapping.customerCodes.includes(customer.code));
              names.add(matches.length===1?matches[0].name:matches.length?'หลายเขตขาย / ซ้อนทับ':'ไม่ระบุเขตขาย');
            }
            customer.region = names.size===1?[...names][0]:'หลายเขตขาย / ซ้อนทับ';
            delete customer.teams;
          }
        }
        if (detail && !data.customer) {
          return res.status(404).json({ error: 'ไม่พบรายการของลูกค้านี้ในช่วงวันที่เลือก' });
        }
        res.json({ ...data, start, end, updatedAt: new Date().toISOString() });
      } catch (error) {
        console.error('Customer insights query failed:', error.code);
        res.status(503).json({ error: customerQueryError(error) });
      }
    });
  }
}
