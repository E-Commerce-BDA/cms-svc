import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const SIGNED_MEDIA_DEFAULT_TTL_SECONDS = 300;
export const SIGNED_MEDIA_MAX_TTL_SECONDS = 3600;

const SIGNING_CONTEXT = 'cms-media-signed-url:v1';
const SIGNATURE_HEX_LENGTH = 64;

export interface SignedMediaUrl {
  url: string;
  /** ISO-8601 copy of `exp` for callers that do not parse the query string. */
  expiresAt: string;
}

/**
 * Time-limited capability URLs for media rows.
 *
 * The URL carries only the storage key and an expiry; the HMAC over both is
 * what makes it unguessable. Nothing about the key grants access on its own:
 * the redeem route still resolves the row and the contained path before it
 * sends any bytes, so a signed URL cannot reach a file the issuing route could
 * not have reached.
 *
 * The auth token secret is used through a domain-separated subkey rather than
 * directly, and a fresh dedicated secret was rejected: it would add a fourth
 * deployment variable for a capability that already has a strong server secret.
 */
@Injectable()
export class MediaSignedUrlService {
  private readonly signingKey: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is required to sign media URLs');
    }
    // Never reuse the token key as an HMAC key verbatim: a token and a media
    // capability are different claims even when they share one deployment.
    this.signingKey = createHmac('sha256', secret)
      .update(SIGNING_CONTEXT)
      .digest();
  }

  issue(key: string, expiresIn?: string): SignedMediaUrl {
    const ttl = this.parseTtl(expiresIn);
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttl;
    const signature = this.sign(key, expiresAtSeconds);

    return {
      url: `/api/v1/cms/media/signed/${key}?exp=${expiresAtSeconds}&sig=${signature}`,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  verify(
    key: string,
    expiresAt: string | undefined,
    signature: string | undefined,
  ): boolean {
    if (!expiresAt || !signature) {
      return false;
    }
    if (!/^\d+$/.test(expiresAt) || !/^[0-9a-f]{64}$/.test(signature)) {
      return false;
    }

    const expiresAtSeconds = Number(expiresAt);
    if (
      !Number.isSafeInteger(expiresAtSeconds) ||
      expiresAtSeconds <= Math.floor(Date.now() / 1000)
    ) {
      return false;
    }

    const expected = Buffer.from(this.sign(key, expiresAtSeconds), 'hex');
    const supplied = Buffer.from(signature, 'hex');
    return (
      expected.length === SIGNATURE_HEX_LENGTH / 2 &&
      expected.length === supplied.length &&
      timingSafeEqual(expected, supplied)
    );
  }

  private parseTtl(raw: string | undefined): number {
    if (raw === undefined || raw === '') {
      return SIGNED_MEDIA_DEFAULT_TTL_SECONDS;
    }
    const ttl = Number(raw);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'expiresIn must be a positive number of seconds',
      });
    }
    return Math.min(Math.trunc(ttl), SIGNED_MEDIA_MAX_TTL_SECONDS);
  }

  private sign(key: string, expiresAtSeconds: number): string {
    return createHmac('sha256', this.signingKey)
      .update(`${SIGNING_CONTEXT}\n${key}\n${expiresAtSeconds}`)
      .digest('hex');
  }
}
