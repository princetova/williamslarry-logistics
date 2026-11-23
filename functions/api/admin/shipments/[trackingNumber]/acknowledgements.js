import {getAcknowledgementHistory} from '../../../../_lib/admin-portal.js';
import {requirePermission} from '../../../../_lib/authorization.js';
import {json, methodNotAllowed, responseForError} from '../../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../../_lib/shipments.js';

export async function onRequestGet({request, env, params, data}) {
  try {
    requirePermission(data.staff, 'shipments.read.all');
    const result = await getAcknowledgementHistory(
      requireShipmentsDatabase(env), params.trackingNumber, new URL(request.url).searchParams,
    );
    return json(200, {ok: true, ...result});
  } catch (caught) {
    return responseForError(caught, 'Get shipment acknowledgement history');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
