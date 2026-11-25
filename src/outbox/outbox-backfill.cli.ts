import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { createConnection, type Connection } from 'mongoose';
import { canonicalizeOutboxRow, type OutboxBackfillRow } from './outbox-backfill.js';

/**
 * One-shot migration for 1.x envelopes left pending in `cms_outbox`.
 *
 * Run it with cms-svc stopped: the relay publishes the stored envelope
 * verbatim, so a row must not be claimed between the read and the rewrite.
 * Only `status: "pending"` documents are touched, so published history stays
 * intact; a canonical envelope is reported `unchanged`, making re-runs a no-op.
 *
 * Usage (after `pnpm build`):
 *   node --env-file=.env dist/outbox/outbox-backfill.cli.js --dry-run
 *   node --env-file=.env dist/outbox/outbox-backfill.cli.js
 *   node --env-file=.env dist/outbox/outbox-backfill.cli.js --collection cms_outbox --batch 200
 */

interface CliOptions {
  readonly uri: string;
  readonly collection: string;
  readonly batch: number;
  readonly dryRun: boolean;
}

interface BackfillSummary {
  updated: number;
  unchanged: number;
  skipped: number;
  skippedReasons: string[];
}

/** cms_outbox uses the event id as its string primary key, not an ObjectId. */
interface OutboxDocument {
  _id: string;
  event_id?: string;
  event_type?: string;
  envelope?: Record<string, unknown>;
  created_at?: Date;
}

function parseArgs(argv: string[]): CliOptions {
  let collection = 'cms_outbox';
  let batch = 500;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--collection' || arg === '--batch') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      if (arg === '--collection') {
        collection = value;
      } else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`--batch must be a positive integer, got '${value}'`);
        }
        batch = parsed;
      }
      continue;
    }
    throw new Error(`unknown argument '${arg}'`);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required (run with --env-file=.env)');
  }
  return { uri, collection, batch, dryRun };
}

function toRow(raw: OutboxDocument): OutboxBackfillRow {
  return {
    id: raw._id,
    eventId: raw.event_id ?? raw._id,
    eventType: raw.event_type ?? '',
    envelope: raw.envelope ?? {},
    createdAt: raw.created_at instanceof Date ? raw.created_at : undefined,
  };
}

export async function backfillPendingOutbox(
  connection: Connection,
  options: Pick<CliOptions, 'collection' | 'batch' | 'dryRun'>,
  logger: Pick<Logger, 'log' | 'warn'>,
): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    updated: 0,
    unchanged: 0,
    skipped: 0,
    skippedReasons: [],
  };
  const db = connection.db;
  if (!db) {
    throw new Error('Mongo connection is not ready');
  }
  const collection = db.collection<OutboxDocument>(options.collection);

  // All pending rows, not just ones with a missing field: a dual-written row
  // whose envelope `type` disagrees with `event_type` needs a rewrite too.
  const cursor = collection
    .find({ status: 'pending' })
    .project<OutboxDocument>({ _id: 1, event_id: 1, event_type: 1, envelope: 1, created_at: 1 })
    .batchSize(options.batch);

  for await (const raw of cursor) {
    const row = toRow(raw);
    const result = canonicalizeOutboxRow(row);

    if (result.kind === 'unchanged') {
      summary.unchanged += 1;
      continue;
    }
    if (result.kind === 'skipped') {
      summary.skipped += 1;
      summary.skippedReasons.push(`${row.id}: ${result.reason}`);
      continue;
    }
    if (options.dryRun) {
      summary.updated += 1;
      continue;
    }

    // The status predicate leaves a row the relay claimed meanwhile alone.
    const write = await collection.updateOne(
      { _id: row.id, status: 'pending' },
      { $set: { envelope: result.envelope } },
    );
    if (write.matchedCount === 0) {
      logger.warn(`${row.id} was no longer pending; left as-is`);
      continue;
    }
    summary.updated += write.modifiedCount;
  }

  logger.log(
    `outbox backfill: ${summary.updated} updated, ${summary.unchanged} already canonical, ` +
      `${summary.skipped} skipped${options.dryRun ? ' (dry run, nothing written)' : ''}`,
  );
  for (const reason of summary.skippedReasons) {
    logger.warn(`skipped ${reason}`);
  }
  return summary;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const logger = new Logger('OutboxBackfill');
  const connection: Connection = createConnection();

  try {
    await connection.openUri(options.uri, { serverSelectionTimeoutMS: 2000 });
    const summary = await backfillPendingOutbox(connection, options, logger);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    // A skipped row still cannot be relayed after the cutover: fail loudly.
    if (summary.skipped > 0) {
      process.exitCode = 1;
    }
  } finally {
    await connection.close();
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    new Logger('OutboxBackfill').error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
