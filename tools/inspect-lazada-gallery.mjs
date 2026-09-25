import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,channel:'chromium'});
try {
 const page=await browser.newPage({locale:'th-TH'});
 await page.goto('https://www.lazada.co.th/products/pdp-i16223937850.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForTimeout(5000);
 console.log(JSON.stringify({title:await page.title(),body:(await page.locator('body').innerText()).slice(0,600),images:await page.locator('img').evaluateAll(xs=>xs.filter(x=>x.src.includes('/g/p/')).map(x=>({src:x.src,class:x.className,parent:x.parentElement.className})).slice(0,12))}));
} finally {await browser.close();}
