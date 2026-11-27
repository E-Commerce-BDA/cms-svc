import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { CacheService } from '../src/cache/cache.service.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';

/** cms-013: a real Mongo round-trip for the 2.2.0 nested theme body. */
describe('Nested global theme (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let cache: CacheService;
  let jwtService: JwtService;
  let adminToken: string;
  let previewToken: string;

  const nestedTheme = {
    button: { defaultVariant: 'primary', borderRadius: 8 },
    palette: {
      brand: { brand: '#123456', brandHover: '#654321', onBrand: '#ffffff' },
      ink: { ink: '#111111' },
      navbar: { bg: '#fafafa' },
    },
    navbar: { height: 72, bg: '#fafafa' },
    filterRail: { bg: '#ffffff', gap: 12 },
    drawer: { bg: '#ffffff', width: 320, motion: 'slide' },
    marquee: { speed: 20, direction: 'left', pauseOnHover: true },
    grid: { gap: 16 },
    productCard: {
      ctaBg: '#000000',
      ctaTextColor: '#ffffff',
      ctaBorderColor: '#123456',
    },
  };

  const clearCache = async (): Promise<void> => {
    await cache.delKeys([cache.settingsGlobalKey()]);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    cache = app.get<CacheService>(CacheService);
    jwtService = app.get<JwtService>(JwtService);
    await clearCache();

    adminToken = jwtService.sign(
      { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
    const issued = await request(app.getHttpServer())
      .get('/api/v1/cms/admin/preview-token')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    previewToken = issued.body.token;
  });

  afterAll(async () => {
    if (cache) {
      await clearCache();
    }
    if (connection) {
      await connection.dropDatabase();
    }
    if (app) {
      await app.close();
    }
  });

  it('stores nested palette and groups verbatim, then serves them publicly', async () => {
    const written = await request(app.getHttpServer())
      .put('/api/v1/cms/admin/settings/global')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(nestedTheme)
      .expect(200);

    expect(written.body).toEqual({
      theme: nestedTheme,
      version: expect.any(Number),
      configured: true,
    });

    const db = connection.db;
    if (!db) {
      throw new Error('Mongo connection is not ready');
    }
    const stored = await db.collection('cms_settings').findOne({ scope: 'global' });
    expect(stored?.theme).toEqual(nestedTheme);
    expect(stored?.theme?.palette?.brand?.brand).toBe('#123456');
    expect(stored?.theme?.productCard?.ctaBg).toBe('#000000');
    // A flattened write would put these at the top level or use dotted keys.
    expect(stored?.theme?.brand).toBeUndefined();
    expect(stored?.theme?.['palette.brand']).toBeUndefined();

    const outbox = await db.collection('cms_outbox').findOne({
      aggregate_type: 'settings',
      aggregate_id: 'global',
      event_type: 'cms.updated',
    });
    // The stored envelope is canonical 2.x: `type`, not the 1.x `topic` alias.
    expect(outbox?.envelope).toMatchObject({
      type: 'cms.updated',
      payload: { scope: 'theme' },
    });

    const publicRead = await request(app.getHttpServer())
      .get('/api/v1/cms/settings/global')
      .expect(200);
    expect(publicRead.body.theme).toEqual(nestedTheme);
    expect(publicRead.body.theme.palette.brand.brand).toBe('#123456');
    expect(publicRead.body).toEqual({
      theme: nestedTheme,
      version: written.body.version,
      configured: true,
    });
  });

  it('does not let a preview token reach the admin write path', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/cms/admin/settings/global?preview=${previewToken}`)
      .send({ palette: { brand: { brand: '#ffffff' } } })
      .expect(401);
    await request(app.getHttpServer())
      .put('/api/v1/cms/admin/settings/global')
      .set('x-preview-token', previewToken)
      .send({ palette: { brand: { brand: '#ffffff' } } })
      .expect(401);

    const db = connection.db;
    if (!db) {
      throw new Error('Mongo connection is not ready');
    }
    const stored = await db.collection('cms_settings').findOne({ scope: 'global' });
    expect(stored?.theme?.palette?.brand?.brand).toBe('#123456');
  });
});
