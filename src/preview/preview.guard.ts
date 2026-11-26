import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PreviewTokenService } from './preview-token.js';

export interface PreviewRequest extends Request {
  preview?: boolean;
}

/**
 * The authorization boundary for draft reads. It never rejects: a missing or
 * invalid token is indistinguishable from a plain public read, so a stale or
 * leaked preview link cannot make a route fail or reveal anything extra.
 *
 * A verified token is per-request state only. Preview reads skip the Redis
 * cache in the services and answer `private, no-store` so a draft cannot be
 * cached as a published page.
 */
@Injectable()
export class PreviewGuard implements CanActivate {
  constructor(private readonly tokens: PreviewTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PreviewRequest>();
    const candidates = [
      typeof request.query?.preview === 'string'
        ? request.query.preview
        : undefined,
      typeof request.headers['x-preview-token'] === 'string'
        ? request.headers['x-preview-token']
        : undefined,
    ].filter((token): token is string => Boolean(token));

    request.preview = candidates.some((token) => this.tokens.verify(token));
    if (request.preview) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Cache-Control', 'private, no-store');
    }
    return true;
  }
}
