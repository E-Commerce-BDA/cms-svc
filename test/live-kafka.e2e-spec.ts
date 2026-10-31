import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Kafka } from 'kafkajs';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KafkaEventPublisher, OutboxRelay } from '@ecom/messaging';
import { OUTBOX_PUBLISHER, OUTBOX_RELAY } from '@ecom/messaging/nest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';

const OUTBOX_COLLECTION = 'cms_outbox';
const RUN_ID = randomUUID().slice(0, 8);
const BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
  .split(',')
  .map((broker) => broker.trim())
  .filter(Boolean);

/**
 * The one gate that needs a broker. Everything else drives `drainOnce()`
 * against a recording publisher.
 *
 * `RUN_KAFKA_E2E=1 pnpm test:e2e -- test/live-kafka.e2e-spec.ts`
 */
const describeLive = process.env.RUN_KAFKA_E2E === '1' ? describe : describe.skip;

describeLive('Live Kafka delivery (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let moduleRelay: OutboxRelay;
  let publisher: KafkaEventPublisher;
  let kafka: Kafka;
  let adminToken: string;

  const aggregateIds: string[] = [];

  function outboxCollection() {
    const db = connection.db;
    if (!db) {
      throw new Error('Mongo connection is not ready');
    }
    return db.collection(OUTBOX_COLLECTION);
  }

  /** Drains until this aggregate's `cms.updated` document is published. */
  async function drainUntilPublished(aggregateId: string): Promise<string> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const docs = await outboxCollection()
        .find({ aggregate_id: aggregateId, status: 'published' })
        .toArray();

      if (docs.length > 0) {
        return String(docs[0]!._id);
      }

      await moduleRelay.drainOnce();
    }

    throw new Error(`no published cms_outbox document for ${aggregateId}`);
  }

  /**
   * Reads the topic from the beginning and resolves when the message carrying
   * this event id arrives. A fresh consumer group per run, so `fromBeginning`
   * replays the topic instead of skipping to the current offset.
   */
  async function expectOnTopic(topic: string, eventId: string): Promise<void> {
    const consumer = kafka.consumer({ groupId: `cms-live-${RUN_ID}-${topic}` });
    let timer: NodeJS.Timeout | undefined;

    await consumer.connect();
    await consumer.subscribe({ topics: [topic], fromBeginning: true });

    const delivered = new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no ${topic} message for event ${eventId}`)),
        20000,
      );

      void consumer.run({
        eachMessage: async ({ message }) => {
          if (message.headers?.['x-event-id']?.toString() === eventId) {
            resolve();
          }
        },
      });
    });

    try {
      await delivered;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      await consumer.disconnect();
    }
  }

  beforeAll(async () => {
    publisher = new KafkaEventPublisher({
      brokers: () => BROKERS,
      clientId: 'cms-live-e2e',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // The relay's `enabled` flag is read while the module is declared, so an
      // env flip inside this file would be too late; override the publisher.
      .overrideProvider(OUTBOX_PUBLISHER)
      .useValue(publisher)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    moduleRelay = app.get<OutboxRelay>(OUTBOX_RELAY);
    kafka = new Kafka({ clientId: `cms-live-${RUN_ID}`, brokers: BROKERS });

    adminToken = app.get(JwtService).sign(
      { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
  });

  afterAll(async () => {
    if (connection) {
      if (aggregateIds.length > 0) {
        await outboxCollection().deleteMany({ aggregate_id: { $in: aggregateIds } });
      }
      await connection.dropDatabase();
    }

    await publisher?.close();

    if (app) {
      await app.close();
    }
  });

  it('delivers cms.updated to its topic', async () => {
    const slug = `live-cms-${RUN_ID}`;
    aggregateIds.push(slug);

    await request(app.getHttpServer())
      .post('/api/v1/cms/admin/pages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug, title: 'Live Kafka Page', blocks: [] })
      .expect(201);

    const eventId = await drainUntilPublished(slug);
    expect(eventId).toBeTruthy();
    await expectOnTopic('cms.updated', eventId);
  }, 60000);

  it('delivers blog.updated to its topic', async () => {
    const category = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/blog-categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Live Category ${RUN_ID}`, slug: `live-category-${RUN_ID}` })
      .expect(201);

    const categoryId = (category.body.category as { id: string }).id;
    const blog = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/blogs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `live-blog-${RUN_ID}`,
        title: 'Live Kafka Blog',
        content: [{ type: 'paragraph', id: 'p-1', text: 'Hello' }],
        categoryId,
        status: 'published',
      })
      .expect(201);

    const blogId = (blog.body.blog as { id: string }).id;
    aggregateIds.push(blogId);

    const eventId = await drainUntilPublished(blogId);
    await expectOnTopic('blog.updated', eventId);
  }, 60000);
});
