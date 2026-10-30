import { type ExecutionContext, PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_MULTIPART_OVERHEAD_BYTES,
} from '../media.service.js';
import { UploadSizeGuard } from './upload-size.guard.js';

function contextWithContentLength(
  value: string | number | undefined,
): ExecutionContext {
  const headers: Record<string, string> = {};
  if (value !== undefined) {
    headers['content-length'] = String(value);
  }

  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('UploadSizeGuard', () => {
  const guard = new UploadSizeGuard();
  const ceiling = MAX_FILE_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

  it('passes when the client sends no Content-Length (chunked upload)', () => {
    expect(guard.canActivate(contextWithContentLength(undefined))).toBe(true);
  });

  it('passes at the file limit plus multipart overhead', () => {
    expect(guard.canActivate(contextWithContentLength(ceiling))).toBe(true);
  });

  it('rejects one byte over the ceiling with 413 MEDIA_TOO_LARGE', () => {
    let thrown: unknown;
    try {
      guard.canActivate(contextWithContentLength(ceiling + 1));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PayloadTooLargeException);
    expect((thrown as PayloadTooLargeException).getStatus()).toBe(413);
    expect((thrown as PayloadTooLargeException).getResponse()).toMatchObject({
      code: 'MEDIA_TOO_LARGE',
      message: 'File exceeds maximum allowed size of 10 MB',
    });
  });

  it('passes a non-numeric header so multer decides', () => {
    expect(guard.canActivate(contextWithContentLength('abc'))).toBe(true);
  });

  it('passes an empty header', () => {
    expect(guard.canActivate(contextWithContentLength(''))).toBe(true);
  });
});
