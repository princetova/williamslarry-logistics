import {requireAdminSameOrigin, verifyAdminRequest} from '../../_lib/admin-auth.js';
import {resolveStaffIdentity} from '../../_lib/authorization.js';
import {responseForError} from '../../_lib/http.js';
import {requireShipmentsDatabase} from '../../_lib/shipments.js';

export async function onRequest(context) {
  try {
    requireAdminSameOrigin(context.request);
    context.data.admin = await verifyAdminRequest(context.request, context.env);
    context.data.staff = await resolveStaffIdentity(
      requireShipmentsDatabase(context.env), context.data.admin,
    );
    return await context.next();
  } catch (caught) {
    return responseForError(caught, 'Administrative authentication');
  }
}
