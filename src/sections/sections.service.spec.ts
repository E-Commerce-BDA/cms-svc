import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Section } from '@ecom/contracts';
import { SectionsService } from './sections.service.js';

describe('SectionsService', () => {
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

    const service = new SectionsService(
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

    const service = new SectionsService(
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
    const service = new SectionsService(
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
    const service = new SectionsService(
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
    const service = new SectionsService(
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

    const service = new SectionsService(
      sectionModel as any,
      revisionService as any,
      cacheService as any,
      eventsService as any,
    );

    await service.reorderSections({
      pageKey: 'homepage',
      orderedKeys: ['home-banner', 'home-hero'],
    });

    expect(sectionModel.bulkWrite).toHaveBeenCalledWith([
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
    ]);
    expect(revisionService.bumpVersion).toHaveBeenCalled();
    expect(cacheService.del).toHaveBeenCalledWith('cms:sections:homepage');
    expect(eventsService.publishCmsUpdated).toHaveBeenCalledWith({
      scope: 'sections',
      version: 5,
      pageKey: 'homepage',
    });
  });

  it('throws NotFoundException on deleteSection if section does not exist', async () => {
    const sectionModel = {
      findOneAndDelete: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      }),
    };
    const service = new SectionsService(
      sectionModel as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.deleteSection('non-existent')).rejects.toThrow(
      NotFoundException,
    );
  });
});
