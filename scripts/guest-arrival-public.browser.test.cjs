const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.GA_PLAYWRIGHT_MODULE || 'playwright');

const pagePath = path.join(__dirname, '..', 'guest-queue.html');
const html = fs.readFileSync(pagePath, 'utf8');
const TOKEN = 'a'.repeat(64);

(async () => {
  let browser;
  const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/guest-queue.html') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    res.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();
    const ticketBodies = [];
    const seenApiKeys = [];
    let apiHits = 0;

    await page.exposeFunction('__gaMockRequest', async (_url, init) => {
      apiHits++;
      const headers = init.headers || {};
      const apiKey = Object.entries(headers).find(([key]) => key.toLowerCase() === 'apikey')?.[1] || '';
      seenApiKeys.push(apiKey);
      const body = JSON.parse(init.body || '{}');
      ticketBodies.push(body);
      if (body.action !== 'ticket') return { status:400, body:{ ok:false, error:'Aksi tidak valid.' } };
      if (body.token !== TOKEN) return { status:404, body:{ ok:false, error:'Link tidak aktif.' } };
      return {
        status:200,
        body:{
          ok:true,
          ticket:{
            queue_number:12,queue_code:'WL-012',status:'Menunggu',packs:2,
            operational_date:'2026-10-27',arrived_at:'2026-10-27T07:35:00Z',
            outlet_code:'LJN',outlet_name:'Lazy Jennie',
            guest_name:'MUST NOT BE RETURNED',whatsapp:'MUST NOT BE RETURNED',note:'MUST NOT BE RETURNED'
          }
        }
      };
    });

    await context.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        if (!url.includes('/functions/v1/guest-arrival-public')) return realFetch(input, init);
        const result = await window.__gaMockRequest(url, {
          method:init.method || 'GET',headers:init.headers || {},body:init.body || ''
        });
        return new Response(JSON.stringify(result.body), {
          status:result.status,headers:{'content-type':'application/json; charset=utf-8'}
        });
      };
    });

    // Missing token must stop locally before any fetch call.
    await page.goto(`http://127.0.0.1:${address.port}/guest-queue.html?case=missing`);
    await page.locator('#invalid').waitFor({state:'visible'});
    assert.equal(apiHits,0,'missing token must not call Supabase');

    // Valid token only reads a pre-existing ticket; no guest registration controls exist.
    await page.goto(`http://127.0.0.1:${address.port}/guest-queue.html?case=valid#token=${TOKEN}`);
    await page.locator('#ticket').waitFor({state:'visible',timeout:10000});
    assert.equal(apiHits,1);
    assert.equal(ticketBodies[0].action,'ticket');
    assert.equal(ticketBodies[0].token,TOKEN);
    assert.equal(seenApiKeys[0],'sb_publishable_Ey60O_H9LU6mYI8fYbBPWw_5OOtVCmd');
    assert.equal(await page.locator('#ticket-code').textContent(),'WL-012');
    assert.equal(await page.locator('#ticket-packs').textContent(),'2 orang');
    assert.equal(await page.locator('#ticket-outlet').textContent(),'Lazy Jennie');
    assert.equal(await page.locator('#ticket-status').textContent(),'Menunggu');
    assert.equal(await page.locator('#guest-name').count(),0,'guest must not be asked to enter a name');
    assert.equal(await page.locator('form').count(),0,'public page must be read-only');
    const visibleText=await page.locator('#ticket').innerText();
    assert.doesNotMatch(visibleText,/MUST NOT BE RETURNED|guest_name|081234567890/);
    assert.equal(new URL(page.url()).hash,'','token fragment must be removed from the address bar');
    assert.equal(new URL(page.url()).searchParams.has('token'),false,'token must never be moved to query string');

    await context.close();
    console.log('Guest ticket browser-flow tests passed (missing token, view-only ticket, allow-listed data, fragment removal).');
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });
