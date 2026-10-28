import * as fs from 'node:fs';
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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type {
  Media,
  MediaListResponse,
  MediaUsage,
} from '@ecom/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  type AuthenticatedUser,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { MediaService, type UploadedMediaFile } from './media.service.js';

@Controller('cms')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('admin/media')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Body('usage') usage?: string,
    @Body('alt') alt?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ media: Media }> {
    const media = await this.mediaService.uploadMedia(
      file,
      usage,
      alt,
      user?.sub,
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
  ): Promise<MediaListResponse> {
    return this.mediaService.getAdminMedia(
      usage,
      page ? Number(page) : 1,
      perPage ? Number(perPage) : 20,
    );
  }

  @Delete('admin/media/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteMedia(@Param('id') id: string): Promise<void> {
    await this.mediaService.deleteMedia(id);
  }

  @Get('media/file/*')
  async serveFile(@Req() req: Request, @Res() res: Response): Promise<void> {
    const prefix = '/api/v1/cms/media/file/';
    const rawPath = req.originalUrl ?? req.url ?? '';
    const keyIndex = rawPath.indexOf(prefix);
    const key =
      keyIndex !== -1
        ? rawPath.slice(keyIndex + prefix.length).split('?')[0]
        : '';

    if (!key) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'File not found',
      });
    }

    const filePath = this.mediaService.getStorage().getFilePath(key);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: `File '${key}' not found`,
      });
    }

    res.sendFile(filePath);
  }
}
