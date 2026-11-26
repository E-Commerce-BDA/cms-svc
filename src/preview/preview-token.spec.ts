import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_DEFAULT_TTL_SECONDS,
  PREVIEW_MAX_TTL_SECONDS,
  PreviewTokenService,
} from './preview-token.js';

const SECRET = 'a-test-secret-at-least-32-characters-long';
const OTHER_SECRET = 'a-different-secret-at-least-32-characters';

function service(secret = SECRET): PreviewTokenService {
  return new PreviewTokenService({
    get: (name: string) => (name === 'JWT_SECRET' ? secret : undefined),
  } as never);
}

describe('PreviewTokenService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses to issue without a server secret', () => {
    expect(() => service('')).toThrow(/JWT_SECRET is required/);
  });

  it('issues v1.<exp>.<64-hex-sig> and never includes the secret', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T00:00:00.000Z'));
    const issued = service().issue();
    const [version, exp, sig] = issued.token.split('.');

    expect(version).toBe('v1');
    expect(exp).toBe(
      String(Math.floor(Date.now() / 1000) + PREVIEW_DEFAULT_TTL_SECONDS),
    );
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.token).not.toContain(SECRET);
    expect(issued.expiresAt).toBe(new Date(Number(exp) * 1000).toISOString());
  });

  it('accepts an untouched token and rejects it once the clock passes exp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T00:00:00.000Z'));
    const signer = service();
    const { token } = signer.issue('60');
    expect(signer.verify(token)).toBe(true);

    vi.setSystemTime(new Date(Date.now() + 61_000));
    expect(signer.verify(token)).toBe(false);
  });

  it('rejects tampering, a wrong secret and a different signing context', () => {
    const signer = service();
    const { token } = signer.issue('60');
    const [version, exp, sig] = token.split('.');

    expect(service(OTHER_SECRET).verify(token)).toBe(false);
    expect(signer.verify(`${version}.${Number(exp) + 1}.${sig}`)).toBe(false);
    expect(signer.verify(`${version}.${exp}.${`${sig.slice(0, 63)}0`}`)).toBe(
      false,
    );
    expect(signer.verify(`v2.${exp}.${sig}`)).toBe(false);
  });

  it.each([
    'not-a-token',
    'v1.soon.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'v1.4102444800.abc',
    'v1.999999999999999999999999.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ])('rejects the malformed token %s', (token) => {
    expect(service().verify(token)).toBe(false);
  });

  it('caps an over-long request and refuses a nonsensical one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T00:00:00.000Z'));
    const signer = service();
    const now = Math.floor(Date.now() / 1000);

    const capped = signer.issue('99999').token.split('.')[1];
    expect(Number(capped) - now).toBe(PREVIEW_MAX_TTL_SECONDS);
    expect(() => signer.issue('0')).toThrow(BadRequestException);
    expect(() => signer.issue('-1')).toThrow(BadRequestException);
    expect(() => signer.issue('soon')).toThrow(BadRequestException);
  });

  it('counts issue/accept/reject without exposing the live counters', () => {
    const signer = service();
    const { token } = signer.issue();
    signer.verify(token);
    signer.verify('bad');

    expect(signer.stats()).toEqual({ issued: 1, accepted: 1, rejected: 1 });
    const stats = signer.stats();
    stats.accepted = 99;
    expect(signer.stats().accepted).toBe(1);
  });
});
