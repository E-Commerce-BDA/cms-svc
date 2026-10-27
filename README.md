# cms-svc

CMS content service for the E-Commerce platform.

Phase 1 is the foundation only: NestJS bootstrap, Mongo/Redis connectivity,
health probes, shared HTTP behavior, and JWT/Roles guard plumbing. CMS domain
models and endpoints start in Phase 2.

## Local setup

Prerequisites:

- Node 24
- pnpm 11
- Docker Desktop
- Redis on `redis://localhost:6379`

```bash
pnpm install
pnpm db:up
Copy-Item .env.example .env
pnpm start:dev
```

The service listens on `http://127.0.0.1:4050`.

MongoDB runs in Docker as `ecom-cms-mongo` on `127.0.0.1:27018`, using the
`ecom-cms-mongo-data` volume. This avoids the native MongoDB instance on
`27017`. Local Mongo has no auth and is bound to loopback only; Atlas provides
auth/TLS in staging and production.

## Health

| Endpoint | Meaning |
|---|---|
| `GET /health` | Process liveness only |
| `GET /health/ready` | Mongo is critical; Redis is degraded |

Readiness returns `200` with `redis: "down"` when Mongo is healthy and Redis is
not. It returns `503` when Mongo is down.

## Tests

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm build
```

E2E tests require the Mongo container and Redis to be running. They use
`ecom_cms_test`, refuse to run against a non-`_test` database, and drop the test
database when finished.

## Environment

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | HTTP port, default `4050` |
| `MONGODB_URI` | Mongo connection string including the database name |
| `JWT_SECRET` | Shared access-token secret, minimum 32 characters |
| `REDIS_URL` | Redis connection string |

Atlas is not used for automated tests. It is reserved for a separate staging
smoke check in Phase 7.
