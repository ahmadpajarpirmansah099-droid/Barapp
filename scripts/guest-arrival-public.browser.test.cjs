const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.GA_PLAYWRIGHT_MODULE || 'playwright');

const pagePath = path.join(__dirname, '..', 'guest-queue.html');
const html = fs.readFileSync(pagePath, 'utf8');
const TOKEN = 'a'.repeat(64);

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  };
}

(async () => {
  let browser;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname !== '/guest-queue.html') {
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
    const createBodies = [];
    const outletBodies = [];
    const seenApiKeys = [];
    let apiHits = 0;
    let firstCreateFails = true;

    // Mock the API at the page's fetch boundary. This keeps the browser-flow
    // test deterministic and avoids relying on external DNS/CORS/network.
    await page.exposeFunction('__gaMockRequest', async (url, init) => {
      apiHits++;
      const headers = init.headers || {};
      const apiKey = Object.entries(headers).find(([key]) => key.toLowerCase() === 'apikey')?.[1] || '';
      seenApiKeys.push(apiKey);
      const body = JSON.parse(init.body || '{}');

      if (body.action === 'outlet') {
        outletBodies.push(body);
        return {
          status: 200,
          body: { ok: true, outlet: { outlet_code: 'LJN', outlet_name: 'Lazy Jennie' } },
        };
      }

      if (body.action === 'create') {
        createBodies.push(body);
        if (firstCreateFails) {
          firstCreateFails = false;
          return {
            status: 500,
            body: { ok: false, error: 'Permintaan belum berhasil diproses. Coba lagi.' },
          };
        }
        return {
          status: 200,
          body: {
            ok: true,
            ticket: {
              queue_number: 7,
              queue_code: 'WL-007',
              status: 'Menunggu',
              operational_date: '2026-10-27',
              outlet_code: 'LJN',
              outlet_name: 'Lazy Jennie',
              duplicate_request: false,
              guest_name: 'MUST NOT BE RETURNED',
              whatsapp: 'MUST NOT BE RETURNED',
            },
          },
        };
      }

      return { status: 400, body: { ok: false, error: 'Aksi tidak valid.' } };
    });

    await context.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        if (!url.includes('/functions/v1/guest-arrival-public')) {
          return realFetch(input, init);
        }
        const result = await window.__gaMockRequest(url, {
          method: init.method || 'GET',
          headers: init.headers || {},
          body: init.body || '',
        });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      };
    });

    // Missing token: the page must stop before making a request.
    let invalidRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/functions/v1/guest-arrival-public')) invalidRequests++;
    });
    await page.goto(`http://127.0.0.1:${address.port}/guest-queue.html`);
    await page.locator('#invalid').waitFor({ state: 'visible' });
    assert.equal(invalidRequests, 0, 'missing token must not call the Edge Function');

    // Valid token: outlet loads, validation blocks invalid input, retry uses same idempotency key.
    await page.goto(`http://127.0.0.1:${address.port}/guest-queue.html#token=${TOKEN}`);
    await page.locator('#registration').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
      throw new Error('Mock outlet lookup did not reveal the form; mocked API calls: ' + apiHits);
    });
    assert.equal(apiHits, 1, 'valid token should perform one mocked outlet lookup');
    assert.equal(outletBodies[0]?.token, TOKEN, 'the URL fragment token should be sent in the outlet lookup body');
    assert.equal(seenApiKeys[0], 'sb_publishable_Ey60O_H9LU6mYI8fYbBPWw_5OOtVCmd');
    assert.equal(await page.locator('#outlet-name').textContent(), 'Lazy Jennie');

    await page.locator('#guest-name').fill('Browser Guest');
    await page.locator('#packs').fill('0');
    await page.locator('#submit').click();
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(createBodies.length, 0, 'invalid pack count must not submit');

    await page.locator('#packs').fill('2');
    await page.locator('#whatsapp').fill('081234567890');
    await page.locator('#smoking').selectOption('Smoking');
    await page.locator('#note').fill('Browser integration retry test');
    await page.locator('#submit').click();
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(createBodies.length, 1, 'first network attempt should happen once');
    assert.match(createBodies[0].request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    await page.locator('#submit').click();
    await page.locator('#ticket').waitFor({ state: 'visible' });
    assert.equal(createBodies.length, 2, 'retry should make a second request');
    assert.equal(createBodies[0].request_id, createBodies[1].request_id, 'retry must reuse idempotency ID');
    assert.equal(createBodies[1].name, 'Browser Guest');
    assert.equal(createBodies[1].packs, 2);
    assert.equal(createBodies[1].whatsapp, '081234567890');
    assert.equal(createBodies[1].smoking_preference, 'Smoking');
    assert.equal(createBodies[1].note, 'Browser integration retry test');

    assert.equal(await page.locator('#ticket-number').textContent(), '7');
    assert.equal(await page.locator('#ticket-code').textContent(), 'WL-007');
    assert.equal(await page.locator('#ticket-status').textContent(), 'Menunggu');
    const ticketText = await page.locator('#ticket').innerText();
    assert.doesNotMatch(ticketText, /Browser Guest|081234567890|MUST NOT BE RETURNED/);
    assert.equal(new URL(page.url()).hash, '', 'token fragment must be removed once ticket succeeds');
    assert.equal(new URL(page.url()).searchParams.has('token'), false, 'token must not be moved to query string');

    await context.close();
    console.log('Public queue browser-flow tests passed (invalid link, validation, retry idempotency, ticket display, URL token removal).');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
