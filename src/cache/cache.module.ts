import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { CacheService } from './cache.service.js';

@Global()
@Module({
  imports: [RedisModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
