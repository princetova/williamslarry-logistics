import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalD1} from './helpers/local-d1.js';
import {assignShipment} from '../functions/_lib/staff.js';
import {createShipment, getPublicTracking} from '../functions/_lib/shipments.js';
import {onRequestGet as staffMeEndpoint} from '../functions/api/staff/me.js';
import {onRequestGet as staffStatsEndpoint} from '../functions/api/staff/stats.js';
import {onRequestGet as listEndpoint} from '../functions/api/staff/deliveries/index.js';
import {onRequestGet as detailEndpoint} from '../functions/api/staff/deliveries/[trackingNumber].js';
import {onRequestPost as acknowledgeEndpoint} from '../functions/api/staff/deliveries/[trackingNumber]/acknowledge.js';
import {onRequestPost as statusEndpoint} from '../functions/api/staff/deliveries/[trackingNumber]/status.js';
import {onRequestPost as issueEndpoint} from '../functions/api/staff/deliveries/[trackingNumber]/issues.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = [
  resolve(here, '../migrations/0001_create_shipment_tracking.sql'),
  resolve(here, '../migrations/0002_add_staff_authorization.sql'),
  resolve(here, '../migrations/0003_add_dispatch_workflow.sql'),
];
const createdAt = '2026-11-20T00:00:00.000Z';
const input = {
  senderName: 'Synthetic Sender', senderPhone: '+2347000000301',
  receiverName: 'Synthetic Receiver', receiverPhone: '+2347000000302',
  originAddress: 'Private pickup address', originPublic: 'Owerri, Imo State',
  destinationAddress: 'Private delivery address', destinationPublic: 'Aba, Abia State',
  itemDescription: 'Private administrative cargo description', publicItemSummary: 'One parcel',
  internalNotes: 'Private administrator-only note',
};

function seed(db, id, role) {
  const staff = {
    id, subject: `access-${id}`, email: `${id}@example.test`,
    displayName: `Synthetic ${role}`, role, active: true, version: 1,
  };
  db.database.prepare(`INSERT INTO staff_accounts (
    id, access_subject, email, display_name, role, active, version,
    created_at, updated_at, created_by_subject
  ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 'seed')`)
    .run(id, staff.subject, staff.email, staff.displayName, role, createdAt, createdAt);
  return staff;
}

function post(url, body) {
  return new Request(url, {
    method: 'POST', headers: {'content-type': 'application/json', 'CF-Ray': 'phase4b-test-ray'},
    body: JSON.stringify(body),
  });
}

test('staff API contract covers identity, dashboard, delivery, acknowledgement, progress and issues', async t => {
  const db = new LocalD1(migrations);
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const worker = seed(db, 'field-1', 'Field Staff');
  const shipment = await createShipment(db, input, owner);
  await assignShipment(db, shipment.trackingNumber, {staffId: worker.id, expectedVersion: 1}, owner);
  const env = {SHIPMENTS_DB: db};
  const data = {staff: worker};
  const params = {trackingNumber: shipment.trackingNumber};

  const me = staffMeEndpoint({data});
  assert.equal(me.status, 200);
  assert.equal((await me.json()).staff.role, 'Field Staff');

  const stats = await staffStatsEndpoint({env, data});
  assert.equal(stats.status, 200);
  assert.equal((await stats.json()).stats.awaitingAcknowledgement, 1);

  const list = await listEndpoint({
    request: new Request('https://williamslarrylogistics.com/api/staff/deliveries'), env, data,
  });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).total, 1);

  const detail = await detailEndpoint({env, data, params});
  assert.equal(detail.status, 200);
  const detailText = await detail.text();
  assert.equal(detailText.includes(input.senderPhone), true);
  assert.equal(detailText.includes(input.internalNotes), false);
  assert.equal(detailText.includes(input.itemDescription), false);

  const acknowledgement = await acknowledgeEndpoint({
    request: post(`https://williamslarrylogistics.com/api/staff/deliveries/${shipment.trackingNumber}/acknowledge`, {
      expectedVersion: 2,
    }), env, data, params,
  });
  assert.equal(acknowledgement.status, 200);
  assert.equal(Boolean((await acknowledgement.json()).delivery.assignment.acknowledgedAt), true);

  const progress = await statusEndpoint({
    request: post(`https://williamslarrylogistics.com/api/staff/deliveries/${shipment.trackingNumber}/status`, {
      status: 'Picked up', expectedVersion: 3, publicLocation: 'Owerri, Imo State',
      publicNote: 'Parcel collected.',
    }), env, data, params,
  });
  assert.equal(progress.status, 200);
  assert.equal((await progress.json()).delivery.currentStatus, 'Picked up');

  const issue = await issueEndpoint({
    request: post(`https://williamslarrylogistics.com/api/staff/deliveries/${shipment.trackingNumber}/issues`, {
      type: 'Delay', expectedVersion: 4, operationalNote: 'Synthetic traffic disruption',
      publicLocation: 'Owerri, Imo State', publicNote: 'Delivery is delayed.',
    }), env, data, params,
  });
  assert.equal(issue.status, 200);
  assert.equal((await issue.json()).delivery.currentStatus, 'Delayed');
  const publicTracking = await getPublicTracking(db, shipment.trackingNumber);
  assert.equal(publicTracking.currentStatus, 'Delayed');
  assert.equal(publicTracking.history.at(-1).note, 'Delivery is delayed.');
  assert.equal(JSON.stringify(publicTracking).includes('Synthetic traffic disruption'), false);
});

test('staff detail endpoint denies a valid but differently assigned worker', async t => {
  const db = new LocalD1(migrations);
  t.after(() => db.close());
  const owner = seed(db, 'owner-1', 'Owner');
  const assigned = seed(db, 'field-1', 'Field Staff');
  const other = seed(db, 'field-2', 'Field Staff');
  const shipment = await createShipment(db, input, owner);
  await assignShipment(db, shipment.trackingNumber, {staffId: assigned.id, expectedVersion: 1}, owner);
  const denied = await detailEndpoint({
    env: {SHIPMENTS_DB: db}, data: {staff: other},
    params: {trackingNumber: shipment.trackingNumber},
  });
  assert.equal(denied.status, 403);
});
