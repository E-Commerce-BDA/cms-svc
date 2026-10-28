import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(2),
    age: z.number().int().positive(),
  });

  it('passes valid input through', () => {
    const pipe = new ZodValidationPipe(schema);
    const valid = { name: 'Alice', age: 30 };
    expect(pipe.transform(valid)).toEqual(valid);
  });

  it('throws BadRequestException with VALIDATION_FAILED code on invalid input', () => {
    const pipe = new ZodValidationPipe(schema);
    const invalid = { name: 'A', age: -5 };

    try {
      pipe.transform(invalid);
      expect.fail('should have thrown BadRequestException');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const res = (error as BadRequestException).getResponse() as any;
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.details).toHaveLength(2);
      expect(res.details[0].field).toBe('name');
      expect(res.details[1].field).toBe('age');
    }
  });
});
