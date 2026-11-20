import {HttpError} from './http.js';

export const SHIPMENT_STATUSES = Object.freeze([
  'Registered', 'Picked up', 'In transit', 'Arrived at destination',
  'Out for delivery', 'Delivered', 'Delayed', 'Cancelled', 'Returned',
]);

export const STATUS_TRANSITIONS = Object.freeze({
  Registered: ['Picked up', 'Cancelled'],
  'Picked up': ['In transit', 'Delayed', 'Cancelled', 'Returned'],
  'In transit': ['Arrived at destination', 'Delayed', 'Cancelled', 'Returned'],
  'Arrived at destination': ['Out for delivery', 'Delayed', 'Returned'],
  'Out for delivery': ['Delivered', 'Delayed', 'Returned'],
  Delivered: ['Returned'],
  Delayed: ['In transit', 'Arrived at destination', 'Out for delivery', 'Cancelled', 'Returned'],
  Cancelled: [],
  Returned: [],
});

const TRACKING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TRACKING_PATTERN = /^WLL-[0-9A-HJKMNP-TV-Z]{16}$/;
const PHONE_PATTERN = /^\+?[\d\s()-]+$/;

function text(value, name, max, {required = true} = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new HttpError(422, `${name} must be text.`);
  const cleaned = value.trim().replace(/\r\n?/g, '\n');
  if (required && !cleaned) throw new HttpError(422, `${name} is required.`);
  if ([...cleaned].length > max) throw new HttpError(422, `${name} is too long.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(cleaned)) {
    throw new HttpError(422, `${name} contains unsupported characters.`);
  }
  return cleaned;
}

function phone(value, name) {
  const cleaned = text(value, name, 24);
  const digits = cleaned.replace(/\D/g, '');
  if (!PHONE_PATTERN.test(cleaned) || digits.length < 7 || digits.length > 15) {
    throw new HttpError(422, `${name} is invalid.`);
  }
  return cleaned;
}

function dateOnly(value, name, {required = false} = {}) {
  if ((value == null || value === '') && !required) return null;
  const cleaned = text(value, name, 10);
  const parsed = new Date(`${cleaned}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned) || Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== cleaned) {
    throw new HttpError(422, `${name} must use YYYY-MM-DD.`);
  }
  return cleaned;
}

function isoDateTime(value, name) {
  if (value == null || value === '') return new Date().toISOString();
  const cleaned = text(value, name, 35);
  const parsed = Date.parse(cleaned);
  if (Number.isNaN(parsed)) throw new HttpError(422, `${name} must be a valid ISO date and time.`);
  return new Date(parsed).toISOString();
}

function actorValues(actor) {
  if (!actor?.subject) throw new HttpError(500, 'Administrative identity is unavailable.');
  return {
    subject: actor.subject,
    email: actor.email || null,
    staffId: actor.id || null,
    role: actor.role || null,
  };
}

export function requireShipmentsDatabase(env) {
  if (!env?.SHIPMENTS_DB) throw new HttpError(503, 'Shipment services are temporarily unavailable.');
  return env.SHIPMENTS_DB;
}

export function normalizeTrackingNumber(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!TRACKING_PATTERN.test(normalized)) throw new HttpError(422, 'Enter a valid tracking number.');
  return normalized;
}

export function createTrackingNumber() {
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  let bits = 0;
  let bitCount = 0;
  let encoded = '';
  for (const byte of random) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += TRACKING_ALPHABET[(bits >>> bitCount) & 31];
      bits &= (1 << bitCount) - 1;
    }
  }
  return `WLL-${encoded.slice(0, 16)}`;
}

export function validateCreateShipment(input) {
  return {
    senderName: text(input.senderName, 'Sender name', 90),
    senderPhone: phone(input.senderPhone, 'Sender phone'),
    receiverName: text(input.receiverName, 'Receiver name', 90),
    receiverPhone: phone(input.receiverPhone, 'Receiver phone'),
    originAddress: text(input.originAddress, 'Origin address', 300),
    originPublic: text(input.originPublic, 'Public origin summary', 120),
    destinationAddress: text(input.destinationAddress, 'Destination address', 300),
    destinationPublic: text(input.destinationPublic, 'Public destination summary', 120),
    itemDescription: text(input.itemDescription, 'Item description', 700),
    publicItemSummary: text(input.publicItemSummary, 'Public item summary', 160),
    estimatedDeliveryDate: dateOnly(input.estimatedDeliveryDate, 'Estimated delivery date'),
    internalNotes: text(input.internalNotes ?? '', 'Internal notes', 1000, {required: false}),
    publicNote: text(input.publicNote ?? '', 'Public note', 300, {required: false}),
  };
}

function adminShipment(row) {
  if (!row) return null;
  return {
    id: row.id,
    trackingNumber: row.tracking_number,
    sender: {name: row.sender_name, phone: row.sender_phone},
    receiver: {name: row.receiver_name, phone: row.receiver_phone},
    origin: {address: row.origin_address, publicSummary: row.origin_public},
    destination: {address: row.destination_address, publicSummary: row.destination_public},
    itemDescription: row.item_description,
    publicItemSummary: row.public_item_summary,
    currentStatus: row.current_status,
    estimatedDeliveryDate: row.estimated_delivery_date,
    internalNotes: row.internal_notes,
    assignedStaff: row.assigned_staff_id ? {
      id: row.assigned_staff_id,
      displayName: row.assigned_staff_name,
      email: row.assigned_staff_email,
    } : null,
    assignmentSequence: Number(row.assignment_sequence || 0),
    assignmentAcknowledgedAt: row.assignment_acknowledged_at || null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAdminShipment(db, trackingNumber) {
  const tracking = normalizeTrackingNumber(trackingNumber);
  return adminShipment(await db.prepare(`SELECT shipments.*,
    staff_accounts.display_name AS assigned_staff_name,
    staff_accounts.email AS assigned_staff_email
    FROM shipments LEFT JOIN staff_accounts ON staff_accounts.id = shipments.assigned_staff_id
    WHERE shipments.tracking_number = ?`).bind(tracking).first());
}

export async function createShipment(db, input, actor, options = {}) {
  const values = validateCreateShipment(input);
  const identity = actorValues(actor);
  const trackingFactory = options.trackingNumberFactory || createTrackingNumber;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID();
    const trackingNumber = normalizeTrackingNumber(trackingFactory());
    const historyId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await db.batch([
        db.prepare(`INSERT INTO shipments (
          id, tracking_number, sender_name, sender_phone, receiver_name, receiver_phone,
          origin_address, origin_public, destination_address, destination_public,
          item_description, public_item_summary, current_status, estimated_delivery_date,
          internal_notes, version, created_at, updated_at, last_status_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Registered', ?, ?, 1, ?, ?, ?)`)
          .bind(id, trackingNumber, values.senderName, values.senderPhone, values.receiverName,
            values.receiverPhone, values.originAddress, values.originPublic, values.destinationAddress,
            values.destinationPublic, values.itemDescription, values.publicItemSummary,
            values.estimatedDeliveryDate, values.internalNotes, now, now, historyId),
        db.prepare(`INSERT INTO shipment_status_history (
          id, shipment_id, status, public_location, public_note, internal_note,
          occurred_at, created_at, created_by_subject, created_by_email
        ) VALUES (?, ?, 'Registered', ?, ?, '', ?, ?, ?, ?)`)
          .bind(historyId, id, values.originPublic, values.publicNote, now, now, identity.subject, identity.email),
        db.prepare(`INSERT INTO administrative_audit_records (
          id, actor_subject, actor_email, actor_staff_id, actor_role, action,
          resource_type, resource_id, request_id, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 'shipment.created', 'shipment', ?, ?, ?, ?)`)
          .bind(auditId, identity.subject, identity.email, identity.staffId, identity.role,
            id, options.requestId || null,
            JSON.stringify({trackingNumber, status: 'Registered'}), now),
      ]);
      return await getAdminShipment(db, trackingNumber);
    } catch (caught) {
      if (/unique.*tracking|tracking.*unique/i.test(String(caught?.message)) && attempt < 4) continue;
      throw caught;
    }
  }
  throw new HttpError(503, 'A unique tracking number could not be allocated.');
}

export async function getPublicTracking(db, trackingNumber) {
  const tracking = normalizeTrackingNumber(trackingNumber);
  const shipment = await db.prepare(`SELECT tracking_number, origin_public, destination_public,
    public_item_summary, current_status, estimated_delivery_date, created_at, updated_at
    FROM shipments WHERE tracking_number = ?`).bind(tracking).first();
  if (!shipment) return null;
  const historyResult = await db.prepare(`SELECT status, public_location, public_note, occurred_at
    FROM shipment_status_history WHERE shipment_id = (
      SELECT id FROM shipments WHERE tracking_number = ?
    ) ORDER BY occurred_at ASC, created_at ASC`).bind(tracking).all();
  return {
    trackingNumber: shipment.tracking_number,
    origin: shipment.origin_public,
    destination: shipment.destination_public,
    itemSummary: shipment.public_item_summary,
    currentStatus: shipment.current_status,
    estimatedDeliveryDate: shipment.estimated_delivery_date,
    createdAt: shipment.created_at,
    updatedAt: shipment.updated_at,
    history: (historyResult.results || []).map(row => ({
      status: row.status,
      location: row.public_location || null,
      note: row.public_note || null,
      occurredAt: row.occurred_at,
    })),
  };
}

export async function getAdminHistory(db, trackingNumber) {
  const shipment = await getAdminShipment(db, trackingNumber);
  if (!shipment) return null;
  const result = await db.prepare(`SELECT id, status, public_location, public_note, internal_note,
    occurred_at, created_at, created_by_subject, created_by_email
    FROM shipment_status_history WHERE shipment_id = ?
    ORDER BY occurred_at ASC, created_at ASC`).bind(shipment.id).all();
  return {
    trackingNumber: shipment.trackingNumber,
    items: (result.results || []).map(row => ({
      id: row.id,
      status: row.status,
      publicLocation: row.public_location,
      publicNote: row.public_note,
      internalNote: row.internal_note,
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      createdBy: {subject: row.created_by_subject, email: row.created_by_email},
    })),
  };
}

export async function updateShipmentStatus(db, trackingNumber, input, actor, options = {}) {
  const identity = actorValues(actor);
  const shipment = await getAdminShipment(db, trackingNumber);
  if (!shipment) throw new HttpError(404, 'Shipment not found.');
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new HttpError(422, 'expectedVersion must be a positive integer.');
  }
  if (shipment.version !== expectedVersion) throw new HttpError(409, 'The shipment was updated by another request.');
  const status = text(input.status, 'Status', 40);
  if (!SHIPMENT_STATUSES.includes(status) || !STATUS_TRANSITIONS[shipment.currentStatus].includes(status)) {
    throw new HttpError(409, `Status cannot change from ${shipment.currentStatus} to ${status}.`);
  }
  if (identity.role === 'Field Staff' && status === 'Cancelled') {
    throw new HttpError(403, 'Field Staff cannot cancel shipments.');
  }
  const publicLocation = text(input.publicLocation ?? '', 'Public location', 120, {required: false});
  const publicNote = text(input.publicNote ?? '', 'Public note', 300, {required: false});
  const internalNote = text(input.internalNote ?? '', 'Internal note', 1000, {required: false});
  const estimatedDeliveryDate = dateOnly(input.estimatedDeliveryDate, 'Estimated delivery date');
  const occurredAt = isoDateTime(input.occurredAt, 'Occurred at');
  const now = new Date().toISOString();
  const newVersion = expectedVersion + 1;
  const historyId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const assignmentGuard = options.requiredAssignedStaffId
    ? ' AND assigned_staff_id = ? AND last_assignment_event_id = ? AND assignment_acknowledged_at IS NOT NULL'
    : '';
  const assignmentBindings = options.requiredAssignedStaffId
    ? [options.requiredAssignedStaffId, options.requiredAssignmentEventId]
    : [];

  const results = await db.batch([
    db.prepare(`UPDATE shipments SET current_status = ?,
      estimated_delivery_date = COALESCE(?, estimated_delivery_date),
      updated_at = ?, version = version + 1, last_status_event_id = ?
      WHERE id = ? AND version = ? AND current_status = ?${assignmentGuard}`)
      .bind(status, estimatedDeliveryDate, now, historyId, shipment.id, expectedVersion,
        shipment.currentStatus, ...assignmentBindings),
    db.prepare(`INSERT INTO shipment_status_history (
      id, shipment_id, status, public_location, public_note, internal_note,
      occurred_at, created_at, created_by_subject, created_by_email
    ) SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ? FROM shipments
      WHERE id = ? AND version = ? AND current_status = ? AND last_status_event_id = ?`)
      .bind(historyId, status, publicLocation, publicNote, internalNote, occurredAt, now,
        identity.subject, identity.email, shipment.id, newVersion, status, historyId),
    db.prepare(`INSERT INTO administrative_audit_records (
      id, actor_subject, actor_email, actor_staff_id, actor_role, action,
      resource_type, resource_id, request_id, details_json, created_at
    ) SELECT ?, ?, ?, ?, ?, 'shipment.status_updated', 'shipment', id, ?, ?, ? FROM shipments
      WHERE id = ? AND version = ? AND current_status = ? AND last_status_event_id = ?`)
      .bind(auditId, identity.subject, identity.email, identity.staffId, identity.role,
        options.requestId || null,
        JSON.stringify({from: shipment.currentStatus, to: status, version: newVersion}), now,
        shipment.id, newVersion, status, historyId),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
    throw new HttpError(409, 'The shipment was updated by another request.');
  }
  return await getAdminShipment(db, trackingNumber);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

export async function listShipments(db, searchParams, scope = {kind: 'all'}) {
  const page = Math.max(1, Math.min(10_000, Number(searchParams.get('page')) || 1));
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit')) || 25));
  const clauses = [];
  const bindings = [];
  if (scope.kind === 'assigned') {
    clauses.push('assigned_staff_id = ?');
    bindings.push(scope.staffId);
  } else if (scope.kind !== 'all') {
    throw new HttpError(403, 'You do not have permission to view shipments.');
  }
  const status = searchParams.get('status')?.trim();
  if (status) {
    if (!SHIPMENT_STATUSES.includes(status)) throw new HttpError(422, 'Status filter is invalid.');
    clauses.push('current_status = ?');
    bindings.push(status);
  }
  const query = searchParams.get('q')?.trim();
  if (query) {
    if ([...query].length > 100) throw new HttpError(422, 'Search query is too long.');
    const pattern = `%${escapeLike(query)}%`;
    clauses.push(`(tracking_number LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\'
      OR sender_phone LIKE ? ESCAPE '\\' OR receiver_name LIKE ? ESCAPE '\\'
      OR receiver_phone LIKE ? ESCAPE '\\' OR origin_public LIKE ? ESCAPE '\\'
      OR destination_public LIKE ? ESCAPE '\\')`);
    bindings.push(...Array(7).fill(pattern));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM shipments ${where}`).bind(...bindings).first();
  const result = await db.prepare(`SELECT id, tracking_number, sender_name, receiver_name,
    origin_public, destination_public, public_item_summary, current_status,
    estimated_delivery_date, version, created_at, updated_at
    FROM shipments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, (page - 1) * limit).all();
  return {
    page,
    limit,
    total: Number(totalRow?.total || 0),
    items: (result.results || []).map(row => ({
      id: row.id,
      trackingNumber: row.tracking_number,
      senderName: row.sender_name,
      receiverName: row.receiver_name,
      origin: row.origin_public,
      destination: row.destination_public,
      itemSummary: row.public_item_summary,
      currentStatus: row.current_status,
      estimatedDeliveryDate: row.estimated_delivery_date,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function getDashboardStats(db, scope = {kind: 'all'}) {
  const assignedWhere = scope.kind === 'assigned' ? ' WHERE assigned_staff_id = ?' : '';
  const assignedAnd = scope.kind === 'assigned' ? ' AND assigned_staff_id = ?' : '';
  const bindings = scope.kind === 'assigned' ? [scope.staffId] : [];
  if (!['all', 'assigned'].includes(scope.kind)) {
    throw new HttpError(403, 'You do not have permission to view shipment statistics.');
  }
  const [total, statuses, recent, overdue] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM shipments${assignedWhere}`).bind(...bindings).first(),
    db.prepare(`SELECT current_status AS status, COUNT(*) AS count FROM shipments${assignedWhere}
      GROUP BY current_status`).bind(...bindings).all(),
    db.prepare(`SELECT COUNT(*) AS count FROM shipments
      WHERE created_at >= datetime('now', '-7 days')${assignedAnd}`).bind(...bindings).first(),
    db.prepare(`SELECT COUNT(*) AS count FROM shipments
      WHERE estimated_delivery_date < date('now')
      AND current_status NOT IN ('Delivered', 'Cancelled', 'Returned')${assignedAnd}`).bind(...bindings).first(),
  ]);
  const byStatus = Object.fromEntries(SHIPMENT_STATUSES.map(status => [status, 0]));
  for (const row of statuses.results || []) byStatus[row.status] = Number(row.count);
  return {
    total: Number(total?.count || 0),
    createdLast7Days: Number(recent?.count || 0),
    overdueActive: Number(overdue?.count || 0),
    byStatus,
  };
}
