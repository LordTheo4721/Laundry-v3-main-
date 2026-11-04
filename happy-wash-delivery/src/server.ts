// Express server entry point for the delivery service.

import express from 'express';
import { initDatabase } from './database.js';
import { createDeliveryRouter } from './deliveryRoute.js';
import { config } from './config.js';

const app = express();

app.use(express.json({ limit: '100kb' }));

const db = initDatabase();
app.use(createDeliveryRouter(db));

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
);

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.PORT, () => {
    console.log(`Happy Wash delivery service listening on port ${config.PORT}`);
  });
}

export { app, db };
export default app;