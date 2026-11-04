// Store configuration and delivery pricing constants for the delivery service.

export const STORE = {
  name: 'Madayegdeg, San Fernando City',
  latitude: 16.6085,
  longitude: 120.3121,
} as const;

export const BASE_FARE = 39;
export const BASE_DISTANCE_KM = 2;
export const PER_KM_RATE = 10;
export const ROAD_FACTOR = 1.0;
export const MAX_SERVICE_RADIUS_KM = 25;

export const PORT = Number(process.env.PORT ?? 3000);
export const DB_PATH = process.env.DB_PATH ?? './data/delivery.db';

export const config = {
  STORE,
  BASE_FARE,
  BASE_DISTANCE_KM,
  PER_KM_RATE,
  ROAD_FACTOR,
  MAX_SERVICE_RADIUS_KM,
  PORT,
  DB_PATH,
};

export default config;