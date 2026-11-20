import {listDispatchWorkers} from '../../../_lib/admin-portal.js';
import {requirePermission} from '../../../_lib/authorization.js';
import {json, methodNotAllowed, responseForError} from '../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../_lib/shipments.js';

export async function onRequestGet({request, env, data}) {
  try {
    requirePermission(data.staff, 'shipments.assign');
    const result = await listDispatchWorkers(
      requireShipmentsDatabase(env), new URL(request.url).searchParams,
    );
    return json(200, {ok: true, ...result});
  } catch (caught) {
    return responseForError(caught, 'List dispatch workers');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
