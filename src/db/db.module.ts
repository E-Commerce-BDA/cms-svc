import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoConnectionBinder } from './mongo-connection.js';
import { MongoTransactions } from './mongo-tx.js';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
        appName: 'cms-svc',
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 10000,
        maxPoolSize: 10,
        // Content is critical; boot must fail instead of retrying for ~27s.
        retryAttempts: 0,
        autoIndex: configService.get<string>('NODE_ENV') !== 'production',
      }),
    }),
  ],
  providers: [MongoConnectionBinder, MongoTransactions],
  exports: [MongooseModule, MongoTransactions],
})
export class DbModule {}
