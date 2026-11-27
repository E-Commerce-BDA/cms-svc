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

- `SQS_TASKS_ENABLED=true` is the only way to opt a development or test process
  into the worker (`sqsTasksEnabled()`); the producer uses the same predicate,
  so with it unset the upload still succeeds and simply has no variants yet.
  Production defaults on and can still opt out explicitly. LocalStack is started
  by hand — there is no compose profile that turns the poller on by accident.
- A re-delivered job is a no-op — an existing width/format pair is reused, and
  widths above the source are dropped rather than upscaled.
- A variant is served by `GET /cms/media/file/<key>` like any other media,
  because its key still matches `mediaKeySchema`.
- Removing a media row also unlinks the original and every rendition in its
  manifest. The purge is idempotent (an already-missing file is success), so a
  retry after a partial removal cannot fail; a real storage error keeps the row
  so the removal can be retried with its manifest intact.
- The handler is published as a token by `MediaResizeModule` and injected into
  `createSqsTaskModule`, since a dynamic module cannot see this module's
  providers.
- `@ecom/messaging/nest/tasks` is imported instead of the `/nest` barrel: the
  barrel also re-exports the Kafka consumer surface, and this service has no
  Kafka consumer.

## Private media URLs (`cms-010`)

A private asset cannot be put on a public page with an admin token, so an admin
can mint a short-lived capability:

```
GET /cms/admin/media/:id/signed-url?expiresIn=60  (admin)
   → { url: "/api/v1/cms/media/signed/<key>?exp=<unix>&sig=<hmac>", expiresAt }
GET /api/v1/cms/media/signed/<key>?exp=…&sig=…    (no credential)
```

- The key comes from the media row and is checked through the same
  `streamablePath` resolver before it is signed; the redeem route repeats that
  lookup and containment check after verifying the HMAC and the expiry. A
  capability cannot name a path the issuing route could not have served.
- The signature is HMAC-SHA256 over context + key + `exp`, using a key derived
  from `JWT_SECRET` with domain separation. No new deployment variable, and no
  secret in the URL. Tampered or expired URLs answer the same generic 404 as a
  missing file; responses are `private, no-store`.
- Default lifetime is 5 minutes, capped at 1 hour. `expiresIn` must be a
  positive number of seconds.

## Public state metadata (`cms-012`)

Four public reads used to answer `200 {}` both before an admin ever saved
anything and after an admin cleared everything. They now carry one additive
field; no existing field is renamed, removed or retyped:

| Endpoint | Added field | Meaning |
|---|---|---|
| `GET /api/v1/cms/settings/global` | `configured: boolean` | a global settings row exists |
| `GET /api/v1/cms/settings/page/:pageKey` | `configured: boolean` | a row exists for that page key |
| `GET /api/v1/cms/navigation` | `configured: boolean` | a navbar row exists |
| `GET /api/v1/cms/footer` | `configured: boolean` | a footer row exists |
| `GET /api/v1/cms/sections?pageKey=…` | `state: "missing" \| "empty" \| "published"` | no rows / rows but none active / at least one active |

`configured` is document existence, not payload emptiness: an admin who clears
every key still has `configured: true` with an empty `theme`/`settings`/`navbar`/
`footer` object. That is the whole point — the storefront can tell "nobody set
this up" from "someone deliberately reset it". For sections, `missing` is an
unknown page key, `empty` is authored-but-all-inactive, and `published` is the
normal case. `state` keeps its public meaning on a preview read, so an admin can
see draft rows while still being told that shoppers see nothing.

Exact bodies:

```jsonc
// GET /cms/settings/global
{ "theme": {}, "version": 1, "configured": false }
// GET /cms/settings/page/<key>
{ "settings": {}, "version": 1, "configured": false }
// GET /cms/navigation
{ "navbar": {}, "version": 1, "configured": false }
// GET /cms/footer
{ "footer": {}, "version": 1, "configured": false }
// GET /cms/sections?pageKey=<key>
{ "sections": [], "version": 1, "state": "missing" }
```

The Redis namespaces for these five bodies moved to a `v2` segment so a body
cached before a deploy cannot be served afterwards without the metadata. Old
keys expire on their own; no migration of Redis data is needed.

**Reader compatibility.** These fields are additive at the HTTP level, but
`@ecom/contracts` 2.0.0 declares `footerResponseSchema` and
`sectionListEnvelopeSchema` as `.strict()`; a reader pinned to that version
rejects the new top-level key instead of ignoring it. Before this service is
deployed, a storefront reader must move to a contracts release that declares
these two fields optional (or otherwise tolerate unknown keys). CMS does not
change a pinned dependency or another repo. This is the one adoption ordering
that cannot be completed inside `cms-svc`, and it is called out here rather
than hidden behind "additive".

## Preview capability (`cms-012`)

An admin can inspect inactive sections, draft blogs and inactive pages without
publishing:

```
GET /api/v1/cms/admin/preview-token?expiresIn=300   (admin only)
  → { token: "v1.<exp-unix-seconds>.<hmac-hex>", expiresAt: "<ISO>" }
GET /api/v1/cms/sections?pageKey=home&preview=<token>
GET /api/v1/cms/blogs?preview=<token>
GET /api/v1/cms/blogs/<slug>?preview=<token>
GET /api/v1/cms/pages/<slug>?preview=<token>
  (or send x-preview-token: <token> instead of ?preview=)
```

- `expiresIn` is a positive number of seconds; default `300`, capped at `3600`.
  A malformed value is `400 VALIDATION_FAILED`. It is an absolute expiry: a
  token stops working at `exp`, with no clock tolerance.
- Signature: `HMAC-SHA256(key, "cms-preview-token:v1\n<exp>")`, lowercase hex,
  where `key = HMAC-SHA256(JWT_SECRET, "cms-preview-token:v1")`. Domain
  separation keeps a preview token from being replayed as an access token or
  as a media signature. No new deployment variable, no user claims in the token.
- A missing, expired, malformed or wrongly signed token is **ignored**, never
  rejected: the read falls back to exactly today's published-only behaviour.
  Either source (`?preview` or the header) may carry a valid token.
- A verified token relaxes read filters only. It cannot call an admin route,
  change a document, or mint another token. Public routes still expose no
  writes; `POST /api/v1/cms/sections?preview=…` is simply not routed.
- Preview reads bypass Redis in both directions and answer
  `Cache-Control: private, no-store`, so drafts never become cached published
  pages. Every other read keeps its normal cache behaviour.

The local dev database gained `cms_sections` index
`{ pageKey: 1, isActive: 1, sortOrder: 1 }`; it serves both the public
`pageKey + isActive` filter and the preview `pageKey` filter. `autoIndex`
creates it in test/development; no document rewrite is needed.

## Nested theme pass-through (`cms-013`)

`@ecom/contracts` 2.2.0 adds `theme.palette`, `theme.navbar`,
`theme.filterRail`, `theme.drawer`, `theme.marquee`, `theme.grid` and the
`theme.productCard` CTA paint keys. The admin PUT validates the body with
`themeSettingsSchema` and writes the parsed object to `cms_settings.theme`;
the public GET answers with that same object, plus `version` and `configured`.
Nothing is flattened or renamed, and absence still means "inherit" — an admin
resets one face by deleting its key, never by writing `null`. Existing 1.x and
2.1 bodies remain valid because every added key is optional.

The write keeps all three side effects: revision bump and `cms.updated` outbox
row in one Mongo transaction, Redis invalidation, and the
`cms:global-settings` storefront revalidation tag. A preview token stays
read-only and cannot reach the admin PUT path (`cms-012`). No Mongo migration
is needed: `cms_settings.theme` is a `Mixed` field, so nested keys live in the
same document without a new index or a rewrite.

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

## Outbox envelope backfill (contracts 2.0.0)

`@ecom/contracts` 2.0.0 replaced the dual-written 1.x envelope with one strict
canonical shape: `type`, `version` and `idempotencyKey` are required and the
`topic` / `eventType` aliases are rejected. The relay publishes the stored
envelope verbatim, so a `cms_outbox` row still `pending` at cutover would be
refused by every 2.0.0 consumer. The one-shot migration rewrites those rows
before a relay built on `@ecom/messaging` 0.6.0 starts:

```powershell
pnpm build
node --env-file=.env dist/outbox/outbox-backfill.cli.js --dry-run
node --env-file=.env dist/outbox/outbox-backfill.cli.js
```

Or through the package script (applies the rewrite):

```powershell
pnpm backfill:outbox
```

- Run it with cms-svc **stopped**: a row must not be claimed between the read
  and the rewrite. Only `status: "pending"` documents are touched, so published
  history is never rewritten and failed rows stay parked.
- The event name comes from the row's `event_type` field, not an envelope alias.
  Missing `version` defaults to `1` and a missing `idempotencyKey` falls back to
  the event id — the same values 1.x used to supply when reading. Payloads are
  preserved byte-for-byte.
- It is idempotent: an envelope that is already canonical is reported
  `unchanged`, so a second run writes nothing. A row whose `event_type` is not a
  registered topic, or that cannot be made canonical, is skipped and makes the
  CLI exit `1` — a skipped row still cannot be relayed.
- `--collection <name>` and `--batch <n>` override the default `cms_outbox` and
  batch size `500`. `--dry-run` reports what would change without writing.
- Verify afterwards; this should print `0`:

```javascript
db.cms_outbox.countDocuments({
  status: 'pending',
  $or: [
    { 'envelope.topic': { $exists: true } },
    { 'envelope.eventType': { $exists: true } },
    { 'envelope.version': { $exists: false } },
    { 'envelope.idempotencyKey': { $exists: false } },
  ],
});
```

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
