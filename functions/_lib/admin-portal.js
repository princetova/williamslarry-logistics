import {HttpError} from './http.js';
import {optionalIsoDateTime, optionalText, parsePagination, validateDateRange} from './query.js';
import {getDashboardStats, normalizeTrackingNumber} from './shipments.js';

const TERMINAL_STATUSES = Object.freeze(['Delivered', 'Cancelled', 'Returned']);
const ISSUE_TYPES = Object.freeze(['Delay', 'Delivery issue']);

function escapeLike(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

function issueFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.issue_type,
    trackingNumber: row.tracking_number,
    shipmentStatus: row.current_status,
    route: {origin: row.origin_public, destination: row.destination_public},
    reportedBy: {id: row.reported_by_staff_id, displayName: row.reported_by_name},
    publicLocation: row.public_location || null,
    publicNote: row.public_note || null,
    operationalNote: row.operational_note || null,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    resolution: row.resolution_id ? {
      id: row.resolution_id,
      note: row.resolution_note,
      resolvedAt: row.resolved_at,
      resolvedBy: {id: row.resolved_by_staff_id, displayName: row.resolved_by_name},
    } : null,
  };
}

const issueSelect = `SELECT issues.id, issues.issue_type, issues.reported_by_staff_id,
  issues.public_location, issues.public_note, issues.operational_note,
  issues.occurred_at, issues.created_at, shipments.tracking_number,
  shipments.current_status, shipments.origin_public, shipments.destination_public,
  reporter.display_name AS reported_by_name, resolutions.id AS resolution_id,
  resolutions.resolution_note, resolutions.resolved_at, resolutions.resolved_by_staff_id,
  resolver.display_name AS resolved_by_name
  FROM shipment_delivery_issues issues
  JOIN shipments ON shipments.id = issues.shipment_id
  JOIN staff_accounts reporter ON reporter.id = issues.reported_by_staff_id
  LEFT JOIN shipment_delivery_issue_resolutions resolutions ON resolutions.issue_id = issues.id
  LEFT JOIN staff_accounts resolver ON resolver.id = resolutions.resolved_by_staff_id`;

export async function listDispatchWorkers(db, searchParams) {
  const {page, limit, offset} = parsePagination(searchParams);
  const query = optionalText(searchParams.get('q'), 'Search query', 100);
  const bindings = [];
  let search = '';
  if (query) {
    search = " AND staff.display_name LIKE ? ESCAPE '\\'";
    bindings.push(`%${escapeLike(query)}%`);
  }
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM staff_accounts staff
    WHERE staff.role = 'Field Staff' AND staff.active = 1${search}`).bind(...bindings).first();
  const result = await db.prepare(`SELECT staff.id, staff.display_name,
    SUM(CASE WHEN shipments.id IS NOT NULL AND shipments.current_status NOT IN ('Delivered', 'Cancelled', 'Returned') THEN 1 ELSE 0 END) AS active_assigned,
    SUM(CASE WHEN shipments.id IS NOT NULL AND shipments.current_status NOT IN ('Delivered', 'Cancelled', 'Returned')
      AND shipments.assignment_acknowledged_at IS NULL THEN 1 ELSE 0 END) AS pending_acknowledgements,
    SUM(CASE WHEN shipments.current_status = 'Delayed' THEN 1 ELSE 0 END) AS delayed
    FROM staff_accounts staff
    LEFT JOIN shipments ON shipments.assigned_staff_id = staff.id
    WHERE staff.role = 'Field Staff' AND staff.active = 1${search}
    GROUP BY staff.id, staff.display_name
    ORDER BY staff.display_name ASC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset).all();
  return {
    page, limit, total: Number(total?.count || 0),
    items: (result.results || []).map(row => ({
      id: row.id,
      displayName: row.display_name,
      workload: {
        activeAssigned: Number(row.active_assigned || 0),
        pendingAcknowledgements: Number(row.pending_acknowledgements || 0),
        delayed: Number(row.delayed || 0),
      },
    })),
  };
}

export async function getAdminDashboardStats(db) {
  const terminalPlaceholders = TERMINAL_STATUSES.map(() => '?').join(', ');
  const [base, unassigned, pending, issues, workload] = await Promise.all([
    getDashboardStats(db),
    db.prepare(`SELECT COUNT(*) AS count FROM shipments WHERE assigned_staff_id IS NULL
      AND current_status NOT IN (${terminalPlaceholders})`).bind(...TERMINAL_STATUSES).first(),
    db.prepare(`SELECT COUNT(*) AS count FROM shipments WHERE assigned_staff_id IS NOT NULL
      AND assignment_acknowledged_at IS NULL AND current_status NOT IN (${terminalPlaceholders})`)
      .bind(...TERMINAL_STATUSES).first(),
    db.prepare(`SELECT COUNT(*) AS count FROM shipment_delivery_issues issues
      WHERE NOT EXISTS (SELECT 1 FROM shipment_delivery_issue_resolutions resolutions
        WHERE resolutions.issue_id = issues.id)`).first(),
    db.prepare(`SELECT staff.id, staff.display_name,
      SUM(CASE WHEN shipments.id IS NOT NULL AND shipments.current_status NOT IN ('Delivered', 'Cancelled', 'Returned') THEN 1 ELSE 0 END) AS active_assigned,
      SUM(CASE WHEN shipments.id IS NOT NULL AND shipments.current_status NOT IN ('Delivered', 'Cancelled', 'Returned')
        AND shipments.assignment_acknowledged_at IS NULL THEN 1 ELSE 0 END) AS pending_acknowledgements,
      SUM(CASE WHEN shipments.current_status = 'Delayed' THEN 1 ELSE 0 END) AS delayed
      FROM staff_accounts staff LEFT JOIN shipments ON shipments.assigned_staff_id = staff.id
      WHERE staff.role = 'Field Staff' AND staff.active = 1
      GROUP BY staff.id, staff.display_name ORDER BY staff.display_name ASC`).all(),
  ]);
  return {
    ...base,
    unassignedActive: Number(unassigned?.count || 0),
    pendingAcknowledgements: Number(pending?.count || 0),
    openDeliveryIssues: Number(issues?.count || 0),
    staffWorkload: (workload.results || []).map(row => ({
      staff: {id: row.id, displayName: row.display_name},
      activeAssigned: Number(row.active_assigned || 0),
      pendingAcknowledgements: Number(row.pending_acknowledgements || 0),
      delayed: Number(row.delayed || 0),
    })),
  };
}

export async function listDeliveryIssues(db, searchParams) {
  const {page, limit, offset} = parsePagination(searchParams);
  const clauses = [];
  const bindings = [];
  const state = optionalText(searchParams.get('state'), 'Issue state', 20);
  if (state) {
    if (!['open', 'resolved'].includes(state)) throw new HttpError(422, 'Issue state filter is invalid.');
    clauses.push(state === 'open' ? 'resolutions.id IS NULL' : 'resolutions.id IS NOT NULL');
  }
  const type = optionalText(searchParams.get('type'), 'Issue type', 40);
  if (type) {
    if (!ISSUE_TYPES.includes(type)) throw new HttpError(422, 'Issue type filter is invalid.');
    clauses.push('issues.issue_type = ?');
    bindings.push(type);
  }
  const trackingValue = optionalText(searchParams.get('trackingNumber'), 'Tracking number', 24);
  if (trackingValue) {
    clauses.push('shipments.tracking_number = ?');
    bindings.push(normalizeTrackingNumber(trackingValue));
  }
  const reporter = optionalText(searchParams.get('reportedByStaffId'), 'Reporting staff ID', 100);
  if (reporter) {
    clauses.push('issues.reported_by_staff_id = ?');
    bindings.push(reporter);
  }
  const from = optionalIsoDateTime(searchParams.get('from'), 'From');
  const to = optionalIsoDateTime(searchParams.get('to'), 'To', {endOfDay: true});
  validateDateRange(from, to);
  if (from) { clauses.push('issues.occurred_at >= ?'); bindings.push(from); }
  if (to) { clauses.push('issues.occurred_at <= ?'); bindings.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM shipment_delivery_issues issues
    JOIN shipments ON shipments.id = issues.shipment_id
    LEFT JOIN shipment_delivery_issue_resolutions resolutions ON resolutions.issue_id = issues.id
    ${where}`).bind(...bindings).first();
  const result = await db.prepare(`${issueSelect} ${where}
    ORDER BY issues.occurred_at DESC, issues.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset).all();
  return {page, limit, total: Number(total?.count || 0), items: (result.results || []).map(issueFromRow)};
}

export async function getDeliveryIssue(db, issueId) {
  const id = optionalText(issueId, 'Issue ID', 100);
  if (!id) throw new HttpError(422, 'Issue ID is required.');
  return issueFromRow(await db.prepare(`${issueSelect} WHERE issues.id = ?`).bind(id).first());
}

export async function resolveDeliveryIssue(db, issueId, input, actor, options = {}) {
  if (!actor?.id || !actor?.subject || !actor?.role) throw new HttpError(500, 'Staff authorization context is unavailable.');
  const issue = await getDeliveryIssue(db, issueId);
  if (!issue) throw new HttpError(404, 'Delivery issue not found.');
  if (issue.resolution) throw new HttpError(409, 'This delivery issue is already resolved.');
  const note = optionalText(input.resolutionNote, 'Resolution note', 1000);
  if (!note) throw new HttpError(422, 'Resolution note is required.');
  const resolutionId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  let results;
  try {
    results = await db.batch([
      db.prepare(`INSERT INTO shipment_delivery_issue_resolutions
        (id, issue_id, resolved_by_staff_id, resolution_note, resolved_at)
        SELECT ?, issues.id, ?, ?, ? FROM shipment_delivery_issues issues
        WHERE issues.id = ? AND NOT EXISTS (
          SELECT 1 FROM shipment_delivery_issue_resolutions existing WHERE existing.issue_id = issues.id
        )`).bind(resolutionId, actor.id, note, now, issueId),
      db.prepare(`INSERT INTO administrative_audit_records (
        id, actor_subject, actor_email, actor_staff_id, actor_role, action,
        resource_type, resource_id, request_id, details_json, created_at
      ) SELECT ?, ?, ?, ?, ?, 'shipment.delivery_issue_resolved', 'delivery_issue', ?, ?, ?, ?
        FROM shipment_delivery_issue_resolutions WHERE id = ?`)
        .bind(auditId, actor.subject, actor.email || null, actor.id, actor.role, issueId,
          options.requestId || null, JSON.stringify({trackingNumber: issue.trackingNumber}), now, resolutionId),
    ]);
  } catch (caught) {
    if (/unique/i.test(String(caught?.message))) throw new HttpError(409, 'This delivery issue is already resolved.');
    throw caught;
  }
  if (results.some(result => Number(result?.meta?.changes || 0) !== 1)) {
    throw new HttpError(409, 'This delivery issue is already resolved.');
  }
  return await getDeliveryIssue(db, issueId);
}

async function shipmentId(db, trackingNumber) {
  const tracking = normalizeTrackingNumber(trackingNumber);
  const row = await db.prepare('SELECT id FROM shipments WHERE tracking_number = ?').bind(tracking).first();
  if (!row) throw new HttpError(404, 'Shipment not found.');
  return {id: row.id, trackingNumber: tracking};
}

export async function getAssignmentHistory(db, trackingNumber, searchParams) {
  const shipment = await shipmentId(db, trackingNumber);
  const {page, limit, offset} = parsePagination(searchParams);
  const total = await db.prepare('SELECT COUNT(*) AS count FROM shipment_assignment_history WHERE shipment_id = ?')
    .bind(shipment.id).first();
  const result = await db.prepare(`SELECT history.id, history.note, history.assigned_at,
    previous.id AS previous_id, previous.display_name AS previous_name,
    assigned.id AS assigned_id, assigned.display_name AS assigned_name,
    actor.id AS actor_id, actor.display_name AS actor_name
    FROM shipment_assignment_history history
    LEFT JOIN staff_accounts previous ON previous.id = history.previous_staff_id
    LEFT JOIN staff_accounts assigned ON assigned.id = history.assigned_staff_id
    LEFT JOIN staff_accounts actor ON actor.id = history.assigned_by_staff_id
    WHERE history.shipment_id = ? ORDER BY history.assigned_at DESC, history.rowid DESC
    LIMIT ? OFFSET ?`).bind(shipment.id, limit, offset).all();
  return {
    trackingNumber: shipment.trackingNumber, page, limit, total: Number(total?.count || 0),
    items: (result.results || []).map(row => ({
      id: row.id,
      previousStaff: row.previous_id ? {id: row.previous_id, displayName: row.previous_name} : null,
      assignedStaff: row.assigned_id ? {id: row.assigned_id, displayName: row.assigned_name} : null,
      assignedBy: row.actor_id ? {id: row.actor_id, displayName: row.actor_name} : null,
      note: row.note || null,
      assignedAt: row.assigned_at,
    })),
  };
}

export async function getAcknowledgementHistory(db, trackingNumber, searchParams) {
  const shipment = await shipmentId(db, trackingNumber);
  const {page, limit, offset} = parsePagination(searchParams);
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM shipment_assignment_acknowledgements
    WHERE shipment_id = ?`).bind(shipment.id).first();
  const result = await db.prepare(`SELECT acknowledgements.id,
    acknowledgements.assignment_event_id, acknowledgements.acknowledged_at,
    staff.id AS staff_id, staff.display_name AS staff_name
    FROM shipment_assignment_acknowledgements acknowledgements
    JOIN staff_accounts staff ON staff.id = acknowledgements.staff_id
    WHERE acknowledgements.shipment_id = ?
    ORDER BY acknowledgements.acknowledged_at DESC, acknowledgements.rowid DESC LIMIT ? OFFSET ?`)
    .bind(shipment.id, limit, offset).all();
  return {
    trackingNumber: shipment.trackingNumber, page, limit, total: Number(total?.count || 0),
    items: (result.results || []).map(row => ({
      id: row.id,
      assignmentEventId: row.assignment_event_id,
      staff: {id: row.staff_id, displayName: row.staff_name},
      acknowledgedAt: row.acknowledged_at,
    })),
  };
}
