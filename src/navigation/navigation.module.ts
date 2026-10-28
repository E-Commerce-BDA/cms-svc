import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  NavigationModel,
  NavigationSchema,
} from './navigation.schema.js';
import { NavigationController } from './navigation.controller.js';
import { NavigationService } from './navigation.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NavigationModel.name, schema: NavigationSchema },
    ]),
  ],
  controllers: [NavigationController],
  providers: [NavigationService],
  exports: [NavigationService],
})
export class NavigationModule {}
