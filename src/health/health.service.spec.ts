import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { HealthService } from './health.service.js';
import { RedisService } from '../redis/redis.service.js';

function makeService(options?: {
  mongoPing?: ReturnType<typeof vi.fn>;
  redisPing?: ReturnType<typeof vi.fn>;
}) {
  const mongoPing = options?.mongoPing ?? vi.fn().mockResolvedValue({ ok: 1 });
  const redisPing = options?.redisPing ?? vi.fn().mockResolvedValue(true);

  const connection = {
    db: {
      admin: () => ({ ping: mongoPing }),
    },
  } as unknown as Connection;

  const redis = { ping: redisPing } as unknown as RedisService;

  return {
    service: new HealthService(connection, redis),
    mongoPing,
    redisPing,
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('Expected the promise to reject');
}

describe('HealthService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports liveness without touching dependencies', () => {
    const { service, mongoPing, redisPing } = makeService();

    expect(service.checkLiveness()).toEqual({ status: 'ok' });
    expect(mongoPing).not.toHaveBeenCalled();
    expect(redisPing).not.toHaveBeenCalled();
  });

  it('reports ready when Mongo and Redis are up', async () => {
    const { service } = makeService();

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ready',
      checks: { mongo: 'up', redis: 'up' },
    });
  });

  it('stays ready when Redis is down', async () => {
    const { service } = makeService({
      redisPing: vi.fn().mockResolvedValue(false),
    });

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ready',
      checks: { mongo: 'up', redis: 'down' },
    });
  });

  it('returns 503 when Mongo is down', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { service } = makeService({
      mongoPing: vi.fn().mockRejectedValue(new Error('mongo down')),
    });

    const error = await captureError(service.checkReadiness());

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'not_ready',
      checks: { mongo: 'down', redis: 'up' },
    });
  });
});
