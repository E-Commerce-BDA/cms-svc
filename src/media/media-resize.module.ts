import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { ResizeImageJob } from '@ecom/contracts';
import type { TaskHandler } from '@ecom/messaging';
import { MediaResizeService } from './media-resize.service.js';
import { MediaModel, MediaSchema } from './media.schema.js';
import { LocalDiskStorageAdapter } from './storage/local-disk.storage.js';
import { STORAGE_PORT_TOKEN } from './storage/storage.port.js';

/**
 * The job, published as a token rather than passed as a value.
 *
 * `createSqsTaskModule` is a dynamic module and cannot see the providers of the
 * module that imports it, so the handler — which needs the media model and the
 * storage port — is exported here and imported there. Everything the resize
 * pipeline needs lives in this module, and `MediaModule` reuses it.
 */
export const MEDIA_RESIZE_HANDLER = Symbol('MEDIA_RESIZE_HANDLER');

@Module({
  imports: [
    MongooseModule.forFeature([{ name: MediaModel.name, schema: MediaSchema }]),
  ],
  providers: [
    {
      provide: STORAGE_PORT_TOKEN,
      useClass: LocalDiskStorageAdapter,
    },
    MediaResizeService,
    {
      provide: MEDIA_RESIZE_HANDLER,
      inject: [MediaResizeService],
      useFactory:
        (service: MediaResizeService): TaskHandler<ResizeImageJob> =>
        async (job, delivery) => {
          // Resolving deletes the message; the service is idempotent on replay,
          // so a redelivery after a crash is safe.
          await service.resize(job, delivery.message.idempotencyKey);
        },
    },
  ],
  exports: [MediaResizeService, MEDIA_RESIZE_HANDLER, STORAGE_PORT_TOKEN, MongooseModule],
})
export class MediaResizeModule {}
