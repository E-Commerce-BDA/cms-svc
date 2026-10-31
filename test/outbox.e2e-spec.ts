import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eventEnvelopeSchema, type CmsUpdatedPayload } from '@ecom/contracts';
import { OutboxRelay, RecordingPublisher } from '@ecom/messaging';
import { OUTBOX_PUBLISHER, OUTBOX_RELAY } from '@ecom/messaging/nest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';
import { withMongoTransaction } from '../src/db/mongo-tx.js';
import { CmsOutbox } from '../src/outbox/cms-outbox.js';
import { PageModel, type PageDocument } from '../src/pages/page.schema.js';
import { RevisionService } from '../src/revision/revision.service.js';

/** The collection `createMongoOutboxModule` is configured with in `app.module.ts`. */
const OUTBOX_COLLECTION = 'cms_outbox';

/**
 * One `cms_outbox` document. A type alias (not an interface) so it stays
 * assignable to the driver's `Document` constraint without an index signature.
 */
type CmsOutboxDoc = {
  _id: string;
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  envelope: Record<string, unknown>;
  status: string;
  attempts: number;
  last_error: string | null;
  locked_until: Date | null;
  created_at: Date;
  published_at: Date | null;
};

const RUN_ID = randomUUID().slice(0, 8);

describe('CMS outbox (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let jwtService: JwtService;
  let moduleRelay: OutboxRelay;
  let publisher: RecordingPublisher;
  let adminToken: string;

  /** Every aggregate this suite writes events for; assertions and cleanup use it. */
  const aggregateIds: string[] = [];

  function track(aggregateId: string): string {
    aggregateIds.push(aggregateId);
    return aggregateId;
  }

  function outboxCollection() {
    const db = connection.db;
    if (!db) {
      throw new Error('Mongo connection is not ready');
    }
    return db.collection<CmsOutboxDoc>(OUTBOX_COLLECTION);
  }

  async function outboxDocs(aggregateId: string): Promise<CmsOutboxDoc[]> {
    return outboxCollection()
      .find({ aggregate_id: aggregateId })
      .sort({ created_at: 1, _id: 1 })
      .toArray();
  }

  /**
   * Drain the real relay until this aggregate's documents are published.
   *
   * The queue is shared with the other e2e suites (which never start a relay),
   * so one drain may spend its whole batch on their older rows. The wait
   * therefore counts *this* aggregate only, and each cycle retries.
   */
  async function drainUntilPublished(
    aggregateId: string,
    expected: number,
  ): Promise<void> {
    let last = '';

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const docs = await outboxDocs(aggregateId);
      if (docs.filter((doc) => doc.status === 'published').length >= expected) {
        return;
      }

      last = JSON.stringify(await moduleRelay.drainOnce());
    }

    throw new Error(
      `relay did not publish ${expected} document(s) for ${aggregateId}; last drain ${last}`,
    );
  }

  function post(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  function patch(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  function put(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  function del(path: string) {
    return request(app.getHttpServer())
      .delete(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  beforeAll(async () => {
    publisher = new RecordingPublisher();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OUTBOX_PUBLISHER)
      .useValue(publisher)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    jwtService = app.get<JwtService>(JwtService);
    moduleRelay = app.get<OutboxRelay>(OUTBOX_RELAY);

    adminToken = jwtService.sign(
      { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
  });

  afterAll(async () => {
    if (connection) {
      await outboxCollection().deleteMany({ aggregate_id: { $in: aggregateIds } });
      await connection.dropDatabase();
    }
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    publisher.reset();
  });

  it('writes exactly one valid cms.updated document when a page is created', async () => {
    const slug = track(`outbox-page-${RUN_ID}`);

    await post('/cms/admin/pages', {
      slug,
      title: 'Outbox Page',
      blocks: [{ type: 'rich_text', id: 'rt-1', body: '<p>hello</p>' }],
      isActive: true,
    }).expect(201);

    const docs = await outboxDocs(slug);
    expect(docs).toHaveLength(1);

    const [doc] = docs;
    expect(doc).toMatchObject({
      aggregate_type: 'page',
      aggregate_id: slug,
      event_type: 'cms.updated',
      status: 'pending',
      attempts: 0,
      last_error: null,
      locked_until: null,
      published_at: null,
    });
    // The event id doubles as the document key, so a replay cannot duplicate it.
    expect(doc!.event_id).toBe(doc!._id);

    expect(eventEnvelopeSchema.safeParse(doc!.envelope).success).toBe(true);
    expect(doc!.envelope).toMatchObject({
      id: doc!.event_id,
      type: 'cms.updated',
      producer: 'cms-svc',
      payload: { scope: 'pages', key: slug },
    });
    expect(typeof (doc!.envelope as { payload: { version: number } }).payload.version).toBe(
      'number',
    );
  });

  it('drains the document through the relay and marks it published', async () => {
    const slug = track(`outbox-drain-${RUN_ID}`);

    await post('/cms/admin/pages', { slug, title: 'Drain', blocks: [] }).expect(201);
    await drainUntilPublished(slug, 1);

    const [doc] = await outboxDocs(slug);
    expect(doc!.status).toBe('published');
    expect(doc!.published_at).toBeInstanceOf(Date);
    expect(doc!.locked_until).toBeNull();
    expect(doc!.last_error).toBeNull();

    const published = publisher.published.find(
      (event) => event.key === slug && event.topic === 'cms.updated',
    );
    expect(published).toBeDefined();
    expect(published!.envelope.id).toBe(doc!.event_id);
  });

  it('writes a document for each update and delete of the same page', async () => {
    const slug = track(`outbox-lifecycle-${RUN_ID}`);

    await post('/cms/admin/pages', { slug, title: 'Lifecycle', blocks: [] }).expect(201);
    await patch(`/cms/admin/pages/${slug}`, { title: 'Lifecycle v2' }).expect(200);
    await del(`/cms/admin/pages/${slug}`).expect(204);

    const docs = await outboxDocs(slug);
    expect(docs).toHaveLength(3);
    expect(docs.every((doc) => doc.event_type === 'cms.updated')).toBe(true);
    expect(docs.every((doc) => doc.status === 'pending')).toBe(true);

    // Every content change bumps the revision, so the payload versions ascend.
    const versions = docs.map(
      (doc) => (doc.envelope as { payload: { version: number } }).payload.version,
    );
    expect(versions[1]).toBeGreaterThan(versions[0]!);
    expect(versions[2]).toBeGreaterThan(versions[1]!);
  });

  it('writes section, navigation and settings events with their own aggregates', async () => {
    const sectionKey = track(`outbox-section-${RUN_ID}`);

    await post('/cms/admin/sections', {
      key: sectionKey,
      pageKey: 'homepage',
      type: 'hero',
      title: 'Outbox Hero',
      content: { slides: [] },
      settings: {},
      isActive: true,
    }).expect(201);

    await put('/cms/admin/navigation', { shared: { bar: { height: 64 } } }).expect(200);
    await put('/cms/admin/settings/global', {
      button: { defaultVariant: 'primary', borderRadius: 8 },
    }).expect(200);
    await put('/cms/admin/settings/page/signin', {
      shared: { layout: { mode: 'split' } },
    }).expect(200);

    const [section] = await outboxDocs(sectionKey);
    expect(section).toMatchObject({ aggregate_type: 'section', aggregate_id: sectionKey });
    expect(section!.envelope).toMatchObject({
      payload: { scope: 'sections', key: sectionKey, pageKey: 'homepage' },
    });

    const [navigation] = await outboxDocs('navbar');
    expect(navigation).toMatchObject({
      aggregate_type: 'navigation',
      aggregate_id: 'navbar',
    });
    expect(navigation!.envelope).toMatchObject({
      payload: { scope: 'navigation' },
    });

    const [theme] = await outboxDocs('global');
    expect(theme).toMatchObject({ aggregate_type: 'settings', aggregate_id: 'global' });
    expect(theme!.envelope).toMatchObject({ payload: { scope: 'theme' } });

    const [pageSettings] = await outboxDocs('signin');
    expect(pageSettings).toMatchObject({
      aggregate_type: 'settings',
      aggregate_id: 'signin',
    });
    expect(pageSettings!.envelope).toMatchObject({
      payload: { scope: 'page-settings', pageKey: 'signin' },
    });
  });

  it('writes one blog.updated document for a published blog', async () => {
    const category = await post('/cms/admin/blog-categories', {
      name: `Outbox Category ${RUN_ID}`,
      slug: `outbox-category-${RUN_ID}`,
    }).expect(201);

    const categoryId = (category.body.category as { id: string }).id;
    const blog = await post('/cms/admin/blogs', {
      slug: `outbox-blog-${RUN_ID}`,
      title: 'Outbox Blog',
      content: [{ type: 'paragraph', id: 'p-1', text: 'Hello' }],
      categoryId,
      status: 'published',
    }).expect(201);

    const blogId = (blog.body.blog as { id: string }).id;
    track(blogId);

    const docs = await outboxDocs(blogId);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      aggregate_type: 'blog',
      aggregate_id: blogId,
      event_type: 'blog.updated',
      status: 'pending',
    });
    expect(docs[0]!.envelope).toMatchObject({
      type: 'blog.updated',
      payload: {
        blogId,
        slug: `outbox-blog-${RUN_ID}`,
        status: 'published',
      },
    });
  });

  it('rolls the page, the revision and the event back together when the write fails', async () => {
    const slug = track(`outbox-rollback-${RUN_ID}`);
    const pages = app.get<Model<PageDocument>>(getModelToken(PageModel.name));
    const outbox = app.get(CmsOutbox);
    const revision = app.get(RevisionService);

    const versionBefore = await revision.getVersion();

    await expect(
      withMongoTransaction(connection, async (session) => {
        await pages.create([{ slug, title: 'Rollback', blocks: [] }], { session });
        await revision.bumpVersion({ session });

        // The extra key fails `cmsUpdatedPayloadSchema` inside the store, which
        // aborts the transaction: content, revision and event stay consistent.
        await outbox.record(session, {
          topic: 'cms.updated',
          aggregateType: 'page',
          aggregateId: slug,
          payload: {
            scope: 'pages',
            version: 1,
            key: slug,
            unexpected: true,
          } as unknown as CmsUpdatedPayload,
        });
      }),
    ).rejects.toThrow();

    expect(await outboxDocs(slug)).toHaveLength(0);
    expect(await pages.countDocuments({ slug }).exec()).toBe(0);
    expect(await revision.getVersion()).toBe(versionBefore);

    await request(app.getHttpServer())
      .get(`/api/v1/cms/pages/${slug}`)
      .expect(404);
  });
});
