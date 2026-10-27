import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Health (e2e)', () => {
  let app: NestExpressApplication;
  let connection: Connection;

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
  });

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
    }
    if (app) {
      await app.close();
    }
  });

  it('/health reports liveness without dependency details', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('/health/ready reports Mongo and Redis as up', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({
        status: 'ready',
        checks: { mongo: 'up', redis: 'up' },
      });

    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('databaseUri');
  });

  it('keeps health outside the /api/v1 prefix', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(404);
  });

  it('wraps unknown API routes in the error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('x-request-id', 'e2e-request-id')
      .expect(404);

    expect(response.headers['x-request-id']).toBe('e2e-request-id');
    expect(response.body).toMatchObject({
      error: { code: 'NOT_FOUND' },
      requestId: 'e2e-request-id',
      timestamp: expect.any(String),
    });
  });
});
