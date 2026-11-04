// Express router for delivery fee calculation endpoints.

import { Router, type Request, type Response } from 'express';
import { calculateDeliveryFee } from './pricingService.js';
import { initDatabase } from './database.js';
import { config } from './config.js';
import { type Database } from './types.js';
import {
  ValidationError,
  NotFoundError,
  OutOfServiceAreaError,
} from './types.js';

export function createDeliveryRouter(db: Database): Router {
  const router = Router();

  router.post('/api/delivery/calculate', (req: Request, res: Response) => {
    try {
      const body = req.body as unknown;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Request body must be a JSON object' },
        });
      }

      const record = body as Record<string, unknown>;
      const { latitude, longitude, barangayId } = record;

      if (
        typeof latitude !== 'number' ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90
      ) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'latitude must be a finite number between -90 and 90' },
        });
      }

      if (
        typeof longitude !== 'number' ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'longitude must be a finite number between -180 and 180' },
        });
      }

      if (barangayId !== undefined) {
        if (
          typeof barangayId !== 'number' ||
          !Number.isInteger(barangayId) ||
          barangayId <= 0
        ) {
          return res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'barangayId must be a positive integer' },
          });
        }
      }

      const result = calculateDeliveryFee(
        {
          latitude,
          longitude,
          barangayId: barangayId as number | undefined,
        },
        db
      );

      return res.status(200).json(result);
    } catch (err) {
      console.error('ROUTE ERR', err);
      if (err instanceof ValidationError) {
        return res.status(400).json({
          error: { code: err.code, message: err.message },
        });
      }
      if (err instanceof NotFoundError) {
        return res.status(404).json({
          error: { code: err.code, message: err.message },
        });
      }
      if (err instanceof OutOfServiceAreaError) {
        return res.status(422).json({
          error: { code: err.code, message: err.message },
        });
      }
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
    }
  });

  return router;
}

export const deliveryRouter = createDeliveryRouter(initDatabase(config.DB_PATH));
export { deliveryRouter as router };

export default deliveryRouter;