import {error, json, methodNotAllowed, responseForError} from '../../_lib/http.js';
import {enforceTrackingRateLimit} from '../../_lib/rate-limit.js';
import {getPublicTracking, requireShipmentsDatabase} from '../../_lib/shipments.js';

export async function onRequestGet({request, env, params}) {
  try {
    const db = requireShipmentsDatabase(env);
    await enforceTrackingRateLimit(request, env);
    const shipment = await getPublicTracking(db, params.trackingNumber);
    if (!shipment) return error(404, 'No shipment was found for that tracking number.');
    return json(200, {ok: true, shipment});
  } catch (caught) {
    return responseForError(caught, 'Public shipment lookup');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
