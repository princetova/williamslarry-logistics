import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalD1} from './helpers/local-d1.js';
import {
  acknowledgeAssignment, getAssignedDelivery, getStaffDashboardStats,
  listAssignedDeliveries, reportDeliveryIssue, updateAssignedDeliveryStatus,
} from '../functions/_lib/dispatch.js';
import {assignShipment} from '../functions/_lib/staff.js';
import {createShipment, getPublicTracking} from '../functions/_lib/shipments.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = [
  resolve(here, '../migrations/0001_create_shipment_tracking.sql'),
  resolve(here, '../migrations/0002_add_staff_authorization.sql'),
  resolve(here, '../migrations/0003_add_dispatch_workflow.sql'),
];
const seededAt = '2026-11-20T00:00:00.000Z';
const shipmentInput = {
  senderName: 'Synthetic Sender', senderPhone: '+2347000000201',
  receiverName: 'Synthetic Receiver', receiverPhone: '+2347000000202',
  originAddress: 'Private pickup address 21', originPublic: 'Owerri, Imo State',
  destinationAddress: 'Private delivery address 42', destinationPublic: 'Enugu, Enugu State',
  itemDescription: 'Administrative item description that workers must not receive',
  publicItemSummary: 'One synthetic parcel',
  internalNotes: 'Administrative note that workers must never receive',
  estimatedDeliveryDate: '2026-11-26', publicNote: 'Registered for synthetic testing',
};

function database() {
  return new LocalD1(migrations);
}

function seed(db, id, role) {
  const slug = id.replace(/[^a-z0-9]/gi, '');
  const staff = {
    id, subject: `access-${id}`, email: `${slug}@example.test`,
    displayName: `Synthetic ${role} ${id}`, role, active: true, version: 1,
  };
  db.database.prepare(`INSERT INTO staff_accounts (
    id, access_subject, email, display_name, role, active, version,
    created_at, updated_at, created_by_subject
  ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 'seed')`)
    .run(staff.id, staff.subject, staff.email, staff.displayName, staff.role, seededAt, seededAt);
  return staff;
}

test('staff delivery projection includes necessary contacts but excludes administrative information', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const worker = seed(db, 'field-1', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  const assigned = await assignShipment(db, shipment.trackingNumber, {
    staffId: worker.id, expectedVersion: 1,
  }, owner);
  const delivery = await getAssignedDelivery(db, shipment.trackingNumber, worker);
  assert.equal(delivery.pickup.phone, shipmentInput.senderPhone);
  assert.equal(delivery.delivery.address, shipmentInput.destinationAddress);
  assert.equal(delivery.assignment.acknowledgedAt, null);
  assert.equal(delivery.version, assigned.version);
  const serialized = JSON.stringify(delivery);
  assert.equal(serialized.includes(shipmentInput.internalNotes), false);
  assert.equal(serialized.includes(shipmentInput.itemDescription), false);
  assert.equal(serialized.includes('createdBy'), false);
  assert.equal(serialized.includes('actor'), false);
});

test('workers must acknowledge the current assignment before progress or issue updates', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const worker = seed(db, 'field-1', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  const assigned = await assignShipment(db, shipment.trackingNumber, {
    staffId: worker.id, expectedVersion: 1,
  }, owner);
  await assert.rejects(
    updateAssignedDeliveryStatus(db, shipment.trackingNumber, {
      status: 'Picked up', expectedVersion: assigned.version,
    }, worker),
    caught => caught.status === 409 && /Acknowledge/.test(caught.message),
  );
  await assert.rejects(
    reportDeliveryIssue(db, shipment.trackingNumber, {
      type: 'Delivery issue', operationalNote: 'Synthetic issue', expectedVersion: assigned.version,
    }, worker),
    caught => caught.status === 409 && /Acknowledge/.test(caught.message),
  );
});

test('concurrent acknowledgement creates one record and one audit event', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const worker = seed(db, 'field-1', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  await assignShipment(db, shipment.trackingNumber, {staffId: worker.id, expectedVersion: 1}, owner);
  const attempts = await Promise.allSettled([
    acknowledgeAssignment(db, shipment.trackingNumber, {expectedVersion: 2}, worker),
    acknowledgeAssignment(db, shipment.trackingNumber, {expectedVersion: 2}, worker),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM shipment_assignment_acknowledgements')[0].count, 1);
  assert.equal(db.rows("SELECT COUNT(*) AS count FROM administrative_audit_records WHERE action = 'shipment.assignment_acknowledged'")[0].count, 1);
});

test('same-target concurrent assignments and same-status updates cannot duplicate history or audit', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const worker = seed(db, 'field-1', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  const assignments = await Promise.allSettled([
    assignShipment(db, shipment.trackingNumber, {staffId: worker.id, expectedVersion: 1}, owner),
    assignShipment(db, shipment.trackingNumber, {staffId: worker.id, expectedVersion: 1}, owner),
  ]);
  assert.equal(assignments.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(assignments.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM shipment_assignment_history')[0].count, 1);
  assert.equal(db.rows("SELECT COUNT(*) AS count FROM administrative_audit_records WHERE action = 'shipment.assignment_updated'")[0].count, 1);

  await acknowledgeAssignment(db, shipment.trackingNumber, {expectedVersion: 2}, worker);
  await assert.rejects(
    updateAssignedDeliveryStatus(db, shipment.trackingNumber, {
      status: 'Picked up', expectedVersion: 3, internalNote: 'Attempted administrative note',
    }, worker),
    caught => caught.status === 403,
  );
  const updates = await Promise.allSettled([
    updateAssignedDeliveryStatus(db, shipment.trackingNumber, {status: 'Picked up', expectedVersion: 3}, worker),
    updateAssignedDeliveryStatus(db, shipment.trackingNumber, {status: 'Picked up', expectedVersion: 3}, worker),
  ]);
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(updates.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(db.rows("SELECT COUNT(*) AS count FROM shipment_status_history WHERE status = 'Picked up'")[0].count, 1);
  assert.equal(db.rows("SELECT COUNT(*) AS count FROM administrative_audit_records WHERE action = 'shipment.status_updated'")[0].count, 1);
});

test('reassignment immediately revokes the previous worker and requires a new acknowledgement', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const first = seed(db, 'field-1', 'Field Staff');
  const second = seed(db, 'field-2', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  await assignShipment(db, shipment.trackingNumber, {staffId: first.id, expectedVersion: 1}, owner);
  await acknowledgeAssignment(db, shipment.trackingNumber, {expectedVersion: 2}, first);
  const reassigned = await assignShipment(db, shipment.trackingNumber, {
    staffId: second.id, expectedVersion: 3,
  }, owner);
  assert.equal(reassigned.assignedStaff.id, second.id);
  assert.equal(reassigned.assignmentAcknowledgedAt, null);
  await assert.rejects(getAssignedDelivery(db, shipment.trackingNumber, first), caught => caught.status === 403);
  await assert.rejects(
    updateAssignedDeliveryStatus(db, shipment.trackingNumber, {
      status: 'Picked up', expectedVersion: reassigned.version,
    }, first),
    caught => caught.status === 403,
  );
  const secondView = await getAssignedDelivery(db, shipment.trackingNumber, second);
  assert.equal(secondView.assignment.sequence, 2);
  assert.equal(secondView.assignment.acknowledgedAt, null);
});

test('worker delay reports update public tracking while private issues remain operational only', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const worker = seed(db, 'field-1', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  await assignShipment(db, shipment.trackingNumber, {staffId: worker.id, expectedVersion: 1}, owner);
  await acknowledgeAssignment(db, shipment.trackingNumber, {expectedVersion: 2}, worker);
  await updateAssignedDeliveryStatus(db, shipment.trackingNumber, {
    status: 'Picked up', expectedVersion: 3, publicLocation: 'Owerri, Imo State',
  }, worker);
  const issue = await reportDeliveryIssue(db, shipment.trackingNumber, {
    type: 'Delivery issue', operationalNote: 'Synthetic access obstruction', expectedVersion: 4,
  }, worker);
  assert.equal(issue.currentStatus, 'Picked up');
  let publicValue = await getPublicTracking(db, shipment.trackingNumber);
  assert.equal(publicValue.history.length, 2);
  assert.equal(JSON.stringify(publicValue).includes('Synthetic access obstruction'), false);

  const delayed = await reportDeliveryIssue(db, shipment.trackingNumber, {
    type: 'Delay', operationalNote: 'Synthetic traffic disruption',
    publicLocation: 'Owerri, Imo State', publicNote: 'Delivery is delayed in transit.',
    expectedVersion: 5,
  }, worker);
  assert.equal(delayed.currentStatus, 'Delayed');
  publicValue = await getPublicTracking(db, shipment.trackingNumber);
  assert.equal(publicValue.currentStatus, 'Delayed');
  assert.equal(publicValue.history.at(-1).note, 'Delivery is delayed in transit.');
  assert.equal(JSON.stringify(publicValue).includes('Synthetic traffic disruption'), false);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM shipment_delivery_issues')[0].count, 2);
});

test('staff lists and statistics contain only current assignments', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const first = seed(db, 'field-1', 'Field Staff');
  const second = seed(db, 'field-2', 'Field Staff');
  const one = await createShipment(db, shipmentInput, owner);
  const two = await createShipment(db, {...shipmentInput, receiverName: 'Other Receiver'}, owner);
  await assignShipment(db, one.trackingNumber, {staffId: first.id, expectedVersion: 1}, owner);
  await assignShipment(db, two.trackingNumber, {staffId: second.id, expectedVersion: 1}, owner);
  const list = await listAssignedDeliveries(db, new URLSearchParams(), first);
  assert.equal(list.total, 1);
  assert.equal(list.items[0].trackingNumber, one.trackingNumber);
  const stats = await getStaffDashboardStats(db, first);
  assert.equal(stats.total, 1);
  assert.equal(stats.awaitingAcknowledgement, 1);
});
