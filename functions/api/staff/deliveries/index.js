import {listAssignedDeliveries} from '../../../_lib/dispatch.js';
import {json, methodNotAllowed, responseForError} from '../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../_lib/shipments.js';

export async function onRequestGet({request, env, data}) {
  try {
    const result = await listAssignedDeliveries(
      requireShipmentsDatabase(env), new URL(request.url).searchParams, data.staff,
    );
    return json(200, {ok: true, ...result});
  } catch (caught) {
    return responseForError(caught, 'List assigned deliveries');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
