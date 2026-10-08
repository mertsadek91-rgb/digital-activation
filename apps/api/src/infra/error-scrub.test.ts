import { describe, expect, it, vi } from 'vitest';

import { type SentryInitOptions, createErrorReporter, sentryOptions } from './error-reporter.js';
import {
  isSecretName,
  maskLicenceKeys,
  maskOrderPaths,
  maskTokens,
  scrub,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
} from './error-scrub.js';

// Made-up values shaped like the real ones. None of them is a real key.
// Fixtures are assembled at runtime: a key-shaped literal next to the word
// 'key' is exactly what the CI secret scanner (gitleaks) is built to flag.
const KEY = ['ABCDE', '12345', 'FGHIJ', '67890', 'KLMNO'].join('-');
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
const EMAIL = 'someone.else@example.com';

/** Everything the event could carry that must not leave the process. */
function leaks(value: unknown): string[] {
  const text = JSON.stringify(value);
  return [KEY, TOKEN, EMAIL, 'hunter2', 'sess=abc', 'internal-key'].filter((secret) =>
    text.includes(secret),
  );
}

/** Roughly what @sentry/node hands `beforeSend` for a failed reveal request. */
function sentryEvent(): Record<string, unknown> {
  return {
    event_id: 'a1b2c3',
    message: `Delivery of ${KEY} to ${EMAIL} failed`,
    exception: {
      values: [
        {
          type: 'Error',
          value: `SMTP rejected ${EMAIL}: licence ${KEY}`,
          stacktrace: { frames: [{ filename: 'fulfillment.service.js', lineno: 12 }] },
        },
      ],
    },
    user: { email: EMAIL, ip_address: '203.0.113.9' },
    request: {
      method: 'POST',
      url: `https://api.example.com/v1/orders/DA-1/keys?token=${TOKEN}&locale=ar`,
      query_string: `token=${TOKEN}&email=${EMAIL}&locale=ar`,
      data: { password: 'hunter2', key: KEY },
      cookies: { sess: 'sess=abc' },
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Cookie: 'sess=abc',
        'x-da-internal': 'internal-key',
        'User-Agent': 'Mozilla/5.0',
      },
    },
    extra: { requestId: 'req-1', nested: { deeper: { accessToken: TOKEN, note: EMAIL } } },
    tags: { status: '500', route: '/v1/orders/:number/keys' },
  };
}

describe('scrubEvent', () => {
  it('lets no licence key, token, email, password or cookie through', () => {
    const scrubbed = scrubEvent(sentryEvent());
    expect(leaks(scrubbed)).toEqual([]);
  });

  it('keeps what is needed to act on the fault', () => {
    const scrubbed = scrubEvent(sentryEvent()) as ReturnType<typeof sentryEvent> & {
      exception: { values: { value: string }[] };
      request: { method: string; url: string; headers: Record<string, string> };
      tags: Record<string, string>;
      extra: { requestId: string };
    };
    expect(scrubbed.exception.values[0]?.value).toBe(
      'SMTP rejected s***@example.com: licence [key]',
    );
    expect(scrubbed.request.method).toBe('POST');
    expect(scrubbed.request.url).toContain('locale=ar');
    expect(scrubbed.request.headers).toEqual({ 'User-Agent': 'Mozilla/5.0' });
    expect(scrubbed.tags).toEqual({ status: '500', route: '/v1/orders/:number/keys' });
    expect(scrubbed.extra.requestId).toBe('req-1');
  });

  it('removes the user and the request body outright', () => {
    const scrubbed = scrubEvent(sentryEvent()) as { user?: unknown; request: { data?: unknown } };
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.request.data).toBeUndefined();
  });

  it('does not change the event it was given', () => {
    const event = sentryEvent();
    scrubEvent(event);
    expect(JSON.stringify(event)).toContain(KEY);
  });
});

describe('scrubBreadcrumb', () => {
  it('scrubs an outgoing HTTP call the SDK recorded', () => {
    const crumb = scrubBreadcrumb({
      category: 'http',
      message: `GET https://supplier.example/api?key=${KEY}`,
      data: { url: `https://supplier.example/api?key=${KEY}&email=${EMAIL}`, status_code: 500 },
    });
    expect(leaks(crumb)).toEqual([]);
    expect((crumb.data as { status_code: number }).status_code).toBe(500);
  });
});

describe('scrub', () => {
  it('redacts the log’s secret fields at any depth', () => {
    expect(scrub({ a: { b: { c: { d: { refreshToken: TOKEN, secret: 's', ok: 1 } } } } })).toEqual({
      a: { b: { c: { d: { refreshToken: '[redacted]', secret: '[redacted]', ok: 1 } } } },
    });
  });

  it('keeps diagnostic codes such as P2002 outside request data', () => {
    expect(scrub({ code: 'P2002' })).toEqual({ code: 'P2002' });
  });
});

describe('maskLicenceKeys', () => {
  it('masks four- and five-group keys', () => {
    expect(maskLicenceKeys(`k ${KEY} and ABCD-EFGH-1234-5678`)).toBe('k [key] and [key]');
  });

  it('masks lower- and mixed-case keys, and three groups with a digit', () => {
    expect(maskLicenceKeys('abcde-12345-fghij-67890')).toBe('[key]');
    expect(maskLicenceKeys('Ab12c-De34f-Gh56i-Jk78l')).toBe('[key]');
    const shortKey = ['ab12', 'cd34', 'ef56'].join('-');
    expect(maskLicenceKeys(`key: ${shortKey}.`)).toBe('key: [key].');
  });

  it('leaves prose, slugs and partial matches inside longer runs alone', () => {
    const text = 'read-only-mode well-known-thing office-2021-home-business x_abcd-1234-efgh';
    expect(maskLicenceKeys(text)).toBe(text);
  });

  it('leaves ids, order numbers and dates alone', () => {
    const text = 'order DA-2026-00187 id 3f2b8c1e-4e5f-6789-abcd-1234567890ab at 2026-09-30';
    expect(maskLicenceKeys(text)).toBe(text);
  });
});

describe('isSecretName', () => {
  it('redacts names that contain a secret word, in any case and style', () => {
    for (const name of [
      'licenseKey',
      'apiKey',
      'APIKEY',
      'api_key',
      'x-api-key',
      'sessionToken',
      'passwordHash',
      'clientSecret',
      'client_secret',
      'db_passwd',
      'Proxy-Authorization',
      'set-cookie',
      'Cookies',
      'otp',
      'otpCode',
      'totpSecret',
      'keys',
      'keyHash',
      'x-da-internal',
      'x-da-monitor',
    ]) {
      expect(isSecretName(name), name).toBe(true);
    }
  });

  it('keeps names that describe a secret rather than hold one, and unrelated words', () => {
    for (const name of [
      'keyId',
      'key_version',
      'tokenType',
      'passwordChangedAt',
      'keyCount',
      'isNotPaid',
      'monkeyBusiness',
      'keyboardLayout',
      'status',
      'code',
      'requestId',
    ]) {
      expect(isSecretName(name), name).toBe(false);
    }
  });
});

describe('maskTokens', () => {
  const RANDOM = 'Q2hlY2tvdXQ5X3Rva2VuX2FiY2RlZjEyMzQ1Njc4OTA'; // 43 chars, mixed

  it('masks JWTs, bearer credentials and long random runs', () => {
    expect(maskTokens(`jwt ${TOKEN} end`)).toBe('jwt [token] end');
    expect(maskTokens('Authorization: bearer abc.def-ghi')).toBe('Authorization: Bearer [token]');
    expect(maskTokens(`reset=${RANDOM}`)).toBe('reset=[token]');
    expect(maskTokens(`sha ${'a1b2c3d4'.repeat(5)}`)).toBe('sha [token]');
  });

  it('leaves UUIDs, slugs, words and short ids alone', () => {
    const text = [
      '3f2b8c1e-4e5f-6789-abcd-1234567890ab',
      'how-to-activate-windows-11-pro-in-2026-guide',
      'fulfillment.service.js',
      'cm1abc2de0000xyz12345abcd',
      'bearer of bad news',
      'DA-2026-00187',
    ].join(' ');
    expect(maskTokens(text)).toBe(text);
  });
});

describe('maskOrderPaths', () => {
  it('replaces an order number used as a path segment', () => {
    expect(maskOrderPaths('/v1/orders/DA-2026-00187')).toBe('/v1/orders/:number');
    expect(maskOrderPaths('GET https://api.x/v1/orders/DA-2026-00187/keys?locale=ar')).toBe(
      'GET https://api.x/v1/orders/:number/keys?locale=ar',
    );
  });

  it('keeps an order number in prose, and the route template', () => {
    const text = 'order DA-2026-00187 failed on /v1/orders/:number/keys';
    expect(maskOrderPaths(text)).toBe(text);
  });
});

describe('scrubText', () => {
  it('masks a token used as a path segment', () => {
    const random = 'Q2hlY2tvdXQ5X3Rva2VuX2FiY2RlZjEyMzQ1Njc4OTA';
    expect(scrubText(`/v1/account/magic/${random}/confirm`)).toBe(
      '/v1/account/magic/[token]/confirm',
    );
  });

  it('keeps a JWT whole even when a segment contains a dash-grouped run', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.x_abcd-1234-efgh-5678_y.sig';
    expect(scrubText(`t=${jwt}`)).toBe('t=[token]');
  });
});

describe('the Sentry adapter', () => {
  it('initialises Sentry with the scrubbers and no default PII', async () => {
    const init = vi.fn<(options: SentryInitOptions) => void>();
    const sentry = { init, captureException: vi.fn(), flush: vi.fn() };
    const logger = { log: vi.fn(), warn: vi.fn() };

    await createErrorReporter('https://dsn.example/1', logger, () => Promise.resolve(sentry));

    const options = init.mock.calls[0]?.[0];
    expect(options?.sendDefaultPii).toBe(false);
    expect(leaks(options?.beforeSend?.(sentryEvent()))).toEqual([]);
    expect(options?.beforeBreadcrumb).toBe(sentryOptions('x').beforeBreadcrumb);
  });

  it('falls back to logging only when the package is missing', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const reporter = await createErrorReporter('https://dsn.example/1', logger, () =>
      Promise.reject(new Error('Cannot find module')),
    );
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(reporter.constructor.name).toBe('NoopErrorReporter');
  });
});

describe('round-2 review gaps (TASK-0031)', () => {
  it('redacts vault and credential vocabulary', () => {
    for (const name of [
      'plaintext',
      'ciphertext',
      'credentials',
      'dsn',
      'dek',
      'licence',
      'recoveryCodes',
      'mfaCode',
    ]) {
      expect(isSecretName(name), name).toBe(true);
    }
    expect(isSecretName('cartRecovery')).toBe(false);
  });

  it('redacts a long string under a descriptive name, keeps short metadata', () => {
    const out = scrub({
      // Assembled at runtime so no Stripe-shaped literal sits in the repository.
      secretVersion: ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz0123'].join('_'),
      tokenAt: '2026-09-30T10:00:00.000Z',
      keyId: 'kek-v2',
      tokenType: 'refresh',
    }) as Record<string, unknown>;
    expect(out.secretVersion).toBe('[redacted]');
    expect(out.tokenAt).toBe('2026-09-30T10:00:00.000Z');
    expect(out.keyId).toBe('kek-v2');
    expect(out.tokenType).toBe('refresh');
  });

  it('masks Basic credentials and order numbers in any case or as a query value', () => {
    expect(scrubText('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe(
      'Authorization: Basic [token]',
    );
    expect(maskOrderPaths('/v1/orders/da-2026-00187')).toBe('/v1/orders/:number');
    expect(maskOrderPaths('/v1/orders?number=DA-2026-00187')).toBe('/v1/orders?number=:number');
    expect(maskOrderPaths('Order DA-2026-00187 failed')).toBe('Order DA-2026-00187 failed');
  });
});

describe('the installed @sentry/node', () => {
  // A variable, as in the adapter, so TypeScript does not resolve it.
  const packageName = '@sentry/node';
  // The adapter loads the SDK by name and casts it, so nothing else checks
  // that the real package still exports what the adapter calls. CI installs
  // it; a laptop that has not run `pnpm install` since TASK-0031 skips this.
  const installed = (() => {
    try {
      require.resolve(packageName);
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!installed && !process.env.CI)('exports init, captureException and flush', async () => {
    const sdk = (await import(packageName)) as Record<string, unknown>;
    expect(typeof sdk.init).toBe('function');
    expect(typeof sdk.captureException).toBe('function');
    expect(typeof sdk.flush).toBe('function');
  });
});
