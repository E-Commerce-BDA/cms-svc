import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSettings, ThemeSettings } from '@ecom/contracts';
import type { MongoTransactions } from '../db/mongo-tx.js';
import type { CmsOutbox } from '../outbox/cms-outbox.js';
import type { RevalidateService } from '../revalidate/revalidate.service.js';
import { SettingsService } from './settings.service.js';

describe('SettingsService', () => {
  // cms-005: each mutation runs inside one Mongo transaction and writes `cms_outbox`.
  const fakeSession = { id: 'cms-test-session' } as never;
  const transactions = {
    run: <T,>(fn: (session: never) => Promise<T>): Promise<T> => fn(fakeSession),
  } as unknown as MongoTransactions;
  const outbox = { record: vi.fn().mockResolvedValue('event-id') };

  const buildService = (
    cmsSettings: any,
    pageSettings: any,
    revision: any,
    cache: any,
    revalidate: any = { revalidate: vi.fn().mockResolvedValue(undefined) },
  ) =>
    new SettingsService(
      cmsSettings,
      pageSettings,
      revision,
      cache,
      transactions,
      outbox as unknown as CmsOutbox,
      revalidate as unknown as RevalidateService,
    );

  beforeEach(() => {
    outbox.record.mockClear();
  });

  const sampleTheme: ThemeSettings = {
    button: { defaultVariant: 'primary', borderRadius: 8 },
  };

  const sampleAuth: AuthSettings = {
    shared: {
      layout: { mode: 'split' },
    },
  };

  // 2.2.0: one theme body mixes a 1.x key with every new nested group. Its
  // shape is the contract here — the service must not flatten or rename it.
  const nestedTheme: ThemeSettings = {
    button: { defaultVariant: 'primary', borderRadius: 8 },
    palette: {
      brand: { brand: '#123456', brandHover: '#654321' },
      ink: { ink: '#111111' },
      navbar: { bg: '#ffffff' },
    },
    navbar: { height: 72, bg: '#fafafa' },
    filterRail: { bg: '#ffffff', gap: 12 },
    drawer: { bg: '#ffffff', motion: 'slide', width: 320 },
    marquee: { speed: 20, direction: 'left', pauseOnHover: true },
    grid: { gap: 16 },
    productCard: {
      ctaBg: '#000000',
      ctaTextColor: '#ffffff',
      ctaBorderColor: '#123456',
    },
  };

  it('reads global theme from cache when present', async () => {
    const cacheService = {
      settingsGlobalKey: vi.fn().mockReturnValue('cms:settings:global'),
      get: vi.fn().mockResolvedValue({
        theme: sampleTheme,
        version: 2,
      }),
      set: vi.fn(),
    };
    const cmsSettingsModel = { findOne: vi.fn() };
    const service = buildService(
      cmsSettingsModel as any,
      {} as any,
      {} as any,
      cacheService as any,
      {} as any,
    );

    const res = await service.getGlobalTheme();
    expect(res.theme).toEqual(sampleTheme);
    expect(res.version).toBe(2);
    expect(cmsSettingsModel.findOne).not.toHaveBeenCalled();
  });

  it('reports configured:false for a never-written global theme and page key', async () => {
    const cacheService = {
      settingsGlobalKey: vi.fn().mockReturnValue('cms:settings:v2:global'),
      pageSettingsKey: vi.fn().mockReturnValue('cms:page-settings:v2:signin'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const model = {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
      }),
    };
    const service = buildService(
      model as any,
      model as any,
      { getVersion: vi.fn().mockResolvedValue(1) } as any,
      cacheService as any,
    );

    const globalRes = await service.getGlobalTheme();
    const pageRes = await service.getPageSettings('signin');
    expect(globalRes).toEqual({ theme: {}, version: 1, configured: false });
    expect(pageRes).toEqual({ settings: {}, version: 1, configured: false });
  });

  it('reports configured:true once a document exists, even if the payload is empty', async () => {
    const cacheService = {
      settingsGlobalKey: vi.fn().mockReturnValue('cms:settings:v2:global'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const model = {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({ theme: {} }),
        }),
      }),
    };
    const service = buildService(
      model as any,
      {} as any,
      { getVersion: vi.fn().mockResolvedValue(2) } as any,
      cacheService as any,
    );

    expect(await service.getGlobalTheme()).toEqual({
      theme: {},
      version: 2,
      configured: true,
    });
  });

  it('updates global theme, bumps revision, invalidates cache, and emits event', async () => {
    const cmsSettingsModel = {
      findOneAndUpdate: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({}),
      }),
    };
    const revisionService = { bumpVersion: vi.fn().mockResolvedValue(6) };
    const cacheService = {
      settingsGlobalKey: vi.fn().mockReturnValue('cms:settings:global'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      cmsSettingsModel as any,
      {} as any,
      revisionService as any,
      cacheService as any,
      revalidate,
    );

    const res = await service.updateGlobalTheme(sampleTheme);
    expect(res.version).toBe(6);
    expect(cmsSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { scope: 'global' },
      { $set: { theme: sampleTheme } },
      { upsert: true, returnDocument: 'after', session: fakeSession },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:settings:global');
    // cms-007: one tag, and it is the storefront's own string — `lib/cms/tags.ts`
    // answers 400 INVALID_TAGS for anything it did not author.
    expect(revalidate.revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidate).toHaveBeenCalledWith(['cms:global-settings']);
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'settings',
      aggregateId: 'global',
      payload: { scope: 'theme', version: 6 },
    });
  });

  it('persists nested 2.2.0 palette and component groups unchanged', async () => {
    const cmsSettingsModel = {
      findOneAndUpdate: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({}),
      }),
    };
    const cacheService = {
      settingsGlobalKey: vi.fn().mockReturnValue('cms:settings:v2:global'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };
    const service = buildService(
      cmsSettingsModel as any,
      {} as any,
      { bumpVersion: vi.fn().mockResolvedValue(9) } as any,
      cacheService as any,
      revalidate,
    );

    const res = await service.updateGlobalTheme(nestedTheme);

    expect(cmsSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { scope: 'global' },
      { $set: { theme: nestedTheme } },
      { upsert: true, returnDocument: 'after', session: fakeSession },
    );
    expect(res.theme).toEqual(nestedTheme);
    expect(res.theme.palette?.brand?.brand).toBe('#123456');
    expect(res.theme.productCard?.ctaBg).toBe('#000000');
    expect(res).toEqual({ theme: nestedTheme, version: 9, configured: true });
    expect(cacheService.del).toHaveBeenCalledWith('cms:settings:v2:global');
    expect(revalidate.revalidate).toHaveBeenCalledWith(['cms:global-settings']);
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'settings',
      aggregateId: 'global',
      payload: { scope: 'theme', version: 9 },
    });
  });

  it('returns a stored nested theme untouched with version and configured', async () => {
    const cacheService = {
      settingsGlobalKey: vi.fn().mockReturnValue('cms:settings:v2:global'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const cmsSettingsModel = {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({ theme: nestedTheme }),
        }),
      }),
    };
    const service = buildService(
      cmsSettingsModel as any,
      {} as any,
      { getVersion: vi.fn().mockResolvedValue(11) } as any,
      cacheService as any,
    );

    expect(await service.getGlobalTheme()).toEqual({
      theme: nestedTheme,
      version: 11,
      configured: true,
    });
    expect(cacheService.set).toHaveBeenCalledWith('cms:settings:v2:global', {
      theme: nestedTheme,
      version: 11,
      configured: true,
    });
  });

  it('updates page-scoped settings and emits event', async () => {
    const pageSettingsModel = {
      findOneAndUpdate: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({}),
      }),
    };
    const revisionService = { bumpVersion: vi.fn().mockResolvedValue(7) };
    const cacheService = {
      pageSettingsKey: vi.fn().mockReturnValue('cms:page-settings:signin'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      {} as any,
      pageSettingsModel as any,
      revisionService as any,
      cacheService as any,
      revalidate,
    );

    const res = await service.updatePageSettings('signin', sampleAuth);
    expect(res.version).toBe(7);
    expect(pageSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { pageKey: 'signin' },
      { $set: { settings: sampleAuth } },
      { upsert: true, returnDocument: 'after', session: fakeSession },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:page-settings:signin');
    // The tag is derived from the same page key the upsert used, so a rename of
    // one cannot leave the other pointing at a page that no longer exists.
    expect(revalidate.revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidate).toHaveBeenCalledWith([
      'cms:page-settings:signin',
    ]);
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'settings',
      aggregateId: 'signin',
      payload: { scope: 'page-settings', version: 7, pageKey: 'signin' },
    });
  });
});
