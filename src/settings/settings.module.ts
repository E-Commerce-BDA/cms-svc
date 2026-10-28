import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CmsSettingsModel,
  CmsSettingsSchema,
} from './cms-settings.schema.js';
import {
  PageSettingsModel,
  PageSettingsSchema,
} from './page-settings.schema.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CmsSettingsModel.name, schema: CmsSettingsSchema },
      { name: PageSettingsModel.name, schema: PageSettingsSchema },
    ]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
