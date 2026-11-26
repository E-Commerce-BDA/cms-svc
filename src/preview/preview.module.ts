import { Global, Module } from '@nestjs/common';
import { PreviewController } from './preview.controller.js';
import { PreviewGuard } from './preview.guard.js';
import { PreviewTokenService } from './preview-token.js';

/**
 * Global for the same reason `RevalidateModule` is: public content controllers
 * in four modules use the guard, and threading a one-provider module through
 * all of them would add wiring without adding a boundary. The issued capability
 * is read-only, so no module boundary is lost by sharing it.
 */
@Global()
@Module({
  controllers: [PreviewController],
  providers: [PreviewTokenService, PreviewGuard],
  exports: [PreviewTokenService, PreviewGuard],
})
export class PreviewModule {}
