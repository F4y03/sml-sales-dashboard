// TikTok Shop readers: order export and settlement report.
import { norm, text, round2, amount, orderDate, orderId, province, getter } from './common.js';

// ---------- status buckets: completed (สำเร็จ) / pending (กำลังดำเนินการ) / cancelled (ยกเลิก) / returned (คืนสินค้า)
export function tiktokStatus(status, substatus, cancelType, refund, returnQty) {
  const s = norm(status), sub = norm(substatus), t = norm(cancelType);
  if (/ยกเลิก|cancel/.test(s) || t === 'cancel') return 'cancelled';
  if (refund > 0 || returnQty > 0 || /return|refund|คืน/.test(`${t} ${sub}`)) return 'returned';
  if (/เสร็จสมบูรณ์|completed|delivered|จัดส่งสำเร็จ/.test(`${s} ${sub}`)) return 'completed';
  return 'pending';
}

export function readTiktokOrders(rows, start, cols) {
  const orders = new Map();
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderId'));
    if (!id) continue;
    let order = orders.get(id);
    if (!order) {
      order = { orderId: id, orderDate: orderDate(get('created')), statusRaw: text(get('status')), substatus: text(get('substatus')),
        cancelType: text(get('cancelType')), refund: Math.abs(amount(get('refund'))), province: province(get('province')), returnQty: 0, items: [] };
      orders.set(id, order);
    }
    order.returnQty += Math.max(0, amount(get('returnQty')));
    const sku = text(get('sellerSku')) || text(get('skuId'));
    const name = [text(get('productName')), text(get('variation'))].filter(Boolean).join(' · ') || sku || 'ไม่ระบุชื่อสินค้า';
    let lineKey = text(get('skuId')) || `${sku}|${name}`;
    if (order.items.some(item => item.lineKey === lineKey)) lineKey += `#${order.items.length}`;
    order.items.push({ lineKey, sku, name, quantity: amount(get('quantity')), sales: round2(amount(get('subtotalBefore')) - Math.abs(amount(get('sellerDiscount')))) });
  }
  return [...orders.values()].map(({ substatus, cancelType, returnQty, ...order }) => {
    const status = tiktokStatus(order.statusRaw, substatus, cancelType, order.refund, returnQty);
    return { ...order, status, source: 'orders', sales: round2(order.items.reduce((sum, item) => sum + item.sales, 0)), items: order.items.map(item => ({ ...item, status })) };
  });
}

export function readTiktokSettlement(rows, start, cols) {
  const settlements = [];
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), txnId = orderId(get('txnId')), related = orderId(get('orderId'));
    if (!txnId || !related) continue;
    settlements.push({ txnId, orderId: related, fees: round2(-amount(get('fees'))), netPayout: round2(amount(get('net'))) });
  }
  return { orders: [], settlements };
}
