const encoder = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
  }
}

export function json(status, value, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

export function error(status, message, extraHeaders = {}) {
  return json(status, {ok: false, message}, extraHeaders);
}

export function methodNotAllowed(allow) {
  return error(405, 'Method not allowed.', {allow});
}

export async function readJson(request, maxBytes = 32_000) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Submit this request as JSON.');
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, 'The request is too large.');
  }
  let raw;
  try {
    raw = await request.text();
  } catch {
    throw new HttpError(400, 'The request could not be read.');
  }
  if (encoder.encode(raw).length > maxBytes) throw new HttpError(413, 'The request is too large.');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'The request contains invalid JSON.');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new HttpError(422, 'The request body must be a JSON object.');
  }
  return value;
}

export function responseForError(caught, label = 'API request') {
  if (caught instanceof HttpError) return error(caught.status, caught.message, caught.headers);
  console.error(`${label} failed`);
  return error(500, 'The request could not be completed.');
}
