import * as os from 'node:os';
import * as path from 'node:path';

// directConnection=true: the local mongod is a single-node replica set whose
// member advertises `mongo:27017`, a name only the Docker network can resolve.
// Without the flag the driver fails with "getaddrinfo ENOTFOUND mongo".
const testMongoUri =
  process.env.MONGODB_TEST_URI ??
  'mongodb://127.0.0.1:27018/ecom_cms_test?directConnection=true';

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
// The storage adapter validates its root at boot, so every suite needs one.
// Suite-specific directories override this before the module is compiled.
process.env.STORAGE_LOCAL_DIR =
  process.env.STORAGE_LOCAL_DIR ?? path.join(os.tmpdir(), 'cms-media-e2e');
