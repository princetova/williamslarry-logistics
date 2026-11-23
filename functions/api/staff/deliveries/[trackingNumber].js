import {getAssignedDelivery} from '../../../_lib/dispatch.js';
import {json, methodNotAllowed, responseForError} from '../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../_lib/shipments.js';

export async function onRequestGet({env, params, data}) {
  try {
    const delivery = await getAssignedDelivery(
      requireShipmentsDatabase(env), params.trackingNumber, data.staff,
    );
    return json(200, {ok: true, delivery});
  } catch (caught) {
    return responseForError(caught, 'Get assigned delivery');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
