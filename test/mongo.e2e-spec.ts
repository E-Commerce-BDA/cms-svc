import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('MongoDB connection (e2e)', () => {
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

  it('connects to the test database', async () => {
    expect(connection.readyState).toBe(1);
    expect(connection.name).toBe('ecom_cms_test');

    const db = connection.db;
    expect(db).toBeDefined();
    if (!db) {
      throw new Error('MongoDB connection database is unavailable');
    }

    await expect(db.admin().ping()).resolves.toBeDefined();
  });
});
