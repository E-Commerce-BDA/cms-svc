import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { type Footer, updateFooterSchema } from '@ecom/contracts';
import type { PublicFooterResponse } from '../common/public-state.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation/zod-validation.pipe.js';
import { FooterService } from './footer.service.js';

@Controller('cms')
export class FooterController {
  constructor(private readonly footerService: FooterService) {}

  @Get('footer')
  async getFooter(): Promise<PublicFooterResponse> {
    return this.footerService.getFooter();
  }

  @Get('admin/footer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminFooter(): Promise<PublicFooterResponse> {
    return this.footerService.getFooter();
  }

  @Put('admin/footer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateFooter(
    @Body(new ZodValidationPipe(updateFooterSchema)) body: unknown,
  ): Promise<PublicFooterResponse> {
    return this.footerService.updateFooter(body as Footer);
  }
}
