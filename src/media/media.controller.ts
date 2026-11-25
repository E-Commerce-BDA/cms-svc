import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type {
  Media,
  MediaListResponse,
  MediaUsage,
  MediaVisibility,
} from '@ecom/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  type AuthenticatedUser,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { MediaTooLargeFilter } from './filters/media-too-large.filter.js';
import { UploadSizeGuard } from './guards/upload-size.guard.js';
import {
  MAX_FILE_SIZE_BYTES,
  MediaService,
  type UploadedMediaFile,
} from './media.service.js';
import { sendStoredFile } from './send-stored-file.js';

const PUBLIC_CACHE_CONTROL = 'public, max-age=60, must-revalidate';
const ADMIN_CACHE_CONTROL = 'private, no-store';

@Controller('cms')
export class MediaController {
  private static readonly FILE_KEY_MARKER = '/cms/media/file/';

  constructor(private readonly mediaService: MediaService) {}

  @Post('admin/media')
  @HttpCode(HttpStatus.CREATED)
  // Auth first: an anonymous caller never gets to probe the size limit.
  @UseGuards(JwtAuthGuard, RolesGuard, UploadSizeGuard)
  @Roles('admin')
  @UseFilters(MediaTooLargeFilter)
  // No `storage` option means multer's memory engine, which is what we want:
  // the buffer is sniffed, and `fileSize` is the backstop behind the header
  // guard for a chunked request that sends no `Content-Length`.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: 1,
        fields: 8,
        parts: 12,
        fieldSize: 8 * 1024,
      },
    }),
  )
  async uploadMedia(
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Body('usage') usage?: string,
    @Body('alt') alt?: string,
    @Body('visibility') visibility?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ media: Media }> {
    const media = await this.mediaService.uploadMedia(
      file,
      usage,
      alt,
      user?.sub,
      visibility,
    );
    return { media };
  }

  @Get('admin/media')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminMedia(
    @Query('usage') usage?: MediaUsage,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('visibility') visibility?: MediaVisibility,
  ): Promise<MediaListResponse> {
    return this.mediaService.getAdminMedia(
      usage,
      page ? Number(page) : 1,
      perPage ? Number(perPage) : 20,
      visibility,
    );
  }

  @Delete('admin/media/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteMedia(@Param('id') id: string): Promise<void> {
    await this.mediaService.deleteMedia(id);
  }

  /**
   * The open file route. It serves `public` rows only and answers a private or
   * missing asset identically, so it cannot be used to probe for private files.
   */
  @Get('media/file/*')
  async serveFile(@Req() req: Request, @Res() res: Response): Promise<void> {
    const key = this.extractKey(req);
    const file = await this.mediaService.streamablePath(key, 'public');
    await sendStoredFile(res, file, PUBLIC_CACHE_CONTROL);
  }

  /**
   * The admin file route. Only an ObjectId identifies a row here: a storage key
   * contains slashes and cannot travel as a single route segment.
   */
  @Get('admin/media/:id/file')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async serveAdminFile(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const media = await this.mediaService.findById(id);
    if (!media) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'File not found',
      });
    }

    const file = await this.mediaService.streamablePath(media.key, 'admin');
    await sendStoredFile(res, file, ADMIN_CACHE_CONTROL);
  }

  /**
   * Reads the key from the raw URL so exactly one decode happens, in the
   * storage layer, where the contract regex can reject the result.
   */
  private extractKey(req: Request): string {
    const rawPath = (req.originalUrl ?? req.url ?? '').split('?')[0];
    const markerIndex = rawPath.indexOf(MediaController.FILE_KEY_MARKER);
    return markerIndex === -1
      ? ''
      : rawPath.slice(markerIndex + MediaController.FILE_KEY_MARKER.length);
  }
}
