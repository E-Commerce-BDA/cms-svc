import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  AuthSettings,
  ThemeSettings,
} from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import type {
  PublicPageSettingsResponse,
  PublicThemeResponse,
} from '../common/public-state.js';
import { MongoTransactions } from '../db/mongo-tx.js';
import { CmsOutbox } from '../outbox/cms-outbox.js';
import {
  RevalidateService,
  storefrontTags,
} from '../revalidate/revalidate.service.js';
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
    private readonly revalidate: RevalidateService,
  ) {}

  async getGlobalTheme(): Promise<PublicThemeResponse> {
    const cacheKey = this.cacheService.settingsGlobalKey();
    const cached = await this.cacheService.get<PublicThemeResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const doc = await this.cmsSettingsModel
      .findOne({ scope: 'global' })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const response: PublicThemeResponse = {
      theme: (doc?.theme as ThemeSettings) ?? {},
      version,
      // A write creates the row even when the admin clears every key, so
      // "never configured" and "configured as empty" stay distinguishable.
      configured: doc !== null,
    };

    await this.cacheService.set(cacheKey, response);
    return response;
  }

  async updateGlobalTheme(theme: ThemeSettings): Promise<PublicThemeResponse> {
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
    // After the commit and after our own cache: the storefront's Data Cache is
    // the one copy of this content that cms-svc cannot delete by itself.
    await this.revalidate.revalidate([storefrontTags.globalSettings]);

    return { theme, version, configured: true };
  }

  async getPageSettings(pageKey: string): Promise<PublicPageSettingsResponse> {
    const cacheKey = this.cacheService.pageSettingsKey(pageKey);
    const cached = await this.cacheService.get<PublicPageSettingsResponse>(
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    const doc = await this.pageSettingsModel
      .findOne({ pageKey })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const response: PublicPageSettingsResponse = {
      settings: (doc?.settings as AuthSettings) ?? {},
      version,
      configured: doc !== null,
    };

    await this.cacheService.set(cacheKey, response);
    return response;
  }

  async updatePageSettings(
    pageKey: string,
    settings: AuthSettings,
  ): Promise<PublicPageSettingsResponse> {
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
    // One page key, one tag: `cms:page-settings:<pageKey>` is exactly what the
    // storefront's reader subscribes to.
    await this.revalidate.revalidate([storefrontTags.pageSettings(pageKey)]);

    return { settings, version, configured: true };
  }
}
