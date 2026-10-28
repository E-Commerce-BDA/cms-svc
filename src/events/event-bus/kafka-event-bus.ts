import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer } from 'kafkajs';
import type { EventEnvelope } from '@ecom/contracts';
import type { IEventBus } from './event-bus.interface.js';

@Injectable()
export class KafkaEventBus implements IEventBus, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaEventBus.name);
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const brokersStr = this.configService.get<string>(
      'KAFKA_BROKERS',
      'localhost:9092',
    );
    const brokers = brokersStr
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

    try {
      this.kafka = new Kafka({
        clientId: 'cms-svc',
        brokers,
        connectionTimeout: 3000,
      });
      this.producer = this.kafka.producer();
      await this.producer.connect();
      this.logger.log(`KafkaEventBus connected to brokers: ${brokers.join(', ')}`);
    } catch (err) {
      this.logger.warn(
        `Failed to connect KafkaEventBus to ${brokers.join(', ')}: ${(err as Error).message}. Will retry on publish.`,
      );
    }
  }

  async publish(
    topic: string,
    event: EventEnvelope,
    key?: string,
  ): Promise<void> {
    if (!this.producer) {
      this.logger.warn(
        `Kafka producer is not connected; skipping publish of ${event.eventType} on ${topic}`,
      );
      return;
    }

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: key ?? event.id,
            value: JSON.stringify(event),
          },
        ],
      });
      this.logger.debug(
        `Published ${event.eventType} to Kafka topic ${topic} (key: ${key ?? event.id})`,
      );
    } catch (err) {
      this.logger.error(
        `Error publishing ${event.eventType} to Kafka topic ${topic}: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.producer) {
        await this.producer.disconnect();
      }
    } catch (err) {
      this.logger.warn(`Error disconnecting Kafka producer: ${(err as Error).message}`);
    }
  }
}

