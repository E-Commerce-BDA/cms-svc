import { describe, it, expect, vi } from 'vitest';
import { TASK_QUEUES } from '@ecom/contracts';
import { MediaTasksPublisher } from './media-tasks.publisher.js';

const job = {
  mediaId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  sourceKey: 'media/2026/11/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.png',
  formats: ['webp'] as ('webp' | 'avif' | 'jpeg' | 'png')[],
  widths: [320],
};

function build(enabled: boolean) {
  const tasks = { enqueue: vi.fn().mockResolvedValue({}) };
  // `urlFor` belongs to the port, not to the publisher: the producer only ever
  // enqueues, so the stub needs nothing else.
  const publisher = new MediaTasksPublisher(tasks as never, () => enabled);
  return { tasks, publisher };
}

describe('MediaTasksPublisher', () => {
  it('enqueues the resize job on the media queue with the media id as the key', async () => {
    const { tasks, publisher } = build(true);

    await publisher.enqueueResize(job);

    expect(tasks.enqueue).toHaveBeenCalledTimes(1);
    expect(tasks.enqueue).toHaveBeenCalledWith(TASK_QUEUES.mediaResizeImage, {
      // The type names the handler; the key makes a duplicate upload a no-op.
      type: 'media.resize-image',
      idempotencyKey: job.mediaId,
      payload: {
        mediaId: job.mediaId,
        sourceKey: job.sourceKey,
        formats: ['webp', 'avif', 'jpeg', 'png'],
        widths: [320, 640, 1024, 1920],
      },
    });
  });

  it('sends nothing when the queue is disabled', async () => {
    const { tasks, publisher } = build(false);

    await publisher.enqueueResize(job);

    expect(tasks.enqueue).not.toHaveBeenCalled();
  });

  it('swallows an enqueue failure: the upload has already been committed', async () => {
    const { tasks, publisher } = build(true);
    tasks.enqueue.mockRejectedValue(new Error('connect ECONNREFUSED'));

    // The contract is "never fail the upload": a missing rendition is
    // recoverable, a 500 on work that succeeded is not.
    await expect(publisher.enqueueResize(job)).resolves.toBeUndefined();
  });
});
