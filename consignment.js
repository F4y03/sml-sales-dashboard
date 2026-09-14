// Report 2060 / key 1132: stock-affecting movements, native unit conversion
// and POS exclusion. Deposits in this installation are inventory codes ฝ…,
// not ar_customer codes or the unused ic_wms_trans_detail module.
export const movementsSQL = `
 WITH movements AS (
  SELECT to_char(d.doc_date, 'YYYY-MM-DD') AS date, d.doc_no AS "docNo", d.trans_flag AS flag,
    COALESCE(substring(d.item_code FROM $2), d.item_code) AS customer,
    d.item_code AS "productCode", COALESCE(NULLIF(d.item_name,''),d.item_code) AS product,
    COALESCE(NULLIF(i.unit_standard,''),'ไม่ระบุหน่วย') AS unit,
    CASE WHEN d.calc_flag = -1 THEN 'เบิกออก' ELSE 'รับเข้า' END AS type,
    d.qty * d.stand_value / NULLIF(d.divide_value,0) AS quantity,
    d.qty * d.calc_flag * d.stand_value / NULLIF(d.divide_value,0) AS change,
    ROW_NUMBER() OVER (ORDER BY d.doc_date,d.doc_time,d.doc_no,d.line_number,d.roworder) AS index
  FROM ic_trans_detail d LEFT JOIN ic_inventory i ON i.code=d.item_code
  WHERE d.item_code LIKE $1 AND d.last_status=0 AND d.doc_date <= CURRENT_DATE
    AND (d.trans_flag IN (70,54,60,58,310,12,56,68,72,44)
      OR (d.trans_flag=66 AND d.qty<>0)
      OR (d.trans_flag=14 AND d.inquiry_type=0)
      OR (d.trans_flag=48 AND d.inquiry_type<2)
      OR (d.trans_flag IN (46,16) AND d.inquiry_type IN (0,2))
      OR (d.trans_flag=311 AND d.inquiry_type=0))
    AND NOT (d.doc_ref<>'' AND d.is_pos=1)
 )
 SELECT date,"docNo",flag,customer,"productCode",product,unit,type,quantity,index,
   SUM(change) OVER (PARTITION BY "productCode" ORDER BY index ROWS UNBOUNDED PRECEDING) AS balance
 FROM movements WHERE quantity<>0 OR quantity IS NULL ORDER BY index`;
export async function readConsignment(pool) {
  const {rows} = await pool.query(movementsSQL,['ฝ%','^ฝ[^0-9]{2}[0-9]{3}']);
  if(rows.some(r=>r.quantity===null || r.balance===null)) throw new Error('Invalid inventory unit conversion');
  return {ready:rows.length>0,rows,source:'SML · รายงานเคลื่อนไหวสินค้า ตามคลัง (2060)',reportKey:1132,
    customers:new Set(rows.map(r=>r.customer)).size, products:new Set(rows.map(r=>r.productCode)).size,
    message:rows.length ? 'พบสินค้ารหัสขึ้นต้น ฝ' : 'ไม่พบความเคลื่อนไหวของสินค้ารหัสขึ้นต้น ฝ',
    updatedAt:new Date().toISOString()};
}
const documentSQL = `
 SELECT to_char(d.doc_date, 'YYYY-MM-DD') AS date, d.doc_no AS "docNo",
   d.trans_flag AS flag, d.item_code AS code,
   COALESCE(NULLIF(d.item_name,''),d.item_code) AS product,
   COALESCE(NULLIF(i.unit_standard,''),'ไม่ระบุหน่วย') AS unit,
   CASE WHEN d.calc_flag = -1 THEN 'เบิกออก' ELSE 'รับเข้า' END AS type,
   d.qty * d.stand_value / NULLIF(d.divide_value,0) AS quantity
 FROM ic_trans_detail d LEFT JOIN ic_inventory i ON i.code=d.item_code
 WHERE d.doc_no=$1 AND d.doc_date=$2::date AND d.trans_flag=$3
   AND d.last_status=0 AND NOT (d.doc_ref<>'' AND d.is_pos=1)
 ORDER BY d.line_number,d.roworder`;

export async function readConsignmentDocument(pool, docNo, date, flag) {
  const {rows} = await pool.query(documentSQL,[docNo,date,flag]);
  return {docNo,date,flag,rows};
}
export function installConsignment(app,pool) {
  const handler=async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json(await readConsignment(pool));}
    catch(error){console.error('Consignment query failed:',error.code);res.status(503).json({error:error.code==='57014'?'ดึงข้อมูล SML เกินเวลาที่กำหนด กรุณาลองใหม่':'ดึงข้อมูลสินค้าฝากไม่สำเร็จ กรุณาลองใหม่'});}
  };
  app.get('/api/consignment',handler);app.get('/api/consignment/source',handler);
  app.get('/api/consignment/document',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const {docNo,date,flag}=req.query;
    if(!docNo||!date||!flag)return res.status(400).json({error:'ข้อมูลเอกสารไม่ครบ'});
    try{res.json(await readConsignmentDocument(pool,docNo,date,Number(flag)));}
    catch(error){console.error('Consignment document query failed:',error.code);res.status(503).json({error:'ดึงรายละเอียดเอกสารไม่สำเร็จ กรุณาลองใหม่'});}
  });
}
