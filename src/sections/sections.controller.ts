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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type Section,
  type SectionListResponse,
  type SectionReorder,
  sectionReorderSchema,
  sectionSchema,
} from '@ecom/contracts';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation/zod-validation.pipe.js';
import { SectionsService } from './sections.service.js';

@Controller('cms')
export class SectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Get('sections')
  async getPublicSections(
    @Query('pageKey') pageKey: string = 'homepage',
  ): Promise<SectionListResponse> {
    return this.sectionsService.getPublicSections(pageKey);
  }

  @Get('admin/sections')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminSections(
    @Query('pageKey') pageKey?: string,
  ): Promise<SectionListResponse> {
    return this.sectionsService.getAdminSections(pageKey);
  }

  @Post('admin/sections')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createSection(
    @Body(new ZodValidationPipe(sectionSchema)) body: unknown,
  ): Promise<{ section: Section }> {
    const section = await this.sectionsService.createSection(body as Section);
    return { section };
  }

  @Patch('admin/sections/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async reorderSections(
    @Body(new ZodValidationPipe(sectionReorderSchema)) body: unknown,
  ): Promise<void> {
    await this.sectionsService.reorderSections(body as SectionReorder);
  }

  @Patch('admin/sections/:key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateSection(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ section: Section }> {
    const section = await this.sectionsService.updateSection(
      key,
      body as Partial<Section>,
    );
    return { section };
  }

  @Delete('admin/sections/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteSection(@Param('key') key: string): Promise<void> {
    await this.sectionsService.deleteSection(key);
  }
}
