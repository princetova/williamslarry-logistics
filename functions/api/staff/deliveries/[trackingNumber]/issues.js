import {reportDeliveryIssue} from '../../../../_lib/dispatch.js';
import {json, methodNotAllowed, readJson, responseForError} from '../../../../_lib/http.js';
import {requireShipmentsDatabase} from '../../../../_lib/shipments.js';

export async function onRequestPost({request, env, params, data}) {
  try {
    const delivery = await reportDeliveryIssue(
      requireShipmentsDatabase(env), params.trackingNumber, await readJson(request), data.staff,
      {requestId: request.headers.get('CF-Ray')},
    );
    return json(200, {ok: true, delivery});
  } catch (caught) {
    return responseForError(caught, 'Report delivery issue');
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
