import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import type {
  Blog,
  BlogBlock,
  BlogCategory,
  BlogListResponse,
  BlogStatus,
  CreateBlog,
  CreateBlogCategory,
  PageSeo,
  UpdateBlog,
} from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import { EventsService } from '../events/events.service.js';
import {
  BlogCategoryModel,
  type BlogCategoryDocument,
} from './blog-category.schema.js';
import { BlogModel, type BlogDocument } from './blog.schema.js';

interface BlogCategoryDocumentLike {
  _id?: { toString(): string } | string;
  id?: string;
  name: string;
  slug: string;
  description?: string;
}

interface BlogDocumentLike {
  _id?: { toString(): string } | string;
  id?: string;
  slug: string;
  title: string;
  coverUrl?: string;
  excerpt?: string;
  content: BlogBlock[];
  categoryId: string;
  author?: string;
  status: BlogStatus;
  publishedAt?: Date | string | null;
  seo?: PageSeo;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

@Injectable()
export class BlogsService {
  constructor(
    @InjectModel(BlogModel.name)
    private readonly blogModel: Model<BlogDocument>,
    @InjectModel(BlogCategoryModel.name)
    private readonly blogCategoryModel: Model<BlogCategoryDocument>,
    private readonly cacheService: CacheService,
    private readonly eventsService: EventsService,
  ) {}

  async getPublicCategories(): Promise<BlogCategory[]> {
    const docs = await this.blogCategoryModel
      .find()
      .sort({ name: 1 })
      .lean<BlogCategoryDocumentLike[]>()
      .exec();

    return docs.map((doc) => this.toBlogCategoryPayload(doc));
  }

  async createCategory(dto: CreateBlogCategory): Promise<BlogCategory> {
    const existing = await this.blogCategoryModel
      .findOne({ slug: dto.slug })
      .exec();
    if (existing) {
      throw new ConflictException({
        code: 'CATEGORY_SLUG_EXISTS',
        message: `Blog category with slug '${dto.slug}' already exists`,
      });
    }

    const created = new this.blogCategoryModel({
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
    });

    await created.save();
    return this.toBlogCategoryPayload(
      created.toObject<BlogCategoryDocumentLike>(),
    );
  }

  async getPublicBlogs(
    category?: string,
    cursor?: string,
    limitStr?: number,
  ): Promise<BlogListResponse> {
    const limit = Math.min(Math.max(1, limitStr || 10), 50);
    const query: FilterQuery<BlogModel> = { status: 'published' };

    if (category) {
      const isObjectId = Types.ObjectId.isValid(category);
      const catDoc = await this.blogCategoryModel
        .findOne({
          $or: [
            { slug: category },
            ...(isObjectId ? [{ _id: new Types.ObjectId(category) }] : []),
          ],
        })
        .lean<BlogCategoryDocumentLike | null>()
        .exec();

      if (catDoc) {
        query.categoryId = String(catDoc._id ?? catDoc.id);
      } else {
        query.categoryId = category;
      }
    }

    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const delimiterIndex = decoded.indexOf('|');
      if (delimiterIndex !== -1) {
        const publishedAtIso = decoded.slice(0, delimiterIndex);
        const id = decoded.slice(delimiterIndex + 1);
        const cursorDate = new Date(publishedAtIso);

        const idCondition = Types.ObjectId.isValid(id)
          ? { $lt: new Types.ObjectId(id) }
          : { $lt: id };

        query.$or = [
          { publishedAt: { $lt: cursorDate } },
          { publishedAt: cursorDate, _id: idCondition },
        ];
      }
    }

    const docs = await this.blogModel
      .find(query)
      .sort({ publishedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<BlogDocumentLike[]>()
      .exec();

    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;

    let nextCursor: string | null = null;
    if (hasMore && pageDocs.length > 0) {
      const last = pageDocs[pageDocs.length - 1];
      const publishedAtIso =
        last.publishedAt instanceof Date
          ? last.publishedAt.toISOString()
          : new Date(last.publishedAt ?? Date.now()).toISOString();
      const lastId = String(last._id ?? last.id);
      nextCursor = Buffer.from(`${publishedAtIso}|${lastId}`).toString(
        'base64',
      );
    }

    return {
      data: pageDocs.map((doc) => this.toBlogPayload(doc)),
      nextCursor,
    };
  }

  async getAdminBlogs(
    status?: BlogStatus,
    cursor?: string,
    limitStr?: number,
  ): Promise<BlogListResponse> {
    const limit = Math.min(Math.max(1, limitStr || 10), 50);
    const query: FilterQuery<BlogModel> = {};

    if (status) {
      query.status = status;
    }

    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const delimiterIndex = decoded.indexOf('|');
      if (delimiterIndex !== -1) {
        const sortDateIso = decoded.slice(0, delimiterIndex);
        const id = decoded.slice(delimiterIndex + 1);
        const cursorDate = new Date(sortDateIso);

        const idCondition = Types.ObjectId.isValid(id)
          ? { $lt: new Types.ObjectId(id) }
          : { $lt: id };

        query.$or = [
          { createdAt: { $lt: cursorDate } },
          { createdAt: cursorDate, _id: idCondition },
        ];
      }
    }

    const docs = await this.blogModel
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<BlogDocumentLike[]>()
      .exec();

    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;

    let nextCursor: string | null = null;
    if (hasMore && pageDocs.length > 0) {
      const last = pageDocs[pageDocs.length - 1];
      const sortDateIso =
        last.createdAt instanceof Date
          ? last.createdAt.toISOString()
          : new Date(last.createdAt ?? Date.now()).toISOString();
      const lastId = String(last._id ?? last.id);
      nextCursor = Buffer.from(`${sortDateIso}|${lastId}`).toString('base64');
    }

    return {
      data: pageDocs.map((doc) => this.toBlogPayload(doc)),
      nextCursor,
    };
  }

  async getPublicBlogBySlug(slug: string): Promise<Blog> {
    const cacheKey = this.cacheService.blogSlugKey(slug);
    const cached = await this.cacheService.get<Blog>(cacheKey);
    if (cached) {
      return cached;
    }

    const doc = await this.blogModel
      .findOne({ slug, status: 'published' })
      .lean<BlogDocumentLike | null>()
      .exec();

    if (!doc) {
      throw new NotFoundException({
        code: 'BLOG_NOT_FOUND',
        message: `Blog '${slug}' not found`,
      });
    }

    const blog = this.toBlogPayload(doc);
    await this.cacheService.set(cacheKey, blog);
    return blog;
  }

  async createBlog(dto: CreateBlog): Promise<Blog> {
    const existing = await this.blogModel.findOne({ slug: dto.slug }).exec();
    if (existing) {
      throw new ConflictException({
        code: 'BLOG_SLUG_EXISTS',
        message: `Blog with slug '${dto.slug}' already exists`,
      });
    }

    let publishedAt: Date | null = null;
    if (dto.status === 'published') {
      publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : new Date();
    } else if (dto.publishedAt) {
      publishedAt = new Date(dto.publishedAt);
    }

    const created = new this.blogModel({
      slug: dto.slug,
      title: dto.title,
      coverUrl: dto.coverUrl,
      excerpt: dto.excerpt,
      content: dto.content,
      categoryId: dto.categoryId,
      author: dto.author,
      status: dto.status,
      publishedAt,
      seo: dto.seo ?? {},
    });

    await created.save();

    const blogPayload = this.toBlogPayload(
      created.toObject<BlogDocumentLike>(),
    );

    if (dto.status === 'published') {
      await this.cacheService.del(this.cacheService.blogSlugKey(dto.slug));
      await this.eventsService.publishBlogUpdated({
        blogId: blogPayload.id,
        slug: dto.slug,
        status: 'published',
        title: blogPayload.title,
        excerpt: blogPayload.excerpt,
        coverUrl: blogPayload.coverUrl ?? undefined,
        publishedAt: blogPayload.publishedAt ?? undefined,
        updatedAt: blogPayload.updatedAt,
        categoryId: blogPayload.categoryId ?? undefined,
      });
    }

    return blogPayload;
  }

  async updateBlog(id: string, updates: UpdateBlog): Promise<Blog> {
    const isObjectId = Types.ObjectId.isValid(id);
    const blog = await this.blogModel
      .findOne({
        $or: [
          ...(isObjectId ? [{ _id: new Types.ObjectId(id) }] : []),
          { slug: id },
        ],
      })
      .exec();

    if (!blog) {
      throw new NotFoundException({
        code: 'BLOG_NOT_FOUND',
        message: `Blog '${id}' not found`,
      });
    }

    if (updates.title !== undefined) blog.title = updates.title;
    if (updates.coverUrl !== undefined) blog.coverUrl = updates.coverUrl;
    if (updates.excerpt !== undefined) blog.excerpt = updates.excerpt;
    if (updates.content !== undefined) {
      blog.content = updates.content as unknown as Record<string, unknown>[];
    }
    if (updates.categoryId !== undefined) {
      blog.categoryId = updates.categoryId;
    }
    if (updates.author !== undefined) blog.author = updates.author;
    if (updates.seo !== undefined) {
      blog.seo = updates.seo as unknown as Record<string, unknown>;
    }

    if (updates.status !== undefined) {
      if (
        updates.status === 'published' &&
        !blog.publishedAt &&
        !updates.publishedAt
      ) {
        blog.publishedAt = new Date();
      }
      blog.status = updates.status;
    }

    if (updates.publishedAt !== undefined) {
      blog.publishedAt = updates.publishedAt
        ? new Date(updates.publishedAt)
        : null;
    }

    await blog.save();

    const blogPayload = this.toBlogPayload(blog.toObject<BlogDocumentLike>());

    await this.cacheService.del(this.cacheService.blogSlugKey(blog.slug));

    if (blog.status === 'published' || blog.status === 'draft') {
      await this.eventsService.publishBlogUpdated({
        blogId: blogPayload.id,
        slug: blog.slug,
        status: blog.status,
        title: blogPayload.title,
        excerpt: blogPayload.excerpt,
        coverUrl: blogPayload.coverUrl ?? undefined,
        publishedAt: blogPayload.publishedAt ?? undefined,
        updatedAt: blogPayload.updatedAt,
        categoryId: blogPayload.categoryId ?? undefined,
      });
    }

    return blogPayload;
  }

  async deleteBlog(id: string): Promise<void> {
    const isObjectId = Types.ObjectId.isValid(id);
    const deleted = await this.blogModel
      .findOneAndDelete({
        $or: [
          ...(isObjectId ? [{ _id: new Types.ObjectId(id) }] : []),
          { slug: id },
        ],
      })
      .exec();

    if (!deleted) {
      throw new NotFoundException({
        code: 'BLOG_NOT_FOUND',
        message: `Blog '${id}' not found`,
      });
    }

    await this.cacheService.del(this.cacheService.blogSlugKey(deleted.slug));

    if (deleted.status === 'published') {
      const deletedObj = deleted.toObject
        ? deleted.toObject<BlogDocumentLike>()
        : (deleted as unknown as BlogDocumentLike);
      const updatedAtStr =
        deletedObj.updatedAt instanceof Date
          ? deletedObj.updatedAt.toISOString()
          : typeof deletedObj.updatedAt === 'string'
            ? deletedObj.updatedAt
            : new Date().toISOString();
      const publishedAtStr =
        deletedObj.publishedAt instanceof Date
          ? deletedObj.publishedAt.toISOString()
          : typeof deletedObj.publishedAt === 'string'
            ? deletedObj.publishedAt
            : undefined;

      await this.eventsService.publishBlogUpdated({
        blogId: String(deleted._id),
        slug: deleted.slug,
        status: 'draft',
        title: deleted.title ?? deleted.slug,
        excerpt: deleted.excerpt ?? undefined,
        coverUrl: deleted.coverUrl ?? undefined,
        publishedAt: publishedAtStr,
        updatedAt: updatedAtStr,
        categoryId: deleted.categoryId ? String(deleted.categoryId) : undefined,
      });
    }
  }

  private toBlogCategoryPayload(
    doc: BlogCategoryDocumentLike,
  ): BlogCategory {
    return {
      id: (doc._id ? String(doc._id) : doc.id) ?? '',
      name: doc.name,
      slug: doc.slug,
      description: doc.description,
    };
  }

  private toBlogPayload(doc: BlogDocumentLike): Blog {
    return {
      id: (doc._id ? String(doc._id) : doc.id) ?? '',
      slug: doc.slug,
      title: doc.title,
      coverUrl: doc.coverUrl,
      excerpt: doc.excerpt,
      content: doc.content ?? [],
      categoryId: doc.categoryId,
      author: doc.author,
      status: doc.status,
      publishedAt:
        doc.publishedAt instanceof Date
          ? doc.publishedAt.toISOString()
          : (doc.publishedAt ?? null),
      seo: doc.seo,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : doc.createdAt,
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : doc.updatedAt,
    };
  }
}
