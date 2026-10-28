import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';

describe('CMS Media Subsystem (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let jwtService: JwtService;
  let adminToken: string;
  let customerToken: string;
  const tempDir = path.resolve(process.cwd(), 'storage-test');

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
    jwtService = app.get<JwtService>(JwtService);

    adminToken = jwtService.sign(
      { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );

    customerToken = jwtService.sign(
      {
        sub: '0190a1b2-cust',
        email: 'customer@example.com',
        roles: ['customer'],
      },
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

  const dummyPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  let uploadedMediaId: string;
  let uploadedMediaKey: string;
  let uploadedMediaUrl: string;

  it('rejects unauthenticated upload with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .attach('file', dummyPngBuffer, 'test.png')
      .expect(401);
  });

  it('rejects customer role upload with 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('file', dummyPngBuffer, 'test.png')
      .expect(403);
  });

  it('rejects unsupported MIME type (SVG) with 400 MEDIA_TYPE_UNSUPPORTED', async () => {
    const svgBuffer = Buffer.from('<svg></svg>');
    const res = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', svgBuffer, 'icon.svg')
      .expect(400);

    expect(res.body.error.code).toBe('MEDIA_TYPE_UNSUPPORTED');
  });

  it('rejects upload when no file is attached with 400 VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('successfully uploads valid image as admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('usage', 'section')
      .field('alt', 'Spring Campaign Banner')
      .attach('file', dummyPngBuffer, 'spring-hero.png')
      .expect(201);

    expect(res.body.media).toBeDefined();
    expect(res.body.media.id).toBeDefined();
    expect(res.body.media.key).toMatch(/^media\/\d{4}\/\d{2}\/.+\.png$/);
    expect(res.body.media.url).toContain('/api/v1/cms/media/file/');
    expect(res.body.media.mimeType).toBe('image/png');
    expect(res.body.media.usage).toBe('section');
    expect(res.body.media.alt).toBe('Spring Campaign Banner');

    uploadedMediaId = res.body.media.id;
    uploadedMediaKey = res.body.media.key;
    uploadedMediaUrl = res.body.media.url;
  });

  it('serves uploaded image through public file route', async () => {
    const res = await request(app.getHttpServer())
      .get(uploadedMediaUrl)
      .expect(200);

    expect(res.body).toEqual(dummyPngBuffer);
  });

  it('returns 404 for nonexistent file route', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/cms/media/file/media/9999/99/missing.png')
      .expect(404);
  });

  it('lists admin media with pagination and usage filter', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cms/admin/media?usage=section')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.page).toBe(1);
    expect(res.body.perPage).toBe(20);
    const found = res.body.data.find(
      (m: { id: string }) => m.id === uploadedMediaId,
    );
    expect(found).toBeDefined();
  });

  it('in-use guard rejects media deletion with 409 when referenced in section', async () => {
    // Create a section referencing this media key
    await request(app.getHttpServer())
      .post('/api/v1/cms/admin/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'media-test-section',
        pageKey: 'homepage',
        type: 'banner',
        title: 'Banner using media',
        content: {
          image: uploadedMediaKey,
        },
        settings: {},
        isActive: true,
      })
      .expect(201);

    // Attempting to delete media must be rejected with 409
    const delRes = await request(app.getHttpServer())
      .delete(`/api/v1/cms/admin/media/${uploadedMediaId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    expect(delRes.body.error.code).toBe('MEDIA_IN_USE');

    // Clean up the section
    await request(app.getHttpServer())
      .delete('/api/v1/cms/admin/sections/media-test-section')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });

  it('deletes media successfully when no longer in use', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/cms/admin/media/${uploadedMediaId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    // Verify media list no longer contains this media
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const found = listRes.body.data.find(
      (m: { id: string }) => m.id === uploadedMediaId,
    );
    expect(found).toBeUndefined();

    // Verify public file route returns 404
    await request(app.getHttpServer()).get(uploadedMediaUrl).expect(404);
  });
});
