import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthSettings,
  authSettingsSchema,
  type PageSettingsResponse,
  type ThemeResponse,
  type ThemeSettings,
  themeSettingsSchema,
} from '@ecom/contracts';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation/zod-validation.pipe.js';
import { SettingsService } from './settings.service.js';

@Controller('cms')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings/global')
  async getGlobalTheme(): Promise<ThemeResponse> {
    return this.settingsService.getGlobalTheme();
  }

  @Get('admin/settings/global')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminGlobalTheme(): Promise<ThemeResponse> {
    return this.settingsService.getGlobalTheme();
  }

  @Put('admin/settings/global')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateGlobalTheme(
    @Body(new ZodValidationPipe(themeSettingsSchema)) body: unknown,
  ): Promise<ThemeResponse> {
    return this.settingsService.updateGlobalTheme(body as ThemeSettings);
  }

  @Get('settings/page/:pageKey')
  async getPageSettings(
    @Param('pageKey') pageKey: string,
  ): Promise<PageSettingsResponse> {
    return this.settingsService.getPageSettings(pageKey);
  }

  @Get('admin/settings/page/:pageKey')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminPageSettings(
    @Param('pageKey') pageKey: string,
  ): Promise<PageSettingsResponse> {
    return this.settingsService.getPageSettings(pageKey);
  }

  @Put('admin/settings/page/:pageKey')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePageSettings(
    @Param('pageKey') pageKey: string,
    @Body(new ZodValidationPipe(authSettingsSchema)) body: unknown,
  ): Promise<PageSettingsResponse> {
    return this.settingsService.updatePageSettings(
      pageKey,
      body as AuthSettings,
    );
  }
}
