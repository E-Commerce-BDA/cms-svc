import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CreatePage, Page, UpdatePage } from '@ecom/contracts';
import { PagesService } from './pages.service.js';

describe('PagesService', () => {
  const samplePage: Page = {
    id: '507f1f77bcf86cd799439011',
    slug: 'about-us',
    title: 'About Us',
    blocks: [
      {
        type: 'rich_text',
        id: 'block-1',
        body: '<p>About our store.</p>',
      },
    ],
    seo: {
      title: 'About Us - Our Store',
      description: 'Learn about our journey',
    },
    isActive: true,
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
  };

  it('serves public page by slug from cache when available', async () => {
    const cacheService = {
      pageSlugKey: vi.fn().mockReturnValue('cms:page:about-us'),
      get: vi.fn().mockResolvedValue(samplePage),
      set: vi.fn(),
    };
    const pageModel = {
      findOne: vi.fn(),
    };

    const service = new PagesService(
      pageModel as never,
      {} as never,
      cacheService as never,
      {} as never,
    );

    const res = await service.getPublicPageBySlug('about-us');
    expect(res.slug).toBe('about-us');
    expect(cacheService.get).toHaveBeenCalledWith('cms:page:about-us');
    expect(pageModel.findOne).not.toHaveBeenCalled();
  });

  it('queries mongo, filters isActive, and populates cache on cache miss', async () => {
    const cacheService = {
      pageSlugKey: vi.fn().mockReturnValue('cms:page:about-us'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const execMock = vi.fn().mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      slug: 'about-us',
      title: 'About Us',
      blocks: samplePage.blocks,
      seo: samplePage.seo,
      isActive: true,
      createdAt: new Date('2026-10-28T00:00:00.000Z'),
      updatedAt: new Date('2026-10-28T00:00:00.000Z'),
    });
    const leanMock = vi.fn().mockReturnValue({ exec: execMock });
    const pageModel = {
      findOne: vi.fn().mockReturnValue({ lean: leanMock }),
    };

    const service = new PagesService(
      pageModel as never,
      {} as never,
      cacheService as never,
      {} as never,
    );

    const res = await service.getPublicPageBySlug('about-us');
    expect(res.slug).toBe('about-us');
    expect(pageModel.findOne).toHaveBeenCalledWith({
      slug: 'about-us',
      isActive: true,
    });
    expect(cacheService.set).toHaveBeenCalledWith('cms:page:about-us', res);
  });

  it('throws NotFoundException when public page is not found or inactive', async () => {
    const cacheService = {
      pageSlugKey: vi.fn().mockReturnValue('cms:page:unknown'),
      get: vi.fn().mockResolvedValue(null),
    };
    const pageModel = {
      findOne: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
      }),
    };

    const service = new PagesService(
      pageModel as never,
      {} as never,
      cacheService as never,
      {} as never,
    );

    await expect(service.getPublicPageBySlug('unknown')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns all active public pages', async () => {
    const execMock = vi.fn().mockResolvedValue([
      {
        _id: '507f1f77bcf86cd799439011',
        slug: 'about-us',
        title: 'About Us',
        blocks: [],
        isActive: true,
      },
    ]);
    const leanMock = vi.fn().mockReturnValue({ exec: execMock });
    const sortMock = vi.fn().mockReturnValue({ lean: leanMock });
    const pageModel = {
      find: vi.fn().mockReturnValue({ sort: sortMock }),
    };

    const service = new PagesService(
      pageModel as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const res = await service.getPublicPages();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].slug).toBe('about-us');
    expect(pageModel.find).toHaveBeenCalledWith({ isActive: true });
  });

  it('rejects duplicate page slug on creation', async () => {
    const pageModel = {
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ slug: 'about-us' }),
      }),
    };
    const service = new PagesService(
      pageModel as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const dto: CreatePage = {
      slug: 'about-us',
      title: 'About Us',
      blocks: [],
    };

    await expect(service.createPage(dto)).rejects.toThrow(ConflictException);
  });

  it('creates page, bumps revision, invalidates cache, and emits event', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const mockCreatedDoc = {
      _id: '507f1f77bcf86cd799439011',
      slug: 'privacy-policy',
      title: 'Privacy Policy',
      blocks: [],
      seo: {},
      isActive: true,
      save: saveMock,
      toObject: vi.fn().mockReturnValue({
        _id: '507f1f77bcf86cd799439011',
        slug: 'privacy-policy',
        title: 'Privacy Policy',
        blocks: [],
        seo: {},
        isActive: true,
        createdAt: new Date('2026-10-28T00:00:00.000Z'),
        updatedAt: new Date('2026-10-28T00:00:00.000Z'),
      }),
    };

    function MockModel(this: unknown, data: unknown) {
      Object.assign(this as object, mockCreatedDoc, data);
    }
    MockModel.findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });

    const revisionService = {
      bumpVersion: vi.fn().mockResolvedValue(5),
    };
    const cacheService = {
      pageSlugKey: vi.fn().mockReturnValue('cms:page:privacy-policy'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const eventsService = {
      publishCmsUpdated: vi.fn().mockResolvedValue(undefined),
    };

    const service = new PagesService(
      MockModel as never,
      revisionService as never,
      cacheService as never,
      eventsService as never,
    );

    const dto: CreatePage = {
      slug: 'privacy-policy',
      title: 'Privacy Policy',
      blocks: [],
    };

    const created = await service.createPage(dto);
    expect(created.slug).toBe('privacy-policy');
    expect(revisionService.bumpVersion).toHaveBeenCalled();
    expect(cacheService.del).toHaveBeenCalledWith('cms:page:privacy-policy');
    expect(eventsService.publishCmsUpdated).toHaveBeenCalledWith({
      scope: 'pages',
      version: 5,
      key: 'privacy-policy',
    });
  });

  it('updates page, bumps revision, invalidates cache, and emits event', async () => {
    const pageDoc = {
      _id: '507f1f77bcf86cd799439011',
      slug: 'terms',
      title: 'Terms of Service',
      blocks: [],
      isActive: true,
      save: vi.fn().mockResolvedValue(undefined),
      toObject: vi.fn().mockReturnValue({
        _id: '507f1f77bcf86cd799439011',
        slug: 'terms',
        title: 'Updated Terms',
        blocks: [],
        isActive: true,
      }),
    };

    const pageModel = {
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(pageDoc),
      }),
    };
    const revisionService = {
      bumpVersion: vi.fn().mockResolvedValue(6),
    };
    const cacheService = {
      pageSlugKey: vi.fn().mockReturnValue('cms:page:terms'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const eventsService = {
      publishCmsUpdated: vi.fn().mockResolvedValue(undefined),
    };

    const service = new PagesService(
      pageModel as never,
      revisionService as never,
      cacheService as never,
      eventsService as never,
    );

    const update: UpdatePage = {
      title: 'Updated Terms',
    };

    const res = await service.updatePage('terms', update);
    expect(res.title).toBe('Updated Terms');
    expect(pageDoc.save).toHaveBeenCalled();
    expect(revisionService.bumpVersion).toHaveBeenCalled();
    expect(cacheService.del).toHaveBeenCalledWith('cms:page:terms');
    expect(eventsService.publishCmsUpdated).toHaveBeenCalledWith({
      scope: 'pages',
      version: 6,
      key: 'terms',
    });
  });

  it('throws NotFoundException on update if page does not exist', async () => {
    const pageModel = {
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      }),
    };
    const service = new PagesService(
      pageModel as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.updatePage('nonexistent', { title: 'Test' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deletes page, bumps revision, invalidates cache, and emits event', async () => {
    const pageModel = {
      findOneAndDelete: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ slug: 'old-page' }),
      }),
    };
    const revisionService = {
      bumpVersion: vi.fn().mockResolvedValue(7),
    };
    const cacheService = {
      pageSlugKey: vi.fn().mockReturnValue('cms:page:old-page'),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const eventsService = {
      publishCmsUpdated: vi.fn().mockResolvedValue(undefined),
    };

    const service = new PagesService(
      pageModel as never,
      revisionService as never,
      cacheService as never,
      eventsService as never,
    );

    await service.deletePage('old-page');
    expect(pageModel.findOneAndDelete).toHaveBeenCalledWith({
      slug: 'old-page',
    });
    expect(revisionService.bumpVersion).toHaveBeenCalled();
    expect(cacheService.del).toHaveBeenCalledWith('cms:page:old-page');
    expect(eventsService.publishCmsUpdated).toHaveBeenCalledWith({
      scope: 'pages',
      version: 7,
      key: 'old-page',
    });
  });
});
