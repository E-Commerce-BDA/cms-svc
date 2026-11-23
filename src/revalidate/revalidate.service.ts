import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The storefront tags cms-svc is allowed to send.
 *
 * This list is not free-form: `frontend/storefront/lib/cms/tags.ts` owns the
 * same vocabulary and answers `400 INVALID_TAGS` for anything outside its
 * allowlist (page keys are `[a-z0-9-]{1,80}`). The two lists are authored
 * together on purpose — a tag cms-svc invents would be rejected silently.
 */
export const storefrontTags = {
  globalSettings: 'cms:global-settings',
  navigation: 'cms:navigation',
  pageSettings: (pageKey: string): string => `cms:page-settings:${pageKey}`,
  // cms-008: the CMS-home wave gave the storefront readers for sections, the
  // footer document, the blog list and CMS pages. Each page key and slug maps
  // to exactly one tag string; the storefront's `lib/cms/tags.ts` allowlist is
  // authored against these same shapes (`[a-z0-9-]{1,80}`).
  sections: (pageKey: string): string => `cms:sections:${pageKey}`,
  footer: 'cms:footer',
  blogs: 'cms:blogs',
  pages: (slug: string): string => `cms:pages:${slug}`,
} as const;

export const REVALIDATE_TIMEOUT_MS = 2000;

export interface RevalidateStats {
  sent: number;
  /** Calls that failed, timed out or were rejected. */
  failed: number;
  /** Calls skipped because no secret is configured. */
  disabled: number;
}

/**
 * Tells the storefront that a piece of content changed (`cms-007`).
 *
 * The direction is the unusual part: an HTTP call *out of* a mutation, because
 * the storefront owns its Next Data Cache and only it can invalidate a tag.
 *
 * Two rules keep this from being a liability:
 *
 * 1. **Best-effort.** A failed invalidation costs staleness until the next
 *    publish or TTL expiry; it must never fail a write that already committed.
 *    Hence one warn line and a counter, never a throw.
 * 2. **Off when there is no secret.** Without `REVALIDATE_SECRET` the service
 *    does nothing at all — a development stack with no storefront running stays
 *    quiet instead of logging a connection error on every publish. Production
 *    refuses to boot without the variable (`env.validation.ts`), so "off"
 *    cannot happen there by accident.
 */
@Injectable()
export class RevalidateService {
  private readonly logger = new Logger(RevalidateService.name);
  private readonly baseUrl: string;
  private readonly secret: string | undefined;
  private readonly counter: RevalidateStats = { sent: 0, failed: 0, disabled: 0 };

  constructor(config: ConfigService) {
    this.baseUrl = (
      config.get<string>('STOREFRONT_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    this.secret = config.get<string>('REVALIDATE_SECRET')?.trim() || undefined;
  }

  /** False when no secret is configured; every call is then a no-op. */
  get enabled(): boolean {
    return this.secret !== undefined;
  }

  /** Resolves even when the storefront is down. Never throws. */
  async revalidate(tags: string[]): Promise<void> {
    if (!this.enabled) {
      this.counter.disabled += 1;
      this.logger.debug(
        `REVALIDATE_SECRET is not set; skipping ${tags.join(', ')}`,
      );
      return;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/revalidate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': this.secret as string,
        },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`the storefront answered ${response.status}`);
      }

      this.counter.sent += 1;
      this.logger.log(`Storefront revalidated ${tags.join(', ')}`);
    } catch (error) {
      this.counter.failed += 1;
      this.logger.warn(
        `Could not revalidate ${tags.join(', ')} on ${this.baseUrl}: ` +
          `${(error as Error).message}. Cached pages stay stale until the next ` +
          `publish or until their TTL expires.`,
      );
    }
  }

  /** A copy, so a reader cannot mutate the live counters. */
  snapshot(): RevalidateStats {
    return { ...this.counter };
  }
}
