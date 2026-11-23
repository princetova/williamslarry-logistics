import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalD1} from './helpers/local-d1.js';
import {
  getAcknowledgementHistory, getAdminDashboardStats, getAssignmentHistory,
  getDeliveryIssue, listDeliveryIssues, listDispatchWorkers, resolveDeliveryIssue,
} from '../functions/_lib/admin-portal.js';
import {acknowledgeAssignment, reportDeliveryIssue} from '../functions/_lib/dispatch.js';
import {assignShipment, listAuditRecords} from '../functions/_lib/staff.js';
import {createShipment, listShipments} from '../functions/_lib/shipments.js';
import {onRequestGet as workersEndpoint} from '../functions/api/admin/dispatch/workers.js';
import {onRequestGet as issuesEndpoint} from '../functions/api/admin/issues/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = [
  resolve(here, '../migrations/0001_create_shipment_tracking.sql'),
  resolve(here, '../migrations/0002_add_staff_authorization.sql'),
  resolve(here, '../migrations/0003_add_dispatch_workflow.sql'),
  resolve(here, '../migrations/0004_add_admin_portal_monitoring.sql'),
];
const seededAt = '2026-11-20T00:00:00.000Z';
const shipmentInput = {
  senderName: 'Private Sender', senderPhone: '+2347000000301',
  receiverName: 'Private Receiver', receiverPhone: '+2347000000302',
  originAddress: 'Private pickup street 31', originPublic: 'Owerri, Imo State',
  destinationAddress: 'Private destination street 62', destinationPublic: 'Aba, Abia State',
  itemDescription: 'Private detailed contents', publicItemSummary: 'One synthetic parcel',
  internalNotes: 'Confidential administration note', estimatedDeliveryDate: '2026-11-28',
  publicNote: 'Registered for testing',
};

function database() {
  return new LocalD1(migrations);
}

function seed(db, id, role, active = true) {
  const staff = {
    id, subject: `access-${id}`, email: `${id}@private.example.test`,
    displayName: `Synthetic ${id}`, role, active, version: 1,
  };
  db.database.prepare(`INSERT INTO staff_accounts (
    id, access_subject, email, display_name, role, active, version,
    created_at, updated_at, created_by_subject
  ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'seed')`)
    .run(staff.id, staff.subject, staff.email, staff.displayName, staff.role,
      active ? 1 : 0, seededAt, seededAt);
  return staff;
}

async function assignedIssueFixture(db) {
  const owner = seed(db, 'owner-1', 'Owner');
  const worker = seed(db, 'field-1', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  await assignShipment(db, shipment.trackingNumber, {
    staffId: worker.id, expectedVersion: 1, note: 'Synthetic dispatch',
  }, owner);
  await acknowledgeAssignment(db, shipment.trackingNumber, {expectedVersion: 2}, worker);
  await reportDeliveryIssue(db, shipment.trackingNumber, {
    type: 'Delivery issue', operationalNote: 'Gate access unavailable', expectedVersion: 3,
  }, worker);
  const issueId = db.rows('SELECT id FROM shipment_delivery_issues')[0].id;
  return {owner, worker, shipment, issueId};
}

test('dispatch directory exposes active Field Staff workload without identity secrets', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  seed(db, 'reception-1', 'Receptionist');
  const worker = seed(db, 'field-1', 'Field Staff');
  seed(db, 'field-inactive', 'Field Staff', false);
  const shipment = await createShipment(db, shipmentInput, owner);
  await assignShipment(db, shipment.trackingNumber, {staffId: worker.id, expectedVersion: 1}, owner);
  const result = await listDispatchWorkers(db, new URLSearchParams());
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0], {
    id: worker.id,
    displayName: worker.displayName,
    workload: {activeAssigned: 1, pendingAcknowledgements: 1, delayed: 0},
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(worker.email), false);
  assert.equal(serialized.includes(worker.subject), false);
  await assert.rejects(listDispatchWorkers(db, new URLSearchParams('limit=101')), error => error.status === 422);
});

test('Phase 4C admin endpoints allow Receptionist operations and reject Field Staff', async t => {
  const db = database();
  t.after(() => db.close());
  const receptionist = seed(db, 'reception-1', 'Receptionist');
  const worker = seed(db, 'field-1', 'Field Staff');
  const request = new Request('https://williamslarrylogistics.com/api/admin/dispatch/workers');
  let response = await workersEndpoint({request, env: {SHIPMENTS_DB: db}, data: {staff: receptionist}});
  assert.equal(response.status, 200);
  response = await workersEndpoint({request, env: {SHIPMENTS_DB: db}, data: {staff: worker}});
  assert.equal(response.status, 403);
  response = await issuesEndpoint({
    request: new Request('https://williamslarrylogistics.com/api/admin/issues'),
    env: {SHIPMENTS_DB: db}, data: {staff: worker},
  });
  assert.equal(response.status, 403);
});

test('shipment lists include safe assignment summaries and acknowledgement filters', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const worker = seed(db, 'field-1', 'Field Staff');
  const assignedShipment = await createShipment(db, shipmentInput, owner);
  await createShipment(db, {...shipmentInput, receiverName: 'Second Private Receiver'}, owner);
  await assignShipment(db, assignedShipment.trackingNumber, {staffId: worker.id, expectedVersion: 1}, owner);
  let result = await listShipments(db, new URLSearchParams('assignment=pending'));
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].assignedStaff, {
    id: worker.id, displayName: worker.displayName, active: true,
  });
  assert.equal(result.items[0].assignmentAcknowledgedAt, null);
  assert.equal(JSON.stringify(result).includes(worker.email), false);
  await acknowledgeAssignment(db, assignedShipment.trackingNumber, {expectedVersion: 2}, worker);
  result = await listShipments(db, new URLSearchParams(`assignment=acknowledged&assignedStaffId=${worker.id}`));
  assert.equal(result.total, 1);
  assert.ok(result.items[0].assignmentAcknowledgedAt);
  assert.equal((await listShipments(db, new URLSearchParams('assignment=unassigned'))).total, 1);
  await assert.rejects(listShipments(db, new URLSearchParams('assignment=unknown')), error => error.status === 422);
});

test('admin statistics report dispatch queues, open issues and active staff workload', async t => {
  const db = database();
  t.after(() => db.close());
  const {owner, issueId} = await assignedIssueFixture(db);
  await createShipment(db, {...shipmentInput, receiverName: 'Unassigned Receiver'}, owner);
  let stats = await getAdminDashboardStats(db);
  assert.equal(stats.unassignedActive, 1);
  assert.equal(stats.pendingAcknowledgements, 0);
  assert.equal(stats.openDeliveryIssues, 1);
  assert.equal(stats.staffWorkload.length, 1);
  assert.equal(stats.staffWorkload[0].activeAssigned, 1);
  await resolveDeliveryIssue(db, issueId, {resolutionNote: 'Access arranged'}, owner);
  stats = await getAdminDashboardStats(db);
  assert.equal(stats.openDeliveryIssues, 0);
});

test('delivery issue monitoring is private, filterable, append-only and concurrency safe', async t => {
  const db = database();
  t.after(() => db.close());
  const {owner, worker, shipment, issueId} = await assignedIssueFixture(db);
  const list = await listDeliveryIssues(db, new URLSearchParams(
    `state=open&type=Delivery%20issue&trackingNumber=${shipment.trackingNumber}&reportedByStaffId=${worker.id}`,
  ));
  assert.equal(list.total, 1);
  assert.equal(list.items[0].operationalNote, 'Gate access unavailable');
  const serialized = JSON.stringify(list);
  for (const privateValue of [shipmentInput.senderPhone, shipmentInput.receiverPhone,
    shipmentInput.originAddress, shipmentInput.destinationAddress, owner.email, worker.email,
    owner.subject, worker.subject, shipmentInput.internalNotes]) {
    assert.equal(serialized.includes(privateValue), false);
  }
  assert.equal((await getDeliveryIssue(db, issueId)).resolution, null);
  const attempts = await Promise.allSettled([
    resolveDeliveryIssue(db, issueId, {resolutionNote: 'Resolved once'}, owner),
    resolveDeliveryIssue(db, issueId, {resolutionNote: 'Resolved twice'}, owner),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM shipment_delivery_issue_resolutions')[0].count, 1);
  assert.equal(db.rows("SELECT COUNT(*) AS count FROM administrative_audit_records WHERE action = 'shipment.delivery_issue_resolved'")[0].count, 1);
  await assert.rejects(
    db.prepare('UPDATE shipment_delivery_issue_resolutions SET resolution_note = ? WHERE issue_id = ?')
      .bind('Changed', issueId).run(),
    /append-only/,
  );
  assert.equal((await listDeliveryIssues(db, new URLSearchParams('state=open'))).total, 0);
  assert.equal((await listDeliveryIssues(db, new URLSearchParams('state=resolved'))).total, 1);
});

test('assignment histories and owner audit filters are paginated and privacy-limited', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const first = seed(db, 'field-1', 'Field Staff');
  const second = seed(db, 'field-2', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  await assignShipment(db, shipment.trackingNumber, {staffId: first.id, expectedVersion: 1}, owner);
  await acknowledgeAssignment(db, shipment.trackingNumber, {expectedVersion: 2}, first);
  await assignShipment(db, shipment.trackingNumber, {staffId: second.id, expectedVersion: 3}, owner);
  const assignments = await getAssignmentHistory(db, shipment.trackingNumber, new URLSearchParams('limit=1'));
  const acknowledgements = await getAcknowledgementHistory(db, shipment.trackingNumber, new URLSearchParams());
  assert.equal(assignments.total, 2);
  assert.equal(assignments.items.length, 1);
  assert.equal(assignments.items[0].assignedStaff.id, second.id);
  assert.equal(acknowledgements.total, 1);
  assert.equal(acknowledgements.items[0].staff.id, first.id);
  const serialized = JSON.stringify({assignments, acknowledgements});
  assert.equal(serialized.includes(first.email), false);
  assert.equal(serialized.includes(first.subject), false);
  assert.equal(serialized.includes(shipmentInput.receiverPhone), false);
  const filteredAudit = await listAuditRecords(db, new URLSearchParams(
    `actorStaffId=${owner.id}&from=2020-01-01&to=2030-12-31&limit=100`,
  ));
  assert.ok(filteredAudit.total >= 3);
  assert.ok(filteredAudit.items.every(item => item.actor.staffId === owner.id));
  await assert.rejects(
    listAuditRecords(db, new URLSearchParams('from=2030-01-01&to=2020-01-01')),
    error => error.status === 422,
  );
  await assert.rejects(
    listAuditRecords(db, new URLSearchParams('from=2026-02-31')),
    error => error.status === 422,
  );
  await assert.rejects(
    getAssignmentHistory(db, shipment.trackingNumber, new URLSearchParams('page=0')),
    error => error.status === 422,
  );
});
