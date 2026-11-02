import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Footer } from '@ecom/contracts';
import type { MongoTransactions } from '../db/mongo-tx.js';
import type { CmsOutbox } from '../outbox/cms-outbox.js';
import type { RevalidateService } from '../revalidate/revalidate.service.js';
import { FooterService } from './footer.service.js';

describe('FooterService', () => {
  // cms-008: same transactional skeleton as settings/navigation — one tx for
  // upsert + revision bump + outbox record, then cache del, then revalidate.
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
    new FooterService(
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

  const sampleFooter: Footer = {
    columns: [
      {
        title: 'Shop',
        links: [{ label: 'All products', href: '/products' }],
      },
    ],
    legal: [{ label: 'Privacy', href: '/privacy' }],
    wordmark: 'AFABETA',
  };

  it('serves the footer from cache when available', async () => {
    const cacheService = {
      footerKey: vi.fn().mockReturnValue('cms:footer'),
      get: vi.fn().mockResolvedValue({ footer: sampleFooter, version: 2 }),
      set: vi.fn(),
    };
    const footerModel = { findOne: vi.fn() };

    const service = buildService(footerModel as any, {} as any, cacheService as any);

    const res = await service.getFooter();
    expect(res.footer).toEqual(sampleFooter);
    expect(res.version).toBe(2);
    expect(footerModel.findOne).not.toHaveBeenCalled();
  });

  it('reads mongo and populates cache on a miss; empty document when unset', async () => {
    const cacheService = {
      footerKey: vi.fn().mockReturnValue('cms:footer'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const footerModel = {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
      }),
    };
    const revisionService = { getVersion: vi.fn().mockResolvedValue(1) };

    const service = buildService(
      footerModel as any,
      revisionService as any,
      cacheService as any,
    );

    const res = await service.getFooter();
    // The storefront fallback renders from `footer: {}` — the contract allows
    // an empty document, and reading must never 404 before the first publish.
    expect(res.footer).toEqual({});
    expect(res.version).toBe(1);
    expect(cacheService.set).toHaveBeenCalledWith('cms:footer', res);
  });

  it('updates the footer, bumps revision, invalidates cache, emits event and revalidates', async () => {
    const footerModel = {
      findOneAndUpdate: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({}),
      }),
    };
    const revisionService = { bumpVersion: vi.fn().mockResolvedValue(9) };
    const cacheService = {
      footerKey: vi.fn().mockReturnValue('cms:footer'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      footerModel as any,
      revisionService as any,
      cacheService as any,
      revalidate,
    );

    const res = await service.updateFooter(sampleFooter);
    expect(res).toEqual({ footer: sampleFooter, version: 9 });
    expect(footerModel.findOneAndUpdate).toHaveBeenCalledWith(
      { scope: 'footer' },
      { $set: { footer: sampleFooter } },
      { upsert: true, returnDocument: 'after', session: fakeSession },
    );
    expect(cacheService.del).toHaveBeenCalledWith('cms:footer');
    // The footer is shell chrome: one broad tag, like cms:navigation.
    expect(revalidate.revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidate).toHaveBeenCalledWith(['cms:footer']);
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'footer',
      aggregateId: 'footer',
      payload: { scope: 'footer', version: 9 },
    });
  });
});
