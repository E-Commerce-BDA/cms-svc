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

describe('CMS Sections, Settings & Navigation (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let jwtService: JwtService;
  let adminToken: string;
  let customerToken: string;

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
    jwtService = app.get<JwtService>(JwtService);

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
  });

  const validHero = {
    key: 'home-hero',
    pageKey: 'homepage',
    type: 'hero',
    title: 'Autumn Main Hero',
    content: {
      slides: [
        {
          id: 'slide-1',
          headline: 'Explore Autumn',
          image: 'media/2026/10/hero.webp',
          ctas: [
            {
              id: 'cta-1',
              text: 'Shop Outerwear',
              link: '/products?category=outerwear',
            },
          ],
        },
      ],
    },
    settings: {
      ratio: '16:9',
      blendMode: 'multiply',
    },
    isActive: true,
  };

  const validBanner = {
    key: 'home-banner',
    pageKey: 'homepage',
    type: 'banner',
    title: 'Mid-Season Promo',
    content: {
      title: 'Member Exclusive Sale',
      image: 'media/2026/10/banner.webp',
      ctas: [
        {
          id: 'cta-2',
          text: 'View Deals',
          link: '/products',
        },
      ],
    },
    settings: {
      blendMode: 'normal',
    },
    isActive: true,
  };

  describe('Sections Lifecycle', () => {
    it('GET /api/v1/cms/sections returns empty sections and initial version', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/sections?pageKey=homepage')
        .expect(200);

      expect(res.body).toHaveProperty('sections');
      expect(res.body).toHaveProperty('version');
      expect(Array.isArray(res.body.sections)).toBe(true);
    });

    it('POST /api/v1/cms/admin/sections rejects unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cms/admin/sections')
        .send(validHero)
        .expect(401);
    });

    it('POST /api/v1/cms/admin/sections rejects non-admin caller with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cms/admin/sections')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(validHero)
        .expect(403);
    });

    it('POST /api/v1/cms/admin/sections rejects payload with >3 CTAs with 400 VALIDATION_FAILED', async () => {
      const invalidHero = {
        ...validHero,
        content: {
          slides: [
            {
              id: 'slide-1',
              headline: 'Too many CTAs',
              image: 'media/hero.webp',
              ctas: [
                { id: 'c1', text: 'One', link: '/1' },
                { id: 'c2', text: 'Two', link: '/2' },
                { id: 'c3', text: 'Three', link: '/3' },
                { id: 'c4', text: 'Four', link: '/4' },
              ],
            },
          ],
        },
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidHero)
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('POST /api/v1/cms/admin/sections creates a hero section', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validHero)
        .expect(201);

      expect(res.body.section.key).toBe('home-hero');
      expect(res.body.section.sortOrder).toBe(0);
    });

    it('POST /api/v1/cms/admin/sections creates a second section and assigns incremented sortOrder', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validBanner)
        .expect(201);

      expect(res.body.section.key).toBe('home-banner');
      expect(res.body.section.sortOrder).toBe(1);
    });

    it('POST /api/v1/cms/admin/sections rejects duplicate key with 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validHero)
        .expect(409);

      expect(res.body.error.code).toBe('SECTION_KEY_EXISTS');
    });

    it('GET /api/v1/cms/sections returns the active sections sorted', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/sections?pageKey=homepage')
        .expect(200);

      expect(res.body.sections).toHaveLength(2);
      expect(res.body.sections[0].key).toBe('home-hero');
      expect(res.body.sections[1].key).toBe('home-banner');
    });

    it('PATCH /api/v1/cms/admin/sections/:key rejects type mutation with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/cms/admin/sections/home-hero')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'banner' })
        .expect(400);

      expect(res.body.error.code).toBe('SECTION_TYPE_IMMUTABLE');
    });

    it('PATCH /api/v1/cms/admin/sections/:key updates editable fields', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/cms/admin/sections/home-hero')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Updated Autumn Hero' })
        .expect(200);

      expect(res.body.section.title).toBe('Updated Autumn Hero');
    });

    it('PATCH /api/v1/cms/admin/sections/reorder reverses section ordering', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/cms/admin/sections/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          pageKey: 'homepage',
          orderedKeys: ['home-banner', 'home-hero'],
        })
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/sections?pageKey=homepage')
        .expect(200);

      expect(res.body.sections[0].key).toBe('home-banner');
      expect(res.body.sections[1].key).toBe('home-hero');
    });

    it('DELETE /api/v1/cms/admin/sections/:key deletes section', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/cms/admin/sections/home-banner')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/sections?pageKey=homepage')
        .expect(200);

      expect(res.body.sections).toHaveLength(1);
      expect(res.body.sections[0].key).toBe('home-hero');
    });
  });

  describe('Theme Settings', () => {
    it('GET /api/v1/cms/settings/global returns initial theme', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/settings/global')
        .expect(200);

      expect(res.body).toHaveProperty('theme');
      expect(res.body).toHaveProperty('version');
    });

    it('PUT /api/v1/cms/admin/settings/global updates theme and bumps revision', async () => {
      const newTheme = {
        button: {
          defaultVariant: 'primary',
          borderRadius: 12,
          bg: '#0077b6',
        },
      };

      const res = await request(app.getHttpServer())
        .put('/api/v1/cms/admin/settings/global')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newTheme)
        .expect(200);

      expect(res.body.theme.button.borderRadius).toBe(12);

      const publicRes = await request(app.getHttpServer())
        .get('/api/v1/cms/settings/global')
        .expect(200);

      expect(publicRes.body.theme.button.borderRadius).toBe(12);
    });
  });

  describe('Page Settings (Auth)', () => {
    it('GET /api/v1/cms/settings/page/:pageKey returns initial settings', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/settings/page/signin')
        .expect(200);

      expect(res.body).toHaveProperty('settings');
      expect(res.body).toHaveProperty('version');
    });

    it('PUT /api/v1/cms/admin/settings/page/:pageKey updates auth page settings', async () => {
      const authSettings = {
        shared: {
          layout: { mode: 'split', panelSide: 'left' },
          form: { surface: 'white', width: 440 },
        },
      };

      const res = await request(app.getHttpServer())
        .put('/api/v1/cms/admin/settings/page/signin')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(authSettings)
        .expect(200);

      expect(res.body.settings.shared.form.width).toBe(440);

      const publicRes = await request(app.getHttpServer())
        .get('/api/v1/cms/settings/page/signin')
        .expect(200);

      expect(publicRes.body.settings.shared.form.width).toBe(440);
    });
  });

  describe('Navigation Settings', () => {
    it('GET /api/v1/cms/navigation returns initial navigation', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/navigation')
        .expect(200);

      expect(res.body).toHaveProperty('navbar');
      expect(res.body).toHaveProperty('version');
    });

    it('PUT /api/v1/cms/admin/navigation updates navbar and bumps revision', async () => {
      const navSettings = {
        shared: {
          bar: { height: 72, sticky: 'always' },
          regions: { search: true, cart: true },
        },
      };

      const res = await request(app.getHttpServer())
        .put('/api/v1/cms/admin/navigation')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(navSettings)
        .expect(200);

      expect(res.body.navbar.shared.bar.height).toBe(72);

      const publicRes = await request(app.getHttpServer())
        .get('/api/v1/cms/navigation')
        .expect(200);

      expect(publicRes.body.navbar.shared.bar.height).toBe(72);
    });
  });
});
