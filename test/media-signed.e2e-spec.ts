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

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/**
 * Needs the same Mongo container as every other e2e suite. No LocalStack and
 * no second secret: signing is derived from the existing JWT_SECRET.
 */
describe('Signed private media (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let adminToken: string;
  let media: { id: string; key: string; url: string };
  const storageDir = path.resolve(process.cwd(), 'storage-signed-test');

  beforeAll(async () => {
    process.env.STORAGE_LOCAL_DIR = storageDir;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    adminToken = app.get<JwtService>(JwtService).sign(
      { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );

    const upload = await request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('visibility', 'private')
      .attach('file', PNG, 'private.png')
      .expect(201);
    media = {
      id: upload.body.media.id as string,
      key: upload.body.media.key as string,
      url: upload.body.media.url as string,
    };
  });

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
    }
    if (app) {
      await app.close();
    }
    if (fs.existsSync(storageDir)) {
      await fs.promises.rm(storageDir, { recursive: true, force: true });
    }
  });

  it('only lets an admin issue a capability for a private row', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/cms/admin/media/${media.id}/signed-url`)
      .expect(401);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/cms/admin/media/${media.id}/signed-url?expiresIn=60`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.url).toContain(`/api/v1/cms/media/signed/${media.key}?`);
    expect(res.body.url).toContain('exp=');
    expect(res.body.url).toContain('sig=');
  });

  it('serves a private asset through an expiring URL with no credential', async () => {
    // The plain route must still hide the row: the capability is the only
    // addition, not a widening of the public route.
    await request(app.getHttpServer()).get(media.url).expect(404);

    const issued = await request(app.getHttpServer())
      .get(`/api/v1/cms/admin/media/${media.id}/signed-url`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(issued.body.url)
      .expect(200);

    expect(res.body).toEqual(PNG);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('rejects a tampered or expired URL', async () => {
    const issued = await request(app.getHttpServer())
      .get(`/api/v1/cms/admin/media/${media.id}/signed-url`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const url = new URL(issued.body.url, 'http://localhost');
    const signature = url.searchParams.get('sig') ?? '';
    const tampered = `${issued.body.url.slice(0, -1)}${
      signature.endsWith('0') ? '1' : '0'
    }`;

    const badSignature = await request(app.getHttpServer())
      .get(tampered)
      .expect(404);
    expect(badSignature.body.error.code).toBe('MEDIA_NOT_FOUND');

    const shortLived = await request(app.getHttpServer())
      .get(`/api/v1/cms/admin/media/${media.id}/signed-url?expiresIn=1`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await request(app.getHttpServer()).get(shortLived.body.url).expect(404);
  });

  it('refuses to sign a nonsensical expiry', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/cms/admin/media/${media.id}/signed-url?expiresIn=soon`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
