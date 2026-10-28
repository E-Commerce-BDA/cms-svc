import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';

export type SectionDocument = HydratedDocument<SectionModel>;

@Schema({ collection: 'cms_sections', timestamps: true })
export class SectionModel {
  @Prop({ type: String, required: true, unique: true, index: true })
  key: string;

  @Prop({ type: String, required: true, index: true })
  pageKey: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'hero',
      'banner',
      'featured_products',
      'category_showcase',
      'brand_strip',
      'blog_teaser',
      'testimonial',
    ],
  })
  type: string;

  @Prop({ type: String, required: false, maxlength: 120 })
  title?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  content: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false, default: {} })
  settings?: Record<string, unknown>;

  @Prop({ type: Number, required: true, default: 0 })
  sortOrder: number;

  @Prop({ type: Boolean, required: true, default: true })
  isActive: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SectionSchema = SchemaFactory.createForClass(SectionModel);
SectionSchema.index({ pageKey: 1, sortOrder: 1 });
