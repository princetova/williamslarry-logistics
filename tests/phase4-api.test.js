import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalD1} from './helpers/local-d1.js';
import {createShipment} from '../functions/_lib/shipments.js';
import {onRequestGet as meEndpoint} from '../functions/api/admin/me.js';
import {
  onRequestGet as listStaffEndpoint, onRequestPost as createStaffEndpoint,
} from '../functions/api/admin/staff/index.js';
import {onRequestPost as assignmentEndpoint} from '../functions/api/admin/shipments/[trackingNumber]/assignment.js';
import {onRequestGet as listShipmentsEndpoint} from '../functions/api/admin/shipments/index.js';
import {onRequestGet as detailEndpoint} from '../functions/api/admin/shipments/[trackingNumber].js';
import {onRequestGet as auditEndpoint} from '../functions/api/admin/audit.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = [
  resolve(here, '../migrations/0001_create_shipment_tracking.sql'),
  resolve(here, '../migrations/0002_add_staff_authorization.sql'),
];
const now = '2026-11-20T00:00:00.000Z';
const shipmentInput = {
  senderName: 'Synthetic Sender', senderPhone: '+2347000000101',
  receiverName: 'Synthetic Receiver', receiverPhone: '+2347000000102',
  originAddress: 'Private synthetic origin', originPublic: 'Owerri, Imo State',
  destinationAddress: 'Private synthetic destination', destinationPublic: 'Abuja, FCT',
  itemDescription: 'Private synthetic cargo', publicItemSummary: 'One parcel',
};

function database() {
  return new LocalD1(migrations);
}

function seed(db, id, subject, email, displayName, role) {
  db.database.prepare(`INSERT INTO staff_accounts (
    id, access_subject, email, display_name, role, active, version,
    created_at, updated_at, created_by_subject
  ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 'seed')`)
    .run(id, subject, email, displayName, role, now, now);
  return {id, subject, email, displayName, role, active: true, version: 1};
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'CF-Ray': 'synthetic-phase4-ray'},
    body: JSON.stringify(body),
  });
}

test('Phase 4 API exposes current identity permissions without the Access subject', async t => {
  const db = database();
  t.after(() => db.close());
  const field = seed(db, 'field-1', 'access-field-1', 'field@example.test', 'Synthetic Field', 'Field Staff');
  const response = meEndpoint({data: {staff: field}});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.staff.role, 'Field Staff');
  assert.equal(payload.staff.permissions.includes('shipments.read.assigned'), true);
  assert.equal(JSON.stringify(payload).includes(field.subject), false);
});

test('staff administration endpoints enforce owner-only management', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'access-owner-1', 'owner@example.test', 'Synthetic Owner', 'Owner');
  const receptionist = seed(db, 'reception-1', 'access-reception-1', 'reception@example.test', 'Synthetic Reception', 'Receptionist');
  const body = {
    accessSubject: 'access-field-2', email: 'field2@example.test',
    displayName: 'Second Field', role: 'Field Staff',
  };
  const denied = await createStaffEndpoint({
    request: jsonRequest('https://williamslarrylogistics.com/api/admin/staff', body),
    env: {SHIPMENTS_DB: db}, data: {staff: receptionist},
  });
  assert.equal(denied.status, 403);
  const created = await createStaffEndpoint({
    request: jsonRequest('https://williamslarrylogistics.com/api/admin/staff', body),
    env: {SHIPMENTS_DB: db}, data: {staff: owner},
  });
  assert.equal(created.status, 201);
  const list = await listStaffEndpoint({
    request: new Request('https://williamslarrylogistics.com/api/admin/staff?role=Field%20Staff'),
    env: {SHIPMENTS_DB: db}, data: {staff: owner},
  });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).total, 1);
});

test('assignment and shipment endpoints enforce staff-specific delivery access', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'access-owner-1', 'owner@example.test', 'Synthetic Owner', 'Owner');
  const field = seed(db, 'field-1', 'access-field-1', 'field@example.test', 'Synthetic Field', 'Field Staff');
  const otherField = seed(db, 'field-2', 'access-field-2', 'field2@example.test', 'Other Field', 'Field Staff');
  const shipment = await createShipment(db, shipmentInput, owner);
  const assignment = await assignmentEndpoint({
    request: jsonRequest(
      `https://williamslarrylogistics.com/api/admin/shipments/${shipment.trackingNumber}/assignment`,
      {staffId: field.id, expectedVersion: 1},
    ),
    env: {SHIPMENTS_DB: db}, params: {trackingNumber: shipment.trackingNumber}, data: {staff: owner},
  });
  assert.equal(assignment.status, 200);
  assert.equal((await assignment.json()).shipment.assignedStaff.id, field.id);

  const fieldList = await listShipmentsEndpoint({
    request: new Request('https://williamslarrylogistics.com/api/admin/shipments'),
    env: {SHIPMENTS_DB: db}, data: {staff: field},
  });
  assert.equal(fieldList.status, 200);
  assert.equal((await fieldList.json()).total, 1);

  const allowed = await detailEndpoint({
    env: {SHIPMENTS_DB: db}, params: {trackingNumber: shipment.trackingNumber}, data: {staff: field},
  });
  assert.equal(allowed.status, 200);
  const denied = await detailEndpoint({
    env: {SHIPMENTS_DB: db}, params: {trackingNumber: shipment.trackingNumber}, data: {staff: otherField},
  });
  assert.equal(denied.status, 403);
});

test('audit endpoint is owner-only and returns operational metadata rather than customer contacts', async t => {
  const db = database();
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'access-owner-1', 'owner@example.test', 'Synthetic Owner', 'Owner');
  const receptionist = seed(db, 'reception-1', 'access-reception-1', 'reception@example.test', 'Synthetic Reception', 'Receptionist');
  await createShipment(db, shipmentInput, owner);
  const denied = await auditEndpoint({
    request: new Request('https://williamslarrylogistics.com/api/admin/audit'),
    env: {SHIPMENTS_DB: db}, data: {staff: receptionist},
  });
  assert.equal(denied.status, 403);
  const allowed = await auditEndpoint({
    request: new Request('https://williamslarrylogistics.com/api/admin/audit'),
    env: {SHIPMENTS_DB: db}, data: {staff: owner},
  });
  assert.equal(allowed.status, 200);
  const serialized = JSON.stringify(await allowed.json());
  assert.equal(serialized.includes(shipmentInput.senderPhone), false);
  assert.equal(serialized.includes(shipmentInput.originAddress), false);
});
