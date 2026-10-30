import { describe, expect, it } from 'vitest';
import { sniffImageMimeType } from './media-signature.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

/** ISO-BMFF header: 4-byte box size, `ftyp`, major brand, minor version. */
function isoBmff(majorBrand: string): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16, 0);
  header.write('ftyp', 4, 'latin1');
  header.write(majorBrand, 8, 'latin1');
  header.writeUInt32BE(0, 12);
  return header;
}

describe('sniffImageMimeType', () => {
  it('accepts the 8-byte PNG signature', () => {
    expect(sniffImageMimeType(PNG_BYTES)).toBe('image/png');
  });

  it('accepts a JPEG start-of-image marker', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(sniffImageMimeType(jpeg)).toBe('image/jpeg');
  });

  it('accepts a RIFF/WEBP container', () => {
    const webp = Buffer.alloc(16);
    webp.write('RIFF', 0, 'latin1');
    webp.writeUInt32LE(8, 4);
    webp.write('WEBP', 8, 'latin1');
    expect(sniffImageMimeType(webp)).toBe('image/webp');
  });

  it('accepts an AVIF still and an AVIF sequence brand', () => {
    expect(sniffImageMimeType(isoBmff('avif'))).toBe('image/avif');
    expect(sniffImageMimeType(isoBmff('avis'))).toBe('image/avif');
  });

  it('rejects text, an empty buffer, and a truncated PNG', () => {
    expect(sniffImageMimeType(Buffer.from('this is not an image'))).toBeNull();
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageMimeType(PNG_BYTES.subarray(0, 7))).toBeNull();
  });

  it('rejects a RIFF container that is not WebP', () => {
    const wav = Buffer.alloc(16);
    wav.write('RIFF', 0, 'latin1');
    wav.write('WAVE', 8, 'latin1');
    expect(sniffImageMimeType(wav)).toBeNull();
  });

  it('rejects a HEIC brand rather than calling it AVIF', () => {
    expect(sniffImageMimeType(isoBmff('heic'))).toBeNull();
    expect(sniffImageMimeType(isoBmff('mif1'))).toBeNull();
  });
});
