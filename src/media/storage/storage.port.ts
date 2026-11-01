export const STORAGE_PORT_TOKEN = Symbol('STORAGE_PORT_TOKEN');

/**
 * A key that cannot be turned into a contained path: a null byte, a
 * percent-escape that does not decode, a shape outside `mediaKeySchema`, or a
 * result that escapes the storage root.
 */
export class InvalidMediaKeyError extends Error {
  constructor(key: string) {
    super(`Rejected media key '${key}'`);
    this.name = 'InvalidMediaKeyError';
  }
}

export interface StoragePort {
  save(
    fileBuffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<{ url: string; key: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * The stored bytes of an object, validated exactly like `resolvePath`.
   *
   * The resize worker needs the original to decode it. It takes a `read` rather
   * than a path so the containment rule stays in one place and an object-store
   * adapter can implement the interface without inventing a local path.
   *
   * Throws `InvalidMediaKeyError` for a rejected key and a plain `ENOENT`
   * `Error` when nothing is stored under it.
   */
  read(key: string): Promise<Buffer>;
  /**
   * Absolute path of a stored object, validated and proven to stay inside the
   * storage root — including after symlinks are resolved.
   *
   * Throws `InvalidMediaKeyError` for a rejected key and a plain `ENOENT`
   * `Error` when nothing is stored under it.
   */
  resolvePath(key: string): Promise<string>;
}
