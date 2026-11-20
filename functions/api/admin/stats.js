import {json, methodNotAllowed, responseForError} from '../../_lib/http.js';
import {getAdminDashboardStats} from '../../_lib/admin-portal.js';
import {requirePermission} from '../../_lib/authorization.js';
import {requireShipmentsDatabase} from '../../_lib/shipments.js';

export async function onRequestGet({env, data}) {
  try {
    requirePermission(data.staff, 'stats.all');
    const stats = await getAdminDashboardStats(requireShipmentsDatabase(env));
    return json(200, {ok: true, stats});
  } catch (caught) {
    return responseForError(caught, 'Get shipment statistics');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
