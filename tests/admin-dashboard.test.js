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
  const motion = await read('public/admin/admin-motion.js');
  const experience = await read('public/admin/admin-experience.js');
  const glassCss = await read('public/admin/admin-liquid-glass.css');
  const experienceCss = await read('public/admin/admin-experience.css');

  assert.match(html, /<script src="\/admin\/admin\.js" defer><\/script>/);
  assert.match(html, /<script src="\/admin\/admin-motion\.js" defer><\/script>/);
  assert.match(html, /<script src="\/admin\/admin-experience\.js" defer><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin\.css">/);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin-liquid-glass\.css">/);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin-experience\.css">/);
  assert.doesNotMatch(html, /<script(?!\s+src=)/);
  assert.match(script, /credentials:'same-origin'/);
  assert.match(script, /cache:'no-store'/);
  assert.match(script, /redirect:'error'/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|document\.cookie|innerHTML|outerHTML/);
  assert.match(script, /textContent/);
  assert.match(script, /\/api\/admin\/shipments/);
  assert.match(script, /\/api\/admin\/stats/);
  assert.doesNotMatch(`${motion}\n${experience}`, /fetch\(|localStorage|sessionStorage|document\.cookie/);
  assert.match(glassCss, /prefers-reduced-motion:reduce/);
  assert.match(experienceCss, /prefers-reduced-motion:reduce/);
  assert.match(experienceCss, /@media\(max-width:780px\)/);
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
  assert.match(script, /e\?\.status===409/);
  assert.match(script, /Latest shipment details loaded/);
  assert.match(script, /const refPattern = \/\^WLL-/);
});

test('premium portal integrates Phase 4C.1 endpoints and response structures', async () => {
  const html = await read('public/admin/index.html');
  const script = await read('public/admin/admin.js');
  for (const endpoint of [
    '/api/admin/me', '/api/admin/dispatch/workers', '/api/admin/issues',
    '/assignments?page=1&limit=25', '/acknowledgements?page=1&limit=25',
    '/api/admin/staff', '/api/admin/audit',
  ]) assert.ok(script.includes(endpoint), endpoint);
  assert.match(script, /unassignedActive/);
  assert.match(script, /pendingAcknowledgements/);
  assert.match(script, /openDeliveryIssues/);
  assert.match(script, /staffWorkload/);
  assert.match(script, /i\.occurredAt\|\|i\.createdAt/);
  assert.match(script, /i\.actor\?\.email\|\|i\.actor\?\.staffId\|\|i\.actor\?\.role/);
  assert.match(script, /paging\(st\.list,''\)/);
  assert.match(html, /data-owner-only/);
  assert.match(script, /\['Owner','Receptionist'\]\.includes\(data\.staff\?\.role\)/);
});
