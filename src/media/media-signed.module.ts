import { Module } from '@nestjs/common';
import { MediaModule } from './media.module.js';
import { MediaSignedController } from './media-signed.controller.js';
import { MediaSignedUrlService } from './media-signed-url.js';

/**
 * Signed delivery is a thin seam over `MediaModule`: it adds an issuing route
 * and a redeeming route, but both ask `MediaService` for the bytes so the one
 * containment resolver stays the only way to the disk.
 */
@Module({
  imports: [MediaModule],
  controllers: [MediaSignedController],
  providers: [MediaSignedUrlService],
  exports: [MediaSignedUrlService],
})
export class MediaSignedModule {}
