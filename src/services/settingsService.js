import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { bad,text } from './userService.js';
export const ENV_KEYS=['PGHOST','PGPORT','PGDATABASE','API_URL','DASHBOARD_NAME'];
export function createSettingsService(store,audit,envPath) {
  return {
    read:()=>Object.fromEntries(store.all("SELECT key,value FROM system_settings WHERE key IN ('dashboard_name','support_message')").map(x=>[x.key,x.value])),
    save(actor,body,ip){
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['dashboard_name','support_message'].includes(k)))throw bad('Setting ไม่ได้รับอนุญาต');
      const entries=Object.entries(body).map(([k,v])=>[k,text(v,k,200)]);
      store.transaction(()=>{for(const [k,v] of entries)store.run('INSERT INTO system_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,v);audit.record(actor,'settings.update','settings',{keys:entries.map(x=>x[0])},null,ip);});
    },
    environment(){const values=fs.existsSync(envPath)?parseEnv(fs.readFileSync(envPath,'utf8')):{};return Object.fromEntries(ENV_KEYS.map(k=>[k,values[k]||'']));},
    saveEnvironment(actor,body,ip){
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!ENV_KEYS.includes(k)))throw bad('ENV Key ไม่ได้รับอนุญาต');
      const entries=Object.entries(body).map(([k,v])=>[k,text(v,k,200)]);
      for(const [k,v] of entries){
        if(/[\r\n\x00#'"`$\\]/.test(v))throw bad('ค่า Environment ไม่ถูกต้อง');
        if(k==='PGPORT'&&(!/^\d+$/.test(v)||Number(v)<1||Number(v)>65535))throw bad('Port ไม่ถูกต้อง');
        if(k==='PGHOST'&&!/^[a-zA-Z0-9.:-]+$/.test(v))throw bad('Host ไม่ถูกต้อง');
        if(k==='PGDATABASE'&&!/^[\p{L}\p{N}_-]+$/u.test(v))throw bad('ชื่อฐานข้อมูลไม่ถูกต้อง');
        if(k==='API_URL'){let u;try{u=new URL(v);}catch{throw bad('URL ไม่ถูกต้อง');}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw bad('URL ต้องไม่มี credentials');}
      }
      let content=fs.existsSync(envPath)?fs.readFileSync(envPath,'utf8'):'';
      for(const [k,v] of entries){const re=new RegExp('^\\s*(?:export\\s+)?'+k+'\\s*=.*$','gm');const line=k+'="'+v+'"';content=re.test(content)?content.replace(re,()=>line):content+'\n'+line+'\n';}
      const tmp=envPath+'.rbac-tmp';
      try {fs.writeFileSync(tmp,content,{mode:0o600});fs.renameSync(tmp,envPath);} finally {if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
      // Record key names only; never log settings values or existing credentials.
      audit.record(actor,'environment.update','environment',{keys:entries.map(x=>x[0])},null,ip);
      return {ok:true,restartRequired:true};
    },
  };
}
