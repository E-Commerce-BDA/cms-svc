import type { MediaMimeType } from '@ecom/contracts';

/**
 * Magic-byte sniffing for the four allowed image types.
 *
 * The multipart `Content-Type` header is attacker-controlled, so the bytes are
 * the only trustworthy statement about what an upload is. A format we cannot
 * recognise returns `null`; the caller decides whether that is "unsupported"
 * or a mismatch against the declared type.
 */

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** ISO/IEC 14496-12 box brand of the AVIF image sequence and still formats. */
const AVIF_BRANDS = ['avif', 'avis'];

function asciiAt(buffer: Buffer, offset: number, length: number): string {
  return buffer.toString('latin1', offset, offset + length);
}

export function sniffImageMimeType(buffer: Buffer): MediaMimeType | null {
  if (buffer.length >= PNG_SIGNATURE.length) {
    if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return 'image/png';
    }
  }

  if (buffer.length >= JPEG_SIGNATURE.length) {
    if (
      buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
    ) {
      return 'image/jpeg';
    }
  }

  // RIFF container: 'RIFF' + 4-byte size + 'WEBP'.
  if (
    buffer.length >= 12 &&
    asciiAt(buffer, 0, 4) === 'RIFF' &&
    asciiAt(buffer, 8, 4) === 'WEBP'
  ) {
    return 'image/webp';
  }

  // ISO-BMFF: 4-byte box size + 'ftyp' + major brand. `heic`/`mif1` land here
  // and must not be mistaken for AVIF.
  if (buffer.length >= 12 && asciiAt(buffer, 4, 4) === 'ftyp') {
    if (AVIF_BRANDS.includes(asciiAt(buffer, 8, 4))) {
      return 'image/avif';
    }
  }

  return null;
}
