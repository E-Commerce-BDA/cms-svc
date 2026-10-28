import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';

export type CmsSettingsDocument = HydratedDocument<CmsSettingsModel>;

@Schema({ collection: 'cms_settings', timestamps: true })
export class CmsSettingsModel {
  @Prop({ type: String, required: true, unique: true, default: 'global' })
  scope: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true, default: {} })
  theme: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CmsSettingsSchema =
  SchemaFactory.createForClass(CmsSettingsModel);
