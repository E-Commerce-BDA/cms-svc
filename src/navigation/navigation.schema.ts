import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';

export type NavigationDocument = HydratedDocument<NavigationModel>;

@Schema({ collection: 'cms_navigation', timestamps: true })
export class NavigationModel {
  @Prop({ type: String, required: true, unique: true, default: 'navbar' })
  scope: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true, default: {} })
  navbar: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const NavigationSchema =
  SchemaFactory.createForClass(NavigationModel);
