import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const storeUrl = 'https://www.lazada.co.th/best-by-ski/?q=All-Products&from=wangpu&langFlag=th&pageTypeId=2';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/User/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(storeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
let last = 0;
for (let i = 0; i < 30; i++) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);
  const height = await page.evaluate(() => document.body.scrollHeight);
  if (height === last) break;
  last = height;
}
const products = await page.locator('a[href*="/products/pdp-"]').evaluateAll(anchors => {
  const seen = new Map();
  for (const a of anchors) {
    const href = a.href.split('?')[0];
    const name = (a.innerText || '').split('\n')[0].trim();
    if (!href || !name || seen.has(href)) continue;
    const id = href.match(/pdp-i(\d+)-s(\d+)/);
    const img = a.querySelector('img');
    const src = img?.currentSrc || img?.src || img?.getAttribute('data-src') || img?.getAttribute('data-original');
    seen.set(href, { lazadaProductId: id?.[1] || '', lazadaSkuId: id?.[2] || '', name, productUrl: href, sourceUrls: src ? [src] : [] });
  }
  return [...seen.values()];
});
for (const product of products) {
  await page.goto(product.productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  const images = await page.locator('meta[property="og:image"], img').evaluateAll(nodes => nodes.map(n => n.content || n.currentSrc || n.src || n.getAttribute('data-src')).filter(Boolean));
  const gallery = [...new Set(images.filter(x => /^https?:\/\//.test(x)))].slice(0, 10);
  if (gallery.length) product.sourceUrls = gallery;
}
await mkdir('product-image-drive-output', { recursive: true });
await writeFile('product-image-drive-output/lazada-best-by-ski-mapping.json', JSON.stringify({ storeUrl, fetchedAt: new Date().toISOString(), products }, null, 2));
console.log(JSON.stringify({ products: products.length, withMainImage: products.filter(x => x.sourceUrls.length).length }));
await browser.close();
