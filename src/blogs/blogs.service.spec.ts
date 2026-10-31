import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateBlog, CreateBlogCategory, UpdateBlog } from '@ecom/contracts';
import type { MongoTransactions } from '../db/mongo-tx.js';
import type { CmsOutbox } from '../outbox/cms-outbox.js';
import { BlogsService } from './blogs.service.js';

describe('BlogsService', () => {
  // cms-005: mutations run inside one Mongo transaction and write `cms_outbox`
  // instead of publishing through the in-process bus.
  const fakeSession = { id: 'cms-test-session' } as never;
  const transactions = {
    run: <T,>(fn: (session: never) => Promise<T>): Promise<T> => fn(fakeSession),
  } as unknown as MongoTransactions;
  const outbox = { record: vi.fn().mockResolvedValue('event-id') };

  const buildService = (
    blog: any,
    blogCategory: any,
    cache: any,
    _events: unknown,
  ) =>
    new BlogsService(
      blog,
      blogCategory,
      cache,
      transactions,
      outbox as unknown as CmsOutbox,
    );

  beforeEach(() => {
    outbox.record.mockClear();
  });

  const sampleCategory = {
    _id: '507f1f77bcf86cd799439020',
    name: 'Tech & Gadgets',
    slug: 'tech-gadgets',
    description: 'All about tech',
  };

  const sampleBlog = {
    _id: '507f1f77bcf86cd799439021',
    slug: 'top-10-keyboards',
    title: 'Top 10 Mechanical Keyboards',
    coverUrl: 'media/keyboards.webp',
    excerpt: 'Best mechanical keyboards in 2026',
    content: [
      {
        type: 'paragraph',
        id: 'p-1',
        text: 'Keyboards have evolved significantly.',
      },
    ],
    categoryId: '507f1f77bcf86cd799439020',
    author: 'Tech Guru',
    status: 'published' as const,
    publishedAt: new Date('2026-10-28T00:00:00.000Z'),
    seo: {
      title: 'Top 10 Keyboards',
    },
    createdAt: new Date('2026-10-27T00:00:00.000Z'),
    updatedAt: new Date('2026-10-28T00:00:00.000Z'),
  };

  describe('categories', () => {
    it('returns all categories sorted by name', async () => {
      const blogCategoryModel = {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([sampleCategory]),
            }),
          }),
        }),
      };

      const service = buildService(
        {} as never,
        blogCategoryModel as never,
        {} as never,
        {} as never,
      );

      const res = await service.getPublicCategories();
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe('Tech & Gadgets');
      expect(res[0].slug).toBe('tech-gadgets');
    });

    it('rejects duplicate category slug on creation', async () => {
      const blogCategoryModel = {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(sampleCategory),
        }),
      };

      const service = buildService(
        {} as never,
        blogCategoryModel as never,
        {} as never,
        {} as never,
      );

      const dto: CreateBlogCategory = {
        name: 'Tech & Gadgets',
        slug: 'tech-gadgets',
      };

      await expect(service.createCategory(dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates category successfully', async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      function MockCategoryModel(this: unknown, data: unknown) {
        Object.assign(this as object, sampleCategory, data, {
          save: saveMock,
          toObject: vi.fn().mockReturnValue(sampleCategory),
        });
      }
      MockCategoryModel.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });

      const service = buildService(
        {} as never,
        MockCategoryModel as never,
        {} as never,
        {} as never,
      );

      const dto: CreateBlogCategory = {
        name: 'Tech & Gadgets',
        slug: 'tech-gadgets',
      };

      const res = await service.createCategory(dto);
      expect(res.slug).toBe('tech-gadgets');
      expect(saveMock).toHaveBeenCalled();
    });
  });

  describe('public blogs query & cache', () => {
    it('serves blog by slug from cache when available', async () => {
      const cacheService = {
        blogSlugKey: vi.fn().mockReturnValue('cms:blog:top-10-keyboards'),
        get: vi.fn().mockResolvedValue({
          id: sampleBlog._id,
          slug: sampleBlog.slug,
          title: sampleBlog.title,
          status: 'published',
          publishedAt: '2026-10-28T00:00:00.000Z',
          content: sampleBlog.content,
          categoryId: sampleBlog.categoryId,
        }),
        set: vi.fn(),
      };
      const blogModel = {
        findOne: vi.fn(),
      };

      const service = buildService(
        blogModel as never,
        {} as never,
        cacheService as never,
        {} as never,
      );

      const res = await service.getPublicBlogBySlug('top-10-keyboards');
      expect(res.slug).toBe('top-10-keyboards');
      expect(blogModel.findOne).not.toHaveBeenCalled();
    });

    it('queries mongo, sets cache, and returns blog on cache miss', async () => {
      const cacheService = {
        blogSlugKey: vi.fn().mockReturnValue('cms:blog:top-10-keyboards'),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      };
      const blogModel = {
        findOne: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(sampleBlog),
          }),
        }),
      };

      const service = buildService(
        blogModel as never,
        {} as never,
        cacheService as never,
        {} as never,
      );

      const res = await service.getPublicBlogBySlug('top-10-keyboards');
      expect(res.slug).toBe('top-10-keyboards');
      expect(blogModel.findOne).toHaveBeenCalledWith({
        slug: 'top-10-keyboards',
        status: 'published',
      });
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('throws NotFoundException when blog not found or draft', async () => {
      const cacheService = {
        blogSlugKey: vi.fn().mockReturnValue('cms:blog:missing'),
        get: vi.fn().mockResolvedValue(null),
      };
      const blogModel = {
        findOne: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(null),
          }),
        }),
      };

      const service = buildService(
        blogModel as never,
        {} as never,
        cacheService as never,
        {} as never,
      );

      await expect(service.getPublicBlogBySlug('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('paginates published blogs and sets nextCursor when hasMore is true', async () => {
      const item1 = {
        ...sampleBlog,
        _id: '507f1f77bcf86cd799439021',
        publishedAt: new Date('2026-10-28T02:00:00.000Z'),
      };
      const item2 = {
        ...sampleBlog,
        _id: '507f1f77bcf86cd799439022',
        publishedAt: new Date('2026-10-28T01:00:00.000Z'),
      };

      const blogModel = {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              lean: vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue([item1, item2]),
              }),
            }),
          }),
        }),
      };

      const service = buildService(
        blogModel as never,
        {} as never,
        {} as never,
        {} as never,
      );

      // limit = 1, returned 2 items -> hasMore = true
      const res = await service.getPublicBlogs(undefined, undefined, 1);
      expect(res.data).toHaveLength(1);
      expect(res.nextCursor).not.toBeNull();
      const decoded = Buffer.from(res.nextCursor!, 'base64').toString('utf8');
      expect(decoded).toContain('2026-10-28T02:00:00.000Z');
      expect(decoded).toContain('507f1f77bcf86cd799439021');
    });

    it('decodes cursor and filters by category slug when provided', async () => {
      const blogCategoryModel = {
        findOne: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(sampleCategory),
          }),
        }),
      };

      const findMock = vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      const blogModel = {
        find: findMock,
      };

      const service = buildService(
        blogModel as never,
        blogCategoryModel as never,
        {} as never,
        {} as never,
      );

      const cursor = Buffer.from(
        '2026-10-28T00:00:00.000Z|507f1f77bcf86cd799439021',
      ).toString('base64');

      const res = await service.getPublicBlogs('tech-gadgets', cursor, 10);
      expect(res.data).toHaveLength(0);
      expect(res.nextCursor).toBeNull();
      expect(findMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'published',
          categoryId: '507f1f77bcf86cd799439020',
        }),
      );
    });
  });

  describe('admin mutations and events', () => {
    it('creates draft blog without emitting blog.updated', async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const mockDoc = {
        _id: '507f1f77bcf86cd799439021',
        slug: 'draft-post',
        title: 'Draft Post',
        content: [],
        categoryId: '507f1f77bcf86cd799439020',
        status: 'draft',
        publishedAt: null,
        save: saveMock,
        toObject: vi.fn().mockReturnValue({
          _id: '507f1f77bcf86cd799439021',
          slug: 'draft-post',
          title: 'Draft Post',
          content: [],
          categoryId: '507f1f77bcf86cd799439020',
          status: 'draft',
          publishedAt: null,
        }),
      };

      function MockBlogModel(this: unknown, data: unknown) {
        Object.assign(this as object, mockDoc, data);
      }
      MockBlogModel.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });

      const eventsService = { publishBlogUpdated: vi.fn() };
      const cacheService = { del: vi.fn() };

      const service = buildService(
        MockBlogModel as never,
        {} as never,
        cacheService as never,
        eventsService as never,
      );

      const dto: CreateBlog = {
        slug: 'draft-post',
        title: 'Draft Post',
        content: [],
        categoryId: '507f1f77bcf86cd799439020',
        status: 'draft',
      };

      const res = await service.createBlog(dto);
      expect(res.status).toBe('draft');
      // A draft is not visible to consumers, so nothing is announced.
      expect(outbox.record).not.toHaveBeenCalled();
    });

    it('creates published blog, invalidates cache, and emits blog.updated', async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      const mockDoc = {
        _id: '507f1f77bcf86cd799439021',
        slug: 'live-post',
        title: 'Live Post',
        content: [],
        categoryId: '507f1f77bcf86cd799439020',
        status: 'published',
        publishedAt: new Date('2026-10-28T00:00:00.000Z'),
        save: saveMock,
        toObject: vi.fn().mockReturnValue({
          _id: '507f1f77bcf86cd799439021',
          slug: 'live-post',
          title: 'Live Post',
          content: [],
          categoryId: '507f1f77bcf86cd799439020',
          status: 'published',
          publishedAt: new Date('2026-10-28T00:00:00.000Z'),
        }),
      };

      function MockBlogModel(this: unknown, data: unknown) {
        Object.assign(this as object, mockDoc, data);
      }
      MockBlogModel.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });

      const eventsService = {
        publishBlogUpdated: vi.fn().mockResolvedValue(undefined),
      };
      const cacheService = {
        blogSlugKey: vi.fn().mockReturnValue('cms:blog:live-post'),
        del: vi.fn().mockResolvedValue(undefined),
      };

      const service = buildService(
        MockBlogModel as never,
        {} as never,
        cacheService as never,
        eventsService as never,
      );

      const dto: CreateBlog = {
        slug: 'live-post',
        title: 'Live Post',
        content: [],
        categoryId: '507f1f77bcf86cd799439020',
        status: 'published',
      };

      const res = await service.createBlog(dto);
      expect(res.status).toBe('published');
      expect(cacheService.del).toHaveBeenCalledWith('cms:blog:live-post');
      expect(outbox.record).toHaveBeenCalledWith(
        fakeSession,
        expect.objectContaining({
          topic: 'blog.updated',
          aggregateId: '507f1f77bcf86cd799439021',
          payload: expect.objectContaining({
            blogId: '507f1f77bcf86cd799439021',
            slug: 'live-post',
            status: 'published',
            title: 'Live Post',
          }),
        }),
      );
    });

    it('updates blog to published, sets publishedAt, invalidates cache, and emits blog.updated', async () => {
      const doc = {
        _id: '507f1f77bcf86cd799439021',
        slug: 'live-post',
        title: 'Live Post',
        content: [],
        categoryId: '507f1f77bcf86cd799439020',
        status: 'draft',
        publishedAt: null as Date | null,
        save: vi.fn().mockResolvedValue(undefined),
        toObject: vi.fn().mockReturnValue({
          _id: '507f1f77bcf86cd799439021',
          slug: 'live-post',
          title: 'Live Post Updated',
          content: [],
          categoryId: '507f1f77bcf86cd799439020',
          status: 'published',
          publishedAt: new Date('2026-10-28T00:00:00.000Z'),
        }),
      };

      const blogModel = {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(doc),
        }),
      };
      const eventsService = {
        publishBlogUpdated: vi.fn().mockResolvedValue(undefined),
      };
      const cacheService = {
        blogSlugKey: vi.fn().mockReturnValue('cms:blog:live-post'),
        del: vi.fn().mockResolvedValue(undefined),
      };

      const service = buildService(
        blogModel as never,
        {} as never,
        cacheService as never,
        eventsService as never,
      );

      const update: UpdateBlog = {
        status: 'published',
        title: 'Live Post Updated',
      };

      const res = await service.updateBlog('507f1f77bcf86cd799439021', update);
      expect(res.status).toBe('published');
      expect(doc.save).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalledWith('cms:blog:live-post');
      expect(outbox.record).toHaveBeenCalledWith(
        fakeSession,
        expect.objectContaining({
          topic: 'blog.updated',
          aggregateId: '507f1f77bcf86cd799439021',
          payload: expect.objectContaining({
            blogId: '507f1f77bcf86cd799439021',
            slug: 'live-post',
            status: 'published',
            title: 'Live Post Updated',
          }),
        }),
      );
    });

    it('deletes published blog, invalidates cache, and emits blog.updated with draft status', async () => {
      const blogModel = {
        findOneAndDelete: vi.fn().mockReturnValue({
          // The delete joins the transaction, so the service chains `.session()`.
          session: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue({
              _id: '507f1f77bcf86cd799439021',
              slug: 'live-post',
              status: 'published',
            }),
          }),
        }),
      };
      const eventsService = {
        publishBlogUpdated: vi.fn().mockResolvedValue(undefined),
      };
      const cacheService = {
        blogSlugKey: vi.fn().mockReturnValue('cms:blog:live-post'),
        del: vi.fn().mockResolvedValue(undefined),
      };

      const service = buildService(
        blogModel as never,
        {} as never,
        cacheService as never,
        eventsService as never,
      );

      await service.deleteBlog('507f1f77bcf86cd799439021');
      expect(cacheService.del).toHaveBeenCalledWith('cms:blog:live-post');
      expect(outbox.record).toHaveBeenCalledWith(
        fakeSession,
        expect.objectContaining({
          topic: 'blog.updated',
          payload: expect.objectContaining({
            blogId: '507f1f77bcf86cd799439021',
            slug: 'live-post',
            // A deleted post is announced as a draft.
            status: 'draft',
          }),
        }),
      );
    });

    it('updates published blog to draft, invalidates cache, and emits blog.updated with draft status', async () => {
      const doc = {
        _id: '507f1f77bcf86cd799439021',
        slug: 'live-post',
        title: 'Live Post',
        content: [],
        categoryId: '507f1f77bcf86cd799439020',
        status: 'published',
        publishedAt: new Date('2026-10-28T00:00:00.000Z'),
        save: vi.fn().mockResolvedValue(undefined),
        toObject: vi.fn().mockReturnValue({
          _id: '507f1f77bcf86cd799439021',
          slug: 'live-post',
          title: 'Live Post',
          content: [],
          categoryId: '507f1f77bcf86cd799439020',
          status: 'draft',
          publishedAt: new Date('2026-10-28T00:00:00.000Z'),
        }),
      };

      const blogModel = {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(doc),
        }),
      };
      const eventsService = {
        publishBlogUpdated: vi.fn().mockResolvedValue(undefined),
      };
      const cacheService = {
        blogSlugKey: vi.fn().mockReturnValue('cms:blog:live-post'),
        del: vi.fn().mockResolvedValue(undefined),
      };

      const service = buildService(
        blogModel as never,
        {} as never,
        cacheService as never,
        eventsService as never,
      );

      const update: UpdateBlog = {
        status: 'draft',
      };

      const res = await service.updateBlog('507f1f77bcf86cd799439021', update);
      expect(res.status).toBe('draft');
      expect(doc.save).toHaveBeenCalled();
      expect(cacheService.del).toHaveBeenCalledWith('cms:blog:live-post');
      expect(outbox.record).toHaveBeenCalledWith(
        fakeSession,
        expect.objectContaining({
          topic: 'blog.updated',
          aggregateId: '507f1f77bcf86cd799439021',
          payload: expect.objectContaining({
            blogId: '507f1f77bcf86cd799439021',
            slug: 'live-post',
            status: 'draft',
          }),
        }),
      );
    });
  });
});
