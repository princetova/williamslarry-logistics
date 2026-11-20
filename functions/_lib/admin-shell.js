import {verifyAdminRequest} from './admin-auth.js';
import {resolveStaffIdentity} from './authorization.js';
import {responseForError} from './http.js';
import {requireShipmentsDatabase} from './shipments.js';

const ADMIN_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "manifest-src 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join('; ');

export function secureAdminResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', ADMIN_CSP);
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function protectAdminShell(context) {
  try {
    context.data.admin = await verifyAdminRequest(context.request, context.env);
    context.data.staff = await resolveStaffIdentity(
      requireShipmentsDatabase(context.env), context.data.admin,
    );
    if (!['GET', 'HEAD'].includes(context.request.method.toUpperCase())) {
      return secureAdminResponse(new Response(null, {status: 405, headers: {Allow: 'GET, HEAD'}}));
    }
    return secureAdminResponse(await context.next());
  } catch (caught) {
    return secureAdminResponse(responseForError(caught, 'Administrative dashboard authentication'));
  }
}
