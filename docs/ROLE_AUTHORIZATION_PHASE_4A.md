# WilliamsLarry Phase 4A: role-based authorization

> Phase 4B supersedes the Field Staff portions of this contract: Field Staff now use `/staff` and `/api/staff/*`, while `/admin` and `/api/admin/*` are restricted to Owner and Receptionist roles.

Phase 4A keeps Cloudflare Access as the identity provider and D1 as the authorization source of truth. Access proves who the person is; the `staff_accounts` row determines whether that identity is active and what it may do. The immutable Access `sub` claim is the account key. Email addresses are descriptive and are never used as authorization keys.

Every `/admin` and `/api/admin/*` request must pass, in order:

1. approved-host enforcement (including rejection of `pages.dev` and preview hosts);
2. signed Cloudflare Access JWT verification;
3. active staff-account lookup by Access subject;
4. role permission and, where applicable, shipment-assignment enforcement.

Unknown and deactivated staff fail closed with `403`. Missing Access or D1 configuration fails closed. Administrative mutations additionally require same-origin browser headers.

## Permission matrix

| Capability | Owner | Receptionist | Field Staff |
| --- | --- | --- | --- |
| Enter protected portal shell | Yes | Yes | Yes |
| View own identity and permissions | Yes | Yes | Yes |
| Register a shipment | Yes | Yes | No |
| List/search shipments | All | All | Assigned only |
| View private shipment details/history | All | All | Assigned only |
| Update shipment status | All valid transitions | All valid transitions | Assigned only; cannot cancel |
| Assign/reassign/unassign Field Staff | Yes | Yes | No |
| View dashboard statistics | All shipments | All shipments | Assigned only |
| Create, activate, deactivate or change staff roles | Yes | No | No |
| View administrative audit records | Yes | No | No |

The final active Owner cannot be deactivated or demoted. Access subjects cannot be changed after account creation.

## Database migration

Migration `0002_add_staff_authorization.sql` adds:

### `staff_accounts`

- unique immutable `access_subject` from Cloudflare Access;
- unique case-insensitive email, display name and role;
- active/deactivated state;
- optimistic-concurrency `version`;
- creation, modification and deactivation attribution.

### Shipment assignment

- nullable `shipments.assigned_staff_id` points to the currently assigned staff account;
- indexed by assigned staff and update time for inexpensive Field Staff queries;
- assignment changes increment the existing shipment version;
- `shipment_assignment_history` records every assignment, reassignment and unassignment;
- database triggers make assignment history append-only.

Assignment, history and audit writes are issued in one D1 batch. Conditional inserts verify both the new shipment version and winning assignee so concurrent updates cannot create misleading history.

### Audit extension

`administrative_audit_records` gains `actor_staff_id` and `actor_role`. Existing actor subject/email fields remain for forensic continuity. Staff creation, staff changes and assignment changes use the existing append-only audit table. Audit details contain operational identifiers and state changes, not customer contact payloads.

## API contract

All endpoints below:

- are same-origin under `/api/admin`;
- require a valid Access JWT and active staff account;
- return `Cache-Control: no-store` JSON;
- use `{ "ok": true, ... }` on success and `{ "ok": false, "message": "..." }` on failure;
- use `expectedVersion` for conflicting staff, assignment and shipment mutations.

### Current staff

#### `GET /api/admin/me`

All active roles. Returns the current staff ID, email, display name, role, active state, version and explicit permission strings. It does not return the Access subject.

```json
{
  "ok": true,
  "staff": {
    "id": "staff UUID",
    "email": "staff@example.com",
    "displayName": "Staff Name",
    "role": "Field Staff",
    "active": true,
    "version": 1,
    "permissions": ["shipments.read.assigned", "shipments.status.assigned", "stats.assigned"]
  }
}
```

### Staff administration (Owner only)

#### `GET /api/admin/staff?page=1&limit=25&role=Field%20Staff&active=true&q=name`

Returns `{page, limit, total, items}`. `limit` is capped at 100.

#### `POST /api/admin/staff`

```json
{
  "accessSubject": "immutable Cloudflare Access subject",
  "email": "staff@example.com",
  "displayName": "Staff Name",
  "role": "Owner | Receptionist | Field Staff"
}
```

Creates an active account and returns `201 {ok, staff}`. Duplicate Access subjects or email addresses return `409`.

#### `GET /api/admin/staff/{staffId}`

Returns `{ok, staff}` or `404`.

#### `POST /api/admin/staff/{staffId}`

Updates only supplied mutable fields:

```json
{
  "expectedVersion": 1,
  "displayName": "Updated Name",
  "email": "updated@example.com",
  "role": "Receptionist",
  "active": true
}
```

The Access subject is immutable. Stale versions and final-owner protection return `409`.

### Shipment APIs with role scope

The existing shipment contract remains in `SHIPMENT_TRACKING_PHASE_3A.md`, with these authorization changes:

- `GET /api/admin/shipments`: Owner/Receptionist receive all matching shipments; Field Staff receive only current assignments.
- `POST /api/admin/shipments`: Owner/Receptionist only.
- `GET /api/admin/shipments/{trackingNumber}`: Field Staff require current assignment.
- `GET /api/admin/shipments/{trackingNumber}/history`: Field Staff require current assignment.
- `POST /api/admin/shipments/{trackingNumber}/status`: Field Staff require current assignment and cannot transition to `Cancelled`.
- `GET /api/admin/stats`: Field Staff statistics include assigned shipments only.

Administrative shipment details now include:

```json
{
  "assignedStaff": {
    "id": "staff UUID",
    "displayName": "Staff Name",
    "email": "staff@example.com"
  }
}
```

`assignedStaff` is `null` when unassigned. The public tracking API is unchanged and never exposes assignment or staff information.

#### `POST /api/admin/shipments/{trackingNumber}/assignment`

Owner or Receptionist only.

```json
{
  "staffId": "active Field Staff UUID or null",
  "expectedVersion": 3,
  "note": "Optional internal assignment note"
}
```

`staffId: null` unassigns the shipment. Only active Field Staff accounts can be assigned. Returns `{ok, shipment}` with an incremented shipment version. Stale versions or unchanged assignments return `409`.

### Audit records (Owner only)

#### `GET /api/admin/audit?page=1&limit=50&action=shipment.created&resourceType=shipment`

Returns paginated append-only audit metadata. `limit` is capped at 100. This endpoint does not return shipment customer fields.

## Standard failure responses

| Status | Meaning |
| --- | --- |
| `401` | Missing or invalid Access authentication |
| `403` | Inactive, unprovisioned or insufficiently privileged staff identity; or assignment scope failure |
| `404` | Requested staff account or shipment does not exist after authorization |
| `409` | Version conflict, final-owner protection, duplicate account or unchanged assignment |
| `415` | Request is not JSON |
| `422` | Invalid field, filter, role, assignee or payload |
| `503` | Required Access or D1 configuration is missing/unavailable |

## Initial Owner provisioning

The first Owner must be inserted through a controlled infrastructure operation after the migration is approved and applied. Use the exact Cloudflare Access `sub` for the individual owner, a generated UUID, and the owner's business email. Do not commit the subject, email or provisioning SQL to Git. After the first Owner signs in, all later staff accounts can be managed through the Owner-only API.

Cloudflare Access policies still decide which identities may reach the application. D1 activation is an additional server-side gate, not a replacement for Access.

## Cloudflare free-tier design

- one indexed D1 staff lookup per protected request; no session database or per-request heartbeat writes;
- assignment filtering uses an indexed shipment column rather than scanning assignment history;
- all lists are paginated and capped at 100 rows;
- Access JWKS remains cached in the Worker isolate for one hour;
- static portal assets remain Pages assets behind Functions middleware;
- no Durable Objects, Queues or additional paid services are required for Phase 4A.

## Future proof-of-delivery boundary

Phase 4A does not store proof-of-delivery files. A later phase can add an R2 binding for file objects and a small D1 metadata table containing shipment ID, assignment/history reference, object key, media type, size, checksum, uploader staff ID and timestamps. Upload authorization must require an active Field Staff assignment (or Owner override), and the object must never be publicly addressable. Keeping binary data in R2 rather than D1 preserves D1 capacity and query performance.

## Local verification and production gates

Local regression command:

```powershell
npm test
```

Before any production release, approval is still required to:

1. apply migration `0002_add_staff_authorization.sql` to `wll-shipments`;
2. provision the initial Owner by exact Access subject;
3. verify `SHIPMENTS_DB`, Access audience/team-domain and allowed-host variables in production;
4. confirm Access protects portal assets and `/api/admin/*` on every approved hostname;
5. perform role-by-role production checks with synthetic shipments.
