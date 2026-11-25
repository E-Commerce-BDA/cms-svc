import type { DynamicModule } from '@nestjs/common';
import { TASK_QUEUES } from '@ecom/contracts';
import {
  SQS_TASK_QUEUE,
  SQS_TASK_WORKER,
  createSqsTaskModule,
} from '@ecom/messaging/nest/tasks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqsTasksEnabled } from '../config/sqs-tasks.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalEnabled = process.env.SQS_TASKS_ENABLED;

function providerTokens(module: DynamicModule): unknown[] {
  return (module.providers ?? []).flatMap((provider) =>
    typeof provider === 'object' && provider !== null && 'provide' in provider
      ? [provider.provide]
      : [],
  );
}

function build() {
  return createSqsTaskModule({
    queue: TASK_QUEUES.mediaResizeImage,
    enabled: sqsTasksEnabled,
    handler: async () => {},
  });
}

describe('SQS task module gating', () => {
  beforeEach(() => {
    delete process.env.SQS_TASKS_ENABLED;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.SQS_TASKS_ENABLED;
    } else {
      process.env.SQS_TASKS_ENABLED = originalEnabled;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('registers only the producer when a suite has no explicit opt-in', () => {
    const module = build();

    expect(providerTokens(module)).toEqual([SQS_TASK_QUEUE]);
    expect(providerTokens(module)).not.toContain(SQS_TASK_WORKER);
    expect(module.exports).toEqual([SQS_TASK_QUEUE]);
  });

  it('registers the poller and its lifecycle when the queue is opted in', () => {
    process.env.SQS_TASKS_ENABLED = 'true';

    const module = build();
    const tokens = providerTokens(module);

    expect(tokens).toContain(SQS_TASK_QUEUE);
    expect(tokens).toContain(SQS_TASK_WORKER);
    // The lifecycle is the only thing that calls `worker.run()`: a worker
    // provider alone would never poll.
    expect(module.exports).toContain(SQS_TASK_WORKER);
  });
});
