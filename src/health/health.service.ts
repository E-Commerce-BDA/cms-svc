import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { RedisService } from '../redis/redis.service.js';

type DependencyStatus = 'up' | 'down';

export interface LivenessResponse {
  status: 'ok';
}

export interface ReadinessResponse {
  status: 'ready';
  checks: {
    mongo: 'up';
    redis: DependencyStatus;
  };
}

const MONGO_PING_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Liveness: is this process able to answer HTTP?
   * Performs no external dependency calls.
   */
  checkLiveness(): LivenessResponse {
    return { status: 'ok' };
  }

  /**
   * Readiness: Mongo is critical, Redis is degraded.
   */
  async checkReadiness(): Promise<ReadinessResponse> {
    let mongo: DependencyStatus = 'down';
    let redis: DependencyStatus = 'down';

    try {
      await this.pingMongo();
      mongo = 'up';
    } catch (error) {
      this.logger.error(
        'MongoDB readiness probe failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }

    try {
      redis = (await this.redisService.ping()) ? 'up' : 'down';
    } catch (error) {
      this.logger.error(
        'Redis readiness probe failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }

    if (mongo !== 'up') {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { mongo, redis },
      });
    }

    return {
      status: 'ready',
      checks: { mongo: 'up', redis },
    };
  }

  private async pingMongo(): Promise<void> {
    const db = this.connection.db;
    if (!db) {
      throw new Error('MongoDB connection is not established');
    }

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        db.admin().ping(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('MongoDB ping timed out')),
            MONGO_PING_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
