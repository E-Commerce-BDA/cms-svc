import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_FILE_SIZE_BYTES,
  MediaService,
  type UploadedMediaFile,
} from './media.service.js';

describe('MediaService', () => {
  const sampleMediaDoc = {
    _id: '507f1f77bcf86cd799439031',
    key: 'media/2026/10/banner.webp',
    url: '/api/v1/cms/media/file/media/2026/10/banner.webp',
    alt: 'Promo banner',
    mimeType: 'image/webp',
    sizeBytes: 1024,
    usage: 'section',
    uploadedBy: '0190a1b2-admin',
    createdAt: new Date('2026-10-28T00:00:00.000Z'),
    updatedAt: new Date('2026-10-28T00:00:00.000Z'),
  };

  const sampleFile: UploadedMediaFile = {
    fieldname: 'file',
    originalname: 'hero.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 2048,
    buffer: Buffer.from('fake-image-bytes'),
  };

  describe('uploadMedia', () => {
    it('rejects when no file or empty buffer provided', async () => {
      const service = new MediaService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.uploadMedia(undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects unsupported MIME types (e.g. SVG)', async () => {
      const service = new MediaService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const svgFile = {
        ...sampleFile,
        mimetype: 'image/svg+xml',
        originalname: 'logo.svg',
      };

      await expect(service.uploadMedia(svgFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects files larger than 10 MB', async () => {
      const service = new MediaService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const largeFile = {
        ...sampleFile,
        size: MAX_FILE_SIZE_BYTES + 1,
      };

      await expect(service.uploadMedia(largeFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('saves file, persists document, publishes resize job, and returns payload', async () => {
      const saveMock = vi.fn().mockResolvedValue(undefined);
      function MockMediaModel(this: unknown, data: unknown) {
        Object.assign(this as object, sampleMediaDoc, data, {
          save: saveMock,
          toObject: vi.fn().mockReturnValue({
            ...sampleMediaDoc,
            ...(data as Record<string, unknown>),
          }),
        });
      }

      const storage = {
        save: vi.fn().mockResolvedValue({
          url: '/api/v1/cms/media/file/media/2026/10/banner.webp',
          key: 'media/2026/10/banner.webp',
        }),
        delete: vi.fn(),
        exists: vi.fn(),
        resolvePath: vi.fn(),
      };

      const eventsService = {
        publishResizeImageJob: vi.fn().mockResolvedValue(undefined),
      };

      const service = new MediaService(
        MockMediaModel as never,
        {} as never,
        {} as never,
        {} as never,
        storage,
        eventsService as never,
      );

      const media = await service.uploadMedia(
        sampleFile,
        'section',
        'Hero image',
        'admin-sub',
      );

      expect(storage.save).toHaveBeenCalled();
      expect(saveMock).toHaveBeenCalled();
      expect(eventsService.publishResizeImageJob).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceKey: expect.stringMatching(/^media\/\d{4}\/\d{2}\/.+\.png$/),
          formats: ['webp', 'avif', 'jpeg', 'png'],
        }),
      );
      expect(media.mimeType).toBe('image/png');
    });
  });

  describe('getAdminMedia', () => {
    it('returns paginated media documents and total', async () => {
      const execCountMock = vi.fn().mockResolvedValue(42);
      const execFindMock = vi.fn().mockResolvedValue([sampleMediaDoc]);

      const mediaModel = {
        countDocuments: vi.fn().mockReturnValue({ exec: execCountMock }),
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            skip: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                lean: vi.fn().mockReturnValue({ exec: execFindMock }),
              }),
            }),
          }),
        }),
      };

      const service = new MediaService(
        mediaModel as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const res = await service.getAdminMedia('section', 2, 10);
      expect(res.total).toBe(42);
      expect(res.page).toBe(2);
      expect(res.perPage).toBe(10);
      expect(res.data).toHaveLength(1);
      expect(mediaModel.find).toHaveBeenCalledWith({ usage: 'section' });
    });
  });

  describe('deleteMedia and in-use guard', () => {
    it('throws NotFoundException if media does not exist', async () => {
      const mediaModel = {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
      };

      const service = new MediaService(
        mediaModel as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.deleteMedia('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects deletion with ConflictException if in use by sections', async () => {
      const mediaModel = {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(sampleMediaDoc),
        }),
      };
      const sectionModel = {
        exists: vi.fn().mockResolvedValue({ _id: 'section-1' }),
      };
      const pageModel = { exists: vi.fn().mockResolvedValue(null) };
      const blogModel = { exists: vi.fn().mockResolvedValue(null) };

      const service = new MediaService(
        mediaModel as never,
        sectionModel as never,
        pageModel as never,
        blogModel as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.deleteMedia('507f1f77bcf86cd799439031'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects deletion with ConflictException if in use by pages', async () => {
      const mediaModel = {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(sampleMediaDoc),
        }),
      };
      const sectionModel = { exists: vi.fn().mockResolvedValue(null) };
      const pageModel = { exists: vi.fn().mockResolvedValue({ _id: 'page-1' }) };
      const blogModel = { exists: vi.fn().mockResolvedValue(null) };

      const service = new MediaService(
        mediaModel as never,
        sectionModel as never,
        pageModel as never,
        blogModel as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.deleteMedia('507f1f77bcf86cd799439031'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects deletion with ConflictException if in use by blogs', async () => {
      const mediaModel = {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(sampleMediaDoc),
        }),
      };
      const sectionModel = { exists: vi.fn().mockResolvedValue(null) };
      const pageModel = { exists: vi.fn().mockResolvedValue(null) };
      const blogModel = { exists: vi.fn().mockResolvedValue({ _id: 'blog-1' }) };

      const service = new MediaService(
        mediaModel as never,
        sectionModel as never,
        pageModel as never,
        blogModel as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.deleteMedia('507f1f77bcf86cd799439031'),
      ).rejects.toThrow(ConflictException);
    });

    it('deletes from storage and database when not in use', async () => {
      const execDeleteMock = vi.fn().mockResolvedValue(sampleMediaDoc);
      const mediaModel = {
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(sampleMediaDoc),
        }),
        findByIdAndDelete: vi.fn().mockReturnValue({ exec: execDeleteMock }),
      };
      const sectionModel = { exists: vi.fn().mockResolvedValue(null) };
      const pageModel = { exists: vi.fn().mockResolvedValue(null) };
      const blogModel = { exists: vi.fn().mockResolvedValue(null) };

      const storage = {
        save: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn(),
        resolvePath: vi.fn(),
      };

      const service = new MediaService(
        mediaModel as never,
        sectionModel as never,
        pageModel as never,
        blogModel as never,
        storage,
        {} as never,
      );

      await service.deleteMedia('507f1f77bcf86cd799439031');
      expect(storage.delete).toHaveBeenCalledWith(sampleMediaDoc.key);
      expect(mediaModel.findByIdAndDelete).toHaveBeenCalledWith(
        sampleMediaDoc._id,
      );
    });
  });

  describe('visibility', () => {
    function serviceWithMediaDoc(doc: unknown, storage: unknown = {}) {
      const mediaModel = {
        findOne: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(doc),
          }),
        }),
      };

      return new MediaService(
        mediaModel as never,
        {} as never,
        {} as never,
        {} as never,
        storage as never,
        {} as never,
      );
    }

    it('rejects an unknown visibility on upload with 400 VALIDATION_FAILED', async () => {
      const service = new MediaService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.uploadMedia(sampleFile, 'section', undefined, undefined, 'secret'),
      ).rejects.toThrow(BadRequestException);
    });

    it('treats a record without a visibility as public', async () => {
      const service = serviceWithMediaDoc(sampleMediaDoc);
      const media = await service.findByKey(sampleMediaDoc.key);
      expect(media?.visibility).toBe('public');
    });

    it('filters the admin list by visibility only when it is a real value', async () => {
      const findMock = vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              lean: vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });
      const mediaModel = {
        countDocuments: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(0),
        }),
        find: findMock,
      };
      const service = new MediaService(
        mediaModel as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await service.getAdminMedia(undefined, 1, 20, 'private');
      expect(findMock).toHaveBeenLastCalledWith({ visibility: 'private' });

      await service.getAdminMedia(undefined, 1, 20, 'secret');
      expect(findMock).toHaveBeenLastCalledWith({});
    });
  });

  describe('streamablePath', () => {
    const privateDoc = { ...sampleMediaDoc, visibility: 'private' };

    function serviceWithMediaDoc(doc: unknown, resolvePath = vi.fn()) {
      const mediaModel = {
        findOne: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(doc),
          }),
        }),
      };

      return new MediaService(
        mediaModel as never,
        {} as never,
        {} as never,
        {} as never,
        { save: vi.fn(), delete: vi.fn(), exists: vi.fn(), resolvePath } as never,
        {} as never,
      );
    }

    it('serves a public row to the public viewer', async () => {
      const resolvePath = vi.fn().mockResolvedValue('/srv/storage/banner.webp');
      const service = serviceWithMediaDoc(sampleMediaDoc, resolvePath);

      await expect(service.streamablePath(sampleMediaDoc.key, 'public')).resolves.toEqual({
        absolutePath: '/srv/storage/banner.webp',
        mimeType: 'image/webp',
      });
    });

    it('hides a private row from the public viewer without touching storage', async () => {
      const resolvePath = vi.fn();
      const service = serviceWithMediaDoc(privateDoc, resolvePath);

      await expect(service.streamablePath(privateDoc.key, 'public')).rejects.toThrow(
        NotFoundException,
      );
      expect(resolvePath).not.toHaveBeenCalled();
    });

    it('serves a private row to the admin viewer', async () => {
      const resolvePath = vi.fn().mockResolvedValue('/srv/storage/banner.webp');
      const service = serviceWithMediaDoc(privateDoc, resolvePath);

      await expect(service.streamablePath(privateDoc.key, 'admin')).resolves.toEqual({
        absolutePath: '/srv/storage/banner.webp',
        mimeType: 'image/webp',
      });
    });

    it('answers not found for an unknown key without touching storage', async () => {
      const resolvePath = vi.fn();
      const service = serviceWithMediaDoc(null, resolvePath);

      await expect(service.streamablePath('../etc/passwd', 'admin')).rejects.toThrow(
        NotFoundException,
      );
      expect(resolvePath).not.toHaveBeenCalled();
    });

    it('maps a storage rejection to a generic not-found', async () => {
      const resolvePath = vi.fn().mockRejectedValue(new Error('EACCES'));
      const service = serviceWithMediaDoc(sampleMediaDoc, resolvePath);

      await expect(service.streamablePath(sampleMediaDoc.key, 'public')).rejects.toThrow(
        NotFoundException,
      );

      try {
        await service.streamablePath(sampleMediaDoc.key, 'public');
      } catch (error) {
        const response = (error as NotFoundException).getResponse() as {
          message: string;
        };
        expect(response.message).toBe('File not found');
      }
    });
  });
});
