# WilliamsLarry Phase 4B: Staff Portal and Dispatch backend

Phase 4B separates administrative and field operations at both the Cloudflare Access application and Pages Functions authorization layers.

- `/admin` and `/api/admin/*`: Owner and Receptionist only.
- `/staff` and `/api/staff/*`: Field Staff only.
- `/api/tracking/*`: unchanged public tracking contract.

The server validates the Access JWT audience for the selected portal and then resolves the immutable Access subject against the active D1 staff account. A valid token for the wrong portal, or a valid identity with the wrong D1 role, is rejected.

## Cloudflare Access configuration

Create two distinct self-hosted Access applications on every approved custom hostname.

### Administrative application

- Protect `/admin`, `/admin/*` and `/api/admin/*`.
- Allow only the Owner and Receptionist identities/groups.
- Store its audience tag as `CF_ACCESS_ADMIN_AUD`.
- `CF_ACCESS_AUD` remains a compatibility fallback during migration, but production should set `CF_ACCESS_ADMIN_AUD` explicitly.

### Staff application

- Protect `/staff`, `/staff/*` and `/api/staff/*`.
- Allow only active Field Staff identities/groups.
- Store its distinct audience tag as `CF_ACCESS_STAFF_AUD`.
- The application fails closed if this variable is missing.

Both applications use the existing `CF_ACCESS_TEAM_DOMAIN` and approved-host list. Do not add `pages.dev` or preview hostnames to `ADMIN_ALLOWED_HOSTS`. Access policies are an outer gate; D1 role and activation checks remain authoritative.

## Secure initial Owner provisioning

1. Create the administrative Access application and restrict its Allow policy to the intended initial Owner.
2. Apply migrations only after approval.
3. Obtain the Owner's signed Access JWT through the protected custom hostname and validate it against the administrative audience.
4. Extract the exact validated `sub` claim. Do not use email as the authorization identifier.
5. Generate a UUID locally and insert the first active `Owner` row into `staff_accounts` through a controlled D1 operation.
6. Record the provisioning event through an approved operational change record. Do not commit the subject, email, JWT or provisioning SQL containing identity values.
7. Confirm `/api/admin/me` returns the provisioned Owner before adding other accounts through the Owner-only API.

The application never exposes an unauthenticated bootstrap endpoint. Until the first Owner row exists, all portal requests fail closed.

## Migration `0003_add_dispatch_workflow.sql`

### Shipment dispatch state

The shipment row gains:

- `assignment_sequence`;
- `last_assignment_event_id` concurrency token;
- assignment acknowledgement timestamp/staff/event token;
- `last_status_event_id` concurrency token;
- `last_issue_event_id` concurrency token.

Assignment or reassignment increments the shipment version and assignment sequence, writes an append-only assignment-history entry, and clears the previous acknowledgement. Unassignment does the same without a new worker.

### `shipment_assignment_acknowledgements`

Append-only acknowledgement records are unique per shipment and assignment event. A worker must acknowledge the current assignment before progress, issue or delay mutations.

### `shipment_delivery_issues`

Append-only operational reports support:

- `Delivery issue`: private operational report; does not change public tracking.
- `Delay`: private operational details plus a required customer-safe public note; atomically changes the shipment to `Delayed` and appends public status history.

Binary proof-of-delivery, GPS and finance data are not part of this migration.

## Concurrency guarantees

Assignment, acknowledgement, status and issue mutations use optimistic shipment versions plus a cryptographically generated event token stored on the winning shipment row. History and audit inserts require that exact event token.

This prevents a losing concurrent request from appending records even when both requests have the same assignee or status target. Reassignment changes the current assignee and event token atomically, so the previous worker cannot update the shipment after the reassignment wins.

## Staff API contract

All responses are JSON with `Cache-Control: no-store`. Mutations require same-origin browser headers and JSON bodies. Success uses `{ "ok": true, ... }`; failures use `{ "ok": false, "message": "..." }`.

### `GET /api/staff/me`

Returns the current active Field Staff account and permission strings. It does not return the Access subject.

### `GET /api/staff/stats`

Returns statistics for current assignments only:

```json
{
  "ok": true,
  "stats": {
    "total": 4,
    "createdLast7Days": 2,
    "overdueActive": 1,
    "awaitingAcknowledgement": 1,
    "byStatus": {"Registered": 1, "Picked up": 1, "In transit": 2}
  }
}
```

### `GET /api/staff/deliveries?page=1&limit=25&status=In%20transit&q=WLL-...`

Returns only shipments currently assigned to the signed-in worker. The list contains tracking reference, receiver name, public route summaries, public item summary, status, estimated delivery, version and acknowledgement state. `limit` is capped at 100.

### `GET /api/staff/deliveries/{trackingNumber}`

Returns the assigned delivery with:

- pickup and delivery contact names, phone numbers and exact operational addresses;
- public item summary, status, estimated delivery and version;
- assignment sequence and acknowledgement state;
- customer-safe tracking history;
- operational issue reports for that shipment.

It never returns shipment `internalNotes`, private administrative item descriptions, administrative audit data, finances or staff-management records. A shipment assigned to another worker returns `403`.

### `POST /api/staff/deliveries/{trackingNumber}/acknowledge`

```json
{"expectedVersion": 2}
```

Acknowledges only the current assignment and increments the shipment version. Duplicate or stale acknowledgements return `409`.

### `POST /api/staff/deliveries/{trackingNumber}/status`

Uses the existing controlled shipment lifecycle:

```json
{
  "expectedVersion": 3,
  "status": "Picked up",
  "publicLocation": "Owerri, Imo State",
  "publicNote": "Parcel collected.",
  "occurredAt": "2026-11-20T14:00:00.000Z"
}
```

The assignment must be acknowledged. Field Staff cannot cancel shipments. Successful updates append the existing public tracking history atomically, so `/api/tracking/{trackingNumber}` reflects the change.
Field Staff status requests cannot set administrative internal notes or change the estimated-delivery date; those fields remain under Owner/Receptionist control.

### `POST /api/staff/deliveries/{trackingNumber}/issues`

Private operational issue:

```json
{
  "expectedVersion": 4,
  "type": "Delivery issue",
  "operationalNote": "Customer requested a later arrival window."
}
```

Customer-visible delay:

```json
{
  "expectedVersion": 5,
  "type": "Delay",
  "operationalNote": "Private operational details.",
  "publicLocation": "Enugu, Enugu State",
  "publicNote": "Delivery is delayed in transit."
}
```

Only delay reports accept public fields. A delay must be a valid transition from the shipment's current status.

## Administrative assignment contract

The existing endpoint remains available only to Owner and Receptionist:

`POST /api/admin/shipments/{trackingNumber}/assignment`

```json
{
  "staffId": "active Field Staff UUID or null",
  "expectedVersion": 6,
  "note": "Optional internal dispatch note"
}
```

- An active Field Staff ID assigns or reassigns.
- `null` unassigns.
- Every change resets acknowledgement and immediately changes worker access.
- Same-target concurrent requests produce one winning assignment/history/audit event.

## Standard errors

| Status | Meaning |
| --- | --- |
| `401` | Missing, invalid or wrong-audience Access JWT |
| `403` | Wrong portal role, deactivated identity, cross-site request or shipment assigned elsewhere |
| `409` | Stale version, missing acknowledgement, duplicate acknowledgement or invalid lifecycle transition |
| `415` | Request is not JSON |
| `422` | Invalid status, issue, filter or request field |
| `503` | Access audience/team-domain, allowed-host or D1 configuration is unavailable |

## Free-tier considerations

- No separate session store: Access JWT plus one indexed D1 staff lookup.
- Staff lists and statistics query indexed `assigned_staff_id` and are paginated.
- Acknowledgements and issue reports write only on operational events, not page views.
- No Durable Objects, Queues, GPS stream, finance ledger or file uploads.
- Future proof-of-delivery binaries remain planned for private R2 rather than D1.

## Production gates

No production action is included in Phase 4B. Before release, approval is required to:

1. apply migration `0003_add_dispatch_workflow.sql`;
2. configure both Access applications and distinct audience variables;
3. verify exact root and wildcard path coverage on every approved hostname;
4. provision/verify the initial Owner and active staff accounts;
5. complete synthetic role-by-role production verification;
6. confirm previous workers lose access immediately after a production reassignment.
