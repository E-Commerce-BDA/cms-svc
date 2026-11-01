import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
// `@ecom/messaging/nest/tasks`, not `/nest`: the barrel also re-exports the
// Kafka consumer surface, which would make this service depend on
// `@nestjs/microservices` for a queue it enqueues to. See the same choice in
// `cms-outbox.module.ts`.
import { createSqsTaskModule } from '@ecom/messaging/nest/tasks';
import {
  TASK_QUEUES,
  resizeImageJobSchema,
  type ResizeImageJob,
} from '@ecom/contracts';
import { SectionModel, SectionSchema } from '../sections/section.schema.js';
import { PageModel, PageSchema } from '../pages/page.schema.js';
import { BlogModel, BlogSchema } from '../blogs/blog.schema.js';
import { MediaModel, MediaSchema } from './media.schema.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MediaTasksPublisher } from './media-tasks.publisher.js';
import {
  MEDIA_RESIZE_HANDLER,
  MediaResizeModule,
} from './media-resize.module.js';

/**
 * Uploads are served here; the renditions are made by the worker.
 *
 * `createSqsTaskModule` supplies two things: the producer `MediaTasksPublisher`
 * enqueues through, and the poller that runs `MediaResizeService`. The poller is
 * compiled out when `SQS_TASKS_ENABLED=false` or `NODE_ENV=test`, so a suite
 * without LocalStack still boots, and no suite talks to a broker by accident.
 *
 * `MediaResizeModule` is imported twice on purpose: once for the service and the
 * storage port this module's own code uses, and once *inside* the task module,
 * whose providers can only see what it imports itself.
 */
@Module({
  imports: [
    MediaResizeModule,
    MongooseModule.forFeature([
      { name: MediaModel.name, schema: MediaSchema },
      { name: SectionModel.name, schema: SectionSchema },
      { name: PageModel.name, schema: PageSchema },
      { name: BlogModel.name, schema: BlogSchema },
    ]),
    createSqsTaskModule<ResizeImageJob>({
      queue: TASK_QUEUES.mediaResizeImage,
      payloadSchema: resizeImageJobSchema,
      handlerToken: MEDIA_RESIZE_HANDLER,
      imports: [MediaResizeModule],
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService, MediaTasksPublisher],
  // A provider belongs to the module that declares it, so the storage port is
  // re-exported by re-exporting `MediaResizeModule` rather than by naming the
  // token here — Nest rejects a token that this module does not own.
  exports: [MediaService, MediaResizeModule, MongooseModule],
})
export class MediaModule {}
