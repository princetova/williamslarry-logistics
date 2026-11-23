import {HttpError} from './http.js';

const encoder = new TextEncoder();
const jwksCache = new Map();
const JWKS_TTL_MS = 60 * 60 * 1000;

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
  } catch {
    throw new HttpError(401, 'Administrative authentication is invalid.');
  }
}

function teamDomain(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  const withProtocol = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new HttpError(503, 'Administrative authentication is not configured.');
  }
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash ||
      !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(parsed.hostname)) {
    throw new HttpError(503, 'Administrative authentication is not configured.');
  }
  return parsed.origin;
}

function allowedAdminHost(request, env) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (hostname.endsWith('.pages.dev')) throw new HttpError(403, 'Administrative access is not available on this host.');
  const configured = String(env.ADMIN_ALLOWED_HOSTS || '')
    .split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!configured.length) throw new HttpError(503, 'Administrative host restrictions are not configured.');
  if (!configured.includes(hostname)) throw new HttpError(403, 'Administrative access is not available on this host.');
}

async function getJwks(issuer, forceRefresh = false) {
  const cached = jwksCache.get(issuer);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;
  let response;
  try {
    response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      headers: {accept: 'application/json'},
    });
  } catch {
    throw new HttpError(503, 'Administrative authentication is temporarily unavailable.');
  }
  if (!response.ok) throw new HttpError(503, 'Administrative authentication is temporarily unavailable.');
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body?.keys) || !body.keys.length) {
    throw new HttpError(503, 'Administrative authentication is temporarily unavailable.');
  }
  jwksCache.set(issuer, {keys: body.keys, expiresAt: Date.now() + JWKS_TTL_MS});
  return body.keys;
}

function audienceMatches(actual, expected) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

export async function verifyAccessRequest(request, env, audienceVariable) {
  allowedAdminHost(request, env);
  const issuer = teamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const expectedAudience = String(env[audienceVariable] || '').trim();
  if (!expectedAudience) throw new HttpError(503, 'Administrative authentication is not configured.');

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, 'Administrative authentication is required.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Administrative authentication is invalid.');
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new HttpError(401, 'Administrative authentication is invalid.');
  }

  let keys = await getJwks(issuer);
  let jwk = keys.find(candidate => candidate?.kid === header.kid && candidate?.kty === 'RSA');
  if (!jwk) {
    keys = await getJwks(issuer, true);
    jwk = keys.find(candidate => candidate?.kid === header.kid && candidate?.kty === 'RSA');
  }
  if (!jwk) throw new HttpError(401, 'Administrative authentication is invalid.');
  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify'],
    );
  } catch {
    throw new HttpError(503, 'Administrative authentication is temporarily unavailable.');
  }
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', publicKey, decodeBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) throw new HttpError(401, 'Administrative authentication is invalid.');

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== issuer || !audienceMatches(payload.aud, expectedAudience) ||
      typeof payload.exp !== 'number' || payload.exp <= now ||
      (typeof payload.nbf === 'number' && payload.nbf > now + 60) ||
      typeof payload.sub !== 'string' || !payload.sub) {
    throw new HttpError(401, 'Administrative authentication is invalid.');
  }
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
  };
}

export function verifyAdminRequest(request, env) {
  const configured = env.CF_ACCESS_ADMIN_AUD || env.CF_ACCESS_AUD;
  return verifyAccessRequest(request, {...env, CF_ACCESS_EFFECTIVE_ADMIN_AUD: configured}, 'CF_ACCESS_EFFECTIVE_ADMIN_AUD');
}

export function verifyStaffRequest(request, env) {
  return verifyAccessRequest(request, env, 'CF_ACCESS_STAFF_AUD');
}

export function requireAdminSameOrigin(request) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const expected = new URL(request.url).origin;
  const supplied = request.headers.get('Origin');
  let actual;
  try {
    actual = new URL(supplied).origin;
  } catch {
    throw new HttpError(403, 'Administrative request origin is not allowed.');
  }
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (actual !== expected || (fetchSite && fetchSite !== 'same-origin')) {
    throw new HttpError(403, 'Administrative request origin is not allowed.');
  }
}

export function clearJwksCacheForTests() {
  jwksCache.clear();
}
