import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';

export type FooterDocument = HydratedDocument<FooterModel>;

/**
 * Single-document store for the global footer, exactly like the navbar:
 * one row with `scope: 'footer'`, the whole document in a Mixed `footer`
 * field. Shape is enforced by the contracts `footerSchema` at the edge —
 * the service validates before it writes, so the collection only ever
 * holds a valid footer document.
 */
@Schema({ collection: 'cms_footer', timestamps: true })
export class FooterModel {
  @Prop({ type: String, required: true, unique: true, default: 'footer' })
  scope: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true, default: {} })
  footer: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FooterSchema = SchemaFactory.createForClass(FooterModel);
