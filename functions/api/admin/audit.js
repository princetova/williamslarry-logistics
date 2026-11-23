import {requirePermission} from '../../_lib/authorization.js';
import {json, methodNotAllowed, responseForError} from '../../_lib/http.js';
import {requireShipmentsDatabase} from '../../_lib/shipments.js';
import {listAuditRecords} from '../../_lib/staff.js';

export async function onRequestGet({request, env, data}) {
  try {
    requirePermission(data.staff, 'audit.view');
    const result = await listAuditRecords(
      requireShipmentsDatabase(env), new URL(request.url).searchParams,
    );
    return json(200, {ok: true, ...result});
  } catch (caught) {
    return responseForError(caught, 'List audit records');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
