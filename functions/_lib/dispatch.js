import {HttpError} from './http.js';
import {parsePagination} from './query.js';
import {
  getDashboardStats, normalizeTrackingNumber, SHIPMENT_STATUSES, STATUS_TRANSITIONS,
  updateShipmentStatus,
} from './shipments.js';

const ISSUE_TYPES = Object.freeze(['Delay', 'Delivery issue']);

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

function isoDateTime(value, name) {
  if (value == null || value === '') return new Date().toISOString();
  const cleaned = text(value, name, 35);
  const parsed = Date.parse(cleaned);
  if (Number.isNaN(parsed)) throw new HttpError(422, `${name} must be a valid ISO date and time.`);
  return new Date(parsed).toISOString();
}

function expectedVersion(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(422, 'expectedVersion must be a positive integer.');
  }
  return parsed;
}

function deliveryFromRow(row) {
  if (!row) return null;
  return {
    trackingNumber: row.tracking_number,
    currentStatus: row.current_status,
    version: Number(row.version),
    estimatedDeliveryDate: row.estimated_delivery_date,
    publicItemSummary: row.public_item_summary,
    pickup: {
      contactName: row.sender_name,
      phone: row.sender_phone,
      address: row.origin_address,
      publicSummary: row.origin_public,
    },
    delivery: {
      contactName: row.receiver_name,
      phone: row.receiver_phone,
      address: row.destination_address,
      publicSummary: row.destination_public,
    },
    assignment: {
      sequence: Number(row.assignment_sequence || 0),
      acknowledgedAt: row.assignment_acknowledged_at || null,
    },
    allowedNextStatuses: (STATUS_TRANSITIONS[row.current_status] || [])
      .filter(status => status !== 'Cancelled'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assignedRow(db, trackingNumber, staffId) {
  const tracking = normalizeTrackingNumber(trackingNumber);
  return await db.prepare(`SELECT id, tracking_number, sender_name, sender_phone,
    receiver_name, receiver_phone, origin_address, origin_public,
    destination_address, destination_public, public_item_summary, current_status,
    estimated_delivery_date, version, assignment_sequence, last_assignment_event_id,
    assignment_acknowledged_at, assigned_staff_id, created_at, updated_at
    FROM shipments WHERE tracking_number = ? AND assigned_staff_id = ?`)
    .bind(tracking, staffId).first();
}

async function requireAssignedRow(db, trackingNumber, staff) {
  const row = await assignedRow(db, trackingNumber, staff.id);
  if (!row) throw new HttpError(403, 'This delivery is not assigned to you.');
  return row;
}

function requireAcknowledged(row) {
  if (!row.assignment_acknowledged_at) {
    throw new HttpError(409, 'Acknowledge this assignment before updating the delivery.');
  }
}

export async function getAssignedDelivery(db, trackingNumber, staff) {
  const row = await requireAssignedRow(db, trackingNumber, staff);
  const [history, issues] = await Promise.all([
    db.prepare(`SELECT status, public_location, public_note, occurred_at
      FROM shipment_status_history WHERE shipment_id = ?
      ORDER BY occurred_at ASC, created_at ASC`).bind(row.id).all(),
    db.prepare(`SELECT id, issue_type, public_location, public_note, operational_note,
      occurred_at, created_at FROM shipment_delivery_issues WHERE shipment_id = ?
      ORDER BY occurred_at DESC, created_at DESC`).bind(row.id).all(),
  ]);
  return {
    ...deliveryFromRow(row),
    history: (history.results || []).map(item => ({
      status: item.status,
      location: item.public_location || null,
      note: item.public_note || null,
      occurredAt: item.occurred_at,
    })),
    issues: (issues.results || []).map(item => ({
      id: item.id,
      type: item.issue_type,
      publicLocation: item.public_location || null,
      publicNote: item.public_note || null,
      operationalNote: item.operational_note,
      occurredAt: item.occurred_at,
      createdAt: item.created_at,
    })),
  };
}

export async function listAssignedDeliveries(db, searchParams, staff) {
  const {page, limit, offset} = parsePagination(searchParams);
  const clauses = ['assigned_staff_id = ?'];
  const bindings = [staff.id];
  const status = searchParams.get('status')?.trim();
  if (status) {
    if (!SHIPMENT_STATUSES.includes(status)) throw new HttpError(422, 'Status filter is invalid.');
    clauses.push('current_status = ?');
    bindings.push(status);
  }
  const query = searchParams.get('q')?.trim();
  if (query) {
    if ([...query].length > 100) throw new HttpError(422, 'Search query is too long.');
    const pattern = `%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`;
    clauses.push(`(tracking_number LIKE ? ESCAPE '\\' OR receiver_name LIKE ? ESCAPE '\\'
      OR origin_public LIKE ? ESCAPE '\\' OR destination_public LIKE ? ESCAPE '\\')`);
    bindings.push(pattern, pattern, pattern, pattern);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM shipments ${where}`)
    .bind(...bindings).first();
  const result = await db.prepare(`SELECT tracking_number, receiver_name, origin_public,
    destination_public, public_item_summary, current_status, estimated_delivery_date,
    version, assignment_sequence, assignment_acknowledged_at, created_at, updated_at
    FROM shipments ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset).all();
  return {
    page,
    limit,
    total: Number(total?.count || 0),
    items: (result.results || []).map(row => ({
      trackingNumber: row.tracking_number,
      receiverName: row.receiver_name,
      origin: row.origin_public,
      destination: row.destination_public,
      itemSummary: row.public_item_summary,
      currentStatus: row.current_status,
      estimatedDeliveryDate: row.estimated_delivery_date,
      version: Number(row.version),
      assignment: {
        sequence: Number(row.assignment_sequence || 0),
        acknowledgedAt: row.assignment_acknowledged_at || null,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function getStaffDashboardStats(db, staff) {
  const [stats, pending] = await Promise.all([
    getDashboardStats(db, {kind: 'assigned', staffId: staff.id}),
    db.prepare(`SELECT COUNT(*) AS count FROM shipments
      WHERE assigned_staff_id = ? AND assignment_acknowledged_at IS NULL`)
      .bind(staff.id).first(),
  ]);
  return {...stats, awaitingAcknowledgement: Number(pending?.count || 0)};
}

export async function acknowledgeAssignment(db, trackingNumber, input, staff, options = {}) {
  const row = await requireAssignedRow(db, trackingNumber, staff);
  const version = expectedVersion(input.expectedVersion);
  if (row.version !== version) throw new HttpError(409, 'The delivery was updated by another request.');
  if (row.assignment_acknowledged_at) throw new HttpError(409, 'This assignment has already been acknowledged.');
  if (!row.last_assignment_event_id) throw new HttpError(409, 'This assignment must be refreshed before acknowledgement.');
  const acknowledgementId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  const newVersion = version + 1;
  const results = await db.batch([
    db.prepare(`UPDATE shipments SET assignment_acknowledged_at = ?,
      assignment_acknowledged_by_staff_id = ?, last_acknowledgement_event_id = ?,
      updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND assigned_staff_id = ?
      AND last_assignment_event_id = ? AND assignment_acknowledged_at IS NULL`)
      .bind(now, staff.id, acknowledgementId, now, row.id, version, staff.id, row.last_assignment_event_id),
    db.prepare(`INSERT INTO shipment_assignment_acknowledgements (
      id, shipment_id, assignment_event_id, staff_id, acknowledged_at
    ) SELECT ?, id, last_assignment_event_id, ?, ? FROM shipments
      WHERE id = ? AND version = ? AND last_acknowledgement_event_id = ?`)
      .bind(acknowledgementId, staff.id, now, row.id, newVersion, acknowledgementId),
    db.prepare(`INSERT INTO administrative_audit_records (
      id, actor_subject, actor_email, actor_staff_id, actor_role, action,
      resource_type, resource_id, request_id, details_json, created_at
    ) SELECT ?, ?, ?, ?, ?, 'shipment.assignment_acknowledged', 'shipment', id, ?, ?, ?
      FROM shipments WHERE id = ? AND version = ? AND last_acknowledgement_event_id = ?`)
      .bind(auditId, staff.subject, staff.email, staff.id, staff.role,
        options.requestId || null,
        JSON.stringify({assignmentSequence: Number(row.assignment_sequence || 0)}),
        now, row.id, newVersion, acknowledgementId),
  ]);
  if (results.some(result => Number(result?.meta?.changes || 0) !== 1)) {
    throw new HttpError(409, 'The delivery was updated by another request.');
  }
  return await getAssignedDelivery(db, trackingNumber, staff);
}

export async function updateAssignedDeliveryStatus(db, trackingNumber, input, staff, options = {}) {
  const row = await requireAssignedRow(db, trackingNumber, staff);
  requireAcknowledged(row);
  if ('internalNote' in input || 'estimatedDeliveryDate' in input) {
    throw new HttpError(403, 'Field Staff cannot change administrative shipment fields.');
  }
  await updateShipmentStatus(db, trackingNumber, input, staff, {
    ...options,
    requiredAssignedStaffId: staff.id,
    requiredAssignmentEventId: row.last_assignment_event_id,
  });
  return await getAssignedDelivery(db, trackingNumber, staff);
}

export async function reportDeliveryIssue(db, trackingNumber, input, staff, options = {}) {
  const row = await requireAssignedRow(db, trackingNumber, staff);
  requireAcknowledged(row);
  const version = expectedVersion(input.expectedVersion);
  if (row.version !== version) throw new HttpError(409, 'The delivery was updated by another request.');
  const issueType = text(input.type, 'Issue type', 30);
  if (!ISSUE_TYPES.includes(issueType)) throw new HttpError(422, 'Issue type is invalid.');
  const operationalNote = text(input.operationalNote, 'Operational note', 1000);
  const publicLocation = text(input.publicLocation ?? '', 'Public location', 120, {required: false});
  const publicNote = text(input.publicNote ?? '', 'Public note', 300, {required: false});
  if (issueType === 'Delay' && !publicNote) throw new HttpError(422, 'A public delay note is required.');
  if (issueType !== 'Delay' && (publicLocation || publicNote)) {
    throw new HttpError(422, 'Public updates are only accepted for delay reports.');
  }
  const occurredAt = isoDateTime(input.occurredAt, 'Occurred at');
  const issueId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const statusHistoryId = issueType === 'Delay' ? crypto.randomUUID() : null;
  const now = new Date().toISOString();
  const newVersion = version + 1;
  if (issueType === 'Delay' && !STATUS_TRANSITIONS[row.current_status]?.includes('Delayed')) {
    throw new HttpError(409, `Status cannot change from ${row.current_status} to Delayed.`);
  }

  const updateSql = issueType === 'Delay'
    ? `UPDATE shipments SET current_status = 'Delayed', last_status_event_id = ?,
        last_issue_event_id = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND current_status = ? AND assigned_staff_id = ?
        AND last_assignment_event_id = ? AND assignment_acknowledged_at IS NOT NULL`
    : `UPDATE shipments SET last_issue_event_id = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND assigned_staff_id = ?
        AND last_assignment_event_id = ? AND assignment_acknowledged_at IS NOT NULL`;
  const updateBindings = issueType === 'Delay'
    ? [statusHistoryId, issueId, now, row.id, version, row.current_status, staff.id, row.last_assignment_event_id]
    : [issueId, now, row.id, version, staff.id, row.last_assignment_event_id];
  const statements = [db.prepare(updateSql).bind(...updateBindings)];
  if (issueType === 'Delay') {
    statements.push(db.prepare(`INSERT INTO shipment_status_history (
      id, shipment_id, status, public_location, public_note, internal_note,
      occurred_at, created_at, created_by_subject, created_by_email
    ) SELECT ?, id, 'Delayed', ?, ?, '', ?, ?, ?, ? FROM shipments
      WHERE id = ? AND version = ? AND last_status_event_id = ? AND last_issue_event_id = ?`)
      .bind(statusHistoryId, publicLocation, publicNote, occurredAt, now, staff.subject, staff.email,
        row.id, newVersion, statusHistoryId, issueId));
  }
  statements.push(
    db.prepare(`INSERT INTO shipment_delivery_issues (
      id, shipment_id, assignment_event_id, reported_by_staff_id, issue_type,
      public_location, public_note, operational_note, status_history_id, occurred_at, created_at
    ) SELECT ?, id, last_assignment_event_id, ?, ?, ?, ?, ?, ?, ?, ? FROM shipments
      WHERE id = ? AND version = ? AND last_issue_event_id = ?`)
      .bind(issueId, staff.id, issueType, publicLocation, publicNote, operationalNote,
        statusHistoryId, occurredAt, now, row.id, newVersion, issueId),
    db.prepare(`INSERT INTO administrative_audit_records (
      id, actor_subject, actor_email, actor_staff_id, actor_role, action,
      resource_type, resource_id, request_id, details_json, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, 'shipment', id, ?, ?, ? FROM shipments
      WHERE id = ? AND version = ? AND last_issue_event_id = ?`)
      .bind(auditId, staff.subject, staff.email, staff.id, staff.role,
        issueType === 'Delay' ? 'shipment.delay_reported' : 'shipment.delivery_issue_reported',
        options.requestId || null,
        JSON.stringify({type: issueType, fromStatus: row.current_status,
          toStatus: issueType === 'Delay' ? 'Delayed' : row.current_status}),
        now, row.id, newVersion, issueId),
  );
  const results = await db.batch(statements);
  if (results.some(result => Number(result?.meta?.changes || 0) !== 1)) {
    throw new HttpError(409, 'The delivery was updated by another request.');
  }
  return await getAssignedDelivery(db, trackingNumber, staff);
}
