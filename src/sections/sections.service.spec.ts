import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Section } from '@ecom/contracts';
import type { MongoTransactions } from '../db/mongo-tx.js';
import type { CmsOutbox } from '../outbox/cms-outbox.js';
import type { RevalidateService } from '../revalidate/revalidate.service.js';
import { SectionsService } from './sections.service.js';

describe('SectionsService', () => {
  // cms-005: every mutation runs inside one Mongo transaction and writes its
  // event to `cms_outbox`, so the doubles below stand in for both.
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
    revalidate: any = { revalidate: vi.fn().mockResolvedValue(undefined) },
  ) =>
    new SectionsService(
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

  const sampleSection: Section = {
    key: 'home-hero',
    pageKey: 'homepage',
    type: 'hero',
    title: 'Main Hero',
    content: {
      slides: [
        {
          id: 'slide-1',
          headline: 'Welcome',
          image: 'media/hero.webp',
        },
      ],
    },
    settings: { ratio: '16:9' },
    sortOrder: 0,
    isActive: true,
  };

  it('serves public sections from cache when available', async () => {
    const cacheService = {
      sectionsPageKey: vi.fn().mockReturnValue('cms:sections:homepage'),
      get: vi.fn().mockResolvedValue({
        sections: [sampleSection],
        version: 3,
      }),
      set: vi.fn(),
    };
    const sectionModel = {
      find: vi.fn(),
    };
    const revisionService = { getVersion: vi.fn() };
    const eventsService = { publishCmsUpdated: vi.fn() };

    const service = buildService(
      sectionModel as any,
      revisionService as any,
      cacheService as any,
      eventsService as any,
    );

    const res = await service.getPublicSections('homepage');
    expect(res.version).toBe(3);
    expect(res.sections).toHaveLength(1);
    expect(sectionModel.find).not.toHaveBeenCalled();
  });

  it('queries mongo, filters isActive, and populates cache on cache miss', async () => {
    const cacheService = {
      sectionsPageKey: vi.fn().mockReturnValue('cms:sections:homepage'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const leanMock = vi.fn().mockResolvedValue([sampleSection]);
    const sortMock = vi.fn().mockReturnValue({ lean: () => ({ exec: leanMock }) });
    const sectionModel = {
      find: vi.fn().mockReturnValue({ sort: sortMock }),
    };
    const revisionService = { getVersion: vi.fn().mockResolvedValue(4) };
    const eventsService = { publishCmsUpdated: vi.fn() };

    const service = buildService(
      sectionModel as any,
      revisionService as any,
      cacheService as any,
      eventsService as any,
    );

    const res = await service.getPublicSections('homepage');
    expect(res.version).toBe(4);
    expect(sectionModel.find).toHaveBeenCalledWith({
      pageKey: 'homepage',
      isActive: true,
    });
    expect(cacheService.set).toHaveBeenCalledWith('cms:sections:homepage', res);
  });

  it('rejects duplicate section key on creation', async () => {
    const sectionModel = {
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(sampleSection),
      }),
    };
    const service = buildService(
      sectionModel as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.createSection(sampleSection)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects immutable field modifications on updateSection', async () => {
    const sectionModel = {
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          ...sampleSection,
          toObject: () => sampleSection,
        }),
      }),
    };
    const service = buildService(
      sectionModel as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.updateSection('home-hero', { key: 'new-key' }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.updateSection('home-hero', { pageKey: 'other-page' }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.updateSection('home-hero', { type: 'banner' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects reorder when keys do not match existing sections', async () => {
    const sectionModel = {
      find: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue([{ key: 'home-hero' }]),
          }),
        }),
      }),
    };
    const service = buildService(
      sectionModel as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.reorderSections({
        pageKey: 'homepage',
        orderedKeys: ['home-hero', 'missing-key'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('executes reorder bulk write on valid keys', async () => {
    const sectionModel = {
      find: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue([
              { key: 'home-hero' },
              { key: 'home-banner' },
            ]),
          }),
        }),
      }),
      bulkWrite: vi.fn().mockResolvedValue({}),
    };
    const revisionService = { bumpVersion: vi.fn().mockResolvedValue(5) };
    const cacheService = {
      sectionsPageKey: vi.fn().mockReturnValue('cms:sections:homepage'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const eventsService = { publishCmsUpdated: vi.fn().mockResolvedValue(undefined) };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      sectionModel as any,
      revisionService as any,
      cacheService as any,
      eventsService as any,
      revalidate,
    );

    await service.reorderSections({
      pageKey: 'homepage',
      orderedKeys: ['home-banner', 'home-hero'],
    });

    expect(sectionModel.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { key: 'home-banner', pageKey: 'homepage' },
            update: { $set: { sortOrder: 0 } },
          },
        },
        {
          updateOne: {
            filter: { key: 'home-hero', pageKey: 'homepage' },
            update: { $set: { sortOrder: 1 } },
          },
        },
      ],
      { session: fakeSession },
    );
    expect(revisionService.bumpVersion).toHaveBeenCalledWith({
      session: fakeSession,
    });
    expect(cacheService.del).toHaveBeenCalledWith('cms:sections:homepage');
    // cms-008: a reorder changes the page order, so the page tag is dropped.
    expect(revalidate.revalidate).toHaveBeenCalledWith(['cms:sections:homepage']);
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'section',
      // A reorder moves the whole page, so the page is the aggregate.
      aggregateId: 'homepage',
      payload: { scope: 'sections', version: 5, pageKey: 'homepage' },
    });
  });

  it('creates section, bumps revision, invalidates cache, and emits cms.updated', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const createdDoc = {
      ...sampleSection,
      key: 'home-banner',
      title: 'Home Banner',
      sortOrder: 2,
      save: saveMock,
      toObject: vi.fn().mockReturnValue({
        ...sampleSection,
        key: 'home-banner',
        title: 'Home Banner',
        sortOrder: 2,
      }),
    };

    function MockSectionModel(this: unknown, data: unknown) {
      Object.assign(this as object, createdDoc, data);
    }
    MockSectionModel.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
      sort: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ sortOrder: 1 }),
      }),
    });

    const revisionService = { bumpVersion: vi.fn().mockResolvedValue(8) };
    const cacheService = {
      sectionsPageKey: vi.fn().mockReturnValue('cms:sections:homepage'),
      sectionKey: vi.fn().mockReturnValue('cms:section:home-banner'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      MockSectionModel as any,
      revisionService as any,
      cacheService as any,
      {} as any,
      revalidate,
    );

    await service.createSection({
      ...sampleSection,
      key: 'home-banner',
      title: 'Home Banner',
    });

    expect(saveMock).toHaveBeenCalledWith({ session: fakeSession });
    expect(cacheService.del).toHaveBeenCalledWith('cms:sections:homepage');
    expect(cacheService.del).toHaveBeenCalledWith('cms:section:home-banner');
    // cms-008: the page tag the storefront home subscribes to.
    expect(revalidate.revalidate).toHaveBeenCalledWith([
      'cms:sections:homepage',
    ]);
    expect(outbox.record).toHaveBeenCalledWith(fakeSession, {
      topic: 'cms.updated',
      aggregateType: 'section',
      aggregateId: 'home-banner',
      payload: {
        scope: 'sections',
        version: 8,
        pageKey: 'homepage',
        key: 'home-banner',
      },
    });
  });

  it('throws NotFoundException on deleteSection if section does not exist', async () => {
    const sectionModel = {
      findOneAndDelete: vi.fn().mockReturnValue({
        // The delete joins the transaction, so the service chains `.session()`.
        session: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
      }),
    };
    const service = buildService(
      sectionModel as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.deleteSection('non-existent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('updates a section and revalidates exactly its page tag', async () => {
    const doc = {
      ...sampleSection,
      save: vi.fn().mockResolvedValue(undefined),
      toObject: () => sampleSection,
    };
    const sectionModel = {
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(doc),
      }),
    };
    const cacheService = {
      sectionsPageKey: vi.fn().mockReturnValue('cms:sections:homepage'),
      sectionKey: vi.fn().mockReturnValue('cms:section:home-hero'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      sectionModel as any,
      { bumpVersion: vi.fn().mockResolvedValue(9) } as any,
      cacheService as any,
      {} as any,
      revalidate,
    );

    const res = await service.updateSection('home-hero', {
      title: 'Winter Hero',
    });
    expect(res.key).toBe('home-hero');
    // cms-008 parity: one mutation, one page tag — never the section key.
    expect(revalidate.revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidate).toHaveBeenCalledWith([
      'cms:sections:homepage',
    ]);
  });

  it('deletes a section and revalidates exactly its page tag', async () => {
    const sectionModel = {
      findOneAndDelete: vi.fn().mockReturnValue({
        session: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({
            key: 'home-hero',
            pageKey: 'homepage',
          }),
        }),
      }),
    };
    const cacheService = {
      sectionsPageKey: vi.fn().mockReturnValue('cms:sections:homepage'),
      sectionKey: vi.fn().mockReturnValue('cms:section:home-hero'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };

    const service = buildService(
      sectionModel as any,
      { bumpVersion: vi.fn().mockResolvedValue(10) } as any,
      cacheService as any,
      {} as any,
      revalidate,
    );

    await service.deleteSection('home-hero');
    expect(revalidate.revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidate).toHaveBeenCalledWith([
      'cms:sections:homepage',
    ]);
  });

  const pdpSourceDocs = [
    {
      key: 'pdp-default-description',
      pageKey: 'pdp-default',
      type: 'pdp_description',
      title: 'Description',
      content: {},
      settings: {},
      sortOrder: 0,
      isActive: true,
    },
    {
      key: 'pdp-default-details',
      pageKey: 'pdp-default',
      type: 'pdp_details',
      title: 'Details',
      content: {},
      settings: {},
      sortOrder: 1,
      isActive: true,
    },
  ];
  const pdpTarget = 'pdp-00000000-0000-4000-8000-000000000001';

  const buildCloneService = (
    sourceDocs: any[] = pdpSourceDocs,
    existingTarget: any[] = [],
  ) => {
    const sectionModel = {
      find: vi.fn((filter: any) => {
        if (filter.pageKey === 'pdp-default') {
          return {
            sort: vi.fn().mockReturnValue({
              lean: () => ({
                exec: vi.fn().mockResolvedValue(sourceDocs),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            lean: () => ({
              exec: vi.fn().mockResolvedValue(existingTarget),
            }),
          }),
        };
      }),
      insertMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockReturnValue({
        session: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    const cacheService = {
      sectionsPageKey: vi.fn((pageKey: string) => `cms:sections:${pageKey}`),
      sectionKey: vi.fn((key: string) => `cms:section:${key}`),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const revalidate = { revalidate: vi.fn().mockResolvedValue(undefined) };
    const service = buildService(
      sectionModel as any,
      { bumpVersion: vi.fn().mockResolvedValue(11) } as any,
      cacheService as any,
      {} as any,
      revalidate,
    );
    return { service, sectionModel, cacheService, revalidate };
  };

  it('clones sections to a new product page with derived keys', async () => {
    const { service, sectionModel, revalidate } = buildCloneService();

    const res = await service.cloneSections({
      fromPageKey: 'pdp-default',
      toPageKey: pdpTarget,
    });

    expect(res.version).toBe(11);
    expect(res.sections.map((section) => section.key)).toEqual([
      `${pdpTarget}-description`,
      `${pdpTarget}-details`,
    ]);
    expect(res.sections.map((section) => section.sortOrder)).toEqual([0, 1]);
    expect(sectionModel.insertMany).toHaveBeenCalledTimes(1);
    expect(sectionModel.deleteMany).not.toHaveBeenCalled();
    expect(outbox.record).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidate).toHaveBeenCalledWith([
      `cms:sections:${pdpTarget}`,
    ]);
  });

  it('rejects cloning into a populated target without replace', async () => {
    const { service } = buildCloneService(pdpSourceDocs, [
      { key: `${pdpTarget}-description` },
    ]);

    await expect(
      service.cloneSections({
        fromPageKey: 'pdp-default',
        toPageKey: pdpTarget,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('replaces a populated target when replace is true', async () => {
    const { service, sectionModel } = buildCloneService(pdpSourceDocs, [
      { key: `${pdpTarget}-old` },
    ]);

    const res = await service.cloneSections({
      fromPageKey: 'pdp-default',
      toPageKey: pdpTarget,
      replace: true,
    });

    expect(res.sections).toHaveLength(2);
    expect(sectionModel.deleteMany).toHaveBeenCalledWith({
      pageKey: pdpTarget,
    });
    expect(sectionModel.insertMany).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty source, same page, and unprefixed keys', async () => {
    const empty = buildCloneService([], []);
    await expect(
      empty.service.cloneSections({
        fromPageKey: 'pdp-default',
        toPageKey: pdpTarget,
      }),
    ).rejects.toThrow(NotFoundException);

    const same = buildCloneService();
    await expect(
      same.service.cloneSections({
        fromPageKey: 'pdp-default',
        toPageKey: 'pdp-default',
      }),
    ).rejects.toThrow(BadRequestException);

    const unprefixed = buildCloneService(
      [
        {
          ...pdpSourceDocs[0],
          key: 'unrelated-key',
        },
      ],
      [],
    );
    await expect(
      unprefixed.service.cloneSections({
        fromPageKey: 'pdp-default',
        toPageKey: pdpTarget,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
