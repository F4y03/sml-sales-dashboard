import { AsyncLocalStorage } from 'node:async_hooks';
export const accessContext = new AsyncLocalStorage();
const fail=message=>Object.assign(new Error(message),{status:400});
export function validateMapping(input) {
  if(!input || typeof input!=='object'||Array.isArray(input))throw fail('Mapping ไม่ถูกต้อง');
  const out={};
  for(const key of ['teams','customerCodes','consignmentPrefixes']) {
    const values=input[key]??[];
    if(!Array.isArray(values)||values.length>500||values.some(x=>typeof x!=='string'||!x.trim()||x.length>100||/[\x00-\x1f]/.test(x)))throw fail('Mapping ต้องเป็นรายการรหัส ไม่เกิน 500 รหัส');
    out[key]=[...new Set(values.map(x=>x.trim()))];
  }
  if(out.consignmentPrefixes.some(x=>!x.startsWith('ฝ')||x.length<3))throw fail('รหัสสินค้าฝากต้องขึ้นต้น ฝ และมีรหัสทีม');
  return out;
}
export function createTerritoryService(store,audit) {
  const list=userId=>store.all('SELECT t.id,t.code,t.name,t.mapping_json FROM sales_territories t JOIN user_territories u ON u.territory_id=t.id WHERE u.user_id=? AND t.is_active=1 ORDER BY t.name',userId).map(({mapping_json,...t})=>({...t,mapping:JSON.parse(mapping_json)}));
  return {list, select(user,id,sessionHash,ip) {
    const territory=list(user.id).find(t=>t.id===id);
    if(!territory)throw Object.assign(new Error('ไม่มีสิทธิ์ในเขตการขายนี้'),{status:403});
    store.transaction(()=>{store.run('UPDATE sessions SET territory_id=? WHERE token_hash=? AND user_id=?',id,sessionHash,user.id);audit.record(user,'territory.switch','territories',{territoryId:id},id,ip);});
    return territory;
  }};
}

// Scope fixed, application-owned SQL through CTEs, before aggregation/paging/export.
// Native report SQL is deliberately excluded: stored functions could bypass CTE scope.
export function scopeQuery(sql,values=[],context) {
  if(!context?.territory)return {text:sql,values};
  if(typeof sql!=='string')throw new Error('Scoped query must be text');
  sql=sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, '');
  if(/^(BEGIN\b|COMMIT\b|ROLLBACK\b|SET LOCAL statement_timeout)/i.test(sql.trim()))return {text:sql,values};
  const mapping=validateMapping(context.territory.mapping);
  const args=[...values,mapping.teams,mapping.customerCodes,mapping.consignmentPrefixes];
  const team='$'+(values.length+1),customer='$'+(values.length+2),deposit='$'+(values.length+3);
  const teamOf=column=>`regexp_replace(regexp_replace(btrim(COALESCE(${column},'')), '^ฝ', ''), '^กท-', 'ก')`;
  const inDeposit=column=>`EXISTS (SELECT 1 FROM unnest(${deposit}::text[]) p WHERE left(${column},char_length(p))=p)`;
  const customerMatch=column=>`(${column}=ANY(${customer}::text[]) OR split_part(btrim(${column}),'-',1)=ANY(${team}::text[]))`;
  const headerMatch=`(${teamOf('h.sale_code')}=ANY(${team}::text[]) OR h.cust_code=ANY(${customer}::text[]))`;
  const lineMatch=context.module==='consignment' ? inDeposit('d.item_code') : `EXISTS(SELECT 1 FROM ic_trans h WHERE h.doc_no=d.doc_no AND h.doc_date=d.doc_date AND h.trans_flag=d.trans_flag AND h.cust_code IS NOT DISTINCT FROM d.cust_code AND (COALESCE(h.branch_code,'')='' OR h.branch_code=d.branch_code))`;
  const ctes=`ic_trans AS (SELECT h.* FROM public.ic_trans h WHERE ${headerMatch}),
    ic_trans_detail AS (SELECT d.* FROM public.ic_trans_detail d WHERE ${lineMatch}),
    ar_customer AS (SELECT c.* FROM public.ar_customer c WHERE ${customerMatch('c.code')} OR EXISTS(SELECT 1 FROM ic_trans h WHERE h.cust_code=c.code)),
    ic_inventory AS (SELECT i.* FROM public.ic_inventory i WHERE left(i.code,1)<>'ฝ' OR ${inDeposit('i.code')}),
    erp_user AS (SELECT u.* FROM public.erp_user u WHERE ${teamOf('u.code')}=ANY(${team}::text[]))`;
  // No schema-qualified base tables/functions in scoped application queries.
  if(/\bpublic\s*\.|\bWITH\s+RECURSIVE\b/i.test(sql))throw new Error('Query requires explicit territory review');
  const text=/^\s*WITH\b/i.test(sql) ? sql.replace(/^\s*WITH\b/i,`WITH ${ctes},`) : `WITH ${ctes} ${sql}`;
  return {text,values:args};
}
export function createScopedPool(pool) {
  function query(target,input,values) {
    const context=accessContext.getStore();
    if(!context?.territory)return target.query(input,values);
    if(typeof input==='string'){const q=scopeQuery(input,values||[],context);return target.query(q.text,q.values);}
    const q=scopeQuery(input.text,input.values||[],context);return target.query({...input,...q});
  }
  return {query:(input,values)=>query(pool,input,values),async connect(){const client=await pool.connect();return {query:(input,values)=>query(client,input,values),release:()=>client.release()};}};
}
