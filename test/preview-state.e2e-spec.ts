import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { CacheService } from '../src/cache/cache.service.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';

/**
 * cms-012: state metadata and the preview seam, exercised against the live
 * Mongo container through the same Nest app the service runs.
 */
describe('Public state metadata & preview (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let jwtService: JwtService;
  let adminToken: string;
  let customerToken: string;
  let previewToken: string;

  const pageKey = 'preview-state-page';
  const draftSlug = 'preview-state-draft';

  // E2E suites share one Redis instance. Clear only the keys this suite reads
  // or writes so a previous run cannot answer from cache after the test DB is
  // dropped — and so this suite cannot leave a configured footer behind.
  let cache: CacheService;
  const clearCache = async (): Promise<void> => {
    await cache.delKeys([
      cache.settingsGlobalKey(),
      cache.pageSettingsKey('preview-state-page'),
      cache.pageSettingsKey('preview-unknown-key'),
      cache.navigationKey(),
      cache.footerKey(),
      cache.sectionsPageKey(pageKey),
      cache.blogSlugKey(draftSlug),
      cache.pageSlugKey('preview-inactive-page'),
    ]);
  };

  const hero = {
    key: 'preview-state-hero',
    pageKey,
    type: 'hero',
    title: 'Preview Hero',
    content: {
      slides: [
        {
          id: 'slide-1',
          headline: 'Draft preview',
          image: 'media/2026/11/preview.webp',
        },
      ],
    },
    settings: {},
    isActive: true,
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
    jwtService = app.get<JwtService>(JwtService);
    cache = app.get<CacheService>(CacheService);
    await clearCache();
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

  describe('Preview token contract', () => {
    it('requires an admin credential and never exposes writes', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/cms/admin/preview-token')
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/cms/admin/preview-token')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);

      const issued = await request(app.getHttpServer())
        .get('/api/v1/cms/admin/preview-token?expiresIn=60')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const [version, exp, sig] = issued.body.token.split('.');
      expect(version).toBe('v1');
      expect(Number(exp)).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      expect(issued.body.expiresAt).toBe(new Date(Number(exp) * 1000).toISOString());
      expect(issued.body.token).not.toContain('admin@example.com');

      await request(app.getHttpServer())
        .get('/api/v1/cms/admin/preview-token?expiresIn=0')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

  });

  describe('configured metadata', () => {
    it('marks never-configured settings, page settings, nav and footer', async () => {
      const theme = await request(app.getHttpServer())
        .get('/api/v1/cms/settings/global')
        .expect(200);
      const page = await request(app.getHttpServer())
        .get('/api/v1/cms/settings/page/preview-unknown-key')
        .expect(200);
      const nav = await request(app.getHttpServer())
        .get('/api/v1/cms/navigation')
        .expect(200);
      const footer = await request(app.getHttpServer())
        .get('/api/v1/cms/footer')
        .expect(200);

      expect(theme.body).toEqual({
        theme: {},
        version: expect.any(Number),
        configured: false,
      });
      expect(page.body).toEqual({
        settings: {},
        version: expect.any(Number),
        configured: false,
      });
      expect(nav.body).toEqual({
        navbar: {},
        version: expect.any(Number),
        configured: false,
      });
      expect(footer.body).toEqual({
        footer: {},
        version: expect.any(Number),
        configured: false,
      });
    });

    it('distinguishes an admin-cleared document from a never-configured one', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/cms/admin/settings/global')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ button: { defaultVariant: 'primary' } })
        .expect(200);
      const cleared = await request(app.getHttpServer())
        .put('/api/v1/cms/admin/settings/global')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(200);

      expect(cleared.body.theme).toEqual({});
      expect(cleared.body.configured).toBe(true);

      const page = await request(app.getHttpServer())
        .put('/api/v1/cms/admin/settings/page/preview-state-page')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ shared: { layout: { mode: 'split' } } })
        .expect(200);
      expect(page.body.configured).toBe(true);
      expect(
        (await request(app.getHttpServer())
          .get('/api/v1/cms/settings/page/preview-state-page')
          .expect(200)).body.configured,
      ).toBe(true);

      const nav = await request(app.getHttpServer())
        .put('/api/v1/cms/admin/navigation')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ shared: { bar: { height: 72 } } })
        .expect(200);
      expect(nav.body.configured).toBe(true);

      const footer = await request(app.getHttpServer())
        .put('/api/v1/cms/admin/footer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ wordmark: 'AFABETA' })
        .expect(200);
      expect(footer.body.configured).toBe(true);
      expect(
        (await request(app.getHttpServer())
          .get('/api/v1/cms/footer')
          .expect(200)).body.configured,
      ).toBe(true);
    });
  });

  describe('section state metadata', () => {
    it('moves missing -> published -> empty and previews the inactive row', async () => {
      const missing = await request(app.getHttpServer())
        .get(`/api/v1/cms/sections?pageKey=${pageKey}`)
        .expect(200);
      expect(missing.body).toEqual({
        sections: [],
        version: expect.any(Number),
        state: 'missing',
      });

      await request(app.getHttpServer())
        .post('/api/v1/cms/admin/sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(hero)
        .expect(201);

      const published = await request(app.getHttpServer())
        .get(`/api/v1/cms/sections?pageKey=${pageKey}`)
        .expect(200);
      expect(published.body.state).toBe('published');
      expect(published.body.sections).toHaveLength(1);

      await request(app.getHttpServer())
        .patch(`/api/v1/cms/admin/sections/${hero.key}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      const empty = await request(app.getHttpServer())
        .get(`/api/v1/cms/sections?pageKey=${pageKey}`)
        .expect(200);
      expect(empty.body).toEqual({
        sections: [],
        version: expect.any(Number),
        state: 'empty',
      });

      const viaQuery = await request(app.getHttpServer())
        .get(`/api/v1/cms/sections?pageKey=${pageKey}&preview=${previewToken}`)
        .expect(200);
      expect(viaQuery.body.sections).toHaveLength(1);
      expect(viaQuery.body.sections[0].isActive).toBe(false);
      // `state` always describes shoppers, even while a draft is being viewed.
      expect(viaQuery.body.state).toBe('empty');
      expect(viaQuery.headers['cache-control']).toBe('private, no-store');

      const viaHeader = await request(app.getHttpServer())
        .get(`/api/v1/cms/sections?pageKey=${pageKey}`)
        .set('x-preview-token', previewToken)
        .expect(200);
      expect(viaHeader.body.sections).toHaveLength(1);
      expect(viaHeader.headers['cache-control']).toBe('private, no-store');
    });

    it('stops admitting drafts once the token expires', async () => {
      const short = await request(app.getHttpServer())
        .get('/api/v1/cms/admin/preview-token?expiresIn=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const during = await request(app.getHttpServer())
        .get(`/api/v1/cms/sections?pageKey=${pageKey}&preview=${short.body.token}`)
        .expect(200);
      expect(during.body.sections).toHaveLength(1);

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const after = await request(app.getHttpServer())
        .get(`/api/v1/cms/sections?pageKey=${pageKey}&preview=${short.body.token}`)
        .expect(200);
      expect(after.body.sections).toEqual([]);
      expect(after.body.state).toBe('empty');
    });

    it('ignores an invalid token and keeps the public write surface closed', async () => {
      const invalid = await request(app.getHttpServer())
        .get(`/api/v1/cms/sections?pageKey=${pageKey}&preview=v1.bad.sig`)
        .expect(200);
      expect(invalid.body.sections).toEqual([]);
      expect(invalid.body.state).toBe('empty');
      expect(invalid.headers['cache-control']).not.toBe('private, no-store');

      await request(app.getHttpServer())
        .post(`/api/v1/cms/sections?pageKey=${pageKey}&preview=${previewToken}`)
        .send(hero)
        .expect(404);
    });
  });

  describe('blog and page preview', () => {
    let categoryId: string;

    beforeAll(async () => {
      const category = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/blog-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Preview Category', slug: 'preview-category' })
        .expect(201);
      categoryId = category.body.category.id;

      await request(app.getHttpServer())
        .post('/api/v1/cms/admin/blogs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: draftSlug,
          title: 'Preview Draft',
          content: [{ type: 'paragraph', id: 'p-1', text: 'Draft body' }],
          categoryId,
          status: 'draft',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/cms/admin/pages')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: 'preview-inactive-page',
          title: 'Inactive Preview Page',
          blocks: [
            {
              type: 'rich_text',
              id: 'rt-1',
              body: '<p>Draft page</p>',
            },
          ],
          isActive: false,
        })
        .expect(201);
    });

    it('hides drafts normally and admits them with a valid token', async () => {
      const publicList = await request(app.getHttpServer())
        .get('/api/v1/cms/blogs')
        .expect(200);
      expect(
        publicList.body.data.some((b: { slug: string }) => b.slug === draftSlug),
      ).toBe(false);
      await request(app.getHttpServer())
        .get(`/api/v1/cms/blogs/${draftSlug}`)
        .expect(404);

      const previewList = await request(app.getHttpServer())
        .get(`/api/v1/cms/blogs?preview=${previewToken}`)
        .expect(200);
      expect(previewList.body.data.some((b: { slug: string }) => b.slug === draftSlug)).toBe(true);
      expect(previewList.headers['cache-control']).toBe('private, no-store');

      const previewOne = await request(app.getHttpServer())
        .get(`/api/v1/cms/blogs/${draftSlug}`)
        .set('x-preview-token', previewToken)
        .expect(200);
      expect(previewOne.body.blog.status).toBe('draft');

      const invalid = await request(app.getHttpServer())
        .get(`/api/v1/cms/blogs/${draftSlug}?preview=v1.bad.sig`)
        .expect(404);
      expect(invalid.body.error.code).toBe('BLOG_NOT_FOUND');
    });

    it('admits an inactive page only through the preview seam', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/cms/pages/preview-inactive-page')
        .expect(404);

      const preview = await request(app.getHttpServer())
        .get(`/api/v1/cms/pages/preview-inactive-page?preview=${previewToken}`)
        .expect(200);
      expect(preview.body.page.slug).toBe('preview-inactive-page');
      expect(preview.headers['cache-control']).toBe('private, no-store');
    });
  });
});
