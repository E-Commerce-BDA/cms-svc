import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import sharp from 'sharp';
import type { ResizeImageJob } from '@ecom/contracts';
import {
  MediaModel,
  type MediaDocument,
  type MediaVariant,
} from './media.schema.js';
import { STORAGE_PORT_TOKEN, type StoragePort } from './storage/storage.port.js';

type VariantFormat = MediaVariant['format'];

const MIME_BY_FORMAT: Record<VariantFormat, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const EXTENSION_BY_FORMAT: Record<VariantFormat, string> = {
  webp: 'webp',
  avif: 'avif',
  jpeg: 'jpg',
  png: 'png',
};

export interface MediaResizeResult {
  mediaId: string;
  width?: number;
  height?: number;
  written: number;
  skipped: number;
  /** True when the row was gone: a deleted upload needs no renditions. */
  mediaNotFound?: boolean;
}

/**
 * Turns one uploaded original into its rendition manifest.
 *
 * Two rules make a re-delivery free:
 *
 * 1. **A variant that already exists is not made again.** The rendered key is a
 *    pure function of the original key plus width and format, so the manifest
 *    on the document is enough to decide — no bookkeeping table.
 * 2. **The manifest is written with one `$set`.** A crash mid-run leaves the
 *    document untouched rather than half-populated, and the retry starts over
 *    from the same place.
 *
 * Origins are never upscaled: a 1920 px rendition of a 1200 px original is a
 * bigger file that looks worse, so widths at or above the source are dropped.
 */
@Injectable()
export class MediaResizeService {
  private readonly logger = new Logger(MediaResizeService.name);

  constructor(
    @InjectModel(MediaModel.name)
    private readonly mediaModel: Model<MediaDocument>,
    @Inject(STORAGE_PORT_TOKEN)
    private readonly storage: StoragePort,
  ) {}

  async resize(job: ResizeImageJob, idempotencyKey: string): Promise<MediaResizeResult> {
    const media = await this.findMedia(job.mediaId, job.sourceKey);
    if (!media) {
      // The upload was deleted between the enqueue and this delivery. Retrying
      // cannot bring the row back, so this is a no-op rather than a failure.
      this.logger.warn(
        `Media ${job.mediaId} (${idempotencyKey}) no longer exists; nothing to resize`,
      );
      return {
        mediaId: job.mediaId,
        written: 0,
        skipped: 0,
        mediaNotFound: true,
      };
    }

    // A missing original throws: it is either a write that is still landing or
    // a storage fault, and both are worth the redelivery.
    const original = await this.storage.read(media.key);
    const metadata = await sharp(original).metadata();
    const sourceWidth = metadata.width ?? 0;
    const sourceHeight = metadata.height ?? 0;

    const existing = new Map(
      (media.variants ?? []).map((variant) => [
        `${variant.width}:${variant.format}`,
        variant,
      ]),
    );

    const rendered: MediaVariant[] = [];
    let written = 0;
    let skipped = 0;

    for (const width of job.widths) {
      if (sourceWidth > 0 && width > sourceWidth) {
        continue;
      }

      for (const format of job.formats as VariantFormat[]) {
        const variantKey = this.variantKey(media.key, width, format);
        const done = existing.get(`${width}:${format}`);

        if (done?.key === variantKey) {
          rendered.push(done);
          skipped += 1;
          continue;
        }

        const bytes = await sharp(original)
          .resize({ width, withoutEnlargement: true })
          .toFormat(format)
          .toBuffer();

        const saved = await this.storage.save(
          bytes,
          variantKey,
          MIME_BY_FORMAT[format],
        );

        rendered.push({
          width,
          format,
          key: saved.key,
          url: saved.url,
          bytes: bytes.length,
        });
        written += 1;
      }
    }

    // One write, after every rendition exists: a partial manifest is never
    // visible, and a redelivery recomputes the same values.
    await this.mediaModel
      .updateOne(
        { _id: media._id },
        {
          $set: {
            variants: rendered,
            ...(sourceWidth > 0 ? { width: sourceWidth } : {}),
            ...(sourceHeight > 0 ? { height: sourceHeight } : {}),
          },
        },
      )
      .exec();

    this.logger.log(
      `Resized media ${job.mediaId} to ${sourceWidth}x${sourceHeight}: ` +
        `${written} written, ${skipped} skipped`,
    );

    return {
      mediaId: job.mediaId,
      width: sourceWidth || undefined,
      height: sourceHeight || undefined,
      written,
      skipped,
    };
  }

  private async findMedia(mediaId: string, sourceKey: string) {
    const filter = Types.ObjectId.isValid(mediaId)
      ? { $or: [{ _id: new Types.ObjectId(mediaId) }, { key: sourceKey }] }
      : { key: sourceKey };

    return this.mediaModel.findOne(filter).exec();
  }

  /**
   * `media/2026/11/<uuid>-<width>.<ext>`.
   *
   * The suffix stays inside `mediaKeySchema`, which is what lets the delivery
   * routes serve a variant through the same storage adapter as the original.
   */
  private variantKey(key: string, width: number, format: VariantFormat): string {
    const base = key.replace(/\.[^.]+$/, '');
    return `${base}-${width}.${EXTENSION_BY_FORMAT[format]}`;
  }
}
