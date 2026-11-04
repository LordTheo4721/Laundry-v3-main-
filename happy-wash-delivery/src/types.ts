// Shared types for the delivery service.

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

export type Database = BetterSqlite3Database;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface BarangayRow {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  delivery_tier: number;
  base_tier_fee: number;
}

export interface DeliveryFeeBreakdown {
  distanceKm: number;
  baseFare: number;
  distanceSurge: number;
  minimumApplied: boolean;
  minimumFeeAdjustment: number;
  totalDeliveryFee: number;
  currency: 'PHP';
  barangay: { id: number; name: string; tier: number } | null;
}

export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'NotFoundError';
    this.field = field;
  }
}

export class OutOfServiceAreaError extends Error {
  readonly code = 'OUT_OF_SERVICE_AREA' as const;
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'OutOfServiceAreaError';
    this.field = field;
  }
}