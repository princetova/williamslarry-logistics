import {getStaffDashboardStats} from '../../_lib/dispatch.js';
import {json, methodNotAllowed, responseForError} from '../../_lib/http.js';
import {requireShipmentsDatabase} from '../../_lib/shipments.js';

export async function onRequestGet({env, data}) {
  try {
    const stats = await getStaffDashboardStats(requireShipmentsDatabase(env), data.staff);
    return json(200, {ok: true, stats});
  } catch (caught) {
    return responseForError(caught, 'Get staff delivery statistics');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
