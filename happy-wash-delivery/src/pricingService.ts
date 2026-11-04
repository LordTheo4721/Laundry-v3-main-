// Delivery pricing calculation service.

import { config } from './config.js';
import { findBarangayById } from './database.js';
import {
  ValidationError,
  NotFoundError,
  OutOfServiceAreaError,
  type Database,
  type Coordinates,
  type DeliveryFeeBreakdown,
  type BarangayRow,
} from './types.js';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export function calculateDeliveryFee(
  input: { latitude: number; longitude: number; barangayId?: number },
  db: Database
): DeliveryFeeBreakdown {
  const lat = input.latitude as unknown;
  const lon = input.longitude as unknown;

  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    throw new ValidationError('latitude must be a finite number between -90 and 90', 'latitude');
  }
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
    throw new ValidationError('longitude must be a finite number between -180 and 180', 'longitude');
  }

  let barangayId: number | undefined;
  if (input.barangayId !== undefined) {
    const bid = input.barangayId as unknown;
    if (typeof bid !== 'number' || !Number.isInteger(bid) || bid <= 0) {
      throw new ValidationError('barangayId must be a positive integer', 'barangayId');
    }
    barangayId = bid;
  }

  const storeCoords: Coordinates = {
    latitude: config.STORE.latitude,
    longitude: config.STORE.longitude,
  };
  const customerCoords: Coordinates = { latitude: lat, longitude: lon };

  const rawDistance = haversineKm(storeCoords, customerCoords) * config.ROAD_FACTOR;
  const distanceKm = Math.round(rawDistance * 100) / 100;

  if (distanceKm > config.MAX_SERVICE_RADIUS_KM) {
    throw new OutOfServiceAreaError(
      `Delivery distance ${distanceKm} km exceeds maximum service radius of ${config.MAX_SERVICE_RADIUS_KM} km`,
      'location'
    );
  }

  const extraKm = Math.max(0, Math.ceil(distanceKm - config.BASE_DISTANCE_KM));
  const baseFare = config.BASE_FARE;
  const distanceSurge = extraKm * config.PER_KM_RATE;
  const computed = baseFare + distanceSurge;

  let barangay: BarangayRow | undefined;
  if (barangayId !== undefined) {
    barangay = findBarangayById(db, barangayId);
    if (!barangay) {
      throw new NotFoundError(`Barangay with id ${barangayId} not found`, 'barangayId');
    }
  }

  let totalDeliveryFee = computed;
  let minimumApplied = false;
  let minimumFeeAdjustment = 0;

  if (barangay) {
    const floor = Math.round(barangay.base_tier_fee);
    if (floor > computed) {
      totalDeliveryFee = floor;
      minimumApplied = true;
      minimumFeeAdjustment = totalDeliveryFee - computed;
    }
  }

  return {
    distanceKm,
    baseFare,
    distanceSurge,
    minimumApplied,
    minimumFeeAdjustment,
    totalDeliveryFee,
    currency: 'PHP',
    barangay: barangay
      ? { id: barangay.id, name: barangay.name, tier: barangay.delivery_tier }
      : null,
  };
}