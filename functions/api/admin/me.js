import {json, methodNotAllowed} from '../../_lib/http.js';
import {publicStaff} from '../../_lib/authorization.js';

export function onRequestGet({data}) {
  return json(200, {ok: true, staff: publicStaff(data.staff)});
}

export function onRequest() {
  return methodNotAllowed('GET');
}
