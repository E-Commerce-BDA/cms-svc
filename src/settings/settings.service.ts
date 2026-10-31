import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  AuthSettings,
  PageSettingsResponse,
  ThemeResponse,
  ThemeSettings,
} from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import { MongoTransactions } from '../db/mongo-tx.js';
import { CmsOutbox } from '../outbox/cms-outbox.js';
import { RevisionService } from '../revision/revision.service.js';
import {
  CmsSettingsModel,
  type CmsSettingsDocument,
} from './cms-settings.schema.js';
import {
  PageSettingsModel,
  type PageSettingsDocument,
} from './page-settings.schema.js';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(CmsSettingsModel.name)
    private readonly cmsSettingsModel: Model<CmsSettingsDocument>,
    @InjectModel(PageSettingsModel.name)
    private readonly pageSettingsModel: Model<PageSettingsDocument>,
    private readonly revisionService: RevisionService,
    private readonly cacheService: CacheService,
    private readonly transactions: MongoTransactions,
    private readonly outbox: CmsOutbox,
  ) {}

  async getGlobalTheme(): Promise<ThemeResponse> {
    const cacheKey = this.cacheService.settingsGlobalKey();
    const cached = await this.cacheService.get<ThemeResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const doc = await this.cmsSettingsModel
      .findOne({ scope: 'global' })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const response: ThemeResponse = {
      theme: (doc?.theme as ThemeSettings) ?? {},
      version,
    };

    await this.cacheService.set(cacheKey, response);
    return response;
  }

  async updateGlobalTheme(theme: ThemeSettings): Promise<ThemeResponse> {
    const version = await this.transactions.run(async (session) => {
      await this.cmsSettingsModel
        .findOneAndUpdate(
          { scope: 'global' },
          { $set: { theme } },
          { upsert: true, returnDocument: 'after', session },
        )
        .exec();

      const bumped = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'settings',
        aggregateId: 'global',
        payload: { scope: 'theme', version: bumped },
      });

      return bumped;
    });

    await this.cacheService.del(this.cacheService.settingsGlobalKey());

    return { theme, version };
  }

  async getPageSettings(pageKey: string): Promise<PageSettingsResponse> {
    const cacheKey = this.cacheService.pageSettingsKey(pageKey);
    const cached = await this.cacheService.get<PageSettingsResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const doc = await this.pageSettingsModel
      .findOne({ pageKey })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const response: PageSettingsResponse = {
      settings: (doc?.settings as AuthSettings) ?? {},
      version,
    };

    await this.cacheService.set(cacheKey, response);
    return response;
  }

  async updatePageSettings(
    pageKey: string,
    settings: AuthSettings,
  ): Promise<PageSettingsResponse> {
    const version = await this.transactions.run(async (session) => {
      await this.pageSettingsModel
        .findOneAndUpdate(
          { pageKey },
          { $set: { settings } },
          { upsert: true, returnDocument: 'after', session },
        )
        .exec();

      const bumped = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'settings',
        aggregateId: pageKey,
        payload: { scope: 'page-settings', version: bumped, pageKey },
      });

      return bumped;
    });

    await this.cacheService.del(this.cacheService.pageSettingsKey(pageKey));

    return { settings, version };
  }
}
