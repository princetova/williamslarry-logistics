import {error, json, methodNotAllowed, responseForError} from '../../../_lib/http.js';
import {requireShipmentAccess} from '../../../_lib/authorization.js';
import {getAdminShipment, requireShipmentsDatabase} from '../../../_lib/shipments.js';

export async function onRequestGet({env, params, data}) {
  try {
    const db = requireShipmentsDatabase(env);
    await requireShipmentAccess(db, data.staff, params.trackingNumber);
    const shipment = await getAdminShipment(db, params.trackingNumber);
    if (!shipment) return error(404, 'Shipment not found.');
    return json(200, {ok: true, shipment});
  } catch (caught) {
    return responseForError(caught, 'Get shipment');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
