import { defineConfig } from 'vitest/config';

if (process.env.TEST_DATABASE_URL) {
  const databaseName = new URL(process.env.TEST_DATABASE_URL).pathname.toLowerCase();
  if (!databaseName.includes('test')) {
    throw new Error('TEST_DATABASE_URL debe apuntar a una base cuyo nombre contenga "test".');
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

process.env.JWT_SECRET ??= 'test-only-jwt-secret-with-at-least-32-characters';
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
  },
});
