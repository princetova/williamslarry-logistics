# WilliamsLarry Logistics shipment tracking — Phase 3A

This document is the backend contract for the D1 shipment system. The existing public tracking page remains a preview until its separately approved frontend integration consumes the public endpoint.

## Security boundaries

- `SHIPMENTS_DB` is the only database binding and must point to the D1 database named `wll-shipments`.
- Public tracking returns public summaries only. It never returns customer names, phone numbers, exact addresses, private item descriptions, internal notes, Access identities, audit records, or database IDs.
- Public lookup quotas use `TRACKING_RATE_LIMIT_KV` when present, otherwise the existing `ENQUIRY_KV`, plus the existing encrypted `RATE_LIMIT_PEPPER`.
- Every `/api/admin/*` route is protected by `functions/api/admin/_middleware.js`.
- The middleware validates the `Cf-Access-Jwt-Assertion` RS256 signature against Cloudflare Access JWKS, then validates issuer, audience, expiry, not-before time and subject.
- `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `ADMIN_ALLOWED_HOSTS` are mandatory. Missing configuration fails closed.
- `ADMIN_ALLOWED_HOSTS` is a comma-separated exact hostname allowlist. All `*.pages.dev` hosts and any unlisted custom host are rejected before JWT processing.
- Cloudflare Access must also protect `https://williamslarrylogistics.com/api/admin/*` at the edge. The application verification is defense in depth, not a replacement for the Access policy.
- All responses use `Cache-Control: no-store`.

## Database schema

Migration: `migrations/0001_create_shipment_tracking.sql`

### `shipments`

Private operational record containing:

- cryptographically random `WLL-` tracking number with a database unique constraint;
- sender and receiver names and phones;
- private origin/destination addresses and separate public location summaries;
- private item description and separate public item summary;
- current status, estimated delivery date and internal notes;
- optimistic concurrency `version`;
- creation and modification timestamps.

### `shipment_status_history`

Append-only timeline containing public and internal notes, public location, event time and the verified Access actor. SQL triggers reject updates and deletes.

### `administrative_audit_records`

Append-only mutation audit containing the Access actor, action, resource, request correlation ID and non-customer metadata. SQL triggers reject updates and deletes.

Shipment creation batches the shipment, initial `Registered` history and audit record. Status mutation batches a version-checked shipment update, history insert and audit insert. D1 rolls back the complete batch if any statement fails.

## Status lifecycle

| Current | Allowed next statuses |
|---|---|
| Registered | Picked up, Cancelled |
| Picked up | In transit, Delayed, Cancelled, Returned |
| In transit | Arrived at destination, Delayed, Cancelled, Returned |
| Arrived at destination | Out for delivery, Delayed, Returned |
| Out for delivery | Delivered, Delayed, Returned |
| Delivered | Returned |
| Delayed | In transit, Arrived at destination, Out for delivery, Cancelled, Returned |
| Cancelled | None |
| Returned | None |

Repeated statuses and skipped milestones are rejected with HTTP `409`. Every status update requires the last observed positive integer `expectedVersion`; a concurrent loser receives `409` and creates no history or audit entry.

## Public API

### `GET /api/tracking/{trackingNumber}`

Authentication: none. Rate limit: 30 requests per hashed client IP per ten-minute window (best effort because KV is eventually consistent).

Tracking format: `WLL-` plus 16 uppercase Crockford Base32 characters. Input is trimmed and uppercased.

Success — `200`:

```json
{
  "ok": true,
  "shipment": {
    "trackingNumber": "WLL-0A1B2C3D4E5F6G7H",
    "origin": "Owerri, Imo State",
    "destination": "Port Harcourt, Rivers State",
    "itemSummary": "Two boxes",
    "currentStatus": "In transit",
    "estimatedDeliveryDate": "2026-11-22",
    "createdAt": "2026-11-17T12:00:00.000Z",
    "updatedAt": "2026-11-18T09:30:00.000Z",
    "history": [
      {
        "status": "Registered",
        "location": "Owerri, Imo State",
        "note": "Shipment registered",
        "occurredAt": "2026-11-17T12:00:00.000Z"
      }
    ]
  }
}
```

Errors:

- `404`: no real shipment has that valid tracking number;
- `422`: malformed tracking number;
- `429`: public quota exceeded, with `Retry-After: 600`;
- `503`: D1, KV or rate-limit pepper is unavailable.

The frontend must render only fields returned here. It must not infer missing milestones or create placeholder tracking results.

## Administration API

All routes require a valid Cloudflare Access application JWT and an allowed production hostname.

### `POST /api/admin/shipments`

Creates a shipment and its first history/audit records. Returns `201` with the full authorized shipment record.

Required JSON fields:

```json
{
  "senderName": "Synthetic Sender",
  "senderPhone": "+234 700 000 0001",
  "receiverName": "Synthetic Receiver",
  "receiverPhone": "+234 700 000 0002",
  "originAddress": "Private operational address",
  "originPublic": "Owerri, Imo State",
  "destinationAddress": "Private operational address",
  "destinationPublic": "Port Harcourt, Rivers State",
  "itemDescription": "Private operational description",
  "publicItemSummary": "Two boxes",
  "estimatedDeliveryDate": "2026-11-22",
  "internalNotes": "Optional private note",
  "publicNote": "Optional safe registration note"
}
```

`estimatedDeliveryDate`, `internalNotes` and `publicNote` are optional. Public fields must be written for customers and must not contain phone numbers, exact addresses or internal instructions.

### `GET /api/admin/shipments`

Query parameters:

- `page`: positive page number, default `1`;
- `limit`: `1`–`100`, default `25`;
- `status`: exact lifecycle status;
- `q`: up to 100 characters; searches tracking number, customer names/phones and public locations.

Returns administrative summaries plus `page`, `limit` and `total`.

### `GET /api/admin/shipments/{trackingNumber}`

Returns the full authorized record, including private contacts, exact addresses, private description and internal notes.

### `POST /api/admin/shipments/{trackingNumber}/status`

```json
{
  "status": "Picked up",
  "expectedVersion": 1,
  "publicLocation": "Owerri, Imo State",
  "publicNote": "Collected by the operations team",
  "internalNote": "Optional private operational note",
  "occurredAt": "2026-11-18T09:30:00.000Z",
  "estimatedDeliveryDate": "2026-11-22"
}
```

`status` and `expectedVersion` are required. Other fields are optional. Returns the updated administrative shipment. Invalid transitions or stale versions return `409`.

### `GET /api/admin/shipments/{trackingNumber}/history`

Returns the full authorized append-only history, including internal notes and Access actor identity.

### `GET /api/admin/stats`

Returns total shipments, shipments created in the last seven days, overdue active shipments and counts for every lifecycle status. It returns no customer information.

## Local verification

The automated shipment tests execute the real migration against an in-memory SQLite database through a D1-compatible prepared-statement and transactional batch adapter. All data is synthetic.

```powershell
npm test
npm run test:shipments
npx wrangler d1 migrations apply wll-shipments --local --config wrangler.local.jsonc
```

The final command validates the migration with Wrangler's local D1 storage and writes only to `.wrangler/`, which is ignored by Git. `wrangler.local.jsonc` contains a deliberately non-production placeholder database ID and must never be supplied to a remote command or deployment.

## Production setup — approval required before execution

Do not run the remote migration or deploy until the project owner approves both actions.

1. Create the database once:

   ```powershell
   npx wrangler d1 create wll-shipments
   ```

2. In Cloudflare Pages production bindings, add D1 binding `SHIPMENTS_DB` pointing to `wll-shipments`.
3. Retain `ENQUIRY_KV` and `RATE_LIMIT_PEPPER`, or add a separate KV binding named `TRACKING_RATE_LIMIT_KV`.
4. Create a Cloudflare Access self-hosted application for `williamslarrylogistics.com/api/admin/*` and an explicit allow policy for approved administrators.
5. Add production variables:

   | Variable | Example/meaning |
   |---|---|
   | `CF_ACCESS_TEAM_DOMAIN` | `https://your-team.cloudflareaccess.com` |
   | `CF_ACCESS_AUD` | Access application's AUD tag |
   | `ADMIN_ALLOWED_HOSTS` | `williamslarrylogistics.com,www.williamslarrylogistics.com` |

6. Review pending migrations:

   ```powershell
   npx wrangler d1 migrations list wll-shipments --remote
   ```

7. After explicit approval, apply them:

   ```powershell
   npx wrangler d1 migrations apply wll-shipments --remote
   ```

8. Deploy a reviewed commit, then test Access rejection, an authorized synthetic shipment, public lookup and concurrency before connecting the existing tracking page.

## Deliberately deferred

- No admin dashboard UI is included.
- The public tracking HTML and JavaScript are unchanged.
- No production D1 database, migration, binding, Access application or deployment is created by Phase 3A implementation alone.
- WhatsApp remains inactive while Meta verification is pending.
