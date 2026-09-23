import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';

/**
 * Field names whose values never belong in a log, wherever they appear in a
 * logged object: a password, a session or signed-link token, a secret, a
 * licence key. Listed at three depths because pino's redaction matches paths,
 * not names, and a logged DTO nests.
 */
const SECRET_FIELDS = ['password', 'token', 'accessToken', 'refreshToken', 'secret', 'key'];

/**
 * `code` is redacted only where a request's data sits, not everywhere: a TOTP
 * or magic-link code arrives in a body or a query, while `err.code` is
 * P2002 or ECONNREFUSED — the most useful word in the whole error.
 */
const CODE_PATHS = ['code', 'body.code', 'params.code', 'query.code', 'data.code', 'req.query.code'];

const HEADER_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-da-internal"]',
  'res.headers["set-cookie"]',
];

export const REDACT_PATHS = [
  ...HEADER_PATHS,
  ...SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
  ...CODE_PATHS,
];

/** Query parameters whose values are credentials: signed links, previews, codes. */
const SECRET_QUERY = /^(token|code|key|secret|password|preview|signature|sig|email)$/i;

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

/**
 * `someone@example.com` → `s***@example.com`.
 *
 * The domain stays: "every Hotmail address bounced" is a thing somebody needs
 * to be able to read in the log. The person does not.
 */
export function maskEmails(text: string): string {
  return text.includes('@') ? text.replace(EMAIL, '$1***@$2') : text;
}

/** A request URL with credential-bearing query values blanked and emails masked. */
export function scrubUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return maskEmails(url);
  const params = new URLSearchParams(url.slice(q + 1));
  for (const name of [...params.keys()]) {
    if (SECRET_QUERY.test(name)) params.set(name, '[redacted]');
  }
  return maskEmails(`${url.slice(0, q)}?${params.toString()}`);
}

/** The parsed query, treated like the URL it came from. */
function scrubQuery(query: unknown): unknown {
  if (query === null || typeof query !== 'object') return query;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(query)) {
    out[name] = SECRET_QUERY.test(name)
      ? '[redacted]'
      : typeof value === 'string'
        ? maskEmails(value)
        : value;
  }
  return out;
}

/** Masks emails in the string values of a log record, a few levels down. */
function maskRecord(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return maskEmails(value);
  if (depth === 0 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => maskRecord(item, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [name, inner] of Object.entries(value)) {
    // req/res/err have their own serializers and carry raw Node objects that
    // must not be walked.
    out[name] = name === 'req' || name === 'res' || name === 'err' ? inner : maskRecord(inner, depth - 1);
  }
  return out;
}

/**
 * A caller's request id is kept only when it looks like one. It is written
 * into every log line of the request, so free text here is log injection.
 */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestIdFor(req: Pick<IncomingMessage, 'headers'>): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/**
 * The request's path as it arrived. Middleware mounted on a path (the health
 * routes are, being outside the /v1 prefix) sees `url` with the mount point
 * stripped, so `/health` reads as `/`.
 */
function originalUrl(req: IncomingMessage): string {
  return (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
}

function prettyAvailable(): boolean {
  try {
    // A devDependency: present on a laptop, absent from a production install.
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * The logger's configuration: JSON lines on stdout, one per request plus
 * whatever the code logs, each carrying the request id.
 *
 * JSON in every environment but development, where it is pretty-printed —
 * Coolify's log view and any shipper parse lines, not colours.
 */
export function loggerParams(): Params {
  const development = process.env.NODE_ENV === 'development';
  const pretty = development && prettyAvailable();

  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Fastify assigns the id first (see main.ts) and pino-http keeps an id it
      // finds on the request; this only covers a request that somehow has none.
      genReqId: (req: IncomingMessage, _res: ServerResponse) => requestIdFor(req),
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      // Probes arrive every few seconds from the proxy and say nothing.
      autoLogging: { ignore: (req) => originalUrl(req).startsWith('/health') },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        // pino-http hands this the already-serialised request.
        req: (req: { url?: string; query?: unknown } & Record<string, unknown>) => ({
          ...req,
          url: typeof req.url === 'string' ? scrubUrl(req.url) : req.url,
          query: scrubQuery(req.query),
        }),
      },
      formatters: {
        log: (record) => maskRecord(record, 3) as Record<string, unknown>,
      },
      hooks: {
        // The message string itself: `Sent receipt to someone@example.com`.
        logMethod(args, method) {
          const masked = args.map((arg) => (typeof arg === 'string' ? maskEmails(arg) : arg));
          method.apply(this, masked as Parameters<typeof method>);
        },
      },
      ...(pretty
        ? { transport: { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } } }
        : {}),
    },
  };
}
