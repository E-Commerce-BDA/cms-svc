import { describe, expect, it, vi } from 'vitest';
import { CacheService } from './cache.service.js';

describe('CacheService', () => {
  it('constructs predictable key namespaces', () => {
    const service = new CacheService({} as any);
    expect(service.sectionKey('hero')).toBe('cms:section:hero');
    expect(service.sectionsPageKey('home')).toBe('cms:sections:home');
    expect(service.settingsGlobalKey()).toBe('cms:settings:global');
    expect(service.navigationKey()).toBe('cms:nav');
    expect(service.pageSettingsKey('auth')).toBe('cms:page-settings:auth');
    expect(service.pageSlugKey('about')).toBe('cms:page:about');
    expect(service.blogSlugKey('lookbook')).toBe('cms:blog:lookbook');
  });

  it('serializes and parses JSON cached data', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ hello: 'world' })),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const service = new CacheService(redis as any);
    const data = await service.get<{ hello: string }>('test:key');
    expect(data).toEqual({ hello: 'world' });

    await service.set('test:key', { hello: 'world' });
    expect(redis.set).toHaveBeenCalledWith(
      'test:key',
      JSON.stringify({ hello: 'world' }),
      300,
    );
  });

  it('degrades gracefully when Redis operations fail', async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error('Connection refused')),
      set: vi.fn().mockRejectedValue(new Error('Connection refused')),
      del: vi.fn().mockRejectedValue(new Error('Connection refused')),
    };
    const service = new CacheService(redis as any);
    const result = await service.get('test:fail');
    expect(result).toBeNull();

    await expect(service.set('test:fail', { foo: 'bar' })).resolves.toBeUndefined();
    await expect(service.del('test:fail')).resolves.toBeUndefined();
  });
});
