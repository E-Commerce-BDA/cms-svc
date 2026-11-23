import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { mediaKeySchema, type ResizeImageJob } from '@ecom/contracts';
import { MediaResizeService } from './media-resize.service.js';

const MEDIA_ID = '0190a1b2c3d47e5f8a9b0c1d2e3f4a5b';
const SOURCE_KEY = `media/2026/11/${MEDIA_ID}.png`;
const IDEMPOTENCY_KEY = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

const job: ResizeImageJob = {
  mediaId: MEDIA_ID,
  sourceKey: SOURCE_KEY,
  formats: ['webp', 'jpeg'],
  widths: [320, 640],
};

async function sourcePng(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
}

function build(existing: Record<string, unknown> | null, source: Buffer) {
  const doc = existing
    ? { _id: 'row-1', key: SOURCE_KEY, ...existing }
    : null;

  const model = {
    findOne: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(doc) }),
    updateOne: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({}) }),
  };

  const storage = {
    read: vi.fn().mockResolvedValue(source),
    save: vi
      .fn()
      .mockImplementation(async (_bytes: Buffer, key: string) => ({
        key,
        url: `/api/v1/cms/media/file/${key}`,
      })),
    delete: vi.fn(),
    exists: vi.fn(),
    resolvePath: vi.fn(),
  };

  const service = new MediaResizeService(model as never, storage);
  return { service, model, storage };
}

describe('MediaResizeService', () => {
  it('writes one variant per width and format, plus the original dimensions', async () => {
    const { service, model, storage } = build(
      { key: SOURCE_KEY },
      await sourcePng(),
    );

    const result = await service.resize(job, IDEMPOTENCY_KEY);

    expect(result).toMatchObject({ width: 800, height: 600, written: 4, skipped: 0 });
    expect(storage.read).toHaveBeenCalledWith(SOURCE_KEY);

    const [, update] = model.updateOne.mock.calls[0] as [
      unknown,
      { $set: { variants: { width: number; format: string; key: string; url: string; bytes: number }[]; width: number; height: number } },
    ];
    const variants = update.$set.variants;
    expect(variants).toHaveLength(4);
    expect(update.$set.width).toBe(800);
    expect(update.$set.height).toBe(600);
    expect(variants.map((v) => `${v.width}:${v.format}`)).toEqual([
      '320:webp',
      '320:jpeg',
      '640:webp',
      '640:jpeg',
    ]);
    // `jpeg` is stored with the three-letter extension the key pattern allows,
    // and every key stays servable through the delivery routes.
    expect(variants[1]?.key).toBe(`media/2026/11/${MEDIA_ID}-320.jpg`);
    for (const variant of variants) {
      expect(mediaKeySchema.safeParse(variant.key).success).toBe(true);
      expect(variant.bytes).toBeGreaterThan(0);
      expect(variant.url).toContain('/api/v1/cms/media/file/');
    }
  });

  it('drops widths above the source instead of upscaling', async () => {
    const { service, model } = build({ key: SOURCE_KEY }, await sourcePng(800, 600));

    const result = await service.resize(
      { ...job, widths: [640, 1920] },
      IDEMPOTENCY_KEY,
    );

    expect(result).toMatchObject({ written: 2, skipped: 0 });
    const [, update] = model.updateOne.mock.calls[0] as [
      unknown,
      { $set: { variants: { width: number }[] } },
    ];
    expect(update.$set.variants.map((v) => v.width)).toEqual([640, 640]);
  });

  it('makes nothing on replay: an existing variant of the same width and format is reused', async () => {
    const source = await sourcePng();
    const { service, storage } = build(
      {
        key: SOURCE_KEY,
        width: 800,
        height: 600,
        variants: [
          {
            width: 320,
            format: 'webp',
            key: `media/2026/11/${MEDIA_ID}-320.webp`,
            url: `/api/v1/cms/media/file/media/2026/11/${MEDIA_ID}-320.webp`,
            bytes: 100,
          },
          {
            width: 320,
            format: 'jpeg',
            key: `media/2026/11/${MEDIA_ID}-320.jpg`,
            url: `/api/v1/cms/media/file/media/2026/11/${MEDIA_ID}-320.jpg`,
            bytes: 100,
          },
          {
            width: 640,
            format: 'webp',
            key: `media/2026/11/${MEDIA_ID}-640.webp`,
            url: `/api/v1/cms/media/file/media/2026/11/${MEDIA_ID}-640.webp`,
            bytes: 100,
          },
          {
            width: 640,
            format: 'jpeg',
            key: `media/2026/11/${MEDIA_ID}-640.jpg`,
            url: `/api/v1/cms/media/file/media/2026/11/${MEDIA_ID}-640.jpg`,
            bytes: 100,
          },
        ],
      },
      source,
    );

    const result = await service.resize(job, IDEMPOTENCY_KEY);

    expect(result).toMatchObject({ written: 0, skipped: 4 });
    // The bytes are still read: the manifest is verified against the stored
    // original, and the document is rewritten with identical values.
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('is a no-op when the media row is already gone', async () => {
    const { service, storage, model } = build(null, await sourcePng());

    const result = await service.resize(job, IDEMPOTENCY_KEY);

    expect(result).toMatchObject({ written: 0, skipped: 0, mediaNotFound: true });
    expect(storage.read).not.toHaveBeenCalled();
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('propagates a storage failure so the message is redelivered', async () => {
    const { service, storage } = build({ key: SOURCE_KEY }, await sourcePng());
    storage.read.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(service.resize(job, IDEMPOTENCY_KEY)).rejects.toThrow('EACCES');
  });
});
