import pg from 'pg';
import ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';

export const productLabels = {code:'รหัสสินค้า',code_old:'รหัสสินค้าเดิม',name_1:'ชื่อสินค้า',name_2:'ชื่อสินค้า 2',name_eng_1:'ชื่อภาษาอังกฤษ',group_main:'รหัสกลุ่มหลัก',group_main_name:'ชื่อกลุ่มหลัก',group_sub:'รหัสกลุ่มย่อย',unit_standard:'หน่วยมาตรฐาน',item_brand:'รหัสยี่ห้อ',item_model:'รุ่น',description:'รายละเอียด',remark:'หมายเหตุ',average_cost:'ต้นทุนเฉลี่ยในทะเบียน',balance_qty:'ยอดคงเหลือในทะเบียน',item_status:'สถานะสินค้า (รหัส)',status:'สถานะ (รหัส)'};
const types={getTypeParser:(oid,format)=>[1082,1114,1184].includes(oid)?v=>v:pg.types.getTypeParser(oid,format)};
function filters(query) {
  const q=query.q??'', group=query.group??'';
  if(typeof q!=='string'||typeof group!=='string'||q.length>200||group.length>100)throw new Error('ตัวกรองไม่ถูกต้อง');
  return {q:q.trim(),group};
}
const where=`($1::text='' OR strpos(lower(COALESCE(i.code,'')),lower($1))>0 OR strpos(lower(COALESCE(i.name_1,'')),lower($1))>0) AND ($2::text='' OR i.group_main=$2)`;
const select=`SELECT i.*, (SELECT MAX(g.name_1) FROM ic_group g WHERE g.code=i.group_main) AS group_main_name FROM ic_inventory i WHERE ${where} ORDER BY i.code,i.roworder`;
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
export function installProducts(app,pool){
  app.get('/api/products',async(req,res)=>{
    res.set('Cache-Control','no-store');let client;
    try{
      const f=filters(req.query),page=Number(req.query.page??0);
      if(!Number.isInteger(page)||page<0||page>100000)throw new Error('หน้าข้อมูลไม่ถูกต้อง');
      client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const counts=(await client.query(`SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE ${where}) AS matching FROM ic_inventory i`,[f.q,f.group])).rows[0];
      const result=await client.query({text:select+' LIMIT 50 OFFSET $3',values:[f.q,f.group,page*50],types});
      const groups=(await client.query("SELECT i.group_main AS code,COALESCE(MAX(g.name_1),i.group_main) AS name,COUNT(*) AS count FROM ic_inventory i LEFT JOIN (SELECT code,MAX(name_1) AS name_1 FROM ic_group GROUP BY code) g ON g.code=i.group_main WHERE COALESCE(i.group_main,'')<>'' GROUP BY i.group_main ORDER BY i.group_main")).rows;
      await client.query('COMMIT');
      res.json({rows:result.rows,fields:fieldsOf(result),total:Number(counts.total),matching:Number(counts.matching),page,pageSize:50,groups,updatedAt:new Date().toISOString()});
    }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});res.status(e.code?503:400).json({error:e.code?'โหลดสินค้าไม่สำเร็จ กรุณาลองใหม่':e.message});}finally{client?.release();}
  });
  let exporting=false;
  app.get('/api/products/export',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(exporting)return res.status(429).json({error:'กำลังสร้างไฟล์อยู่ กรุณารอสักครู่แล้วลองใหม่'});
    let client;
    try{
      const format=req.query.format??'xlsx',scope=req.query.scope??'all';
      if(!['xlsx','csv','json'].includes(format)||!['all','filtered'].includes(scope))throw new Error('รูปแบบไฟล์หรือขอบเขตไม่ถูกต้อง');
      const f=scope==='all'?{q:'',group:''}:filters(req.query);exporting=true;
      client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result=await client.query({text:select,values:[f.q,f.group],types});
      await client.query('COMMIT');client.release();client=null;
      const fields=fieldsOf(result),updatedAt=new Date().toISOString();
      const metadata={source:'SML ski / ic_inventory',exportedAt:updatedAt,scope,search:f.q,group:f.group,count:result.rows.length,note:'ทะเบียนสินค้าทุกคอลัมน์ ไม่ใช่รายงานคงเหลือคำนวณตามวันที่; numeric ทศนิยมเก็บเป็นข้อความเพื่อรักษาค่าต้นฉบับ'};
      let body,contentType;
      if(format==='xlsx'){body=await excelBuffer(result.rows,fields,metadata);contentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}
      else if(format==='csv'){body='\ufeff'+[fields.map(f=>csvValue(`${f.label} [${f.key}]`)).join(','),...result.rows.map(row=>fields.map(f=>csvValue(row[f.key])).join(','))].join('\r\n');contentType='text/csv; charset=utf-8';}
      else{body=JSON.stringify({metadata,fields,products:result.rows},null,2);contentType='application/json; charset=utf-8';}
      res.set({'Content-Type':contentType,'Content-Disposition':`attachment; filename="sml-products-${scope}-${updatedAt.slice(0,10)}.${format}"`,'X-Product-Count':String(result.rows.length)}).send(body);
    }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});res.status(e.code?503:400).json({error:e.code?'ส่งออกข้อมูลไม่สำเร็จ กรุณาลองใหม่':e.message});}finally{client?.release();exporting=false;}
  });
}
