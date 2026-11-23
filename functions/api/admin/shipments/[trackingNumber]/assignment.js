import {json, methodNotAllowed, readJson, responseForError} from '../../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../../_lib/shipments.js';
import {assignShipment} from '../../../../_lib/staff.js';

export async function onRequestPost({request, env, params, data}) {
  try {
    const shipment = await assignShipment(
      requireShipmentsDatabase(env), params.trackingNumber, await readJson(request), data.staff,
      {requestId: request.headers.get('CF-Ray')},
    );
    return json(200, {ok: true, shipment});
  } catch (caught) {
    return responseForError(caught, 'Update shipment assignment');
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
