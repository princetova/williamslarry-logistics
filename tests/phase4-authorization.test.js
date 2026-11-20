import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  hasPermission, permissionsForRole, requirePermission, requireShipmentAccess,
  resolveStaffIdentity, shipmentScope,
} from '../functions/_lib/authorization.js';
import {
  createStaffAccount, updateStaffAccount, assignShipment, listAuditRecords,
} from '../functions/_lib/staff.js';
import {
  createShipment, getDashboardStats, listShipments, updateShipmentStatus,
} from '../functions/_lib/shipments.js';
import {LocalD1} from './helpers/local-d1.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = [
  resolve(here, '../migrations/0001_create_shipment_tracking.sql'),
  resolve(here, '../migrations/0002_add_staff_authorization.sql'),
  resolve(here, '../migrations/0003_add_dispatch_workflow.sql'),
  resolve(here, '../migrations/0004_add_admin_portal_monitoring.sql'),
];
const now = '2026-11-20T00:00:00.000Z';
const shipmentInput = {
  senderName: 'Synthetic Sender', senderPhone: '+2347000000001',
  receiverName: 'Synthetic Receiver', receiverPhone: '+2347000000002',
  originAddress: 'Private origin address', originPublic: 'Owerri, Imo State',
  destinationAddress: 'Private destination address', destinationPublic: 'Lagos, Lagos State',
  itemDescription: 'Private synthetic item description', publicItemSummary: 'One parcel',
  estimatedDeliveryDate: '2026-11-25', internalNotes: 'Synthetic private note',
};

function database() {
  return new LocalD1(migrations);
}

function seedStaff(db, {
  id, subject, email, displayName, role, active = true, version = 1,
}) {
  db.database.prepare(`INSERT INTO staff_accounts (
    id, access_subject, email, display_name, role, active, version,
    created_at, updated_at, created_by_subject
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, subject, email, displayName, role, active ? 1 : 0, version, now, now, 'seed-owner');
  return {id, subject, email, displayName, role, active, version};
}

function actors(db) {
  return {
    owner: seedStaff(db, {
      id: 'owner-1', subject: 'access-owner-1', email: 'owner@example.test',
      displayName: 'Synthetic Owner', role: 'Owner',
    }),
    receptionist: seedStaff(db, {
      id: 'reception-1', subject: 'access-reception-1', email: 'reception@example.test',
      displayName: 'Synthetic Receptionist', role: 'Receptionist',
    }),
    field: seedStaff(db, {
      id: 'field-1', subject: 'access-field-1', email: 'field@example.test',
      displayName: 'Synthetic Field Staff', role: 'Field Staff',
    }),
  };
}

test('permission matrix grants only the intended capabilities', () => {
  const owner = {role: 'Owner'};
  const receptionist = {role: 'Receptionist'};
  const field = {role: 'Field Staff'};
  assert.equal(hasPermission(owner, 'staff.manage'), true);
  assert.equal(hasPermission(owner, 'audit.view'), true);
  assert.equal(hasPermission(receptionist, 'staff.manage'), false);
  assert.equal(hasPermission(receptionist, 'shipments.assign'), true);
  assert.equal(hasPermission(field, 'shipments.read.all'), false);
  assert.equal(hasPermission(field, 'shipments.read.assigned'), true);
  assert.equal(hasPermission(field, 'shipments.create'), false);
  assert.throws(() => requirePermission(field, 'shipments.create'), caught => caught.status === 403);
  assert.deepEqual(permissionsForRole('Unknown'), []);
});

test('staff identities are resolved by immutable Access subject and inactive or unknown accounts fail closed', async t => {
  const db = database();
  t.after(() => db.close());
  const {field} = actors(db);
  const resolved = await resolveStaffIdentity(db, {subject: field.subject, email: field.email});
  assert.equal(resolved.id, field.id);
  assert.equal(resolved.role, 'Field Staff');
  await assert.rejects(
    resolveStaffIdentity(db, {subject: 'not-provisioned'}),
    caught => caught.status === 403 && /not been activated/.test(caught.message),
  );
  db.database.prepare('UPDATE staff_accounts SET active = 0 WHERE id = ?').run(field.id);
  await assert.rejects(
    resolveStaffIdentity(db, {subject: field.subject}),
    caught => caught.status === 403 && /deactivated/.test(caught.message),
  );
  assert.throws(
    () => db.database.prepare("UPDATE staff_accounts SET access_subject = 'changed' WHERE id = ?").run(field.id),
    /immutable/,
  );
});

test('only owners can create staff accounts and creation is audited without storing credentials', async t => {
  const db = database();
  t.after(() => db.close());
  const {owner, receptionist} = actors(db);
  const input = {
    accessSubject: 'access-field-2', email: 'field2@example.test',
    displayName: 'Second Field Staff', role: 'Field Staff',
  };
  await assert.rejects(createStaffAccount(db, input, receptionist), caught => caught.status === 403);
  const created = await createStaffAccount(db, input, owner, {requestId: 'synthetic-ray'});
  assert.equal(created.role, 'Field Staff');
  assert.equal(created.active, true);
  const audit = db.rows("SELECT * FROM administrative_audit_records WHERE action = 'staff.created'");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_staff_id, owner.id);
  assert.equal(audit[0].actor_role, 'Owner');
  assert.equal(JSON.stringify(audit[0]).includes('access-field-2'), false);
  await assert.rejects(createStaffAccount(db, {...input, accessSubject: 'different'}, owner), caught => caught.status === 409);
});

test('staff activation and role changes use optimistic concurrency and preserve a final active owner', async t => {
  const db = database();
  t.after(() => db.close());
  const {owner, field} = actors(db);
  await assert.rejects(
    updateStaffAccount(db, owner.id, {active: false, expectedVersion: 1}, owner),
    caught => caught.status === 409 && /final active owner/.test(caught.message),
  );
  const secondOwner = seedStaff(db, {
    id: 'owner-2', subject: 'access-owner-2', email: 'owner2@example.test',
    displayName: 'Second Owner', role: 'Owner',
  });
  const disabled = await updateStaffAccount(db, field.id, {active: false, expectedVersion: 1}, owner);
  assert.equal(disabled.active, false);
  assert.equal(disabled.version, 2);
  await assert.rejects(
    updateStaffAccount(db, field.id, {active: true, expectedVersion: 1}, owner),
    caught => caught.status === 409,
  );
  const demoted = await updateStaffAccount(db, secondOwner.id, {
    role: 'Receptionist', expectedVersion: 1,
  }, owner);
  assert.equal(demoted.role, 'Receptionist');
  assert.equal(db.rows("SELECT COUNT(*) AS count FROM administrative_audit_records WHERE action = 'staff.updated'")[0].count, 2);
});

test('field staff can see and update only assigned shipments while reception and owner retain operational access', async t => {
  const db = database();
  t.after(() => db.close());
  const {owner, receptionist, field} = actors(db);
  const assigned = await createShipment(db, shipmentInput, owner);
  const unassigned = await createShipment(db, {...shipmentInput, senderName: 'Other Sender'}, receptionist);
  const linked = await assignShipment(db, assigned.trackingNumber, {
    staffId: field.id, expectedVersion: assigned.version, note: 'Synthetic route assignment',
  }, receptionist);
  assert.equal(linked.assignedStaff.id, field.id);
  assert.equal(linked.version, 2);

  const fieldList = await listShipments(db, new URLSearchParams(), shipmentScope(field));
  assert.deepEqual(fieldList.items.map(item => item.trackingNumber), [assigned.trackingNumber]);
  const receptionList = await listShipments(db, new URLSearchParams(), shipmentScope(receptionist));
  assert.equal(receptionList.total, 2);
  await requireShipmentAccess(db, field, assigned.trackingNumber.toLowerCase());
  await assert.rejects(
    requireShipmentAccess(db, field, unassigned.trackingNumber),
    caught => caught.status === 403,
  );
  await assert.rejects(
    updateShipmentStatus(db, assigned.trackingNumber, {
      status: 'Cancelled', expectedVersion: 2,
    }, field),
    caught => caught.status === 403,
  );
  const pickedUp = await updateShipmentStatus(db, assigned.trackingNumber, {
    status: 'Picked up', expectedVersion: 2, publicLocation: 'Owerri, Imo State',
  }, field);
  assert.equal(pickedUp.currentStatus, 'Picked up');
  const fieldStats = await getDashboardStats(db, shipmentScope(field));
  assert.equal(fieldStats.total, 1);
  assert.equal(fieldStats.byStatus['Picked up'], 1);
});

test('assignment changes are atomic, append-only, audited and concurrency protected', async t => {
  const db = database();
  t.after(() => db.close());
  const {owner, field} = actors(db);
  const otherField = seedStaff(db, {
    id: 'field-2', subject: 'access-field-2', email: 'field2@example.test',
    displayName: 'Second Field Staff', role: 'Field Staff',
  });
  const shipment = await createShipment(db, shipmentInput, owner);
  const competing = await Promise.allSettled([
    assignShipment(db, shipment.trackingNumber, {staffId: field.id, expectedVersion: 1}, owner),
    assignShipment(db, shipment.trackingNumber, {staffId: otherField.id, expectedVersion: 1}, owner),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(competing.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM shipment_assignment_history')[0].count, 1);
  assert.equal(db.rows("SELECT COUNT(*) AS count FROM administrative_audit_records WHERE action = 'shipment.assignment_updated'")[0].count, 1);
  assert.throws(() => db.database.prepare('DELETE FROM shipment_assignment_history').run(), /append-only/);
});

test('audit records are owner-only at authorization boundary and paginate without customer payloads', async t => {
  const db = database();
  t.after(() => db.close());
  const {owner, receptionist} = actors(db);
  await createShipment(db, shipmentInput, owner);
  requirePermission(owner, 'audit.view');
  assert.throws(() => requirePermission(receptionist, 'audit.view'), caught => caught.status === 403);
  const result = await listAuditRecords(db, new URLSearchParams('limit=10'));
  assert.equal(result.total, 1);
  assert.equal(result.items[0].action, 'shipment.created');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(shipmentInput.senderPhone), false);
  assert.equal(serialized.includes(shipmentInput.originAddress), false);
});
