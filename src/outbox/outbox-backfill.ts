import {
  eventEnvelopeSchema,
  isEventTopic,
  type EventEnvelope,
} from '@ecom/contracts';

/** One pending outbox document, narrowed to the fields the backfill reads. */
export interface OutboxBackfillRow {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly envelope: Record<string, unknown>;
  readonly createdAt?: Date;
}

export type OutboxBackfillResult =
  | { readonly kind: 'unchanged'; readonly id: string }
  | { readonly kind: 'updated'; readonly id: string; readonly envelope: EventEnvelope }
  | { readonly kind: 'skipped'; readonly id: string; readonly reason: string };

/** Every row in this collection was written by this service before the cutover. */
const PRODUCER = 'cms-svc';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rewrites one stored `cms_outbox` envelope into the canonical 2.0.0 shape.
 *
 * The relay publishes the stored envelope verbatim, so a 1.x row still pending
 * at cutover is refused by every 2.0.0 consumer: `eventEnvelopeSchema` is strict
 * now, requires `type`/`version`/`idempotencyKey`, and rejects the old
 * `topic`/`eventType` aliases as unknown keys. This is the only place a legacy
 * envelope is converted — consumers must not normalise at read time, or a
 * producer that missed the cutover would keep working unnoticed.
 *
 * The row's `event_type` field, not an envelope alias, names the topic: it is
 * the outbox's own routing column and stays authoritative. Missing `version`
 * and `idempotencyKey` fall back to the values 1.x's `readEventEnvelope` used
 * to supply at read time, so the rewrite does not change an event's identity.
 * A row already canonical is left untouched, which makes the CLI idempotent;
 * a row that cannot be made canonical is skipped with a readable reason.
 */
export function canonicalizeOutboxRow(row: OutboxBackfillRow): OutboxBackfillResult {
  if (!isEventTopic(row.eventType)) {
    return { kind: 'skipped', id: row.id, reason: `unknown event_type '${row.eventType}'` };
  }

  const stored = isRecord(row.envelope) ? row.envelope : {};
  const current = eventEnvelopeSchema.safeParse(stored);
  if (current.success && current.data.type === row.eventType) {
    return { kind: 'unchanged', id: row.id };
  }

  const id = text(stored.id) ?? row.eventId;
  const candidate = {
    id,
    type: row.eventType,
    version: typeof stored.version === 'number' ? stored.version : 1,
    timestamp:
      text(stored.timestamp) ??
      (row.createdAt instanceof Date ? row.createdAt.toISOString() : undefined),
    producer: text(stored.producer) ?? PRODUCER,
    idempotencyKey: text(stored.idempotencyKey) ?? id,
    payload: stored.payload,
  };

  const parsed = eventEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { kind: 'skipped', id: row.id, reason };
  }
  return { kind: 'updated', id: row.id, envelope: parsed.data };
}
