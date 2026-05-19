import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from './env';

// Prisma 7 runtime requires an adapter rather than reading DATABASE_URL from
// the schema. We construct the pg adapter from env once and reuse the client.
declare global {
  // eslint-disable-next-line no-var
  var __cf2_prisma: PrismaClient | undefined;
}

function buildClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

export const prisma = global.__cf2_prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  global.__cf2_prisma = prisma;
}
