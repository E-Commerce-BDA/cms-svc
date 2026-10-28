import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SectionModel, SectionSchema } from '../sections/section.schema.js';
import { PageModel, PageSchema } from '../pages/page.schema.js';
import { BlogModel, BlogSchema } from '../blogs/blog.schema.js';
import { MediaModel, MediaSchema } from './media.schema.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { LocalDiskStorageAdapter } from './storage/local-disk.storage.js';
import { STORAGE_PORT_TOKEN } from './storage/storage.port.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaModel.name, schema: MediaSchema },
      { name: SectionModel.name, schema: SectionSchema },
      { name: PageModel.name, schema: PageSchema },
      { name: BlogModel.name, schema: BlogSchema },
    ]),
  ],
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: STORAGE_PORT_TOKEN,
      useClass: LocalDiskStorageAdapter,
    },
  ],
  exports: [MediaService, STORAGE_PORT_TOKEN, MongooseModule],
})
export class MediaModule {}
