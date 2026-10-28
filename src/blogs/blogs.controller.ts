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
  type Blog,
  type BlogCategory,
  type BlogListResponse,
  type BlogStatus,
  type CreateBlog,
  type CreateBlogCategory,
  createBlogCategorySchema,
  createBlogSchema,
  type UpdateBlog,
  updateBlogSchema,
} from '@ecom/contracts';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation/zod-validation.pipe.js';
import { BlogsService } from './blogs.service.js';

@Controller('cms')
export class BlogsController {
  constructor(private readonly blogsService: BlogsService) {}

  @Get('blogs')
  async getPublicBlogs(
    @Query('category') category?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<BlogListResponse> {
    return this.blogsService.getPublicBlogs(
      category,
      cursor,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('blogs/:slug')
  async getPublicBlogBySlug(
    @Param('slug') slug: string,
  ): Promise<{ blog: Blog }> {
    const blog = await this.blogsService.getPublicBlogBySlug(slug);
    return { blog };
  }

  @Get('blog-categories')
  async getPublicCategories(): Promise<BlogCategory[]> {
    return this.blogsService.getPublicCategories();
  }

  @Get('admin/blogs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminBlogs(
    @Query('status') status?: BlogStatus,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<BlogListResponse> {
    return this.blogsService.getAdminBlogs(
      status,
      cursor,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('admin/blogs')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createBlog(
    @Body(new ZodValidationPipe(createBlogSchema)) body: unknown,
  ): Promise<{ blog: Blog }> {
    const blog = await this.blogsService.createBlog(body as CreateBlog);
    return { blog };
  }

  @Patch('admin/blogs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateBlog(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBlogSchema)) body: unknown,
  ): Promise<{ blog: Blog }> {
    const blog = await this.blogsService.updateBlog(id, body as UpdateBlog);
    return { blog };
  }

  @Delete('admin/blogs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteBlog(@Param('id') id: string): Promise<void> {
    await this.blogsService.deleteBlog(id);
  }

  @Get('admin/blog-categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminCategories(): Promise<BlogCategory[]> {
    return this.blogsService.getPublicCategories();
  }

  @Post('admin/blog-categories')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createCategory(
    @Body(new ZodValidationPipe(createBlogCategorySchema)) body: unknown,
  ): Promise<{ category: BlogCategory }> {
    const category = await this.blogsService.createCategory(
      body as CreateBlogCategory,
    );
    return { category };
  }
}
