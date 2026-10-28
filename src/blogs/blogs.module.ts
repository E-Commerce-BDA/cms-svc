import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BlogCategoryModel,
  BlogCategorySchema,
} from './blog-category.schema.js';
import { BlogModel, BlogSchema } from './blog.schema.js';
import { BlogsController } from './blogs.controller.js';
import { BlogsService } from './blogs.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlogModel.name, schema: BlogSchema },
      { name: BlogCategoryModel.name, schema: BlogCategorySchema },
    ]),
  ],
  controllers: [BlogsController],
  providers: [BlogsService],
  exports: [BlogsService, MongooseModule],
})
export class BlogsModule {}
