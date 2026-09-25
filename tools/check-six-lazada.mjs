import pg from 'pg';
const pool=new pg.Pool({max:1,options:'-c default_transaction_read_only=on'});
try {
 const {rows}=await pool.query('SELECT code,name_1 FROM ic_inventory WHERE left(code,1)<>$1 AND name_1 ILIKE ANY($2::text[])',['ฝ',['%ฟองน้ำ%','%กัน%กลิ้ง%','%BW-446%','%LCD-81%','%LCD-33%','%LCD-99%']]);
 console.log(JSON.stringify(rows,null,2));
} finally {await pool.end();}
