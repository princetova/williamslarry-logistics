import {error, json, methodNotAllowed, responseForError} from '../../../../_lib/http.js';
import {getAdminHistory, requireShipmentsDatabase} from '../../../../_lib/shipments.js';

export async function onRequestGet({env, params}) {
  try {
    const history = await getAdminHistory(requireShipmentsDatabase(env), params.trackingNumber);
    if (!history) return error(404, 'Shipment not found.');
    return json(200, {ok: true, ...history});
  } catch (caught) {
    return responseForError(caught, 'Get shipment history');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
