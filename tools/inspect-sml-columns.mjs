import pg from 'pg';
const pool=new pg.Pool({max:1,options:'-c default_transaction_read_only=on'});
const result=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='ic_inventory' ORDER BY ordinal_position");
console.log(result.rows.map(x=>x.column_name).join(',')); await pool.end();
