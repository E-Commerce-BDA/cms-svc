import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidMediaKeyError,
  type StoragePort,
} from './storage.port.js';
import { LocalDiskStorageAdapter } from './local-disk.storage.js';

const VALID_KEY = 'media/2026/10/0190a1b2-c3d4-7e8f-9012-3456789abcde.png';

describe('LocalDiskStorageAdapter', () => {
  let baseDir: string;
  let outsideDir: string;
  let storage: StoragePort;

  beforeEach(async () => {
    baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cms-media-'));
    outsideDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'cms-media-outside-'),
    );
    process.env.STORAGE_LOCAL_DIR = baseDir;
    storage = new LocalDiskStorageAdapter();
  });

  afterEach(async () => {
    delete process.env.STORAGE_LOCAL_DIR;
    await fs.promises.rm(baseDir, { recursive: true, force: true });
    await fs.promises.rm(outsideDir, { recursive: true, force: true });
  });

  async function writeValidFile(): Promise<string> {
    const absolutePath = path.join(baseDir, ...VALID_KEY.split('/'));
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, Buffer.from('image-bytes'));
    return absolutePath;
  }

  it('resolves a valid key inside the storage root', async () => {
    const expected = await writeValidFile();

    await expect(storage.resolvePath(VALID_KEY)).resolves.toBe(
      await fs.promises.realpath(expected),
    );
  });

  it('reports ENOENT for a valid key with nothing stored', async () => {
    await expect(storage.resolvePath(VALID_KEY)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    ['parent traversal', '../outside.png'],
    ['encoded traversal', '%2e%2e%2foutside.png'],
    ['encoded backslash traversal', '%2e%2e%5coutside.png'],
    ['nested traversal', 'media/2026/10/../../x.png'],
    ['absolute posix path', '/etc/passwd'],
    ['absolute windows path', 'C:\\Windows\\win.ini'],
    ['null byte', 'media/2026/10/0190a1b2-c3d4-7e8f-9012-3456789abcde.png\0.png'],
    ['wrong extension', 'media/2026/10/0190a1b2-c3d4-7e8f-9012-3456789abcde.svg'],
    ['no extension', 'media/2026/10/0190a1b2-c3d4-7e8f-9012-3456789abcde'],
    ['missing directories', '0190a1b2-c3d4-7e8f-9012-3456789abcde.png'],
    ['broken escape', 'media/2026/10/%zz.png'],
    ['empty key', ''],
  ])('rejects a key with %s', async (_label, key) => {
    await expect(storage.resolvePath(key)).rejects.toThrow(InvalidMediaKeyError);
    await expect(storage.exists(key)).rejects.toThrow(InvalidMediaKeyError);
  });

  it('rejects a symlink that points outside the storage root', async () => {
    const target = path.join(outsideDir, 'secret.png');
    await fs.promises.writeFile(target, Buffer.from('secret'));

    const linkKey = 'media/2026/10/0190a1b2-c3d4-7e8f-9012-3456789abcdef.png';
    const linkPath = path.join(baseDir, ...linkKey.split('/'));
    await fs.promises.mkdir(path.dirname(linkPath), { recursive: true });
    try {
      await fs.promises.symlink(target, linkPath);
    } catch {
      // Windows without the symlink privilege (EPERM): nothing was planted,
      // so there is nothing for the adapter to defeat.
      return;
    }

    const resolvedLink = await fs.promises.realpath(linkPath);
    if (resolvedLink !== (await fs.promises.realpath(target))) {
      // The filesystem stored a copy instead of a link.
      return;
    }

    await expect(storage.resolvePath(linkKey)).rejects.toThrow(
      InvalidMediaKeyError,
    );
  });

  it('writes, reads, and deletes through the validated path', async () => {
    const saved = await storage.save(Buffer.from('bytes'), VALID_KEY, 'image/png');
    expect(saved.url).toBe(`/api/v1/cms/media/file/${VALID_KEY}`);
    await expect(storage.exists(VALID_KEY)).resolves.toBe(true);

    await storage.delete(VALID_KEY);
    await expect(storage.exists(VALID_KEY)).resolves.toBe(false);
  });

  it('refuses to write or delete through a rejected key', async () => {
    await expect(
      storage.save(Buffer.from('bytes'), '../escape.png', 'image/png'),
    ).rejects.toThrow(InvalidMediaKeyError);
    await expect(storage.delete('../escape.png')).rejects.toThrow(
      InvalidMediaKeyError,
    );
    expect(fs.existsSync(path.join(path.dirname(baseDir), 'escape.png'))).toBe(
      false,
    );
  });

  describe('onModuleInit', () => {
    it('rejects a relative STORAGE_LOCAL_DIR before touching the disk', async () => {
      process.env.STORAGE_LOCAL_DIR = 'relative/storage';
      const relative = new LocalDiskStorageAdapter();

      await expect(relative.onModuleInit()).rejects.toThrow(
        /must be an absolute path/,
      );
    });

    it('creates a missing nested root', async () => {
      const nested = path.join(baseDir, 'nested', 'deep');
      process.env.STORAGE_LOCAL_DIR = nested;
      const adapter = new LocalDiskStorageAdapter();

      await adapter.onModuleInit();

      expect(fs.existsSync(nested)).toBe(true);
    });

    it('rejects a root that cannot be created', async () => {
      // A file where a directory is expected fails the same way on every OS.
      const blocker = path.join(baseDir, 'blocker');
      await fs.promises.writeFile(blocker, 'not a directory');
      process.env.STORAGE_LOCAL_DIR = path.join(blocker, 'child');
      const adapter = new LocalDiskStorageAdapter();

      await expect(adapter.onModuleInit()).rejects.toThrow(
        /not a writable directory/,
      );
    });

    it('rejects a root the process cannot write to', async () => {
      const readOnly = path.join(baseDir, 'read-only');
      await fs.promises.mkdir(readOnly, { recursive: true });
      try {
        await fs.promises.chmod(readOnly, 0o500);
      } catch {
        return;
      }
      // Windows ignores the mode bits; nothing was made unwritable, so there is
      // nothing for the adapter to refuse.
      try {
        await fs.promises.access(readOnly, fs.constants.W_OK);
        return;
      } catch {
        // The OS honoured the mode: assert the rejection below.
      }

      process.env.STORAGE_LOCAL_DIR = readOnly;
      const adapter = new LocalDiskStorageAdapter();

      await expect(adapter.onModuleInit()).rejects.toThrow(
        /not a writable directory/,
      );
    });
  });
});
