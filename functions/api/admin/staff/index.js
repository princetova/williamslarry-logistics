import {requirePermission} from '../../../_lib/authorization.js';
import {json, methodNotAllowed, readJson, responseForError} from '../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../_lib/shipments.js';
import {createStaffAccount, listStaffAccounts} from '../../../_lib/staff.js';

export async function onRequestGet({request, env, data}) {
  try {
    requirePermission(data.staff, 'staff.manage');
    const result = await listStaffAccounts(
      requireShipmentsDatabase(env), new URL(request.url).searchParams,
    );
    return json(200, {ok: true, ...result});
  } catch (caught) {
    return responseForError(caught, 'List staff accounts');
  }
}

export async function onRequestPost({request, env, data}) {
  try {
    const account = await createStaffAccount(
      requireShipmentsDatabase(env), await readJson(request), data.staff,
      {requestId: request.headers.get('CF-Ray')},
    );
    return json(201, {ok: true, staff: account});
  } catch (caught) {
    return responseForError(caught, 'Create staff account');
  }
}

export function onRequest() {
  return methodNotAllowed('GET, POST');
}
