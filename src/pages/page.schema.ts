import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';

export type PageDocument = HydratedDocument<PageModel>;

@Schema({ collection: 'cms_pages', timestamps: true })
export class PageModel {
  @Prop({ type: String, required: true, unique: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, maxlength: 120 })
  title: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], required: true, default: [] })
  blocks: Record<string, unknown>[];

  @Prop({ type: MongooseSchema.Types.Mixed, required: false, default: {} })
  seo?: Record<string, unknown>;

  @Prop({ type: Boolean, required: true, default: true, index: true })
  isActive: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PageSchema = SchemaFactory.createForClass(PageModel);
