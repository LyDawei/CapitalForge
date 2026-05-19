// Prisma 7 CLI config. Lives at the package root (sibling to package.json) per
// the c12 loader convention. Loads V2/.env explicitly so DATABASE_URL is
// guaranteed to be set before defineConfig reads process.env.
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { defineConfig } from '@prisma/config';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy V2/.env.example to V2/.env and fill it in.');
}

export default defineConfig({
  schema: path.resolve(__dirname, '..', 'prisma', 'schema.prisma'),
  migrations: { path: path.resolve(__dirname, '..', 'prisma', 'migrations') },
  datasource: { url: process.env.DATABASE_URL },
});
