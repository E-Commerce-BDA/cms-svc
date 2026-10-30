import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request } from 'express';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_MULTIPART_OVERHEAD_BYTES,
} from '../media.service.js';
import { MEDIA_TOO_LARGE_MESSAGE } from '../guards/upload-size.guard.js';

/**
 * How much of an over-limit body we are willing to discard before answering.
 * Browsers that upload "a bit too big" finish inside this window and read a
 * clean 413; something sending a gigabyte is cut off and sees the socket go.
 */
const DRAIN_LIMIT_BYTES =
  4 * (MAX_FILE_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES);

/**
 * Re-labels an upload that hit a size limit as `413 MEDIA_TOO_LARGE`.
 *
 * Nest already turns multer's `LIMIT_FILE_SIZE` into a bare
 * `PayloadTooLargeException` ("File too large"), and `UploadSizeGuard` throws
 * the same class. A route-scoped filter *replaces* the global one for this
 * handler, so this filter hands the re-labelled exception back to
 * `HttpExceptionFilter` rather than re-implementing the error envelope.
 */
@Catch(PayloadTooLargeException)
export class MediaTooLargeFilter implements ExceptionFilter {
  private readonly envelope = new HttpExceptionFilter();

  catch(_exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const tooLarge = new PayloadTooLargeException({
      code: 'MEDIA_TOO_LARGE',
      message: MEDIA_TOO_LARGE_MESSAGE,
    });

    let answered = false;
    const answer = () => {
      if (answered) {
        return;
      }
      answered = true;
      this.envelope.catch(tooLarge, host);
    };

    // Mid-upload there is still a body in flight. Responding now would close
    // the socket under the writer and turn the 413 into an `ECONNRESET`, so
    // the bytes are discarded (`resume()` drops them, it does not buffer
    // them) and the answer waits for the body to end — up to a cap, past which
    // an abusive sender gets the socket closed instead of a payload.
    if (request.complete || request.readableEnded) {
      answer();
      return;
    }

    let discarded = 0;
    request.on('data', (chunk: Buffer) => {
      discarded += chunk.length;
      if (discarded > DRAIN_LIMIT_BYTES) {
        request.pause();
        answer();
      }
    });
    request.once('end', answer);
    request.resume();
  }
}
