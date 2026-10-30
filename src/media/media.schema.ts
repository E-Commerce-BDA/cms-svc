import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type {
  MediaMimeType,
  MediaUsage,
  MediaVisibility,
} from '@ecom/contracts';

export type MediaDocument = HydratedDocument<MediaModel>;

@Schema({ collection: 'cms_media', timestamps: true })
export class MediaModel {
  @Prop({ type: String, required: true, unique: true, index: true })
  key: string;

  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String, required: false, maxlength: 160 })
  alt?: string;

  @Prop({ type: Number, required: false })
  width?: number;

  @Prop({ type: Number, required: false })
  height?: number;

  @Prop({
    type: String,
    required: true,
    enum: ['image/png', 'image/jpeg', 'image/webp', 'image/avif'],
  })
  mimeType: MediaMimeType;

  @Prop({ type: Number, required: true })
  sizeBytes: number;

  @Prop({
    type: String,
    required: true,
    enum: ['section', 'blog', 'page', 'brand', 'category', 'other'],
    default: 'other',
    index: true,
  })
  usage: MediaUsage;

  // Documents written before cms-003 have no visibility; they are public.
  @Prop({
    type: String,
    required: false,
    enum: ['public', 'private'],
    default: 'public',
    index: true,
  })
  visibility?: MediaVisibility;

  @Prop({ type: String, required: false })
  uploadedBy?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MediaSchema = SchemaFactory.createForClass(MediaModel);

MediaSchema.index({ usage: 1, createdAt: -1 });
