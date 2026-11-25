import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SQS_TASK_QUEUE } from '@ecom/messaging/nest/tasks';
import type { TaskQueuePort } from '@ecom/messaging';
import { TASK_QUEUES, type ResizeImageJob } from '@ecom/contracts';
import { sqsTasksEnabled } from '../config/sqs-tasks.js';

/** The widths and formats every upload gets. One list, so a replay is identical. */
export const RESIZE_FORMATS = ['webp', 'avif', 'jpeg', 'png'] as const;
export const RESIZE_WIDTHS = [320, 640, 1024, 1920] as const;

/**
 * Enqueues the resize task for one upload.
 *
 * This replaced `EventsService` in `cms-006`: `media.tasks` was never an
 * `EVENT_TOPIC` — it is a command for one worker, so it belongs on SQS, and the
 * Kafka bus it used to travel on is gone from this service entirely.
 *
 * Two deliberate non-throwing paths:
 *
 * - **Queue disabled** (`sqsTasksEnabled()` is false): a debug line and nothing
 *   else, so a developer without LocalStack and every e2e suite keep working,
 *   and no suite silently talks to a broker. The producer and the poller share
 *   this one predicate, so a skipped enqueue can never leave a worker waiting.
 * - **Enqueue failed**: an error line and nothing else, because by this point
 *   the bytes are stored and the media document is committed. Failing the
 *   upload would hand the admin a 500 for work that succeeded; the missing
 *   renditions are recoverable (re-enqueue by media id) while a rejected upload
 *   that left an orphan behind is not.
 */
@Injectable()
export class MediaTasksPublisher {
  private readonly logger = new Logger(MediaTasksPublisher.name);

  constructor(
    @Inject(SQS_TASK_QUEUE) private readonly tasks: TaskQueuePort,
    // `@Optional()` because the default is the real rule: without it Nest tries
    // to inject a `Function` it cannot resolve. A test passes its own predicate.
    @Optional() private readonly enabled: () => boolean = sqsTasksEnabled,
  ) {}

  async enqueueResize(job: ResizeImageJob): Promise<void> {
    if (!this.enabled()) {
      this.logger.debug(
        `SQS tasks are disabled; skipping resize for media ${job.mediaId}`,
      );
      return;
    }

    try {
      // The idempotency key is the media id: the renditions of one media are
      // one effect, so a duplicate upload task is a no-op in the worker.
      await this.tasks.enqueue(TASK_QUEUES.mediaResizeImage, {
        type: 'media.resize-image',
        idempotencyKey: job.mediaId,
        payload: {
          ...job,
          formats: [...RESIZE_FORMATS],
          widths: [...RESIZE_WIDTHS],
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not enqueue the resize task for media ${job.mediaId}: ` +
          `${(error as Error).message}. The upload itself succeeded; the ` +
          `renditions are missing until the task is enqueued again.`,
      );
    }
  }
}
