import {HttpError} from './http.js';

export const STAFF_ROLES = Object.freeze(['Owner', 'Receptionist', 'Field Staff']);

export const ROLE_PERMISSIONS = Object.freeze({
  Owner: Object.freeze([
    'staff.manage', 'audit.view', 'shipments.create', 'shipments.read.all',
    'shipments.status.all', 'shipments.assign', 'stats.all',
  ]),
  Receptionist: Object.freeze([
    'shipments.create', 'shipments.read.all', 'shipments.status.all',
    'shipments.assign', 'stats.all',
  ]),
  'Field Staff': Object.freeze([
    'shipments.read.assigned', 'shipments.status.assigned', 'stats.assigned',
  ]),
});

function staffFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    subject: row.access_subject,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    active: Boolean(row.active),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function resolveStaffIdentity(db, accessIdentity) {
  if (!accessIdentity?.subject) throw new HttpError(401, 'Administrative authentication is required.');
  const row = await db.prepare(`SELECT id, access_subject, email, display_name, role, active,
    version, created_at, updated_at FROM staff_accounts WHERE access_subject = ?`)
    .bind(accessIdentity.subject).first();
  if (!row) throw new HttpError(403, 'This staff identity has not been activated.');
  const staff = staffFromRow(row);
  if (!staff.active) throw new HttpError(403, 'This staff account is deactivated.');
  return staff;
}

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function hasPermission(staff, permission) {
  return permissionsForRole(staff?.role).includes(permission);
}

export function requirePermission(staff, permission) {
  if (!hasPermission(staff, permission)) {
    throw new HttpError(403, 'You do not have permission to perform this action.');
  }
}

export function requireRole(staff, allowedRoles) {
  if (!Array.isArray(allowedRoles) || !allowedRoles.includes(staff?.role)) {
    throw new HttpError(403, 'This staff role cannot access this portal.');
  }
}

export function shipmentScope(staff) {
  if (hasPermission(staff, 'shipments.read.all')) return {kind: 'all'};
  if (hasPermission(staff, 'shipments.read.assigned')) return {kind: 'assigned', staffId: staff.id};
  throw new HttpError(403, 'You do not have permission to view shipments.');
}

export async function requireShipmentAccess(db, staff, trackingNumber, action = 'read') {
  const allPermission = action === 'status' ? 'shipments.status.all' : 'shipments.read.all';
  const assignedPermission = action === 'status' ? 'shipments.status.assigned' : 'shipments.read.assigned';
  if (hasPermission(staff, allPermission)) return;
  if (!hasPermission(staff, assignedPermission)) {
    throw new HttpError(403, 'You do not have permission to access this shipment.');
  }
  const tracking = String(trackingNumber || '').trim().toUpperCase();
  const row = await db.prepare(`SELECT 1 AS allowed FROM shipments
    WHERE tracking_number = ? AND assigned_staff_id = ?`).bind(tracking, staff.id).first();
  if (!row) throw new HttpError(403, 'You do not have permission to access this shipment.');
}

export function publicStaff(staff) {
  return {
    id: staff.id,
    email: staff.email,
    displayName: staff.displayName,
    role: staff.role,
    active: staff.active,
    version: staff.version,
    permissions: [...permissionsForRole(staff.role)],
  };
}
