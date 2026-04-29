import path from 'path';
import dotenv from 'dotenv';
// Load env from monorepo root before defineConfig reads it.
dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });
dotenv.config(); // also try cwd

import { defineConfig } from '@prisma/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Expected in .env at repo root or in shell env.');
}

export default defineConfig({
  datasource: {
    url: databaseUrl,
  },
});
