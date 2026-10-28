export const STORAGE_PORT_TOKEN = Symbol('STORAGE_PORT_TOKEN');

export interface StoragePort {
  save(
    fileBuffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<{ url: string; key: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getFilePath(key: string): string;
}
