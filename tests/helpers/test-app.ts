import type { Express } from 'express';
import { createApp } from '@/app';
import { prisma } from '@/database/prisma';

/**
 * The app under test, built once per run.
 *
 * `createApp` deliberately does not call `listen`, so Supertest can drive the
 * app directly. No port is bound, which means the suite cannot collide with a
 * dev server already running on 3000.
 */
let app: Express | undefined;

export function getTestApp(): Express {
  app ??= createApp(prisma);
  return app;
}

export { prisma };
