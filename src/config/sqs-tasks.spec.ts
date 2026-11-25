import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqsTasksEnabled } from './sqs-tasks.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalEnabled = process.env.SQS_TASKS_ENABLED;

describe('sqsTasksEnabled', () => {
  beforeEach(() => {
    delete process.env.SQS_TASKS_ENABLED;
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

  it.each(['development', 'test'])(
    'starts no poller in %s without an explicit opt-in',
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;

      expect(sqsTasksEnabled()).toBe(false);
    },
  );

  it('starts a poller in development only when explicitly enabled', () => {
    process.env.NODE_ENV = 'development';
    process.env.SQS_TASKS_ENABLED = 'true';

    expect(sqsTasksEnabled()).toBe(true);
  });

  it('still honours an explicit false in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SQS_TASKS_ENABLED = 'false';

    expect(sqsTasksEnabled()).toBe(false);
  });

  it('defaults on in production, where renditions are expected', () => {
    process.env.NODE_ENV = 'production';

    expect(sqsTasksEnabled()).toBe(true);
  });
});
