import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { CmsMeta, type CmsMetaDocument } from './revision.schema.js';

@Injectable()
export class RevisionService {
  private readonly logger = new Logger(RevisionService.name);

  constructor(
    @InjectModel(CmsMeta.name)
    private readonly metaModel: Model<CmsMetaDocument>,
  ) {}

  async getVersion(): Promise<number> {
    const meta = await this.metaModel.findById('revision').exec();
    return meta?.version ?? 1;
  }

  /**
   * `session` makes the bump join the caller's transaction, so the version a
   * `cms.updated` payload carries is the version that actually commits: a
   * rolled-back content write cannot leave the revision ahead of the content.
   */
  async bumpVersion(options: { session?: ClientSession } = {}): Promise<number> {
    const updated = await this.metaModel
      .findByIdAndUpdate(
        'revision',
        {
          $inc: { version: 1 },
          $set: { updatedAt: new Date() },
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
          session: options.session,
        },
      )
      .exec();

    const newVersion = updated?.version ?? 1;
    this.logger.debug(`Bumping global CMS revision to ${newVersion}`);
    return newVersion;
  }
}
