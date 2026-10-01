import {
  FulfillmentMode,
  FulfillmentState,
  OrderStatus,
  PaymentState,
  type PrismaClient,
} from '@da/db';

/**
 * The two alerts an uptime monitor cannot infer from `/health/ready`: a sweep
 * that has stopped, and a paid customer still waiting for their key.
 *
 * Both are answered from what the database and the scheduler already hold, so
 * nothing new is recorded and no migration is needed. The questions are about
 * outcomes, not heartbeats: "is there a paid order the stranded sweep should
 * have picked up by now" catches a sweep that runs and fails as well as one
 * that never runs.
 */

/** How far past its period a cron may go before it counts as stopped. */
const CRON_SLACK_MS = 60_000;

/**
 * The stranded sweep takes PAID orders with PENDING lines 5 minutes after
 * payment and runs every 5 minutes. Past 15, two passes have missed it.
 */
export const STRANDED_AFTER_MS = 15 * 60 * 1000;

/** expire-drafts: 14 days, hourly, plus two passes of slack. */
export const DRAFT_OVERDUE_MS = (14 * 24 + 3) * 60 * 60 * 1000;

/** How far back delivered lines are measured. */
export const DELIVERY_WINDOW_MS = 60 * 60 * 1000;

/** The plan's target for a stocked line, and the column's default. */
export const DELIVERY_TARGET_SECONDS = 60;

export interface CronJobView {
  name: string;
  active: boolean;
  /** When this process last fired it. Null until the first tick after boot. */
  lastRunAt: Date | null;
  /** The gap between its next two fire times. */
  periodMs: number;
}

export interface CronStatus {
  name: string;
  lastRunAt: string | null;
  periodSeconds: number;
  stale: boolean;
}

/**
 * A job is stale when it is stopped, or when neither its last tick nor, before
 * the first one, the process's start is within two periods. Fired, not
 * succeeded: the job fires on every replica and only one takes the lock, so
 * the backlog counts below are what say whether the work got done.
 */
export function cronStatus(job: CronJobView, bootedAt: Date, now: Date): CronStatus {
  const since = job.lastRunAt ?? bootedAt;
  const stale = !job.active || now.getTime() - since.getTime() > 2 * job.periodMs + CRON_SLACK_MS;
  return {
    name: job.name,
    lastRunAt: job.lastRunAt?.toISOString() ?? null,
    periodSeconds: Math.round(job.periodMs / 1000),
    stale,
  };
}

export interface SweepHealth {
  status: 'ok' | 'alert';
  jobs: CronStatus[];
  /** PAID orders with an untouched line, past the point the sweep should have taken them. */
  strandedLines: number;
  /** Unpaid drafts the expiry sweep should already have cancelled. */
  overdueDrafts: number;
}

export function sweepHealth(
  jobs: CronStatus[],
  strandedLines: number,
  overdueDrafts: number,
): SweepHealth {
  const alert =
    jobs.length === 0 || jobs.some((job) => job.stale) || strandedLines > 0 || overdueDrafts > 0;
  return { status: alert ? 'alert' : 'ok', jobs, strandedLines, overdueDrafts };
}

export interface DeliveryRow {
  paidAt: Date | null;
  deliveredAt: Date | null;
  slaSeconds: number;
  mode: FulfillmentMode;
}

export interface DeliveryHealth {
  status: 'ok' | 'alert';
  windowMinutes: number;
  /** Lines delivered in the window. */
  delivered: number;
  /** Of those, delivered later than the line's own promise. */
  deliveredLate: number;
  /** Paid lines not delivered yet and already past their promise. */
  waitingPastPromise: number;
  /** Paid → delivered, in seconds, for stocked lines delivered in the window. */
  stocked: { count: number; p50: number | null; p95: number | null; max: number | null };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

/**
 * Judged per line against the variant's `deliverySlaSeconds` — the promise
 * the product page shows, 60 s by default — the same rule the admin
 * dashboard's "overdue" row uses. A supplier-ordered line with a six-hour
 * promise is not late at two hours; a stocked line is late at 61 seconds.
 */
export function deliveryHealth(
  delivered: DeliveryRow[],
  waiting: DeliveryRow[],
  now: Date,
): DeliveryHealth {
  const seconds = (row: DeliveryRow, end: Date): number | null =>
    row.paidAt ? Math.max(0, (end.getTime() - row.paidAt.getTime()) / 1000) : null;

  let deliveredLate = 0;
  const stocked: number[] = [];
  for (const row of delivered) {
    const latency = row.deliveredAt ? seconds(row, row.deliveredAt) : null;
    if (latency === null) continue;
    if (latency > row.slaSeconds) deliveredLate += 1;
    if (row.mode === FulfillmentMode.FROM_STOCK) stocked.push(latency);
  }
  const waitingPastPromise = waiting.filter((row) => {
    const waited = seconds(row, now);
    return waited !== null && waited > row.slaSeconds;
  }).length;

  stocked.sort((a, b) => a - b);
  const round = (value: number | null): number | null =>
    value === null ? null : Math.round(value * 10) / 10;

  return {
    status: deliveredLate > 0 || waitingPastPromise > 0 ? 'alert' : 'ok',
    windowMinutes: DELIVERY_WINDOW_MS / 60_000,
    delivered: delivered.length,
    deliveredLate,
    waitingPastPromise,
    stocked: {
      count: stocked.length,
      p50: round(percentile(stocked, 50)),
      p95: round(percentile(stocked, 95)),
      max: round(stocked.at(-1) ?? null),
    },
  };
}

/** Paid, or partly delivered: the states in which a customer is waiting. */
const WAITING_ORDER = [OrderStatus.PAID, OrderStatus.FULFILLING];
const WAITING_LINE = [
  FulfillmentState.PENDING,
  FulfillmentState.AUTO_ASSIGNED,
  FulfillmentState.MANUAL_QUEUE,
];

/** Bounds the probe's cost on a busy hour; the counts it drives are about "any". */
const ROW_LIMIT = 1000;

const lineSelect = {
  deliveredAt: true,
  order: { select: { paidAt: true } },
  variant: { select: { deliverySlaSeconds: true, fulfillmentMode: true } },
} as const;

type LineRow = {
  deliveredAt: Date | null;
  order: { paidAt: Date | null };
  variant: { deliverySlaSeconds: number; fulfillmentMode: FulfillmentMode };
};

function toRow(line: LineRow): DeliveryRow {
  return {
    paidAt: line.order.paidAt,
    deliveredAt: line.deliveredAt,
    slaSeconds: line.variant.deliverySlaSeconds,
    mode: line.variant.fulfillmentMode,
  };
}

export async function readDelivery(client: PrismaClient, now: Date): Promise<DeliveryHealth> {
  const [delivered, waiting] = await Promise.all([
    client.orderItem.findMany({
      where: {
        fulfillmentState: FulfillmentState.DELIVERED,
        deliveredAt: { gte: new Date(now.getTime() - DELIVERY_WINDOW_MS) },
      },
      select: lineSelect,
      take: ROW_LIMIT,
    }),
    client.orderItem.findMany({
      where: { fulfillmentState: { in: WAITING_LINE }, order: { status: { in: WAITING_ORDER } } },
      select: lineSelect,
      take: ROW_LIMIT,
    }),
  ]);
  return deliveryHealth(delivered.map(toRow), waiting.map(toRow), now);
}

export async function readBacklogs(
  client: PrismaClient,
  now: Date,
): Promise<{ strandedLines: number; overdueDrafts: number }> {
  const [strandedLines, overdueDrafts] = await Promise.all([
    client.orderItem.count({
      where: {
        fulfillmentState: FulfillmentState.PENDING,
        order: {
          status: OrderStatus.PAID,
          paidAt: { lte: new Date(now.getTime() - STRANDED_AFTER_MS) },
        },
      },
    }),
    client.order.count({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        placedAt: { lte: new Date(now.getTime() - DRAFT_OVERDUE_MS) },
        payments: { none: { state: PaymentState.SUCCEEDED } },
      },
    }),
  ]);
  return { strandedLines, overdueDrafts };
}
