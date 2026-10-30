import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

const TEN_MB = 10 * 1024 * 1024;

describe('CMS media upload limits and mime checks (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let adminToken: string;
  const tempDir = path.resolve(process.cwd(), 'storage-limits-test');

  beforeAll(async () => {
    process.env.STORAGE_LOCAL_DIR = tempDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    adminToken = app
      .get(JwtService)
      .sign(
        { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
        { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      );
  });

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
    }
    if (app) {
      await app.close();
    }
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects an 11 MB upload with 413 MEDIA_TOO_LARGE before reading the body', async () => {
    const oversized = Buffer.alloc(TEN_MB + 1024 * 1024, 0);

    const res = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('usage', 'section')
      .attach('file', oversized, { filename: 'huge.png', contentType: 'image/png' })
      .expect(413);

    expect(res.body.error).toMatchObject({
      code: 'MEDIA_TOO_LARGE',
      message: 'File exceeds maximum allowed size of 10 MB',
    });
  });

  it('rejects a text body declared as image/png with 400 MEDIA_TYPE_UNSUPPORTED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('this is plainly not a png'), {
        filename: 'notes.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(res.body.error.code).toBe('MEDIA_TYPE_UNSUPPORTED');
  });

  it('rejects PNG bytes declared as image/jpeg with 400 MEDIA_TYPE_MISMATCH', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG_BYTES, {
        filename: 'renamed.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    expect(res.body.error.code).toBe('MEDIA_TYPE_MISMATCH');
  });

  it('accepts a real PNG and stores the sniffed type and byte length', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('usage', 'section')
      .attach('file', PNG_BYTES, {
        filename: 'hero.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(res.body.media).toMatchObject({
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
    });
    expect(res.body.media.key).toMatch(/^media\/\d{4}\/\d{2}\/.+\.png$/);
  });

  it('authenticates before it measures: an anonymous upload is 401, not 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .attach('file', PNG_BYTES, {
        filename: 'hero.png',
        contentType: 'image/png',
      })
      .expect(401);

    expect(res.body.error).toBeDefined();
  });
});
