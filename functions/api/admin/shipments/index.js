import {json, methodNotAllowed, readJson, responseForError} from '../../../_lib/http.js';
import {requirePermission, shipmentScope} from '../../../_lib/authorization.js';
import {createShipment, listShipments, requireShipmentsDatabase} from '../../../_lib/shipments.js';

export async function onRequestPost({request, env, data}) {
  try {
    const db = requireShipmentsDatabase(env);
    requirePermission(data.staff, 'shipments.create');
    const input = await readJson(request);
    const shipment = await createShipment(db, input, data.staff, {
      requestId: request.headers.get('CF-Ray'),
    });
    return json(201, {ok: true, shipment});
  } catch (caught) {
    return responseForError(caught, 'Create shipment');
  }
}

export async function onRequestGet({request, env, data}) {
  try {
    const db = requireShipmentsDatabase(env);
    const result = await listShipments(
      db, new URL(request.url).searchParams, shipmentScope(data.staff),
    );
    return json(200, {ok: true, ...result});
  } catch (caught) {
    return responseForError(caught, 'List shipments');
  }
}

export function onRequest() {
  return methodNotAllowed('GET, POST');
}
