import * as fs from 'node:fs';
import { Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { StreamableMediaFile } from './media.service.js';

const logger = new Logger('MediaFileDelivery');

/**
 * Serves a file whose existence and containment were already decided by the
 * storage resolver. Shared by the public, admin and signed routes so their
 * headers cannot drift apart.
 *
 * Everything is decided before the first header, so a miss stays a JSON 404.
 */
export async function sendStoredFile(
  res: Response,
  file: StreamableMediaFile,
  cacheControl: string,
): Promise<void> {
  const stat = await fs.promises.stat(file.absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new NotFoundException({
      code: 'MEDIA_NOT_FOUND',
      message: 'File not found',
    });
  }

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Length', stat.size);

  await new Promise<void>((resolve, reject) => {
    res.sendFile(file.absolutePath, (error?: Error) => {
      if (!error) {
        resolve();
        return;
      }
      if (res.headersSent) {
        // The status and the headers are already on the wire; the only
        // honest thing left is to cut the body short.
        logger.error(
          `Media stream failed after the headers were sent: ${error.message}`,
        );
        res.end();
        resolve();
        return;
      }
      reject(error);
    });
  });
}
