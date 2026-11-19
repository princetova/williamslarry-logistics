import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clearJwksCacheForTests} from '../functions/_lib/admin-auth.js';
import {onRequest as adminMiddleware} from '../functions/api/admin/_middleware.js';

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

function context({url = 'https://williamslarrylogistics.com/api/admin/shipments', token, env = {}} = {}) {
  let nextCalled = false;
  const data = {};
  return {
    value: {
      request: new Request(url, {headers: token ? {'Cf-Access-Jwt-Assertion': token} : {}}),
      env: {
        ADMIN_ALLOWED_HOSTS: 'williamslarrylogistics.com,www.williamslarrylogistics.com',
        CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
        CF_ACCESS_AUD: 'wll-admin-audience',
        ...env,
      },
      data,
      next: async () => { nextCalled = true; return new Response(null, {status: 204}); },
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
