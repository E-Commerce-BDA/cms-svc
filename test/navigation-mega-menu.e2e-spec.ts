import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';
import { CacheService } from '../src/cache/cache.service.js';

/**
 * cms-014: a real Mongo round-trip for a 2.2.0 mega-menu document. Admin PUT
 * and both GETs use the same validation boundary as the storefront reader.
 */
describe('Mega-menu navigation (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let cache: CacheService;
  let adminToken: string;

  const megaMenuNav = {
    shared: {
      bar: { height: 64 },
      links: {
        items: [
          {
            kind: 'custom',
            label: 'Shop',
            href: '/shop',
            groups: [
              {
                title: 'Women',
                columns: 2,
                items: [
                  {
                    label: 'Dresses',
                    href: '/shop/women/dresses',
                    description: 'New season',
                    badge: { text: 'New' },
                  },
                  { label: 'Tops', href: 'https://example.com/tops' },
                ],
              },
              {
                title: 'Men',
                items: [{ label: 'Shirts', href: '/shop/men/shirts' }],
                promo: {
                  title: 'Summer edit',
                  href: '/promo/summer',
                  description: 'Up to 50% off',
                  imageUrl: 'media/summer.webp',
                  badge: { text: 'Sale' },
                },
              },
            ],
          },
          { kind: 'custom', label: 'Journal', href: '/journal' },
        ],
      },
    },
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
    await cache.delKeys([cache.navigationKey()]);

    const jwtService = app.get<JwtService>(JwtService);
    adminToken = jwtService.sign(
      { sub: '0190a1b2-admin', email: 'admin@example.com', roles: ['admin'] },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
  });

  afterAll(async () => {
    if (cache) {
      await cache.delKeys([cache.navigationKey()]);
    }
    if (connection) {
      await connection.dropDatabase();
    }
    if (app) {
      await app.close();
    }
  });

  it('round-trips two groups and a promo from admin PUT to public GET', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/v1/cms/navigation')
      .expect(200);
    expect(typeof before.body.version).toBe('number');

    // A sentinel proves the publish deletes the cached body rather than
    // merely refreshing it.
    const cacheKey = cache.navigationKey();
    await cache.set(cacheKey, { sentinel: true });

    const put = await request(app.getHttpServer())
      .put('/api/v1/cms/admin/navigation')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(megaMenuNav)
      .expect(200);

    expect(put.body).toEqual({
      navbar: megaMenuNav,
      version: expect.any(Number),
      configured: true,
    });
    expect(typeof put.body.version).toBe('number');
    expect(await cache.get(cacheKey)).toBeNull();

    const db = connection.db;
    if (!db) {
      throw new Error('Mongo connection is not ready');
    }
    const stored = await db.collection('cms_navigation').findOne({ scope: 'navbar' });
    expect(stored?.navbar).toEqual(megaMenuNav);
    // The response version is the committed revision, not a separate counter.
    const revision = await db
      .collection<{ _id: string; version: number }>('cms_meta')
      .findOne({ _id: 'revision' });
    expect(revision?.version).toBe(put.body.version);
    const outbox = await db.collection('cms_outbox').findOne({
      aggregate_type: 'navigation',
      aggregate_id: 'navbar',
      event_type: 'cms.updated',
    });
    expect(outbox?.envelope).toMatchObject({
      type: 'cms.updated',
      payload: { scope: 'navigation', version: put.body.version },
    });

    const adminGet = await request(app.getHttpServer())
      .get('/api/v1/cms/admin/navigation')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminGet.body).toEqual(put.body);

    const publicGet = await request(app.getHttpServer())
      .get('/api/v1/cms/navigation')
      .expect(200);
    expect(publicGet.body).toEqual(put.body);
    expect(publicGet.body.navbar.shared.links.items[0].groups).toHaveLength(2);
    expect(
      publicGet.body.navbar.shared.links.items[0].groups[1].promo.title,
    ).toBe('Summer edit');
  });

  it.each([
    [
      'seven groups',
      {
        ...megaMenuNav,
        shared: {
          ...megaMenuNav.shared,
          links: {
            items: [
              {
                ...megaMenuNav.shared.links.items[0],
                groups: Array.from({ length: 7 }, () => ({
                  title: 'Women',
                  items: [{ label: 'Dresses', href: '/shop/dresses' }],
                })),
              },
            ],
          },
        },
      },
      'NAV_INVALID_GROUPS',
    ],
    [
      'five columns',
      {
        ...megaMenuNav,
        shared: {
          ...megaMenuNav.shared,
          links: {
            items: [
              {
                ...megaMenuNav.shared.links.items[0],
                groups: [
                  {
                    title: 'Women',
                    columns: 5,
                    items: [{ label: 'Dresses', href: '/shop/dresses' }],
                  },
                ],
              },
            ],
          },
        },
      },
      'NAV_INVALID_GROUPS',
    ],
    [
      'unsafe promo href',
      {
        ...megaMenuNav,
        shared: {
          ...megaMenuNav.shared,
          links: {
            items: [
              {
                ...megaMenuNav.shared.links.items[0],
                groups: [
                  {
                    title: 'Women',
                    items: [{ label: 'Dresses', href: '/shop/dresses' }],
                    promo: { title: 'Trap', href: 'javascript:alert(1)' },
                  },
                ],
              },
            ],
          },
        },
      },
      'NAV_INVALID_HREF',
    ],
  ])('rejects %s with 400 and a clear code', async (_label, body, code) => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/cms/admin/navigation')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(400);

    expect(res.body.error.code).toBe(code);
    expect(res.body.error.details[0].field).toContain('groups');

    const publicGet = await request(app.getHttpServer())
      .get('/api/v1/cms/navigation')
      .expect(200);
    expect(publicGet.body.navbar).toEqual(megaMenuNav);
  });

  it('still accepts and serves a pre-2.2 body without groups', async () => {
    const legacy = { shared: { bar: { height: 72 } } };
    const previous = await request(app.getHttpServer())
      .get('/api/v1/cms/navigation')
      .expect(200);
    const put = await request(app.getHttpServer())
      .put('/api/v1/cms/admin/navigation')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(legacy)
      .expect(200);
    expect(put.body.navbar).toEqual(legacy);
    expect(put.body.version).toBeGreaterThan(previous.body.version);

    const publicGet = await request(app.getHttpServer())
      .get('/api/v1/cms/navigation')
      .expect(200);
    expect(publicGet.body.navbar).toEqual(legacy);
    expect(publicGet.body.version).toBe(put.body.version);
    expect(publicGet.body.configured).toBe(true);
  });
});
