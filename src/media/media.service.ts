import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import {
  mediaVisibilitySchema,
  type Media,
  type MediaListResponse,
  type MediaMimeType,
  type MediaUsage,
  type MediaVisibility,
} from '@ecom/contracts';
import { EventsService } from '../events/events.service.js';
import { SectionModel, type SectionDocument } from '../sections/section.schema.js';
import { PageModel, type PageDocument } from '../pages/page.schema.js';
import { BlogModel, type BlogDocument } from '../blogs/blog.schema.js';
import { MediaModel, type MediaDocument } from './media.schema.js';
import { STORAGE_PORT_TOKEN, type StoragePort } from './storage/storage.port.js';

export const ALLOWED_MIME_TYPES: MediaMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Who is asking for the bytes: the open file route or the admin one. */
export type MediaViewer = 'public' | 'admin';

export interface StreamableMediaFile {
  absolutePath: string;
  mimeType: MediaMimeType;
}

export interface UploadedMediaFile {
  fieldname?: string;
  originalname?: string;
  encoding?: string;
  mimetype: string;
  size?: number;
  buffer: Buffer;
}

interface MediaDocumentLike {
  _id?: { toString(): string } | string;
  id?: string;
  key: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  mimeType: MediaMimeType;
  sizeBytes: number;
  usage: MediaUsage;
  visibility?: MediaVisibility;
  uploadedBy?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectModel(MediaModel.name)
    private readonly mediaModel: Model<MediaDocument>,
    @InjectModel(SectionModel.name)
    private readonly sectionModel: Model<SectionDocument>,
    @InjectModel(PageModel.name)
    private readonly pageModel: Model<PageDocument>,
    @InjectModel(BlogModel.name)
    private readonly blogModel: Model<BlogDocument>,
    @Inject(STORAGE_PORT_TOKEN)
    private readonly storage: StoragePort,
    private readonly eventsService: EventsService,
  ) {}

  async uploadMedia(
    file?: UploadedMediaFile,
    usage?: string,
    alt?: string,
    userId?: string,
    visibility?: string,
  ): Promise<Media> {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'No file provided in multipart request',
      });
    }

    const validVisibility = this.parseVisibility(visibility);

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype as MediaMimeType)) {
      throw new BadRequestException({
        code: 'MEDIA_TYPE_UNSUPPORTED',
        message: `Unsupported media type '${file.mimetype}'. Allowed types: PNG, JPEG, WebP, AVIF.`,
      });
    }

    const fileSize = file.size || file.buffer.length;
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException({
        code: 'MEDIA_TOO_LARGE',
        message: 'File exceeds maximum allowed size of 10 MB',
      });
    }

    const validUsage: MediaUsage = [
      'section',
      'blog',
      'page',
      'brand',
      'category',
      'other',
    ].includes(usage ?? '')
      ? (usage as MediaUsage)
      : 'other';

    const ext = this.resolveExtension(file.mimetype, file.originalname);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `media/${year}/${month}/${randomUUID()}.${ext}`;

    const { url } = await this.storage.save(file.buffer, key, file.mimetype);

    const mediaDoc = new this.mediaModel({
      key,
      url,
      alt: alt?.trim() || undefined,
      mimeType: file.mimetype as MediaMimeType,
      sizeBytes: fileSize,
      usage: validUsage,
      visibility: validVisibility,
      uploadedBy: userId,
    });

    await mediaDoc.save();

    const mediaPayload = this.toMediaPayload(
      mediaDoc.toObject<MediaDocumentLike>(),
    );

    await this.eventsService.publishResizeImageJob({
      mediaId: mediaPayload.id,
      sourceKey: key,
      formats: ['webp', 'avif', 'jpeg', 'png'],
      widths: [320, 640, 1024, 1920],
    });

    return mediaPayload;
  }

  async getAdminMedia(
    usage?: MediaUsage,
    page = 1,
    perPage = 20,
    visibility?: string,
  ): Promise<MediaListResponse> {
    const safePage = Math.max(1, Number(page) || 1);
    const safePerPage = Math.min(Math.max(1, Number(perPage) || 20), 100);
    const filter: FilterQuery<MediaModel> = {};
    if (usage) {
      filter.usage = usage;
    }
    if (visibility && mediaVisibilitySchema.safeParse(visibility).success) {
      filter.visibility = visibility;
    }

    const [total, docs] = await Promise.all([
      this.mediaModel.countDocuments(filter).exec(),
      this.mediaModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safePerPage)
        .limit(safePerPage)
        .lean<MediaDocumentLike[]>()
        .exec(),
    ]);

    return {
      data: docs.map((doc) => this.toMediaPayload(doc)),
      page: safePage,
      perPage: safePerPage,
      total,
    };
  }

  async deleteMedia(id: string): Promise<void> {
    const isObjectId = Types.ObjectId.isValid(id);
    const media = await this.mediaModel
      .findOne({
        $or: [
          ...(isObjectId ? [{ _id: new Types.ObjectId(id) }] : []),
          { key: id },
        ],
      })
      .exec();

    if (!media) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: `Media '${id}' not found`,
      });
    }

    const keyOrUrl = [media.key, media.url];

    const [sectionInUse, pageInUse, blogInUse] = await Promise.all([
      this.sectionModel.exists({
        $or: [
          { 'content.slides.image': { $in: keyOrUrl } },
          { 'content.image': { $in: keyOrUrl } },
        ],
      }),
      this.pageModel.exists({
        $or: [
          { 'blocks.url': { $in: keyOrUrl } },
          { 'seo.ogImage': { $in: keyOrUrl } },
        ],
      }),
      this.blogModel.exists({
        $or: [
          { coverUrl: { $in: keyOrUrl } },
          { 'content.url': { $in: keyOrUrl } },
          { 'seo.ogImage': { $in: keyOrUrl } },
        ],
      }),
    ]);

    if (sectionInUse || pageInUse || blogInUse) {
      throw new ConflictException({
        code: 'MEDIA_IN_USE',
        message: `Media '${id}' is currently in use across CMS content and cannot be deleted`,
      });
    }

    await this.storage.delete(media.key);
    await this.mediaModel.findByIdAndDelete(media._id).exec();
  }

  async findByKey(key: string): Promise<Media | null> {
    const doc = await this.mediaModel
      .findOne({ key })
      .lean<MediaDocumentLike | null>()
      .exec();
    return doc ? this.toMediaPayload(doc) : null;
  }

  async findById(id: string): Promise<Media | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    const doc = await this.mediaModel
      .findById(new Types.ObjectId(id))
      .lean<MediaDocumentLike | null>()
      .exec();
    return doc ? this.toMediaPayload(doc) : null;
  }

  /**
   * Resolves the bytes for a file route.
   *
   * A row the viewer may not see and a row that does not exist answer the same
   * way, so the public route is never an existence oracle for private assets.
   * The storage layer is the only source of a path, and it re-checks containment
   * after resolving symlinks.
   */
  async streamablePath(
    key: string,
    viewer: MediaViewer,
  ): Promise<StreamableMediaFile> {
    const media = await this.findByKey(key);
    if (!media || (viewer === 'public' && this.visibilityOf(media) !== 'public')) {
      throw this.mediaNotFound();
    }

    try {
      return {
        absolutePath: await this.storage.resolvePath(media.key),
        mimeType: media.mimeType,
      };
    } catch {
      // A rejected key, an escape, or a file that is gone are all "not found":
      // nothing about the storage root reaches the caller.
      throw this.mediaNotFound();
    }
  }

  private parseVisibility(visibility?: string): MediaVisibility {
    if (visibility === undefined || visibility === '') {
      return 'public';
    }

    const parsed = mediaVisibilitySchema.safeParse(visibility);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `Unsupported visibility '${visibility}'. Allowed values: public, private.`,
      });
    }

    return parsed.data;
  }

  private visibilityOf(media: Media): MediaVisibility {
    return media.visibility ?? 'public';
  }

  private mediaNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEDIA_NOT_FOUND',
      message: 'File not found',
    });
  }

  private resolveExtension(mimeType: string, filename?: string): string {
    switch (mimeType) {
      case 'image/png':
        return 'png';
      case 'image/jpeg':
        return 'jpg';
      case 'image/webp':
        return 'webp';
      case 'image/avif':
        return 'avif';
      default: {
        if (filename) {
          const ext = path.extname(filename).toLowerCase().replace('.', '');
          if (['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(ext)) {
            return ext === 'jpeg' ? 'jpg' : ext;
          }
        }
        return 'webp';
      }
    }
  }

  private toMediaPayload(doc: MediaDocumentLike): Media {
    return {
      id: (doc._id ? String(doc._id) : doc.id) ?? '',
      key: doc.key,
      url: doc.url,
      alt: doc.alt,
      width: doc.width,
      height: doc.height,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      usage: doc.usage,
      visibility: doc.visibility ?? 'public',
      uploadedBy: doc.uploadedBy,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : doc.createdAt,
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : doc.updatedAt,
    };
  }
}
