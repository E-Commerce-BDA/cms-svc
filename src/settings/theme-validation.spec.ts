import { BadRequestException } from '@nestjs/common';
import { themeSettingsSchema } from '@ecom/contracts';
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from '../common/pipes/zod-validation/zod-validation.pipe.js';

/**
 * contracts 2.2.0 adds nested paint groups to the same admin body. The pipe is
 * the boundary, so these cases pin both directions: old bodies still load, new
 * bodies keep their nesting, and malformed nested keys do not slip through.
 */
describe('global theme request validation', () => {
  const pipe = new ZodValidationPipe(themeSettingsSchema);

  it('accepts nested palette and component groups without flattening', () => {
    const body = {
      palette: {
        brand: { brand: '#123456' },
        scrim: { panel: 'rgba(0,0,0,0.5)' },
      },
      navbar: { height: 72 },
      filterRail: { gap: 12 },
      drawer: { motion: 'slide' },
      marquee: { pauseOnHover: true },
      grid: { gap: 16 },
      productCard: { ctaBg: '#000000' },
    };

    expect(pipe.transform(body)).toEqual(body);
  });

  it('still accepts a 1.x/2.1 theme body', () => {
    const body = {
      button: { defaultVariant: 'primary', borderRadius: 12, bg: '#0077b6' },
    };

    expect(pipe.transform(body)).toEqual(body);
  });

  it('rejects an unknown key inside a nested palette group', () => {
    expect(() =>
      pipe.transform({ palette: { brand: { brand: '#123456', accent: '#fff' } } }),
    ).toThrow(BadRequestException);

    try {
      pipe.transform({ palette: { brand: { accent: '#fff' } } });
      expect.unreachable('an unknown nested key must fail validation');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        details: { field: string; message: string }[];
      };
      expect(response.code).toBe('VALIDATION_FAILED');
      // Zod anchors an unrecognized key at its containing object.
      expect(response.details[0].field).toBe('palette.brand');
      expect(response.details[0].message).toContain('accent');
    }
  });

  it('rejects an out-of-range nested number instead of rewriting it', () => {
    expect(() => pipe.transform({ grid: { gap: -1 } })).toThrow(
      BadRequestException,
    );
  });
});
