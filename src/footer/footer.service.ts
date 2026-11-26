import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Footer } from '@ecom/contracts';
import { CacheService } from '../cache/cache.service.js';
import type { PublicFooterResponse } from '../common/public-state.js';
import { MongoTransactions } from '../db/mongo-tx.js';
import { CmsOutbox } from '../outbox/cms-outbox.js';
import {
  RevalidateService,
  storefrontTags,
} from '../revalidate/revalidate.service.js';
import { RevisionService } from '../revision/revision.service.js';
import { FooterModel, type FooterDocument } from './footer.schema.js';

/**
 * The global footer document (`cms-008`). Read path is cached like every other
 * CMS surface; the write path is the settings/navbar pattern verbatim: one Mongo
 * transaction for the upsert + revision bump + outbox record, then the Redis
 * invalidation, then the best-effort storefront revalidation.
 */
@Injectable()
export class FooterService {
  constructor(
    @InjectModel(FooterModel.name)
    private readonly footerModel: Model<FooterDocument>,
    private readonly revisionService: RevisionService,
    private readonly cacheService: CacheService,
    private readonly transactions: MongoTransactions,
    private readonly outbox: CmsOutbox,
    private readonly revalidate: RevalidateService,
  ) {}

  async getFooter(): Promise<PublicFooterResponse> {
    const cacheKey = this.cacheService.footerKey();
    const cached = await this.cacheService.get<PublicFooterResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const doc = await this.footerModel
      .findOne({ scope: 'footer' })
      .lean()
      .exec();

    const version = await this.revisionService.getVersion();
    const response: PublicFooterResponse = {
      footer: (doc?.footer as Footer) ?? {},
      version,
      configured: doc !== null,
    };

    await this.cacheService.set(cacheKey, response);
    return response;
  }

  async updateFooter(footer: Footer): Promise<PublicFooterResponse> {
    const version = await this.transactions.run(async (session) => {
      await this.footerModel
        .findOneAndUpdate(
          { scope: 'footer' },
          { $set: { footer } },
          { upsert: true, returnDocument: 'after', session },
        )
        .exec();

      const bumped = await this.revisionService.bumpVersion({ session });
      await this.outbox.record(session, {
        topic: 'cms.updated',
        aggregateType: 'footer',
        aggregateId: 'footer',
        payload: { scope: 'footer', version: bumped },
      });

      return bumped;
    });

    // After the commit, never inside it: Redis cannot join a Mongo transaction.
    await this.cacheService.del(this.cacheService.footerKey());
    // The footer is shell chrome rendered on every storefront route, so this
    // tag sits beside `cms:navigation` in breadth — one tag invalidates broadly.
    await this.revalidate.revalidate([storefrontTags.footer]);

    return { footer, version, configured: true };
  }
}
