import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import type { Model } from 'mongoose';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TASK_QUEUES } from '@ecom/contracts';
import { SQS_TASK_QUEUE } from '@ecom/messaging/nest/tasks';
import type { TaskQueuePort } from '@ecom/messaging';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';
import { MediaModel, type MediaDocument } from '../src/media/media.schema.js';

/**
 * The one suite that needs a real queue.
 *
 * `AWS_ENDPOINT_URL=http://localhost:4566 pnpm test:e2e -- test/media-resize.e2e-spec.ts`
 *
 * LocalStack has to be up and its init script (`10-sqs-queues.sh`) has to have
 * created `media-resize-image`; without both the suite skips rather than fails,
 * because every other e2e suite in this repo runs without a broker.
 */
const ENDPOINT = process.env.AWS_ENDPOINT_URL;

if (!ENDPOINT) {
  // oxlint-disable-next-line no-console -- the skip reason has to be visible.
  console.warn(
    '[media-resize e2e] skipped: set AWS_ENDPOINT_URL (e.g. http://localhost:4566) ' +
      'with LocalStack running to exercise the real SQS path.',
  );
}

if (ENDPOINT) {
  // The queue is opt-in for this file only: `SQS_TASKS_ENABLED` wins over
  // `NODE_ENV=test`, which every other suite relies on.
  process.env.SQS_TASKS_ENABLED = 'true';
  process.env.AWS_REGION ??= 'us-east-1';
  // LocalStack accepts anything; the SDK still refuses to sign without a key.
  process.env.AWS_ACCESS_KEY_ID ??= 'test';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
}

const describeSqs = ENDPOINT ? describe : describe.skip;

/** 1200 px wide, so 320/640/1024 render and 1920 is correctly skipped. */
async function sourcePng(): Promise<Buffer> {
  return sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#2f6f4f' },
  })
    .png()
    .toBuffer();
}

describeSqs('Media resize over SQS (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let mediaModel: Model<MediaDocument>;
  let queue: TaskQueuePort;
  let adminToken: string;
  const storageDir = path.join(os.tmpdir(), `cms-resize-e2e-${process.pid}`);
  /** Filled by the upload test, replayed by the idempotency test. */
  let uploaded: { id: string; key: string };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function mediaById(id: string) {
    return mediaModel.findById(id).lean().exec();
  }

  /** The worker is a poller, so a write is eventually consistent by design. */
  async function waitFor<T>(
    read: () => Promise<T | null | undefined>,
    accept: (value: T) => boolean,
    label: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const value = await read();
      if (value && accept(value)) {
        return value;
      }
      await sleep(250);
    }
    throw new Error(`Timed out after 15s waiting for ${label}`);
  }

  beforeAll(async () => {
    // Declaration-time reads (`isSqsTasksEnabled`) happen while this module is
    // evaluated, so the environment is set above and the app is imported here
    // rather than at the top of the file.
    process.env.STORAGE_LOCAL_DIR = storageDir;
    const { AppModule } = await import('../src/app.module.js');
    const { configureApp } = await import('../src/app.setup.js');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    mediaModel = app.get<Model<MediaDocument>>(getModelToken(MediaModel.name));
    queue = app.get<TaskQueuePort>(SQS_TASK_QUEUE);

    adminToken = app.get<JwtService>(JwtService).sign(
      { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
  });

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
    }
    if (app) {
      // Stops the poller: a leaked long poll keeps the run alive for 20 s.
      await app.close();
    }
    if (fs.existsSync(storageDir)) {
      await fs.promises.rm(storageDir, { recursive: true, force: true });
    }
    // Leave the environment as the other suites expect it.
    delete process.env.SQS_TASKS_ENABLED;
  });

  it('enqueues on upload, renders every width and format, and serves a variant', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('usage', 'section')
      .field('alt', 'SQS rendition test')
      .attach('file', await sourcePng(), 'rendition.png')
      .expect(201);

    const mediaId = upload.body.media.id as string;

    const media = await waitFor(
      () => mediaById(mediaId),
      (doc) => (doc.variants?.length ?? 0) > 0,
      'the resize worker to write variants',
    );

    // 3 widths (1920 is above the source) x 4 formats.
    expect(media.variants).toHaveLength(12);
    expect(media.width).toBe(1200);
    expect(media.height).toBe(800);
    expect(new Set(media.variants?.map((variant) => variant.width))).toEqual(
      new Set([320, 640, 1024]),
    );

    const webp = media.variants?.find(
      (variant) => variant.width === 320 && variant.format === 'webp',
    );
    expect(webp).toBeDefined();
    expect(fs.existsSync(path.join(storageDir, webp!.key))).toBe(true);

    // The variant key stays inside `mediaKeySchema`, which is what makes it
    // servable through the same route as the original.
    const served = await request(app.getHttpServer()).get(webp!.url).expect(200);
    expect(served.headers['content-type']).toContain('image/webp');

    uploaded = { id: mediaId, key: media.key };
  });

  it('rewrites nothing when the same job is delivered again', async () => {
    expect(uploaded).toBeDefined();

    const before = (await mediaById(uploaded.id))?.variants ?? [];
    expect(before).toHaveLength(12);

    const mtimes = before.map((variant) =>
      fs.statSync(path.join(storageDir, variant.key)).mtimeMs,
    );

    await queue.enqueue(TASK_QUEUES.mediaResizeImage, {
      type: 'media.resize-image',
      // Same identity as the upload: the effect is already done.
      idempotencyKey: uploaded.id,
      payload: {
        mediaId: uploaded.id,
        sourceKey: uploaded.key,
        formats: ['webp', 'avif', 'jpeg', 'png'],
        widths: [320, 640, 1024, 1920],
      },
    });

    // Five seconds is longer than one poll cycle plus a full render of twelve
    // renditions, so a re-render would have finished by then.
    await sleep(5000);

    const after = await mediaById(uploaded.id);
    expect(after?.variants).toEqual(before);
    // Unchanged mtimes are the proof that nothing was re-encoded and
    // re-written: an identical file written twice is still a write.
    for (const [index, variant] of before.entries()) {
      const full = path.join(storageDir, variant.key);
      expect(fs.statSync(full).mtimeMs).toBe(mtimes[index]);
    }
  });
});
