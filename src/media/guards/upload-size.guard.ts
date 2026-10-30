import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_MULTIPART_OVERHEAD_BYTES,
} from '../media.service.js';

export const MEDIA_TOO_LARGE_MESSAGE =
  'File exceeds maximum allowed size of 10 MB';

/**
 * Rejects an oversized upload from the request headers alone.
 *
 * A guard runs before the route's interceptor, so the multipart body has not
 * been read yet: a 1 GB request costs one header parse, not 1 GB of RAM.
 * `fileSize` in multer's limits stays as the backstop for a chunked request
 * that sends no `Content-Length` — the guard passes those through.
 */
@Injectable()
export class UploadSizeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['content-length'];

    if (typeof header !== 'string' || header.trim() === '') {
      return true;
    }

    const contentLength = Number(header);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return true;
    }

    const ceiling = MAX_FILE_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
    if (contentLength > ceiling) {
      throw new PayloadTooLargeException({
        code: 'MEDIA_TOO_LARGE',
        message: MEDIA_TOO_LARGE_MESSAGE,
      });
    }

    return true;
  }
}
