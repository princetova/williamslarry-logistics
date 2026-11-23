import {getDeliveryIssue} from '../../../_lib/admin-portal.js';
import {requirePermission} from '../../../_lib/authorization.js';
import {HttpError, json, methodNotAllowed, responseForError} from '../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../_lib/shipments.js';

export async function onRequestGet({env, params, data}) {
  try {
    requirePermission(data.staff, 'shipments.read.all');
    const issue = await getDeliveryIssue(requireShipmentsDatabase(env), params.issueId);
    if (!issue) throw new HttpError(404, 'Delivery issue not found.');
    return json(200, {ok: true, issue});
  } catch (caught) {
    return responseForError(caught, 'Get delivery issue');
  }
}

export function onRequest() {
  return methodNotAllowed('GET');
}
