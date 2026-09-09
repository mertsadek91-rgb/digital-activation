/**
 * Environment checker.
 *
 *   pnpm env:check
 *
 * Compares `.env` against `.env.example` and reports three classes of problem
 * without ever printing a secret value:
 *
 *   1. keys present in the example but missing from .env — the usual cause is
 *      an .env copied before new variables were added
 *   2. values still left at their placeholder
 *   3. values that are set but unsafe: a service that carries a secret reached
 *      over plain HTTP, a backing service published on a public address, or a
 *      connection string whose password was not percent-encoded
 *
 * Only schemes, hostnames and ports are ever echoed. Passwords, tokens and
 * keys are reported as set / unset and nothing more.
 */
import fs from 'node:fs';
import path from 'node:path';

// Always invoked as `pnpm env:check` from the repo root, so cwd is the root.
// Avoids import.meta, which would force this one file into ESM.
const ROOT = process.cwd();

type Severity = 'error' | 'warn' | 'info';

interface Finding {
  severity: Severity;
  key: string;
  message: string;
}

const findings: Finding[] = [];

function parseEnvFile(file: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(file)) return out;

  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Mirror dotenv: quoted values keep everything inside the quotes,
    // unquoted values end at an inline comment.
    if (/^"(.*)"$/.test(value) || /^'(.*)'$/.test(value)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out.set(key, value);
  }
  return out;
}

/** Placeholder values shipped in .env.example that mean "not filled in". */
const PLACEHOLDERS = new Set([
  '',
  'change_me_min_32_chars_______________',
  'da_local_dev',
  'da_local_dev_master_key',
]);

/**
 * Services whose URL carries a credential. Reaching one over plain http:// on
 * anything but a loopback or container hostname puts that credential on the
 * wire in cleartext.
 */
const SECRET_BEARING_URLS = [
  'REDIS_URL',
  'MEILI_HOST',
  'DATABASE_URL',
  'DATABASE_URL_MIGRATE',
  'DATABASE_URL_VAULT',
  'SMTP_URL',
];

/** Backing services that should never be reachable from the public internet. */
const INTERNAL_ONLY = ['REDIS_URL', 'MEILI_HOST', 'DATABASE_URL', 'DATABASE_URL_VAULT'];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** True for a bare IP or a public wildcard-DNS host such as *.sslip.io. */
function isPublicHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) return false;
  if (IPV4.test(host)) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return !isPrivate;
  }
  // sslip.io / nip.io / traefik.me encode a public IP into a hostname.
  return /\.(sslip\.io|nip\.io|traefik\.me)$/i.test(host) || host.includes('.');
}

function describeUrl(key: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    findings.push({
      severity: 'error',
      key,
      message:
        'will not parse as a URL — percent-encode the password (@ %40, / %2F, : %3A, # %23, + %2B, space %20)',
    });
    return;
  }

  const host = url.hostname;
  const port = url.port ? `:${url.port}` : '';
  const hasCredential = Boolean(url.username || url.password);
  const scheme = url.protocol.replace(':', '');

  findings.push({
    severity: 'info',
    key,
    message: `${scheme}://${host}${port}${hasCredential ? ' (credentials present)' : ''}`,
  });

  if (INTERNAL_ONLY.includes(key) && isPublicHost(host)) {
    findings.push({
      severity: 'error',
      key,
      message: `reachable on a public address (${host}${port}). Backing services belong on the internal network only — a published port here is scanned continuously.`,
    });
  }

  if (SECRET_BEARING_URLS.includes(key) && scheme === 'http' && isPublicHost(host)) {
    findings.push({
      severity: 'error',
      key,
      message: `plain http:// over a public host — the credential in this URL travels in cleartext. Use the internal hostname, or https.`,
    });
  }
}

function main(): void {
  const example = parseEnvFile(path.join(ROOT, '.env.example'));
  const actual = parseEnvFile(path.join(ROOT, '.env'));

  if (actual.size === 0) {
    console.error('No .env found at the repo root. Start with: cp .env.example .env');
    process.exitCode = 1;
    return;
  }

  for (const key of example.keys()) {
    if (!actual.has(key)) {
      findings.push({
        severity: 'error',
        key,
        message: 'missing — present in .env.example but not in .env',
      });
      continue;
    }

    const value = actual.get(key) ?? '';
    if (PLACEHOLDERS.has(value)) {
      findings.push({ severity: 'warn', key, message: 'still empty or at its placeholder' });
      continue;
    }

    if (/^[a-z0-9+.-]+:\/\//i.test(value)) {
      describeUrl(key, value);
    }
  }

  const extra = [...actual.keys()].filter((key) => !example.has(key));
  for (const key of extra) {
    findings.push({
      severity: 'warn',
      key,
      message: 'not in .env.example — stale, or undocumented',
    });
  }

  const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.key.localeCompare(b.key));

  const label: Record<Severity, string> = { error: 'ERROR', warn: 'warn ', info: ' ok  ' };
  const width = Math.max(...findings.map((f) => f.key.length));

  console.log('');
  for (const finding of findings) {
    console.log(`[${label[finding.severity]}] ${finding.key.padEnd(width)}  ${finding.message}`);
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  console.log('');
  console.log(`${errors.length} error(s), ${warns.length} warning(s)`);

  if (errors.length > 0) process.exitCode = 1;
}

main();
