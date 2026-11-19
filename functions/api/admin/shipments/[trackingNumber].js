import {error, json, methodNotAllowed, responseForError} from '../../../_lib/http.js';
import {getAdminShipment, requireShipmentsDatabase} from '../../../_lib/shipments.js';

export async function onRequestGet({env, params}) {
  try {
    const shipment = await getAdminShipment(requireShipmentsDatabase(env), params.trackingNumber);
    if (!shipment) return error(404, 'Shipment not found.');
    return json(200, {ok: true, shipment});
  } catch (caught) {
    return responseForError(caught, 'Get shipment');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
