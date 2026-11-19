import {verifyAdminRequest} from '../../_lib/admin-auth.js';
import {responseForError} from '../../_lib/http.js';

export async function onRequest(context) {
  try {
    context.data.admin = await verifyAdminRequest(context.request, context.env);
    return await context.next();
  } catch (caught) {
    return responseForError(caught, 'Administrative authentication');
  }
}
