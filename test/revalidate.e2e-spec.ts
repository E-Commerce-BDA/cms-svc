import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect, beforeEach } from 'vitest';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants.js';

/**
 * cms-007 (e2e) — the one seam where cms-svc talks *out* to another process.
 *
 * There is no storefront in the test stack and there should not be: what matters
 * here is the wire contract the real route in
 * `frontend/storefront/app/api/revalidate/route.ts` enforces — path, method,
 * secret header, and the exact tag strings its allowlist accepts. A stub server
 * that records the request is therefore a *stronger* check than the real route
 * would be, because it can also be told to fail.
 */

interface RecordedRequest {
  method: string;
  url: string;
  secret: string | undefined;
  contentType: string | undefined;
  tags: string[];
}

const SECRET = 'e2e-revalidate-secret';
const recorded: RecordedRequest[] = [];
/** Flipped per test: `ok` answers 200, `fail` answers 500. */
let mode: 'ok' | 'fail' = 'ok';

const stub: Server = createServer((req: IncomingMessage, res) => {
  let raw = '';
  req.on('data', (chunk: Buffer) => {
    raw += chunk.toString('utf8');
  });
  req.on('end', () => {
    let tags: string[] = [];
    try {
      tags = (JSON.parse(raw) as { tags?: string[] }).tags ?? [];
    } catch {
      tags = [];
    }
    recorded.push({
      method: req.method ?? '',
      url: req.url ?? '',
      secret: req.headers['x-revalidate-secret'] as string | undefined,
      contentType: req.headers['content-type'],
      tags,
    });

    if (mode === 'fail') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ revalidated: tags, now: Date.now() }));
  });
});

describe('CMS revalidation (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let adminToken: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const { port } = stub.address() as AddressInfo;
    // The service reads both values in its constructor, so they must be in the
    // environment before the app is compiled — and `ConfigModule` will not
    // overwrite them from `.env`.
    process.env.STOREFRONT_URL = `http://127.0.0.1:${port}`;
    process.env.REVALIDATE_SECRET = SECRET;

    // Imported after the variables are set: `AppModule` builds the Joi schema and
    // the providers at import time.
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
    const jwtService = app.get<JwtService>(JwtService);
    adminToken = jwtService.sign(
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
    await new Promise<void>((resolve, reject) =>
      stub.close((error) => (error ? reject(error) : resolve())),
    );
    delete process.env.STOREFRONT_URL;
  });

  beforeEach(() => {
    recorded.length = 0;
    mode = 'ok';
  });

  const put = (path: string, body: unknown) =>
    request(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body as object);

  it('revalidates the global-settings tag after a theme publish', async () => {
    await put('/api/v1/cms/admin/settings/global', {
      button: { defaultVariant: 'primary', borderRadius: 14 },
    }).expect(200);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      method: 'POST',
      url: '/api/revalidate',
      secret: SECRET,
      contentType: 'application/json',
      tags: ['cms:global-settings'],
    });
  });

  it('revalidates the page tag built from the published page key', async () => {
    await put('/api/v1/cms/admin/settings/page/signin', {
      shared: { layout: { mode: 'split' } },
    }).expect(200);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tags).toEqual(['cms:page-settings:signin']);
    expect(recorded[0]?.secret).toBe(SECRET);
  });

  it('revalidates the navigation tag after a navbar publish', async () => {
    await put('/api/v1/cms/admin/navigation', {
      shared: { bar: { height: 76, sticky: 'always' } },
    }).expect(200);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tags).toEqual(['cms:navigation']);
  });

  it('revalidates the sections page tag after a section publish', async () => {
    // cms-008: the home page reads `cms:sections:<pageKey>`, so a section
    // write must name the page it belongs to — never a per-section tag.
    await request(app.getHttpServer())
      .post('/api/v1/cms/admin/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
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
              ctas: [{ id: 'cta-1', text: 'Shop', link: '/products' }],
            },
          ],
        },
        settings: { ratio: '16:9' },
        isActive: true,
      })
      .expect(201);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tags).toEqual(['cms:sections:homepage']);
  });

  it('revalidates the footer tag after a footer publish', async () => {
    await put('/api/v1/cms/admin/footer', {
      columns: [
        { title: 'Shop', links: [{ label: 'Products', href: '/products' }] },
      ],
      wordmark: 'AFABETA',
    }).expect(200);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tags).toEqual(['cms:footer']);
  });

  it('revalidates the page tag after a CMS page create', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cms/admin/pages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: 'privacy',
        title: 'Privacy Policy',
        blocks: [
          { type: 'rich_text', id: 'rt-1', body: '<p>We respect privacy.</p>' },
        ],
        isActive: true,
      })
      .expect(201);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tags).toEqual(['cms:pages:privacy']);
  });

  it('revalidates the blogs list tag only when a publish changes the list', async () => {
    // A draft changes nothing public, so the storefront stays unpinged.
    await request(app.getHttpServer())
      .post('/api/v1/cms/admin/blogs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: 'draft-wave',
        title: 'Draft Wave',
        content: [{ type: 'paragraph', id: 'p-1', text: 'Not public yet.' }],
        categoryId: '68b000000000000000000001',
        status: 'draft',
      })
      .expect(201);

    expect(recorded).toHaveLength(0);

    // The same post published: now the list tag must drop.
    await request(app.getHttpServer())
      .post('/api/v1/cms/admin/blogs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: 'live-wave',
        title: 'Live Wave',
        content: [{ type: 'paragraph', id: 'p-1', text: 'Public now.' }],
        categoryId: '68b000000000000000000001',
        status: 'published',
      })
      .expect(201);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tags).toEqual(['cms:blogs']);
  });

  it('still returns 200 when the storefront refuses the invalidation', async () => {
    mode = 'fail';

    // Best-effort by contract: the content committed, so a stale page until the
    // next publish or TTL is the correct trade — never a failed write.
    await put('/api/v1/cms/admin/navigation', {
      shared: { bar: { height: 80 } },
    }).expect(200);

    expect(recorded).toHaveLength(1);
  });
});
