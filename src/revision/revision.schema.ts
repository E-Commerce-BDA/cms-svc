import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type CmsMetaDocument = HydratedDocument<CmsMeta>;

@Schema({ collection: 'cms_meta', timestamps: true })
export class CmsMeta {
  @Prop({ type: String, default: 'revision' })
  _id: string;

  @Prop({ type: Number, required: true, default: 1 })
  version: number;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const CmsMetaSchema = SchemaFactory.createForClass(CmsMeta);
