import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
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

describe('CMS Media Security (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let adminToken: string;
  let customerToken: string;
  const tempDir = path.resolve(process.cwd(), 'storage-security-test');

  const dummyPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

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
    const jwtService = app.get<JwtService>(JwtService);

    adminToken = jwtService.sign(
      { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
    customerToken = jwtService.sign(
      { sub: '0190a1b2-cust', email: 'customer@example.com', roles: ['customer'] },
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

  async function upload(
    visibility?: string,
  ): Promise<{ id: string; key: string; url: string }> {
    let call = request(app.getHttpServer())
      .post('/api/v1/cms/admin/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('usage', 'page');
    if (visibility) {
      call = call.field('visibility', visibility);
    }

    const res = await call
      .attach('file', dummyPngBuffer, 'asset.png')
      .expect(201);

    return {
      id: res.body.media.id as string,
      key: res.body.media.key as string,
      url: res.body.media.url as string,
    };
  }

  describe('path containment', () => {
    const traversalVectors: [string, string][] = [
      ['literal parent traversal', '../../../../etc/passwd'],
      ['encoded parent traversal', '%2e%2e%2f%2e%2e%2fetc%2fpasswd'],
      ['encoded backslash traversal', '..%5c..%5cWindows%5cwin.ini'],
      ['traversal after a media prefix', 'media/2026/10/../../../../package.json'],
      ['absolute windows path', 'C:%5cWindows%5cwin.ini'],
      ['null byte suffix', 'media/2026/10/0190a1b2-c3d4-7e8f-9012-3456789abcde.png%00.jpg'],
      ['wrong extension', 'media/2026/10/0190a1b2-c3d4-7e8f-9012-3456789abcde.svg'],
    ];

    it.each(traversalVectors)(
      'answers 404 with no path leak for %s',
      async (_label, vector) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/cms/media/file/${vector}`)
          .expect(404);

        expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
        expect(res.body.error.message).toBe('File not found');

        const body = JSON.stringify(res.body);
        expect(body).not.toContain('storage');
        expect(body).not.toContain('media/');
        expect(body).not.toContain('\\');
        expect(body).not.toContain(tempDir);
      },
    );

    it('does not serve a file that has no media row', async () => {
      const orphanKey = `media/2026/10/${randomUUID()}.png`;
      const orphanPath = path.join(tempDir, ...orphanKey.split('/'));
      await fs.promises.mkdir(path.dirname(orphanPath), { recursive: true });
      await fs.promises.writeFile(orphanPath, dummyPngBuffer);

      await request(app.getHttpServer())
        .get(`/api/v1/cms/media/file/${orphanKey}`)
        .expect(404);
    });
  });

  describe('visibility', () => {
    let publicMedia: { id: string; key: string; url: string };
    let privateMedia: { id: string; key: string; url: string };

    beforeAll(async () => {
      publicMedia = await upload('public');
      privateMedia = await upload('private');
    });

    it('reports the default visibility as public', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', dummyPngBuffer, 'default.png')
        .expect(201);

      expect(res.body.media.visibility).toBe('public');
    });

    it('rejects an unknown visibility with 400 VALIDATION_FAILED', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('visibility', 'secret')
        .attach('file', dummyPngBuffer, 'secret.png')
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('serves a public asset with a revalidating cache policy', async () => {
      const res = await request(app.getHttpServer())
        .get(publicMedia.url)
        .expect(200);

      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['cache-control']).toBe('public, max-age=60, must-revalidate');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe('inline');
      expect(res.body).toEqual(dummyPngBuffer);
    });

    it('hides a private asset from the public route', async () => {
      const res = await request(app.getHttpServer())
        .get(privateMedia.url)
        .expect(404);

      expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
      expect(res.body.error.message).toBe('File not found');
    });

    it('serves a private asset on the admin route', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/cms/admin/media/${privateMedia.id}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.body).toEqual(dummyPngBuffer);
    });

    it('requires an admin on the admin file route', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/cms/admin/media/${publicMedia.id}/file`)
        .expect(401);

      await request(app.getHttpServer())
        .get(`/api/v1/cms/admin/media/${publicMedia.id}/file`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });

    it('rejects a non-ObjectId id on the admin file route with 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/admin/media/not-an-object-id/file')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(res.body.error.message).toBe('File not found');
    });

    it('filters the admin list by visibility', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/admin/media?visibility=private')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ids = (res.body.data as { id: string }[]).map((item) => item.id);
      expect(ids).toContain(privateMedia.id);
      expect(ids).not.toContain(publicMedia.id);
    });

    it('answers 404 on both routes once the media is deleted', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/cms/admin/media/${privateMedia.id}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/cms/admin/media/${privateMedia.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/cms/admin/media/${privateMedia.id}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      await request(app.getHttpServer()).get(privateMedia.url).expect(404);
    });
  });
});
