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
    }
  }
}
```

Supported today: total, seven-day registrations, overdue active shipments and lifecycle distribution.

Not yet supplied: unassigned count, awaiting-acknowledgement count, open-issue count, staff workload or time-series analytics.

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

### `GET /api/admin/shipments?page=1&limit=25&status=In%20transit&q=WLL-...`

- `page`: positive integer.
- `limit`: 1–100.
- `status`: exact lifecycle status.
- `q`: searches tracking reference, customer names/phones and public route summaries.

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

`GET /api/admin/staff?role=Field%20Staff&active=true&page=1&limit=100`

Owner only under the current Phase 4A permission matrix. This is a backend limitation for a Receptionist-operated Dispatch Centre; see limitations below.

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

Current shipment detail supplies:

- `assignedStaff`;
- `assignmentSequence`;
- `assignmentAcknowledgedAt`.

`null` means the current assignment has not been acknowledged. A timestamp means the currently assigned worker acknowledged it.

The shipment list does not currently return assignment or acknowledgement fields, and the statistics endpoint does not return an awaiting-acknowledgement count. A dispatch-wide acknowledgement board therefore requires additional backend work or one detail request per shipment, which is not recommended for Cloudflare free-tier efficiency.

## 6. Delivery status and issue monitoring

Status monitoring is available through shipment list/detail and status history.

Current backend limitation: there is no administrative endpoint for `shipment_delivery_issues`, acknowledgement history or assignment history. Private issue reports are stored and audited, but the Premium Admin Portal cannot yet retrieve them through `/api/admin/*`.

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

`GET /api/admin/audit?page=1&limit=50&action=shipment.created&resourceType=shipment`

Returns paginated append-only audit metadata with actor, action, resource, request ID, structured details and creation time. Current filters are exact `action` and `resourceType`; actor, date-range and free-text filters are not implemented.

## Mutation UX contract

For registration, status, assignment and staff mutations:

1. Disable duplicate submission while a request is pending.
2. Keep the version supplied by the latest server response.
3. On network uncertainty, reload before retrying because the server may have committed the mutation.
4. On `409`, discard the stale local representation and reload.
5. Render server messages as plain text, never HTML.
6. Never optimistically invent status, assignment or tracking-reference values.

## Backend limitations affecting Phase 4C

1. Receptionists can assign by known staff UUID, but `GET /api/admin/staff` is Owner-only. A Receptionist Dispatch Centre cannot safely populate its worker selector until a limited active-Field-Staff directory endpoint is added.
2. Shipment list rows do not include assignee, assignment sequence or acknowledgement state.
3. Dashboard statistics do not include unassigned, awaiting acknowledgement, open issues or worker workload.
4. No administrative delivery-issue listing/detail endpoint exists.
5. No administrative assignment-history or acknowledgement-history endpoint exists.
6. Audit filters do not support date range or actor.
7. There is no bulk assignment or bulk status mutation.
8. There are no finance, GPS or proof-of-delivery APIs.
9. The `/staff` visual frontend has not been implemented; only its protected backend routes and contract exist.

These gaps should be resolved through separately approved backend endpoints rather than client-side workarounds or weakened authorization.
