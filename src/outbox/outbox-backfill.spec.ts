import { eventEnvelopeSchema } from '@ecom/contracts';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeOutboxRow,
  type OutboxBackfillRow,
} from './outbox-backfill.js';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const NOW = '2026-11-26T10:00:00.000Z';
const cmsPayload = { scope: 'pages', version: 3, key: 'home' };
const blogPayload = {
  blogId: ID,
  slug: 'hello-world',
  status: 'published',
} as const;

const canonical = {
  id: ID,
  type: 'cms.updated',
  version: 1,
  timestamp: NOW,
  producer: 'cms-svc',
  idempotencyKey: ID,
  payload: cmsPayload,
};

const row = (overrides: Partial<OutboxBackfillRow> = {}): OutboxBackfillRow => ({
  id: ID,
  eventId: ID,
  eventType: 'cms.updated',
  envelope: { ...canonical },
  createdAt: new Date(NOW),
  ...overrides,
});

describe('outbox envelope backfill', () => {
  it('leaves an already canonical envelope untouched', () => {
    expect(canonicalizeOutboxRow(row())).toEqual({ kind: 'unchanged', id: ID });
  });

  it('rewrites a dual-written 1.x envelope and drops both aliases', () => {
    const result = canonicalizeOutboxRow(
      row({
        envelope: {
          id: ID,
          type: 'cms.updated',
          topic: 'cms.updated',
          eventType: 'cms.updated',
          timestamp: NOW,
          producer: 'cms-svc',
          payload: cmsPayload,
        },
      }),
    );
    expect(result).toEqual({ kind: 'updated', id: ID, envelope: canonical });
  });

  it('adds version and idempotencyKey to an alias-free 1.x envelope', () => {
    const result = canonicalizeOutboxRow(
      row({
        envelope: {
          id: ID,
          type: 'cms.updated',
          timestamp: NOW,
          producer: 'cms-svc',
          payload: cmsPayload,
        },
      }),
    );
    expect(result).toEqual({ kind: 'updated', id: ID, envelope: canonical });
  });

  it('takes the event name from the row, not from an envelope alias', () => {
    const result = canonicalizeOutboxRow(
      row({
        eventType: 'blog.updated',
        envelope: {
          id: ID,
          topic: 'cms.updated',
          eventType: 'cms.updated',
          timestamp: NOW,
          producer: 'cms-svc',
          payload: blogPayload,
        },
      }),
    );
    expect(result).toEqual({
      kind: 'updated',
      id: ID,
      envelope: { ...canonical, type: 'blog.updated', payload: blogPayload },
    });
  });

  it('preserves a non-default version and an explicit idempotency key', () => {
    const result = canonicalizeOutboxRow(
      row({
        envelope: {
          id: ID,
          topic: 'cms.updated',
          eventType: 'cms.updated',
          version: 4,
          idempotencyKey: 'edition-4',
          timestamp: NOW,
          producer: 'cms-svc',
          payload: cmsPayload,
        },
      }),
    );
    expect(result).toEqual({
      kind: 'updated',
      id: ID,
      envelope: {
        ...canonical,
        version: 4,
        idempotencyKey: 'edition-4',
      },
    });
  });

  it('recovers a missing timestamp from the row creation time', () => {
    const withoutTimestamp: Record<string, unknown> = { ...canonical };
    delete withoutTimestamp.timestamp;
    const result = canonicalizeOutboxRow(row({ envelope: withoutTimestamp }));
    expect(result).toEqual({ kind: 'updated', id: ID, envelope: canonical });
  });

  it('produces an envelope that passes the 2.0.0 strict schema', () => {
    const result = canonicalizeOutboxRow(
      row({
        envelope: {
          id: ID,
          topic: 'cms.updated',
          eventType: 'cms.updated',
          timestamp: NOW,
          producer: 'cms-svc',
          payload: blogPayload,
        },
      }),
    );
    expect(result.kind).toBe('updated');
    if (result.kind !== 'updated') return;
    expect(eventEnvelopeSchema.safeParse(result.envelope).success).toBe(true);
    expect(result.envelope).not.toHaveProperty('topic');
    expect(result.envelope).not.toHaveProperty('eventType');
  });

  it('is idempotent: a rewritten envelope passes through unchanged', () => {
    const first = canonicalizeOutboxRow(
      row({
        envelope: {
          id: ID,
          timestamp: NOW,
          producer: 'cms-svc',
          payload: cmsPayload,
        },
      }),
    );
    expect(first.kind).toBe('updated');
    if (first.kind !== 'updated') return;
    expect(canonicalizeOutboxRow(row({ envelope: first.envelope }))).toEqual({
      kind: 'unchanged',
      id: ID,
    });
  });

  it('skips a row whose event_type is not a registered topic', () => {
    const result = canonicalizeOutboxRow(row({ eventType: 'mystery.event' }));
    expect(result).toEqual({
      kind: 'skipped',
      id: ID,
      reason: "unknown event_type 'mystery.event'",
    });
  });

  it('skips a row that cannot be made canonical with a readable reason', () => {
    const result = canonicalizeOutboxRow(row({ eventId: '', envelope: {} }));
    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason).toContain('id');
  });
});
