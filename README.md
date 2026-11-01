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

One suite needs a real queue. `media-resize.e2e-spec.ts` skips (with a printed
reason) unless `AWS_ENDPOINT_URL` is set, and it drives the whole path through
LocalStack:

```bash
docker compose -f ../ecom-infra/docker-compose.yml up -d localstack
$env:AWS_ENDPOINT_URL = 'http://localhost:4566'
pnpm test:e2e -- test/media-resize.e2e-spec.ts
```

## Media renditions

Uploads are stored and answered immediately; the renditions are made by a
worker behind SQS, never on the request path (`cms-006`).

```
POST /cms/admin/media ──► storage.save(bytes) + media row
                       └► SQS media-resize-image  { idempotencyKey: mediaId }
                                     │
                              MediaResizeService
                               sharp → 320/640/1024/1920 × webp/avif/jpeg/png
                               one $set: width, height, variants[]
```

- `SQS_TASKS_ENABLED=false` (the development and test default) turns the worker
  off: the upload still succeeds and simply has no variants yet.
- A re-delivered job is a no-op — an existing width/format pair is reused, and
  widths above the source are dropped rather than upscaled.
- A variant is served by `GET /cms/media/file/<key>` like any other media,
  because its key still matches `mediaKeySchema`.
- The handler is published as a token by `MediaResizeModule` and injected into
  `createSqsTaskModule`, since a dynamic module cannot see this module's
  providers.
- `@ecom/messaging/nest/tasks` is imported instead of the `/nest` barrel: the
  barrel also re-exports the Kafka consumer surface, and this service has no
  Kafka consumer.

## Telling the storefront (`cms-007`)

The storefront caches CMS reads in Next's Data Cache, which lives in its own
process, so publishing also means one HTTP call out:

```
PUT /cms/admin/navigation ──► Mongo commit + outbox row
                            ├► redis.del('cms:nav')
                            └► POST $STOREFRONT_URL/api/revalidate
                               x-revalidate-secret: $REVALIDATE_SECRET
                               {"tags":["cms:navigation"]}
```

- Exactly three mutations send a tag: theme → `cms:global-settings`, page
  settings → `cms:page-settings:<pageKey>`, navigation → `cms:navigation`.
  Sections, pages and blogs send nothing — the storefront has no tag or reader
  for them yet, and it answers `400 INVALID_TAGS` for anything it did not author.
- Failure is a warn line, never a failed publish: the write already committed and
  the page is merely stale until its TTL. The client timeout is 2 s.
- With no `REVALIDATE_SECRET` the call is skipped entirely. Production refuses to
  boot without it, so an "off by accident" deployment cannot exist.
- The e2e suite blanks the secret in `test/setup-env.ts`; `test/revalidate.e2e-spec.ts`
  boots a stub storefront and asserts the exact path, header and tag list.

## Environment

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | HTTP port, default `4050` |
| `MONGODB_URI` | Mongo connection string including the database name |
| `JWT_SECRET` | Shared access-token secret, minimum 32 characters |
| `REDIS_URL` | Redis connection string |
| `STORAGE_LOCAL_DIR` | Root directory for uploaded media; required in production |
| `SQS_TASKS_ENABLED` | Run the rendition worker; `false` in development and test, `true` in production |
| `AWS_REGION` | SQS region, default `us-east-1` |
| `AWS_ENDPOINT_URL` | LocalStack endpoint; unset in production |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | LocalStack credentials; unset in production |
| `STOREFRONT_URL` | Storefront base URL for the invalidation call, default `http://localhost:3000` |
| `REVALIDATE_SECRET` | Shared secret sent as `x-revalidate-secret`; required in production, empty means "off" |

Atlas is not used for automated tests. It is reserved for a separate staging
smoke check in Phase 7.
