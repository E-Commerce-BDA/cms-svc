import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  REVALIDATE_TIMEOUT_MS,
  RevalidateService,
  storefrontTags,
} from './revalidate.service.js';

describe('RevalidateService', () => {
  // cms-007: the call leaves the process, so every test owns `fetch` explicitly —
  // a real storefront on :3000 must never decide whether this suite passes.
  const buildService = (env: Record<string, string | undefined>) =>
    new RevalidateService({
      get: (key: string) => env[key],
    } as unknown as ConfigService);

  const ok = () => ({ ok: true, status: 200 });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a no-op — not an error — when no secret is configured', async () => {
    const service = buildService({});
    expect(service.enabled).toBe(false);

    await expect(service.revalidate([storefrontTags.navigation])).resolves.toBeUndefined();

    expect(fetch).not.toHaveBeenCalled();
    expect(service.snapshot()).toEqual({ sent: 0, failed: 0, disabled: 1 });
  });

  it('treats a blank secret as unconfigured (an empty .env line is not a key)', async () => {
    const service = buildService({ REVALIDATE_SECRET: '   ' });

    expect(service.enabled).toBe(false);
    await service.revalidate([storefrontTags.globalSettings]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the exact tags, secret and two-second timeout the storefront expects', async () => {
    const service = buildService({
      STOREFRONT_URL: 'http://storefront.test:3000',
      REVALIDATE_SECRET: 'shared-secret-value',
    });

    await service.revalidate([
      storefrontTags.globalSettings,
      storefrontTags.pageSettings('signin'),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://storefront.test:3000/api/revalidate');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-revalidate-secret': 'shared-secret-value',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      tags: ['cms:global-settings', 'cms:page-settings:signin'],
    });
    // An `AbortSignal` that already fired would make the call miss its deadline;
    // a live one is what proves the 2 s budget is attached at all.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
    expect(service.snapshot()).toEqual({ sent: 1, failed: 0, disabled: 0 });
  });

  it('drops a trailing slash so the path is never doubled', async () => {
    const service = buildService({
      STOREFRONT_URL: 'http://storefront.test:3000///',
      REVALIDATE_SECRET: 'shared-secret-value',
    });

    await service.revalidate([storefrontTags.navigation]);

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://storefront.test:3000/api/revalidate',
    );
  });

  it('defaults the base URL to the local storefront when STOREFRONT_URL is unset', async () => {
    const service = buildService({ REVALIDATE_SECRET: 'shared-secret-value' });

    await service.revalidate([storefrontTags.navigation]);

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/api/revalidate',
    );
  });

  it('warns and continues when the storefront answers 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const service = buildService({ REVALIDATE_SECRET: 'shared-secret-value' });

    // The write already committed upstream: throwing here would turn a stale
    // page into a failed publish.
    await expect(service.revalidate([storefrontTags.navigation])).resolves.toBeUndefined();

    expect(service.snapshot()).toEqual({ sent: 0, failed: 1, disabled: 0 });
  });

  it('warns and continues when the request times out', async () => {
    const abort = Object.assign(new Error('This operation was aborted'), {
      name: 'TimeoutError',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    const service = buildService({ REVALIDATE_SECRET: 'shared-secret-value' });

    await expect(service.revalidate([storefrontTags.navigation])).resolves.toBeUndefined();

    expect(service.snapshot()).toEqual({ sent: 0, failed: 1, disabled: 0 });
  });

  it('warns and continues when the storefront is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );
    const service = buildService({ REVALIDATE_SECRET: 'shared-secret-value' });

    await expect(service.revalidate([storefrontTags.navigation])).resolves.toBeUndefined();
    expect(service.snapshot().failed).toBe(1);
  });

  it('hands out a copy of the counters', async () => {
    const service = buildService({ REVALIDATE_SECRET: 'shared-secret-value' });

    await service.revalidate([storefrontTags.navigation]);
    service.snapshot().sent = 99;

    expect(service.snapshot().sent).toBe(1);
  });

  it('documents the timeout it actually sends', () => {
    expect(REVALIDATE_TIMEOUT_MS).toBe(2000);
  });
});
