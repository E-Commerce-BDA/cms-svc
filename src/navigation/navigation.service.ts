import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { NavSettings } from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import type { PublicNavResponse } from '../common/public-state.js';
import { MongoTransactions } from '../db/mongo-tx.js';
import { CmsOutbox } from '../outbox/cms-outbox.js';
import {
  RevalidateService,
  storefrontTags,
} from '../revalidate/revalidate.service.js';
import { RevisionService } from '../revision/revision.service.js';
import { normalizeNavSettings } from './nav-validation.js';
import {
  NavigationModel,
  type NavigationDocument,
} from './navigation.schema.js';

@Injectable()
export class NavigationService {
  constructor(
    @InjectModel(NavigationModel.name)
    private readonly navModel: Model<NavigationDocument>,
    private readonly revisionService: RevisionService,
    private readonly cacheService: CacheService,
    private readonly transactions: MongoTransactions,
    private readonly outbox: CmsOutbox,
    private readonly revalidate: RevalidateService,
  ) {}

  async getNavigation(): Promise<PublicNavResponse> {
    const cacheKey = this.cacheService.navigationKey();
    const cached = await this.cacheService.get<PublicNavResponse>(cacheKey);
    if (cached) {
      // A cached body is still a nav document: validate it on the way out so a
      // hand-edited Redis value cannot serve unsafe groups to the storefront.
      return { ...cached, navbar: normalizeNavSettings(cached.navbar) };
    }

    const doc = await this.navModel
      .findOne({ scope: 'navbar' })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const response: PublicNavResponse = {
      navbar: normalizeNavSettings(doc?.navbar ?? {}),
      version,
      configured: doc !== null,
    };

    await this.cacheService.set(cacheKey, response);
    return response;
  }

  async updateNavigation(navbar: NavSettings): Promise<PublicNavResponse> {
    // The controller already validates; repeat here so a direct service call
    // (or a future route) cannot persist a document the public GET would reject.
    const normalized = normalizeNavSettings(navbar);
    const version = await this.transactions.run(async (session) => {
      await this.navModel
        .findOneAndUpdate(
          { scope: 'navbar' },
          { $set: { navbar: normalized } },
          { upsert: true, returnDocument: 'after', session },
        )
        .exec();

      const bumped = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'navigation',
        aggregateId: 'navbar',
        payload: { scope: 'navigation', version: bumped },
      });

      return bumped;
    });

    await this.cacheService.del(this.cacheService.navigationKey());
    // The header is on every page, so this tag is the widest one we own.
    await this.revalidate.revalidate([storefrontTags.navigation]);

    return { navbar: normalized, version, configured: true };
  }
}
