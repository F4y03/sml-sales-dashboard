// Shopee readers: order export and income report.
import { norm, text, round2, amount, orderDate, orderId, province, getter } from './common.js';

export const SHOPEE_FEES = ['feeAms', 'feeCommission', 'feeService', 'feeInfra', 'feeShippingSaver', 'feePayment'];
// Same breakdown keys as the Shopee API (get_escrow_detail) where one exists.
export const SHOPEE_FEE_KEYS = { feeAms: 'order_ams_commission_fee', feeCommission: 'commission_fee', feeService: 'service_fee',
  feeInfra: 'platform_infrastructure_fee', feeShippingSaver: 'shipping_saver_fee', feePayment: 'seller_transaction_fee' };

// Shopee order export: sales of a line = ราคาขายสุทธิ (ราคาขาย × จำนวน, i.e. normal price minus the seller's product
// discount — the same definition as the income report). Order-level vouchers and Shopee discounts are not deducted.
export function shopeeStatus(status, returnStatus, returnQty) {
  const s = norm(status), r = norm(returnStatus);
  if (/ยกเลิก|cancel/.test(s)) return 'cancelled';
  if (returnQty > 0 || (r && !/ปฏิเสธ|ยกเลิก|reject|cancel/.test(r))) return 'returned';
  if (/สำเร็จ|completed/.test(s)) return 'completed';
  return 'pending';
}
export function readShopeeOrders(rows, start, cols) {
  const orders = new Map();
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderId'));
    if (!id) continue;
    let order = orders.get(id);
    if (!order) {
      order = { orderId: id, orderDate: orderDate(get('orderDate')), statusRaw: text(get('status')), returnStatus: text(get('returnStatus')), province: province(get('province')), returnQty: 0, items: [] };
      orders.set(id, order);
    }
    order.returnStatus ||= text(get('returnStatus'));
    order.returnQty += Math.max(0, amount(get('returnQty')));
    const sku = text(get('sku')) || text(get('parentSku'));
    const name = [text(get('productName')), text(get('variation'))].filter(Boolean).join(' · ') || sku || 'ไม่ระบุชื่อสินค้า';
    let lineKey = `${sku}|${name}`;
    if (order.items.some(item => item.lineKey === lineKey)) lineKey += `#${order.items.length}`;
    order.items.push({ lineKey, sku, name, quantity: amount(get('quantity')), sales: round2(amount(get('netPrice'))) });
  }
  return [...orders.values()].map(({ returnStatus, returnQty, ...order }) => {
    const status = shopeeStatus(order.statusRaw, returnStatus, returnQty);
    const statusRaw = [order.statusRaw, returnStatus].filter(Boolean).join(' · ');
    return { ...order, statusRaw, status, refund: 0, source: 'orders', sales: round2(order.items.reduce((sum, item) => sum + item.sales, 0)), items: order.items.map(item => ({ ...item, status })) };
  });
}

export function readShopeeIncome(rows, start, cols) {
  const orders = new Map(), settlements = [];
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderId'));
    if (!id) continue;
    const fees = -SHOPEE_FEES.reduce((sum, key) => sum + amount(get(key)), 0);
    const line = { price: amount(get('price')), discount: Math.abs(amount(get('sellerDiscount'))), refund: Math.abs(amount(get('refund'))), payout: amount(get('payout')), fees, returnId: text(get('returnId')) };
    const order = orders.get(id) || { orderId: id, orderDate: orderDate(get('orderDate')), price: 0, discount: 0, refund: 0, payout: 0, fees: 0, returnId: '', detail: {} };
    for (const key of ['price', 'discount', 'refund', 'payout', 'fees']) order[key] += line[key];
    for (const key of SHOPEE_FEES) order.detail[SHOPEE_FEE_KEYS[key]] = (order.detail[SHOPEE_FEE_KEYS[key]] || 0) - amount(get(key));
    order.returnId ||= line.returnId;
    orders.set(id, order);
  }
  const result = [...orders.values()].map(o => {
    settlements.push({ txnId: `income:${o.orderId}`, orderId: o.orderId, fees: round2(o.fees), netPayout: round2(o.payout), detail: o.detail });
    // The income report only lists orders Shopee has paid out, so they are completed unless refunded.
    const status = o.returnId || o.refund > 0 ? 'returned' : 'completed';
    return { orderId: o.orderId, orderDate: o.orderDate, status, statusRaw: status === 'returned' ? 'คืนเงิน/คืนสินค้า' : 'โอนเงินแล้ว',
      sales: round2(o.price - o.discount), refund: round2(o.refund), province: null, items: null, source: 'income' };
  });
  return { orders: result, settlements };
}
