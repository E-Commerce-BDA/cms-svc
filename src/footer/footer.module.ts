import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FooterModel, FooterSchema } from './footer.schema.js';
import { FooterController } from './footer.controller.js';
import { FooterService } from './footer.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FooterModel.name, schema: FooterSchema },
    ]),
  ],
  controllers: [FooterController],
  providers: [FooterService],
  exports: [FooterService],
})
export class FooterModule {}
