import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {LocalD1, FakeKV} from './helpers/local-d1.js';
import {
  createShipment, createTrackingNumber, getAdminHistory, getAdminShipment,
  getPublicTracking, updateShipmentStatus,
} from '../functions/_lib/shipments.js';
import {onRequestGet as publicLookup} from '../functions/api/tracking/[trackingNumber].js';
import {onRequestPost as createEndpoint} from '../functions/api/admin/shipments/index.js';
import {onRequestGet as statsEndpoint} from '../functions/api/admin/stats.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = [
  resolve(here, '../migrations/0001_create_shipment_tracking.sql'),
  resolve(here, '../migrations/0002_add_staff_authorization.sql'),
  resolve(here, '../migrations/0003_add_dispatch_workflow.sql'),
];
const actor = {
  id: 'staff-owner-1', subject: 'access-user-123', email: 'operations@example.test',
  displayName: 'Synthetic Owner', role: 'Owner', active: true, version: 1,
};
const privateData = {
  senderName: 'Synthetic Sender',
  senderPhone: '+234 700 000 0001',
  receiverName: 'Synthetic Receiver',
  receiverPhone: '+234 700 000 0002',
  originAddress: 'Private pickup unit 14, Test Street',
  originPublic: 'Owerri, Imo State',
  destinationAddress: 'Private delivery unit 29, Example Road',
  destinationPublic: 'Port Harcourt, Rivers State',
  itemDescription: 'Internal description: two sealed synthetic boxes',
  publicItemSummary: 'Two boxes',
  estimatedDeliveryDate: '2026-11-22',
  internalNotes: 'Private operations note',
  publicNote: 'Shipment registered',
};

function database() {
  return new LocalD1(migrations);
}

function adminRequest(body) {
  return new Request('https://williamslarrylogistics.com/api/admin/shipments', {
    method: 'POST',
    headers: {'content-type': 'application/json', 'CF-Ray': 'synthetic-ray'},
    body: JSON.stringify(body),
  });
}

function trackingRequest(trackingNumber) {
  return new Request(`https://williamslarrylogistics.com/api/tracking/${trackingNumber}`, {
    headers: {'CF-Connecting-IP': '192.0.2.10'},
  });
}

test('creates a shipment atomically with initial history and audit records', async t => {
  const db = database();
  t.after(() => db.close());
  const response = await createEndpoint({
    request: adminRequest(privateData), env: {SHIPMENTS_DB: db}, data: {staff: actor},
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.match(payload.shipment.trackingNumber, /^WLL-[0-9A-HJKMNP-TV-Z]{16}$/);
  assert.equal(payload.shipment.currentStatus, 'Registered');
  assert.equal(payload.shipment.version, 1);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM shipment_status_history')[0].count, 1);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM administrative_audit_records')[0].count, 1);
});

test('generates high-entropy tracking numbers and retries database uniqueness collisions', async t => {
  const generated = new Set(Array.from({length: 5000}, () => createTrackingNumber()));
  assert.equal(generated.size, 5000);
  for (const tracking of generated) assert.match(tracking, /^WLL-[0-9A-HJKMNP-TV-Z]{16}$/);

  const db = database();
  t.after(() => db.close());
  const firstNumber = 'WLL-0000000000000000';
  const secondNumber = 'WLL-1111111111111111';
  await createShipment(db, privateData, actor, {trackingNumberFactory: () => firstNumber});
  let calls = 0;
  const second = await createShipment(db, {...privateData, senderName: 'Another Sender'}, actor, {
    trackingNumberFactory: () => (++calls === 1 ? firstNumber : secondNumber),
  });
  assert.equal(second.trackingNumber, secondNumber);
  assert.equal(calls, 2);
});

test('returns valid public tracking data and rejects invalid or unknown references', async t => {
  const db = database();
  t.after(() => db.close());
  const shipment = await createShipment(db, privateData, actor);
  const env = {
    SHIPMENTS_DB: db,
    TRACKING_RATE_LIMIT_KV: new FakeKV(),
    RATE_LIMIT_PEPPER: 'synthetic-test-pepper',
  };
  const success = await publicLookup({
    request: trackingRequest(shipment.trackingNumber), env,
    params: {trackingNumber: shipment.trackingNumber.toLowerCase()},
  });
  assert.equal(success.status, 200);
  assert.equal((await success.json()).shipment.currentStatus, 'Registered');

  const invalid = await publicLookup({
    request: trackingRequest('bad'), env, params: {trackingNumber: 'bad'},
  });
  assert.equal(invalid.status, 422);
  const unknown = 'WLL-ZZZZZZZZZZZZZZZZ';
  const missing = await publicLookup({
    request: trackingRequest(unknown), env, params: {trackingNumber: unknown},
  });
  assert.equal(missing.status, 404);
});

test('allows only controlled status transitions and records each valid transition', async t => {
  const db = database();
  t.after(() => db.close());
  const created = await createShipment(db, privateData, actor);
  const pickedUp = await updateShipmentStatus(db, created.trackingNumber, {
    status: 'Picked up', expectedVersion: 1, publicLocation: 'Owerri, Imo State',
    publicNote: 'Collected by the operations team', internalNote: 'Synthetic pickup',
  }, actor);
  assert.equal(pickedUp.currentStatus, 'Picked up');
  assert.equal(pickedUp.version, 2);

  await assert.rejects(
    updateShipmentStatus(db, created.trackingNumber, {status: 'Delivered', expectedVersion: 2}, actor),
    caught => caught.status === 409,
  );
  const inTransit = await updateShipmentStatus(db, created.trackingNumber, {
    status: 'In transit', expectedVersion: 2, publicLocation: 'On route',
  }, actor);
  assert.equal(inTransit.version, 3);
  const history = await getAdminHistory(db, created.trackingNumber);
  assert.deepEqual(history.items.map(item => item.status), ['Registered', 'Picked up', 'In transit']);
});

test('uses optimistic concurrency so only one competing update and history entry wins', async t => {
  const db = database();
  t.after(() => db.close());
  const created = await createShipment(db, privateData, actor);
  const updates = await Promise.allSettled([
    updateShipmentStatus(db, created.trackingNumber, {status: 'Picked up', expectedVersion: 1}, actor),
    updateShipmentStatus(db, created.trackingNumber, {status: 'Cancelled', expectedVersion: 1}, actor),
  ]);
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = updates.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM shipment_status_history')[0].count, 2);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM administrative_audit_records')[0].count, 2);
  assert.equal((await getAdminShipment(db, created.trackingNumber)).version, 2);
});

test('history and audit records are append-only at the database layer', async t => {
  const db = database();
  t.after(() => db.close());
  await createShipment(db, privateData, actor);
  assert.throws(() => db.database.prepare("UPDATE shipment_status_history SET public_note='changed'").run(), /append-only/);
  assert.throws(() => db.database.prepare('DELETE FROM administrative_audit_records').run(), /append-only/);
});

test('public tracking response never exposes customer contacts, exact addresses, or internal notes', async t => {
  const db = database();
  t.after(() => db.close());
  const shipment = await createShipment(db, privateData, actor);
  const publicValue = await getPublicTracking(db, shipment.trackingNumber);
  const serialized = JSON.stringify(publicValue);
  for (const secret of [
    privateData.senderName, privateData.senderPhone, privateData.receiverName,
    privateData.receiverPhone, privateData.originAddress, privateData.destinationAddress,
    privateData.itemDescription, privateData.internalNotes,
  ]) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(publicValue.origin, privateData.originPublic);
  assert.equal(publicValue.destination, privateData.destinationPublic);
  assert.equal(publicValue.itemSummary, privateData.publicItemSummary);
});

test('fails closed when the D1 binding is missing', async () => {
  const response = await publicLookup({
    request: trackingRequest('WLL-0000000000000000'),
    env: {TRACKING_RATE_LIMIT_KV: new FakeKV(), RATE_LIMIT_PEPPER: 'test'},
    params: {trackingNumber: 'WLL-0000000000000000'},
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test('rate limits public tracking lookups without weakening input validation', async t => {
  const db = database();
  t.after(() => db.close());
  const shipment = await createShipment(db, privateData, actor);
  const env = {
    SHIPMENTS_DB: db,
    TRACKING_RATE_LIMIT_KV: new FakeKV(),
    RATE_LIMIT_PEPPER: 'synthetic-test-pepper',
  };
  for (let index = 0; index < 30; index += 1) {
    const response = await publicLookup({
      request: trackingRequest(shipment.trackingNumber), env,
      params: {trackingNumber: shipment.trackingNumber},
    });
    assert.equal(response.status, 200, index);
  }
  const limited = await publicLookup({
    request: trackingRequest(shipment.trackingNumber), env,
    params: {trackingNumber: shipment.trackingNumber},
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '600');
});

test('rejects impossible estimated-delivery calendar dates', async t => {
  const db = database();
  t.after(() => db.close());
  await assert.rejects(
    createShipment(db, {...privateData, estimatedDeliveryDate: '2026-02-31'}, actor),
    caught => caught.status === 422,
  );
});

test('returns administrative dashboard statistics without customer data', async t => {
  const db = database();
  t.after(() => db.close());
  await createShipment(db, privateData, actor);
  const response = await statsEndpoint({env: {SHIPMENTS_DB: db}, data: {staff: actor}});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.stats.total, 1);
  assert.equal(payload.stats.byStatus.Registered, 1);
  assert.equal(JSON.stringify(payload).includes(privateData.senderPhone), false);
});
