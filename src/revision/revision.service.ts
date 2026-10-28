import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
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

  async bumpVersion(): Promise<number> {
    const updated = await this.metaModel
      .findByIdAndUpdate(
        'revision',
        {
          $inc: { version: 1 },
          $set: { updatedAt: new Date() },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
      .exec();

    const newVersion = updated?.version ?? 1;
    this.logger.debug(`Bumping global CMS revision to ${newVersion}`);
    return newVersion;
  }
}
