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

/**
 * cms-008 (e2e) — the global footer document.
 *
 * Same shape as the navigation surface: public read, admin-only replace,
 * contract validation at the edge. `REVALIDATE_SECRET` is empty in the shared
 * test env (`setup-env.ts`), so the write path stays a no-op network-wise.
 */
describe('CMS Footer (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;
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
    const jwtService = app.get<JwtService>(JwtService);

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

  const validFooter = {
    columns: [
      {
        title: 'Shop',
        links: [
          { label: 'All products', href: '/products' },
          { label: 'About us', href: '/about' },
        ],
      },
      {
        title: 'Help',
        links: [{ label: 'Shipping', href: 'https://help.example.com' }],
      },
    ],
    social: [{ platform: 'instagram', label: 'Instagram', url: 'https://instagram.com/afabeta' }],
    legal: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
    contact: { email: 'care@afabeta.example' },
    wordmark: 'AFABETA',
    copyright: '© 2026 AFABETA',
    paymentIcons: ['visa', 'mastercard'],
  };

  it('serves an empty footer document before the first publish', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cms/footer')
      .expect(200);

    expect(res.body.footer).toEqual({});
    expect(typeof res.body.version).toBe('number');
  });

  it('rejects unauthenticated footer writes', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/cms/admin/footer')
      .send(validFooter)
      .expect(401);
  });

  it('rejects the customer role on footer writes', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/cms/admin/footer')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(validFooter)
      .expect(403);
  });

  it('rejects unknown fields with a validation error', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/cms/admin/footer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validFooter, newsletterForm: true })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects javascript: hrefs at the contract boundary', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/cms/admin/footer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        columns: [
          {
            title: 'Traps',
            links: [
              { label: 'XSS', href: 'javascript:alert(1)' },
            ],
          },
        ],
      })
      .expect(400);
  });

  it('stores and returns the published footer for admins and the public', async () => {
    const put = await request(app.getHttpServer())
      .put('/api/v1/cms/admin/footer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validFooter)
      .expect(200);

    expect(put.body.footer).toMatchObject({ wordmark: 'AFABETA' });

    const adminGet = await request(app.getHttpServer())
      .get('/api/v1/cms/admin/footer')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminGet.body.footer.columns).toHaveLength(2);

    const publicGet = await request(app.getHttpServer())
      .get('/api/v1/cms/footer')
      .expect(200);
    expect(publicGet.body.footer).toEqual(put.body.footer);
    expect(publicGet.body.version).toBe(put.body.version);
  });

  it('replace semantics: a later write drops omitted sections', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/cms/admin/footer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ wordmark: 'NEWNAME' })
      .expect(200);

    expect(res.body.footer).toEqual({ wordmark: 'NEWNAME' });
  });
});
