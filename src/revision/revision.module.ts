import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CmsMeta, CmsMetaSchema } from './revision.schema.js';
import { RevisionService } from './revision.service.js';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: CmsMeta.name, schema: CmsMetaSchema }]),
  ],
  providers: [RevisionService],
  exports: [RevisionService],
})
export class RevisionModule {}
