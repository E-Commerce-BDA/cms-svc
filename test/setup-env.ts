const testMongoUri =
  process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27018/ecom_cms_test';

if (!/\/ecom_cms_test(?:\?|$)/.test(testMongoUri)) {
  throw new Error(
    'E2E tests must use the ecom_cms_test database. Set MONGODB_TEST_URI to a *_test database.',
  );
}

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = testMongoUri;
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-jwt-secret-at-least-32-characters-long';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
