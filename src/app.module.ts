import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { DbModule } from './db/db.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RevisionModule } from './revision/revision.module.js';
import { CacheModule } from './cache/cache.module.js';
import { EventsModule } from './events/events.module.js';
import { SectionsModule } from './sections/sections.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { NavigationModule } from './navigation/navigation.module.js';
import { PagesModule } from './pages/pages.module.js';
import { BlogsModule } from './blogs/blogs.module.js';
import { MediaModule } from './media/media.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        libraryOptions: { abortEarly: false, allowUnknown: true },
      },
    }),
    DbModule,
    AuthModule,
    HealthModule,
    RevisionModule,
    CacheModule,
    EventsModule,
    SectionsModule,
    SettingsModule,
    NavigationModule,
    PagesModule,
    BlogsModule,
    MediaModule,
  ],
})
export class AppModule {}
