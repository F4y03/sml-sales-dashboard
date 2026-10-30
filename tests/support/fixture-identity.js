// UI fixtures model an authenticated Executive, without granting admin privileges.
export const fixtureIdentity={username:'ui-fixture',role:'executive',scope:'all',territoryId:null,territories:[],permissions:['dashboard','price_stock','consignment','product_info','customer_analysis','product_analysis','reports'],landing:'/executive.html'};
export function installFixtureIdentity(app){app.get('/api/auth/me',(req,res)=>res.json(fixtureIdentity));}
