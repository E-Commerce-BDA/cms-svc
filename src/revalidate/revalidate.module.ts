import { Global, Module } from '@nestjs/common';
import { RevalidateService } from './revalidate.service.js';

/**
 * Global for the same reason `CacheModule` is: every content mutation that the
 * storefront reads invalidates a tag, and threading a one-provider module
 * through five feature modules adds noise without adding a boundary.
 */
@Global()
@Module({
  providers: [RevalidateService],
  exports: [RevalidateService],
})
export class RevalidateModule {}
