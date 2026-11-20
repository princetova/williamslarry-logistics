import {requirePermission, STAFF_ROLES} from './authorization.js';
import {HttpError} from './http.js';
import {optionalIsoDateTime, optionalText, parsePagination, validateDateRange} from './query.js';
import {getAdminShipment, normalizeTrackingNumber} from './shipments.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, name, max, {required = true} = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new HttpError(422, `${name} must be text.`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new HttpError(422, `${name} is required.`);
  if ([...cleaned].length > max) throw new HttpError(422, `${name} is too long.`);
  if (/[\u0000-\u001F\u007F]/.test(cleaned)) throw new HttpError(422, `${name} contains unsupported characters.`);
  return cleaned;
}

function email(value) {
  const cleaned = text(value, 'Email', 254).toLowerCase();
  if (!EMAIL_PATTERN.test(cleaned)) throw new HttpError(422, 'Email is invalid.');
  return cleaned;
}

function role(value) {
  const cleaned = text(value, 'Role', 40);
  if (!STAFF_ROLES.includes(cleaned)) throw new HttpError(422, 'Role is invalid.');
  return cleaned;
}

function accountFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accessSubject: row.access_subject,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    active: Boolean(row.active),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
  };
}

function auditActor(actor) {
  if (!actor?.id || !actor?.subject || !actor?.role) {
    throw new HttpError(500, 'Staff authorization context is unavailable.');
  }
  return actor;
}

export async function listStaffAccounts(db, searchParams) {
  const {page, limit, offset} = parsePagination(searchParams);
  const clauses = [];
  const bindings = [];
  const selectedRole = searchParams.get('role')?.trim();
  if (selectedRole) {
    if (!STAFF_ROLES.includes(selectedRole)) throw new HttpError(422, 'Role filter is invalid.');
    clauses.push('role = ?');
    bindings.push(selectedRole);
  }
  const active = searchParams.get('active');
  if (active != null && active !== '') {
    if (!['true', 'false'].includes(active)) throw new HttpError(422, 'Active filter is invalid.');
    clauses.push('active = ?');
    bindings.push(active === 'true' ? 1 : 0);
  }
  const query = searchParams.get('q')?.trim();
  if (query) {
    if ([...query].length > 100) throw new HttpError(422, 'Search query is too long.');
    clauses.push("(display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
    bindings.push(`%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`);
    bindings.push(bindings.at(-1));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM staff_accounts ${where}`)
    .bind(...bindings).first();
  const result = await db.prepare(`SELECT * FROM staff_accounts ${where}
    ORDER BY active DESC, display_name ASC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset).all();
  return {
    page,
    limit,
    total: Number(total?.count || 0),
    items: (result.results || []).map(accountFromRow),
  };
}

export async function getStaffAccount(db, staffId) {
  return accountFromRow(await db.prepare('SELECT * FROM staff_accounts WHERE id = ?').bind(staffId).first());
}

export async function createStaffAccount(db, input, actor, options = {}) {
  requirePermission(actor, 'staff.manage');
  const identity = auditActor(actor);
  const values = {
    accessSubject: text(input.accessSubject, 'Access subject', 200),
    email: email(input.email),
    displayName: text(input.displayName, 'Display name', 100),
    role: role(input.role),
  };
  const id = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT INTO staff_accounts (
        id, access_subject, email, display_name, role, active, version,
        created_at, updated_at, created_by_subject
      ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`)
        .bind(id, values.accessSubject, values.email, values.displayName, values.role,
          now, now, identity.subject),
      db.prepare(`INSERT INTO administrative_audit_records (
        id, actor_subject, actor_email, actor_staff_id, actor_role, action,
        resource_type, resource_id, request_id, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 'staff.created', 'staff', ?, ?, ?, ?)`)
        .bind(auditId, identity.subject, identity.email, identity.id, identity.role, id,
          options.requestId || null, JSON.stringify({role: values.role, active: true}), now),
    ]);
  } catch (caught) {
    if (/unique/i.test(String(caught?.message))) {
      throw new HttpError(409, 'A staff account already uses this Access identity or email.');
    }
    throw caught;
  }
  return await getStaffAccount(db, id);
}

export async function updateStaffAccount(db, staffId, input, actor, options = {}) {
  requirePermission(actor, 'staff.manage');
  const identity = auditActor(actor);
  const current = await getStaffAccount(db, staffId);
  if (!current) throw new HttpError(404, 'Staff account not found.');
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new HttpError(422, 'expectedVersion must be a positive integer.');
  }
  if (current.version !== expectedVersion) throw new HttpError(409, 'The staff account was updated by another request.');
  if ('accessSubject' in input) throw new HttpError(422, 'Access subject cannot be changed.');
  const next = {
    email: 'email' in input ? email(input.email) : current.email,
    displayName: 'displayName' in input ? text(input.displayName, 'Display name', 100) : current.displayName,
    role: 'role' in input ? role(input.role) : current.role,
    active: 'active' in input ? input.active : current.active,
  };
  if (typeof next.active !== 'boolean') throw new HttpError(422, 'Active must be true or false.');
  if (current.role === 'Owner' && current.active && (!next.active || next.role !== 'Owner')) {
    const owners = await db.prepare("SELECT COUNT(*) AS count FROM staff_accounts WHERE role = 'Owner' AND active = 1").first();
    if (Number(owners?.count || 0) <= 1) throw new HttpError(409, 'The final active owner cannot be deactivated or demoted.');
  }
  const now = new Date().toISOString();
  const newVersion = expectedVersion + 1;
  const auditId = crypto.randomUUID();
  let results;
  try {
    results = await db.batch([
      db.prepare(`UPDATE staff_accounts SET email = ?, display_name = ?, role = ?, active = ?,
        version = version + 1, updated_at = ?,
        deactivated_at = CASE WHEN ? = 0 THEN COALESCE(deactivated_at, ?) ELSE NULL END,
        deactivated_by_subject = CASE WHEN ? = 0 THEN ? ELSE NULL END
        WHERE id = ? AND version = ?
        AND NOT (
          role = 'Owner' AND active = 1 AND (? = 0 OR ? <> 'Owner')
          AND (SELECT COUNT(*) FROM staff_accounts WHERE role = 'Owner' AND active = 1) <= 1
        )`)
        .bind(next.email, next.displayName, next.role, next.active ? 1 : 0, now,
          next.active ? 1 : 0, now, next.active ? 1 : 0, identity.subject, staffId, expectedVersion,
          next.active ? 1 : 0, next.role),
      db.prepare(`INSERT INTO administrative_audit_records (
        id, actor_subject, actor_email, actor_staff_id, actor_role, action,
        resource_type, resource_id, request_id, details_json, created_at
      ) SELECT ?, ?, ?, ?, ?, 'staff.updated', 'staff', id, ?, ?, ?
        FROM staff_accounts WHERE id = ? AND version = ?`)
        .bind(auditId, identity.subject, identity.email, identity.id, identity.role,
          options.requestId || null,
          JSON.stringify({role: next.role, active: next.active, previousRole: current.role, previousActive: current.active}),
          now, staffId, newVersion),
    ]);
  } catch (caught) {
    if (/unique/i.test(String(caught?.message))) throw new HttpError(409, 'A staff account already uses this email.');
    throw caught;
  }
  if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
    throw new HttpError(409, 'The staff account was updated by another request.');
  }
  return await getStaffAccount(db, staffId);
}

export async function assignShipment(db, trackingNumber, input, actor, options = {}) {
  requirePermission(actor, 'shipments.assign');
  const identity = auditActor(actor);
  const tracking = normalizeTrackingNumber(trackingNumber);
  const shipment = await getAdminShipment(db, tracking);
  if (!shipment) throw new HttpError(404, 'Shipment not found.');
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new HttpError(422, 'expectedVersion must be a positive integer.');
  }
  if (shipment.version !== expectedVersion) throw new HttpError(409, 'The shipment was updated by another request.');
  const staffId = input.staffId == null || input.staffId === '' ? null : text(input.staffId, 'Staff ID', 100);
  const note = text(input.note ?? '', 'Assignment note', 300, {required: false});
  if (staffId) {
    const target = await db.prepare("SELECT id FROM staff_accounts WHERE id = ? AND role = 'Field Staff' AND active = 1")
      .bind(staffId).first();
    if (!target) throw new HttpError(422, 'Assignments require an active Field Staff account.');
  }
  const currentId = shipment.assignedStaff?.id || null;
  if (currentId === staffId) throw new HttpError(409, 'The shipment already has this assignment.');
  const now = new Date().toISOString();
  const newVersion = expectedVersion + 1;
  const assignmentId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`UPDATE shipments SET assigned_staff_id = ?, updated_at = ?, version = version + 1,
      assignment_sequence = assignment_sequence + 1, last_assignment_event_id = ?,
      assignment_acknowledged_at = NULL, assignment_acknowledged_by_staff_id = NULL,
      last_acknowledgement_event_id = NULL
      WHERE id = ? AND version = ?`)
      .bind(staffId, now, assignmentId, shipment.id, expectedVersion),
    db.prepare(`INSERT INTO shipment_assignment_history (
      id, shipment_id, previous_staff_id, assigned_staff_id, assigned_at,
      assigned_by_staff_id, assigned_by_subject, note
    ) SELECT ?, id, ?, ?, ?, ?, ?, ? FROM shipments
      WHERE id = ? AND version = ? AND last_assignment_event_id = ?`)
      .bind(assignmentId, currentId, staffId, now, identity.id, identity.subject, note,
        shipment.id, newVersion, assignmentId),
    db.prepare(`INSERT INTO administrative_audit_records (
      id, actor_subject, actor_email, actor_staff_id, actor_role, action,
      resource_type, resource_id, request_id, details_json, created_at
    ) SELECT ?, ?, ?, ?, ?, 'shipment.assignment_updated', 'shipment', id, ?, ?, ?
      FROM shipments WHERE id = ? AND version = ? AND last_assignment_event_id = ?`)
      .bind(auditId, identity.subject, identity.email, identity.id, identity.role,
        options.requestId || null, JSON.stringify({previousStaffId: currentId, assignedStaffId: staffId}),
        now, shipment.id, newVersion, assignmentId),
  ]);
  if (results.some(result => Number(result?.meta?.changes || 0) !== 1)) {
    throw new HttpError(409, 'The shipment was updated by another request.');
  }
  return await getAdminShipment(db, tracking);
}

export async function listAuditRecords(db, searchParams) {
  const {page, limit, offset} = parsePagination(searchParams, {defaultLimit: 50});
  const action = searchParams.get('action')?.trim();
  const resourceType = searchParams.get('resourceType')?.trim();
  const clauses = [];
  const bindings = [];
  if (action) {
    clauses.push('action = ?');
    bindings.push(text(action, 'Action', 100));
  }
  if (resourceType) {
    clauses.push('resource_type = ?');
    bindings.push(text(resourceType, 'Resource type', 60));
  }
  const actorStaffId = optionalText(searchParams.get('actorStaffId'), 'Actor staff ID', 100);
  if (actorStaffId) {
    clauses.push('actor_staff_id = ?');
    bindings.push(actorStaffId);
  }
  const from = optionalIsoDateTime(searchParams.get('from'), 'From');
  const to = optionalIsoDateTime(searchParams.get('to'), 'To', {endOfDay: true});
  validateDateRange(from, to);
  if (from) {
    clauses.push('created_at >= ?');
    bindings.push(from);
  }
  if (to) {
    clauses.push('created_at <= ?');
    bindings.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM administrative_audit_records ${where}`)
    .bind(...bindings).first();
  const result = await db.prepare(`SELECT id, actor_staff_id, actor_subject, actor_email, actor_role,
    action, resource_type, resource_id, request_id, details_json, created_at
    FROM administrative_audit_records ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset).all();
  return {
    page,
    limit,
    total: Number(total?.count || 0),
    items: (result.results || []).map(row => ({
      id: row.id,
      actor: {staffId: row.actor_staff_id, subject: row.actor_subject, email: row.actor_email, role: row.actor_role},
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      requestId: row.request_id,
      details: JSON.parse(row.details_json || '{}'),
      createdAt: row.created_at,
    })),
  };
}
