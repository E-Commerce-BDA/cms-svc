import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';

export type PageSettingsDocument = HydratedDocument<PageSettingsModel>;

@Schema({ collection: 'cms_page_settings', timestamps: true })
export class PageSettingsModel {
  @Prop({ type: String, required: true, unique: true, index: true })
  pageKey: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true, default: {} })
  settings: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PageSettingsSchema =
  SchemaFactory.createForClass(PageSettingsModel);
