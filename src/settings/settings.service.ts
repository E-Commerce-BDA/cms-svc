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
import { EventsService } from '../events/events.service.js';
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
    private readonly eventsService: EventsService,
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
    await this.cmsSettingsModel
      .findOneAndUpdate(
        { scope: 'global' },
        { $set: { theme } },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();

    const version = await this.revisionService.bumpVersion();
    await this.cacheService.del(this.cacheService.settingsGlobalKey());

    await this.eventsService.publishCmsUpdated({
      scope: 'theme',
      version,
    });

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
    await this.pageSettingsModel
      .findOneAndUpdate(
        { pageKey },
        { $set: { settings } },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();

    const version = await this.revisionService.bumpVersion();
    await this.cacheService.del(this.cacheService.pageSettingsKey(pageKey));

    await this.eventsService.publishCmsUpdated({
      scope: 'page-settings',
      version,
      pageKey,
    });

    return { settings, version };
  }
}
