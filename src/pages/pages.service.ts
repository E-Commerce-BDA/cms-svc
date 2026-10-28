import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  CreatePage,
  Page,
  PageBlock,
  PageListResponse,
  PageSeo,
  UpdatePage,
} from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import { EventsService } from '../events/events.service.js';
import { RevisionService } from '../revision/revision.service.js';
import { PageModel, type PageDocument } from './page.schema.js';

interface PageDocumentLike {
  _id?: { toString(): string } | string;
  id?: string;
  slug: string;
  title: string;
  blocks: PageBlock[];
  seo?: PageSeo;
  isActive: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

@Injectable()
export class PagesService {
  constructor(
    @InjectModel(PageModel.name)
    private readonly pageModel: Model<PageDocument>,
    private readonly revisionService: RevisionService,
    private readonly cacheService: CacheService,
    private readonly eventsService: EventsService,
  ) {}

  async getPublicPages(): Promise<PageListResponse> {
    const docs = await this.pageModel
      .find({ isActive: true })
      .sort({ slug: 1 })
      .lean<PageDocumentLike[]>()
      .exec();

    const data: Page[] = docs.map((doc) => this.toPagePayload(doc));
    return { data };
  }

  async getPublicPageBySlug(slug: string): Promise<Page> {
    const cacheKey = this.cacheService.pageSlugKey(slug);
    const cached = await this.cacheService.get<Page>(cacheKey);
    if (cached) {
      return cached;
    }

    const doc = await this.pageModel
      .findOne({ slug, isActive: true })
      .lean<PageDocumentLike | null>()
      .exec();

    if (!doc) {
      throw new NotFoundException({
        code: 'PAGE_NOT_FOUND',
        message: `Page '${slug}' not found`,
      });
    }

    const page = this.toPagePayload(doc);
    await this.cacheService.set(cacheKey, page);
    return page;
  }

  async createPage(dto: CreatePage): Promise<Page> {
    const existing = await this.pageModel.findOne({ slug: dto.slug }).exec();
    if (existing) {
      throw new ConflictException({
        code: 'PAGE_SLUG_EXISTS',
        message: `Page with slug '${dto.slug}' already exists`,
      });
    }

    const created = new this.pageModel({
      slug: dto.slug,
      title: dto.title,
      blocks: dto.blocks,
      seo: dto.seo ?? {},
      isActive: dto.isActive ?? true,
    });

    await created.save();

    const version = await this.revisionService.bumpVersion();
    await this.cacheService.del(this.cacheService.pageSlugKey(dto.slug));

    await this.eventsService.publishCmsUpdated({
      scope: 'pages',
      version,
      key: dto.slug,
    });

    return this.toPagePayload(created.toObject<PageDocumentLike>());
  }

  async updatePage(slug: string, updates: UpdatePage): Promise<Page> {
    const page = await this.pageModel.findOne({ slug }).exec();
    if (!page) {
      throw new NotFoundException({
        code: 'PAGE_NOT_FOUND',
        message: `Page '${slug}' not found`,
      });
    }

    if (updates.title !== undefined) page.title = updates.title;
    if (updates.blocks !== undefined) {
      page.blocks = updates.blocks as unknown as Record<string, unknown>[];
    }
    if (updates.seo !== undefined) {
      page.seo = updates.seo as unknown as Record<string, unknown>;
    }
    if (updates.isActive !== undefined) page.isActive = updates.isActive;

    await page.save();

    const version = await this.revisionService.bumpVersion();
    await this.cacheService.del(this.cacheService.pageSlugKey(slug));

    await this.eventsService.publishCmsUpdated({
      scope: 'pages',
      version,
      key: slug,
    });

    return this.toPagePayload(page.toObject<PageDocumentLike>());
  }

  async deletePage(slug: string): Promise<void> {
    const deleted = await this.pageModel.findOneAndDelete({ slug }).exec();
    if (!deleted) {
      throw new NotFoundException({
        code: 'PAGE_NOT_FOUND',
        message: `Page '${slug}' not found`,
      });
    }

    const version = await this.revisionService.bumpVersion();
    await this.cacheService.del(this.cacheService.pageSlugKey(slug));

    await this.eventsService.publishCmsUpdated({
      scope: 'pages',
      version,
      key: slug,
    });
  }

  private toPagePayload(doc: PageDocumentLike): Page {
    return {
      id: (doc._id ? String(doc._id) : doc.id) ?? '',
      slug: doc.slug,
      title: doc.title,
      blocks: doc.blocks ?? [],
      seo: doc.seo,
      isActive: doc.isActive ?? true,
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
