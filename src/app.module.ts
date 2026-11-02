import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { DbModule } from './db/db.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RevisionModule } from './revision/revision.module.js';
import { CacheModule } from './cache/cache.module.js';
import { CmsOutboxModule } from './outbox/cms-outbox.module.js';
import { SectionsModule } from './sections/sections.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { NavigationModule } from './navigation/navigation.module.js';
import { FooterModule } from './footer/footer.module.js';
import { PagesModule } from './pages/pages.module.js';
import { BlogsModule } from './blogs/blogs.module.js';
import { MediaModule } from './media/media.module.js';
import { RevalidateModule } from './revalidate/revalidate.module.js';

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
    // Global: three mutations in two modules tell the storefront to drop a tag,
    // and that call is best-effort, so it should not appear in their constructors
    // as anything more than a collaborator.
    RevalidateModule,
    // Every content mutation writes its event into `cms_outbox` inside the same
    // Mongo transaction; the relay publishes it afterwards. Media renditions are
    // not events — they are tasks, and `MediaModule` owns their SQS wiring.
    CmsOutboxModule,
    SectionsModule,
    SettingsModule,
    NavigationModule,
    FooterModule,
    PagesModule,
    BlogsModule,
    MediaModule,
  ],
})
export class AppModule {}
