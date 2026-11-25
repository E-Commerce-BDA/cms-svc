import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MediaSignedUrlService,
  SIGNED_MEDIA_DEFAULT_TTL_SECONDS,
  SIGNED_MEDIA_MAX_TTL_SECONDS,
} from './media-signed-url.js';

const SECRET = 'a-test-secret-at-least-32-characters-long';
const OTHER_SECRET = 'a-different-secret-at-least-32-characters';
const KEY = 'media/2026/11/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.png';

function service(secret = SECRET): MediaSignedUrlService {
  return new MediaSignedUrlService({
    get: (name: string) => (name === 'JWT_SECRET' ? secret : undefined),
  } as never);
}

function parts(url: string): { exp: string; sig: string } {
  const parsed = new URL(url, 'http://localhost');
  return {
    exp: parsed.searchParams.get('exp') ?? '',
    sig: parsed.searchParams.get('sig') ?? '',
  };
}

describe('MediaSignedUrlService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses to sign without a server secret', () => {
    expect(() => service('')).toThrow(/JWT_SECRET is required/);
  });

  it('issues a URL that carries an expiry and a 64-hex-character signature only', () => {
    const issued = service().issue(KEY);
    const { exp, sig } = parts(issued.url);

    expect(issued.url).toContain(`/api/v1/cms/media/signed/${KEY}?`);
    expect(exp).toMatch(/^\d+$/);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.url).not.toContain(SECRET);
    expect(issued.expiresAt).toBe(new Date(Number(exp) * 1000).toISOString());
  });

  it('accepts an untouched URL and rejects it once the clock passes exp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T00:00:00.000Z'));
    const signer = service();
    const issued = signer.issue(KEY, '60');
    const { exp, sig } = parts(issued.url);

    expect(signer.verify(KEY, exp, sig)).toBe(true);

    vi.setSystemTime(new Date(Number(exp) * 1000 + 1000));
    expect(signer.verify(KEY, exp, sig)).toBe(false);
  });

  it('rejects a changed key, expiry or signature', () => {
    const signer = service();
    const issued = signer.issue(KEY);
    const { exp, sig } = parts(issued.url);

    expect(signer.verify(`${KEY}.png`, exp, sig)).toBe(false);
    expect(signer.verify(KEY, String(Number(exp) + 1), sig)).toBe(false);
    expect(signer.verify(KEY, exp, `${sig.slice(0, 63)}0`)).toBe(false);
  });

  it('rejects a signature minted with a different secret', () => {
    const issued = service(SECRET).issue(KEY);
    const { exp, sig } = parts(issued.url);

    expect(service(OTHER_SECRET).verify(KEY, exp, sig)).toBe(false);
  });

  it.each([
    ['missing', undefined, undefined],
    ['non-numeric expiry', 'soon', 'a'.repeat(64)],
    ['short signature', '4102444800', 'abc'],
    ['overflowing expiry', '999999999999999999999999', 'a'.repeat(64)],
  ])('rejects a %s query', (_label, exp, sig) => {
    expect(service().verify(KEY, exp, sig)).toBe(false);
  });

  it('defaults to five minutes and caps an over-long request at an hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T00:00:00.000Z'));
    const signer = service();
    const now = Math.floor(Date.now() / 1000);

    expect(Number(parts(signer.issue(KEY).url).exp) - now).toBe(
      SIGNED_MEDIA_DEFAULT_TTL_SECONDS,
    );
    expect(Number(parts(signer.issue(KEY, '99999').url).exp) - now).toBe(
      SIGNED_MEDIA_MAX_TTL_SECONDS,
    );
  });

  it.each(['0', '-1', 'soon'])(
    'refuses a nonsensical expiresIn value %s',
    (raw) => {
      expect(() => service().issue(KEY, raw)).toThrow(BadRequestException);
    },
  );
});
