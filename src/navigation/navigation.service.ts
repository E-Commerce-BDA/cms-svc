import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { NavResponse, NavSettings } from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import { MongoTransactions } from '../db/mongo-tx.js';
import { CmsOutbox } from '../outbox/cms-outbox.js';
import { RevisionService } from '../revision/revision.service.js';
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
  ) {}

  async getNavigation(): Promise<NavResponse> {
    const cacheKey = this.cacheService.navigationKey();
    const cached = await this.cacheService.get<NavResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const doc = await this.navModel
      .findOne({ scope: 'navbar' })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const response: NavResponse = {
      navbar: (doc?.navbar as NavSettings) ?? {},
      version,
    };

    await this.cacheService.set(cacheKey, response);
    return response;
  }

  async updateNavigation(navbar: NavSettings): Promise<NavResponse> {
    const version = await this.transactions.run(async (session) => {
      await this.navModel
        .findOneAndUpdate(
          { scope: 'navbar' },
          { $set: { navbar } },
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

    return { navbar, version };
  }
}
