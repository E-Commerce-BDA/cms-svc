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

describe('CMS Pages & Blogs (e2e)', () => {
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
  });

  describe('Pages Subsystem', () => {
    const validPage = {
      slug: 'about-us',
      title: 'About Our Brand',
      blocks: [
        {
          type: 'rich_text',
          id: 'rt-1',
          body: '<h2>Our Story</h2><p>Crafting quality goods since 2026.</p>',
        },
        {
          type: 'faq',
          id: 'faq-1',
          items: [
            {
              question: 'Where are products made?',
              answer: 'All items are ethically made in Portugal.',
            },
          ],
        },
      ],
      seo: {
        title: 'About Us | Store',
        description: 'Discover the heritage of our store.',
      },
      isActive: true,
    };

    it('rejects unauthenticated page creation', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cms/admin/pages')
        .send(validPage)
        .expect(401);
    });

    it('rejects customer role page creation', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cms/admin/pages')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(validPage)
        .expect(403);
    });

    it('creates page as admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/pages')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPage)
        .expect(201);

      expect(res.body.page.slug).toBe('about-us');
      expect(res.body.page.title).toBe('About Our Brand');
      expect(res.body.page.blocks).toHaveLength(2);
    });

    it('rejects duplicate page slug with 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/pages')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPage)
        .expect(409);

      expect(res.body.error.code).toBe('PAGE_SLUG_EXISTS');
    });

    it('serves page list publicly', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/pages')
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const found = res.body.data.find(
        (p: { slug: string }) => p.slug === 'about-us',
      );
      expect(found).toBeDefined();
    });

    it('serves page by slug publicly', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/pages/about-us')
        .expect(200);

      expect(res.body.page.slug).toBe('about-us');
      expect(res.body.page.blocks[0].type).toBe('rich_text');
    });

    it('updates page as admin', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/cms/admin/pages/about-us')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'About Our Global Brand',
        })
        .expect(200);

      expect(res.body.page.title).toBe('About Our Global Brand');

      const pubRes = await request(app.getHttpServer())
        .get('/api/v1/cms/pages/about-us')
        .expect(200);

      expect(pubRes.body.page.title).toBe('About Our Global Brand');
    });

    it('returns 404 for public page when set to inactive', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/cms/admin/pages/about-us')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          isActive: false,
        })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/cms/pages/about-us')
        .expect(404);
    });

    it('deletes page as admin', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/cms/admin/pages/about-us')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/v1/cms/pages/about-us')
        .expect(404);
    });
  });

  describe('Blogs Subsystem', () => {
    let categoryId: string;
    let blogId: string;

    it('creates blog category as admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/blog-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Style & Trends',
          slug: 'style-trends',
          description: 'Editorial insights on modern fashion and style.',
        })
        .expect(201);

      expect(res.body.category.slug).toBe('style-trends');
      expect(res.body.category.name).toBe('Style & Trends');
      categoryId = res.body.category.id;
    });

    it('rejects duplicate blog category slug with 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/blog-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Style & Trends Duplicate',
          slug: 'style-trends',
        })
        .expect(409);

      expect(res.body.error.code).toBe('CATEGORY_SLUG_EXISTS');
    });

    it('serves blog categories publicly', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/blog-categories')
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(
        res.body.find((c: { slug: string }) => c.slug === 'style-trends'),
      ).toBeDefined();
    });

    it('creates draft blog as admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/blogs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: 'spring-lookbook-2027',
          title: 'Spring Lookbook 2027',
          coverUrl: 'media/2026/10/spring.webp',
          excerpt: 'A first glimpse at our spring collection.',
          content: [
            {
              type: 'heading',
              id: 'h-1',
              level: 2,
              text: 'A New Season of Textiles',
            },
            {
              type: 'paragraph',
              id: 'p-1',
              text: 'Lighter linen blends and warm pastels define this drop.',
            },
          ],
          categoryId,
          author: 'Editorial Team',
          status: 'draft',
        })
        .expect(201);

      expect(res.body.blog.slug).toBe('spring-lookbook-2027');
      expect(res.body.blog.status).toBe('draft');
      expect(res.body.blog.publishedAt).toBeNull();
      blogId = res.body.blog.id;
    });

    it('does not expose draft blog on public endpoints', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/cms/blogs')
        .expect(200);

      const found = listRes.body.data.find(
        (b: { slug: string }) => b.slug === 'spring-lookbook-2027',
      );
      expect(found).toBeUndefined();

      await request(app.getHttpServer())
        .get('/api/v1/cms/blogs/spring-lookbook-2027')
        .expect(404);
    });

    it('creates second blog directly as published', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cms/admin/blogs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: 'minimalist-wardrobe-guide',
          title: 'The Minimalist Wardrobe Guide',
          content: [
            {
              type: 'paragraph',
              id: 'p-1',
              text: 'How to build a capsule wardrobe.',
            },
          ],
          categoryId,
          status: 'published',
        })
        .expect(201);

      expect(res.body.blog.status).toBe('published');
      expect(res.body.blog.publishedAt).not.toBeNull();
    });

    it('serves published blog publicly by slug', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/blogs/minimalist-wardrobe-guide')
        .expect(200);

      expect(res.body.blog.slug).toBe('minimalist-wardrobe-guide');
      expect(res.body.blog.title).toBe('The Minimalist Wardrobe Guide');
    });

    it('serves published blogs list with category filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cms/blogs?category=style-trends')
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].slug).toBe('minimalist-wardrobe-guide');
    });

    it('updates draft blog to published', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/cms/admin/blogs/${blogId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'published',
        })
        .expect(200);

      expect(res.body.blog.status).toBe('published');
      expect(res.body.blog.publishedAt).not.toBeNull();

      const pubRes = await request(app.getHttpServer())
        .get('/api/v1/cms/blogs/spring-lookbook-2027')
        .expect(200);

      expect(pubRes.body.blog.slug).toBe('spring-lookbook-2027');
    });

    it('supports cursor pagination across multiple published blogs', async () => {
      // With 2 published blogs, limit=1 returns 1 blog and a nextCursor
      const page1 = await request(app.getHttpServer())
        .get('/api/v1/cms/blogs?limit=1')
        .expect(200);

      expect(page1.body.data).toHaveLength(1);
      expect(page1.body.nextCursor).not.toBeNull();

      const cursor = encodeURIComponent(page1.body.nextCursor);
      const page2 = await request(app.getHttpServer())
        .get(`/api/v1/cms/blogs?limit=1&cursor=${cursor}`)
        .expect(200);

      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.data[0].slug).not.toBe(page1.body.data[0].slug);
    });

    it('deletes blog as admin', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/cms/admin/blogs/${blogId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/v1/cms/blogs/spring-lookbook-2027')
        .expect(404);
    });
  });
});
