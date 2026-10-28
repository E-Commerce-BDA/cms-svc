import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type BlogCategoryDocument = HydratedDocument<BlogCategoryModel>;

@Schema({ collection: 'cms_blog_categories', timestamps: true })
export class BlogCategoryModel {
  @Prop({ type: String, required: true, maxlength: 64 })
  name: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  slug: string;

  @Prop({ type: String, required: false, maxlength: 240 })
  description?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BlogCategorySchema =
  SchemaFactory.createForClass(BlogCategoryModel);
