import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import type { BlogStatus } from '@ecom/contracts';

export type BlogDocument = HydratedDocument<BlogModel>;

@Schema({ collection: 'cms_blogs', timestamps: true })
export class BlogModel {
  @Prop({ type: String, required: true, unique: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, maxlength: 160 })
  title: string;

  @Prop({ type: String, required: false })
  coverUrl?: string;

  @Prop({ type: String, required: false, maxlength: 300 })
  excerpt?: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], required: true, default: [] })
  content: Record<string, unknown>[];

  @Prop({ type: String, required: true, index: true })
  categoryId: string;

  @Prop({ type: String, required: false, maxlength: 80 })
  author?: string;

  @Prop({
    type: String,
    required: true,
    enum: ['draft', 'published'],
    default: 'draft',
    index: true,
  })
  status: BlogStatus;

  @Prop({ type: Date, required: false, default: null })
  publishedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false, default: {} })
  seo?: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BlogSchema = SchemaFactory.createForClass(BlogModel);

BlogSchema.index({ status: 1, publishedAt: -1, _id: -1 });
BlogSchema.index({ categoryId: 1, status: 1, publishedAt: -1, _id: -1 });
