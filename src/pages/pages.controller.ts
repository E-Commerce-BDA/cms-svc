import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type CreatePage,
  createPageSchema,
  type Page,
  type PageListResponse,
  type UpdatePage,
  updatePageSchema,
} from '@ecom/contracts';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation/zod-validation.pipe.js';
import { PagesService } from './pages.service.js';

@Controller('cms')
export class PagesController {
  constructor(private readonly pagesService: PagesService) {}

  @Get('pages')
  async getPublicPages(): Promise<PageListResponse> {
    return this.pagesService.getPublicPages();
  }

  @Get('pages/:slug')
  async getPublicPageBySlug(
    @Param('slug') slug: string,
  ): Promise<{ page: Page }> {
    const page = await this.pagesService.getPublicPageBySlug(slug);
    return { page };
  }

  @Post('admin/pages')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPage(
    @Body(new ZodValidationPipe(createPageSchema)) body: unknown,
  ): Promise<{ page: Page }> {
    const page = await this.pagesService.createPage(body as CreatePage);
    return { page };
  }

  @Patch('admin/pages/:slug')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePage(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(updatePageSchema)) body: unknown,
  ): Promise<{ page: Page }> {
    const page = await this.pagesService.updatePage(
      slug,
      body as UpdatePage,
    );
    return { page };
  }

  @Delete('admin/pages/:slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePage(@Param('slug') slug: string): Promise<void> {
    await this.pagesService.deletePage(slug);
  }
}
