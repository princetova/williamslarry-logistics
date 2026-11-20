# Phase 4C frontend integration contract: Premium Admin Portal

This document defines the existing backend contract available to the future Phase 4C frontend. It does not prescribe visual design and does not authorize frontend implementation.

## Authentication and session rules

- All portal requests are same-origin and use the Cloudflare Access application session.
- The administrative frontend must call only `/api/admin/*`.
- Owner and Receptionist are the only roles accepted by the administrative middleware.
- Field Staff use `/staff` and `/api/staff/*` and are rejected from the administrative namespace.
- Do not store JWTs, customer records or administrative responses in `localStorage`, `sessionStorage`, IndexedDB or client-readable cookies.
- Every API response uses `Cache-Control: no-store`.
- A `401` or `403` must clear rendered private data and present a reload/sign-in state.
- A `409` means the displayed record is stale; reload the latest server record before allowing another mutation.

## Role-aware navigation

### `GET /api/admin/me`

Call this before rendering role-sensitive navigation.

```json
{
  "ok": true,
  "staff": {
    "id": "staff UUID",
    "email": "owner@example.com",
    "displayName": "Owner Name",
    "role": "Owner",
    "active": true,
    "version": 1,
    "permissions": [
      "staff.manage",
      "audit.view",
      "shipments.create",
      "shipments.read.all",
      "shipments.status.all",
      "shipments.assign",
      "stats.all"
    ]
  }
}
```

Navigation rules:

| Portal section | Owner | Receptionist |
| --- | --- | --- |
| Overview | Show | Show |
| Shipments | Show | Show |
| Register shipment | Show | Show |
| Dispatch Centre | Show | Show |
| Delivery monitoring | Show | Show |
| Staff Management | Show | Hide |
| Audit Logs | Show | Hide |

The frontend hiding a section is only presentation. The server remains authoritative and returns `403` for unauthorized calls.

## 1. Overview

### `GET /api/admin/stats`

```json
{
  "ok": true,
  "stats": {
    "total": 120,
    "createdLast7Days": 18,
    "overdueActive": 4,
    "unassignedActive": 7,
    "pendingAcknowledgements": 3,
    "openDeliveryIssues": 2,
    "byStatus": {
      "Registered": 10,
      "Picked up": 8,
      "In transit": 25,
      "Arrived at destination": 6,
      "Out for delivery": 9,
      "Delivered": 55,
      "Delayed": 4,
      "Cancelled": 2,
      "Returned": 1
    },
    "staffWorkload": [
      {
        "staff": {"id": "staff UUID", "displayName": "Worker Name"},
        "activeAssigned": 6,
        "pendingAcknowledgements": 1,
        "delayed": 1
      }
    ]
  }
}
```

`unassignedActive`, `pendingAcknowledgements` and workload counts exclude terminal shipments (`Delivered`, `Cancelled`, `Returned`). `openDeliveryIssues` counts append-only issue reports without a corresponding append-only resolution. Only active Field Staff appear in `staffWorkload`. Time-series analytics are not supplied.

## 2. Shipment registration

### `POST /api/admin/shipments`

```json
{
  "senderName": "Sender Name",
  "senderPhone": "+234...",
  "receiverName": "Receiver Name",
  "receiverPhone": "+234...",
  "originAddress": "Private exact pickup address",
  "originPublic": "City, State",
  "destinationAddress": "Private exact delivery address",
  "destinationPublic": "City, State",
  "itemDescription": "Private administrative item description",
  "publicItemSummary": "Customer-safe item summary",
  "estimatedDeliveryDate": "2026-11-30",
  "internalNotes": "Optional administrator-only note",
  "publicNote": "Optional customer-visible registration note"
}
```

Returns `201 {ok, shipment}`. The generated `shipment.trackingNumber` is the only valid tracking reference and must be displayed exactly as returned. Never fabricate or predict a reference client-side.

## 3. Shipment search, filtering and details

### `GET /api/admin/shipments?page=1&limit=25&status=In%20transit&q=WLL-...&assignedStaffId={id}&assignment=pending`

- `page`: positive integer.
- `limit`: 1–100.
- `status`: exact lifecycle status.
- `q`: searches tracking reference, customer names/phones and public route summaries.
- `assignedStaffId`: exact current Field Staff UUID.
- `assignment`: `unassigned`, `pending` or `acknowledged`.

Response:

```json
{
  "ok": true,
  "page": 1,
  "limit": 25,
  "total": 1,
  "items": [
    {
      "id": "shipment UUID",
      "trackingNumber": "WLL-...",
      "senderName": "Sender",
      "receiverName": "Receiver",
      "origin": "Owerri, Imo State",
      "destination": "Lagos, Lagos State",
      "itemSummary": "One parcel",
      "currentStatus": "In transit",
      "estimatedDeliveryDate": "2026-11-30",
      "assignedStaff": {
        "id": "staff UUID",
        "displayName": "Worker Name",
        "active": true
      },
      "assignmentSequence": 2,
      "assignmentAcknowledgedAt": "ISO timestamp or null",
      "version": 4,
      "createdAt": "ISO timestamp",
      "updatedAt": "ISO timestamp"
    }
  ]
}
```

### `GET /api/admin/shipments/{trackingNumber}`

Returns full administrative shipment details, including private customer information, `internalNotes`, current assignment, assignment sequence, acknowledgement time and optimistic-concurrency version.

```json
{
  "ok": true,
  "shipment": {
    "trackingNumber": "WLL-...",
    "sender": {"name": "Sender", "phone": "+234..."},
    "receiver": {"name": "Receiver", "phone": "+234..."},
    "origin": {"address": "Exact address", "publicSummary": "City, State"},
    "destination": {"address": "Exact address", "publicSummary": "City, State"},
    "itemDescription": "Private description",
    "publicItemSummary": "Customer-safe summary",
    "currentStatus": "In transit",
    "estimatedDeliveryDate": "2026-11-30",
    "internalNotes": "Administrator-only note",
    "assignedStaff": {
      "id": "staff UUID",
      "displayName": "Worker Name",
      "email": "worker@example.com"
    },
    "assignmentSequence": 2,
    "assignmentAcknowledgedAt": "ISO timestamp or null",
    "version": 4,
    "createdAt": "ISO timestamp",
    "updatedAt": "ISO timestamp"
  }
}
```

### `GET /api/admin/shipments/{trackingNumber}/history`

Returns chronological status history. Administrative history includes internal status notes and actor identity, so it must never be rendered in a public/customer context.

### `POST /api/admin/shipments/{trackingNumber}/status`

```json
{
  "expectedVersion": 4,
  "status": "Arrived at destination",
  "publicLocation": "Lagos, Lagos State",
  "publicNote": "Shipment arrived at the destination facility.",
  "internalNote": "Optional administrative note",
  "estimatedDeliveryDate": "2026-12-01",
  "occurredAt": "Optional ISO timestamp"
}
```

Only server-approved lifecycle transitions succeed. A successful update increments `version` and synchronizes the existing public tracking history.

## 4. Dispatch Centre

### Load active workers

`GET /api/admin/dispatch/workers?page=1&limit=25&q=name`

Available to Owner and Receptionist. It returns only active Field Staff and intentionally omits email, Access subject and staff-management fields.

```json
{
  "ok": true,
  "page": 1,
  "limit": 25,
  "total": 1,
  "items": [
    {
      "id": "staff UUID",
      "displayName": "Worker Name",
      "workload": {
        "activeAssigned": 6,
        "pendingAcknowledgements": 1,
        "delayed": 1
      }
    }
  ]
}
```

### Assign, reassign or unassign

`POST /api/admin/shipments/{trackingNumber}/assignment`

```json
{
  "staffId": "active Field Staff UUID or null",
  "expectedVersion": 4,
  "note": "Optional internal dispatch note"
}
```

- Field Staff UUID: assign/reassign.
- `null`: unassign.
- Success increments shipment `version` and `assignmentSequence`.
- Any assignment change resets `assignmentAcknowledgedAt` to `null`.
- Reload shipment details after every success or `409`.

## 5. Assignment acknowledgement monitoring

Shipment detail and shipment-list rows supply:

- `assignedStaff`;
- `assignmentSequence`;
- `assignmentAcknowledgedAt`.

`null` means the current assignment has not been acknowledged. A timestamp means the currently assigned worker acknowledged it.

### Assignment history

`GET /api/admin/shipments/{trackingNumber}/assignments?page=1&limit=25`

```json
{
  "ok": true,
  "trackingNumber": "WLL-...",
  "page": 1,
  "limit": 25,
  "total": 2,
  "items": [
    {
      "id": "assignment event UUID",
      "previousStaff": {"id": "staff UUID", "displayName": "Previous Worker"},
      "assignedStaff": {"id": "staff UUID", "displayName": "Current Worker"},
      "assignedBy": {"id": "staff UUID", "displayName": "Dispatcher"},
      "note": "Optional dispatch note",
      "assignedAt": "ISO timestamp"
    }
  ]
}
```

Any staff field may be `null` where the event represents an initial assignment, unassignment, or a historical identity without a current matching staff row.

### Acknowledgement history

`GET /api/admin/shipments/{trackingNumber}/acknowledgements?page=1&limit=25`

Each item contains `id`, `assignmentEventId`, `staff: {id, displayName}` and `acknowledgedAt`. Both history endpoints are Owner/Receptionist only and omit email, Access subject and customer details.

## 6. Delivery status and issue monitoring

Status monitoring is available through shipment list/detail and status history.

### List delivery issues

`GET /api/admin/issues?page=1&limit=25&state=open&type=Delay&trackingNumber=WLL-...&reportedByStaffId={id}&from=2026-11-01&to=2026-11-30`

- `state`: `open` or `resolved`.
- `type`: `Delay` or `Delivery issue`.
- `trackingNumber`: exact validated tracking number.
- `reportedByStaffId`: exact staff UUID.
- `from` / `to`: ISO date or date-time; dates cover the full UTC day.

Each issue item contains `id`, `type`, `trackingNumber`, `shipmentStatus`, safe public `route`, `reportedBy: {id, displayName}`, `publicLocation`, `publicNote`, private operational `operationalNote`, timestamps and either `resolution: null` or:

```json
{
  "id": "resolution UUID",
  "note": "Resolution note",
  "resolvedAt": "ISO timestamp",
  "resolvedBy": {"id": "staff UUID", "displayName": "Administrator"}
}
```

Issue responses never contain customer phone numbers, exact private addresses, staff email/Access subject, shipment internal notes or administrative audit data.

### Issue detail and resolution

- `GET /api/admin/issues/{issueId}` returns `{ok, issue}` with the same safe projection.
- `POST /api/admin/issues/{issueId}/resolve` accepts `{"resolutionNote":"Required text"}`.

Issue reports remain append-only. Resolution creates a separate append-only record and an audit record atomically. A duplicate or concurrent resolution returns `409`; reload the issue before continuing. Reopening is not supported.

Do not attempt to call `/api/staff/*` from the Admin Portal; the separate Access audience and D1 role checks intentionally reject Owner and Receptionist identities.

## 7. Staff Management — Owner only

### List/search

`GET /api/admin/staff?page=1&limit=25&role=Field%20Staff&active=true&q=name`

### Create

`POST /api/admin/staff`

```json
{
  "accessSubject": "validated immutable Access subject",
  "email": "staff@example.com",
  "displayName": "Staff Name",
  "role": "Owner | Receptionist | Field Staff"
}
```

### Detail

`GET /api/admin/staff/{staffId}`

### Update, activate or deactivate

`POST /api/admin/staff/{staffId}`

```json
{
  "expectedVersion": 1,
  "displayName": "Updated Name",
  "email": "updated@example.com",
  "role": "Receptionist",
  "active": false
}
```

Only supplied mutable fields change. The Access subject is immutable, and the final active Owner cannot be demoted or deactivated. There is no account-deletion endpoint.

## 8. Audit Logs — Owner only

`GET /api/admin/audit?page=1&limit=50&action=shipment.created&resourceType=shipment&actorStaffId={id}&from=2026-11-01&to=2026-11-30`

Returns paginated append-only audit metadata with actor, action, resource, request ID, structured details and creation time. `action`, `resourceType` and `actorStaffId` are exact filters. `from` and `to` accept ISO dates or date-times; date-only `to` includes the complete UTC day. Audit access and all filters remain Owner only. Free-text audit search is not implemented.

## Mutation UX contract

For registration, status, assignment, issue resolution and staff mutations:

1. Disable duplicate submission while a request is pending.
2. Keep the version supplied by the latest server response.
3. On network uncertainty, reload before retrying because the server may have committed the mutation.
4. On `409`, discard the stale local representation and reload.
5. Render server messages as plain text, never HTML.
6. Never optimistically invent status, assignment or tracking-reference values.

## Remaining backend limitations affecting Phase 4C

1. There is intentionally no bulk assignment, bulk status mutation or bulk issue resolution. Every shipment mutation retains individual version/concurrency control.
2. Issue resolution is final; reopening or threaded issue comments are not implemented.
3. Time-series dashboard analytics are not implemented.
4. There are no finance, GPS or proof-of-delivery APIs.
5. The `/staff` visual frontend has not been implemented; only its protected backend routes and contract exist.

Do not work around these boundaries client-side or weaken server authorization.

## Shared validation and pagination

All Phase 4C.1 list/history endpoints return `page`, `limit`, `total` and `items`. `page` must be an integer from 1 to 10000; `limit` must be an integer from 1 to 100. Invalid pagination, filters, tracking references and date ranges return `422`. Administrative routes require the production admin hostname, configured Access audience, an active D1 staff identity, and an Owner or Receptionist role. Audit and Staff Management remain Owner only.
