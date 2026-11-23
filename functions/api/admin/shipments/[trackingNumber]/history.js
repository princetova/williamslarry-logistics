import {error, json, methodNotAllowed, responseForError} from '../../../../_lib/http.js';
import {requireShipmentAccess} from '../../../../_lib/authorization.js';
import {getAdminHistory, requireShipmentsDatabase} from '../../../../_lib/shipments.js';

export async function onRequestGet({env, params, data}) {
  try {
    const db = requireShipmentsDatabase(env);
    await requireShipmentAccess(db, data.staff, params.trackingNumber);
    const history = await getAdminHistory(db, params.trackingNumber);
    if (!history) return error(404, 'Shipment not found.');
    return json(200, {ok: true, ...history});
  } catch (caught) {
    return responseForError(caught, 'Get shipment history');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
