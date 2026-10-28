import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { StoragePort } from './storage.port.js';

@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  private readonly logger = new Logger(LocalDiskStorageAdapter.name);
  private readonly baseDir: string;

  constructor() {
    this.baseDir =
      process.env.STORAGE_LOCAL_DIR ??
      path.resolve(process.cwd(), 'storage');
  }

  getFilePath(key: string): string {
    return path.resolve(this.baseDir, key);
  }

  async save(
    fileBuffer: Buffer,
    key: string,
    _mimeType: string,
  ): Promise<{ url: string; key: string }> {
    const fullPath = this.getFilePath(key);
    const dir = path.dirname(fullPath);

    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, fileBuffer);

    const url = `/api/v1/cms/media/file/${key}`;
    return { url, key };
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFilePath(key);
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
    const fullPath = this.getFilePath(key);
    try {
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}
