import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const PREVIEW_DEFAULT_TTL_SECONDS = 300;
export const PREVIEW_MAX_TTL_SECONDS = 3600;

const SIGNING_CONTEXT = 'cms-preview-token:v1';
const TOKEN_VERSION = 'v1';
const SIGNATURE_BYTES = 32;

export interface IssuedPreviewToken {
  token: string;
  expiresAt: string;
}

export interface PreviewStats {
  issued: number;
  accepted: number;
  rejected: number;
}

/**
 * Read-only preview capability for public CMS reads.
 *
 * The token carries only a version and an expiry; the HMAC over both is what
 * makes it unguessable. It grants no write authority — the issuing endpoint is
 * admin-only and the redeeming routes only relax their read filters. The auth
 * secret is used through a domain-separated subkey, as for media URLs, so a
 * preview token cannot be replayed as an access token or a media signature.
 */
@Injectable()
export class PreviewTokenService {
  private readonly signingKey: Buffer;
  private readonly counter: PreviewStats = {
    issued: 0,
    accepted: 0,
    rejected: 0,
  };

  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is required to sign preview tokens');
    }
    this.signingKey = createHmac('sha256', secret)
      .update(SIGNING_CONTEXT)
      .digest();
  }

  issue(expiresIn?: string): IssuedPreviewToken {
    const ttl = this.parseTtl(expiresIn);
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttl;
    this.counter.issued += 1;
    return {
      token: `${TOKEN_VERSION}.${expiresAtSeconds}.${this.sign(expiresAtSeconds)}`,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  verify(token: string | undefined): boolean {
    if (!token) {
      return false;
    }
    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      parts[0] !== TOKEN_VERSION ||
      !/^\d+$/.test(parts[1]) ||
      !/^[0-9a-f]{64}$/.test(parts[2])
    ) {
      this.counter.rejected += 1;
      return false;
    }

    const expiresAtSeconds = Number(parts[1]);
    if (
      !Number.isSafeInteger(expiresAtSeconds) ||
      expiresAtSeconds <= Math.floor(Date.now() / 1000)
    ) {
      this.counter.rejected += 1;
      return false;
    }

    const expected = Buffer.from(this.sign(expiresAtSeconds), 'hex');
    const supplied = Buffer.from(parts[2], 'hex');
    const valid =
      expected.length === SIGNATURE_BYTES &&
      expected.length === supplied.length &&
      timingSafeEqual(expected, supplied);
    if (valid) {
      this.counter.accepted += 1;
    } else {
      this.counter.rejected += 1;
    }
    return valid;
  }

  /** A copy, so a reader cannot mutate the live counters. */
  stats(): PreviewStats {
    return { ...this.counter };
  }

  private parseTtl(raw: string | undefined): number {
    if (raw === undefined || raw === '') {
      return PREVIEW_DEFAULT_TTL_SECONDS;
    }
    const ttl = Number(raw);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'expiresIn must be a positive number of seconds',
      });
    }
    return Math.min(Math.trunc(ttl), PREVIEW_MAX_TTL_SECONDS);
  }

  private sign(expiresAtSeconds: number): string {
    return createHmac('sha256', this.signingKey)
      .update(`${SIGNING_CONTEXT}\n${expiresAtSeconds}`)
      .digest('hex');
  }
}
