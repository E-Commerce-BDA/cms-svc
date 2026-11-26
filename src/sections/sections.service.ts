import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  type CloneSections,
  type Section,
  type SectionListResponse,
  type SectionReorder,
  sectionSchema,
} from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import {
  resolveSectionState,
  type PublicSectionsResponse,
} from '../common/public-state.js';
import { MongoTransactions } from '../db/mongo-tx.js';
import { CmsOutbox } from '../outbox/cms-outbox.js';
import {
  RevalidateService,
  storefrontTags,
} from '../revalidate/revalidate.service.js';
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
    private readonly revalidate: RevalidateService,
  ) {}

  async getPublicSections(
    pageKey: string,
    preview = false,
  ): Promise<PublicSectionsResponse> {
    const cacheKey = this.cacheService.sectionsPageKey(pageKey);
    if (!preview) {
      const cached = await this.cacheService.get<PublicSectionsResponse>(
        cacheKey,
      );
      if (cached) {
        return cached;
      }
    }

    // Preview reads bypass Redis in both directions: a draft list must never
    // become the cached public answer, nor be served from a published cache.
    const docs = await this.sectionModel
      .find(preview ? { pageKey } : { pageKey, isActive: true })
      .sort({ sortOrder: 1 })
      .lean()
      .exec();

    // `state` describes what shoppers see even on a preview read, so an admin
    // can tell "no published sections" from "no sections at all" while looking
    // at the draft rows the token just admitted.
    const total = await this.sectionModel.countDocuments({ pageKey }).exec();
    const active = preview
      ? docs.filter((doc) => doc.isActive === true).length
      : docs.length;
    const state = resolveSectionState(total, active);

    const version = await this.revisionService.getVersion();
    const sections: Section[] = docs.map((doc) => this.toSectionPayload(doc));
    const response: PublicSectionsResponse = { sections, version, state };

    if (!preview) {
      await this.cacheService.set(cacheKey, response);
    }
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
    // cms-008: the storefront home reads its sections through one tag per page.
    await this.revalidate.revalidate([storefrontTags.sections(dto.pageKey)]);

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
    await this.revalidate.revalidate([
      storefrontTags.sections(section.pageKey),
    ]);

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
    await this.revalidate.revalidate([storefrontTags.sections(pageKey)]);
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
    await this.revalidate.revalidate([storefrontTags.sections(dto.pageKey)]);
  }

  async cloneSections(dto: CloneSections): Promise<SectionListResponse> {
    if (dto.fromPageKey === dto.toPageKey) {
      throw new BadRequestException({
        code: 'CLONE_SAME_PAGE',
        message: 'Clone target page must differ from source',
      });
    }

    const sourceDocs = await this.sectionModel
      .find({ pageKey: dto.fromPageKey })
      .sort({ sortOrder: 1 })
      .lean()
      .exec();

    if (sourceDocs.length === 0) {
      throw new NotFoundException({
        code: 'CLONE_SOURCE_EMPTY',
        message: `Source page '${dto.fromPageKey}' has no sections`,
      });
    }

    if (sourceDocs.length > 200) {
      throw new BadRequestException({
        code: 'CLONE_TOO_MANY',
        message: 'Cannot clone more than 200 sections at once',
      });
    }

    const prefix = `${dto.fromPageKey}-`;
    const candidates = sourceDocs.map((doc) => {
      const source = this.toSectionPayload(doc);
      const parsedSource = sectionSchema.safeParse(source);
      if (!parsedSource.success) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: `Source section '${source.key}' is invalid`,
        });
      }
      if (!source.key.startsWith(prefix)) {
        throw new BadRequestException({
          code: 'CLONE_KEY_INVALID',
          message:
            `Source section key '${source.key}' must start with '${prefix}' to be cloned`,
        });
      }
      const suffix = source.key.slice(prefix.length);
      const target: Section = {
        ...parsedSource.data,
        key: `${dto.toPageKey}-${suffix}`,
        pageKey: dto.toPageKey,
      };
      const parsedTarget = sectionSchema.safeParse(target);
      if (!parsedTarget.success) {
        throw new BadRequestException({
          code: 'CLONE_KEY_INVALID',
          message: `Derived clone key '${target.key}' is invalid`,
        });
      }
      return parsedTarget.data;
    });

    const existingTarget = await this.sectionModel
      .find({ pageKey: dto.toPageKey })
      .select({ key: 1 })
      .lean()
      .exec();
    if (existingTarget.length > 0 && dto.replace !== true) {
      throw new ConflictException({
        code: 'CLONE_TARGET_EXISTS',
        message:
          `Target page '${dto.toPageKey}' already has ${existingTarget.length} section(s); resend with replace: true to overwrite`,
      });
    }
    const replacedKeys = existingTarget.map((doc) => doc.key as string);

    const version = await this.transactions.run(async (session) => {
      if (dto.replace === true) {
        await this.sectionModel
          .deleteMany({ pageKey: dto.toPageKey })
          .session(session)
          .exec();
      }

      await this.sectionModel.insertMany(
        candidates.map((section, index) => ({
          key: section.key,
          pageKey: section.pageKey,
          type: section.type,
          title: section.title,
          content: section.content,
          settings: section.settings ?? {},
          sortOrder: index,
          isActive: section.isActive ?? true,
        })),
        { session },
      );

      const nextVersion = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'section',
        aggregateId: dto.toPageKey,
        payload: {
          scope: 'sections',
          version: nextVersion,
          pageKey: dto.toPageKey,
        },
      });
      return nextVersion;
    });

    await this.cacheService.del(this.cacheService.sectionsPageKey(dto.toPageKey));
    for (const key of [...replacedKeys, ...candidates.map((s) => s.key)]) {
      await this.cacheService.del(this.cacheService.sectionKey(key));
    }
    await this.revalidate.revalidate([storefrontTags.sections(dto.toPageKey)]);

    return { sections: candidates, version };
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
