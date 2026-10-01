import { Logger } from '@nestjs/common';

import { scrubBreadcrumb, scrubEvent } from './error-scrub.js';

/** What is known about the request a server error came from. */
export interface ErrorContext {
  status: number;
  method?: string;
  /** The route pattern, not the URL — a URL can carry a signed token. */
  route?: string;
  requestId?: string;
}

/**
 * Where server faults go besides the log.
 *
 * An interface with a no-op default, so the exception filter reports
 * unconditionally and whether anything receives it is a deployment decision
 * (`SENTRY_DSN`), not a code change.
 */
export interface ErrorReporter {
  report(error: unknown, context: ErrorContext): void;
  /** Called at shutdown, so a fault reported just before a deploy is not lost. */
  flush(timeoutMs: number): Promise<void>;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');

export class NoopErrorReporter implements ErrorReporter {
  report(): void {}
  flush(): Promise<void> {
    return Promise.resolve();
  }
}

export interface SentryInitOptions {
  dsn: string;
  environment?: string;
  sendDefaultPii?: boolean;
  beforeSend?: <E>(event: E) => E | null;
  beforeBreadcrumb?: <B>(breadcrumb: B) => B | null;
}

/** The part of `@sentry/node` the adapter calls. */
export interface SentryLike {
  init(options: SentryInitOptions): void;
  captureException(
    error: unknown,
    hint?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
  ): string;
  flush(timeoutMs?: number): Promise<boolean>;
}

/**
 * The Sentry adapter.
 *
 * `@sentry/node` is not a dependency yet, so it is loaded by name at runtime
 * rather than imported: the API compiles and boots without it, and adding the
 * package (see docs/deployment.md, "Error reporting") is all it takes to turn
 * this on. Nothing identifying goes with the event — no PII, no URL, no body —
 * because an order URL or a reveal response is a licence key in transit. What
 * the SDK adds by itself (the request it saw, breadcrumbs, the exception
 * message) passes through `scrubEvent` first: see error-scrub.ts.
 */
export class SentryErrorReporter implements ErrorReporter {
  constructor(private readonly sentry: SentryLike) {}

  report(error: unknown, context: ErrorContext): void {
    this.sentry.captureException(error, {
      tags: {
        status: String(context.status),
        ...(context.method ? { method: context.method } : {}),
        ...(context.route ? { route: context.route } : {}),
      },
      extra: context.requestId ? { requestId: context.requestId } : {},
    });
  }

  async flush(timeoutMs: number): Promise<void> {
    await this.sentry.flush(timeoutMs);
  }
}

/** The options the adapter initialises Sentry with. Exported for the test. */
export function sentryOptions(dsn: string): SentryInitOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

export async function createErrorReporter(
  dsn: string | undefined,
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('ErrorReporter'),
  load: (name: string) => Promise<unknown> = (name) => import(name),
): Promise<ErrorReporter> {
  if (!dsn) return new NoopErrorReporter();

  // A variable, so TypeScript does not try to resolve a package that is not
  // installed.
  const packageName = '@sentry/node';
  let sentry: SentryLike;
  try {
    sentry = (await load(packageName)) as SentryLike;
  } catch {
    logger.warn(
      'SENTRY_DSN is set but @sentry/node is not installed; server errors are logged only. See docs/deployment.md.',
    );
    return new NoopErrorReporter();
  }

  sentry.init(sentryOptions(dsn));
  logger.log('Server errors are reported to Sentry');
  return new SentryErrorReporter(sentry);
}
