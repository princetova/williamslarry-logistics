import {json, methodNotAllowed, readJson, responseForError} from '../../../../_lib/http.js';
import {requireShipmentAccess} from '../../../../_lib/authorization.js';
import {requireShipmentsDatabase, updateShipmentStatus} from '../../../../_lib/shipments.js';

export async function onRequestPost({request, env, params, data}) {
  try {
    const db = requireShipmentsDatabase(env);
    await requireShipmentAccess(db, data.staff, params.trackingNumber, 'status');
    const input = await readJson(request);
    const shipment = await updateShipmentStatus(
      db, params.trackingNumber, input, data.staff,
      {requestId: request.headers.get('CF-Ray')},
    );
    return json(200, {ok: true, shipment});
  } catch (caught) {
    return responseForError(caught, 'Update shipment status');
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
