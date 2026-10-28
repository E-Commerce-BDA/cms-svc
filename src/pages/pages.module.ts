import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PageModel, PageSchema } from './page.schema.js';
import { PagesController } from './pages.controller.js';
import { PagesService } from './pages.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PageModel.name, schema: PageSchema },
    ]),
  ],
  controllers: [PagesController],
  providers: [PagesService],
  exports: [PagesService, MongooseModule],
})
export class PagesModule {}
