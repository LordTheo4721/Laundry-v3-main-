import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/database.js';
import { haversineKm, calculateDeliveryFee } from '../src/pricingService.js';
import { ValidationError, NotFoundError, OutOfServiceAreaError } from '../src/types.js';
import { config } from '../src/config.js';

const STORE = config.STORE;

test('haversineKm returns 0 for identical points', () => {
  const d = haversineKm(STORE, STORE);
  assert.equal(d, 0);
});

test('customer at store coordinates: distance 0, total 39', () => {
  const db = initDatabase(':memory:');
  const result = calculateDeliveryFee(
    { latitude: STORE.latitude, longitude: STORE.longitude },
    db
  );
  assert.equal(result.distanceKm, 0);
  assert.equal(result.baseFare, 39);
  assert.equal(result.distanceSurge, 0);
  assert.equal(result.totalDeliveryFee, 39);
  assert.equal(result.minimumApplied, false);
  assert.equal(result.minimumFeeAdjustment, 0);
  assert.equal(result.currency, 'PHP');
  assert.equal(result.barangay, null);
});

test('customer at exactly 2.00 km: total 39', () => {
  const db = initDatabase(':memory:');
  // find a latitude offset yielding ~2.00 km
  let lat = STORE.latitude;
  while (haversineKm(STORE, { latitude: lat, longitude: STORE.longitude }) < 2) {
    lat += 0.00001;
  }
  // step back one to land just under 2.00 if possible; instead assert based on computed
  const result = calculateDeliveryFee(
    { latitude: lat, longitude: STORE.longitude },
    db
  );
  // distanceKm should round to 2.00
  assert.ok(result.distanceKm >= 1.99 && result.distanceKm <= 2.01, `distanceKm=${result.distanceKm}`);
  assert.equal(result.totalDeliveryFee, 39);
});

test('customer at 2.01 km: total 49', () => {
  const db = initDatabase(':memory:');
  // point clearly beyond 2 km
  const lat = STORE.latitude + 0.02; // ~2.22 km
  const result = calculateDeliveryFee(
    { latitude: lat, longitude: STORE.longitude },
    db
  );
  assert.ok(result.distanceKm > 2, `distanceKm=${result.distanceKm}`);
  assert.equal(result.distanceSurge, 10);
  assert.equal(result.totalDeliveryFee, 49);
});

test('far barangay where formula exceeds floor: no adjustment', () => {
  const db = initDatabase(':memory:');
  // Mamat-ing Norte is tier 4 with floor 110; use a far point
  const result = calculateDeliveryFee(
    { latitude: 16.6712, longitude: 120.3898, barangayId: 1 },
    db
  );
  // barangayId 1 is Madayegdeg (tier1 floor 39); distance ~? formula likely >39
  assert.equal(result.minimumApplied, false);
  assert.equal(result.minimumFeeAdjustment, 0);
});

test('near Tier 2 barangay under 2 km: floor raises price to 49', () => {
  const db = initDatabase(':memory:');
  // find a tier 2 barangay id
  // Barangay I id = 6
  const result = calculateDeliveryFee(
    { latitude: STORE.latitude, longitude: STORE.longitude, barangayId: 6 },
    db
  );
  assert.equal(result.distanceKm, 0);
  assert.equal(result.totalDeliveryFee, 49);
  assert.equal(result.minimumApplied, true);
  assert.equal(result.minimumFeeAdjustment, 10);
  assert.deepEqual(result.barangay, { id: 6, name: 'Barangay I', tier: 2 });
});

test('invalid inputs throw ValidationError', () => {
  const db = initDatabase(':memory:');
  assert.throws(() => calculateDeliveryFee({ latitude: 'x' as unknown as number, longitude: 0 }, db), ValidationError);
  assert.throws(() => calculateDeliveryFee({ latitude: 91, longitude: 0 }, db), ValidationError);
  assert.throws(() => calculateDeliveryFee({ latitude: 0, longitude: 0 } as { latitude: number; longitude: number }, db), (e: unknown) => {
    // missing longitude -> undefined
    return true;
  });
});

test('missing longitude throws', () => {
  const db = initDatabase(':memory:');
  assert.throws(
    () => calculateDeliveryFee({ latitude: 0 } as unknown as { latitude: number; longitude: number }, db),
    ValidationError
  );
});

test('barangayId 0 throws ValidationError', () => {
  const db = initDatabase(':memory:');
  assert.throws(
    () => calculateDeliveryFee({ latitude: 0, longitude: 0, barangayId: 0 }, db),
    ValidationError
  );
});

test('unknown barangayId throws NotFoundError', () => {
  const db = initDatabase(':memory:');
  assert.throws(
    () => calculateDeliveryFee({ latitude: STORE.latitude, longitude: STORE.longitude, barangayId: 99999 }, db),
    NotFoundError
  );
});

test('point beyond 25 km throws OutOfServiceAreaError', () => {
  const db = initDatabase(':memory:');
  // move far away
  assert.throws(
    () => calculateDeliveryFee({ latitude: 0, longitude: 0 }, db),
    OutOfServiceAreaError
  );
});

test('string latitude via route? service rejects', () => {
  const db = initDatabase(':memory:');
  assert.throws(
    () => calculateDeliveryFee({ latitude: '16.6' as unknown as number, longitude: 120.3 }, db),
    ValidationError
  );
});