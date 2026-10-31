import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavSettings } from '@ecom/contracts';
import type { MongoTransactions } from '../db/mongo-tx.js';
import type { CmsOutbox } from '../outbox/cms-outbox.js';
import { NavigationService } from './navigation.service.js';

describe('NavigationService', () => {
  // cms-005: the mutation runs inside one Mongo transaction and writes `cms_outbox`.
  const fakeSession = { id: 'cms-test-session' } as never;
  const transactions = {
    run: <T,>(fn: (session: never) => Promise<T>): Promise<T> => fn(fakeSession),
  } as unknown as MongoTransactions;
  const outbox = { record: vi.fn().mockResolvedValue('event-id') };

  const buildService = (
    model: any,
    revision: any,
    cache: any,
    _events: unknown,
  ) =>
    new NavigationService(
      model,
      revision,
      cache,
      transactions,
      outbox as unknown as CmsOutbox,
    );

  beforeEach(() => {
    outbox.record.mockClear();
  });

  const sampleNav: NavSettings = {
    shared: {
      bar: { height: 64 },
    },
  };

  it('reads navigation from cache when available', async () => {
    const cacheService = {
      navigationKey: vi.fn().mockReturnValue('cms:nav'),
      get: vi.fn().mockResolvedValue({
        navbar: sampleNav,
        version: 1,
      }),
      set: vi.fn(),
    };
    const navModel = { findOne: vi.fn() };
    const service = buildService(
      navModel as any,
      {} as any,
      cacheService as any,
      {} as any,
    );

    const res = await service.getNavigation();
    expect(res.navbar).toEqual(sampleNav);
    expect(res.version).toBe(1);
    expect(navModel.findOne).not.toHaveBeenCalled();
  });

  it('updates navigation, bumps revision, invalidates cache, and emits event', async () => {
    const navModel = {
      findOneAndUpdate: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({}),
      }),
    };
    const revisionService = { bumpVersion: vi.fn().mockResolvedValue(8) };
    const cacheService = {
      navigationKey: vi.fn().mockReturnValue('cms:nav'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const eventsService = { publishCmsUpdated: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      navModel as any,
      revisionService as any,
      cacheService as any,
      eventsService as any,
    );

    const res = await service.updateNavigation(sampleNav);
    expect(res.version).toBe(8);
    expect(navModel.findOneAndUpdate).toHaveBeenCalledWith(
      { scope: 'navbar' },
      { $set: { navbar: sampleNav } },
      { upsert: true, returnDocument: 'after', session: fakeSession },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:nav');
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'navigation',
      aggregateId: 'navbar',
      payload: { scope: 'navigation', version: 8 },
    });
  });
});
