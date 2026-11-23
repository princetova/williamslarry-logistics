import {requireAdminSameOrigin, verifyStaffRequest} from '../../_lib/admin-auth.js';
import {requireRole, resolveStaffIdentity} from '../../_lib/authorization.js';
import {responseForError} from '../../_lib/http.js';
import {requireShipmentsDatabase} from '../../_lib/shipments.js';

export async function onRequest(context) {
  try {
    requireAdminSameOrigin(context.request);
    context.data.accessIdentity = await verifyStaffRequest(context.request, context.env);
    context.data.staff = await resolveStaffIdentity(
      requireShipmentsDatabase(context.env), context.data.accessIdentity,
    );
    requireRole(context.data.staff, ['Field Staff']);
    return await context.next();
  } catch (caught) {
    return responseForError(caught, 'Staff API authentication');
  }
}
