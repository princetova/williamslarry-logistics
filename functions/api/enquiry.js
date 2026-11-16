/**
 * WilliamsLarry Logistics — Cloudflare Pages enquiry endpoint.
 * URL: POST /api/enquiry
 * Secrets and KV binding live in Cloudflare (never in public HTML/JS).
 * No customer enquiry is marked successful unless a messaging provider accepts it.
 */

const MAX_BODY_BYTES = 16_000;
const FIELD_LIMITS = Object.freeze({
  sender: 90, sender_phone: 24, pickup: 200, receiver: 90,
  receiver_phone: 24, destination: 200, items: 700,
  service: 80, notes: 500, source: 20,
});
const VALID_SERVICES = new Set([
  '', 'Payment on Delivery / E-commerce', 'Haulage of large goods',
  'Waybill services / Regional routes', 'Warehousing',
  'Waybill pickup and delivery', 'Nationwide house relocation', 'Other / Not sure',
]);
const REQUIRED = ['sender','sender_phone','pickup','receiver','receiver_phone','destination','items'];
const encoder = new TextEncoder();

function json(status, value, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      ...extraHeaders,
    },
  });
}
function error(status, message, extraHeaders) {
  return json(status, {ok:false, message}, extraHeaders);
}
function cleanFields(data) {
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Invalid form submission.');
  const fields = {};
  for (const [name, max] of Object.entries(FIELD_LIMITS)) {
    let value = data[name] ?? '';
    if (typeof value !== 'string') throw new Error('Please check the form information and try again.');
    value = value.trim().replace(/\r\n?/g, '\n');
    if ([...value].length > max) throw new Error('Some fields are too long. Please shorten the details.');
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new Error('Your message contains unsupported characters.');
    fields[name] = value;
  }
  if (REQUIRED.some(name => !fields[name])) throw new Error('Please complete every required field.');
  for (const name of ['sender_phone', 'receiver_phone']) {
    const value = fields[name];
    const digits = value.replace(/\D/g, '');
    if (!/^\+?[\d\s()-]+$/.test(value) || digits.length < 7 || digits.length > 15) {
      throw new Error('Enter a valid sender and receiver phone number.');
    }
  }
  if (!VALID_SERVICES.has(fields.service) || !['quote','contact'].includes(fields.source)) {
    throw new Error('Please choose a valid service and try again.');
  }
  return fields;
}
function summarize(value, limit) {
  const compact = (value || '').replace(/\s+/g, ' ').trim();
  return [...compact].length > limit ? [...compact].slice(0, limit - 3).join('') + '...' : compact;
}
function emailBody(fields, ref) {
  return [
    'New WilliamsLarry Logistics website enquiry', `Reference: ${ref}`,
    `Received (UTC): ${new Date().toISOString()}`, `Form: ${fields.source}`, '',
    'SENDER', `Name: ${fields.sender}`, `Phone: ${fields.sender_phone}`, `Pickup: ${fields.pickup}`, '',
    'RECEIVER', `Name: ${fields.receiver}`, `Phone: ${fields.receiver_phone}`,
    `Drop-off: ${fields.destination}`, '',
    `SERVICE: ${fields.service || 'Not selected'}`, '',
    'ITEM(S)', fields.items, '', 'NOTES', fields.notes || 'None', '',
    'Please confirm coverage, availability and pricing before accepting any delivery.',
  ].join('\n');
}
async function sendEmail(env, fields, ref) {
  if (String(env.EMAIL_ENABLED ?? 'true').toLowerCase() === 'false' ||
      !env.RESEND_API_KEY || !env.EMAIL_TO || !env.EMAIL_FROM) return 'not_configured';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type':'application/json',
        'authorization':`Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM, to: [env.EMAIL_TO],
        subject: `New delivery enquiry [${ref}] | WilliamsLarry Logistics`,
        text: emailBody(fields, ref),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.id) {
      console.error('WilliamsLarry email provider returned status', response.status);
      return 'failed';
    }
    return 'accepted';
  } catch {
    console.error('WilliamsLarry email transport unavailable');
    return 'failed';
  }
}
async function sendWhatsApp(env, fields, ref) {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;
  const to = env.WHATSAPP_ALERT_TO || '2349038704667';
  const template = env.WHATSAPP_TEMPLATE_NAME || 'wll_new_enquiry';
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
  const version = env.WHATSAPP_GRAPH_VERSION || 'v27.0';
  if (!token || !phoneId) return 'not_configured';
  if (!/^\d{8,20}$/.test(phoneId) || !/^[1-9]\d{7,14}$/.test(to) ||
      !/^v\d{2}\.\d{1,2}$/.test(version) || !/^[a-z0-9_]{1,80}$/.test(template) ||
      !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) return 'failed';
  const vals = [
    ref, summarize(fields.service || 'Not selected', 60),
    summarize(`${fields.sender} (${fields.sender_phone})`, 115),
    summarize(fields.pickup, 130),
    summarize(`${fields.receiver} (${fields.receiver_phone})`, 115),
    summarize(fields.destination, 130),
    summarize(fields.items, 170), summarize(fields.notes || 'None', 110),
  ];
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method:'POST', headers: {
        'content-type':'application/json',
        'authorization':`Bearer ${token}`,
      }, body:JSON.stringify({
        messaging_product:'whatsapp', recipient_type:'individual', to, type:'template',
        template: {
          name:template, language:{code:language},
          components:[{type:'body', parameters: vals.map(text => ({type:'text',text}))}],
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.messages?.[0]?.id) {
      console.error('WilliamsLarry WhatsApp provider returned status', response.status);
      return 'failed';
    }
    return 'accepted';
  } catch {
    console.error('WilliamsLarry WhatsApp transport unavailable');
    return 'failed';
  }
}
function resultMessage(channels) {
  if (channels.email === 'accepted' && channels.whatsapp === 'accepted') {
    return 'Your enquiry was accepted for email and WhatsApp notification. Our team will follow up.';
  }
  if (channels.email === 'accepted') {
    return 'Your enquiry was accepted for email notification. WhatsApp notification is not yet confirmed. Contact us directly if urgent.';
  }
  if (channels.whatsapp === 'accepted') {
    return 'Your enquiry was accepted for WhatsApp notification. Email notification is not yet confirmed. Contact us directly if urgent.';
  }
  return 'Your enquiry could not be submitted. Please contact us directly via WhatsApp or phone.';
}
async function digest(input) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Cloudflare Pages Functions entry point, POST only. */
export async function onRequestPost({request, env}) {
  if (!env.ENQUIRY_KV) return error(503, 'Enquiries are temporarily unavailable. Please contact us on WhatsApp.');

  // Same-origin form only. Not a replacement for additional bot controls.
  const siteOrigin = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== siteOrigin) return error(403, 'Form origin not permitted.');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return error(403, 'Cross-site submissions are not allowed.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return error(415, 'Please submit your enquiry using the website.');
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return error(413, 'Your enquiry is too long. Please shorten the details.');
  }

  let raw;
  try {
    raw = await request.text();
    if (encoder.encode(raw).length > MAX_BODY_BYTES) return error(413, 'Your enquiry is too long. Please shorten the details.');
  } catch { return error(400, 'Your request could not be read.'); }
  let data;
  try { data = JSON.parse(raw); } catch { return error(400, 'Your request could not be read.'); }
  if (data?.company_website) return json(200, {ok:true,message:'Your enquiry has been submitted.'});

  let fields;
  try { fields = cleanFields(data); }
  catch (e) { return error(422, e instanceof Error ? e.message : 'Invalid form submission.'); }

  // Basic abuse controls: best-effort KV quotas, and three-minute deduplication.
  // KV is eventually consistent, so this is NOT a strict distributed lock.
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await digest(`${env.RATE_LIMIT_PEPPER || 'wll-public'}:${clientIP}`);
  const quotaKey = `quota:${ipHash}:${Math.floor(Date.now() / 600_000)}`;
  const fingerprint = await digest(`${ipHash}:${JSON.stringify(fields)}`);
  const dedupKey = `dedupe:${fingerprint}`;
  try {
    const [existing, quota] = await Promise.all([
      env.ENQUIRY_KV.get(dedupKey, 'json'),
      env.ENQUIRY_KV.get(quotaKey),
    ]);
    if (existing) return json(200, {
      ok:true, message:'This enquiry was already submitted recently. Please check with our team before resending.',
      reference:existing.reference,channels:existing.channels,
    });
    if (Number(quota || 0) >= 5) return error(429, 'Too many enquiries. Please try later or contact us on WhatsApp.');
    await env.ENQUIRY_KV.put(quotaKey, String(Number(quota || 0) + 1), {expirationTtl: 1200});
  } catch {
    console.error('WilliamsLarry KV unavailable');
    return error(503, 'Enquiries are temporarily unavailable. Please contact us on WhatsApp.');
  }

  if (!env.RESEND_API_KEY && !env.WHATSAPP_ACCESS_TOKEN) {
    return error(503, 'Automatic notifications are not active yet. Please contact us directly on WhatsApp.');
  }

  const reference = `WL-${crypto.randomUUID().replace(/-/g,'').slice(0,10).toUpperCase()}`;
  const [email, whatsapp] = await Promise.all([
    sendEmail(env,fields,reference), sendWhatsApp(env,fields,reference),
  ]);
  const channels = {email,whatsapp};
  if (email !== 'accepted' && whatsapp !== 'accepted') {
    return error(email === 'not_configured' && whatsapp === 'not_configured' ? 503 : 502, resultMessage(channels));
  }
  try {
    await env.ENQUIRY_KV.put(dedupKey, JSON.stringify({reference,channels}), {expirationTtl:180});
  } catch {
    // Provider acceptance has occurred; do NOT tell users to resend due to a KV write issue.
    console.error('WilliamsLarry post-send dedupe persistence unavailable');
  }
  return json(200, {ok:true,reference,channels,message:resultMessage(channels)});
}

export function onRequest() {
  return error(405, 'This endpoint accepts form submissions only.', {'allow':'POST'});
}
