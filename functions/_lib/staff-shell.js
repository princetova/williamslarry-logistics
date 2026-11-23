import {verifyStaffRequest} from './admin-auth.js';
import {requireRole, resolveStaffIdentity} from './authorization.js';
import {secureAdminResponse} from './admin-shell.js';
import {responseForError} from './http.js';
import {requireShipmentsDatabase} from './shipments.js';

export async function protectStaffShell(context) {
  try {
    context.data.accessIdentity = await verifyStaffRequest(context.request, context.env);
    context.data.staff = await resolveStaffIdentity(
      requireShipmentsDatabase(context.env), context.data.accessIdentity,
    );
    requireRole(context.data.staff, ['Field Staff']);
    if (!['GET', 'HEAD'].includes(context.request.method.toUpperCase())) {
      return secureAdminResponse(new Response(null, {status: 405, headers: {Allow: 'GET, HEAD'}}));
    }
    return secureAdminResponse(await context.next());
  } catch (caught) {
    return secureAdminResponse(responseForError(caught, 'Staff portal authentication'));
  }
}
