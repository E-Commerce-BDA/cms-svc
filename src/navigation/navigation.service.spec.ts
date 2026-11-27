import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavSettings } from '@ecom/contracts';
import type { MongoTransactions } from '../db/mongo-tx.js';
import type { CmsOutbox } from '../outbox/cms-outbox.js';
import type { RevalidateService } from '../revalidate/revalidate.service.js';
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
    revalidate: any = { revalidate: vi.fn().mockResolvedValue(undefined) },
  ) =>
    new NavigationService(
      model,
      revision,
      cache,
      transactions,
      outbox as unknown as CmsOutbox,
      revalidate as unknown as RevalidateService,
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

  it.each([true, false])(
    'reports configured:%s from document existence on a cache miss',
    async (exists) => {
      const cacheService = {
        navigationKey: vi.fn().mockReturnValue('cms:nav:v2'),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      };
      const navModel = {
        findOne: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(exists ? { navbar: {} } : null),
          }),
        }),
      };
      const service = buildService(
        navModel as any,
        { getVersion: vi.fn().mockResolvedValue(1) } as any,
        cacheService as any,
      );

      expect(await service.getNavigation()).toEqual({
        navbar: {},
        version: 1,
        configured: exists,
      });
    },
  );

  it('normalizes groups on both the cached and the stored read path', async () => {
    const grouped: NavSettings = {
      shared: {
        links: {
          items: [
            {
              kind: 'custom',
              label: 'Shop',
              href: '/shop',
              groups: [
                {
                  title: 'Women',
                  items: [{ label: 'Dresses', href: '/shop/dresses' }],
                  promo: { title: 'Sale', href: '/sale' },
                },
              ],
            },
          ],
        },
      },
    };
    const cacheService = {
      navigationKey: vi.fn().mockReturnValue('cms:nav:groups'),
      get: vi.fn().mockResolvedValue({ navbar: grouped, version: 3 }),
      set: vi.fn(),
    };
    const cached = await buildService(
      {} as any,
      {} as any,
      cacheService as any,
    ).getNavigation();
    expect(cached.navbar).toEqual(grouped);

    cacheService.get.mockResolvedValue(null);
    const navModel = {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({ navbar: grouped }),
        }),
      }),
    };
    const stored = await buildService(
      navModel as any,
      { getVersion: vi.fn().mockResolvedValue(3) } as any,
      cacheService as any,
    ).getNavigation();
    expect(stored.navbar).toEqual(grouped);
    expect(stored.configured).toBe(true);
  });

  it('fails closed when a stored nav document has malformed groups', async () => {
    const cacheService = {
      navigationKey: vi.fn().mockReturnValue('cms:nav:bad'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    };
    const navModel = {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({
            navbar: {
              shared: {
                links: {
                  items: [
                    {
                      kind: 'custom',
                      label: 'Shop',
                      href: '/shop',
                      groups: [{ title: 'Women', items: [], columns: 9 }],
                    },
                  ],
                },
              },
            },
          }),
        }),
      }),
    };
    const service = buildService(
      navModel as any,
      { getVersion: vi.fn().mockResolvedValue(3) } as any,
      cacheService as any,
    );

    await expect(service.getNavigation()).rejects.toMatchObject({
      response: { code: 'NAV_INVALID_GROUPS' },
    });
    expect(cacheService.set).not.toHaveBeenCalled();
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
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      navModel as any,
      revisionService as any,
      cacheService as any,
      revalidate,
    );

    const res = await service.updateNavigation(sampleNav);
    expect(res.version).toBe(8);
    expect(navModel.findOneAndUpdate).toHaveBeenCalledWith(
      { scope: 'navbar' },
      { $set: { navbar: sampleNav } },
      { upsert: true, returnDocument: 'after', session: fakeSession },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:nav');
    // cms-007: the navigation tag, not a page tag — the header is shared by every
    // route the storefront renders.
    expect(revalidate.revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidate).toHaveBeenCalledWith(['cms:navigation']);
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'navigation',
      aggregateId: 'navbar',
      payload: { scope: 'navigation', version: 8 },
    });
  });
});
