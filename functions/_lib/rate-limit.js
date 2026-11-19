import {HttpError} from './http.js';

const encoder = new TextEncoder();

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function enforceTrackingRateLimit(request, env) {
  const store = env.TRACKING_RATE_LIMIT_KV || env.ENQUIRY_KV;
  const pepper = String(env.RATE_LIMIT_PEPPER || '').trim();
  if (!store || !pepper) {
    throw new HttpError(503, 'Shipment tracking is temporarily unavailable.');
  }

  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await digest(`${pepper}:tracking:${clientIP}`);
  const windowNumber = Math.floor(Date.now() / 600_000);
  const key = `tracking-quota:${ipHash}:${windowNumber}`;

  try {
    const count = Number(await store.get(key) || 0);
    if (count >= 30) {
      throw new HttpError(429, 'Too many tracking requests. Please try again later.', {'retry-after': '600'});
    }
    await store.put(key, String(count + 1), {expirationTtl: 1200});
  } catch (caught) {
    if (caught instanceof HttpError) throw caught;
    throw new HttpError(503, 'Shipment tracking is temporarily unavailable.');
  }
}
