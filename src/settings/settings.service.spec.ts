import { describe, expect, it, vi } from 'vitest';
import type { AuthSettings, ThemeSettings } from '@ecom/contracts';
import { SettingsService } from './settings.service.js';

describe('SettingsService', () => {
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
    const service = new SettingsService(
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

    const service = new SettingsService(
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
      { upsert: true, returnDocument: 'after' },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:settings:global');
    expect(eventsService.publishCmsUpdated).toHaveBeenCalledWith({
      scope: 'theme',
      version: 6,
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

    const service = new SettingsService(
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
      { upsert: true, returnDocument: 'after' },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:page-settings:signin');
    expect(eventsService.publishCmsUpdated).toHaveBeenCalledWith({
      scope: 'page-settings',
      version: 7,
      pageKey: 'signin',
    });
  });
});
