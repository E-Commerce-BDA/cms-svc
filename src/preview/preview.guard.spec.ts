import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PreviewGuard } from './preview.guard.js';
import type { PreviewTokenService } from './preview-token.js';

function contextFor(request: Record<string, unknown>): {
  context: ExecutionContext;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: (key: string, value: string) => {
        headers[key] = value;
      } }),
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

function guard(acceptedTokens: string[]): PreviewGuard {
  const tokens = {
    verify: vi.fn((token: string | undefined) =>
      token !== undefined && acceptedTokens.includes(token),
    ),
  } as unknown as PreviewTokenService;
  return new PreviewGuard(tokens);
}

describe('PreviewGuard', () => {
  it('marks a request with a valid query token and answers no-store', () => {
    const request = { query: { preview: 'v1.123.abc' }, headers: {} };
    const { context, headers } = contextFor(request);

    expect(guard(['v1.123.abc']).canActivate(context)).toBe(true);
    expect((request as { preview?: boolean }).preview).toBe(true);
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  it('accepts a valid x-preview-token header as well', () => {
    const request = { query: {}, headers: { 'x-preview-token': 'v1.123.abc' } };
    const { context, headers } = contextFor(request);

    expect(guard(['v1.123.abc']).canActivate(context)).toBe(true);
    expect((request as { preview?: boolean }).preview).toBe(true);
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  it('accepts when either source carries a valid token', () => {
    const request = {
      query: { preview: 'bad' },
      headers: { 'x-preview-token': 'v1.123.abc' },
    };
    const { context } = contextFor(request);
    expect(guard(['v1.123.abc']).canActivate(context)).toBe(true);
    expect((request as { preview?: boolean }).preview).toBe(true);
  });

  it.each([
    ['no token', {}, {}],
    ['invalid query token', { query: { preview: 'bad' } }, {}],
    ['invalid header token', {}, { 'x-preview-token': 'bad' }],
  ])('behaves exactly like a public read with %s', (_label, query, headers) => {
    const request = { query, headers };
    const ctx = contextFor(request);

    expect(guard([]).canActivate(ctx.context)).toBe(true);
    expect((request as { preview?: boolean }).preview).toBe(false);
    expect(ctx.headers['Cache-Control']).toBeUndefined();
  });
});
