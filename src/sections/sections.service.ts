import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  type Section,
  type SectionListResponse,
  type SectionReorder,
  sectionSchema,
} from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import { MongoTransactions } from '../db/mongo-tx.js';
import { CmsOutbox } from '../outbox/cms-outbox.js';
import { RevisionService } from '../revision/revision.service.js';
import { SectionModel, type SectionDocument } from './section.schema.js';

@Injectable()
export class SectionsService {
  constructor(
    @InjectModel(SectionModel.name)
    private readonly sectionModel: Model<SectionDocument>,
    private readonly revisionService: RevisionService,
    private readonly cacheService: CacheService,
    private readonly transactions: MongoTransactions,
    private readonly outbox: CmsOutbox,
  ) {}

  async getPublicSections(pageKey: string): Promise<SectionListResponse> {
    const cacheKey = this.cacheService.sectionsPageKey(pageKey);
    const cached = await this.cacheService.get<SectionListResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const docs = await this.sectionModel
      .find({ pageKey, isActive: true })
      .sort({ sortOrder: 1 })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const sections: Section[] = docs.map((doc) => this.toSectionPayload(doc));

    const response: SectionListResponse = { sections, version };
    await this.cacheService.set(cacheKey, response);
    return response;
  }

  async getAdminSections(pageKey?: string): Promise<SectionListResponse> {
    const filter = pageKey ? { pageKey } : {};
    const docs = await this.sectionModel
      .find(filter)
      .sort({ pageKey: 1, sortOrder: 1 })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const sections: Section[] = docs.map((doc) => this.toSectionPayload(doc));

    return { sections, version };
  }

  async createSection(dto: Section): Promise<Section> {
    const existing = await this.sectionModel.findOne({ key: dto.key }).exec();
    if (existing) {
      throw new ConflictException({
        code: 'SECTION_KEY_EXISTS',
        message: `Section with key '${dto.key}' already exists`,
      });
    }

    const last = await this.sectionModel
      .findOne({ pageKey: dto.pageKey })
      .sort({ sortOrder: -1 })
      .exec();

    const nextSortOrder = last ? last.sortOrder + 1 : 0;

    const created = new this.sectionModel({
      key: dto.key,
      pageKey: dto.pageKey,
      type: dto.type,
      title: dto.title,
      content: dto.content,
      settings: dto.settings ?? {},
      sortOrder: nextSortOrder,
      isActive: dto.isActive ?? true,
    });

    await this.transactions.run(async (session) => {
      await created.save({ session });
      const version = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'section',
        aggregateId: dto.key,
        payload: {
          scope: 'sections',
          version,
          pageKey: dto.pageKey,
          key: dto.key,
        },
      });
    });

    // Cache invalidation runs after the commit: Redis cannot join a Mongo
    // transaction, and invalidating first would re-cache the old sections.
    await this.cacheService.del(this.cacheService.sectionsPageKey(dto.pageKey));
    await this.cacheService.del(this.cacheService.sectionKey(dto.key));

    return this.toSectionPayload(created.toObject());
  }

  async updateSection(
    key: string,
    updates: Partial<Section>,
  ): Promise<Section> {
    const section = await this.sectionModel.findOne({ key }).exec();
    if (!section) {
      throw new NotFoundException({
        code: 'SECTION_NOT_FOUND',
        message: `Section with key '${key}' not found`,
      });
    }

    if (updates.key !== undefined && updates.key !== key) {
      throw new BadRequestException({
        code: 'SECTION_KEY_IMMUTABLE',
        message: 'Section key cannot be changed after creation',
      });
    }

    if (updates.pageKey !== undefined && updates.pageKey !== section.pageKey) {
      throw new BadRequestException({
        code: 'SECTION_PAGE_IMMUTABLE',
        message: 'Section pageKey cannot be changed after creation',
      });
    }

    if (updates.type !== undefined && updates.type !== section.type) {
      throw new BadRequestException({
        code: 'SECTION_TYPE_IMMUTABLE',
        message: 'Section type cannot be changed after creation',
      });
    }

    const candidate = {
      key: section.key,
      pageKey: section.pageKey,
      type: section.type,
      title: updates.title !== undefined ? updates.title : section.title,
      content:
        updates.content !== undefined ? updates.content : section.content,
      settings:
        updates.settings !== undefined ? updates.settings : section.settings,
      sortOrder: section.sortOrder,
      isActive:
        updates.isActive !== undefined ? updates.isActive : section.isActive,
    };

    const parsed = sectionSchema.safeParse(candidate);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details,
      });
    }

    section.title = candidate.title;
    section.content = candidate.content;
    section.settings = candidate.settings;
    section.isActive = candidate.isActive;

    await this.transactions.run(async (session) => {
      await section.save({ session });
      const version = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'section',
        aggregateId: key,
        payload: {
          scope: 'sections',
          version,
          pageKey: section.pageKey,
          key,
        },
      });
    });

    await this.cacheService.del(this.cacheService.sectionsPageKey(section.pageKey));
    await this.cacheService.del(this.cacheService.sectionKey(key));

    return this.toSectionPayload(section.toObject());
  }

  async deleteSection(key: string): Promise<void> {
    const pageKey = await this.transactions.run(async (session) => {
      const section = await this.sectionModel
        .findOneAndDelete({ key })
        .session(session)
        .exec();

      if (!section) {
        throw new NotFoundException({
          code: 'SECTION_NOT_FOUND',
          message: `Section with key '${key}' not found`,
        });
      }

      const version = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'section',
        aggregateId: key,
        payload: {
          scope: 'sections',
          version,
          pageKey: section.pageKey,
          key,
        },
      });

      return section.pageKey as string;
    });

    await this.cacheService.del(this.cacheService.sectionsPageKey(pageKey));
    await this.cacheService.del(this.cacheService.sectionKey(key));
  }

  async reorderSections(dto: SectionReorder): Promise<void> {
    const existing = await this.sectionModel
      .find({
        pageKey: dto.pageKey,
        key: { $in: dto.orderedKeys },
      })
      .select({ key: 1 })
      .lean()
      .exec();

    if (existing.length !== dto.orderedKeys.length) {
      throw new BadRequestException({
        code: 'SECTION_REORDER_INVALID',
        message:
          'One or more section keys do not exist or belong to a different page',
      });
    }

    const bulkOps = dto.orderedKeys.map((key, index) => ({
      updateOne: {
        filter: { key, pageKey: dto.pageKey },
        update: { $set: { sortOrder: index } },
      },
    }));

    await this.transactions.run(async (session) => {
      await this.sectionModel.bulkWrite(bulkOps, { session });
      const version = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'section',
        // A reorder moves the whole page, so the page is the aggregate.
        aggregateId: dto.pageKey,
        payload: { scope: 'sections', version, pageKey: dto.pageKey },
      });
    });

    await this.cacheService.del(this.cacheService.sectionsPageKey(dto.pageKey));
  }

  private toSectionPayload(doc: any): Section {
    return {
      key: doc.key,
      pageKey: doc.pageKey,
      type: doc.type,
      title: doc.title,
      content: doc.content,
      settings: doc.settings,
      sortOrder: doc.sortOrder,
      isActive: doc.isActive,
    } as Section;
  }
}
