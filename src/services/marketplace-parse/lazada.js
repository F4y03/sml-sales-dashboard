// Lazada readers: order export and Income Overview statement.
import { fail, norm, text, round2, money, amount, orderDate, orderId, province, getter } from './common.js';

export function lazadaItemStatus(status, refund) {
  const s = norm(status);
  if (/cancel/.test(s)) return 'cancelled';
  if (refund > 0 || /return|refund|failed/.test(s)) return 'returned';
  if (/delivered|confirmed|completed/.test(s)) return 'completed';
  return 'pending';
}

export function readLazadaOrders(rows, start, cols) {
  const orders = new Map();
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderNumber'));
    if (!id) continue;
    let order = orders.get(id);
    if (!order) {
      const ship = province(get('shipProvince'));
      order = { orderId: id, orderDate: orderDate(get('createTime')), province: ship || province(get('billProvince')), items: [] };
      orders.set(id, order);
    }
    const refund = Math.abs(amount(get('refund'))), statusRaw = text(get('status'));
    const sku = text(get('sellerSku')) || text(get('lazadaSku'));
    const name = [text(get('itemName')), text(get('variation'))].filter(Boolean).join(' · ') || sku || 'ไม่ระบุชื่อสินค้า';
    let lineKey = text(get('itemId')) || `${sku}|${name}`;
    if (order.items.some(item => item.lineKey === lineKey)) lineKey += `#${order.items.length}`;
    // One row is one unit in the Lazada export.
    order.items.push({ lineKey, sku, name, quantity: 1, sales: round2(amount(get('unitPrice')) - Math.abs(amount(get('sellerDiscount')))), refund, statusRaw, status: lazadaItemStatus(statusRaw, refund) });
  }
  return [...orders.values()].map(order => {
    const active = order.items.filter(item => item.status !== 'cancelled');
    const status = !active.length ? 'cancelled' : active.some(item => item.status === 'returned') ? 'returned'
      : active.every(item => item.status === 'completed') ? 'completed' : 'pending';
    const counted = active.length ? active : order.items;
    return { ...order, status, source: 'orders', statusRaw: [...new Set(order.items.map(item => item.statusRaw))].join(', '),
      sales: round2(counted.reduce((sum, item) => sum + item.sales, 0)), refund: round2(order.items.reduce((sum, item) => sum + item.refund, 0)),
      items: order.items.map(({ refund, statusRaw, ...item }) => item) };
  });
}

// Lazada Income Overview (ใบแจ้งยอด): one row per money line. Per order and billing cycle,
// netPayout = Σ all lines; fees = product lines (ยอดรวมค่าสินค้า / หักเงินค่าสินค้า) − netPayout.
export const LAZADA_PRODUCT_LINES = /^(ยอดรวมค่าสินค้า|หักเงินค่าสินค้า)/;
export function readLazadaStatement(rows, start, cols) {
  const groups = new Map();
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderNumber')), cycle = text(get('cycle'));
    if (!id || !cycle) continue;
    const txnId = `statement:${cycle}:${id}`.slice(0, 120), value = amount(get('amount'));
    const g = groups.get(txnId) || { txnId, orderId: id, product: 0, net: 0 };
    g.net += value;
    if (LAZADA_PRODUCT_LINES.test(text(get('feeName')))) g.product += value;
    groups.set(txnId, g);
  }
  const settlements = [...groups.values()].map(g => ({ txnId: g.txnId, orderId: g.orderId, fees: round2(g.product - g.net), netPayout: round2(g.net) }));
  return { orders: [], settlements };
}
