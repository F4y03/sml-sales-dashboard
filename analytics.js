const dimensions = {
  group: {title:'ยอดขายแยกตามกลุ่มสินค้า',code:'i.group_main',name:'g.name_1'},
  salesperson: {title:'ยอดขายแยกตามพนักงานขาย',code:'d.sale_code',name:'u.name_1'},
  customer: {title:'ยอดขายแยกตามลูกค้า',code:'d.cust_code',name:'c.name_1'},
  brand: {title:'ยอดขายแยกตามยี่ห้อสินค้า',code:'i.item_brand',name:'b.name_1'},
  branch: {title:'ยอดขายแยกตามสาขา',code:'d.branch_code',name:'s.name_1'},
  type: {title:'ยอดขายแยกตามประเภทสินค้า',code:'i.item_type::text',name:"CASE WHEN i.item_type IS NULL THEN NULL ELSE 'ประเภท ' || i.item_type::text END"},
  quantity: {title:'จำนวนขายแยกตามกลุ่มสินค้า',code:'i.group_main',name:'g.name_1'}
};
const joins=`FROM ic_trans_detail d
 LEFT JOIN (SELECT code,MAX(group_main) group_main,MAX(item_brand) item_brand,MAX(item_type) item_type FROM ic_inventory GROUP BY code) i ON i.code=d.item_code
 LEFT JOIN (SELECT code,MAX(name_1) name_1 FROM ic_group GROUP BY code) g ON g.code=i.group_main
 LEFT JOIN (SELECT code,MAX(name_1) name_1 FROM erp_user GROUP BY code) u ON u.code=d.sale_code
 LEFT JOIN (SELECT code,MAX(name_1) name_1 FROM ar_customer GROUP BY code) c ON c.code=d.cust_code
 LEFT JOIN (SELECT code,MAX(name_1) name_1 FROM ic_brand GROUP BY code) b ON b.code=i.item_brand
 LEFT JOIN (SELECT code,MAX(name_1) name_1 FROM erp_branch_list GROUP BY code) s ON s.code=d.branch_code
 WHERE d.trans_flag=44 AND d.last_status=0 AND d.item_code<>'' AND d.doc_date >= $1::date AND d.doc_date < $2::date + INTERVAL '1 day'`;
export function analyticsQuery(mode,grain='day') {
  if(mode==='net') {
    if(!['day','month'].includes(grain))throw new Error('ช่วงสรุปไม่ถูกต้อง');
    return `WITH source AS (SELECT doc_date::date AS sale_day,CASE WHEN trans_flag=48 THEN -total_amount ELSE total_amount END amount
      FROM ic_trans WHERE trans_flag IN (44,46,48) AND last_status=0 AND is_doc_copy=0 AND doc_date >= $1::date AND doc_date < $2::date+INTERVAL '1 day'),
      days AS (SELECT d::date AS sale_day,COALESCE(SUM(s.amount),0) amount FROM generate_series($1::date,$2::date,INTERVAL '1 day') d LEFT JOIN source s ON s.sale_day=d::date GROUP BY d)
      SELECT to_char(date_trunc('${grain}',sale_day),'${grain==='day'?'YYYY-MM-DD':'YYYY-MM'}') code,
      to_char(date_trunc('${grain}',sale_day),'${grain==='day'?'YYYY-MM-DD':'YYYY-MM'}') AS "name",SUM(amount) AS "value",'' AS unit
      FROM days GROUP BY 1,2 ORDER BY 1`;
  }
  if(!Object.hasOwn(dimensions,mode))throw new Error('รูปแบบกราฟไม่ถูกต้อง');
  const def=dimensions[mode],qty=mode==='quantity';
  return `SELECT COALESCE(${def.code},'') code,COALESCE(NULLIF(${def.name},''),NULLIF(${def.code},''),'ไม่ระบุ') AS "name",
    COALESCE(SUM(d.${qty?'qty':'sum_amount'}),0) AS "value",${qty?"COALESCE(NULLIF(d.unit_code,''),'ไม่ระบุหน่วย')":"''"} AS unit
    ${joins} GROUP BY 1,2${qty?',4':''} ORDER BY "value" DESC,code${qty?',unit':''}`;
}
export function installAnalytics(app,pool){
  app.get('/api/analytics',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const {start,end,mode='group',grain='day'}=req.query;
    const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
    if(!date(start)||!date(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>365)return res.status(400).json({error:'ช่วงวันที่ไม่ถูกต้อง ต้องไม่เกิน 366 วัน'});
    let sql;try{sql=analyticsQuery(mode,grain);}catch(e){return res.status(400).json({error:e.message});}
    try{
      const {rows}=await pool.query(sql,[start,end]);
      res.json({mode,grain,title:mode==='net'?'ยอดขายสุทธิแยกตาม'+(grain==='day'?'วัน':'เดือน'):dimensions[mode].title,rows:rows.map(r=>({...r,value:Number(r.value)})),unit:mode==='quantity'?'quantity':'THB',start,end,updatedAt:new Date().toISOString(),
        note:mode==='net'?'ยอดเอกสารขาย + เพิ่มหนี้ − รับคืน/ลดหนี้ ตามวันที่เอกสาร · ตัดเอกสารยกเลิกและสำเนา · อ้างอิงรายงาน 4086':mode==='quantity'?'จำนวนตามหน่วยขายในเอกสาร แยกกลุ่มและหน่วยนับ ไม่หักรับคืน และไม่รวมหน่วยต่างชนิดเข้าด้วยกัน':`ยอดรายการขาย ไม่หักรับคืน · กลุ่ม/ยี่ห้อ/ประเภทอิงทะเบียนสินค้าปัจจุบัน${mode==='type'?' · แสดงรหัสประเภทตาม SML':''}`});
    }catch(e){console.error('analytics',mode,e.code);res.status(503).json({error:'ดึงข้อมูลกราฟไม่สำเร็จ กรุณาลองใหม่'});}
  });
}
