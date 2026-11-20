import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clearJwksCacheForTests} from '../functions/_lib/admin-auth.js';
import {onRequest as adminRootHandler} from '../functions/admin.js';
import {onRequest as adminShellMiddleware} from '../functions/admin/_middleware.js';
import {onRequest as adminMiddleware} from '../functions/api/admin/_middleware.js';

function staffDatabase({active = true, role = 'Owner', exists = true} = {}) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              if (!exists) return null;
              return {
                id: 'staff-owner-1', access_subject: 'access-user-123',
                email: 'admin@example.test', display_name: 'Synthetic Owner', role,
                active: active ? 1 : 0, version: 1,
                created_at: '2026-11-20T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z',
              };
            },
          };
        },
      };
    },
  };
}

function base64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signingFixture(overrides = {}) {
  const pair = await crypto.subtle.generateKey(
    {name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
    true, ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  Object.assign(publicJwk, {kid: 'test-key', alg: 'RS256', use: 'sig'});
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({alg: 'RS256', typ: 'JWT', kid: 'test-key'}));
  const payload = base64Url(JSON.stringify({
    iss: 'https://example.cloudflareaccess.com',
    aud: ['wll-admin-audience'],
    sub: 'access-user-123',
    email: 'admin@example.test',
    iat: now,
    exp: now + 300,
    ...overrides,
  }));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`),
  );
  return {token: `${header}.${payload}.${base64Url(signature)}`, publicJwk};
}

function context({
  url = 'https://williamslarrylogistics.com/api/admin/shipments',
  token,
  env = {},
  method = 'GET',
  headers = {},
  nextResponse = () => new Response(null, {status: 204}),
} = {}) {
  let nextCalled = false;
  const data = {};
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set('Cf-Access-Jwt-Assertion', token);
  return {
    value: {
      request: new Request(url, {method, headers: requestHeaders}),
      env: {
        ADMIN_ALLOWED_HOSTS: 'williamslarrylogistics.com,www.williamslarrylogistics.com',
        CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
        CF_ACCESS_AUD: 'wll-admin-audience',
        SHIPMENTS_DB: staffDatabase(),
        ...env,
      },
      data,
      next: async () => { nextCalled = true; return nextResponse(); },
    },
    data,
    wasNextCalled: () => nextCalled,
  };
}

test('rejects unauthenticated administrative requests before a handler runs', async () => {
  const ctx = context();
  const response = await adminMiddleware(ctx.value);
  assert.equal(response.status, 401);
  assert.equal(ctx.wasNextCalled(), false);
});

test('fails closed when Access configuration is missing', async () => {
  const ctx = context({env: {CF_ACCESS_AUD: ''}});
  const response = await adminMiddleware(ctx.value);
  assert.equal(response.status, 503);
  assert.equal(ctx.wasNextCalled(), false);
});

test('blocks pages.dev and other hosts before administrative JWT processing', async () => {
  const preview = context({url: 'https://williamslarry-logistics.pages.dev/api/admin/shipments'});
  assert.equal((await adminMiddleware(preview.value)).status, 403);
  const foreign = context({url: 'https://preview.example.com/api/admin/shipments'});
  assert.equal((await adminMiddleware(foreign.value)).status, 403);
});

test('validates the Access JWT signature, issuer, audience, expiry and identity', async () => {
  clearJwksCacheForTests();
  const realFetch = globalThis.fetch;
  const fixture = await signingFixture();
  let certCalls = 0;
  globalThis.fetch = async url => {
    certCalls += 1;
    assert.equal(url, 'https://example.cloudflareaccess.com/cdn-cgi/access/certs');
    return new Response(JSON.stringify({keys: [fixture.publicJwk]}), {status: 200});
  };
  try {
    const ctx = context({token: fixture.token});
    const response = await adminMiddleware(ctx.value);
    assert.equal(response.status, 204);
    assert.equal(ctx.wasNextCalled(), true);
    assert.deepEqual(ctx.data.admin, {subject: 'access-user-123', email: 'admin@example.test'});
    assert.equal(ctx.data.staff.role, 'Owner');
    assert.equal(certCalls, 1);

    const [tamperedHeader, tamperedPayload, signature] = fixture.token.split('.');
    const tamperedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    const tampered = `${tamperedHeader}.${tamperedPayload}.${tamperedSignature}`;
    assert.equal((await adminMiddleware(context({token: tampered}).value)).status, 401);

    const wrongAudience = await signingFixture({aud: ['wrong-audience']});
    clearJwksCacheForTests();
    globalThis.fetch = async () => new Response(JSON.stringify({keys: [wrongAudience.publicJwk]}));
    assert.equal((await adminMiddleware(context({token: wrongAudience.token}).value)).status, 401);

    const expired = await signingFixture({exp: Math.floor(Date.now() / 1000) - 1});
    clearJwksCacheForTests();
    globalThis.fetch = async () => new Response(JSON.stringify({keys: [expired.publicJwk]}));
    assert.equal((await adminMiddleware(context({token: expired.token}).value)).status, 401);

    const wrongIssuer = await signingFixture({iss: 'https://other.cloudflareaccess.com'});
    clearJwksCacheForTests();
    globalThis.fetch = async () => new Response(JSON.stringify({keys: [wrongIssuer.publicJwk]}));
    assert.equal((await adminMiddleware(context({token: wrongIssuer.token}).value)).status, 401);
  } finally {
    globalThis.fetch = realFetch;
    clearJwksCacheForTests();
  }
});

test('protects the admin shell, normalized paths and dashboard assets with Access and no-store headers', async () => {
  clearJwksCacheForTests();
  const realFetch = globalThis.fetch;
  const fixture = await signingFixture();
  globalThis.fetch = async () => new Response(JSON.stringify({keys: [fixture.publicJwk]}));
  try {
    const paths = ['/admin', '/admin/', '/admin/index', '/admin/index.html', '/admin/admin.js', '/admin/admin.css'];
    for (const path of paths) {
      const handler = path === '/admin' ? adminRootHandler : adminShellMiddleware;
      const denied = context({url: `https://williamslarrylogistics.com${path}`});
      assert.equal((await handler(denied.value)).status, 401, path);
      assert.equal(denied.wasNextCalled(), false, path);

      const allowed = context({
        url: `https://williamslarrylogistics.com${path}`,
        token: fixture.token,
        nextResponse: () => new Response('protected asset', {
          status: 200,
          headers: {'cache-control': 'public, max-age=86400'},
        }),
      });
      const response = await handler(allowed.value);
      assert.equal(response.status, 200, path);
      assert.equal(allowed.wasNextCalled(), true, path);
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
      assert.equal(response.headers.get('x-frame-options'), 'DENY', path);
      assert.match(response.headers.get('content-security-policy'), /script-src 'self'/, path);
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/, path);
      assert.equal(await response.text(), 'protected asset', path);
    }

    for (const host of ['williamslarry-logistics.pages.dev', 'preview.example.com']) {
      const blocked = context({url: `https://${host}/admin/`, token: fixture.token});
      assert.equal((await adminShellMiddleware(blocked.value)).status, 403, host);
      assert.equal(blocked.wasNextCalled(), false, host);
    }
  } finally {
    globalThis.fetch = realFetch;
    clearJwksCacheForTests();
  }
});

test('rejects cross-site administrative mutations and permits authenticated same-origin writes', async () => {
  clearJwksCacheForTests();
  const realFetch = globalThis.fetch;
  const fixture = await signingFixture();
  globalThis.fetch = async () => new Response(JSON.stringify({keys: [fixture.publicJwk]}));
  try {
    for (const headers of [
      {},
      {Origin: 'https://attacker.example'},
      {Origin: 'https://williamslarrylogistics.com', 'Sec-Fetch-Site': 'cross-site'},
    ]) {
      const blocked = context({method: 'POST', token: fixture.token, headers});
      assert.equal((await adminMiddleware(blocked.value)).status, 403);
      assert.equal(blocked.wasNextCalled(), false);
    }

    const allowed = context({
      method: 'POST',
      token: fixture.token,
      headers: {Origin: 'https://williamslarrylogistics.com', 'Sec-Fetch-Site': 'same-origin'},
    });
    assert.equal((await adminMiddleware(allowed.value)).status, 204);
    assert.equal(allowed.wasNextCalled(), true);
  } finally {
    globalThis.fetch = realFetch;
    clearJwksCacheForTests();
  }
});

test('fails closed for missing D1, unprovisioned identities and deactivated staff', async () => {
  clearJwksCacheForTests();
  const realFetch = globalThis.fetch;
  const fixture = await signingFixture();
  globalThis.fetch = async () => new Response(JSON.stringify({keys: [fixture.publicJwk]}));
  try {
    const missing = context({token: fixture.token, env: {SHIPMENTS_DB: null}});
    assert.equal((await adminMiddleware(missing.value)).status, 503);
    assert.equal(missing.wasNextCalled(), false);

    const unknown = context({token: fixture.token, env: {SHIPMENTS_DB: staffDatabase({exists: false})}});
    assert.equal((await adminMiddleware(unknown.value)).status, 403);
    assert.equal(unknown.wasNextCalled(), false);

    const inactive = context({token: fixture.token, env: {SHIPMENTS_DB: staffDatabase({active: false})}});
    assert.equal((await adminMiddleware(inactive.value)).status, 403);
    assert.equal(inactive.wasNextCalled(), false);

    const shell = context({
      url: 'https://williamslarrylogistics.com/admin/', token: fixture.token,
      env: {SHIPMENTS_DB: staffDatabase({active: false})},
    });
    assert.equal((await adminShellMiddleware(shell.value)).status, 403);
    assert.equal(shell.wasNextCalled(), false);
  } finally {
    globalThis.fetch = realFetch;
    clearJwksCacheForTests();
  }
});
