import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSettings, ThemeSettings } from '@ecom/contracts';
import type { MongoTransactions } from '../db/mongo-tx.js';
import type { CmsOutbox } from '../outbox/cms-outbox.js';
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
    _events: unknown,
  ) =>
    new SettingsService(
      cmsSettings,
      pageSettings,
      revision,
      cache,
      transactions,
      outbox as unknown as CmsOutbox,
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
    const eventsService = { publishCmsUpdated: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      cmsSettingsModel as any,
      {} as any,
      revisionService as any,
      cacheService as any,
      eventsService as any,
    );

    const res = await service.updateGlobalTheme(sampleTheme);
    expect(res.version).toBe(6);
    expect(cmsSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { scope: 'global' },
      { $set: { theme: sampleTheme } },
      { upsert: true, returnDocument: 'after', session: fakeSession },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:settings:global');
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'settings',
      aggregateId: 'global',
      payload: { scope: 'theme', version: 6 },
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
    const eventsService = { publishCmsUpdated: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      {} as any,
      pageSettingsModel as any,
      revisionService as any,
      cacheService as any,
      eventsService as any,
    );

    const res = await service.updatePageSettings('signin', sampleAuth);
    expect(res.version).toBe(7);
    expect(pageSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { pageKey: 'signin' },
      { $set: { settings: sampleAuth } },
      { upsert: true, returnDocument: 'after', session: fakeSession },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:page-settings:signin');
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'settings',
      aggregateId: 'signin',
      payload: { scope: 'page-settings', version: 7, pageKey: 'signin' },
    });
  });
});
