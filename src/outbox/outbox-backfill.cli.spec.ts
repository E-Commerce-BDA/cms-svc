import type { Logger } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { backfillPendingOutbox } from './outbox-backfill.cli.js';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const NOW = '2026-11-26T10:00:00.000Z';

interface FakeDoc {
  _id: string;
  event_id: string;
  event_type: string;
  envelope: Record<string, unknown>;
  created_at: Date;
  status: string;
}

function legacyEnvelope(): Record<string, unknown> {
  return {
    id: ID,
    topic: 'cms.updated',
    eventType: 'cms.updated',
    timestamp: NOW,
    producer: 'cms-svc',
    payload: { scope: 'pages', version: 1, key: 'home' },
  };
}

function fakeConnection(docs: FakeDoc[]): Connection {
  const collection = {
    find(filter: { status: string }) {
      const matching = docs.filter((doc) => doc.status === filter.status);
      return {
        project: () => ({
          batchSize: () =>
            (async function* () {
              for (const doc of matching) yield doc;
            })(),
        }),
      };
    },
    async updateOne(filter: { _id: string; status: string }, update: { $set: { envelope: Record<string, unknown> } }) {
      const doc = docs.find((item) => item._id === filter._id);
      if (!doc || doc.status !== filter.status) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      doc.envelope = update.$set.envelope;
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  return { db: { collection: () => collection } } as unknown as Connection;
}

const logger = {
  log: vi.fn(),
  warn: vi.fn(),
} as unknown as Pick<Logger, 'log' | 'warn'>;

const options = (dryRun: boolean) => ({
  collection: 'cms_outbox',
  batch: 500,
  dryRun,
});

function pendingDoc(): FakeDoc {
  return {
    _id: ID,
    event_id: ID,
    event_type: 'cms.updated',
    envelope: legacyEnvelope(),
    created_at: new Date(NOW),
    status: 'pending',
  };
}

describe('outbox backfill CLI loop', () => {
  it('reports changes on a dry run without touching the document', async () => {
    const docs = [pendingDoc()];
    const summary = await backfillPendingOutbox(
      fakeConnection(docs),
      options(true),
      logger,
    );

    expect(summary.updated).toBe(1);
    expect(docs[0]!.envelope.topic).toBe('cms.updated');
  });

  it('rewrites a pending row and leaves published history intact', async () => {
    const published = {
      ...pendingDoc(),
      _id: 'published-row',
      event_id: 'published-row',
      status: 'published',
    };
    const docs = [pendingDoc(), published];
    const summary = await backfillPendingOutbox(
      fakeConnection(docs),
      options(false),
      logger,
    );

    expect(summary).toMatchObject({ updated: 1, unchanged: 0, skipped: 0 });
    expect(docs[0]!.envelope).not.toHaveProperty('topic');
    expect(docs[0]!.envelope.idempotencyKey).toBe(ID);
    expect(published.envelope.topic).toBe('cms.updated');
  });

  it('is idempotent: a second run writes nothing', async () => {
    const connection = fakeConnection([pendingDoc()]);
    await backfillPendingOutbox(connection, options(false), logger);
    const summary = await backfillPendingOutbox(connection, options(false), logger);

    expect(summary).toMatchObject({ updated: 0, unchanged: 1, skipped: 0 });
  });

  it('reports a row that cannot be canonicalized as skipped', async () => {
    const docs = [{ ...pendingDoc(), event_type: 'mystery.event' }];
    const summary = await backfillPendingOutbox(
      fakeConnection(docs),
      options(false),
      logger,
    );

    expect(summary.skipped).toBe(1);
    expect(summary.skippedReasons[0]).toContain('mystery.event');
    expect(logger.warn).toHaveBeenCalled();
  });
});
