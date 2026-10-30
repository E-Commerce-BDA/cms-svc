import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { mediaKeySchema } from '@ecom/contracts';
import {
  InvalidMediaKeyError,
  type StoragePort,
} from './storage.port.js';

/** True when `candidate` is strictly below `baseDir` on the resolved path. */
function isContained(baseDir: string, candidate: string): boolean {
  const relative = path.relative(baseDir, candidate);
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
}

@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  private readonly logger = new Logger(LocalDiskStorageAdapter.name);
  private readonly baseDir: string;

  constructor() {
    this.baseDir = path.resolve(
      process.env.STORAGE_LOCAL_DIR ?? path.resolve(process.cwd(), 'storage'),
    );
  }

  async resolvePath(key: string): Promise<string> {
    const absolutePath = this.resolveKey(key);

    // A symlink planted under the root resolves lexically inside it, so the
    // check has to be repeated on the real paths.
    const [realBaseDir, realPath] = await Promise.all([
      fs.promises.realpath(this.baseDir),
      fs.promises.realpath(absolutePath),
    ]);

    if (!isContained(realBaseDir, realPath)) {
      throw new InvalidMediaKeyError(key);
    }

    return realPath;
  }

  async save(
    fileBuffer: Buffer,
    key: string,
    _mimeType: string,
  ): Promise<{ url: string; key: string }> {
    const fullPath = this.resolveKey(key);
    const dir = path.dirname(fullPath);

    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, fileBuffer);

    const url = `/api/v1/cms/media/file/${key}`;
    return { url, key };
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.resolveKey(key);
    try {
      await fs.promises.unlink(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(
          `Failed to delete local storage file ${fullPath}: ${(error as Error).message}`,
        );
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.resolveKey(key);
    try {
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The only place a key becomes a path. Every caller goes through this method,
   * so no route can reach the disk with an unvalidated key.
   *
   * Null bytes are rejected first (they truncate the path inside libuv), then
   * the key is decoded exactly once, then the contract regex decides whether it
   * has an allowed shape at all.
   */
  private resolveKey(key: string): string {
    if (key.includes('\0')) {
      throw new InvalidMediaKeyError(key);
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(key);
    } catch {
      throw new InvalidMediaKeyError(key);
    }

    if (!mediaKeySchema.safeParse(decoded).success) {
      throw new InvalidMediaKeyError(key);
    }

    const absolutePath = path.resolve(this.baseDir, decoded);
    if (!isContained(this.baseDir, absolutePath)) {
      throw new InvalidMediaKeyError(key);
    }

    return absolutePath;
  }
}
