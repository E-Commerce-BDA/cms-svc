import { describe, expect, it, vi } from 'vitest';
import { RevisionService } from './revision.service.js';

describe('RevisionService', () => {
  it('returns default version 1 when no meta document exists', async () => {
    const metaModel = {
      findById: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      }),
    };
    const service = new RevisionService(metaModel as any);
    const version = await service.getVersion();
    expect(version).toBe(1);
  });

  it('returns stored version when meta document exists', async () => {
    const metaModel = {
      findById: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ version: 7 }),
      }),
    };
    const service = new RevisionService(metaModel as any);
    const version = await service.getVersion();
    expect(version).toBe(7);
  });

  it('increments version atomically on bumpVersion', async () => {
    const metaModel = {
      findByIdAndUpdate: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ version: 8 }),
      }),
    };
    const service = new RevisionService(metaModel as any);
    const bumped = await service.bumpVersion();
    expect(bumped).toBe(8);
    expect(metaModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'revision',
      expect.objectContaining({
        $inc: { version: 1 },
      }),
      expect.objectContaining({
        upsert: true,
        returnDocument: 'after',
      }),
    );
  });
});
