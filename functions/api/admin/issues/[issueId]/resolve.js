import {resolveDeliveryIssue} from '../../../../_lib/admin-portal.js';
import {requirePermission} from '../../../../_lib/authorization.js';
import {json, methodNotAllowed, readJson, responseForError} from '../../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../../_lib/shipments.js';

export async function onRequestPost({request, env, params, data}) {
  try {
    requirePermission(data.staff, 'shipments.status.all');
    const issue = await resolveDeliveryIssue(
      requireShipmentsDatabase(env), params.issueId, await readJson(request), data.staff,
      {requestId: request.headers.get('CF-Ray')},
    );
    return json(200, {ok: true, issue});
  } catch (caught) {
    return responseForError(caught, 'Resolve delivery issue');
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
