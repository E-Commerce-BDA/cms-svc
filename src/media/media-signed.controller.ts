import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  MediaService,
  type StreamableMediaFile,
} from './media.service.js';
import { MediaSignedUrlService } from './media-signed-url.js';
import { sendStoredFile } from './send-stored-file.js';

const SIGNED_CACHE_CONTROL = 'private, no-store';
const SIGNED_KEY_MARKER = '/cms/media/signed/';

@Controller('cms')
export class MediaSignedController {
  constructor(
    private readonly media: MediaService,
    private readonly signer: MediaSignedUrlService,
  ) {}

  /**
   * The authorization boundary. Only an admin can mint a capability, and the
   * key comes from the row — never from the query string, so a caller cannot
   * have an arbitrary path signed.
   */
  @Get('admin/media/:id/signed-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async issueSignedUrl(
    @Param('id') id: string,
    @Query('expiresIn') expiresIn?: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const media = await this.media.findById(id);
    if (!media) {
      throw this.notFound();
    }

    // Containment and visibility are checked here, before a signature exists.
    // The admin viewer is the only shape that can see a private row at all;
    // its authority is what the short-lived URL carries to the public route.
    await this.media.streamablePath(media.key, 'admin');
    return this.signer.issue(media.key, expiresIn);
  }

  /** Redeems a capability. No credential is needed, but the HMAC and exp are. */
  @Get('media/signed/*')
  async serveSignedFile(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = this.extractKey(req);
    const expiresAt =
      typeof req.query.exp === 'string' ? req.query.exp : undefined;
    const signature =
      typeof req.query.sig === 'string' ? req.query.sig : undefined;

    if (!this.signer.verify(key, expiresAt, signature)) {
      throw this.notFound();
    }

    // The signature replaces the admin credential, not the path resolver: the
    // row lookup and the single containment-checked resolve still run here.
    const file: StreamableMediaFile = await this.media.streamablePath(
      key,
      'admin',
    );
    await sendStoredFile(res, file, SIGNED_CACHE_CONTROL);
  }

  /**
   * Reads the key from the raw URL so exactly one decode happens in the
   * storage layer, where the contract regex can reject the result.
   */
  private extractKey(req: Request): string {
    const rawPath = (req.originalUrl ?? req.url ?? '').split('?')[0];
    const markerIndex = rawPath.indexOf(SIGNED_KEY_MARKER);
    return markerIndex === -1
      ? ''
      : rawPath.slice(markerIndex + SIGNED_KEY_MARKER.length);
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEDIA_NOT_FOUND',
      message: 'File not found',
    });
  }
}
