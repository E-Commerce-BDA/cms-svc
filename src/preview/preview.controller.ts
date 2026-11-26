import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  type IssuedPreviewToken,
  PreviewTokenService,
} from './preview-token.js';

@Controller('cms')
export class PreviewController {
  constructor(private readonly tokens: PreviewTokenService) {}

  /** Only an admin can mint a capability; redeeming it is read-only. */
  @Get('admin/preview-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  issue(@Query('expiresIn') expiresIn?: string): IssuedPreviewToken {
    return this.tokens.issue(expiresIn);
  }
}
