import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('routes the complete admin shell and its assets through Pages Functions', async () => {
  const routes = JSON.parse(await read('public/_routes.json'));
  assert.ok(routes.include.includes('/api/*'));
  assert.ok(routes.include.includes('/admin'));
  assert.ok(routes.include.includes('/admin/*'));

  const headers = await read('public/_headers');
  assert.match(headers, /\/admin\s+[\s\S]*?Cache-Control: no-store/);
  assert.match(headers, /\/admin\/\*\s+[\s\S]*?Content-Security-Policy:/);
  assert.match(headers, /frame-ancestors 'none'/);
});

test('dashboard uses same-origin protected APIs without persistent credential or private-data storage', async () => {
  const html = await read('public/admin/index.html');
  const script = await read('public/admin/admin.js');

  assert.match(html, /<script src="\/admin\/admin\.js" defer><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin\.css">/);
  assert.doesNotMatch(html, /<script(?!\s+src=)/);
  assert.match(script, /credentials:'same-origin'/);
  assert.match(script, /cache:'no-store'/);
  assert.match(script, /redirect:'error'/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|document\.cookie|innerHTML|outerHTML/);
  assert.match(script, /textContent/);
  assert.match(script, /\/api\/admin\/shipments/);
  assert.match(script, /\/api\/admin\/stats/);
});

test('dashboard registration and status forms match the Phase 3A API contract', async () => {
  const html = await read('public/admin/index.html');
  const script = await read('public/admin/admin.js');
  const requiredCreateFields = [
    'senderName', 'senderPhone', 'receiverName', 'receiverPhone',
    'originAddress', 'destinationAddress', 'originPublic', 'destinationPublic',
    'itemDescription', 'publicItemSummary',
  ];
  for (const field of requiredCreateFields) assert.match(html, new RegExp(`name="${field}"[^>]*required`), field);
  assert.match(script, /expectedVersion:s\.version/);
  assert.match(script, /e\.status===409/);
  assert.match(script, /Latest details loaded/);
  assert.match(script, /const refPattern = \/\^WLL-/);
});
