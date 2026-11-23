import {requirePermission} from '../../../_lib/authorization.js';
import {error, json, methodNotAllowed, readJson, responseForError} from '../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../_lib/shipments.js';
import {getStaffAccount, updateStaffAccount} from '../../../_lib/staff.js';

export async function onRequestGet({env, params, data}) {
  try {
    requirePermission(data.staff, 'staff.manage');
    const account = await getStaffAccount(requireShipmentsDatabase(env), params.staffId);
    if (!account) return error(404, 'Staff account not found.');
    return json(200, {ok: true, staff: account});
  } catch (caught) {
    return responseForError(caught, 'Get staff account');
  }
}

export async function onRequestPost({request, env, params, data}) {
  try {
    const account = await updateStaffAccount(
      requireShipmentsDatabase(env), params.staffId, await readJson(request), data.staff,
      {requestId: request.headers.get('CF-Ray')},
    );
    return json(200, {ok: true, staff: account});
  } catch (caught) {
    return responseForError(caught, 'Update staff account');
  }
}

export function onRequest() {
  return methodNotAllowed('GET, POST');
}
