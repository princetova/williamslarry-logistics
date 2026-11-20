import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clearJwksCacheForTests} from '../functions/_lib/admin-auth.js';
import {onRequest as adminMiddleware} from '../functions/api/admin/_middleware.js';
import {onRequest as staffMiddleware} from '../functions/api/staff/_middleware.js';
import {onRequest as staffRootHandler} from '../functions/staff.js';
import {onRequest as staffShellMiddleware} from '../functions/staff/_middleware.js';

function base64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signer() {
  const pair = await crypto.subtle.generateKey(
    {name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
    true, ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  Object.assign(publicJwk, {kid: 'phase4b-key', alg: 'RS256', use: 'sig'});
  return {
    publicJwk,
    async token({subject, audience}) {
      const now = Math.floor(Date.now() / 1000);
      const header = base64Url(JSON.stringify({alg: 'RS256', typ: 'JWT', kid: 'phase4b-key'}));
      const payload = base64Url(JSON.stringify({
        iss: 'https://example.cloudflareaccess.com', aud: [audience], sub: subject,
        email: `${subject}@example.test`, iat: now, exp: now + 300,
      }));
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`),
      );
      return `${header}.${payload}.${base64Url(signature)}`;
    },
  };
}

function staffDatabase() {
  const rows = new Map([
    ['access-owner', {
      id: 'owner-1', access_subject: 'access-owner', email: 'owner@example.test',
      display_name: 'Synthetic Owner', role: 'Owner', active: 1, version: 1,
      created_at: '2026-11-20T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z',
    }],
    ['access-reception', {
      id: 'reception-1', access_subject: 'access-reception', email: 'reception@example.test',
      display_name: 'Synthetic Receptionist', role: 'Receptionist', active: 1, version: 1,
      created_at: '2026-11-20T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z',
    }],
    ['access-field', {
      id: 'field-1', access_subject: 'access-field', email: 'field@example.test',
      display_name: 'Synthetic Field Staff', role: 'Field Staff', active: 1, version: 1,
      created_at: '2026-11-20T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z',
    }],
  ]);
  return {
    prepare() {
      return {
        bind(subject) {
          return {async first() { return rows.get(subject) || null; }};
        },
      };
    },
  };
}

function context({
  url, token, method = 'GET', headers = {}, env = {}, nextResponse,
}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set('Cf-Access-Jwt-Assertion', token);
  let nextCalled = false;
  return {
    value: {
      request: new Request(url, {method, headers: requestHeaders}),
      env: {
        ADMIN_ALLOWED_HOSTS: 'williamslarrylogistics.com,www.williamslarrylogistics.com',
        CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
        CF_ACCESS_AUD: 'admin-audience',
        CF_ACCESS_STAFF_AUD: 'staff-audience',
        SHIPMENTS_DB: staffDatabase(),
        ...env,
      },
      data: {},
      next: async () => {
        nextCalled = true;
        return nextResponse ? nextResponse() : new Response(null, {status: 204});
      },
    },
    wasNextCalled: () => nextCalled,
  };
}

test('admin and staff API namespaces enforce separate audiences and D1 roles', async () => {
  clearJwksCacheForTests();
  const realFetch = globalThis.fetch;
  const signing = await signer();
  globalThis.fetch = async () => new Response(JSON.stringify({keys: [signing.publicJwk]}));
  try {
    const fieldStaffToken = await signing.token({subject: 'access-field', audience: 'staff-audience'});
    const fieldAdminToken = await signing.token({subject: 'access-field', audience: 'admin-audience'});
    const ownerAdminToken = await signing.token({subject: 'access-owner', audience: 'admin-audience'});
    const ownerStaffToken = await signing.token({subject: 'access-owner', audience: 'staff-audience'});

    const staffAllowed = context({
      url: 'https://williamslarrylogistics.com/api/staff/deliveries', token: fieldStaffToken,
    });
    assert.equal((await staffMiddleware(staffAllowed.value)).status, 204);
    assert.equal(staffAllowed.wasNextCalled(), true);
    assert.equal(staffAllowed.value.data.staff.role, 'Field Staff');

    const wrongAudience = context({
      url: 'https://williamslarrylogistics.com/api/staff/deliveries', token: fieldAdminToken,
    });
    assert.equal((await staffMiddleware(wrongAudience.value)).status, 401);
    assert.equal(wrongAudience.wasNextCalled(), false);

    const ownerInStaff = context({
      url: 'https://williamslarrylogistics.com/api/staff/deliveries', token: ownerStaffToken,
    });
    assert.equal((await staffMiddleware(ownerInStaff.value)).status, 403);

    const fieldInAdmin = context({
      url: 'https://williamslarrylogistics.com/api/admin/shipments', token: fieldAdminToken,
    });
    assert.equal((await adminMiddleware(fieldInAdmin.value)).status, 403);

    const ownerAllowed = context({
      url: 'https://williamslarrylogistics.com/api/admin/shipments', token: ownerAdminToken,
    });
    assert.equal((await adminMiddleware(ownerAllowed.value)).status, 204);
  } finally {
    globalThis.fetch = realFetch;
    clearJwksCacheForTests();
  }
});

test('staff routes fail closed without their audience and reject previews and cross-site mutations', async () => {
  clearJwksCacheForTests();
  const realFetch = globalThis.fetch;
  const signing = await signer();
  globalThis.fetch = async () => new Response(JSON.stringify({keys: [signing.publicJwk]}));
  try {
    const token = await signing.token({subject: 'access-field', audience: 'staff-audience'});
    const missing = context({
      url: 'https://williamslarrylogistics.com/api/staff/deliveries', token,
      env: {CF_ACCESS_STAFF_AUD: ''},
    });
    assert.equal((await staffMiddleware(missing.value)).status, 503);

    const preview = context({
      url: 'https://williamslarry-logistics.pages.dev/api/staff/deliveries', token,
    });
    assert.equal((await staffMiddleware(preview.value)).status, 403);

    const mutation = context({
      url: 'https://williamslarrylogistics.com/api/staff/deliveries/WLL-0000000000000000/status',
      token, method: 'POST', headers: {Origin: 'https://attacker.example'},
    });
    assert.equal((await staffMiddleware(mutation.value)).status, 403);
    assert.equal(mutation.wasNextCalled(), false);

    const sameOrigin = context({
      url: 'https://williamslarrylogistics.com/api/staff/deliveries/WLL-0000000000000000/status',
      token, method: 'POST',
      headers: {Origin: 'https://williamslarrylogistics.com', 'Sec-Fetch-Site': 'same-origin'},
    });
    assert.equal((await staffMiddleware(sameOrigin.value)).status, 204);
  } finally {
    globalThis.fetch = realFetch;
    clearJwksCacheForTests();
  }
});

test('staff portal root and descendants are protected and routed through Functions', async () => {
  clearJwksCacheForTests();
  const realFetch = globalThis.fetch;
  const signing = await signer();
  globalThis.fetch = async () => new Response(JSON.stringify({keys: [signing.publicJwk]}));
  try {
    const token = await signing.token({subject: 'access-field', audience: 'staff-audience'});
    for (const path of ['/staff', '/staff/', '/staff/app.js']) {
      const handler = path === '/staff' ? staffRootHandler : staffShellMiddleware;
      const denied = context({url: `https://williamslarrylogistics.com${path}`});
      assert.equal((await handler(denied.value)).status, 401, path);
      const allowed = context({
        url: `https://williamslarrylogistics.com${path}`, token,
        nextResponse: () => new Response('staff asset', {status: 200}),
      });
      const response = await handler(allowed.value);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
      assert.equal(response.headers.get('x-frame-options'), 'DENY', path);
    }
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));
    assert.equal(routes.include.includes('/staff'), true);
    assert.equal(routes.include.includes('/staff/*'), true);
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    assert.match(headers, /\/staff\s+[\s\S]*?Cache-Control: no-store/);
    assert.match(headers, /\/staff\/\*\s+[\s\S]*?Content-Security-Policy:/);
  } finally {
    globalThis.fetch = realFetch;
    clearJwksCacheForTests();
  }
});
