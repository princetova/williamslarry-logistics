import {json, methodNotAllowed, responseForError} from '../../_lib/http.js';
import {getDashboardStats, requireShipmentsDatabase} from '../../_lib/shipments.js';

export async function onRequestGet({env}) {
  try {
    const stats = await getDashboardStats(requireShipmentsDatabase(env));
    return json(200, {ok: true, stats});
  } catch (caught) {
    return responseForError(caught, 'Get shipment statistics');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
