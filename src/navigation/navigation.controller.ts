import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { type NavSettings, navSettingsSchema } from '@ecom/contracts';
import type { PublicNavResponse } from '../common/public-state.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation/zod-validation.pipe.js';
import { NavigationService } from './navigation.service.js';

@Controller('cms')
export class NavigationController {
  constructor(private readonly navigationService: NavigationService) {}

  @Get('navigation')
  async getNavigation(): Promise<PublicNavResponse> {
    return this.navigationService.getNavigation();
  }

  @Get('admin/navigation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminNavigation(): Promise<PublicNavResponse> {
    return this.navigationService.getNavigation();
  }

  @Put('admin/navigation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateNavigation(
    @Body(new ZodValidationPipe(navSettingsSchema)) body: unknown,
  ): Promise<PublicNavResponse> {
    return this.navigationService.updateNavigation(body as NavSettings);
  }
}
