import { inflateRawSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import pg from 'pg';
const parser = new XMLParser({ parseTagValue: false, processEntities: true });
const array = value => Array.isArray(value) ? value : value ? [value] : [];
export function decodeReport(row) {
  const b = row.reportdata;
  if (!b || b.readUInt32LE(0) !== 0x04034b50 || b.readUInt16LE(8) !== 8) throw new Error('รูปแบบไฟล์รายงานนี้ยังไม่รองรับ');
  const offset = 30 + b.readUInt16LE(26) + b.readUInt16LE(28);
  const xml = inflateRawSync(b.subarray(offset, offset + b.readUInt32LE(18)), { maxOutputLength: 8 * 1024 * 1024 }).toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('รูปแบบ XML นี้ยังไม่รองรับ');
  const root = parser.parse(xml)._xmlClass;
  if (!root) throw new Error('ไม่พบโครงสร้างรายงาน');
  const conditions = array(root._conditionList?._conditionDetailClass).map(c => ({
    name: c._name, label: c._text || c._name, type: c._type, column: c._columnName || '',
    default: c._defaultValue || '',
    options: c._type === 'DropDown' ? String(c._defaultValue).split(',').map((v, i) => ({ value: v.trim(), label: String(c._command).split(',')[i]?.trim() || v.trim() })) : undefined
  }));
  const queries = array(root._query?._queryClass).filter(q => typeof q._query === 'string' && q._query.trim()).map(q => ({
    sql: q._query,
    fields: array(q._field?._fieldClass).map(f => ({ name: f._fieldName, label: f._resourceName || f._fieldName, type: f._type, hidden: f._hide === 'true' }))
  }));
  return { key: row.roworder, id: row.menuid, name: row.menuname, conditions, queries };
}
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
export function validateValues(report, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('เงื่อนไขไม่ถูกต้อง');
  const values = Object.create(null);
  for (const key of Object.keys(input)) if (!report.conditions.some(c=>c.name===key)) throw new Error('ไม่รู้จักเงื่อนไข ' + key);
  for (const c of report.conditions) {
    const v = input[c.name] ?? (c.options ? c.options[0]?.value : c.default) ?? '';
    if (typeof v !== 'string' || v.length > 1000) throw new Error('ค่าเงื่อนไขไม่ถูกต้อง: ' + c.label);
    if (c.type === 'Date' && !validDate(v)) throw new Error('กรุณาเลือกวันที่: ' + c.label);
    if (c.type === 'Number' && !/^-?\d+(\.\d+)?$/.test(v)) throw new Error('กรุณาระบุตัวเลข: ' + c.label);
    if (c.options && !c.options.some(o=>o.value===v)) throw new Error('ตัวเลือกไม่ถูกต้อง: ' + c.label);
    if (v && /time/i.test(c.name) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error('เวลาไม่ถูกต้อง: ' + c.label);
    // Native SML functions concatenate code-list values into SQL internally. Restrict that input too.
    if (c.type === 'Text' && !/time/i.test(c.name) && /['";\\\x00-\x1f]/.test(v)) throw new Error('รหัสต้องไม่มีเครื่องหมายคำพูด อัฒภาค หรืออักขระควบคุม');
    values[c.name] = v;
  }
  const starts = report.conditions.filter(c=>c.type==='Date' && /from|start/.test(c.name));
  const ends = report.conditions.filter(c=>c.type==='Date' && /to|end/.test(c.name));
  if (starts.length===1 && ends.length===1 && values[starts[0].name] > values[ends[0].name]) throw new Error('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
  return values;
}

// Tokenize literals/comments before handling native placeholders. User values never become SQL syntax.
export function compileQuery(sql, conditions, values) {
  const params = [], bind = v => { params.push(v); return '$' + params.length; };
  const byName = new Map(conditions.map(c=>[c.name,c]));
  const value = name => { if (!byName.has(name)) throw new Error('ต้องรองรับเงื่อนไขเฉพาะเพิ่มเติม: ' + name); return values[name] ?? ''; };
  function raw(name) {
    const clause = name.match(/^(and|where)(?:check)?_(.+)$/i);
    if (clause) {
      const c = byName.get(clause[2]);
      if (!c) throw new Error('ไม่พบคำอธิบายเงื่อนไข: ' + clause[2]);
      const v = value(c.name);
      if (!v) return '';
      if (!c.column || /;|--|\/\*/.test(c.column)) throw new Error('เงื่อนไขนี้ต้องเพิ่มตัวแปลง: ' + c.label);
      const parts = v.split(',').map(s=>s.trim()).filter(Boolean);
      const predicate = parts.map(part => {
        const range = part.split(':');
        if (range.length === 2 && range.every(Boolean)) return `(${c.column} BETWEEN ${bind(range[0])} AND ${bind(range[1])})`;
        if (range.length !== 1) throw new Error('ช่วงรหัสไม่ถูกต้อง: ' + c.label);
        return `(${c.column} = ${bind(part)})`;
      });
      if (!predicate.length) throw new Error('กรุณาระบุรหัส: ' + c.label);
      return ` ${clause[1].toUpperCase()} (${predicate.join(' OR ')}) `;
    }
    const c = byName.get(name), v = value(name);
    if (c?.options && c.options.some(o=>o.value===v) && /^[a-z_][\w.]*$/i.test(v)) return v;
    if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error('เงื่อนไข SQL พิเศษยังไม่รองรับ: ' + name);
    return bind(v);
  }
  const tokens = sql.match(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[^'"/\-]+|[\/\-]/g) || [];
  let plain = '';
  const text = tokens.map(t => {
    if (t.startsWith('--') || t.startsWith('/*')) return ' ';
    if (t.startsWith("'")) {
      if (!/@[\w]+@/.test(t)) return t;
      return bind(t.slice(1,-1).replaceAll("''", "'").replace(/@(\w+)@/g,(_,name)=>value(name)));
    }
    if (t.startsWith('"')) return t;
    plain += t;
    return t.replace(/@(\w+)@/g, (_,name)=>raw(name));
  }).join('');
  if (!/^\s*(select|with)\b/i.test(text) || /\b(insert|update|delete|drop|alter|create|truncate|copy|call|do|grant|revoke|set|reset|into)\b/i.test(plain) || /;/.test(plain.replace(/;\s*$/, ''))) throw new Error('รายงานนี้ต้องใช้ตัวประมวลผลเฉพาะของ SML');
  if (/@\w+@/.test(text)) throw new Error('ยังมีเงื่อนไขที่แปลงไม่ครบ');
  return { text: text.trim().replace(/;$/, ''), values: params };
}

export function installReports(app, pool) {
  let catalog;
  async function read(key) {
    const { rows } = await pool.query('SELECT roworder,menuid,menuname,reportdata FROM sml_fastreport WHERE roworder=$1', [key]);
    if (rows.length!==1) throw new Error('ไม่พบรายงาน หรือรหัสรายงานซ้ำ');
    return decodeReport(rows[0]);
  }
  app.get('/api/reports', async (req,res) => {
    try {
      if (!catalog || Date.now()-catalog.time>60000) {
        const { rows } = await pool.query('SELECT roworder,menuid,menuname,report_type FROM sml_fastreport ORDER BY menuid, roworder');
        catalog = {time:Date.now(),items:rows.map(r=>({key:r.roworder,id:r.menuid,name:r.menuname,reportType:r.report_type}))};
      }
      res.set('Cache-Control','no-store').json({reports:catalog.items});
    } catch { res.status(503).json({error:'โหลดรายการรายงาน SML ไม่สำเร็จ'}); }
  });
  app.get('/api/reports/:key', async(req,res)=>{
    if (!/^\d+$/.test(req.params.key)) return res.status(400).json({error:'รหัสรายงานไม่ถูกต้อง'});
    try {
      const r=await read(req.params.key);
      res.set('Cache-Control','no-store').json({key:r.key,id:r.id,name:r.name,conditions:r.conditions.map(({column,...c})=>c),datasets:r.queries.map((q,i)=>({index:i,fields:q.fields})),supported:r.queries.length>0});
    } catch(e) {res.status(422).json({error:e.message});}
  });
  app.post('/api/reports/:key/run', async(req,res)=>{
    res.set('Cache-Control','no-store');
    // HTTPS may terminate at the tunnel. Require the same non-simple header as login.
    if (req.get('X-PRPlus-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({error:'ต้นทางไม่ถูกต้อง'});
    if (!/^\d+$/.test(req.params.key)) return res.status(400).json({error:'รหัสรายงานไม่ถูกต้อง'});
    let client;
    try {
      const r=await read(req.params.key), {filters={},dataset=0,page=0,pageSize=100}=req.body || {};
      if (![dataset,page,pageSize].every(Number.isInteger) || dataset<0 || dataset>=r.queries.length || page<0 || page>10000 || pageSize<1 || pageSize>500) throw new Error('หน้ารายงานไม่ถูกต้อง');
      const values=validateValues(r,filters), q=r.queries[dataset], compiled=compileQuery(q.sql,r.conditions,values);
      client=await pool.connect();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout='25000'");
      const result=await client.query({text:`SELECT * FROM (${compiled.text}) AS sml_web_report LIMIT ${pageSize+1} OFFSET ${page*pageSize}`,values:compiled.values,rowMode:'array',types:{getTypeParser:(oid,format)=>[1082,1114,1184].includes(oid)?v=>v:pg.types.getTypeParser(oid,format)}});
      await client.query('COMMIT');
      const fields=result.fields.map(f=>({name:f.name,label:q.fields.find(c=>c.name===f.name)?.label || f.name,type:q.fields.find(c=>c.name===f.name)?.type || ([20,21,23,700,701,1700].includes(f.dataTypeID)?'Number':'Text')}));
      res.json({id:r.id,name:r.name,dataset,page,pageSize,hasMore:result.rows.length>pageSize,fields,rows:result.rows.slice(0,pageSize),filters:values,updatedAt:new Date().toISOString()});
    } catch(e) {
      if(client) await client.query('ROLLBACK').catch(()=>{});
      console.error('SML report',req.params.key,e.code || '',e.message);
      res.status(e.code ? 422:400).json({error:e.code==='57014'?'รายงานใช้เวลานานเกินไป กรุณาจำกัดช่วงวันที่หรือรหัสสินค้า':e.code ? 'รายงานนี้ยังประมวลผลบนเว็บไม่ได้ ('+e.code+') กรุณาแจ้งรหัสรายงานเพื่อปรับตัวแปลง':e.message});
    } finally {client?.release();}
  });
}
