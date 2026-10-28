import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  public static readonly DEFAULT_TTL_SECONDS = 300;

  constructor(private readonly redisService: RedisService) {}

  sectionKey(key: string): string {
    return `cms:section:${key}`;
  }

  sectionsPageKey(pageKey: string): string {
    return `cms:sections:${pageKey}`;
  }

  settingsGlobalKey(): string {
    return 'cms:settings:global';
  }

  navigationKey(): string {
    return 'cms:nav';
  }

  pageSettingsKey(pageKey: string): string {
    return `cms:page-settings:${pageKey}`;
  }

  pageSlugKey(slug: string): string {
    return `cms:page:${slug}`;
  }

  blogSlugKey(slug: string): string {
    return `cms:blog:${slug}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redisService.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(`Cache read failed for key ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = CacheService.DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      await this.redisService.set(key, raw, ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed for key ${key}: ${(error as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redisService.del(key);
    } catch (error) {
      this.logger.warn(`Cache delete failed for key ${key}: ${(error as Error).message}`);
    }
  }

  async delKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.del(key);
    }
  }
}
