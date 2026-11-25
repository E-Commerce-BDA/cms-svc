/**
 * The one answer to "should this process poll a task queue?".
 *
 * `@ecom/messaging` defaults to `NODE_ENV !== 'test'`, which would start a
 * long-poll in an ordinary development checkout with no LocalStack running.
 * Outside production this service requires an explicit opt-in instead, so a
 * developer boot and every test suite stay broker-free unless someone points
 * them at a queue on purpose.
 *
 * Production keeps the existing default-on behaviour: renditions are expected
 * there without a developer switching a flag, and it can still be overridden
 * with `SQS_TASKS_ENABLED=false`.
 *
 * Rejected: the package default (`NODE_ENV !== 'test'`) — it silently starts a
 * worker on a machine with no broker and hides the missing renditions behind a
 * retrying poll.
 */
export function sqsTasksEnabled(): boolean {
  if (process.env.SQS_TASKS_ENABLED === 'true') {
    return true;
  }
  if (process.env.SQS_TASKS_ENABLED === 'false') {
    return false;
  }
  return process.env.NODE_ENV === 'production';
}
