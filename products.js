import pg from 'pg';
import ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';

export const productLabels = {code:'รหัสสินค้า',code_old:'รหัสสินค้าเดิม',name_1:'ชื่อสินค้า',name_2:'ชื่อสินค้า 2',name_eng_1:'ชื่อภาษาอังกฤษ',group_main:'รหัสกลุ่มหลัก',group_main_name:'ชื่อกลุ่มหลัก',group_sub:'รหัสกลุ่มย่อย',unit_standard:'หน่วยมาตรฐาน',item_brand:'รหัสยี่ห้อ',item_model:'รุ่น',description:'รายละเอียด',remark:'หมายเหตุ',average_cost:'ต้นทุนเฉลี่ยในทะเบียน',balance_qty:'ยอดคงเหลือในทะเบียน',item_status:'สถานะสินค้า (รหัส)',status:'สถานะ (รหัส)'};
const types={getTypeParser:(oid,format)=>[1082,1114,1184].includes(oid)?v=>v:pg.types.getTypeParser(oid,format)};
function filters(query) {
  const q=query.q??'', group=query.group??'', stock=query.stock??'all', best=query.best??'off';
  if(typeof q!=='string'||typeof group!=='string'||q.length>200||group.length>100)throw new Error('ตัวกรองไม่ถูกต้อง');
  const activity=query.activity??'all';if(!['all','active','inactive'].includes(activity)||!['all','in','out'].includes(stock))throw new Error('สถานะไม่ถูกต้อง');
  if(!Object.hasOwn(bestSellerWindows,best))throw new Error('ตัวกรองสินค้าขายดีไม่ถูกต้อง');
  return {q:q.trim(),group,activity,stock,best};
}
// สินค้าขายดี: ยอดขายสุทธิตามนิยามเดียวกับ sql/product-performance-base.sql
// (trans_flag 44 ขาย + 46 เพิ่มหนี้ - 48 รับคืน, เฉพาะเอกสารไม่ยกเลิกและไม่ใช่สำเนา, ตัดสินค้าฝากขาย)
const bestSellerWindows={off:null,all:'','3m':"AND d.doc_date >= (CURRENT_DATE - INTERVAL '3 months') AND d.doc_date < (CURRENT_DATE + INTERVAL '1 day')"};
const bestSellerNet="SUM(CASE WHEN d.trans_flag=48 THEN -1 ELSE 1 END * COALESCE(d.sum_amount,0))";
// `mode` ผ่าน whitelist มาแล้ว ช่วงวันที่จึงเป็นค่าคงที่ในโค้ด ไม่ใช่ input จากผู้ใช้
const bestSellerCte=mode=>mode==='off'
  ? 'best_sellers AS (SELECT NULL::text AS code, NULL::numeric AS net WHERE false)'
  : `best_sellers AS (
      SELECT d.item_code AS code, ${bestSellerNet} AS net
      FROM ic_trans_detail d
      WHERE d.trans_flag IN (44,46,48) AND d.last_status=0 AND d.is_doc_copy=0
        AND COALESCE(btrim(d.item_code),'') NOT IN ('', 'หมายเหตุ')
        AND position('ฝ' in d.item_code)=0
        ${bestSellerWindows[mode]}
        AND EXISTS (SELECT 1 FROM ic_trans h WHERE h.doc_no=d.doc_no AND h.doc_date::date=d.doc_date::date
          AND h.trans_flag=d.trans_flag AND COALESCE(h.cust_code,'')=COALESCE(d.cust_code,'')
          AND h.trans_flag IN (44,46,48) AND h.last_status=0 AND h.is_doc_copy=0
          AND (NULLIF(btrim(h.branch_code),'') IS NULL OR h.branch_code=d.branch_code))
      GROUP BY d.item_code HAVING ${bestSellerNet} > 0)`;
const activityScope = "EXISTS (SELECT 1 FROM ic_trans_detail d WHERE d.item_code=i.code AND d.doc_date >= DATE '2025-01-01' AND d.doc_date < DATE '2027-01-01' AND d.last_status=0)";
const where=`($1::text='' OR strpos(lower(COALESCE(i.code,'')),lower($1))>0 OR strpos(lower(COALESCE(i.name_1,'')),lower($1))>0) AND ($2::text='' OR i.group_main=$2) AND ($3::text='all' OR ($3='active' AND ${activityScope}) OR ($3='inactive' AND NOT ${activityScope})) AND ($4::text='all' OR ($4='in' AND i.balance_qty>0) OR ($4='out' AND i.balance_qty<=0)) AND ($5::text='off' OR bs.code IS NOT NULL)`;
productLabels.activity_2568_2569 = 'การเคลื่อนไหวปี 2568–2569';
productLabels.catalog_sale_price = 'ราคาขายในทะเบียน (price_0 ตามหน่วยมาตรฐาน)';
productLabels.best_seller_net = 'ยอดขายสุทธิที่ใช้จัดอันดับ (บาท)';
productLabels.best_seller_rank = 'อันดับสินค้าขายดี';
const select=`SELECT i.*, CASE WHEN ${activityScope} THEN 'มีการเคลื่อนไหว' ELSE 'ไม่มีการเคลื่อนไหว' END AS activity_2568_2569, (SELECT MAX(g.name_1) FROM ic_group g WHERE g.code=i.group_main) AS group_main_name,
  (SELECT NULLIF(TRIM(p.price_0), '') FROM ic_inventory_price_formula p
   WHERE p.ic_code=i.code AND p.unit_code=i.unit_standard AND p.sale_type=0
   ORDER BY p.roworder DESC LIMIT 1) AS catalog_sale_price, bs.net AS best_seller_net
  FROM ic_inventory i LEFT JOIN best_sellers bs ON bs.code=i.code WHERE ${where}`;
// อันดับคิดหลังใช้ตัวกรองแล้ว จึงเรียงจากที่ 1 ต่อเนื่องข้ามหน้า
const ranked=`SELECT product_rows.*, CASE WHEN $5::text='off' THEN NULL
    ELSE ROW_NUMBER() OVER (ORDER BY best_seller_net DESC NULLS LAST, code ASC) END AS best_seller_rank
  FROM (${select}) product_rows`;
const productSorts={code:'code',name:'name_1',group:'group_main_name',unit:'unit_standard',price:"CASE WHEN catalog_sale_price ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN catalog_sale_price::numeric END",activity:'activity_2568_2569',stock:'balance_qty',status:'balance_qty',best:'best_seller_net'};
function productOrder(query,best='off'){
  const requested=query.sort??'code',direction=query.direction??'asc';
  // จัดอันดับขายดีเรียงได้เฉพาะเมื่อเปิดตัวกรองนั้นอยู่
  const sort=requested==='best'&&best==='off'?'code':requested;
  if(!Object.hasOwn(productSorts,sort)||!['asc','desc'].includes(direction))throw new Error('การเรียงลำดับไม่ถูกต้อง');
  return {sort,direction,sql:`${productSorts[sort]} ${direction.toUpperCase()} NULLS LAST, code ASC, roworder ASC`};
}
const fieldsOf=result=>result.fields.map(f=>({key:f.name,label:productLabels[f.name]||f.name}));
export function csvValue(value){let s=String(value??'');if(/^[\s]*[=+@\-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export async function excelBuffer(rows,fields,metadata){
  const output=new PassThrough(),chunks=[];output.on('data',c=>chunks.push(c));
  const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({stream:output,useStyles:true,useSharedStrings:false});
  const sheet=workbook.addWorksheet('สินค้าทั้งหมด',{views:[{state:'frozen',ySplit:1,xSplit:2}]});
  sheet.columns=fields.map(f=>({key:f.key,width:f.key==='name_1'?48:22}));
  const header=sheet.addRow(fields.map(f=>`${f.label} [${f.key}]`));header.font={bold:true,color:{argb:'FFFFFFFF'}};header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF198263'}};header.commit();
  for(const row of rows)sheet.addRow(fields.map(f=>row[f.key]??null)).commit();
  sheet.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:fields.length}};sheet.commit();
  const info=workbook.addWorksheet('ข้อมูลการส่งออก');for(const pair of Object.entries(metadata))info.addRow(pair).commit();info.commit();
  await workbook.commit();return Buffer.concat(chunks);
}
// อันดับขายดีของสินค้าเดียว คิดจากทั้งทะเบียน (ไม่ขึ้นกับตัวกรองในตาราง) ใช้นิยามเดียวกับตัวกรองสินค้าขายดี
const bestSellerDetailSql=`
WITH scoped AS (
  SELECT d.item_code AS code, d.doc_no, d.doc_date::date AS day, d.trans_flag,
    COALESCE(d.cust_code,'') AS customer_code,
    CASE WHEN d.trans_flag=48 THEN -1 ELSE 1 END * COALESCE(d.sum_amount,0) AS signed_amount,
    d.doc_date >= (CURRENT_DATE - INTERVAL '3 months') AND d.doc_date < (CURRENT_DATE + INTERVAL '1 day') AS recent
  FROM ic_trans_detail d
  WHERE d.trans_flag IN (44,46,48) AND d.last_status=0 AND d.is_doc_copy=0
    AND COALESCE(btrim(d.item_code),'') NOT IN ('', 'หมายเหตุ')
    AND position('ฝ' in d.item_code)=0
    AND EXISTS (SELECT 1 FROM ic_trans h WHERE h.doc_no=d.doc_no AND h.doc_date::date=d.doc_date::date
      AND h.trans_flag=d.trans_flag AND COALESCE(h.cust_code,'')=COALESCE(d.cust_code,'')
      AND h.trans_flag IN (44,46,48) AND h.last_status=0 AND h.is_doc_copy=0
      AND (NULLIF(btrim(h.branch_code),'') IS NULL OR h.branch_code=d.branch_code))
), agg AS (
  SELECT code, SUM(signed_amount) AS net_all,
    COALESCE(SUM(signed_amount) FILTER (WHERE recent),0) AS net_recent,
    to_char(MAX(day) FILTER (WHERE trans_flag=44),'YYYY-MM-DD') AS last_sold,
    COUNT(DISTINCT (doc_no,day,customer_code)) FILTER (WHERE trans_flag=44) AS invoices,
    COUNT(DISTINCT customer_code) FILTER (WHERE trans_flag=44) AS buyers
  FROM scoped GROUP BY code
), rank_all AS (
  SELECT code, ROW_NUMBER() OVER (ORDER BY net_all DESC, code ASC) AS rank, COUNT(*) OVER () AS ranked_total
  FROM agg WHERE net_all>0
), rank_recent AS (
  SELECT code, ROW_NUMBER() OVER (ORDER BY net_recent DESC, code ASC) AS rank, COUNT(*) OVER () AS ranked_total
  FROM agg WHERE net_recent>0
)
SELECT a.net_all, a.net_recent, a.last_sold, a.invoices, a.buyers,
  ra.rank AS rank_all, ra.ranked_total AS total_all,
  rr.rank AS rank_recent, rr.ranked_total AS total_recent
FROM agg a LEFT JOIN rank_all ra ON ra.code=a.code LEFT JOIN rank_recent rr ON rr.code=a.code
WHERE a.code=$1`;
export function installProducts(app,pool){
  app.get('/api/products/best-seller',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const code=typeof req.query.code==='string'?req.query.code.trim():'';
    if(!code||code.length>200)return res.status(400).json({error:'กรุณาระบุรหัสสินค้าให้ถูกต้อง'});
    try{
      const row=(await pool.query(bestSellerDetailSql,[code])).rows[0]??null;
      const standing=(rank,total,net)=>rank?{rank:Number(rank),total:Number(total),net}:null;
      res.json({code,sold:!!row,
        all:row?standing(row.rank_all,row.total_all,row.net_all):null,
        recent:row?standing(row.rank_recent,row.total_recent,row.net_recent):null,
        netAll:row?.net_all??null,netRecent:row?.net_recent??null,
        lastSold:row?.last_sold??null,
        invoices:row?Number(row.invoices):null,buyers:row?Number(row.buyers):null,
        updatedAt:new Date().toISOString()});
    }catch(e){console.error('Best seller lookup failed:',e.code);res.status(503).json({error:'ดึงอันดับสินค้าขายดีจาก SML ไม่สำเร็จ กรุณาลองใหม่'});}
  });
  app.get('/api/products',async(req,res)=>{
    res.set('Cache-Control','no-store');let client;
    try{
      const f=filters(req.query),page=Number(req.query.page??0),order=productOrder(req.query,f.best);
      if(!Number.isInteger(page)||page<0||page>100000)throw new Error('หน้าข้อมูลไม่ถูกต้อง');
      const cte=bestSellerCte(f.best),base=[f.q,f.group,f.activity,f.stock,f.best];
      client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const counts=(await client.query(`WITH ${cte} SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE ${activityScope}) AS active_count,COUNT(*) FILTER(WHERE ${where}) AS matching FROM ic_inventory i LEFT JOIN best_sellers bs ON bs.code=i.code`,base)).rows[0];
      const result=await client.query({text:`WITH ${cte} SELECT * FROM (${ranked}) ranked_rows ORDER BY ${order.sql} LIMIT 50 OFFSET $6`,values:[...base,page*50],types});
      const groups=(await client.query(`SELECT i.group_main AS code,COALESCE(MAX(g.name_1),i.group_main) AS name,COUNT(*) AS count FROM ic_inventory i LEFT JOIN (SELECT code,MAX(name_1) AS name_1 FROM ic_group GROUP BY code) g ON g.code=i.group_main WHERE COALESCE(i.group_main,'')<>'' GROUP BY i.group_main ORDER BY i.group_main`)).rows;
      await client.query('COMMIT');
      res.json({rows:result.rows,fields:fieldsOf(result),total:Number(counts.total),activeCount:Number(counts.active_count),inactiveCount:Number(counts.total)-Number(counts.active_count),matching:Number(counts.matching),page,pageSize:50,groups,sort:order.sort,direction:order.direction,best:f.best,updatedAt:new Date().toISOString()});
    }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});res.status(e.code?503:400).json({error:e.code?'โหลดสินค้าไม่สำเร็จ กรุณาลองใหม่':e.message});}finally{client?.release();}
  });
  let exporting=false;
  app.get('/api/products/export',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(exporting)return res.status(429).json({error:'กำลังสร้างไฟล์อยู่ กรุณารอสักครู่แล้วลองใหม่'});
    let client;
    try{
      const format=req.query.format??'xlsx',scope=req.query.scope??'all';
      if(!['xlsx','csv','json'].includes(format)||!['all','filtered','active','inactive'].includes(scope))throw new Error('รูปแบบไฟล์หรือขอบเขตไม่ถูกต้อง');
      const f=filters(scope==='filtered'?req.query:{q:'',group:'',activity:scope,stock:'all'});exporting=true;
      const cte=bestSellerCte(f.best);
      const exportOrder=f.best==='off'?'code ASC, roworder ASC':'best_seller_rank ASC NULLS LAST, code ASC';
      client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result=await client.query({text:`WITH ${cte} SELECT * FROM (${ranked}) ranked_rows ORDER BY ${exportOrder}`,values:[f.q,f.group,f.activity,f.stock,f.best],types});
      await client.query('COMMIT');client.release();client=null;
      const fields=fieldsOf(result),updatedAt=new Date().toISOString();
      const bestSellerNote={off:'ไม่ใช้ตัวกรองสินค้าขายดี',all:'เฉพาะสินค้าขายดี (ยอดขายสุทธิทั้งหมด) เรียงอันดับ 1 ก่อน','3m':'เฉพาะสินค้าขายดีช่วง 3 เดือนก่อน เรียงอันดับ 1 ก่อน'}[f.best];
      const metadata={source:'SML ski / ic_inventory',exportedAt:updatedAt,scope,search:f.q,group:f.group,count:result.rows.length,activityStart:'2025-01-01',activityEnd:'2026-12-31',bestSellers:bestSellerNote,bestSellerBasis:'ยอดขายสุทธิ = trans_flag 44 + 46 - 48 เฉพาะเอกสารไม่ยกเลิกและไม่ใช่สำเนา ไม่รวมสินค้าฝากขาย',note:'สินค้าทั้งทะเบียน รวมมีและไม่มีการเคลื่อนไหว; สถานะการเคลื่อนไหวอ้างอิงรายการไม่ยกเลิกในปี 2568–2569 ชื่อและราคาเป็นค่าปัจจุบัน; ทะเบียนสินค้าทุกคอลัมน์ ไม่ใช่รายงานคงเหลือคำนวณตามวันที่; numeric ทศนิยมเก็บเป็นข้อความเพื่อรักษาค่าต้นฉบับ'};
      let body,contentType;
      if(format==='xlsx'){body=await excelBuffer(result.rows,fields,metadata);contentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}
      else if(format==='csv'){body='\ufeff'+[fields.map(f=>csvValue(`${f.label} [${f.key}]`)).join(','),...result.rows.map(row=>fields.map(f=>csvValue(row[f.key])).join(','))].join('\r\n');contentType='text/csv; charset=utf-8';}
      else{body=JSON.stringify({metadata,fields,products:result.rows},null,2);contentType='application/json; charset=utf-8';}
      res.set({'Content-Type':contentType,'Content-Disposition':`attachment; filename="sml-products-${scope}-${updatedAt.slice(0,10)}.${format}"`,'X-Product-Count':String(result.rows.length)}).send(body);
    }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});res.status(e.code?503:400).json({error:e.code?'ส่งออกข้อมูลไม่สำเร็จ กรุณาลองใหม่':e.message});}finally{client?.release();exporting=false;}
  });
}
