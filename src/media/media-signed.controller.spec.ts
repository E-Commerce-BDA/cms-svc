import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaSignedController } from './media-signed.controller.js';
import { MediaSignedUrlService } from './media-signed-url.js';

const SECRET = 'a-test-secret-at-least-32-characters-long';
const KEY = 'media/2026/11/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.png';

describe('MediaSignedController', () => {
  let tempDir: string;
  let filePath: string;
  let media: { findById: ReturnType<typeof vi.fn>; streamablePath: ReturnType<typeof vi.fn> };
  let signer: MediaSignedUrlService;
  let controller: MediaSignedController;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cms-signed-'));
    filePath = path.join(tempDir, 'asset.png');
    await fs.promises.writeFile(filePath, Buffer.from('image-bytes'));

    media = {
      findById: vi.fn().mockResolvedValue({
        id: '0190a1b2c3d47e5f8a9b0c1d2e3f4a5b',
        key: KEY,
        visibility: 'private',
      }),
      streamablePath: vi
        .fn()
        .mockResolvedValue({ absolutePath: filePath, mimeType: 'image/png' }),
    };
    signer = new MediaSignedUrlService({
      get: (name: string) => (name === 'JWT_SECRET' ? SECRET : undefined),
    } as never);
    controller = new MediaSignedController(media as never, signer);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  function requestFor(url: string, query: Record<string, string>) {
    return { originalUrl: url, query } as never;
  }

  function response() {
    const headers = new Map<string, string>();
    return {
      headers,
      headersSent: false,
      setHeader: vi.fn((name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
      }),
      sendFile: vi.fn((_name: string, done: (error?: Error) => void) => {
        done();
      }),
      end: vi.fn(),
    };
  }

  it('signs the row key only after the resolver has accepted it', async () => {
    const issued = await controller.issueSignedUrl('media-id', '60');
    const url = new URL(issued.url, 'http://localhost');
    const exp = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';

    expect(media.findById).toHaveBeenCalledWith('media-id');
    expect(media.streamablePath).toHaveBeenCalledWith(KEY, 'admin');
    expect(signer.verify(KEY, exp, sig)).toBe(true);
  });

  it('does not sign a row that does not exist', async () => {
    media.findById.mockResolvedValue(null);
    const issue = vi.spyOn(signer, 'issue');

    await expect(controller.issueSignedUrl('missing')).rejects.toThrow(
      NotFoundException,
    );
    expect(issue).not.toHaveBeenCalled();
  });

  it('serves a valid capability without a credential and marks it no-store', async () => {
    const issued = signer.issue(KEY, '60');
    const url = new URL(issued.url, 'http://localhost');
    const exp = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';
    const res = response();

    await controller.serveSignedFile(
      requestFor(`/api/v1/cms${url.pathname}?exp=${exp}&sig=${sig}`, {
        exp,
        sig,
      }),
      res as never,
    );

    expect(media.streamablePath).toHaveBeenCalledWith(KEY, 'admin');
    expect(res.sendFile).toHaveBeenCalledWith(filePath, expect.any(Function));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects a tampered capability before touching storage', async () => {
    const issued = signer.issue(KEY, '60');
    const url = new URL(issued.url, 'http://localhost');
    const exp = url.searchParams.get('exp') ?? '';
    const sig = '0'.repeat(64);
    const res = response();

    await expect(
      controller.serveSignedFile(
        requestFor(`/api/v1/cms${url.pathname}?exp=${exp}&sig=${sig}`, {
          exp,
          sig,
        }),
        res as never,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(media.streamablePath).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('rejects a capability whose key does not match its signature', async () => {
    const issued = signer.issue(KEY, '60');
    const url = new URL(issued.url, 'http://localhost');
    const exp = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';
    const otherKey = 'media/2026/11/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c.png';
    const res = response();

    await expect(
      controller.serveSignedFile(
        requestFor(`/api/v1/cms/media/signed/${otherKey}?exp=${exp}&sig=${sig}`, {
          exp,
          sig,
        }),
        res as never,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(media.streamablePath).not.toHaveBeenCalled();
  });
});
