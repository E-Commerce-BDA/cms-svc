import { describe, expect, it, vi } from 'vitest';
import type { NavSettings } from '@ecom/contracts';
import { NavigationService } from './navigation.service.js';

describe('NavigationService', () => {
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
    const service = new NavigationService(
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

    const service = new NavigationService(
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
      { upsert: true, returnDocument: 'after' },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:nav');
    expect(eventsService.publishCmsUpdated).toHaveBeenCalledWith({
      scope: 'navigation',
      version: 8,
    });
  });
});
